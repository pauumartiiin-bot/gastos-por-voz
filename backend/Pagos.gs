/**
 * Pagos.gs — Fases 8.2 y 11.1: marcar como pagados o pendientes los gastos de un mes.
 * Archivo nuevo. Cada gasto tiene un estado «normal»: un cargo fijo (R…) está pendiente hasta que se marca y un
 * gasto puntual (M…) está pagado al apuntarlo. La pestaña «Pagos» (Mes · ID · Marcado_el · Estado) guarda solo lo
 * que se aparta de lo normal: un cargo fijo pagado o un puntual pendiente. Volver a lo normal borra la fila.
 * Las filas de la 8.2 no tienen Estado y valen como «pagado». No cambia ninguna fórmula: es informativo.
 * La clave es mes + ID (no fecha_cargo, que las semanales no tienen). No usa ULTIMO: desmarcar es volver a tocar
 * la casilla, y así no se pisa el Deshacer de la última acción real.
 * Fase 13: un gasto puntual puede cambiar de mes al apuntar una nómina (su periodo se mueve), así que su marca va
 * con su ID, sea cual sea el mes de la fila; al volver a marcarlo, la fila pasa al mes actual.
 * Fase 11.3: tras borrar un gasto, sus filas se limpian (la v1 reutiliza los IDs: el siguiente gasto las heredaría).
 * Fase 17: una regla con varias veces en el mes (mensual con Veces_mes o semanal) tiene una casilla por vez y su clave es
 * «R011#2» (partirId_, Veces.gs). Las de una sola vez siguen siendo «R011» (y aceptan también «R011#1», la marca que queda
 * al bajar de varias veces a una). Una fila antigua sin «#» en una regla de varias veces significa «todo pagado»; al tocar
 * una de sus líneas se separa en una fila por vez.
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
    const normal = estadoNormal_(libro, id, mes, zona);
    if (normal.error) return { ok: false, error: 'rechazado', mensaje: normal.error };

    const hoja = hojaPagos_(libro);
    const vez = partirId_(id);   // Veces.gs
    if (vez.vez != null) separarMarcaAntigua_(libro, hoja, etiqueta, vez.base);   // fase 17
    const filas = filasPago_(hoja, etiqueta, id, true);
    let marcadoEl = null;
    if (p.pagado !== normal.pagado) {
      // Se aparta de lo normal: se guarda (una sola fila, aunque se marque dos veces).
      if (filas.length) {
        hoja.getRange(filas[0], 1).setValue(etiqueta);   // un puntual que cambió de mes: la fila pasa al actual
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
 * tiene que ser de ese mes: su fecha, dentro del periodo del mes (Meses E:F, fase 13), como en «Mes».
 */
function estadoNormal_(libro, id, mes, zona) {
  const rec = libro.getSheetByName('Recurrentes');
  const { base, vez } = partirId_(id);   // Veces.gs: «R011#2» es la 2.ª vez de la R011 (fase 17)
  const fr = buscarFilaPorId_(rec, base);   // v1
  if (fr > 0) {
    const f = rec.getRange(fr, 1, 1, VEC_COL_).getValues()[0];
    if (String(f[COL.TIPO - 1]).trim() === 'presupuesto') {
      return { error: 'Los presupuestos no se marcan como pagados.' };
    }
    if (vez != null && (vez < 1 || vez > maxVecesRegla_(f))) return { error: 'Esa vez ya no existe. Recarga el mes.' };
    return { pagado: false };
  }
  if (vez != null) return { error: 'Ese gasto ya no existe (¿se borró a mano?). Recarga el mes.' };
  const movs = libro.getSheetByName('Movimientos');
  const fm = buscarFilaPorId_(movs, id);
  if (fm > 0) {
    const fecha = textoFecha_(movs.getRange(fm, COLM.FECHA).getValue(), zona);   // Mes.gs; COLM es de la v1
    if (!(fecha >= mes.periodo_inicio && fecha <= mes.periodo_fin)) return { error: 'Ese gasto no es de este mes. Recarga el mes.' };
    return { pagado: true };
  }
  return { error: 'Ese gasto ya no existe (¿se borró a mano?). Recarga el mes.' };
}

