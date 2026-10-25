/**
 * Pagos.gs — Fases 8.2 y 11.1: marcar como pagados o pendientes los gastos de un mes.
 * Archivo nuevo. Cada gasto tiene un estado «normal»: un cargo fijo (R…) está pendiente hasta que se marca y un
 * gasto puntual (M…) está pagado al apuntarlo. La pestaña «Pagos» (Mes · ID · Marcado_el · Estado) guarda solo lo
 * que se aparta de lo normal: un cargo fijo pagado o un puntual pendiente. Volver a lo normal borra la fila.
 * Las filas de la 8.2 no tienen Estado y valen como «pagado». No cambia ninguna fórmula: es informativo.
 * La clave es mes + ID (no fecha_cargo, que las semanales no tienen). No usa ULTIMO: desmarcar es volver a tocar
 * la casilla, y así no se pisa el Deshacer de la última acción real.
 */

const PAG_HOJA_ = 'Pagos';
const PAG_COLUMNAS_ = ['Mes', 'ID', 'Marcado_el', 'Estado'];

/** Acción "pagar" de la API: { etiqueta, id, pagado } → marca o desmarca un cargo fijo o un gasto puntual. Idempotente. */
function pagar_(p) {
  const etiqueta = String(p.etiqueta == null ? '' : p.etiqueta);
  const id = String(p.id == null ? '' : p.id);
  if (typeof p.pagado !== 'boolean') return { ok: false, error: 'entrada' };
  const libro = libro_();   // v1
  const zona = libro.getSpreadsheetTimeZone();
  const mes = mesesDeLaHoja_(libro, zona).filter((m) => m.etiqueta === etiqueta)[0];   // Mes.gs
  if (!mes) return { ok: false, error: 'entrada' };

  return conBloqueo_(() => {   // v1: un acceso a la vez
    // Errores de negocio con un mensaje para el usuario: se devuelven, no se lanzan.
    const normal = estadoNormal_(libro, id, mes.inicio, zona);
    if (normal.error) return { ok: false, error: 'rechazado', mensaje: normal.error };

    const hoja = hojaPagos_(libro);
    const filas = filasPago_(hoja, etiqueta, id);
    let marcadoEl = null;
    if (p.pagado !== normal.pagado) {
      // Se aparta de lo normal: se guarda (una sola fila, aunque se marque dos veces).
      if (filas.length) {
        marcadoEl = textoFechaHora_(hoja.getRange(filas[0], 3).getValue(), zona);
      } else {
        const ahora = new Date();
        hoja.appendRow([etiqueta, id, ahora, p.pagado ? 'pagado' : 'pendiente']);
        hoja.getRange(hoja.getLastRow(), 3).setNumberFormat('dd/mm/yyyy hh:mm');
        marcadoEl = textoFechaHora_(ahora, zona);
      }
    } else {
      filas.reverse().forEach((f) => hoja.deleteRow(f));   // vuelve a lo normal; de abajo arriba
    }
    return { etiqueta: etiqueta, id: id, pagado: p.pagado, pagado_el: p.pagado ? marcadoEl : null };
  });
}

/**
 * Estado normal de un gasto en un mes: { pagado } o { error }.
 * Cargo fijo de Recurrentes → pendiente (los presupuestos no se marcan). Gasto puntual de Movimientos → pagado, y
 * tiene que ser de ese mes (el mismo mes natural que lee «Mes»: de B2 a B3 del Resumen).
 */
function estadoNormal_(libro, id, inicioMes, zona) {
  const rec = libro.getSheetByName('Recurrentes');
  const fr = buscarFilaPorId_(rec, id);   // v1
  if (fr > 0) {
    if (String(rec.getRange(fr, COL.TIPO).getValue()).trim() === 'presupuesto') {
      return { error: 'Los presupuestos no se marcan como pagados.' };
    }
    return { pagado: false };
  }
  const movs = libro.getSheetByName('Movimientos');
  const fm = buscarFilaPorId_(movs, id);
  if (fm > 0) {
    const fecha = textoFecha_(movs.getRange(fm, COLM.FECHA).getValue(), zona);   // Mes.gs; COLM es de la v1
    if (fecha.slice(0, 7) !== inicioMes.slice(0, 7)) return { error: 'Ese gasto no es de este mes. Recarga el mes.' };
    return { pagado: true };
  }
  return { error: 'Ese gasto ya no existe (¿se borró a mano?). Recarga el mes.' };
}

/**
 * Lo que se aparta de lo normal en un mes: { id: { estado: 'pagado' | 'pendiente', el: 'yyyy-MM-ddTHH:mm' } }.
 * Lo usa mes_ (Mes.gs). Una fila sin Estado (de la 8.2) es «pagado».
 */
function pagosDelMes_(libro, etiqueta, zona) {
  const hoja = libro.getSheetByName(PAG_HOJA_);
  const pagos = {};
  if (!hoja || hoja.getLastRow() < 2) return pagos;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 4).getValues().forEach((f) => {
    if (String(f[0]) === etiqueta && f[1]) {
      pagos[String(f[1])] = { estado: String(f[3]).trim() || 'pagado', el: textoFechaHora_(f[2], zona) };
    }
  });
  return pagos;
}

