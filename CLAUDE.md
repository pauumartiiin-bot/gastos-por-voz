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

## Contrato de la API (fases 6.1–7)
Petición: un único `doPost` (en `backend/Api.gs`) que enruta por `accion`. Cuerpo JSON enviado como texto plano:
```json
{ "t": "<token>", "accion": "dictar", ...parámetros }
```
| `accion` | Parámetros | Llama a (v1, sin modificar) | Devuelve (además de `ok: true`) |
|---|---|---|---|
| `dictar` | `audio`, `mime`, `modelo?`, `vocabulario?`, `corrige?: {frase, anterior}` | `transcribir_` + `interpretar` | la propuesta de `interpretar` (`bloqueado`, `destino`, `datos`, `errores`, `avisos`, `preguntas`, `supuestos`, `interpretacion`, `frase`) + `texto`, `modelo`, `vocabulario`, `ms_vocabulario`, `ms_groq`, `prob_sin_voz`, `ms_interpretar` |
| `interpretar` | `frase`, `correccion?: {anterior, texto}` | `interpretar` | la propuesta (con `ms`) |
| `guardar` | `interpretacion`, `frase` | `guardar` | `hoja`, `id`, `datos` |
| `deshacer` | — | `deshacer` | `desc` |
| `transcribir` | `audio`, `mime`, `modelo?`, `vocabulario?` | `transcribir_` | `texto`, `modelo`, `vocabulario`, `ms_vocabulario`, `ms_groq`, `prob_sin_voz` |
| `registros` | — | `listarRegistros` | `recurrentes`, `movimientos`, `categorias`, `hoy` |
| `editar` | `hoja`, `id`, `cambios` | `editarRegistro` | `desc` |
| `baja` | `id`, `fecha_fin` | `darDeBaja` | `desc` |
| `eliminar` | `hoja`, `id` | `eliminarRegistro` | `desc` |
| `mes` | `etiqueta?` (sin ella, el mes por defecto) | `mes_` (nuevo, `backend/Mes.gs`) con `libro_` y `conBloqueo_` | `etiqueta`, `mes_inicio`, `por_defecto`, `meses`, `cabecera`, `categorias`, `cuadra`, `ms` (detalle en «Fase 7») |

- En `dictar` con `corrige`, lo dictado es el cambio pedido y `frase` es la frase original (así lo espera `interpretar`).
- `ms_interpretar` incluye leer el contexto de la hoja + Haiku + validación.
- `vocabulario` (por defecto `false`; solo se usa si llega `true`): se envía a Whisper como `prompt` un texto con conceptos y categorías de la hoja
  (`backend/Vocabulario.gs`, caché de 1 h, máx. 600 caracteres ≈ 224 tokens). Prioridad: reglas activas →
  últimos 50 movimientos → categorías. Si falla la lectura, se transcribe sin vocabulario (`vocabulario: false`).
  El prompt de Whisper no es de instrucciones: es texto de contexto cuya ortografía y formato imita.
- Silencio: se pide `verbose_json` y se descartan los segmentos con `no_speech_prob` > 0,3; un texto sin letras
  cuenta como vacío. Si queda vacío, `dictar` responde `rechazado` ("No se ha entendido nada en el audio.") con
  `prob_sin_voz`. `prob_sin_voz` = máxima `no_speech_prob` de los segmentos, o `null` si Groq no la da
  (se mantiene: el umbral quedó en el límite en la 6.4 y conviene seguir midiendo).

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
  payload es un objeto con un Blob), `language: 'es'`, cabecera
  `Authorization: Bearer <GROQ_API_KEY>`, `muteHttpExceptions: true`, `response_format: 'verbose_json'`. El nombre del archivo debe llevar
  extensión acorde al mime (`audio.mp4`, `audio.webm`).
- Los errores nunca devuelven claves, trazas ni el cuerpo de la respuesta de Groq o Anthropic.
- El cliente pinta todo lo que viene del modelo con `textContent`, nunca con `innerHTML`.

