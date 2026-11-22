/**
 * Excepciones.gs — Fase 23: las veces de un recurrente solo en un mes (el barbero, 1 vez en noviembre aunque normalmente
 * son 2; 0 = ese mes no se cobra). Archivo nuevo.
 *  - Pestaña «Excepciones»: ID (X001) · Creado · Mes (etiqueta de Meses) · Regla (R…) · Veces (0–10). Una fila por mes y
 *    regla. El ID va en la columna A porque el Deshacer de la v1 busca las filas por ella (pasos «borrar» y «celda»); al
 *    recuperar una fila («fila») formatea las columnas 2, 4 y 7 como las de Movimientos: aquí son Creado (fecha), Regla
 *    (texto: el formato de euros no le hace nada) y una vacía.
 *  - La hoja calcula: Cálculo!R usa la excepción del mes de Resumen!B1 si la hay (aplicarFase23, Migraciones.gs). O, P, el
 *    Resumen, «Mes» y `cuadra` salen solos.
 *  - Solo mensuales que no son presupuesto (los que tienen «Veces al mes») y solo en un mes en que la regla tiene cargo.
 *    Poner las veces habituales es volver a lo habitual: se borra la fila.
 *  - Lo que depende de las veces de un mes: Pagos (al bajar, se borran las marcas que sobran; la limpieza y «pagar» usan
 *    las veces del mes, no las de la regla), el cambio de precio (las excepciones desde el primer cargo de la regla nueva
 *    pasan a ella) y los IDs reutilizados (tras eliminar o deshacer, se borran las excepciones de reglas que no existen).
 */

const EXC_HOJA_ = 'Excepciones';
const EXC_COL_ = { ID: 1, CREADO: 2, MES: 3, REGLA: 4, VECES: 5 };

/** Las filas de Excepciones: [{ fila, id, mes, regla, veces }]. Sin la pestaña (antes de la fase 23), ninguna. */
function leerExcepciones_(libro) {
  const h = libro.getSheetByName(EXC_HOJA_);
  if (!h || h.getLastRow() < 2) return [];
  return h.getRange(2, 1, h.getLastRow() - 1, EXC_COL_.VECES).getValues()
    .map((f, i) => ({ fila: i + 2, id: String(f[0]), mes: String(f[EXC_COL_.MES - 1]), regla: String(f[EXC_COL_.REGLA - 1]),
                      veces: Number(f[EXC_COL_.VECES - 1]) }))
    .filter((x) => x.id && x.mes && x.regla);
}

/** { regla: veces } de un mes. */
function excepcionesDelMes_(libro, etiqueta) {
  const r = {};
  leerExcepciones_(libro).filter((x) => x.mes === etiqueta).forEach((x) => { r[x.regla] = x.veces; });
  return r;
}

/** { 'mes|regla': veces } de todos los meses (para la limpieza de Pagos). */
function excepcionesPorMes_(libro) {
  const r = {};
  leerExcepciones_(libro).forEach((x) => { r[x.mes + '|' + x.regla] = x.veces; });
  return r;
}

/**
 * Lo que hay que hacer con `veces_mes: { etiqueta, veces }` o `{ etiqueta, habitual: true }`, ya validado: { vecesMes } o
 * { error }. Comprueba en la hoja (enMes_, ~1,5 s si B1 no está ya en ese mes) que ese mes la regla tiene cargo.
 */
