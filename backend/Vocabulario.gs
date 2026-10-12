/**
 * Vocabulario.gs — Fase 6.2: texto de contexto para Whisper con las palabras de la hoja.
 * Whisper no obedece instrucciones: imita la ortografía y el formato del texto que recibe
 * como "lo dicho antes". Por eso aquí se escribe una lista de palabras, no órdenes.
 *
 * Se guarda en caché 1 hora para no leer la hoja en cada dictado.
 */

const VOCAB_CLAVE_CACHE_ = 'vocabulario_whisper';
const VOCAB_SEGUNDOS_CACHE_ = 3600;
const VOCAB_MAX_CARACTERES_ = 600;   // Whisper corta el prompt a 224 tokens (~3 caracteres/token en el peor caso)
const VOCAB_ULTIMOS_MOVIMIENTOS_ = 50;

/** Devuelve el vocabulario desde la caché o, si no está, lo construye y lo guarda. */
function vocabulario_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get(VOCAB_CLAVE_CACHE_);
  if (guardado !== null) return guardado;

  const texto = construirVocabulario_();
  cache.put(VOCAB_CLAVE_CACHE_, texto, VOCAB_SEGUNDOS_CACHE_);
  return texto;
}

/**
 * Prioridad: conceptos de reglas activas → últimos movimientos → categorías.
 * Ejemplo: "Gastos: Spotify, Claude, Mercadona. Categorías: Ocio, Suscripciones. Importe: 10,99 €."
 */
function construirVocabulario_() {
  const ctx = leerContexto_();   // v1: categorías y reglas activas de la hoja
  const conceptos = sinRepetir_(
    ctx.recurrentesActivas.map((r) => r.concepto).concat(ultimosConceptos_()));
  const categorias = ctx.categorias.map((c) => c.nombre);

  const fijo = 'Gastos: . Categorías: . Importe: 10,99 €.';
  const hueco = { libre: VOCAB_MAX_CARACTERES_ - fijo.length };
  const c = queCaben_(conceptos, hueco);
  const k = queCaben_(categorias, hueco);
  if (!c.length && !k.length) return '';

  return 'Gastos: ' + c.join(', ') + '. Categorías: ' + k.join(', ') + '. Importe: 10,99 €.';
}

/** Conceptos de los últimos movimientos puntuales, del más reciente al más antiguo. */
function ultimosConceptos_() {
  const hoja = libro_().getSheetByName('Movimientos');
  const ultima = hoja.getLastRow();
  if (ultima < 2) return [];
  const desde = Math.max(2, ultima - VOCAB_ULTIMOS_MOVIMIENTOS_ + 1);
  const col = CONFIG.COLS_MOV.indexOf('Concepto') + 1;
  return hoja.getRange(desde, col, ultima - desde + 1, 1).getValues()
    .map((f) => f[0]).reverse();
}

/** Quita vacíos y repetidos (sin distinguir mayúsculas), conservando el orden. */
function sinRepetir_(lista) {
  const vistos = {};
  return lista.map((t) => String(t || '').trim()).filter((t) => {
    const k = t.toLowerCase();
    if (!t || vistos[k]) return false;
    vistos[k] = true;
    return true;
  });
}

/** Toma términos en orden mientras quepan en el hueco (", " cuenta como separador). */
function queCaben_(lista, hueco) {
  const elegidos = [];
  for (const t of lista) {
    if (t.length + 2 > hueco.libre) break;
    elegidos.push(t);
    hueco.libre -= t.length + 2;
  }
  return elegidos;
}