/**
 * Lo que se aparta de lo normal en un mes: { id: { estado: 'pagado' | 'pendiente', el: 'yyyy-MM-ddTHH:mm' } }.
 * Lo usa mes_ (Mes.gs). Una fila sin Estado (de la 8.2) es «pagado». Las de los puntuales valen en cualquier mes
 * (fase 13): mes_ solo pinta los movimientos del periodo, así que a cada mes le llegan los suyos.
 */
function pagosDelMes_(libro, etiqueta, zona) {
  const hoja = libro.getSheetByName(PAG_HOJA_);
  const pagos = {};
  if (!hoja || hoja.getLastRow() < 2) return pagos;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 4).getValues().forEach((f) => {
    if (f[1] && (String(f[0]) === etiqueta || esPuntual_(f[1]))) {
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

/**
 * Borra de Pagos las filas de gastos que ya no existen en Recurrentes ni en Movimientos. Hace falta porque la v1
 * numera desde el ID más alto: tras borrar el M031, el siguiente gasto vuelve a ser M031 y heredaría su marca.
 * Devuelve los IDs borrados. Llamar dentro de conBloqueo_.
 */
function limpiarPagosHuerfanos_(libro) {
  const hoja = libro.getSheetByName(PAG_HOJA_);
  if (!hoja || hoja.getLastRow() < 2) return [];
  // ID → cuántas veces puede tener en un mes (fase 17): las marcas «R011#3» de una regla que ya solo tiene 2 sobran.
  const existen = {};
  const rec = libro.getSheetByName('Recurrentes');
  if (rec.getLastRow() > 1) {
    rec.getRange(2, 1, rec.getLastRow() - 1, VEC_COL_).getValues().forEach((f) => { existen[String(f[0])] = maxVecesRegla_(f); });   // Veces.gs
  }
  const movs = libro.getSheetByName('Movimientos');
  if (movs.getLastRow() > 1) movs.getRange(2, 1, movs.getLastRow() - 1, 1).getValues().forEach((f) => { existen[String(f[0])] = 1; });
  const ids = hoja.getRange(2, 2, hoja.getLastRow() - 1, 1).getValues().map((f) => String(f[0]));
  const borrados = [];
  for (let i = ids.length - 1; i >= 0; i--) {   // de abajo arriba, para no mover las filas pendientes
    const { base, vez } = partirId_(ids[i]);
    if (!existen[base] || (vez != null && vez > existen[base])) {
      hoja.deleteRow(i + 2);
      borrados.unshift(ids[i]);
    }
  }
  return borrados;
}

/** Lo llama doPost (Api.gs) tras «eliminar» y «deshacer». La acción ya está hecha: si la limpieza falla, solo se apunta. */
function limpiarPagosTrasBorrar_() {
  try {
    conBloqueo_(() => limpiarPagosHuerfanos_(libro_()));   // v1
  } catch (err) {
    console.error(err);
  }
}

/** Desde el editor: limpia Pagos a mano (por ejemplo, después de borrar gastos directamente en la hoja). */
function limpiarPagos() {
  const borrados = conBloqueo_(() => limpiarPagosHuerfanos_(libro_()));
  Logger.log(borrados.length ? 'Filas huérfanas borradas: ' + borrados.join(', ') : 'No había filas huérfanas.');
}

/**
 * Números de fila (de arriba abajo) con ese mes e ID; las de un gasto puntual, solo por su ID (fase 13). Con `alias`, las
 * de un cargo de una sola vez («R011») incluyen también su «R011#1» (fase 17).
 */
function filasPago_(hoja, etiqueta, id, alias) {
  if (hoja.getLastRow() < 2) return [];
  const ids = [id];
  if (alias && !esPuntual_(id) && partirId_(id).vez == null) ids.push(id + '#1');   // Veces.gs
  const filas = [];
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues().forEach((f, i) => {
    if (ids.indexOf(String(f[1])) >= 0 && (esPuntual_(id) || String(f[0]) === etiqueta)) filas.push(i + 2);
  });
  return filas;
}

/**
 * Fase 17: una fila antigua «R011» (sin número) en una regla que ese mes tiene varias veces significa «todas pagadas».
 * Antes de tocar una de sus líneas se separa en una fila por vez («R011#1»…), con la misma fecha. Las veces de ese mes
 * las calcula la hoja (Cálculo!O), así que hay que poner el mes en B1 (enMes_): solo pasa en este caso.
 */
function separarMarcaAntigua_(libro, hoja, etiqueta, base) {
  const antiguas = filasPago_(hoja, etiqueta, base);
  if (!antiguas.length) return;
  const fila = buscarFilaPorId_(libro.getSheetByName('Recurrentes'), base);   // v1; Cálculo va por número de fila
  const veces = Number(enMes_(libro, etiqueta, () => libro.getSheetByName('Cálculo').getRange(fila, 15).getValue())) || 1;   // Mes.gs
  const el = hoja.getRange(antiguas[0], 3).getValue();
  antiguas.reverse().forEach((f) => hoja.deleteRow(f));
  for (let k = 1; k <= veces; k++) {
    hoja.appendRow([etiqueta, base + '#' + k, el, 'pagado']);
    hoja.getRange(hoja.getLastRow(), 3).setNumberFormat('dd/mm/yyyy hh:mm');
  }
}

/** ¿Es un gasto puntual (Movimientos, M…)? Los cargos fijos son R…. */
function esPuntual_(id) {
  return /^M/.test(String(id));
}

function textoFechaHora_(d, zona) {
  return d instanceof Date ? Utilities.formatDate(d, zona, "yyyy-MM-dd'T'HH:mm") : null;
}

/**
 * Prueba desde el editor (sin la app): la limpieza de filas huérfanas, las validaciones y, en noviembre, marcar y
 * desmarcar un cargo fijo y un gasto puntual de prueba comprobando el pendiente. Al terminar deja Movimientos y la
 * pestaña Pagos como estaban (y la borra si la creó la prueba); si ya había filas huérfanas reales, quedan borradas.
 */
function probarPagos() {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const meses = mesesDeLaHoja_(libro, zona).map((m) => m.etiqueta);
  const etiqueta = meses.filter((e) => e.indexOf('Noviembre 2026') === 0)[0] || meses[0];
  const existiaHoja = !!libro.getSheetByName(PAG_HOJA_);

  // Fase 11.3: dos filas de gastos que no existen → la limpieza las borra y no toca las demás.
  const hojaH = hojaPagos_(libro);
  const filasH = hojaH.getLastRow();
  try {
    hojaH.appendRow([etiqueta, 'R999999', new Date(), 'pagado']);
    hojaH.appendRow([etiqueta, 'M999999', new Date(), 'pendiente']);
    const borrados = limpiarPagosHuerfanos_(libro);
    const reales = borrados.filter((id) => id !== 'R999999' && id !== 'M999999');
    const bien = borrados.indexOf('R999999') >= 0 && borrados.indexOf('M999999') >= 0 &&
                 hojaH.getLastRow() === filasH - reales.length;
    Logger.log((bien ? '✅ ' : '❌ ') + 'Limpieza de huérfanas → borra R999999 y M999999' +
               (reales.length ? ' y también las huérfanas reales que había: ' + reales.join(', ') : ' y nada más'));
  } finally {
    ['R999999', 'M999999'].forEach((id) => filasPago_(hojaH, etiqueta, id).reverse().forEach((f) => hojaH.deleteRow(f)));
  }

  // Validaciones (no escriben nada)
  const rec = libro.getSheetByName('Recurrentes');
  const antesFilas = existiaHoja ? libro.getSheetByName(PAG_HOJA_).getLastRow() : 0;
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
