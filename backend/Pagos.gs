/**
 * Pagos.gs — Fase 8.2: marcar como pagados los cargos fijos de un mes.
 * Archivo nuevo. Los pagos viven en su propia pestaña, «Pagos» (Mes · ID · Pagado_el): una fila por regla
 * pagada en un mes; desmarcar borra la fila. No cambia ninguna fórmula: es informativo.
 * La clave es mes + ID de la regla (no fecha_cargo, que las semanales no tienen). No usa ULTIMO: desmarcar
 * es volver a tocar la casilla, y así no se pisa el Deshacer de la última acción real.
 */

const PAG_HOJA_ = 'Pagos';
const PAG_COLUMNAS_ = ['Mes', 'ID', 'Pagado_el'];

/** Acción "pagar" de la API: { etiqueta, id, pagado } → marca o desmarca. Idempotente. */
function pagar_(p) {
  const etiqueta = String(p.etiqueta == null ? '' : p.etiqueta);
  const id = String(p.id == null ? '' : p.id);
  if (typeof p.pagado !== 'boolean') return { ok: false, error: 'entrada' };
  const libro = libro_();   // v1
  const zona = libro.getSpreadsheetTimeZone();
  if (!mesesDeLaHoja_(libro, zona).some((m) => m.etiqueta === etiqueta)) return { ok: false, error: 'entrada' };   // Mes.gs

  return conBloqueo_(() => {   // v1: un acceso a la vez
    // Errores de negocio con un mensaje para el usuario: se devuelven, no se lanzan.
    const rec = libro.getSheetByName('Recurrentes');
    const fila = buscarFilaPorId_(rec, id);   // v1
    if (fila < 0) return { ok: false, error: 'rechazado', mensaje: 'Ese gasto ya no existe (¿se borró a mano?). Recarga el mes.' };
    if (String(rec.getRange(fila, COL.TIPO).getValue()).trim() === 'presupuesto') {
      return { ok: false, error: 'rechazado', mensaje: 'Los presupuestos no se marcan como pagados.' };
    }

    const hoja = hojaPagos_(libro);
    const filas = filasPago_(hoja, etiqueta, id);
    let pagadoEl = null;
    if (p.pagado) {
      if (filas.length) {
        pagadoEl = textoFechaHora_(hoja.getRange(filas[0], 3).getValue(), zona);   // ya estaba: no se duplica
      } else {
        const ahora = new Date();
        hoja.appendRow([etiqueta, id, ahora]);
        hoja.getRange(hoja.getLastRow(), 3).setNumberFormat('dd/mm/yyyy hh:mm');
        pagadoEl = textoFechaHora_(ahora, zona);
      }
    } else {
      filas.reverse().forEach((f) => hoja.deleteRow(f));   // de abajo arriba, para no mover las filas pendientes
    }
    return { etiqueta: etiqueta, id: id, pagado: p.pagado, pagado_el: pagadoEl };
  });
}

/** { id: 'yyyy-MM-ddTHH:mm' } con las reglas pagadas de un mes. Lo usa mes_ (Mes.gs). */
function pagosDelMes_(libro, etiqueta, zona) {
  const hoja = libro.getSheetByName(PAG_HOJA_);
  const pagos = {};
  if (!hoja || hoja.getLastRow() < 2) return pagos;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 3).getValues().forEach((f) => {
    if (String(f[0]) === etiqueta && f[1]) pagos[String(f[1])] = textoFechaHora_(f[2], zona);
  });
  return pagos;
}

