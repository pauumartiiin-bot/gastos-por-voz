/**
 * Veces.gs — Fase 17: recurrentes que se cobran varias veces al mes (el barbero, dos veces), con una casilla de pagado
 * por vez. Archivo nuevo.
 *  - Recurrentes!N «Veces_mes» (solo mensuales que no son presupuesto; 1–10, vacío = 1). Es un valor, no una fórmula: la
 *    v1 escribe 13 columnas (A–M) tras getLastRow() y deja N vacía, que vale 1. El importe es el de cada vez.
 *  - Cálculo!R «Veces» lee N (1 en anuales, semanales y presupuestos) y Cálculo!O la usa en los mensuales con cargo.
 *  - En «Mes», una regla con más de una vez en el mes (mensual con veces o semanal) sale como una línea por vez, con ID
 *    «R011#2» (Mes.gs). En Pagos, la clave de esas líneas es la misma (Pagos.gs): las de una sola vez siguen siendo «R011».
 * Lo que la v1 no conoce (copia 13 columnas): un cambio de precio crea la regla nueva sin veces → doPost se las copia
 * (copiarVecesTrasCambioDePrecio_); eliminar y Deshacer devuelve la regla con 1 vez (aceptado, como las marcas de 11.3).
 */

const VEC_COL_ = 14;      // Recurrentes!N
const VEC_MAX_ = 10;
const VEC_MAX_SEMANAS_ = 5;

/**
 * Acción "veces": { id, veces, conservar_deshacer? } → cuántas veces al mes se cobra una regla mensual. Se puede deshacer
 * (paso «celda»). Con `conservar_deshacer: true` (lo usa «+ Nuevo gasto» justo después de guardar) no apunta su propio
 * Deshacer: así el de la notificación sigue siendo el del gasto, que al borrar la regla se lleva también sus veces.
 */
function veces_(p) {
  const id = String(p.id == null ? '' : p.id);
  const veces = p.veces;
  if (!(typeof veces === 'number' && Number.isInteger(veces) && veces >= 1 && veces <= VEC_MAX_)) {
    return { ok: false, error: 'rechazado', mensaje: 'Las veces al mes tienen que ser un número entero del 1 al ' + VEC_MAX_ + '.' };
  }
  const libro = libro_();   // v1
  return conBloqueo_(() => {   // v1
    const rec = libro.getSheetByName('Recurrentes');
    const fila = buscarFilaPorId_(rec, id);   // v1
    if (fila < 0) return { ok: false, error: 'rechazado', mensaje: 'Esa regla ya no existe (¿se borró a mano?). Recarga la lista.' };
    const f = rec.getRange(fila, 1, 1, VEC_COL_).getValues()[0];
    if (String(f[COL.TIPO - 1]).trim() === 'presupuesto') {   // COL es de la v1
      return { ok: false, error: 'rechazado', mensaje: 'Un presupuesto no se cobra: no tiene veces al mes.' };
    }
    if (String(f[COL.FREC - 1]).trim() !== 'mensual') {
      return { ok: false, error: 'rechazado', mensaje: 'Solo los gastos mensuales se cobran varias veces al mes (los semanales ya llevan una casilla por semana).' };
    }
    const anterior = vecesDe_(f[VEC_COL_ - 1]);
    if (anterior === veces) return { ok: false, error: 'rechazado', mensaje: 'Ya se cobra ' + textoVeces_(veces) + ' al mes.' };

    const celda = rec.getRange(fila, VEC_COL_);
    if (veces === 1) celda.clearContent();   // vacío = 1
    else celda.setValue(veces);
    const concepto = String(f[COL.CONCEPTO - 1]);
    if (p.conservar_deshacer !== true) {
      apuntarDeshacer_('«' + concepto + '» vuelve a ' + textoVeces_(anterior) + ' al mes',   // v1
                       [{ op: 'celda', hoja: 'Recurrentes', id: id, col: VEC_COL_, valor: anterior === 1 ? '' : anterior }]);
    }
    if (veces < anterior) limpiarPagosHuerfanos_(libro);   // Pagos.gs: las marcas de las veces que ya no existen
    return { id: id, veces: veces, anterior: anterior,
             desc: '«' + concepto + '»: ' + textoVeces_(anterior) + ' → ' + textoVeces_(veces) + ' al mes' };
  });
}

/**
 * La respuesta de "registros" (listarRegistros, v1, lee 13 columnas) con las veces de cada recurrente: un número en los
 * mensuales que no son presupuesto y null en el resto. Lo llama ACCIONES_ (Api.gs).
 */