## Estructura del repo
```
index.html              página: token, dictar (vista previa → guardar / corregir / deshacer), mes, mis registros, ajustes
styles.css              estilos; colores como variables CSS para tema claro y oscuro
app.js                  lógica del cliente (tema, vistas, detección de silencio, llamadas a la API)
config.js               URL del endpoint de Apps Script (no secreta)
manifest.webmanifest    para instalarla como app (display: standalone)
icons/                  icono.svg (fuente) y PNG 180/192/512 generados a partir de él
backend/Api.gs          doPost (enrutador) y clasificación de errores; se copia a mano a Apps Script
backend/Transcribir.gs  transcribir_() con Groq; se copia a mano a Apps Script
backend/Vocabulario.gs  vocabulario de la hoja para Whisper (con caché); se copia a mano a Apps Script
backend/Evaluacion.gs   evaluación 6.4 con audios de Drive (se ejecuta desde el editor); se copia a mano
backend/Mes.gs          acción mes (fase 7): lee el mes de la hoja y restaura Resumen!B1; se copia a mano
docs/                   capturas del README (generadas con datos inventados)
CLAUDE.md               este archivo
README.md               README de portfolio (fase 6.5)
```

## Diseño (fase 6.3)
- Paleta "Lavanda y ciruela". Claro: fondo crema `#F4EEE4`, tarjeta `#FAF6EF`, principal `#5A4A8C`,
  acento `#8C3A55`. Oscuro: fondo berenjena `#15121F`, tarjeta `#201B2E`, principal `#A99BE0`, acento `#E28AA5`.
  Todos los colores viven como variables en `styles.css` (`:root` y `:root[data-tema="oscuro"]`); no se
  escriben colores sueltos en el HTML ni en el JS.
- Tema: por defecto el del sistema; el botón luna/sol lo fija y se guarda en `localStorage` (`gastos_tema`).
- Estilo: botón de grabar e importe con degradado principal → acento, tarjeta con borde degradado, halos de
  fondo al 40 %. Tipografía Manrope (Google Fonts) con la del sistema como respaldo.
- Icono: "euro que suena" en vino con degradado y onda lavanda. iOS exige PNG cuadrado sin esquinas
  (aplica su propia máscara); el `€` va dibujado como trazos para no depender de una fuente.
- Silencio en el cliente: la Web Audio API mide el volumen (RMS) mientras se graba; si el máximo no supera
  `UMBRAL_VOZ` (0,02) no se envía nada. El filtro del servidor (`no_speech_prob`) sigue como segunda red.
- Modo pruebas (interruptor en Ajustes, `gastos_pruebas`): muestra modelo, vocabulario, volumen máximo,
  tiempos y prob. sin voz. Fuera de él el cliente no envía `modelo` ni `vocabulario` (valores del servidor).
  Se mantiene tras la 6.4 para seguir midiendo en uso real.
- Deshacer: una sola notificación flotante sobre la barra, común a Dictar y Mis registros (el servidor solo
  deshace la última acción). Se oculta a los 8 s (`MS_NOTIFICACION`).

## Estado actual
**Fase 6.0 — hecha.** El micrófono funciona en la app instalada (iOS pide permiso solo la primera vez),
Groq tarda ~0,5 s y el viaje completo ~3 s (el sobrecoste es Apps Script, no el modelo).
`whisper-large-v3` acertó más que turbo con la misma latencia → modelo por defecto.

**Fase 6.1 — hecha.** `doPost` como enrutador sobre las funciones de la v1; acción `dictar`
(audio → texto → interpretación en una sola petición). Probado: guardar, deshacer, preguntas, corrección por voz,
silencio y la v1 intacta. Latencia real 5,7–7,6 s: `ms_interpretar` 2,6–3,9 s (más que los ~1,6 s de
`evaluarCerebro`; hipótesis: leer la hoja), Groq ~0,5 s, resto ~2,5 s. Haiku entiende transcripciones
imperfectas ("Son 13'99" → 13,99 €). Fuera de alcance: "Guardar directo" y el fallo del cambio de precio.

