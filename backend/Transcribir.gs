/**
 * Transcribir.gs — audio → texto con Whisper vía Groq.
 * Solo contiene transcribir_(); la entrada web (doPost) está en Api.gs
 * y el vocabulario que se pasa como prompt, en Vocabulario.gs.
 *
 * Propiedad del script necesaria: GROQ_API_KEY.
 */

const GROQ_URL_ = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODELOS_PERMITIDOS_ = ['whisper-large-v3', 'whisper-large-v3-turbo'];
const MODELO_POR_DEFECTO_ = 'whisper-large-v3'; // en la 6.0 acertó más que turbo con la misma latencia
const MAX_AUDIO_B64_ = 3 * 1024 * 1024; // ~3 MB en base64
const EXTENSIONES_ = { 'audio/mp4': 'mp4', 'audio/webm': 'webm' };

/**
 * Envía el audio a Groq y devuelve { ok, texto, modelo, ms_groq } o { ok:false, error }.
 * "prompt" (opcional) es el vocabulario de Vocabulario.gs.
 */
function transcribir_(audioB64, mime, modelo, prompt) {
  modelo = modelo || MODELO_POR_DEFECTO_;
  if (MODELOS_PERMITIDOS_.indexOf(modelo) === -1) return { ok: false, error: 'entrada' };
  if (!EXTENSIONES_[mime]) return { ok: false, error: 'entrada' };
  if (typeof audioB64 !== 'string' || audioB64.length === 0 || audioB64.length > MAX_AUDIO_B64_) {
    return { ok: false, error: 'entrada' };
  }

  const bytes = Utilities.base64Decode(audioB64);
  const blob = Utilities.newBlob(bytes, mime, 'audio.' + EXTENSIONES_[mime]);
  const clave = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');

  // Payload como objeto con un Blob: UrlFetchApp monta el multipart solo.
  const payload = { file: blob, model: modelo, language: 'es', response_format: 'json' };
  if (prompt) payload.prompt = prompt;

  const inicio = Date.now();
  const res = UrlFetchApp.fetch(GROQ_URL_, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + clave },
    payload: payload,
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
