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

## Contrato de la API (fases 6.1–14)
Petición: un único `doPost` (en `backend/Api.gs`) que enruta por `accion`. Cuerpo JSON enviado como texto plano:
```json
{ "t": "<token>", "accion": "dictar", ...parámetros }
```
| `accion` | Parámetros | Llama a (v1, sin modificar) | Devuelve (además de `ok: true`) |
|---|---|---|---|
| `dictar` | `audio`, `mime`, `modelo?`, `vocabulario?`, `corrige?: {frase, anterior}` | `transcribir_` + `interpretar` | la propuesta de `interpretar` (`bloqueado`, `destino`, `datos`, `errores`, `avisos`, `preguntas`, `supuestos`, `interpretacion`, `frase`) + `texto`, `modelo`, `vocabulario`, `ms_vocabulario`, `ms_groq`, `prob_sin_voz`, `ms_interpretar`, `ms_servidor` |
| `interpretar` | `frase`, `correccion?: {anterior, texto}` | `interpretar` | la propuesta (con `ms`) |
| `guardar` | `interpretacion`, `frase` | `guardar` | `hoja`, `id`, `datos` |
| `deshacer` | — | `deshacer` | `desc` |
| `transcribir` | `audio`, `mime`, `modelo?`, `vocabulario?` | `transcribir_` | `texto`, `modelo`, `vocabulario`, `ms_vocabulario`, `ms_groq`, `prob_sin_voz` |
| `registros` | — | `listarRegistros` | `recurrentes`, `movimientos`, `categorias`, `hoy` |
| `editar` | `hoja`, `id`, `cambios` | `editarRegistro` | `desc` |
| `baja` | `id`, `fecha_fin` | `darDeBaja` | `desc` |
| `eliminar` | `hoja`, `id` | `eliminarRegistro` | `desc` |
| `mes` | `etiqueta?` (sin ella, el mes por defecto) | `mes_` (nuevo, `backend/Mes.gs`) con `libro_` y `conBloqueo_` | `etiqueta`, `mes_inicio`, `por_defecto`, `meses`, `cabecera` (con `desglose`, fase 14), `categorias`, `cuadra`, `ingresos`, `ms` (detalle en «Fase 7», «Fase 12» y «Fase 14») |
| `categoria` | `nombre`, `descripcion` | `crearCategoria_` (nuevo, `backend/Categorias.gs`) con `libro_`, `conBloqueo_`, `normalizar` y `apuntarDeshacer_` | `nombre`, `desc`, `huecos_libres` (detalle en «Fase 7b») |
| `renombrar` | `hoja` (`Recurrentes` \| `Movimientos`), `id`, `concepto` | `renombrar_` (nuevo, `backend/Renombrar.gs`) con `libro_`, `conBloqueo_`, `buscarFilaPorId_`, `COL`/`COLM` y `apuntarDeshacer_` | `id`, `concepto`, `desc` (detalle en «Fase 8») |
| `pagar` | `etiqueta`, `id` (regla R… o gasto puntual M…), `pagado` (`true` \| `false`) | `pagar_` (nuevo, `backend/Pagos.gs`) con `libro_`, `conBloqueo_`, `buscarFilaPorId_`, `COL` y `COLM` | `etiqueta`, `id`, `pagado`, `pagado_el` (detalle en «Fase 8» y «Fase 11») |
| `ingresos` | — | `ingresos_` (nuevo, `backend/Ingresos.gs`) con `libro_` y `normalizar` | `hoy`, `meses` (`etiqueta`, `inicio`, `previsto`, `previsto_comisiones`, `nomina`, `periodo_inicio`, `periodo_fin`), `ingresos` (últimos 20) (detalle en «Fase 9», «Fase 13» y «Fase 14») |
| `ingreso` | `tipo`, `importe`, `fecha`, `mes`, `concepto?` | `apuntarIngreso_` (nuevo) con `conBloqueo_`, `siguienteId_`, `escribirFila_`, `fechaSerial_`, `ahoraSerial_` y `apuntarDeshacer_` | `id`, `desc`, `ingreso` |
| `borrar_ingreso` | `id` | `borrarIngreso_` (nuevo) con `conBloqueo_`, `buscarFilaPorId_`, `aJSON_` y `apuntarDeshacer_` | `id`, `desc` |
| `previsto` | `etiqueta`, `tipo` (`comisiones`), `importe` (≥ 0; 0 lo quita) | `previsto_` (nuevo, `backend/Previstos.gs`) con `libro_`, `conBloqueo_` y `mes_` | `etiqueta`, `tipo`, `anterior`, `importe`, `mes` (el mes ya recalculado; detalle en «Fase 14») |

- En `dictar` con `corrige`, lo dictado es el cambio pedido y `frase` es la frase original (así lo espera `interpretar`).
- `ms_interpretar` incluye leer el contexto de la hoja + Haiku + validación.
- Fase 13: en `mes`, los `movimientos` son los del **periodo** del mes (Resumen E2:E3, de Meses E:F), no los del mes
  natural; las reglas siguen por mes natural (B2:B3). `pagar` acepta un puntual si su fecha está en el periodo.
- `ms_servidor` (fase B.1): de la entrada a la salida de `doPost`. Lo lleva toda respuesta de `dictar`, también el
  `rechazado` por silencio; el resto de acciones no.
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
index.html              página: token, crear (dictar → vista previa → guardar / corregir / deshacer, y nuevo gasto, ingreso o categoría), mes, mis registros, ajustes
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
backend/Categorias.gs   acción categoria (fase 7b): crea una categoría antes de «Otros»; se copia a mano
backend/Renombrar.gs    acción renombrar (fase 8.1): cambia el concepto de un gasto; se copia a mano
backend/Pagos.gs        acción pagar (fases 8.2 y 11.1): marca cargos fijos y gastos puntuales en la pestaña Pagos; se copia a mano
backend/Ingresos.gs     acciones ingresos, ingreso y borrar_ingreso (fase 9.1); se copia a mano
backend/Latencia.gs     medirLatencia() (fase B.1): cronometra libro_, leerContexto_ e interpretar; se copia a mano
backend/Migraciones.gs  cambios en la hoja de cada fase (aplicarFase13, aplicarFase14), se ejecutan una vez desde el editor; se copia a mano
backend/Previstos.gs    acción previsto (fase 14): comisiones previstas de un mes (Meses D); se copia a mano
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
- Silencio: solo lo filtra el servidor (`no_speech_prob`). El medidor de volumen del cliente (Web Audio, `UMBRAL_VOZ`)
  se quitó en la 7b.4 porque en iOS degradaba la grabación; las barras de nivel solo ondean mientras graba (CSS).
- Modo pruebas (interruptor en Ajustes, `gastos_pruebas`): muestra modelo, vocabulario,
  tiempos y prob. sin voz. Fuera de él el cliente no envía `modelo` ni `vocabulario` (valores del servidor).
  Se mantiene tras la 6.4 para seguir midiendo en uso real.