**Fase 6.2 — hecha.** Resultados (1 intento por celda, orientativos):
leer la hoja cuesta ~720 ms (47 ms con caché) → también está dentro de `ms_interpretar`, que lee la hoja en
cada dictado. El vocabulario ayudó a turbo (3/3) pero empeoró a large-v3 (1/3: se come palabras que están
en el vocabulario, p. ej. "Claude"); large-v3 sin vocabulario 3/3 → **por defecto, sin vocabulario**.
Whisper alucina ante el silencio ("Gracias por ver el video") con y sin vocabulario → filtro por
`no_speech_prob` + texto sin letras. Medido: voz real 0,01–0,06, silencios alucinados 0,38–0,55 → umbral
0,3 (el 0,6 habitual no los paraba; ruido sí filtrado); revalidado: silencios 0,67–0,77 descartados.
Pendiente para la 6.4: vocabulario solo con nombres propios y revisar el umbral con más datos.

**Fase 6.3a — hecha.** Diseño final, temas, icono, pantalla del token, detección de silencio en el cliente y
modo pruebas. Volumen máx. medido en el iPhone: silencio 0,007–0,008, voz baja 0,086, voz normal 0,222 →
`UMBRAL_VOZ` 0,02 se mantiene (separación ×10, más limpia que `no_speech_prob`).