function conVeces_(r) {
  if (!r || r.ok === false || !r.recurrentes) return r;
  const rec = libro_().getSheetByName('Recurrentes');
  const veces = {};
  if (rec.getLastRow() > 1 && rec.getLastColumn() >= VEC_COL_) {
    rec.getRange(2, 1, rec.getLastRow() - 1, VEC_COL_).getValues().forEach((f) => { veces[String(f[0])] = f[VEC_COL_ - 1]; });
  }
  r.recurrentes.forEach((x) => {
    x.veces = x.frecuencia === 'mensual' && x.tipo !== 'presupuesto' ? vecesDe_(veces[x.id]) : null;
  });
  return r;
}

/**
 * Tras un «editar» con cambio de precio, la v1 cierra la regla y crea otra copiando sus 13 columnas: sin la N. Aquí se
 * copian las veces a la regla nueva, que se reconoce por la nota que escribe la v1 («Cambio de precio: sustituye a R011
 * desde …»). La acción ya está hecha: si esto falla, solo se apunta (como la limpieza de Pagos).
 */
function copiarVecesTrasCambioDePrecio_(id) {
  try {
    return conBloqueo_(() => {
      const rec = libro_().getSheetByName('Recurrentes');
      if (rec.getLastRow() < 2 || rec.getLastColumn() < VEC_COL_) return null;
      const filas = rec.getRange(2, 1, rec.getLastRow() - 1, VEC_COL_).getValues();
      const vieja = filas.filter((f) => String(f[0]) === id)[0];
      if (!vieja || vecesDe_(vieja[VEC_COL_ - 1]) === 1) return null;
      const nota = 'Cambio de precio: sustituye a ' + id + ' ';
      let i = -1;
      filas.forEach((f, k) => { if (String(f[COL.NOTAS - 1]).indexOf(nota) === 0 && String(f[VEC_COL_ - 1]) === '') i = k; });   // la última
      if (i < 0) return null;
      rec.getRange(i + 2, VEC_COL_).setValue(vecesDe_(vieja[VEC_COL_ - 1]));
      return String(filas[i][0]);
    });
  } catch (err) {
    console.error(err);
    return null;
  }
}

/** «R011#2» → { base: 'R011', vez: 2 }; «R011» → { base: 'R011', vez: null }. */
function partirId_(id) {
  const m = /^(.*)#(\d+)$/.exec(String(id));
  return m ? { base: m[1], vez: Number(m[2]) } : { base: String(id), vez: null };
}

/** Un valor de Veces_mes → número de veces (vacío o algo raro = 1). */
function vecesDe_(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= VEC_MAX_ ? n : 1;
}

/**
 * Cuántas líneas puede tener una regla en un mes, por su fila de Recurrentes (A–N): un mensual, sus veces; un semanal,
 * 5 (los meses de 5 semanas existen); un anual o un presupuesto, 1. Lo usa la limpieza de Pagos y pagar.
 */
function maxVecesRegla_(f) {
  if (String(f[COL.TIPO - 1]).trim() === 'presupuesto') return 1;
  const frecuencia = String(f[COL.FREC - 1]).trim();
  if (frecuencia === 'semanal') return VEC_MAX_SEMANAS_;
  return frecuencia === 'mensual' ? vecesDe_(f[VEC_COL_ - 1]) : 1;
}

function textoVeces_(n) {
  return n + (n === 1 ? ' vez' : ' veces');
}

/**
 * Prueba desde el editor (fase 17), con reglas de prueba en el último mes de Meses: un mensual de 10 € (sin fin: el cambio
 * de precio de la v1 exige que queden cargos después), un semanal de 7 € y un anual de 5 € (estos dos acaban ese mes).
 * Limpieza en finally: Recurrentes, Cálculo, Pagos y el Deshacer pendiente como estaban.
 */
