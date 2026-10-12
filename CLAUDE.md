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

## Contrato de la API (fase 6.0)
Petición (cuerpo JSON enviado como texto plano):
```json
{ "t": "<token>", "accion": "transcribir", "audio": "<base64 sin prefijo data:>",
  "mime": "audio/mp4", "modelo": "whisper-large-v3-turbo" }
```
Respuesta:
```json
{ "ok": true, "texto": "...", "modelo": "...", "ms_groq": 812 }
{ "ok": false, "error": "token" | "entrada" | "groq" | "interno" }
```
- El servidor comprueba el token (propiedad `TOKEN`) **antes** de hacer nada más.
- `modelo` solo admite `whisper-large-v3` o `whisper-large-v3-turbo` (lista blanca en el servidor).
- Rechazar audio vacío o de más de ~3 MB en base64.
- Groq: `https://api.groq.com/openai/v1/audio/transcriptions`, multipart (`UrlFetchApp` lo monta solo si el
  payload es un objeto con un Blob), `language: 'es'`, `response_format: 'json'`, cabecera
  `Authorization: Bearer <GROQ_API_KEY>`, `muteHttpExceptions: true`. El nombre del archivo debe llevar
  extensión acorde al mime (`audio.mp4`, `audio.webm`).
- Los errores nunca devuelven claves, trazas ni el cuerpo de la respuesta de Groq.

## Estructura del repo
```
index.html              página (en 6.0: prueba de concepto de grabación)
app.js                  lógica del cliente
config.js               URL del endpoint de Apps Script (no secreta)
manifest.webmanifest    para instalarla como app (display: standalone)
backend/Transcribir.gs  código del servidor; se copia a mano al proyecto de Apps Script
CLAUDE.md               este archivo
README.md
```

## Estado actual
**Fase 6.0 — prueba de concepto (spike).** Objetivo: demostrar que (1) el micrófono funciona con la app
instalada en la pantalla de inicio del iPhone, (2) el audio llega a Apps Script y (3) vuelve la
transcripción de Groq, midiendo el tiempo. Nada de diseño todavía: la interfaz es mínima y funcional.

Fases siguientes (no implementar aún): 6.1 API completa, 6.2 vocabulario para Whisper desde la hoja,
6.3 interfaz e icono, 6.4 evaluación con audios reales, 6.5 README de portfolio.

## Forma de trabajar
- Antes de escribir código, presentar un plan breve y esperar confirmación.
- Commits pequeños con mensajes en español que digan qué y por qué.
- Al terminar una tarea, explicar qué se ha hecho y cómo probarlo.
