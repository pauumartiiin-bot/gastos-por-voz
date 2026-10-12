# Gastos por voz — contexto para Claude Code

## Qué es
App personal para registrar gastos dictando una frase en el iPhone ("Spotify 10,99 mensual ocio").
La v1 ya funciona: un backend en Google Apps Script interpreta la frase con Claude Haiku, la valida con
código y la guarda en Google Sheets. Este repo es la **v2**: frontend propio (HTML/CSS/JS en GitHub Pages,
instalable en la pantalla de inicio de iOS) y dictado propio con Whisper vía Groq.

Es también una pieza de portfolio: el código debe ser limpio, legible y explicable.

## Arquitectura
```
iPhone (esta app, GitHub Pages, instalada en pantalla de inicio)
  graba audio (MediaRecorder) ──POST text/plain──► Apps Script (doPost) = solo API
                                                     ├─► Groq Whisper: audio → texto
                                                     ├─► Claude Haiku: texto → JSON   (ya existe, no tocar)
                                                     └─► Validación → Google Sheets   (ya existe, no tocar)
```

## Reglas que no se negocian
- **Ningún secreto en el repo.** El repo es público. El token de la API lo introduce el usuario la primera
  vez y se guarda solo en el dispositivo (localStorage). Las claves (Groq, Anthropic) viven en las
  Propiedades del script de Apps Script. La URL del endpoint no es secreta y puede ir en `config.js`.
- **Sin frameworks ni build.** HTML, CSS y JavaScript sin dependencias, para que se sirva tal cual en GitHub Pages.
- **No romper la v1.** En Apps Script, `doGet` y los archivos existentes (`Codigo.gs`, `Registros.gs`,
  `Prompt.gs`, `Validacion.gs`, `Index.html`, `Pruebas.gs`) no se modifican en esta fase. Lo nuevo va en
  archivos nuevos.
- **No añadir funciones no pedidas.** Si algo parece útil, se propone, no se implementa.
- Peticiones al backend: `fetch` POST con `Content-Type: text/plain` (evita el preflight de CORS) y
  `redirect: 'follow'` (Apps Script responde con una redirección).
- Interfaz en español. Comentarios del código en español, breves.

## Contrato de la API (fase 6.1)
Petición: un único `doPost` (en `backend/Api.gs`) que enruta por `accion`. Cuerpo JSON enviado como texto plano:
```json
{ "t": "<token>", "accion": "dictar", ...parámetros }
```
| `accion` | Parámetros | Llama a (v1, sin modificar) | Devuelve (además de `ok: true`) |
|---|---|---|---|
| `dictar` | `audio`, `mime`, `modelo?`, `corrige?: {frase, anterior}` | `transcribir_` + `interpretar` | la propuesta de `interpretar` (`bloqueado`, `destino`, `datos`, `errores`, `avisos`, `preguntas`, `supuestos`, `interpretacion`, `frase`) + `texto`, `modelo`, `ms_groq`, `ms_interpretar` |
| `interpretar` | `frase`, `correccion?: {anterior, texto}` | `interpretar` | la propuesta (con `ms`) |
| `guardar` | `interpretacion`, `frase` | `guardar` | `hoja`, `id`, `datos` |
| `deshacer` | — | `deshacer` | `desc` |
| `transcribir` | `audio`, `mime`, `modelo?` | `transcribir_` | `texto`, `modelo`, `ms_groq` |
| `registros` | — | `listarRegistros` | `recurrentes`, `movimientos`, `categorias`, `hoy` |
| `editar` | `hoja`, `id`, `cambios` | `editarRegistro` | `desc` |
| `baja` | `id`, `fecha_fin` | `darDeBaja` | `desc` |
| `eliminar` | `hoja`, `id` | `eliminarRegistro` | `desc` |

- En `dictar` con `corrige`, lo dictado es el cambio pedido y `frase` es la frase original (así lo espera `interpretar`).
- `ms_interpretar` incluye leer el contexto de la hoja + Haiku + validación.

Errores: `{ "ok": false, "error": "...", "mensaje"?: "..." }`
- `token`, `entrada` (JSON roto, acción desconocida, audio/mime/modelo no válidos), `groq`.
- `rechazado`: regla de negocio de la v1 (lanza `Error` con un mensaje pensado para el usuario) → se devuelve `mensaje`.
- `llm`: falló la llamada a Anthropic (el mensaje de la v1 lleva texto de la API) → sin mensaje.
- `interno`: cualquier otra excepción → sin mensaje.

Reglas:
- El servidor comprueba el token **antes** de hacer nada más, con `tokenValido_` de la v1.
- Solo puede haber un `doPost` y un `respuesta_` en todo el proyecto de Apps Script (espacio global compartido).
- `modelo` solo admite `whisper-large-v3` (por defecto) o `whisper-large-v3-turbo` (lista blanca en el servidor).
- Rechazar audio vacío o de más de ~3 MB en base64.
- Groq: `https://api.groq.com/openai/v1/audio/transcriptions`, multipart (`UrlFetchApp` lo monta solo si el
  payload es un objeto con un Blob), `language: 'es'`, `response_format: 'json'`, cabecera
  `Authorization: Bearer <GROQ_API_KEY>`, `muteHttpExceptions: true`. El nombre del archivo debe llevar
  extensión acorde al mime (`audio.mp4`, `audio.webm`).
- Los errores nunca devuelven claves, trazas ni el cuerpo de la respuesta de Groq o Anthropic.
- El cliente pinta todo lo que viene del modelo con `textContent`, nunca con `innerHTML`.

## Estructura del repo
```
index.html              página (en 6.1: dictar → vista previa → guardar / corregir / deshacer)
app.js                  lógica del cliente
config.js               URL del endpoint de Apps Script (no secreta)
manifest.webmanifest    para instalarla como app (display: standalone)
backend/Api.gs          doPost (enrutador) y clasificación de errores; se copia a mano a Apps Script
backend/Transcribir.gs  transcribir_() con Groq; se copia a mano a Apps Script
CLAUDE.md               este archivo
README.md
```

## Estado actual
**Fase 6.0 — hecha.** El micrófono funciona en la app instalada (iOS pide permiso solo la primera vez),
Groq tarda ~0,5 s y el viaje completo ~3 s (el sobrecoste es Apps Script, no el modelo).
`whisper-large-v3` acertó más que turbo con la misma latencia → modelo por defecto.

**Fase 6.1 — API completa (en curso).** `doPost` como enrutador sobre las funciones de la v1; acción `dictar`
(audio → texto → interpretación en una sola petición) para no pagar dos veces el sobrecoste de Apps Script.
El cliente usa dictar, guardar, corregir por voz y deshacer; el panel "Mis registros" queda para la 6.3.
Fuera de alcance: el ajuste "Guardar directo" de la v1 y el fallo conocido del cambio de precio.

Fases siguientes (no implementar aún): 6.2 vocabulario para Whisper desde la hoja, 6.3 interfaz e icono,
6.4 evaluación con audios reales, 6.5 README de portfolio (con los resultados de cada fase).

## Forma de trabajar
- Antes de escribir código, presentar un plan breve y esperar confirmación.
- Commits pequeños con mensajes en español que digan qué y por qué.
- Al terminar una tarea, explicar qué se ha hecho y cómo probarlo.