- Deshacer: una sola notificación flotante sobre la barra, común a Crear, Mes y Mis registros (el servidor solo
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

**Fase 7 — hecha.** Pestaña «Mes» (v2.1); detalle en la sección «Fase 7».
- **7.1 — hecha.** `probarMes()` en Apps Script: noviembre 1.239 € · restante 131 · `cuadra` ✅, coincide con el
  Resumen; mes por defecto octubre (mes en curso); etiqueta inventada → `entrada`; B1 restaurado; 893 ms.
  Las reglas semanales salen con `fecha_cargo: null` (la hoja no les calcula fecha): revisar la clave
  `id` + `fecha_cargo` en la fase 8.
- **7.2 — hecha.** Pestaña en la barra (Dictar · Mes · Mis registros). Las reglas de tipo «presupuesto» se
  pintan como barra, no como línea. Respuestas desordenadas: solo vale la última petición (`peticionMes`).
  Sin caché. En modo pruebas, al pie: `ms` y `cuadra`.
  7.2b (tras probarla en el iPhone): las flechas ya no se bloquean al cargar (con tres toques rápidos solo
  avanzaba uno); el título cambia en cada toque y la petición sale 300 ms después del último (`MS_ESPERA_MES`):
  una sola petición para el mes final. Comportamiento de app: sin zoom por doble toque ni pellizco
  (`touch-action: pan-x pan-y` y viewport `maximum-scale=1`), campos a 16 px (iOS amplía al escribir con menos),
  sin rebote (`overscroll-behavior: none`) ni selección o menú al mantener pulsado un botón.
  Probado en el iPhone: todo OK. Cambiar de mes: 2.516 ms en el servidor y ~3 s en total (con B1 ya en ese
  mes, 893 ms → escribir B1, recalcular y restaurar cuesta ~1,6 s). Caché de los meses ya vistos: fase 8.4.
- **7.3 — hecha.** `probarMes()` evalúa noviembre, enero y febrero (`MES_CASOS_`): `cuadra`, total esperado
  y reglas que deben estar o no (por ID). Si un mes tiene movimientos, un total distinto es ⚠️, no ❌.
  Resultado en Apps Script: **3/3 ✅** (1.239 · 1.115 · 1.049 €, con las reglas exactas de cada mes), etiqueta
  inventada ✅, B1 restaurado tras cuatro cambios ✅. Tiempos: noviembre 1.041 ms (B1 ya estaba en él),
  enero 1.528 ms, febrero 2.102 ms. README: sección «Pestaña "Mes"» y captura `docs/mes-claro.png`
  (datos inventados).

**Fase 7b — Crear categorías (v2.2) — hecha.** Detalle en la sección «Fase 7b».
- **7b.1 — hecha.** `backend/Categorias.gs` + línea en `Api.gs` + `probarCategorias()`. En Apps Script: 9 de 12
  huecos, validaciones 12/12, «Prueba 7b» creada antes de «Otros» y visible en el Resumen, duplicado rechazado,
  limpieza ✅ y `ULTIMO` intacto. Nueva versión del despliegue publicada.
- **7b.2 — hecha.** Barra: Crear · Mes · Mis registros (la vista sigue siendo `vista-dictar`). Debajo de la vista
  previa, `<details>` «+ Nueva categoría» con nombre (máx. 30), descripción (máx. 150) y «Crear categoría». El
  móvil solo avisa de nombre vacío o descripción corta; el resto lo decide el servidor y su mensaje sale dentro de
  la tarjeta sin borrar lo escrito. Al crear: notificación con Deshacer y «quedan N huecos»; la tarjeta se vacía y se
  pliega. Sin chips de categorías existentes (decidido).
  Probado en el iPhone (K1–K7 OK): «Aina» creada antes de «Otros», visible en el Resumen y con 2 huecos libres;
  sin zoom al escribir. **K7: «luz 30 euros al mes», dicho sin categoría, Haiku lo propuso en «Aina»** solo por
  la descripción → la descripción de la categoría funciona como instrucción para el modelo.
- **7b.3 — sustituida por la 7b.4: micrófono que solo funcionaba una vez.** En el iPhone, tras el primer dictado todos decían
  «No te he oído» hasta cerrar la app. Volumen máx. medido en el fallo: 0,009 (≈ ruido de fondo, no 0) → el medidor
  recibía señal pero no la voz. Arreglo: un `AudioContext` nuevo en cada grabación (creado en el toque y cerrado al
  terminar) en vez de reutilizar uno. Red de seguridad: si el medidor retiene la grabación, «Enviar igualmente» la
  manda y decide el filtro del servidor; además sirve de diagnóstico (si el servidor transcribe tu voz, fallaba
  solo el medidor; si no, el micrófono entero).
  Resultado en el iPhone: falló igual (solo funcionó 1 de 3), con volúmenes de 0,020 / 0,020 / 0,028 incluso hablando
  (la voz normal medía 0,222 en la 6.3a) → con Web Audio abierto, iOS baja el nivel de entrada del micrófono.
- **7b.4 — hecha: sin medidor en el cliente.** Se quita todo Web Audio (`AudioContext`, analizador, `UMBRAL_VOZ`,
  «Enviar igualmente» y «Volumen máx.»): la grabación queda solo con `getUserMedia` + `MediaRecorder`, como en la
  6.0, y todo dictado va al servidor, cuyo filtro `no_speech_prob` decide (6.4: silencio 0,99, 0 alucinaciones con
  large-v3). Las barras ondean con CSS mientras graba. Precio: un toque sin hablar tarda ~3 s en responder «No se ha
  entendido nada». Si aun así falla, el problema es del micrófono o la grabación, no del medidor. `?v=` 7.3.2.
  Probado en el iPhone (7.3.2): 4 de 4 dictados seguidos sin cerrar la app; un toque sin hablar → «No se ha
  entendido nada en el audio» con prob. sin voz 0,89. Culpable confirmado: Web Audio abierto durante la grabación.

**Fase 8 — Renombrar gastos y marcar pagos (v2.3) — hecha.** Detalle en la sección «Fase 8».
- **8.1 — hecha.** Renombrar gastos: `backend/Renombrar.gs` + línea en `Api.gs` + campo «Nombre» en Mis registros.
  `probarRenombrar()` en Apps Script: validaciones 9/9, renombrado real de R001 y limpieza ✅, `ULTIMO` intacto.
  En el iPhone (R5–R8 OK): renombrar, Deshacer, y el nombre nuevo de un recurrente sale en «Mes» y en el Resumen.
- **8.2 — hecha.** Marcar pagos (backend): `backend/Pagos.gs`, `Mes.gs` devuelve `pagado`/`pagado_el` y `pendiente`,
  línea en `Api.gs` y `probarPagos()`. En Apps Script: validaciones 4/4, marcar dos veces → 1 fila, el pendiente baja
  justo el importe (Máster, 180 €) y vuelve al desmarcar; limpieza ✅. Pendiente de noviembre 853 €, no 939: el R004
  (Aina, 86 €) ya no está en Recurrentes tras la migración de la 7b → los totales de `MES_CASOS_` (7.3) suponían el R004.
  `MES_CASOS_` actualizado: `probarMes()` dio 1.153 · 1.029 · 963 € (86 € menos cada mes) con `cuadra` ✅ y las reglas
  exactas de cada mes; pendiente de pagar 853 · 729 · 663.
- **8.3 — hecha.** Interfaz de pagos: casilla en cada cargo fijo, cabecera con «Pendiente de pagar» y memoria del mes.
  `?v=` 7.5.0. Probado en el iPhone (Q1–Q11 OK): marcar tocando el texto, fila en «Pagos» y borrada al desmarcar,
  tres toques rápidos → 1 fila, cada mes con sus pagos, memoria del mes y vuelta al mes por defecto al reabrir.
  Sin conexión, la casilla vuelve atrás con el aviso «… Load failed» (texto en inglés de Safari).
  Fallos de red: se deja el «Load failed» de Safari (decidido: se entiende).
- **8.4 — hecha.** Caché de meses ya vistos (*stale-while-revalidate*), solo en `app.js`. `?v=` 7.6.0.
  Probado en el iPhone (C1–C11 OK): mes nuevo ~3 s; ya visto, al instante con «Actualizando…» y luego «del servidor»;
  toques rápidos; marcar con una actualización en camino no se pisa; un gasto dictado aparece solo a los ~3 s; caché
  vacía al reabrir; sin conexión, se queda lo guardado con «No se ha podido actualizar». README: fila en Decisiones.

**Fase 9 — Ingresos desde la app (v2.4) — hecha.** Detalle en la sección «Fase 9».
- **9.1 — hecha.** Backend: `backend/Ingresos.gs` + tres líneas en `Api.gs` + `probarIngresos()`. En Apps Script:
  validaciones 14/14; nómina de prueba en el último mes (I001), «Mes» la cuenta como cobrada, sale en la lista, otra
  nómina rechazada, borrar y Deshacer de la v1 con la fecha intacta (2026-10-25); limpieza ✅.
- **9.2 — hecha.** Interfaz: tarjeta «+ Nuevo ingreso» en «Crear» y sección «Ingresos» en «Mis registros». `?v=` 7.7.0.
  Probado en el iPhone (N1–N11 OK, tras publicar la Nueva versión: sin ella, `ingresos` respondía `entrada` →
  «Petición no válida» y el desplegable vacío). Mes propuesto por el día 20, nómina apuntada → «cobrado» en «Mes» y el
  mes por defecto pasa a noviembre, nómina repetida rechazada, comisiones suman al ingreso, borrar y Deshacer con la
  fecha intacta. En la N3 el importe 1370 se quedó al pasar a «Comisiones» (`importeAuto` ya era `false`); el resto
  (concepto y aviso) bien. Pau decide dejarlo así. README: sección «Ingresos: un formulario, no un LLM» y dos filas
  en Decisiones.

**Fase 10 — Gasto con formulario (v2.5) — hecha.** Detalle en la sección «Fase 10». Solo interfaz: sin cambios en
Apps Script. `?v=` 7.8.0. Probado en el iPhone (G1–G12 OK): orden de las tarjetas, «Regalo Aina» en «Otros» (no en
«Aina») en Movimientos, Deshacer, campos de recurrente según la frecuencia, mensual cada 3 con fin en Recurrentes
(«Mensual · cada 3 meses» en Mis registros) y solo en su mes en «Mes», fecha de 2030 rechazada dentro de la tarjeta.
README: sección «Gasto con formulario: otro proponente, el mismo validador» y fila en Decisiones.

**Fase 11 — Gastos puntuales pagados o pendientes (v2.6) — hecha.** Detalle en la sección «Fase 11».
- **11.1 — hecha.** Backend: `Pagos.gs` (estado normal por tipo, columna Estado) y `Mes.gs` (`pagado` en los
  movimientos y el pendiente los incluye). `probarPagos()` en Apps Script: todo ✅ (cargo fijo, puntual de prueba que
  nace pagado, desmarcar sube el pendiente justo su importe, otro mes rechazado, limpieza). Nueva versión publicada.
- **11.2 — hecha (U8/U9 resueltas en la 11.3).** Interfaz: casillas en los puntuales de «Mes» y «Ya está pagado» en «+ Nuevo gasto».
  `?v=` 7.9.0. En el iPhone U1–U7, U10 y U11 OK. **U8/U9 ❌:** tras borrar un gasto pendiente de prueba (M002, octubre),
  su fila siguió en Pagos y el siguiente gasto de octubre, que la v1 volvió a numerar M002, salió pendiente. El parche
  del cliente (quitar la marca antes del Deshacer) estaba en el sitio equivocado: solo cubría un camino.
- **11.3 — hecha.** Limpieza de filas huérfanas en el servidor tras `eliminar` y `deshacer`; `limpiarPagos()` en el
  editor; fuera el parche del cliente. `?v=` 7.9.1. `probarPagos()` en Apps Script: todo ✅ y borró la huérfana real
  (M002, octubre). En el iPhone L2–L7 OK: Deshacer y eliminar en «Mis registros» ya no dejan filas, y el gasto
  siguiente con el mismo ID no hereda nada. README: «Marcar pagos» con los puntuales y las huérfanas, y dos filas en
  Decisiones.

**C — Zona horaria de la hoja — hecha.** Visto en la 11.3: la hoja estaba en «Hora del Pacífico» (8 h por detrás
de Madrid; la v1 usa `CONFIG.ZONA` para «Registrado»), así que «hoy» y el mes por defecto (`getSpreadsheetTimeZone` en
`Mes.gs` e `Ingresos.gs`) se habrían atrasado un día entre las 00:00 y las 08:00. Sin código: Pau la cambió a Madrid
(Archivo → Configuración). Z1–Z6 OK salvo Z3 (`probarMes` 1/3), que no era de la zona: las fechas se guardan sin hora y
no se movieron. Eran datos reales nuevos (R014, R016, R017: 81 €/mes; M001: 28 € en noviembre).
Arreglo de raíz en `probarMes`: el total pasa a ser una referencia (⚠️ si no coincide, nunca ❌); fallar solo es
no cuadrar o que falte o sobre una regla. Referencias actualizadas a 1.234 · 1.110 · 1.044 €. En Apps Script (Z3a–Z3f OK): 3/3 ✅, noviembre con ⚠️ 1.262 (por M001, 28 €), enero y febrero sin aviso, y «Mes» en la app
con el mismo 1.262 €. Cosmético: las marcas
`Marcado_el` anteriores al cambio (p. ej. M001, 11:48) quedan con 8 h de menos.

**Fase 12 — Ingresos en la cabecera de «Mes» (v2.7) — hecha.** Detalle en la sección «Fase 12». `?v=` 7.10.0.
En Apps Script (Nueva versión publicada): `probarIngresos()` 14/14 y todo ✅, incluida «Nómina 1234.56 + Comisiones 250 =
1484.56 · cobrado 1484.56», y limpieza ✅; `probarMes()` 3/3 ✅. En el iPhone E5–E10 OK: mes sin ingresos sin bloque,
nómina (100 €) y comisiones (50 €) de prueba en diciembre → 2 líneas y «cobrado 150 €», al instante desde la caché,
bien en oscuro, y al borrarlas en «Mis registros» el bloque desaparece. README: viñeta en «Ingresos».

**Fase B — Latencia del dictado — cerrada (B.1 hecha; B.2: no optimizar).** Detalle en la sección «Fase B». `dictar` devuelve
`ms_servidor` (Api.gs); el modo pruebas enseña «Audio enviado» (KB del base64), «Servidor» y «Red y arranque»
(total − `ms_servidor`). `medirLatencia()` (`backend/Latencia.gs`). `?v=` 7.11.0. Resultados (25 oct, noche):
- `medirLatencia()`: `libro_()` 1.ª 213 ms (luego 1–2); `leerContexto_()` 1.ª 200 ms (luego 96–130);
  `interpretar()` [2815, 1359, 2831, 1350, 6568] ms → Haiku muy variable (1,3–6,5 s). Abrir y leer en frío ≈ 413 ms.
- 10 dictados reales (2 tandas de 5; 1 y 6 en frío). Medianas: **total 4.627 ms** (4.131–5.672) · red y arranque
  1.980 (1.693–2.189) · interpretar 2.128 (1.578–3.039) · Groq 365 (328–670) · servidor 2.759 · resto de doPost 225
  (servidor − Groq − interpretar) · audio 103–151 KB.
- Lectura: la mediana se reparte en ~2,0 s de red y arranque (43 %), ~2,1 s de interpretar (46 %: ~0,4 s de leer la
  hoja + ~1,7 s de Haiku), ~0,4 s de Groq y ~0,2 s del resto. **Leer la hoja cuesta ~0,4 s, no ~1 s** (la cifra de la
  6.2/6.4 era una estimación indirecta). **Frío ≈ caliente** (2.189 y 2.034 ms frente a ~1.950): calentar no ayuda.
  Red y arranque no depende del tamaño del audio (103–151 KB → mismo tiempo): es el coste fijo de Apps Script.
  La latencia ya es menor que en la 6.1 (5,7–7,6 s).
- B.2 decidida: cerrar sin optimizar (sección «Fase B»).

**Fase 13 — Los gastos puntuales van al mes de la nómina (v2.8) — hecha.** Detalle en la sección «Fase 13».
`?v=` 7.12.0. Hoja cambiada con `aplicarFase13()` (30 oct, a la cuarta: ver «Fase 13»). En Apps Script (Nueva versión
publicada): `probarPeriodos()` 27/27 y los dos gastos de prueba en su mes con `cuadra` ✅, `probarMes()` 3/3 ✅ y
`probarPagos()` todo ✅. En el iPhone P1–P6 OK: «Comida» (M006) con fecha 26/10 sale en noviembre y no en octubre, un
gasto de hoy (30/10) en noviembre, uno del 20/10 en octubre, un puntual pendiente nuevo en noviembre, Resumen y «Mes»
con el mismo total y `cuadra` ✅, y las marcas reales (M002–M004 pendientes) intactas. README: párrafo en «Pestaña Mes»
y dos filas en Decisiones.

**Fase 14 — Comisiones previstas y reparto del ingreso por tipo (v2.9) — en pruebas.** Detalle en la sección «Fase 14».
`?v=` 7.13.0. Probado en local: `aplicarFase14()` con las fórmulas reales (comas y «;»; segunda vez sin cambios; si el
reparto no da números, lo deshace todo y la hoja queda igual) y la interfaz en el iPhone 13 simulado (claro y oscuro).
`aplicarFase14()` en la hoja real (31 oct): **a la primera**, todo ✅ (Meses D, reparto H1:K4, cabecera por tipo, Guía);
noviembre: nómina cobrada 1.335,48 + comisiones cobradas 202,21 = ingreso 1.537,69 (cobrado), B7 = 0. Falta: Nueva
versión, `probarPrevistos()`/`probarIngresos()`/`probarMes()` y pruebas en el iPhone.

## Fase 14 — Comisiones previstas y reparto del ingreso por tipo (v2.9)
Hasta ahora había un solo previsto por mes (Meses C, la nómina) y `B4 = IF(E5>0, E5, E4)`: en cuanto se cobraba algo, todo
lo previsto desaparecía (con la nómina cobrada y las comisiones aún no, se perdían las comisiones previstas; y apuntar solo
las comisiones dejaba fuera la nómina prevista, el aviso de la fase 9). Decisiones (confirmadas por Pau):
- **Regla por tipo:** nómina cuenta = cobrada si hay, si no prevista; comisiones igual; extras = solo cobrados. **Origen:**
  «previsto» (nada cobrado), «cobrado» (todo lo previsto ya cobrado) o «parcial».
- **Comisiones previstas en Meses D** (vacía = 0), **puestas desde la app** con la acción `previsto`, sin Deshacer de la v1
  (como `pagar`): para corregir se vuelve a cambiar; la notificación dice el antes y el después. La nómina prevista sigue en
  Meses C, a mano. La app no calcula: el reparto es de la hoja.
- **Hoja (`aplicarFase14()`, Migraciones.gs):** Meses D1 `Comisiones_previstas`; Resumen H1:K4 `Ingreso · Previsto ·
  Cobrado · Cuenta` con filas Nómina (I = Meses C), Comisiones (I = `N(Meses D)`) y Extras (I = 0); J = `SUMIFS` de Ingresos
  por `Mes = B1` y tipo; K = `IF(J>0, J, I)`. B4 = `SUM(K2:K4)`, E4 = `SUM(I2:I4)`, E5 = `SUM(J2:J4)`, E6 =
  `IF(E5=0, "previsto", IF(AND(OR(I2=0, J2>0), OR(I3=0, J3>0)), "cobrado", "parcial"))`. Guía: 2 filas y la descripción de B4.
  Comprueba antes (Meses D vacía, H1:K4 vacía, las 4 fórmulas de la cabecera son las de antes) y después (números en
  I2:K4, B4 = suma de K, E6 válido); si algo falla, restaura las 4 fórmulas y deja la hoja como estaba. Separador
  deducido de la hoja (`separadorDeHoja_`), por lo aprendido en la 13.
- **Acción `previsto`** (`backend/Previstos.gs`, archivo nuevo): `{ etiqueta, tipo: "comisiones", importe }`. Mes que no
  está o tipo distinto (la lista `PREV_COLUMNAS_` queda lista para «nómina») → `entrada`. Importe ≥ 0 y ≤ 100.000, número o
  texto numérico («250,5»), si no → `rechazado`. 0 vacía la celda. **Devuelve también el mes ya recalculado** (`mes_` fuera
  del bloqueo): un viaje en vez de dos (~2 s menos, lo medido en la fase B).
- `Mes.gs`: `leerMesEnHoja_` lee Resumen H2:K4 y la cabecera trae `desglose: [{ tipo, previsto, cobrado, cuenta }]` (nómina,
  comisiones, extra). `comprobarCasoMes_`: suma de `cuenta` = `ingreso` (además de suma de `ingresos` = `cobrado`).
- `Ingresos.gs`: `meses` trae `previsto_comisiones`. En «+ Nuevo ingreso», con Comisiones el importe propone las comisiones
  previstas del mes (como la nómina). **Fuera el aviso «comisiones en un mes sin nómina»**: con la regla por tipo ya no pasa
  nada; queda el de nómina repetida.
- **Interfaz:** la cifra de Ingreso es un botón (▾) que abre el «Reparto del ingreso» (cerrado por defecto; sustituye a la
  lista de la fase 12): una línea por tipo («Nómina · prevista 1.370 € · cobrada 1.370 € ✓»; Comisiones siempre; Extras
  solo si hay cobrados) y debajo las líneas de cada ingreso. En Comisiones, «Cambiar previsto» abre un campo (16 px,
  teclado decimal) con Guardar y Cancelar; el rechazo sale junto al campo sin borrar lo escrito. Mientras se escribe no se
  repinta el reparto (una actualización de la caché borraría el campo). Guardar cuenta como un cambio del mes en
  `pagosMes` (como marcar un pago, 8.4): una respuesta de «mes» pedida antes se descarta y no pisa el previsto nuevo.
- Pruebas: `probarPrevistos()` (validaciones 7/7, poner 250 y leerlo en el reparto, poner 0 y celda vacía; la celda queda
  como estaba) y `probarIngresos()` con los casos (a)–(d) con 300 € de comisiones previstas en el último mes (nada cobrado →
  previsto; solo nómina → parcial; las dos → cobrado; extra de 50 → se suma). Meses D queda como estaba.

## Fase 13 — Los gastos puntuales van al mes de la nómina (v2.8)
Fallo visto en uso real (26 oct): con la nómina de octubre apuntada («Mes» ya abría en noviembre), un gasto del 26/10
caía en octubre. Había dos ideas de «mes»: el mes por defecto va por la nómina (`mesPorDefecto_`) y los gastos
puntuales iban por el mes natural (Resumen, `construirMes_`, `estadoNormal_` y «+ Nuevo gasto»).
Decisiones (confirmadas por Pau):
- **Periodo de un mes** = del día en que se cobra su nómina a la víspera de la nómina siguiente; sin nómina, el mes
  natural. **Nunca empieza después del día 1** (si la nómina llega el 2, los cargos del 1 no caen en el mes anterior).
- **Solo los gastos puntuales.** Los recurrentes siguen por mes natural: `Cálculo!N` usa `YEAR/MONTH(B2)` y
  `DAY(B3)`, así que B2 y B3 no se tocan.
- **Una sola fuente de verdad:** Meses E `Inicio_periodo` y F `Fin_periodo` (D queda libre para la fase 14):
  E2 `=IF(COUNTIFS(Ingresos!$C:$C; B2; Ingresos!$E:$E; "nómina")>0; MIN(A2; MINIFS(Ingresos!$B:$B; Ingresos!$C:$C; B2;
  Ingresos!$E:$E; "nómina")); A2)` (la primera versión, con `LET(c; …)`, daba `#ERROR!`: Sheets no acepta «c» como
  nombre en LET porque se confunde con una columna) y
  F2 `=IF(A3=""; EOMONTH(A2; 0); E3-1)`. Resumen: D2/E2 «Periodo desde» y D3/E3 «Periodo hasta» con `INDEX`/`MATCH`
  sobre Meses E y F; las 37 + 37 apariciones del filtro de Movimientos (B7, la D de los 12 bloques «cat» y las 12
  filas de detalle, dos veces cada una) pasan de `$B$2`/`$B$3` a `$E$2`/`$E$3`.
- **Nada de fórmulas en Movimientos:** `escribirFila_` y `siguienteId_` (v1) usan `getLastRow()`.
- **Las marcas de Pagos de un puntual van con su ID:** `filasPago_` y `pagosDelMes_` buscan los «M…» solo por ID
  (`esPuntual_`); al marcar uno cuya fila tiene otra etiqueta, la fila pasa al mes actual. Los «R…» siguen con
  mes + ID.
- Código: `mesesDeLaHoja_` y `ingresos_` devuelven `periodo_inicio`/`periodo_fin`; `leerMesEnHoja_` lee Resumen E2:E3
  y `construirMes_` filtra los movimientos con ellos; `estadoNormal_` recibe el mes y comprueba el periodo; en la app,
  el gasto pendiente de «+ Nuevo gasto» busca el mes cuyo periodo contiene la fecha.
- `probarPeriodos()` (Mes.gs, editor): en todos los meses, E ≤ A, E ≤ F (periodo no vacío ni al revés) y
  E = F del anterior + 1; en el último mes con nómina, un gasto de prueba el primer día del periodo cae en ese mes
  y otro de la víspera en el anterior, con `cuadra` ✅ en los dos. Limpieza en `finally`.
- **Cambios de la hoja por código:** `aplicarFase13()` (`backend/Migraciones.gs`, una vez desde el editor) hace todo lo
  anterior en vez de Pau a mano. Antes de escribir comprueba que Meses E1:F1 y Resumen D2:E3 están vacías y que el
  filtro aparece 37 + 37 veces; si no, no toca nada. Si ya estaba aplicada, no repite nada. Reescribe solo las 25
  celdas con el filtro (`getFormulas`/`setFormula`; las fórmulas nuevas, en inglés y con comas). Probada contra las fórmulas
  reales de la hoja (export del 26 oct): 29 celdas del Resumen cambiadas, 0 filtros con B2/B3, segunda vez sin cambios.
  1.ª ejecución real (30 oct): «No encuentro el filtro» → el export a Excel normaliza las fórmulas (comas, sin espacios),
  pero Apps Script puede leerlas con espacios o punto y coma. Ahora el filtro se busca con una expresión regular que
  tolera ambas cosas y solo cambia `$B$2`/`$B$3` dentro de él (el resto de la fórmula, tal cual); si no lo encuentra,
  el registro enseña una fórmula de la columna D. Además, si las fórmulas de Meses no dan fecha, se quitan y se para.
  2.ª ejecución (30 oct): filtro encontrado, pero Meses E2 daba `#ERROR!` por el `LET(c, …)` → la función lo quitó sola
  y no siguió. E2 pasa a `IF(COUNTIFS(…)>0, MIN(A2, MINIFS(…)), A2)`. 3.ª ejecución: `#ERROR!` igual → la causa era el
  separador: la hoja está en configuración regional de España («;», la coma es el decimal) y en ella `setFormula` no
  acepta comas (la suposición «setFormula siempre en inglés con comas» era falsa aquí). Ahora el separador se deduce de
  las propias fórmulas del Resumen y las fórmulas nuevas se escriben con él. **4.ª ejecución (30 oct): aplicada** — Meses
  E:F en las filas 2–28 (separador «;»), D2:E3, filtro 37 + 37 en 25 celdas, Guía, B7 = 0; octubre 01/10→25/10,
  noviembre 26/10→30/11, diciembre 01/12→31/12.
- Datos reales: M001–M003, M005 y M006 están con fecha 1/11 (puestos así a mano). La P1 del iPhone se adapta: cambiar
  la fecha de M006 a 26/10 y comprobar que sigue en noviembre.

## Fase 12 — Ingresos del mes en la cabecera de «Mes» (v2.7)
Antes, pendiente A. Objetivo: ver de un vistazo qué forma el «cobrado» (p. ej. «Nómina octubre · 28 oct · 1.370 €» y
«Comisiones octubre · 28 oct · 250 €»). Decisiones (confirmadas por Pau): **siempre visibles** (1–3 líneas, solo en
meses con ingresos) y **sin enlace** a «Mis registros» (se borran desde allí).
- **Backend** (`Mes.gs`, sin cambios en la v1): `mes_` añade `ingresos: [{ id, fecha, concepto, tipo, importe }]`, los
  de Ingresos con `Mes` = etiqueta, por fecha (`ingresosDelMes_` con `leerIngresos_` de `Ingresos.gs`). Como los
  pagos, se lee fuera del patrón de B1.
- **Pruebas:** el invariante «suma de `ingresos` = `cobrado`» está en `comprobarCasoMes_` (❌ si falla), pero con
  Ingresos vacío solo comprueba 0 = 0. La prueba con datos está en `probarIngresos()`: tras la nómina de prueba apunta
  unas comisiones (250 €) y exige que «Mes» devuelva las dos y que sumen el cobrado (1.484,56); la limpieza borra ambas.
- **Interfaz:** `#mes-ingresos` dentro de `#mes-cifras`, entre las tres cifras y el Restante: «Ingresos cobrados» y
  una línea por ingreso con `lineaMes` (concepto, o el tipo si está vacío · fecha corta · importe). Oculta si no hay.
  Llega con la respuesta de `mes`, así que la caché de la 8.4 la cubre. Sin `ingresos` (backend sin publicar) no se
  pinta nada. `?v=` 7.10.0.

## Fase 11 — Gastos puntuales pagados o pendientes (v2.6)
Motivo: Pau apuntó un gasto puntual que pagará cuando cobre; con la 8.2 los puntuales contaban siempre como pagados.
Decisiones (confirmadas por Pau):
- **Opción A: un gasto puntual nace pagado** (la mayoría se paga al momento); se puede desmarcar. Descartadas: según la
  fecha (futura → pendiente; falla si se apunta hoy y se paga al cobrar) y pendiente por defecto (habría que marcar
  cada café).
- **Pestaña Pagos = lo que se aparta de lo normal**, con una columna nueva: `Mes · ID · Marcado_el · Estado`. Cargo fijo
  (R…): normal pendiente, la fila dice «pagado». Gasto puntual (M…): normal pagado, la fila dice «pendiente». Volver a
  lo normal borra la fila. Las filas de la 8.2 (sin Estado) valen como «pagado»; al escribir, `hojaPagos_` pone la
  cabecera nueva (C «Marcado_el», D «Estado») si falta.
- `pagar`: el ID se busca en Recurrentes (presupuesto → `rechazado`) y luego en Movimientos; un puntual tiene que ser
  del mes pedido (el mismo mes natural que lee «Mes»), si no → `rechazado` «Ese gasto no es de este mes». `pagado_el`
  solo cuando queda pagado por una fila.
- `mes`: cada movimiento trae `pagado`; `pendiente` = cargos fijos sin pagar + puntuales pendientes.
- `probarPagos()` añade un puntual de prueba (M…, 12,34 € el día 15 del mes, en «Otros»): nace pagado, desmarcar dos
  veces → 1 fila «pendiente» y el pendiente sube justo 12,34, marcar dos veces → sin filas, otro mes → rechazado.
  Limpieza: borra el movimiento y sus filas.
- **Interfaz (11.2):** casilla también en los puntuales de «Mes» (`lineaPagable` para fijos y puntuales: mismo marcado
  optimista, misma caché), atenuados si están pagados: lo no atenuado es lo que queda por pagar. En «+ Nuevo gasto»,
  con Puntual, casilla «Ya está pagado» marcada por defecto; si se desmarca, tras `guardar` se llama a `pagar` con
  `pagado: false` en el mes de la fecha (los meses, de `ingresos`, que se pide junto a `registros` al abrir; un mes que
  no está en la hoja → aviso sin enviar). Si `pagar` falla, el gasto queda guardado y el aviso dice que se desmarque
  en «Mes». Los dictados no cambian (guardado de la v1): se desmarcan en «Mes».
- **Filas huérfanas (11.3).** La v1 numera desde el ID más alto: si se borra un gasto con marca en Pagos (fijo pagado o
  puntual pendiente), el siguiente gasto recibe el mismo ID y heredaría la marca. `limpiarPagosHuerfanos_` (Pagos.gs)
  borra las filas cuyo ID no está en Recurrentes ni en Movimientos; `doPost` la llama tras `eliminar` y `deshacer` con
  éxito (`limpiarPagosTrasBorrar_`, dentro de `conBloqueo_`; si falla, solo `console.error`: la acción ya está hecha).
  `limpiarPagos()` la ejecuta desde el editor (para borrados hechos a mano en la hoja). Precio aceptado: eliminar un
  gasto marcado y deshacerlo lo devuelve a su estado normal (hay que volver a marcarlo). `probarPagos()` empieza
  creando dos filas huérfanas (R999999, M999999) y comprueba que la limpieza las borra y deja las demás.

## Fase 10 — Gasto con formulario (v2.5)
Apuntar un gasto escribiéndolo, sin dictar. Decisiones (confirmadas por Pau):
- **Opción A: el formulario monta el mismo JSON que devuelve Haiku** (`CAMPOS` de la v1: `concepto`, `importe`,
  `categoria`, `frecuencia`, `cada_meses`, `tipo`, `fecha_referencia`, `dia_de_cobro`, `fecha_fin`, `reemplaza_id`,
  `supuestos`, `preguntas`) y lo envía a la acción **`guardar` de la v1**: `validarInterpretacion`, el ID, la pestaña
  (Movimientos o Recurrentes) y el Deshacer son los de siempre. Cero backend. Descartadas: una acción nueva (duplicaría la
  validación) y pasar el texto por Haiku (más lento y puede reinterpretar lo que ya está estructurado).
- **Frase:** `(formulario) categoría <elegida>`. La v1 (`categoriaDicha_`) da prioridad a una categoría nombrada en la
  frase si hay exactamente una: con el concepto en la frase, «Regalo Aina» en «Otros» acabaría en «Aina». La nota de la
  fila queda `Dictado: "(formulario) categoría Otros"` («Dictado:» lo escribe la v1).
- **Tarjeta «+ Nuevo gasto»** la primera en «Crear» (Nuevo gasto · Nuevo ingreso · Nueva categoría). Campos: concepto
  (≤ 60), importe, categoría (desplegable con las de la hoja, pedidas a `registros` al abrir; empieza en «Elige una
  categoría»), frecuencia (Puntual por defecto · Mensual · Anual · Semanal), fecha («Día del gasto» o «Primer cargo»;
  hoy), «Cada cuántos meses» solo en Mensual (1, 2, 3, 4, 6) y «Último cargo» opcional en recurrentes.
- **Fuera:** tipo «presupuesto» (siempre «fijo»), cambio de precio (está en «Mis registros») y día de cobro distinto
  al de la fecha (la v1 usa el de la fecha).
- Probado en el navegador contra el `validarInterpretacion` real de la v1 (recuperado de esta sesión): puntual,
  mensual cada 3 con fin, semanal y anual se aceptan; fecha a más de 730 días → «No se puede guardar: Fecha fuera de
  rango…» dentro de la tarjeta.

## Fase B — Latencia del dictado (cerrada sin optimizar)
**Decisión (Pau, tras la B.1): opción 1, cerrar la B sin tocar código.** Ninguna opción barata llegaba al ~1 s del
criterio de éxito (caché del contexto ~0,3 s tocando la v1; calentar ~0,1 s) y lo que de verdad bajaría la latencia
(sacar la API de Apps Script a otro servidor, hasta ~1,5 s) no compensa en una app personal. `ms_servidor`, los datos del
modo pruebas y `medirLatencia()` se quedan para seguir midiendo. README: sección «Latencia» con la tabla de tramos y
fila en Decisiones. Plan original y lo que se esperaba antes de medir:

Lo medido antes de la B.1 (estimaciones): Groq ~0,4 s; `ms_interpretar` 2,6–3,9 s, del que ~1 s es leer la hoja (`leerContexto_` de la v1: abre el
libro y lee Categorías y Recurrentes en **cada** dictado; en la 6.2, 720 ms frente a 47 ms con caché); y ~2,5 s de
Apps Script (subida, arranque y redirección) que hoy no sabemos repartir.
- **B.1 Medir antes de tocar nada** (sin cambios en la v1; confirmado por Pau, con el tamaño del audio):
  - `dictar` devuelve también `ms_servidor` (de la entrada a la salida de `doPost`); en modo pruebas, el móvil enseña
    `red y arranque = total − ms_servidor` y «Audio enviado» en KB (si la red pesa y el audio es pequeño, es el
    arranque, no la subida).
  - `medirLatencia()` en el editor: 5 vueltas de `libro_()`, `leerContexto_()` e `interpretar` con una frase fija
    (sin guardar). Da la 1.ª y la mediana: la 1.ª es la realista (cada dictado es una ejecución nueva), las demás van
    en caliente. Haiku + validación ≈ mediana de `interpretar` − mediana de `leerContexto_`.
  - 10 dictados reales en el iPhone con el modo pruebas → tabla de tramos.
- **B.2 Decidir con los datos.** Opciones previstas, de más a menos impacto esperado:
  1. **Caché del contexto** (CacheService, 10 min). Requiere **permiso de Pau para un cambio mínimo en la v1**
     (`leerContexto_` lee y guarda en la caché; 3–4 líneas). La caché se borra en `doPost` (Api.gs, nuestro) tras
     cualquier acción que escribe (`guardar`, `editar`, `baja`, `eliminar`, `deshacer`, `categoria`, `renombrar`); un
     cambio hecho a mano en la hoja tarda como mucho 10 min en verse. Sin tocar la v1 no se puede: `interpretar` llama
     a `leerContexto_` por su nombre y declarar otra función igual en un archivo nuevo es frágil (gana la última que
     carga).
  2. **Calentar Apps Script:** al tocar el micrófono, el móvil lanza una petición barata (`ping`) mientras grabas,
     para que el arranque no caiga en el dictado. Solo vale si B.1 demuestra que el arranque pesa.
  3. Descartado de entrada: separar transcribir e interpretar (dos viajes a Apps Script cuestan más de lo que ahorran)
     y cambiar de modelo (Groq y Haiku no son el cuello de botella).
- **Éxito:** bajar al menos ~1 s de la mediana sin errores nuevos (la evaluación de la 6.4 no cambia: el modelo y el
  prompt son los mismos).

## Fase 9 — Ingresos desde la app (v2.4)

### Objetivo y decisiones (confirmadas por Pau)
Apuntar nómina, comisiones y extras desde el móvil. Al apuntar, «Mes» pasa de «previsto» a «cobrado» y, con la
nómina del mes siguiente, cambia el mes por defecto.
- **Sin cambiar la hoja.** El Resumen usa lo cobrado en cuanto un mes tiene algún ingreso (`B4 = IF(E5>0, E5, E4)`):
  apuntar solo las comisiones dejaría fuera el previsto. No pasa porque las comisiones llegan **a la vez** que la
  nómina (dos transferencias el mismo día). Si se apuntan comisiones o extras en un mes sin nómina, la app avisa.
- **Formulario, no voz:** el prompt de Haiku es de la v1 y son 3–4 datos al mes con una regla clara.
- **Tarjeta plegada «+ Nuevo ingreso» en «Crear»** (debajo de «+ Nueva categoría»): tipo (nómina por defecto),
  importe (en nómina, el previsto del mes propuesto), fecha (hoy), mes propuesto con la regla de la Guía (**si
  entra a partir del día 20, va al mes siguiente**; se puede cambiar) y concepto opcional («Nómina octubre»: tipo +
  mes de la fecha). Sin Notas.
- **Nómina repetida en el mismo mes → `rechazado`** (una paga extra va como «extra»).
- **Sección «Ingresos» en «Mis registros»** (últimos 20) con Eliminar (dos toques + Deshacer). Sin editar: para
  corregir, borrar y volver a apuntar.
- Propuesta sin implementar: listar en la cabecera de «Mes» los ingresos que forman el «cobrado».

### 9.1 Backend (`backend/Ingresos.gs`)
- `ingresos` (solo lectura, no toca B1): `hoy`, `meses` con `previsto` (Meses!C) y `nomina` (si ya tiene una), e
  `ingresos` (últimos 20 por fecha, `{ id, fecha, mes, concepto, tipo, importe }`).
- `ingreso`: tipo fuera de la lista o mes que no está en Meses → `entrada`. Validaciones (`rechazado` con mensaje, no
  escriben): importe > 0 y ≤ 100.000 (se redondea a 2 decimales), fecha válida y como mucho 60 días en el futuro,
  concepto ≤ 60 sin `= + - @` al principio, nómina no repetida. ID con `siguienteId_(hoja, 'I')`; fecha como número de
  serie (`fechaSerial_`) y Registrado con `ahoraSerial_` (v1). Deshacer: `{ op: 'borrar', hoja: 'Ingresos', id }`.
- `borrar_ingreso`: Deshacer con `{ op: 'fila', hoja: 'Ingresos', valores }` (valores con `aJSON_`). El paso «fila»
  de la v1 aplica los formatos de Movimientos (columnas 2, 4 y 7): en Ingresos no estropea nada (4 y 7 son texto) y la
  columna de importe ya tiene su formato en la hoja. La fila recuperada vuelve al final.
- `probarIngresos()` (editor): validaciones puras + `entrada`; una nómina real en el último mes de Meses (fila,
  «Mes» la cuenta como cobrada, sale en la lista, no deja apuntar otra), borrarla y el Deshacer de verdad
  (`deshacer` de la v1 con el TOKEN de las propiedades). Limpieza en `finally` (Ingresos y `ULTIMO` como estaban).

### 9.2 Interfaz
- **«+ Nuevo ingreso»** (`<details>` en «Crear», debajo de «+ Nueva categoría»): al abrirse pide `ingresos` (siempre
  fresco). Tipo con tres botones (radio invisible encima del texto), importe, «Día en que entra» (hoy) y «Mes al que
  va» (`proponerMes`: día ≥ 20 → mes siguiente; si eliges el mes a mano, no se vuelve a proponer hasta cambiar la
  fecha). En nómina, el importe es el previsto del mes mientras no lo escribas (`importeAuto`). El concepto vacío
  enseña de ejemplo el que pondrá el servidor. Avisos: comisiones o extra en un mes sin nómina, y nómina en un mes
  que ya la tiene. Al apuntar: notificación con Deshacer y la tarjeta se vacía y se pliega; si el servidor rechaza, su
  mensaje sale dentro sin borrar lo escrito.
- **«Mis registros»**: sección «Ingresos» (últimos 20; `registros` e `ingresos` se piden a la vez). Chips: fecha,
  tipo y mes. Al desplegar: «Eliminar» (dos toques + Deshacer). Las tres listas comparten `tarjetaLista`.

## Fase 8 — Renombrar gastos y marcar pagos (v2.3)

### 8.1 Renombrar gastos
La v1 (`editarRegistro`) solo edita importe y categoría: para cambiar el nombre había que borrar y volver a crear.
- **Backend** (`backend/Renombrar.gs`, acción `renombrar`): `{ hoja, id, concepto }` para Recurrentes y Movimientos,
  dentro de `conBloqueo_`. Hoja distinta → `entrada`. Validaciones (devuelven `rechazado` con `mensaje`, no
  escriben): concepto de 1–60 caracteres (el límite de la v1), que no empiece por `= + - @`, distinto del actual
  (cambiar solo mayúsculas vale) y que el ID exista. Deshacer: `apuntarDeshacer_` con `{ op: 'celda', … valor:
  anterior }`, que el `deshacer` de la v1 ya sabe aplicar. Borra la caché del vocabulario. En Recurrentes, el nombre
  nuevo sale en todos los meses (Cálculo y el Resumen lo leen de la regla).
- `probarRenombrar()` (editor): validaciones sin escribir, hoja inventada, ID inexistente, y un renombrado real de la
  primera regla con limpieza en `finally` (concepto y `ULTIMO` como estaban).
- **Interfaz** (Mis registros): campo «Nombre» arriba del editor con su propio botón «Cambiar nombre» (opción A:
  cada cambio tiene su Deshacer; con un único «Guardar cambios», Deshacer solo revertiría la última de dos
  operaciones). Notificación «"Aina" → "Piso Aina"» con Deshacer y la lista se recarga. `?v=` 7.4.0.

### 8.2 Marcar pagos (backend) y 8.3 (interfaz)
Decisiones (todas confirmadas por Pau):
- Solo se marcan los **cargos fijos** del mes (reglas que no son de tipo «presupuesto»). Los gastos puntuales ya
  están pagados al apuntarlos y los presupuestos no son un cargo.
- **Pestaña nueva «Pagos»** (`Mes · ID · Pagado_el`), que crea la app la primera vez: una fila = una regla pagada en
  un mes; desmarcar borra la fila. No cambia ninguna fórmula: es informativo.
- **Clave = mes + ID** (no `fecha_cargo`): resuelve las semanales (sin fecha). Una semanal (× 4) es una sola casilla.
- **No usa `ULTIMO`**: desmarcar es volver a tocar la casilla; así no se pisa el Deshacer de la última acción real.
- Se puede marcar en **cualquier mes** (también futuros, para pagos adelantados).

Backend (8.2):
- Acción `pagar` (`backend/Pagos.gs`): `{ etiqueta, id, pagado }`. Mes que no está en Meses o `pagado` no booleano →
  `entrada`. Regla inexistente o de tipo presupuesto → `rechazado` con `mensaje`. Idempotente: marcar dos veces no
  duplica la fila y desmarcar algo sin marcar no falla. Responde `{ etiqueta, id, pagado, pagado_el }`
  (`pagado_el` = "yyyy-MM-ddTHH:mm" con la zona de la hoja).
- `mes_` (Mes.gs) añade a cada regla `pagado` y `pagado_el`, y a la cabecera `pendiente` = suma de los cargos
  fijos del mes sin marcar. Lee Pagos fuera del patrón de B1 (no depende del mes del Resumen).
- `probarPagos()` (editor): validaciones (mes inventado, `pagado` no booleano, regla inexistente, presupuesto) y,
  en noviembre, marcar dos veces (1 fila), comprobar que el pendiente baja justo el importe, desmarcar dos veces y
  volver al pendiente inicial. Limpieza en `finally`; si la pestaña Pagos la creó la prueba, la borra.

Interfaz (8.3): casilla en cada cargo fijo de «Mes»; toda la línea es un `<label>`, así que se marca tocando cualquier
parte. Marcado optimista: la línea se atenúa y el pendiente cambia al instante; si el servidor falla, vuelve atrás y
avisa con una notificación de error (sin Deshacer: desmarcar es volver a tocar). Mientras su petición está en vuelo la
casilla se desactiva (dos toques rápidos podrían llegar desordenados) y, mientras se carga otro mes, no se puede tocar
ninguna. Cabecera: Ingreso · Previsto · Pendiente de pagar y el Restante grande debajo. **Memoria del mes** mientras la
app está abierta: al volver a la pestaña se recarga el mes que mirabas (`mesDestino`); al abrir la app, el mes por
defecto. `?v=` 7.5.0.

### 8.4 Caché de meses ya vistos
Opción B (confirmada por Pau): **mostrar y actualizar**. Descartadas: A, caché pura (habría que invalidarla en cada
guardar, editar o deshacer, y es fácil olvidar un caso), y C, adelantar el mes anterior y el siguiente (cada petición
bloquea la hoja al escribir B1; las adelantadas retrasarían la que quieres ver).
- `cacheMes` (Map etiqueta → respuesta de `mes`) **solo en memoria**: se borra al cerrar la app (no se abre viendo datos
  de hace días).
- Mes ya visto (al volver a la pestaña, con las flechas o con «Hoy»): se pinta al instante con «Actualizando…» y se pide
  igualmente al servidor; al llegar, se guarda y se repinta. Mes no visto: como antes (atenuado y «Cargando…»). Si la
  actualización falla, se queda lo de la caché con «No se ha podido actualizar: …».
- Flechas: el debounce de 300 ms se mantiene; `irAMes` invalida la respuesta en camino (`peticionMes++`), que se guarda
  en la caché pero no se pinta.
- Pagos: la casilla cambia los datos de la caché (son los mismos objetos) y la pantalla se repinta desde ellos
  (`pintarCasilla` busca la línea por `data-id`; `g.guardando` la mantiene bloqueada aunque el mes se repinte).
  `pagosMes` (etiqueta → `{ cambios, enVuelo }`): si se marcó una casilla de ese mes después de pedirlo, o hay una en
  vuelo, la respuesta se descarta y manda la caché.
- Modo pruebas: el pie dice «desde caché» o «del servidor».

## Fase 7b — Crear categorías (v2.2)

### Objetivo
Crear desde la app una categoría (nombre + descripción) sin tocar la hoja. Caso de uso: «Aina» (hoy un gasto
de 86 € en Otros) pasa a ser una categoría con sus gastos recurrentes dentro. La migración la hace Pau a mano:
crear «Aina», dictar sus gastos y dar de baja el R004 en «Mis registros».

### Decisiones
- La pestaña «Dictar» pasa a llamarse **«Crear»**: el micrófono sigue arriba y debajo va una tarjeta plegada
  «+ Nueva categoría». La fase 8 sigue siendo «marcar pagos».
- La categoría nueva va **justo antes de «Otros»** (el cajón de sastre se queda al final del Resumen y de «Mes»).
- **Descripción obligatoria** (10–150 caracteres): Haiku la lee para clasificar los dictados.

### Backend (`backend/Categorias.gs`, acción `categoria`)
- Petición: `{ "t", "accion": "categoria", "nombre", "descripcion" }`. Dentro de `conBloqueo_`.
- Validaciones (si falla, `{ ok: false, error: "rechazado", mensaje }`, devuelto y no lanzado; no escribe nada):
  nombre de 1–30 caracteres con alguna letra; que no empiece por `= + - @` (fórmula); sin `|` (separador de
  `Cálculo!Q`); que no exista ya (sin distinguir mayúsculas ni tildes, con `normalizar` de la v1); descripción de
  10–150 caracteres; y que quede hueco en el Resumen.
- **Límite del Resumen:** se cuentan los bloques «cat» de `Resumen!G10:G129` (hoy 12; usa las constantes de
  `Mes.gs`). Si se amplía el Resumen, la app lo detecta sola. Cada bloque muestra 9 reglas de detalle.
- Escritura: `insertRowBefore` en la fila de «Otros» (o al final si no existe). Las fórmulas del Resumen usan
  `INDEX('Categorías'!A:A, n)` y las validaciones `Categorías!A2:A100`, así que una fila insertada no las rompe.
- Deshacer: `apuntarDeshacer_('Categoría «X» eliminada', [{ op: 'borrar', hoja: 'Categorías', id: X }])`; el
  `deshacer` de la v1 ya borra la fila cuya columna A coincide. Se borra la caché del vocabulario de Whisper.
- Respuesta: `{ nombre, desc, huecos_libres }`.
- `probarCategorias()` (editor): las validaciones sin escribir y una creación real de «Prueba 7b» (posición antes
  de «Otros», aparece en el Resumen, no se puede duplicar) con limpieza en un `finally` que deja Categorías y
  `ULTIMO` como estaban.

### Subfases
- **7b.1 Backend:** `Categorias.gs` + línea en `Api.gs` + `probarCategorias()`. Después: copiar a Apps Script y
  **Nueva versión sobre el mismo despliegue**.
- **7b.2 Interfaz:** pestaña «Crear» con la tarjeta plegada; al crear, notificación con Deshacer. `?v=` 7.3.x.

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

  Desde la 8.2 (sin el R004 de 86 €, migrado a la categoría «Aina»): 1.153 · 1.029 · 963 €. Desde la C (con R014,
  R016 y R017): 1.234 · 1.110 · 1.044 €, solo como referencia (⚠️ si no coincide).

  Además: tras la prueba, `Resumen!B1` sigue en el mes que había (comprueba la restauración). En el iPhone,
  noviembre muestra lo mismo que el Resumen.

## Forma de trabajar
- Antes de escribir código, presentar un plan breve y esperar confirmación.
- Commits pequeños con mensajes en español que digan qué y por qué.
- Cada cambio en `app.js`, `config.js` o `styles.css` sube su `?v=` en `index.html` (evita la caché de iOS).
- Al terminar una tarea, explicar qué se ha hecho y cómo probarlo.
- Si el cambio toca la interfaz (GitHub Pages sirve `main`), abrir y fusionar el PR **antes** de pasar las pruebas
  del iPhone, y decirlo al principio del mensaje: «Ya está en `main`, puedes probar en el iPhone».