function planVecesMes_(libro, vm, esRec, actual, filaRegla, meses) {
  if (!esRec) return { error: 'Solo los gastos recurrentes tienen veces al mes.' };
  if (!vm || typeof vm !== 'object') return { error: 'Indica el mes y las veces.' };
  const etiqueta = String(vm.etiqueta == null ? '' : vm.etiqueta);
  if (!meses.some((m) => m.etiqueta === etiqueta)) return { error: 'Ese mes no está en la pestaña Meses.' };
  if (String(actual[COL.TIPO - 1]).trim() === 'presupuesto') return { error: 'Un presupuesto no se cobra: no tiene veces al mes.' };   // COL, v1
  if (String(actual[COL.FREC - 1]).trim() !== 'mensual') {
    return { error: 'Solo los gastos mensuales cambian sus veces en un mes (los semanales ya llevan una casilla por semana).' };
  }
  const habituales = vecesDe_(actual[VEC_COL_ - 1]);   // Veces.gs
  const regla = String(actual[0]);
  const actualExc = leerExcepciones_(libro).filter((x) => x.mes === etiqueta && x.regla === regla)[0] || null;
  let veces;
  if (vm.habitual === true) {
    if (!actualExc) return { error: 'Ese mes ya va con las veces habituales.' };
    veces = habituales;
  } else {
    veces = vm.veces;
    if (!(typeof veces === 'number' && Number.isInteger(veces) && veces >= 0 && veces <= VEC_MAX_)) {
      return { error: 'Las veces de un mes tienen que ser un número entero del 0 al ' + VEC_MAX_ + '.' };
    }
    const ahora = actualExc ? actualExc.veces : habituales;
    if (veces === ahora) return { error: 'Ese mes ya va con ' + textoVeces_(veces) + '.' };
  }
  // Ese mes, ¿tiene cargo? Cálculo va por número de fila (la de Recurrentes): su N es la fecha del cargo del mes de B1.
  const cargo = conBloqueo_(() => enMes_(libro, etiqueta, () => libro.getSheetByName('Cálculo').getRange(filaRegla, 14).getValue()));   // v1, Mes.gs
  if (!(cargo instanceof Date)) return { error: 'En ' + etiqueta.split(' (')[0] + ' no hay cargo de «' + actual[COL.CONCEPTO - 1] + '».' };
  return { vecesMes: { etiqueta: etiqueta, regla: regla, veces: veces, habituales: habituales,
                       antes: actualExc ? actualExc.veces : habituales, excepcion: actualExc,
                       accion: veces === habituales ? 'quitar' : actualExc ? 'cambiar' : 'crear' } };
}

/**
 * Escribe la excepción (crear, cambiar o quitar) y borra las marcas de Pagos que sobran ese mes. Devuelve los pasos de
 * Deshacer de la excepción (las marcas borradas no vuelven: como al bajar las veces en la fase 17).
 */
function aplicarVecesMes_(vm) {
  return conBloqueo_(() => {   // v1
    const libro = libro_();   // v1
    const h = libro.getSheetByName(EXC_HOJA_);
    if (!h) throw new Error('Falta la pestaña «Excepciones» (aplicarFase23).');
    let pasos;
    if (vm.accion === 'crear') {
      const id = siguienteId_(h, 'X');   // v1
      escribirFila_(h, [id, ahoraSerial_(), vm.etiqueta, vm.regla, vm.veces], { 2: 'dd/mm/yyyy hh:mm' });   // v1
      pasos = [{ op: 'borrar', hoja: EXC_HOJA_, id: id }];
    } else {
      const fila = buscarFilaPorId_(h, vm.excepcion.id);   // v1
      if (fila < 0) throw new Error('Esa excepción ya no existe. Recarga el mes.');
      if (vm.accion === 'cambiar') {
        h.getRange(fila, EXC_COL_.VECES).setValue(vm.veces);
        pasos = [{ op: 'celda', hoja: EXC_HOJA_, id: vm.excepcion.id, col: EXC_COL_.VECES, valor: vm.antes }];
      } else {
        const valores = h.getRange(fila, 1, 1, EXC_COL_.VECES).getValues()[0].map(aJSON_);   // v1
        h.deleteRow(fila);
        pasos = [{ op: 'fila', hoja: EXC_HOJA_, valores: valores }];
      }
    }
    ajustarPagosDelMes_(libro, vm.etiqueta, vm.regla, vm.antes, vm.veces);
    return pasos;
  });
}

/**
 * Las marcas de Pagos de una regla en un mes cuando sus veces pasan de `antes` a `despues`: con 0, ninguna; con menos, se
 * borran las «#n» que sobran; de 1 a más, una marca «R011» (una sola vez, pagada) pasa a «R011#1» (si no, como marca
 * antigua de la fase 17, daría por pagadas todas las veces).
 */