/** La pestaña Pagos; si no existe, la crea con su cabecera. */
function hojaPagos_(libro) {
  let hoja = libro.getSheetByName(PAG_HOJA_);
  if (!hoja) {
    hoja = libro.insertSheet(PAG_HOJA_);
    hoja.appendRow(PAG_COLUMNAS_);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

/** Números de fila (de arriba abajo) con ese mes e ID. */
function filasPago_(hoja, etiqueta, id) {
  if (hoja.getLastRow() < 2) return [];
  const filas = [];
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues().forEach((f, i) => {
    if (String(f[0]) === etiqueta && String(f[1]) === id) filas.push(i + 2);
  });
  return filas;
}

function textoFechaHora_(d, zona) {
  return d instanceof Date ? Utilities.formatDate(d, zona, "yyyy-MM-dd'T'HH:mm") : null;
}

/**
 * Prueba desde el editor (sin la app): validaciones y, en noviembre, marcar y desmarcar un cargo fijo
 * comprobando el pendiente. Al terminar deja la pestaña Pagos como estaba (y la borra si la creó la prueba).
 */
function probarPagos() {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const meses = mesesDeLaHoja_(libro, zona).map((m) => m.etiqueta);
  const etiqueta = meses.filter((e) => e.indexOf('Noviembre 2026') === 0)[0] || meses[0];
  const existiaHoja = !!libro.getSheetByName(PAG_HOJA_);

  // Validaciones (no escriben nada)
  const rec = libro.getSheetByName('Recurrentes');
  const tipos = rec.getRange(2, 1, rec.getLastRow() - 1, COL.TIPO).getValues();
  const presupuesto = tipos.filter((f) => String(f[COL.TIPO - 1]).trim() === 'presupuesto')[0];
  const casos = [
    ['mes inventado', { etiqueta: 'Mes inventado', id: 'R001', pagado: true }, 'entrada'],
    ['pagado no es sí/no', { etiqueta: etiqueta, id: 'R001', pagado: 'sí' }, 'entrada'],
    ['regla inexistente', { etiqueta: etiqueta, id: 'R999999', pagado: true }, 'rechazado']
  ];
  if (presupuesto) casos.push(['presupuesto (' + presupuesto[0] + ')', { etiqueta: etiqueta, id: String(presupuesto[0]), pagado: true }, 'rechazado']);
  let ok = 0;
  casos.forEach(([caso, params, esperado]) => {
    const r = pagar_(params);
    const bien = r.ok === false && r.error === esperado;
    if (bien) ok++;
    Logger.log((bien ? '✅ ' : '❌ ') + caso + ' → ' + (r.mensaje || r.error || JSON.stringify(r)));
  });
  Logger.log('Validaciones: ' + ok + '/' + casos.length);

  // Marcar y desmarcar de verdad, con limpieza en el finally.
  const antes = mes_({ etiqueta: etiqueta });
  const regla = [].concat(...antes.categorias.map((k) => k.reglas)).filter((g) => g.tipo !== 'presupuesto' && !g.pagado)[0];
  if (!regla) { Logger.log('No hay ningún cargo fijo sin pagar en ' + etiqueta + '.'); return; }
  Logger.log('== ' + etiqueta + ' · ' + regla.id + ' ' + regla.concepto + ' (' + regla.importe + ' €) · pendiente antes: ' +
             antes.cabecera.pendiente);
  try {
    pagar_({ etiqueta: etiqueta, id: regla.id, pagado: true });
    pagar_({ etiqueta: etiqueta, id: regla.id, pagado: true });   // otra vez: no debe duplicar
    const filas = filasPago_(hojaPagos_(libro), etiqueta, regla.id).length;
    Logger.log((filas === 1 ? '✅ ' : '❌ ') + 'Marcar dos veces → ' + filas + ' fila en Pagos');
    const marcado = mes_({ etiqueta: etiqueta });
    const g = [].concat(...marcado.categorias.map((k) => k.reglas)).filter((x) => x.id === regla.id)[0];
    const baja = Math.round((antes.cabecera.pendiente - regla.importe) * 100) / 100;
    Logger.log((g.pagado && marcado.cabecera.pendiente === baja ? '✅ ' : '❌ ') + 'Marcado: pagado ' + g.pagado +
               ' (' + g.pagado_el + ') · pendiente ' + marcado.cabecera.pendiente + ' (esperado ' + baja + ')');
    pagar_({ etiqueta: etiqueta, id: regla.id, pagado: false });
    const r2 = pagar_({ etiqueta: etiqueta, id: regla.id, pagado: false });   // otra vez: no debe fallar
    const desmarcado = mes_({ etiqueta: etiqueta });
    const vuelve = desmarcado.cabecera.pendiente === antes.cabecera.pendiente;
    Logger.log((vuelve && r2.ok !== false ? '✅ ' : '❌ ') + 'Desmarcado (dos veces): pendiente ' + desmarcado.cabecera.pendiente);
  } finally {
    const hoja = libro.getSheetByName(PAG_HOJA_);
    if (hoja) filasPago_(hoja, etiqueta, regla.id).reverse().forEach((f) => hoja.deleteRow(f));
    if (!existiaHoja && hoja) libro.deleteSheet(hoja);
    Logger.log('✅ Limpieza: la pestaña Pagos queda como estaba' + (existiaHoja ? '' : ' (no existía: borrada)'));
  }
}
