/**
 * Fase 6.0 — API de transcripción (audio → texto con Whisper vía Groq).
 * Archivo nuevo: no modifica nada de la v1. Se copia a mano al proyecto de Apps Script.
 *
 * Propiedades del script necesarias: TOKEN, GROQ_API_KEY.
 */

const GROQ_URL_ = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODELOS_PERMITIDOS_ = ['whisper-large-v3', 'whisper-large-v3-turbo'];
const MAX_AUDIO_B64_ = 3 * 1024 * 1024; // ~3 MB en base64
const EXTENSIONES_ = { 'audio/mp4': 'mp4', 'audio/webm': 'webm' };

function doPost(e) {
  try {
    let peticion;
    try {
      peticion = JSON.parse(e.postData.contents);
    } catch (err) {
      return respuesta_({ ok: false, error: 'entrada' });
    }

    // El token se comprueba antes de cualquier otra cosa.
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || peticion.t !== token) {
      return respuesta_({ ok: false, error: 'token' });
    }

    if (peticion.accion !== 'transcribir') {
      return respuesta_({ ok: false, error: 'entrada' });
    }

    return respuesta_(transcribir_(peticion.audio, peticion.mime, peticion.modelo));
  } catch (err) {
    console.error(err); // queda en el registro de ejecuciones, nunca en la respuesta
    return respuesta_({ ok: false, error: 'interno' });
  }
}

/** Envía el audio a Groq y devuelve { ok, texto, modelo, ms_groq } o { ok:false, error }. */
function transcribir_(audioB64, mime, modelo) {
  if (MODELOS_PERMITIDOS_.indexOf(modelo) === -1) return { ok: false, error: 'entrada' };
  if (!EXTENSIONES_[mime]) return { ok: false, error: 'entrada' };
  if (typeof audioB64 !== 'string' || audioB64.length === 0 || audioB64.length > MAX_AUDIO_B64_) {
    return { ok: false, error: 'entrada' };
  }

  const bytes = Utilities.base64Decode(audioB64);
  const blob = Utilities.newBlob(bytes, mime, 'audio.' + EXTENSIONES_[mime]);
  const clave = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');

  const inicio = Date.now();
  // Payload como objeto con un Blob: UrlFetchApp monta el multipart solo.
  const res = UrlFetchApp.fetch(GROQ_URL_, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + clave },
    payload: { file: blob, model: modelo, language: 'es', response_format: 'json' },
    muteHttpExceptions: true
  });
  const msGroq = Date.now() - inicio;

  if (res.getResponseCode() !== 200) {
    console.error('Groq respondió ' + res.getResponseCode()); // sin el cuerpo: podría contener detalles
    return { ok: false, error: 'groq' };
  }

  const datos = JSON.parse(res.getContentText());
  return { ok: true, texto: (datos.text || '').trim(), modelo: modelo, ms_groq: msGroq };
}

function respuesta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