**Fase 6.3b — "Mis registros" — hecha.** Lista de recurrentes y últimos 20 gastos (`registros`); al tocar
uno se despliega su editor: importe y categoría (`editar`, en recurrentes "Corrección" o "Cambio de precio
desde"), "Dar de baja" con fecha (`baja`) y "Eliminar" (`eliminar`). Baja y eliminar piden un segundo toque;
cada acción muestra Deshacer y recarga la lista. Sin cambios en Apps Script.

**Fase 6.4 — evaluación con audios reales — hecha.** 30 audios grabados una vez (Notas de voz → carpeta
de Drive, propiedad `CARPETA_EVALUACION`) y pasados por 6 configuraciones: 2 modelos × vocabulario
(ninguno, completo de la hoja, solo nombres propios). `evaluarAudios()` (`backend/Evaluacion.gs`) sigue el
camino de un dictado con el contexto controlado de `evaluarCerebro` y no guarda gastos; escribe en las
pestañas "Evaluación" y "Evaluación resumen" y se puede relanzar si se agota el tiempo (sigue donde lo dejó).
Grupos: A fáciles, B números hablados, C marcas, D fechas y frecuencias, E ambiguas (deben preguntar),
F silencio/ruido (deben rechazarse), G condiciones reales.
Resultados (1 pasada por configuración; aciertos · marca bien escrita · alucinaciones en F):

| Configuración | Aciertos | Marca | Alucinaciones |
|---|---|---|---|
| large-v3 · ninguno | 25/30 | 19/25 | 0/2 |
| large-v3 · completo | 16/30 | 17/25 | 2/2 |
| large-v3 · propios | 21/30 | 18/25 | 1/2 |
| turbo · ninguno | 24/30 | 22/25 | 2/2 |
| turbo · completo | 24/30 | 22/25 | 2/2 |
| turbo · propios | 25/30 | 24/25 | 2/2 |

- **Decisión: large-v3 sin vocabulario, umbral 0,3 (sin cambios de código).** Empata arriba, es la única
  en la que el filtro de silencio funciona y no tiene errores silenciosos.
- Modo de fallo, no solo acierto: los 5 ❌ de large-v3 sin vocabulario son 2 preguntas razonables (09, 17),
  2 marcas mal escritas visibles en la vista previa ("Vindet", "Globo") y 1 voz real rechazada (15).
  **0 errores silenciosos** (dato erróneo guardado sin pregunta). Los únicos aparecen con vocabulario en
  large-v3 (se come el "ayer" en 03, 09, 14).
- large-v3 borra justo las palabras del vocabulario ("Spotify 10,99" → "10,99 € al mes"; también Mercadona,
  Wallapop, Gasolina, Barbero, Creatina): confirma la 6.2. El vocabulario queda en el código, apagado.
- Turbo da `no_speech_prob` 0,0 siempre, incluso al alucinar ("Gracias por ver el video"; con vocabulario
  de nombres propios escribe "Gastos", la primera palabra del prompt) → ningún umbral lo filtra. Descartado
  pese a escribir mejor las marcas (24/25).
- Umbral en el límite (large-v3 sin vocabulario): silencio 0,99, ruido 0,34, voz real 0,00–0,24 salvo una
  a 0,39 (rechazada). Se deja en 0,3: repetir una frase es mejor que un gasto inventado.
- El "ruido" del audio 27 tenía voces de fondo: turbo las transcribió ("…de Barajas a Lucero"). Whisper no
  sabe quién habla; la última red es Haiku (sin importe, bloquea).
- Fallos comunes a todas las configuraciones (no son de Whisper): "diecinueve noventa y nueve" → 1999
  (Haiku pregunta; decir "con" lo evita, el caso 10 sale siempre), Glovo → "Globo" incluso con vocabulario,
  y Decathlon/Vinted → Haiku pregunta la categoría (legítimo; se arreglaría con datos en Categorías).
- `ms_interpretar` sin leer la hoja ~1,8 s frente a 2,6–3,9 s en la app → leer la hoja cuesta ~1 s.
  `ms_groq` ~400 ms en todas: la latencia no distingue modelos.

**Fase 6.5 — README de portfolio — hecha.** Problema, cómo funciona (diagrama Mermaid), evaluación
con modo de fallo, decisiones, latencia, seguridad, limitaciones, "Qué he aprendido" y puesta en
marcha. El código de la v1 no está publicado: se explica en una línea. **Con esto, la v2 queda cerrada.**

**Fase 7 — en curso.** Pestaña «Mes» (v2.1); detalle en la sección «Fase 7».
- **7.1 — hecha.** `probarMes()` en Apps Script: noviembre 1.239 € · restante 131 · `cuadra` ✅, coincide con el
  Resumen; mes por defecto octubre (mes en curso); etiqueta inventada → `entrada`; B1 restaurado; 893 ms.
  Las reglas semanales salen con `fecha_cargo: null` (la hoja no les calcula fecha): revisar la clave
  `id` + `fecha_cargo` en la fase 8.
- **7.2 — en curso.** Pestaña en la barra (Dictar · Mes · Mis registros). Las reglas de tipo «presupuesto» se
  pintan como barra, no como línea. Respuestas desordenadas: solo vale la última petición (`peticionMes`).
  Sin caché: cada flecha es una petición. En modo pruebas, al pie: `ms` y `cuadra`.

## Fase 7 — Pestaña «Mes» (v2.1)

### Objetivo
Una pestaña nueva, «Mes», entre «Dictar» y «Mis registros», que enseña el mes elegido:
cabecera (ingreso, previsto, restante), gastos agrupados por categoría y, en las categorías con
presupuesto (Ocio, Comida), una barra con lo gastado y lo que queda. Es de **solo lectura**.

### Alcance
**Entra:** pestaña «Mes»; mes por defecto según la nómina apuntada; flechas ‹ › y botón «Hoy»;
acción `mes` en la API; evaluación con 3 meses.
**No entra:** marcar pagos como hechos (fase 8, semana 4; la estructura se deja preparada, pero sin casilla);
añadir ingresos desde la app (se hace en la pestaña Ingresos de la hoja); editar desde la tabla (se hace
en «Mis registros»); un botón «Añadir a este mes» (no hace falta: un gasto dictado con fecha, por ejemplo
«250 euros tratamiento, 25 de enero de 2028», ya se guarda en Movimientos con esa fecha y sale en ese mes;
el validador acepta hasta 730 días en el futuro); cambios en el prompt o en archivos de la v1.

### Datos de partida (hoja, v2.1)
- `Meses`: `Mes_inicio` (A), `Etiqueta` (B), `Ingreso_previsto` (C). Etiqueta = "Noviembre 2026 (nómina de octubre)".
- `Ingresos`: `ID, Fecha, Mes, Concepto, Tipo, Importe, Notas, Registrado`. `Mes` es una etiqueta de `Meses`;
  `Tipo` ∈ nómina | comisiones | extra.
- `Resumen`: B1 = etiqueta del mes elegido (desplegable); B2/B3 inicio y fin; B4 ingreso del mes; B5 total previsto;
  B6 restante; E4 previsto; E5 cobrado; E6 "previsto" | "cobrado". Tabla por categoría en filas 10–129:
  A nombre, B fijos, C presupuesto, D gastos puntuales, E total previsto, F presupuesto disponible,
  G = "cat" (fila de categoría) | "det" (detalle). Fila 130 = totales.
- `Cálculo` (fila 2 en adelante): A ID, B Concepto, C Categoría, D Tipo, N Fecha_cargo, O Veces_en_mes,
  P Importe_en_mes. Se calcula para el mes de `Resumen!B1`.
- `Movimientos`: A ID, B Fecha, C Concepto, D Importe, E Categoría.
- Total de una categoría = Fijos + MAX(Presupuesto, Puntuales). Disponible = MAX(0, Presupuesto − Puntuales).

### Arquitectura: A+ («leer y restaurar»)
Las fórmulas de la hoja son la única fuente de verdad: la app no recalcula nada.
`mes_` (archivo nuevo `backend/Mes.gs`), dentro de `conBloqueo_` (v1, `Registros.gs`):
1. Guarda el valor actual de `Resumen!B1`.
2. Escribe la etiqueta pedida en B1 y llama a `SpreadsheetApp.flush()`.
3. Lee: Resumen B2:B6 y E4:E6, las filas "cat" de A10:G129, las filas de `Cálculo` con ID y `Veces_en_mes` > 0,
   y los `Movimientos` con fecha entre B2 y B3.
4. En un `finally`: vuelve a poner el B1 original y llama a `flush()`. Aunque algo falle, B1 queda como estaba.

Acoplamiento a tener en cuenta: `Mes.gs` depende de las posiciones de esas celdas. Si se cambia el Resumen, hay que revisar `Mes.gs`.

### Mes por defecto (se calcula en el servidor)
- `actual` = etiqueta de `Meses` cuyo `Mes_inicio` es el día 1 del mes de hoy (zona horaria de la hoja).
- `siguiente` = la etiqueta de la fila siguiente.
- Si en `Ingresos` hay alguna fila con `Mes` = `siguiente` y `Tipo` = "nómina" → por defecto `siguiente`; si no, `actual`.
  Motivo: cobro la última semana del mes y sigo gastando el mes en curso hasta entonces. El cambio lo provoca
  un dato real (haber apuntado la nómina), no una fecha fija. Las comisiones y los extras no lo cambian.

### Contrato de la acción `mes`
Petición: `{ "t": token, "accion": "mes", "etiqueta"?: "Noviembre 2026 (nómina de octubre)" }`.
Sin `etiqueta` → mes por defecto. Etiqueta que no está en `Meses` → error `entrada`.

Respuesta (además de `ok: true`):
```json
{
  "etiqueta": "Noviembre 2026 (nómina de octubre)",
  "mes_inicio": "2026-11-01",
  "por_defecto": "Octubre 2026 (nómina de septiembre)",
  "meses": ["Octubre 2026 (nómina de septiembre)", "Noviembre 2026 (nómina de octubre)", "…"],
  "cabecera": { "ingreso": 1370, "previsto_ingreso": 1370, "cobrado": 0, "origen": "previsto",
                "total_previsto": 1239, "restante": 131 },
  "categorias": [
    { "nombre": "Financiación", "fijos": 468, "presupuesto": 0, "puntuales": 0, "total": 468, "disponible": 0,
      "reglas": [ { "id": "R009", "concepto": "Shein (x3)", "tipo": "fijo", "importe": 67,
                    "fecha_cargo": "2026-11-01", "veces": 1 } ],
      "movimientos": [] }
  ],
  "cuadra": true,
  "ms": 1400
}
```
- `categorias`: en el orden del Resumen; solo las que tienen `total` > 0 o algún movimiento.
- `reglas[].importe` = `Importe_en_mes` (ya multiplicado por `veces`, por ejemplo semanal × 4).
- `movimientos`: `{ id, fecha, concepto, importe }` del mes, por fecha.
- Fechas siempre como texto "yyyy-MM-dd" con la zona horaria de la hoja (lección de la v1: un objeto `Date` mueve el día).
- `cuadra` = suma de `categorias[].total` igual a `total_previsto` (redondeado a 2 decimales). Es el control de la evaluación.
- Errores: los de siempre (`token`, `entrada`, `interno`). Nunca devuelve trazas.
- En `Api.gs`, una línea: `mes: (p) => mes_(p)`. El token ya lo comprueba `doPost`.
- `id` + `fecha_cargo` identifican una línea del mes: será la clave para marcar «pagado» en la fase 8.

### Interfaz (pestaña «Mes»)
- Barra inferior: Dictar · **Mes** · Mis registros (icono de calendario, mismo estilo SVG).
- Cabecera (tarjeta): ‹ etiqueta › y botón «Hoy» (solo visible si no estás en `por_defecto`). Tres cifras:
  Ingreso (con la etiqueta «previsto» o «cobrado»), Previsto y **Restante** (grande; con el color de acento si es negativo).
- Una tarjeta por categoría: nombre y total. Dentro:
  - reglas: concepto · fecha corta («1 nov») · importe; si `veces` > 1, «× 4»;
  - si `presupuesto` > 0: barra gastado / presupuesto con «30 de 100 € · quedan 70 €»; si se pasa,
    «te has pasado 12 €» con el color de acento;
  - movimientos del mes debajo (concepto · fecha · importe).
- Cada línea de regla lleva `data-id` y `data-fecha` (preparado para la fase 8, sin casilla todavía).
- Mes vacío: «Este mes no tiene gastos previstos.» Estado de carga mientras llega la respuesta.
- Al abrir la pestaña: petición sin `etiqueta` (mes por defecto). Flechas: etiqueta anterior o siguiente de `meses`
  (desactivadas en los extremos).
- Paleta y variables de `styles.css` (sin colores sueltos), claro y oscuro, textos con `textContent`.
- Sube `?v=` a 7.x en `index.html` en cada cambio de `app.js`, `config.js` o `styles.css`.

### Subfases
- **7.1 Backend:** `backend/Mes.gs` + línea en `Api.gs` + `probarMes()` (desde el editor, sin la app).
  Después: copiar a Apps Script y **Nueva versión sobre el mismo despliegue** (la URL no cambia).
- **7.2 Interfaz:** pestaña «Mes» en `index.html`, `app.js` y `styles.css`.
- **7.3 Evaluación:** `probarMes()` recorre 3 meses elegidos a propósito y registra `cuadra`, el total y las reglas.
  Con `Movimientos` vacío, los totales esperados son:

| Mes | Total esperado | Por qué este mes |
|---|---|---|
| Noviembre 2026 | 1.239 € | Todo activo: Klarna (último mes), T Jove y Creatina |
| Enero 2027 | 1.115 € | Última cuota de Shein; sin Klarna ni T Jove; con Creatina |
| Febrero 2027 | 1.049 € | Sin Shein ni Creatina; vuelve T Jove (cada 3 meses) |

  Además: tras la prueba, `Resumen!B1` sigue en el mes que había (comprueba la restauración). En el iPhone,
  noviembre muestra lo mismo que el Resumen.

## Forma de trabajar
- Antes de escribir código, presentar un plan breve y esperar confirmación.
- Commits pequeños con mensajes en español que digan qué y por qué.
- Cada cambio en `app.js`, `config.js` o `styles.css` sube su `?v=` en `index.html` (evita la caché de iOS).
- Al terminar una tarea, explicar qué se ha hecho y cómo probarlo.
