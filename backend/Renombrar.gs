/**
 * Renombrar.gs — Fase 8.1: cambiar el nombre (concepto) de un gasto recurrente o puntual.
 * Archivo nuevo: la v1 (editarRegistro) solo edita importe y categoría.
 * En Recurrentes, el nombre nuevo sale en todos los meses (Cálculo y el Resumen lo leen de ahí);
 * en Movimientos, solo cambia ese gasto.
 */

const REN_MAX_ = 60;   // el mismo límite que aplica la v1 al concepto al guardar

/** Acción "renombrar" de la API: { hoja, id, concepto } → cambia el concepto y se puede deshacer. */
function renombrar_(p) {
  if (p.hoja !== 'Recurrentes' && p.hoja !== 'Movimientos') return { ok: false, error: 'entrada' };
  const id = String(p.id == null ? '' : p.id);
  const concepto = String(p.concepto == null ? '' : p.concepto).replace(/\s+/g, ' ').trim();

  return conBloqueo_(() => {   // v1: un acceso a la vez
    const hoja = libro_().getSheetByName(p.hoja);
    const fila = buscarFilaPorId_(hoja, id);   // v1
    // Errores de negocio con un mensaje para el usuario: se devuelven, no se lanzan.
    if (fila < 0) return { ok: false, error: 'rechazado', mensaje: 'Ese gasto ya no existe (¿se borró a mano?). Recarga la lista.' };

    const col = p.hoja === 'Recurrentes' ? COL.CONCEPTO : COLM.CONCEPTO;   // columnas de la v1
    const actual = String(hoja.getRange(fila, col).getValue());
    const error = validarConcepto_(concepto, actual);
    if (error) return { ok: false, error: 'rechazado', mensaje: error };

    hoja.getRange(fila, col).setValue(concepto);
    // v1: deshacer devuelve la celda a su valor anterior.
    apuntarDeshacer_('«' + concepto + '» vuelve a llamarse «' + actual + '»',
      [{ op: 'celda', hoja: p.hoja, id: id, col: col, valor: actual }]);
    CacheService.getScriptCache().remove(VOCAB_CLAVE_CACHE_);   // el vocabulario de Whisper incluye conceptos

    return { id: id, concepto: concepto, desc: '«' + actual + '» → «' + concepto + '»' };
  });
}

/** Devuelve el mensaje del primer problema, o null si se puede renombrar. No escribe nada. */
function validarConcepto_(concepto, actual) {
  if (!concepto) return 'Escribe el nombre nuevo.';
  if (concepto.length > REN_MAX_) return 'El nombre puede tener como máximo ' + REN_MAX_ + ' caracteres.';
  if (/^[=+\-@]/.test(concepto)) return 'El nombre no puede empezar por =, +, - ni @.';
  if (concepto === actual) return 'Es el mismo nombre que ya tiene.';
  return null;
}

/**
 * Prueba desde el editor (sin la app):
 *  1. Las validaciones, sin escribir nada.
 *  2. Renombra de verdad la primera regla de Recurrentes, comprueba el cambio y el Deshacer, y la devuelve
 *     a su nombre. Deja como estaban el concepto y la propiedad ULTIMO (el Deshacer pendiente).
 */
function probarRenombrar() {
  const casos = [
    ['vacío', '', 'Aina', true],
    ['solo espacios', '   ', 'Aina', true],
    ['demasiado largo', 'x'.repeat(REN_MAX_ + 1), 'Aina', true],
    ['empieza por =', '=HOY()', 'Aina', true],
    ['el mismo nombre', 'Aina', 'Aina', true],
    ['solo cambian las mayúsculas', 'aina', 'Aina', false],
    ['válido', 'Piso Aina', 'Aina', false]
  ];
  let ok = 0;
  casos.forEach(([caso, nuevo, actual, debeFallar]) => {
    const error = validarConcepto_(String(nuevo).replace(/\s+/g, ' ').trim(), actual);
    const bien = debeFallar ? !!error : !error;
    if (bien) ok++;
    Logger.log((bien ? '✅ ' : '❌ ') + caso + ' → ' + (error || 'se puede renombrar'));
  });
  const entrada = renombrar_({ hoja: 'Inventada', id: 'R001', concepto: 'x' });
  if (entrada.error === 'entrada') ok++;
  Logger.log((entrada.error === 'entrada' ? '✅ ' : '❌ ') + 'hoja inventada → error ' + entrada.error);
  const noExiste = renombrar_({ hoja: 'Recurrentes', id: 'R999999', concepto: 'x' });
  if (noExiste.ok === false && noExiste.mensaje) ok++;
  Logger.log((noExiste.mensaje ? '✅ ' : '❌ ') + 'id inexistente → ' + (noExiste.mensaje || JSON.stringify(noExiste)));
  Logger.log('Validaciones: ' + ok + '/' + (casos.length + 2));

  // Renombrado real, con limpieza en el finally.
  const hoja = libro_().getSheetByName('Recurrentes');
  if (hoja.getLastRow() < 2) { Logger.log('Recurrentes está vacía: no hay nada que renombrar.'); return; }
  const id = String(hoja.getRange(2, COL.ID).getValue());
  const original = String(hoja.getRange(2, COL.CONCEPTO).getValue());
  const props = PropertiesService.getScriptProperties();
  const ultimo = props.getProperty('ULTIMO');
  const prueba = (original + ' (prueba 8.1)').slice(0, REN_MAX_);
  try {
    const r = renombrar_({ hoja: 'Recurrentes', id: id, concepto: prueba });
    if (r.ok === false) { Logger.log('❌ Renombrar ' + id + ' → ' + (r.mensaje || r.error)); return; }
    const ahora = String(hoja.getRange(2, COL.CONCEPTO).getValue());
    Logger.log((ahora === prueba ? '✅ ' : '❌ ') + id + ': ' + r.desc + ' (en la hoja: «' + ahora + '»)');
    const u = JSON.parse(props.getProperty('ULTIMO') || 'null');
    const pasoOk = u && u.pasos && u.pasos[0].op === 'celda' && u.pasos[0].valor === original;
    Logger.log((pasoOk ? '✅ ' : '❌ ') + 'Deshacer apuntado: ' + (u ? u.desc : 'nada'));
  } finally {
    hoja.getRange(2, COL.CONCEPTO).setValue(original);
    if (ultimo === null) props.deleteProperty('ULTIMO');
    else props.setProperty('ULTIMO', ultimo);
    const igual = String(hoja.getRange(2, COL.CONCEPTO).getValue()) === original &&
                  props.getProperty('ULTIMO') === ultimo;
    Logger.log((igual ? '✅ ' : '❌ ') + 'Limpieza: «' + original + '» y el Deshacer pendiente como estaban');
  }
}