function ajustarPagosDelMes_(libro, etiqueta, regla, antes, despues) {
  const hoja = libro.getSheetByName(PAG_HOJA_);   // Pagos.gs
  if (!hoja || hoja.getLastRow() < 2) return;
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues();
  for (let i = filas.length - 1; i >= 0; i--) {   // de abajo arriba, para no mover las que quedan por mirar
    if (String(filas[i][0]) !== etiqueta) continue;
    const { base, vez } = partirId_(filas[i][1]);   // Veces.gs
    if (base !== regla) continue;
    if (despues === 0 || (vez != null && vez > despues)) hoja.deleteRow(i + 2);
    else if (vez == null && antes <= 1 && despues > 1) hoja.getRange(i + 2, 2).setValue(regla + '#1');
  }
}

/** Las veces que puede tener una regla (fila de Recurrentes A–N) en un mes: su excepción si la hay; si no, maxVecesRegla_. */
function maxVecesEnMes_(f, etiqueta, excepciones) {
  const clave = etiqueta + '|' + String(f[0]);
  return clave in excepciones ? excepciones[clave] : maxVecesRegla_(f);   // Veces.gs
}

/**
 * Tras un cambio de precio (la v1 cierra la regla y crea otra), las excepciones de la regla vieja en los meses desde el
 * primer cargo de la nueva pasan a la nueva. Devuelve sus pasos de Deshacer (Regla vuelve a la vieja).
 */
function moverExcepcionesTrasCambioDePrecio_(libro, id, idNuevo) {
  return conBloqueo_(() => {   // v1
    const exc = leerExcepciones_(libro).filter((x) => x.regla === id);
    if (!exc.length || !idNuevo) return [];
    const zona = libro.getSpreadsheetTimeZone();
    const rec = libro.getSheetByName('Recurrentes');
    const fila = buscarFilaPorId_(rec, idNuevo);   // v1
    if (fila < 0) return [];
    const desde = textoFecha_(rec.getRange(fila, COL.INICIO).getValue(), zona).slice(0, 7);   // Mes.gs; COL, v1
    const inicioDe = {};
    mesesDeLaHoja_(libro, zona).forEach((m) => { inicioDe[m.etiqueta] = m.inicio; });   // Mes.gs
    const h = libro.getSheetByName(EXC_HOJA_);
    const pasos = [];
    exc.filter((x) => inicioDe[x.mes] && inicioDe[x.mes].slice(0, 7) >= desde).forEach((x) => {
      h.getRange(x.fila, EXC_COL_.REGLA).setValue(idNuevo);
      pasos.push({ op: 'celda', hoja: EXC_HOJA_, id: x.id, col: EXC_COL_.REGLA, valor: id });
    });
    return pasos;
  });
}

/**
 * Borra las excepciones de reglas que ya no existen: la v1 numera desde el ID más alto y la siguiente regla heredaría las
 * de una borrada (como las marcas de Pagos, fase 11.3). Llamar dentro de conBloqueo_. Devuelve los IDs borrados.
 */
function limpiarExcepcionesHuerfanas_(libro) {
  const h = libro.getSheetByName(EXC_HOJA_);
  if (!h || h.getLastRow() < 2) return [];
  const rec = libro.getSheetByName('Recurrentes');
  const existen = {};
  if (rec.getLastRow() > 1) rec.getRange(2, 1, rec.getLastRow() - 1, 1).getValues().forEach((f) => { existen[String(f[0])] = true; });
  const filas = h.getRange(2, 1, h.getLastRow() - 1, EXC_COL_.REGLA).getValues();
  const borrados = [];
  for (let i = filas.length - 1; i >= 0; i--) {
    if (filas[i][0] && !existen[String(filas[i][EXC_COL_.REGLA - 1])]) {
      h.deleteRow(i + 2);
      borrados.unshift(String(filas[i][0]));
    }
  }
  return borrados;
}

/** Lo llama doPost (Api.gs) tras «eliminar» y «deshacer». La acción ya está hecha: si la limpieza falla, solo se apunta. */
function limpiarExcepcionesTrasBorrar_() {
  try {
    conBloqueo_(() => limpiarExcepcionesHuerfanas_(libro_()));   // v1
  } catch (err) {
    console.error(err);
  }
}

/**
 * Prueba desde el editor (fase 23), con una regla mensual de prueba de 2 veces a 10 € desde el penúltimo mes de Meses (sin
 * fin: el cambio de precio de la v1 exige que queden cargos después). Limpieza en finally: Recurrentes, Cálculo,
 * Excepciones, Pagos y el Deshacer pendiente como estaban.
 */