function probarVeces() {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const rec = libro.getSheetByName('Recurrentes');
  const calc = libro.getSheetByName('Cálculo');
  if (rec.getRange(1, VEC_COL_).getValue() !== 'Veces_mes') return Logger.log('❌ Falta Recurrentes!N «Veces_mes»: ejecuta antes aplicarFase17().');
  const props = PropertiesService.getScriptProperties();
  const ultimo = props.getProperty('ULTIMO');
  const token = props.getProperty('TOKEN');
  const filasRec = rec.getLastRow();
  const filasCalc = calc.getLastRow();
  const meses = mesesDeLaHoja_(libro, zona);   // Mes.gs
  const mes = meses[meses.length - 1];
  const fin = textoFecha_(new Date(Date.UTC(Number(mes.inicio.slice(0, 4)), Number(mes.inicio.slice(5, 7)), 0, 12)), zona);
  const cat = nombresCategorias_(libro.getSheetByName('Categorías'));   // Categorias.gs
  const categoria = cat.indexOf('Otros') >= 0 ? 'Otros' : cat[0];
  const ids = [];
  const regla = (concepto, importe, frecuencia, conFin) => {
    const id = siguienteId_(rec, 'R');   // v1
    escribirFila_(rec, [id, concepto, importe, categoria, 'fijo', frecuencia, '', fechaSerial_(mes.inicio), conFin ? fechaSerial_(fin) : '', '',
                        'Sí', 'probarVeces', ahoraSerial_()], FORMATOS_REC);   // v1
    ids.push(id);
    return id;
  };
  const lineas = (r, base) => [].concat(...r.categorias.map((k) => k.reglas)).filter((g) => (g.base || g.id) === base);
  const pagos = () => libro.getSheetByName(PAG_HOJA_);   // Pagos.gs
  try {
    const mensual = regla('Prueba 17 mensual', 10, 'mensual', false);
    const semanal = regla('Prueba 17 semanal', 7, 'semanal', true);
    const anual = regla('Prueba 17 anual', 5, 'anual', true);
    asegurarFilasCalculo_();   // v1: Cálculo con filas para las reglas nuevas
    const presupuesto = rec.getRange(2, 1, rec.getLastRow() - 1, 5).getValues().filter((f) => String(f[4]) === 'presupuesto')[0];

    // 1. Validaciones.
    const casos = [
      ['0 veces', { id: mensual, veces: 0 }], ['11 veces', { id: mensual, veces: 11 }], ['texto', { id: mensual, veces: 'dos' }],
      ['2,5 veces', { id: mensual, veces: 2.5 }], ['regla semanal', { id: semanal, veces: 2 }], ['regla anual', { id: anual, veces: 2 }],
      ['ID inexistente', { id: 'R999999', veces: 2 }], ['las mismas veces (1)', { id: mensual, veces: 1 }]
    ];
    if (presupuesto) casos.push(['presupuesto (' + presupuesto[0] + ')', { id: String(presupuesto[0]), veces: 2 }]);
    let ok = 0;
    casos.forEach(([caso, params]) => {
      const r = veces_(params);
      const bien = r.ok === false && r.error === 'rechazado';
      if (bien) ok++;
      Logger.log((bien ? '✅ ' : '❌ ') + caso + ' → ' + (r.mensaje || r.error || 'se cambió (no debería)'));
    });
    Logger.log('Validaciones: ' + ok + '/' + casos.length);

    // 2. Dos veces: Cálculo O = 2 y P = 20, y «Mes» devuelve dos líneas de 10 €.
    const v2 = veces_({ id: mensual, veces: 2 });
    const filaCalc = buscarFilaPorId_(rec, mensual);   // Cálculo lee Recurrentes por número de fila
    const op = enMes_(libro, mes.etiqueta, () => calc.getRange(filaCalc, 15, 1, 2).getValues()[0]);   // Mes.gs
    const m1 = mes_({ etiqueta: mes.etiqueta });
    const l1 = lineas(m1, mensual);
    const bien2 = v2.veces === 2 && op[0] === 2 && op[1] === 20 && l1.length === 2 && l1[0].id === mensual + '#1' &&
                  l1[1].id === mensual + '#2' && l1.every((g) => g.importe === 10 && !g.pagado) && m1.cuadra;
    Logger.log((bien2 ? '✅ ' : '❌ ') + v2.desc + ' → Cálculo O ' + op[0] + ', P ' + op[1] + ' · líneas ' +
               l1.map((g) => g.id + ' ' + g.importe).join(', ') + ' · cuadra ' + m1.cuadra);

    // 3. Marcar cada vez: el pendiente baja 10 cada una.
    const p0 = m1.cabecera.pendiente;
    pagar_({ etiqueta: mes.etiqueta, id: mensual + '#1', pagado: true });   // Pagos.gs
    const p1 = mes_({ etiqueta: mes.etiqueta }).cabecera.pendiente;
    pagar_({ etiqueta: mes.etiqueta, id: mensual + '#2', pagado: true });
    const m2 = mes_({ etiqueta: mes.etiqueta });
    const bien3 = p1 === redondear2_(p0 - 10) && m2.cabecera.pendiente === redondear2_(p0 - 20) && lineas(m2, mensual).every((g) => g.pagado);
    Logger.log((bien3 ? '✅ ' : '❌ ') + 'Marcar #1 y #2 → pendiente ' + p0 + ' → ' + p1 + ' → ' + m2.cabecera.pendiente);

    // 4. Bajar a 1 vez: la limpieza borra la marca #2 y la línea única hereda la #1.
    const v1 = veces_({ id: mensual, veces: 1 });
    const m3 = mes_({ etiqueta: mes.etiqueta });
    const l3 = lineas(m3, mensual);
    const sinDos = filasPago_(pagos(), mes.etiqueta, mensual + '#2').length === 0;   // Pagos.gs
    const bien4 = sinDos && l3.length === 1 && l3[0].id === mensual && l3[0].pagado && l3[0].importe === 10;
    Logger.log((bien4 ? '✅ ' : '❌ ') + v1.desc + ' → marca #2 borrada: ' + sinDos + ' · línea ' + (l3[0] && l3[0].id) +
               ' pagada: ' + (l3[0] && l3[0].pagado));

    // 5. Deshacer el cambio de veces (vuelve a 2).
    const d = deshacer(token);   // v1
    const vuelve = vecesDe_(rec.getRange(buscarFilaPorId_(rec, mensual), VEC_COL_).getValue()) === 2;
    Logger.log((vuelve ? '✅ ' : '❌ ') + 'Deshacer → ' + d.desc);

    // 6. Semanal: una línea por semana, de 7 €.
    const m4 = mes_({ etiqueta: mes.etiqueta });
    const ls = lineas(m4, semanal);
    const bien6 = ls.length >= 4 && ls.length <= 5 && ls.every((g, k) => g.id === semanal + '#' + (k + 1) && g.importe === 7 && !g.pagado);
    Logger.log((bien6 ? '✅ ' : '❌ ') + 'Semanal → ' + ls.length + ' líneas: ' + ls.map((g) => g.id).join(', '));

    // 7. Una marca antigua sin «#» en la semanal: todas sus semanas pagadas. Desmarcar la 2.ª la separa en una por semana.
    hojaPagos_(libro).appendRow([mes.etiqueta, semanal, new Date(), 'pagado']);   // Pagos.gs
    const todas = lineas(mes_({ etiqueta: mes.etiqueta }), semanal).every((g) => g.pagado);
    pagar_({ etiqueta: mes.etiqueta, id: semanal + '#2', pagado: false });
    const l7 = lineas(mes_({ etiqueta: mes.etiqueta }), semanal);
    const separada = filasPago_(pagos(), mes.etiqueta, semanal).length === 0 && l7.filter((g) => !g.pagado).map((g) => g.id).join() === semanal + '#2';
    Logger.log((todas && separada ? '✅ ' : '❌ ') + 'Marca antigua sin «#» → todas pagadas: ' + todas + ' · desmarcar #2 → ' +
               l7.map((g) => g.id.split('#')[1] + (g.pagado ? '✓' : '·')).join(' '));

    // 8. Cambio de precio (v1) de la regla de 2 veces: la nueva hereda las veces.
    const desde = sumarDias_(mes.inicio, 10);   // Ingresos.gs
    editarRegistro(token, 'Recurrentes', mensual, { importe: 11, modo: 'cambioPrecio', desde: desde });   // v1
    const nueva = copiarVecesTrasCambioDePrecio_(mensual);
    if (nueva) ids.push(nueva);
    const bien8 = nueva && vecesDe_(rec.getRange(buscarFilaPorId_(rec, nueva), VEC_COL_).getValue()) === 2;
    Logger.log((bien8 ? '✅ ' : '❌ ') + 'Cambio de precio → la regla nueva ' + nueva + ' sigue con 2 veces');
  } finally {
    // Las reglas de prueba (también la del cambio de precio, por su nota), sus marcas y las filas que se añadieron a Cálculo.
    rec.getRange(2, 1, Math.max(rec.getLastRow() - 1, 1), 12).getValues().forEach((f) => {
      if (String(f[COL.NOTAS - 1]).indexOf('sustituye a ' + ids[0] + ' ') >= 0 && ids.indexOf(String(f[0])) < 0) ids.push(String(f[0]));
    });
    ids.slice().reverse().forEach((id) => { let f; while ((f = buscarFilaPorId_(rec, id)) > 0) rec.deleteRow(f); });
    limpiarPagosHuerfanos_(libro);
    if (calc.getLastRow() > filasCalc) calc.deleteRows(filasCalc + 1, calc.getLastRow() - filasCalc);
    if (ultimo === null) props.deleteProperty('ULTIMO');
    else props.setProperty('ULTIMO', ultimo);
    const h = pagos();
    const sinMarcas = !h || h.getLastRow() < 2 ||
                      h.getRange(2, 2, h.getLastRow() - 1, 1).getValues().every((f) => ids.indexOf(partirId_(f[0]).base) < 0);
    const igual = rec.getLastRow() === filasRec && calc.getLastRow() === filasCalc && props.getProperty('ULTIMO') === ultimo && sinMarcas;
    Logger.log((igual ? '✅ ' : '❌ ') + 'Limpieza: Recurrentes, Cálculo, Pagos y el Deshacer pendiente como estaban');
  }
}
