/**
 * Api.gs — Fase 6.1: API para la app externa (GitHub Pages).
 * Archivo nuevo. doPost es un enrutador: comprueba el token y llama a las
 * funciones que ya existen en la v1 (Código.gs, Registros.gs) sin modificarlas.
 *
 * Petición: { "t": token, "accion": "...", ...parámetros }
 * Respuesta: { "ok": true, ... } o { "ok": false, "error": "...", "mensaje"?: "..." }
 */

// Cada acción recibe los parámetros de la petición y el token (ya comprobado).
const ACCIONES_ = {
  transcribir: (p) => transcribirConVocabulario_(p),
  dictar: (p, t) => dictar_(p, t),
  interpretar: (p, t) => interpretar(t, p.frase, p.correccion || null),
  guardar: (p, t) => guardar(t, p.interpretacion, p.frase),
  deshacer: (p, t) => deshacer(t),
  registros: (p, t) => listarRegistros(t),
  editar: (p, t) => editarRegistro(t, p.hoja, p.id, p.cambios || {}),
  baja: (p, t) => darDeBaja(t, p.id, p.fecha_fin),
  eliminar: (p, t) => eliminarRegistro(t, p.hoja, p.id),
  mes: (p) => mes_(p)   // Fase 7: Mes.gs
};

function doPost(e) {
  try {
    let p;
    try {
      p = JSON.parse(e.postData.contents);
    } catch (err) {
      return respuesta_({ ok: false, error: 'entrada' });
    }

    // El token se comprueba antes de cualquier otra cosa (comparador de la v1).
    if (!tokenValido_(p.t)) return respuesta_({ ok: false, error: 'token' });

    const accion = ACCIONES_[p.accion];
    if (!accion) return respuesta_({ ok: false, error: 'entrada' });

    const resultado = accion(p, p.t);
    // Las funciones de la v1 no siempre devuelven "ok": se añade aquí.
    return respuesta_(resultado.ok === false ? resultado : Object.assign({ ok: true }, resultado));
  } catch (err) {
    console.error(err); // queda en el registro de ejecuciones
    return respuesta_(clasificarError_(err));
  }
}

/** Audio → texto (Groq) → interpretación (v1). Una sola petición para pagar una vez el viaje. */
function dictar_(p, token) {
  const tr = transcribirConVocabulario_(p);
  if (!tr.ok) return tr;
  if (!tr.texto) {
    return { ok: false, error: 'rechazado', mensaje: 'No se ha entendido nada en el audio.', prob_sin_voz: tr.prob_sin_voz };
  }

  // Sin "corrige": lo dictado es la frase. Con "corrige": lo dictado es el cambio pedido.
  const c = p.corrige;
  const v = c
    ? interpretar(token, c.frase, { anterior: c.anterior, texto: tr.texto })
    : interpretar(token, tr.texto, null);

  const ms = v.ms;
  delete v.ms;
  return Object.assign(v, tr, { ms_interpretar: ms });
}

/** Transcribe sin vocabulario salvo que llegue "vocabulario: true" (en la 6.2 empeoró a large-v3). */
function transcribirConVocabulario_(p) {
  const inicio = Date.now();
  let usar = p.vocabulario === true;
  let prompt = '';
  try {
    if (usar) prompt = vocabulario_();
  } catch (err) {
    console.error(err); // si falla la hoja, se transcribe igual, sin vocabulario
    usar = false;
  }
  const msVocabulario = Date.now() - inicio;

  const tr = transcribir_(p.audio, p.mime, p.modelo, prompt);
  if (!tr.ok) return tr;
  return Object.assign(tr, { vocabulario: usar, ms_vocabulario: msVocabulario });
}

/**
 * Traduce una excepción a un error del contrato:
 *  - llm:       falló la llamada a Anthropic (su mensaje puede traer texto de la API: no se devuelve)
 *  - rechazado: regla de negocio de la v1 (mensaje pensado para el usuario: se devuelve)
 *  - interno:   cualquier otra cosa (errores de programación o de servicios de Google)
 */
function clasificarError_(err) {
  const msg = String(err && err.message || '');
  if (/^(Error de la API|Falta ANTHROPIC|La respuesta del modelo|El modelo no)/.test(msg)) {
    return { ok: false, error: 'llm' };
  }
  if (err && err.name === 'Error' && msg) return { ok: false, error: 'rechazado', mensaje: msg };
  return { ok: false, error: 'interno' };
}

function respuesta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