/** La pestaña Pagos; si no existe, la crea con su cabecera. Si es la de la 8.2, le añade la columna Estado. */
function hojaPagos_(libro) {
  let hoja = libro.getSheetByName(PAG_HOJA_);
  if (!hoja) {
    hoja = libro.insertSheet(PAG_HOJA_);
    hoja.appendRow(PAG_COLUMNAS_);
    hoja.setFrozenRows(1);
  } else if (!String(hoja.getRange(1, 4).getValue()).trim()) {
    hoja.getRange(1, 3, 1, 2).setValues([PAG_COLUMNAS_.slice(2)]);
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
 * Prueba desde el editor (sin la app): validaciones y, en noviembre, marcar y desmarcar un cargo fijo y un gasto
 * puntual de prueba comprobando el pendiente. Al terminar deja Movimientos y la pestaña Pagos como estaban (y la
 * borra si la creó la prueba).
 */
function probarPagos() {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const meses = mesesDeLaHoja_(libro, zona).map((m) => m.etiqueta);
  const etiqueta = meses.filter((e) => e.indexOf('Noviembre 2026') === 0)[0] || meses[0];
  const existiaHoja = !!libro.getSheetByName(PAG_HOJA_);

  // Validaciones (no escriben nada)
  const rec = libro.getSheetByName('Recurrentes');
  const antesFilas = libro.getSheetByName(PAG_HOJA_) ? libro.getSheetByName(PAG_HOJA_).getLastRow() : 0;
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
    const filasR = filasPago_(hojaPagos_(libro), etiqueta, regla.id);
    const estadoR = filasR.length ? hojaPagos_(libro).getRange(filasR[0], 4).getValue() : '';
    Logger.log((filasR.length === 1 && estadoR === 'pagado' ? '✅ ' : '❌ ') + 'Marcar dos veces → ' + filasR.length +
               ' fila en Pagos (Estado «' + estadoR + '»)');
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
  }

  // Fase 11.1: un gasto puntual de prueba en ese mes, que nace pagado. Se borra en el finally.
  const movs = libro.getSheetByName('Movimientos');
  const idM = siguienteId_(movs, 'M');   // v1
  const fechaM = mesesDeLaHoja_(libro, zona).filter((m) => m.etiqueta === etiqueta)[0].inicio.slice(0, 8) + '15';
  const cat = nombresCategorias_(libro.getSheetByName('Categorías'));   // Categorias.gs
  try {
    escribirFila_(movs, [idM, fechaSerial_(fechaM), 'Prueba 11.1', 12.34, cat.indexOf('Otros') >= 0 ? 'Otros' : cat[0],
                         'probarPagos', ahoraSerial_()], { 2: 'dd/mm/yyyy', 4: '#,##0.00 "€"', 7: 'dd/mm/yyyy hh:mm' });   // v1
    const puntual = (r) => [].concat(...r.categorias.map((k) => k.movimientos)).filter((m) => m.id === idM)[0];
    const base = mes_({ etiqueta: etiqueta });
    const m0 = puntual(base);
    Logger.log((m0 && m0.pagado === true ? '✅ ' : '❌ ') + 'Puntual ' + idM + ' (12,34 €) nace pagado · pendiente ' + base.cabecera.pendiente);

    pagar_({ etiqueta: etiqueta, id: idM, pagado: false });
    pagar_({ etiqueta: etiqueta, id: idM, pagado: false });   // otra vez: no debe duplicar
    const filasM = filasPago_(hojaPagos_(libro), etiqueta, idM);
    const estadoM = filasM.length ? hojaPagos_(libro).getRange(filasM[0], 4).getValue() : '';
    const pendienteM = mes_({ etiqueta: etiqueta });
    const sube = Math.round((base.cabecera.pendiente + 12.34) * 100) / 100;
    Logger.log((filasM.length === 1 && estadoM === 'pendiente' && puntual(pendienteM).pagado === false &&
                pendienteM.cabecera.pendiente === sube ? '✅ ' : '❌ ') + 'Desmarcar dos veces → ' + filasM.length +
               ' fila (Estado «' + estadoM + '») · pendiente ' + pendienteM.cabecera.pendiente + ' (esperado ' + sube + ')');

    pagar_({ etiqueta: etiqueta, id: idM, pagado: true });
    const otra = pagar_({ etiqueta: etiqueta, id: idM, pagado: true });   // otra vez: no debe fallar
    const vuelta = mes_({ etiqueta: etiqueta });
    Logger.log((otra.ok !== false && filasPago_(hojaPagos_(libro), etiqueta, idM).length === 0 && puntual(vuelta).pagado &&
                vuelta.cabecera.pendiente === base.cabecera.pendiente ? '✅ ' : '❌ ') +
               'Marcar otra vez (dos veces) → sin filas · pendiente ' + vuelta.cabecera.pendiente);

    const otroMes = meses.filter((e) => e !== etiqueta)[0];
    const ajeno = pagar_({ etiqueta: otroMes, id: idM, pagado: false });
    Logger.log((ajeno.ok === false && ajeno.error === 'rechazado' ? '✅ ' : '❌ ') + 'En otro mes (' + otroMes + ') → ' +
               (ajeno.mensaje || JSON.stringify(ajeno)));
  } finally {
    let f;
    while ((f = buscarFilaPorId_(movs, idM)) > 0) movs.deleteRow(f);
    const hoja = libro.getSheetByName(PAG_HOJA_);
    if (hoja) filasPago_(hoja, etiqueta, idM).reverse().forEach((x) => hoja.deleteRow(x));
    if (!existiaHoja && hoja) libro.deleteSheet(hoja);
    const ahora = libro.getSheetByName(PAG_HOJA_) ? libro.getSheetByName(PAG_HOJA_).getLastRow() : 0;
    Logger.log((ahora === antesFilas && buscarFilaPorId_(movs, idM) < 0 ? '✅ ' : '❌ ') +
               'Limpieza: Movimientos y la pestaña Pagos quedan como estaban' + (existiaHoja ? '' : ' (no existía: borrada)'));
  }
}