function probarExcepciones() {
  const libro = libro_();   // v1
  const zona = libro.getSpreadsheetTimeZone();
  const rec = libro.getSheetByName('Recurrentes');
  const calc = libro.getSheetByName('Cálculo');
  const exc = libro.getSheetByName(EXC_HOJA_);
  if (!exc) return Logger.log('❌ Falta la pestaña «Excepciones»: ejecuta antes aplicarFase23().');
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TOKEN');
  const ultimo = props.getProperty('ULTIMO');
  const filasRec = rec.getLastRow();
  const filasCalc = calc.getLastRow();
  const filasExc = exc.getLastRow();
  const meses = mesesDeLaHoja_(libro, zona);   // Mes.gs
  if (meses.length < 3) return Logger.log('❌ Hacen falta al menos 3 meses en la pestaña Meses.');
  const n = meses[meses.length - 2];   // el mes de las excepciones
  const n1 = meses[meses.length - 1];  // el siguiente, sin excepciones
  const cat = nombresCategorias_(libro.getSheetByName('Categorías'));   // Categorias.gs
  const categoria = cat.indexOf('Otros') >= 0 ? 'Otros' : cat[0];
  const ids = [];
  const log = (bien, texto) => Logger.log((bien ? '✅ ' : '❌ ') + texto);
  const nombreMes = (m) => m.etiqueta.split(' (')[0];
  // Las líneas de la regla de prueba en «Mes» y la suma de las cifras que interesan.
  const enMes = (m, id) => {
    const r = mes_({ etiqueta: m.etiqueta });   // Mes.gs
    const lineas = [].concat(...r.categorias.map((k) => k.reglas)).filter((g) => (g.base || g.id) === id);
    return { r: r, lineas: lineas, total: lineas.reduce((t, g) => t + g.importe, 0) };
  };
  const guardar = (params) => guardarRegistro_(Object.assign({ hoja: 'Recurrentes' }, params), token);   // Guardar.gs
  const filaExc = (id, m) => leerExcepciones_(libro).filter((x) => x.regla === id && x.mes === m.etiqueta)[0] || null;
  try {
    const regla = siguienteId_(rec, 'R');   // v1
    escribirFila_(rec, [regla, 'Prueba 23', 10, categoria, 'fijo', 'mensual', '', fechaSerial_(n.inicio), '', '', 'Sí',
                        'probarExcepciones', ahoraSerial_()], FORMATOS_REC);   // v1
    ids.push(regla);
    rec.getRange(buscarFilaPorId_(rec, regla), VEC_COL_).setValue(2);   // Veces.gs: 2 veces al mes
    asegurarFilasCalculo_();   // v1

    // Validaciones: nada se escribe.
    const casos = [
      ['11 veces', { etiqueta: n.etiqueta, veces: 11 }],
      ['−1 veces', { etiqueta: n.etiqueta, veces: -1 }],
      ['texto', { etiqueta: n.etiqueta, veces: 'una' }],
      ['mes inventado', { etiqueta: 'Mes inventado', veces: 1 }],
      ['las mismas veces (2)', { etiqueta: n.etiqueta, veces: 2 }],
      ['volver a lo habitual sin excepción', { etiqueta: n.etiqueta, habitual: true }],
      ['un mes sin cargo (antes del inicio)', { etiqueta: meses[meses.length - 3].etiqueta, veces: 1 }]
    ];
    const anuladas = [['semanal', 'semanal', 'fijo'], ['presupuesto', 'mensual', 'presupuesto']];
    let ok = 0;
    casos.forEach(([caso, vm]) => {
      const antes = props.getProperty('ULTIMO');
      const r = guardar({ id: regla, veces_mes: vm });
      const bien = r.ok === false && r.error === 'rechazado' && exc.getLastRow() === filasExc && props.getProperty('ULTIMO') === antes;
      if (bien) ok++;
      log(bien, caso + ' → ' + (r.mensaje || r.error || 'se guardó (no debería)'));
    });
    anuladas.forEach(([caso, frecuencia, tipo]) => {   // la misma regla, como semanal o presupuesto, un momento
      const fila = buscarFilaPorId_(rec, regla);
      rec.getRange(fila, COL.FREC).setValue(frecuencia);
      rec.getRange(fila, COL.TIPO).setValue(tipo);
      const r = guardar({ id: regla, veces_mes: { etiqueta: n.etiqueta, veces: 1 } });
      rec.getRange(fila, COL.FREC).setValue('mensual');
      rec.getRange(fila, COL.TIPO).setValue('fijo');
      const bien = r.ok === false && r.error === 'rechazado' && exc.getLastRow() === filasExc;
      if (bien) ok++;
      log(bien, 'un ' + caso + ' → ' + (r.mensaje || r.error || 'se guardó (no debería)'));
    });
    Logger.log('Validaciones: ' + ok + '/' + (casos.length + anuladas.length));

    // 1 vez en N → una línea de 10 €; N+1 sigue con 2 veces y 20 €; cuadra en los dos.
    const a = guardar({ id: regla, veces_mes: { etiqueta: n.etiqueta, veces: 1 } });
    const a1 = enMes(n, regla);
    const a2 = enMes(n1, regla);
    log(a.ok !== false && a1.lineas.length === 1 && a1.total === 10 && a1.lineas[0].excepcion === 1 && a1.lineas[0].veces_normales === 2 &&
        a2.lineas.length === 2 && a2.total === 20 && a1.r.cuadra && a2.r.cuadra,
        '1 vez en ' + nombreMes(n) + ' → ' + (a.desc || a.mensaje) + ' · ' + nombreMes(n) + ': ' + a1.lineas.length + ' línea(s), ' + a1.total +
        ' € · ' + nombreMes(n1) + ': ' + a2.lineas.length + ' líneas, ' + a2.total + ' € · cuadra ' + a1.r.cuadra + '/' + a2.r.cuadra);

    // Deshacer → sin excepción (vuelve a 2).
    const d = deshacer(token);   // v1
    const d1 = enMes(n, regla);
    log(!filaExc(regla, n) && d1.lineas.length === 2, 'Deshacer → ' + d.desc + ' · ' + nombreMes(n) + ' vuelve a ' + d1.lineas.length + ' líneas');

    // 0 veces → la regla sale como «este mes no», sin importe y sin casilla; cuadra.
    guardar({ id: regla, veces_mes: { etiqueta: n.etiqueta, veces: 0 } });
    const c1 = enMes(n, regla);
    log(c1.lineas.length === 1 && c1.lineas[0].sin_cargo === true && c1.total === 0 && c1.r.cuadra,
        '0 veces → ' + c1.lineas.length + ' línea «este mes no» (sin_cargo ' + (c1.lineas[0] && c1.lineas[0].sin_cargo) + ', ' + c1.total + ' €) · cuadra ' + c1.r.cuadra);

    // 3 veces (de 0 a 3: cambiar la excepción) → tres líneas, y la 3.ª se puede marcar.
    const b = guardar({ id: regla, veces_mes: { etiqueta: n.etiqueta, veces: 3 } });
    const b1 = enMes(n, regla);
    const marcar3 = pagar_({ etiqueta: n.etiqueta, id: regla + '#3', pagado: true });   // Pagos.gs
    log(b1.lineas.length === 3 && b1.total === 30 && marcar3.ok !== false && b1.r.cuadra,
        '3 veces → ' + b.desc + ' · ' + b1.lineas.length + ' líneas, ' + b1.total + ' € · marcar la 3.ª: ' + (marcar3.ok === false ? marcar3.mensaje : 'sí'));

    // La limpieza de Pagos no borra la «#3» (vale por la excepción); bajar a 1 sí (y la «#2»).
    pagar_({ etiqueta: n.etiqueta, id: regla + '#2', pagado: true });
    limpiarPagosHuerfanos_(libro);   // Pagos.gs
    const marcas = () => enMes(n, regla).lineas.filter((g) => g.pagado).map((g) => g.id).join(',');
    const m1 = marcas();
    guardar({ id: regla, veces_mes: { etiqueta: n.etiqueta, veces: 1 } });
    const m2 = enMes(n, regla);
    log(m1 === regla + '#2,' + regla + '#3' && m2.lineas.length === 1 && !m2.lineas[0].pagado,
        'Marcas: con 3 veces, la limpieza respeta ' + m1 + ' · al bajar a 1, la línea única sin marca (' + m2.lineas.map((g) => g.id + (g.pagado ? ' pagada' : '')).join(',') + ')');

    // De 1 vez a 2 con la línea única pagada (marca «R…») en un mes de 1 vez habitual: la marca pasa a «#1».
    rec.getRange(buscarFilaPorId_(rec, regla), VEC_COL_).clearContent();   // 1 vez habitual
    guardar({ id: regla, veces_mes: { etiqueta: n.etiqueta, habitual: true } });
    pagar_({ etiqueta: n.etiqueta, id: regla, pagado: true });
    guardar({ id: regla, veces_mes: { etiqueta: n.etiqueta, veces: 2 } });
    const u = enMes(n, regla).lineas.map((g) => g.id + (g.pagado ? ' pagada' : '')).join(',');
    log(u === regla + '#1 pagada,' + regla + '#2', 'De 1 a 2 veces con la única pagada → ' + u);
    rec.getRange(buscarFilaPorId_(rec, regla), VEC_COL_).setValue(2);

    // Volver a lo habitual → sin fila (con 2 habituales y la excepción de 2… se quita) y Deshacer la devuelve.
    guardar({ id: regla, veces_mes: { etiqueta: n.etiqueta, veces: 1 } });
    const h = guardar({ id: regla, veces_mes: { etiqueta: n.etiqueta, habitual: true } });
    const h1 = !filaExc(regla, n);
    deshacer(token);
    const h2 = filaExc(regla, n);
    log(h1 && h2 && h2.veces === 1, 'Volver a lo habitual → ' + h.desc + ' · Deshacer → vuelve la excepción de ' + (h2 && h2.veces));

    // Cambio de precio desde N+1: la excepción de N se queda en la regla vieja; una de N+1 pasa a la nueva; Deshacer las devuelve.
    guardar({ id: regla, veces_mes: { etiqueta: n1.etiqueta, veces: 1 } });
    const e = guardar({ id: regla, cambios: { importe: 11, modo: 'cambioPrecio', desde: n1.inicio } });
    const nueva = e.id_nuevo;
    if (nueva) ids.push(nueva);
    const e1 = [filaExc(regla, n), filaExc(nueva, n1)];
    deshacer(token);
    const e2 = [filaExc(regla, n), filaExc(regla, n1)];
    log(nueva && e1[0] && e1[1] && e2[0] && e2[1], 'Cambio de precio → ' + e.desc + ' · ' + nombreMes(n) + ' en ' + regla + ': ' + !!e1[0] + ', ' +
        nombreMes(n1) + ' en ' + nueva + ': ' + !!e1[1] + ' · Deshacer → las dos en ' + regla + ': ' + (!!e2[0] && !!e2[1]));

    // Huérfanas: borrar la regla (v1) deja sus excepciones sin regla → la limpieza las borra.
    eliminarRegistro(token, 'Recurrentes', regla);   // v1
    const borradas = limpiarExcepcionesHuerfanas_(libro);
    log(borradas.length === 2 && !leerExcepciones_(libro).some((x) => x.regla === regla),
        'Excepciones huérfanas tras eliminar la regla → borradas ' + borradas.join(', '));
  } finally {
    ids.slice().reverse().forEach((id) => { let f; while ((f = buscarFilaPorId_(rec, id)) > 0) rec.deleteRow(f); });
    if (calc.getLastRow() > filasCalc) calc.deleteRows(filasCalc + 1, calc.getLastRow() - filasCalc);
    leerExcepciones_(libro).filter((x) => ids.indexOf(x.regla) >= 0).reverse().forEach((x) => exc.deleteRow(x.fila));
    limpiarPagosHuerfanos_(libro);   // Pagos.gs
    if (ultimo === null) props.deleteProperty('ULTIMO');
    else props.setProperty('ULTIMO', ultimo);
    const igual = rec.getLastRow() === filasRec && calc.getLastRow() === filasCalc && exc.getLastRow() === filasExc &&
                  props.getProperty('ULTIMO') === ultimo;
    log(igual, 'Limpieza: Recurrentes, Cálculo, Excepciones, Pagos y el Deshacer pendiente como estaban');
  }
}
