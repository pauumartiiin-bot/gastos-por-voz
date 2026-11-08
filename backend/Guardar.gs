/**
 * Guardar.gs — Fase 18.2: un solo «Guardar cambios» en el editor de un gasto (nombre, importe, categoría y, en los
 * mensuales, las veces al mes), con un Deshacer que lo revierte todo junto. Archivo nuevo.
 * La v1 guarda una sola acción para deshacer (propiedad ULTIMO, que apuntarDeshacer_ sobrescribe) y editarRegistro (v1),
 * renombrar_ y veces_ escriben cada una la suya. Aquí se ejecutan una tras otra, se recoge lo que cada una apunta y al
 * final se escribe un único ULTIMO con todos los pasos, en orden inverso (el deshacer de la v1 los recorre todos).
 * Primero se valida todo lo que se puede sin escribir; después va la v1 (la única que aún puede rechazar algo, como las
 * fechas de un cambio de precio) y, si falla, no se ha tocado nada. Si algo fallara a mitad, se deshace lo hecho.
 * Cada función toma su propio conBloqueo_ (no se anidan bloqueos).
 */

/** Acción "guardar_registro": { hoja, id, concepto?, cambios?: { importe?, categoria?, modo?, desde? }, veces? }. */
function guardarRegistro_(p, token) {
  const hoja = String(p.hoja == null ? '' : p.hoja);
  if (hoja !== 'Recurrentes' && hoja !== 'Movimientos') return { ok: false, error: 'entrada' };
  const esRec = hoja === 'Recurrentes';
  const id = String(p.id == null ? '' : p.id);
  const libro = libro_();   // v1
  const h = libro.getSheetByName(hoja);
  const fila = buscarFilaPorId_(h, id);   // v1
  if (fila < 0) return { ok: false, error: 'rechazado', mensaje: 'Ese gasto ya no existe (¿se borró a mano?). Recarga la lista.' };
  const C = esRec ? COL : COLM;   // v1
  const actual = h.getRange(fila, 1, 1, esRec ? VEC_COL_ : 7).getValues()[0];   // Veces.gs
  const nombreActual = String(actual[C.CONCEPTO - 1]);

  // 1. Qué cambia, y validarlo todo antes de escribir nada.
  const plan = planGuardado_(p, esRec, actual, C);
  if (plan.error) return { ok: false, error: 'rechazado', mensaje: plan.error };
  if (!plan.nombre && !plan.editar && !plan.veces) return { ok: false, error: 'rechazado', mensaje: 'No hay cambios que guardar.' };

  // 2. Escribir: la v1 primero; después el nombre (también en la regla nueva de un cambio de precio) y las veces.
  const props = PropertiesService.getScriptProperties();
  // Fase 20: el Deshacer es de cada persona (claveUltimo_, Usuarios.gs).
  const pasosDe = () => { const u = JSON.parse(props.getProperty(claveUltimo_()) || 'null'); return u && u.pasos ? u.pasos : []; };
  const tandas = [];   // los pasos de deshacer de cada escritura, en el orden en que se hicieron
  const partes = [];
  let idNuevo = null;
  try {
    if (plan.editar) {
      editarRegistro(token, hoja, id, plan.editar);   // v1: lanza un Error con mensaje si lo rechaza (aún no hay nada escrito)
      tandas.push(pasosDe());
      if (plan.editar.importe != null) {
        partes.push(textoEuros_(Number(actual[C.IMPORTE - 1])) + ' → ' + textoEuros_(plan.editar.importe) +   // Ingresos.gs
                    (plan.editar.modo === 'cambioPrecio' ? ' desde el ' + plan.editar.desde.split('-').reverse().join('/') : ''));
      }
      if (plan.editar.categoria) partes.push(String(actual[C.CATEGORIA - 1]) + ' → ' + plan.editar.categoria);
      if (plan.editar.modo === 'cambioPrecio') idNuevo = reglaNuevaTrasCambio_(libro, id);
    }
    if (plan.nombre) {
      [id, idNuevo].filter((x) => x).forEach((x) => {
        const r = renombrar_({ hoja: hoja, id: x, concepto: plan.nombre });   // Renombrar.gs
        if (r.ok === false) throw new Error(r.mensaje || 'No se ha podido cambiar el nombre.');
        tandas.push(pasosDe());
      });
      partes.unshift('«' + nombreActual + '» → «' + plan.nombre + '»');
    }
    if (plan.veces) {
      const r = veces_({ id: id, veces: plan.veces });   // Veces.gs
      if (r.ok === false) throw new Error(r.mensaje || 'No se han podido cambiar las veces.');
      tandas.push(pasosDe());
      partes.push(textoVeces_(vecesDe_(actual[VEC_COL_ - 1])) + ' → ' + textoVeces_(plan.veces) + ' al mes');
    }
    if (idNuevo) copiarVecesTrasCambioDePrecio_(id);   // Veces.gs: la regla nueva nace sin las veces (13 columnas)
  } catch (err) {
    if (!tandas.length) throw err;   // nada escrito: el error de la v1 llega tal cual (clasificarError_)
    // Algo ya escrito y un paso posterior falla: se deshace lo hecho para no dejar cambios a medias.
    apuntarDeshacer_('Cambios a medias', [].concat(...tandas.slice().reverse()));   // v1
    deshacer(token);   // v1
    return { ok: false, error: 'rechazado', mensaje: 'No se ha guardado nada: ' + String(err && err.message || err) };
  }

  // 3. Un solo Deshacer con todos los pasos, del último al primero.
  const final = plan.nombre || nombreActual;
  apuntarDeshacer_('Deshechos los cambios de «' + final + '»', [].concat(...tandas.slice().reverse()));   // v1
  return { id: id, id_nuevo: idNuevo, desc: '«' + final + '»: ' + partes.join(' · ') };
}

/**
 * Lo que hay que hacer, ya validado: { nombre?, editar?: cambios para editarRegistro (v1), veces? } o { error }.
 * Los mensajes son los de la v1, renombrar y veces, para que digan lo mismo por cualquier camino.
 */
function planGuardado_(p, esRec, actual, C) {
  const plan = {};
  if (p.concepto != null) {
    const concepto = String(p.concepto).replace(/\s+/g, ' ').trim();
    if (concepto !== String(actual[C.CONCEPTO - 1])) {
      const error = validarConcepto_(concepto, String(actual[C.CONCEPTO - 1]));   // Renombrar.gs
      if (error) return { error: error };
      plan.nombre = concepto;
    }
  }
  const c = p.cambios || {};
  const editar = {};
  if (c.importe != null && c.importe !== '') {
    const importe = Number(String(c.importe).replace(',', '.'));
    if (!(importe > 0) || importe > LIMITES.importeMax) return { error: 'Importe no válido.' };   // v1: mismo límite y mensaje
    const redondeado = Math.round(importe * 100) / 100;
    if (redondeado !== Number(actual[C.IMPORTE - 1])) editar.importe = redondeado;
  }
  if (c.categoria) {
    const nombres = leerContexto_().categorias.map((x) => x.nombre);   // v1
    const categoria = buscarCategoria(c.categoria, nombres);            // v1
    if (!categoria) return { error: 'Categoría no válida: ' + c.categoria };
    if (categoria !== String(actual[C.CATEGORIA - 1])) editar.categoria = categoria;
  }
  if (Object.keys(editar).length) {
    editar.modo = esRec && editar.importe != null && c.modo === 'cambioPrecio' ? 'cambioPrecio' : 'correccion';
    if (editar.modo === 'cambioPrecio') {
      if (!c.desde) return { error: 'Indica desde qué fecha cambia el precio.' };
      editar.desde = String(c.desde);
    }
    plan.editar = editar;
  }
  if (p.veces != null) {
    if (!esRec) return { error: 'Los gastos puntuales no tienen veces al mes.' };
    const veces = p.veces;
    if (!(typeof veces === 'number' && Number.isInteger(veces) && veces >= 1 && veces <= VEC_MAX_)) {
      return { error: 'Las veces al mes tienen que ser un número entero del 1 al ' + VEC_MAX_ + '.' };
    }
    if (veces !== vecesDe_(actual[VEC_COL_ - 1])) {
      if (String(actual[COL.TIPO - 1]).trim() === 'presupuesto') return { error: 'Un presupuesto no se cobra: no tiene veces al mes.' };
      if (String(actual[COL.FREC - 1]).trim() !== 'mensual') {
        return { error: 'Solo los gastos mensuales se cobran varias veces al mes (los semanales ya llevan una casilla por semana).' };
      }
      plan.veces = veces;
    }
  }
  return plan;
}

/** La regla que acaba de crear un cambio de precio de la v1: la última con la nota «Cambio de precio: sustituye a R011 …». */
function reglaNuevaTrasCambio_(libro, id) {
  const rec = libro.getSheetByName('Recurrentes');
  const nota = 'Cambio de precio: sustituye a ' + id + ' ';
  let nueva = null;
  rec.getRange(2, 1, rec.getLastRow() - 1, COL.NOTAS).getValues().forEach((f) => {
    if (String(f[COL.NOTAS - 1]).indexOf(nota) === 0) nueva = String(f[0]);
  });
  return nueva;
}

/**
 * Prueba desde el editor (fase 18.2), con una regla mensual de prueba (10 €, desde el último mes de Meses, sin fin) y un
 * gasto puntual de prueba (5 €, hoy). Limpieza en finally: Recurrentes, Movimientos, Cálculo, Pagos y ULTIMO como estaban.
 */
function probarGuardarRegistro() {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
  const rec = libro.getSheetByName('Recurrentes');
  const movs = libro.getSheetByName('Movimientos');
  const calc = libro.getSheetByName('Cálculo');
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TOKEN');
  const ultimo = props.getProperty('ULTIMO');
  const filasRec = rec.getLastRow();
  const filasMov = movs.getLastRow();
  const filasCalc = calc.getLastRow();
  const meses = mesesDeLaHoja_(libro, zona);   // Mes.gs
  const mes = meses[meses.length - 1];
  const cat = nombresCategorias_(libro.getSheetByName('Categorías'));   // Categorias.gs
  const categoria = cat.indexOf('Otros') >= 0 ? 'Otros' : cat[0];
  const otra = cat.filter((c) => c !== categoria)[0];
  const ids = [];
  const valor = (h, id, col) => { const f = buscarFilaPorId_(h, id); return f > 0 ? h.getRange(f, col).getValue() : null; };
  const log = (bien, texto) => Logger.log((bien ? '✅ ' : '❌ ') + texto);
  try {
    const regla = siguienteId_(rec, 'R');   // v1
    escribirFila_(rec, [regla, 'Prueba 18', 10, categoria, 'fijo', 'mensual', '', fechaSerial_(mes.inicio), '', '', 'Sí',
                        'probarGuardarRegistro', ahoraSerial_()], FORMATOS_REC);   // v1
    ids.push(regla);
    asegurarFilasCalculo_();   // v1
    const gasto = siguienteId_(movs, 'M');
    escribirFila_(movs, [gasto, fechaSerial_(hoy), 'Prueba 18 gasto', 5, categoria, 'probarGuardarRegistro', ahoraSerial_()],
                  FORMATOS_MOV);   // v1
    ids.push(gasto);

    // Validaciones: sin cambios, el mismo nombre, veces en un puntual, importe no válido con un nombre válido.
    const casos = [
      ['sin cambios', { hoja: 'Movimientos', id: gasto }],
      ['el mismo nombre y el mismo importe', { hoja: 'Movimientos', id: gasto, concepto: 'Prueba 18 gasto', cambios: { importe: 5 } }],
      ['veces en un gasto puntual', { hoja: 'Movimientos', id: gasto, veces: 2 }],
      ['nombre válido + importe no válido', { hoja: 'Recurrentes', id: regla, concepto: 'No debería', cambios: { importe: -5 } }],
      ['nombre válido + categoría inventada', { hoja: 'Recurrentes', id: regla, concepto: 'No debería', cambios: { categoria: 'Inventada' } }]
    ];
    let ok = 0;
    casos.forEach(([caso, params]) => {
      const antes = props.getProperty('ULTIMO');
      const r = guardarRegistro_(params, token);
      const bien = r.ok === false && r.error === 'rechazado' && valor(rec, regla, COL.CONCEPTO) === 'Prueba 18' &&
                   props.getProperty('ULTIMO') === antes;
      if (bien) ok++;
      log(bien, caso + ' → ' + (r.mensaje || r.error || 'se guardó (no debería)'));
    });
    Logger.log('Validaciones: ' + ok + '/' + casos.length);

    // Solo el nombre (gasto puntual) → cambia; Deshacer lo devuelve.
    const a = guardarRegistro_({ hoja: 'Movimientos', id: gasto, concepto: 'Prueba 18 renombrado' }, token);
    const a1 = valor(movs, gasto, COLM.CONCEPTO);
    const da = deshacer(token);   // v1
    log(a1 === 'Prueba 18 renombrado' && valor(movs, gasto, COLM.CONCEPTO) === 'Prueba 18 gasto',
        'Solo el nombre → ' + a.desc + ' · Deshacer → ' + da.desc + ' · vuelve a «' + valor(movs, gasto, COLM.CONCEPTO) + '»');

    // Nombre + importe + categoría (regla) → los tres; un Deshacer los devuelve todos.
    const b = guardarRegistro_({ hoja: 'Recurrentes', id: regla, concepto: 'Prueba 18 B', cambios: { importe: 12.5, categoria: otra } }, token);
    const b1 = [valor(rec, regla, COL.CONCEPTO), valor(rec, regla, COL.IMPORTE), valor(rec, regla, COL.CATEGORIA)];
    deshacer(token);
    const b2 = [valor(rec, regla, COL.CONCEPTO), valor(rec, regla, COL.IMPORTE), valor(rec, regla, COL.CATEGORIA)];
    log(b1.join() === ['Prueba 18 B', 12.5, otra].join() && b2.join() === ['Prueba 18', 10, categoria].join(),
        'Nombre + importe + categoría → ' + b.desc + ' · tras Deshacer: ' + b2.join(' · '));

    // Nombre + veces (mensual) → los dos; un Deshacer los devuelve.
    const c = guardarRegistro_({ hoja: 'Recurrentes', id: regla, concepto: 'Prueba 18 C', veces: 2 }, token);
    const c1 = [valor(rec, regla, COL.CONCEPTO), vecesDe_(valor(rec, regla, VEC_COL_))];
    deshacer(token);
    const c2 = [valor(rec, regla, COL.CONCEPTO), vecesDe_(valor(rec, regla, VEC_COL_))];
    log(c1.join() === 'Prueba 18 C,2' && c2.join() === 'Prueba 18,1', 'Nombre + veces → ' + c.desc + ' · tras Deshacer: ' + c2.join(' · '));

    // Cambio de precio con nombre nuevo y 2 veces → la regla nueva lleva el nombre, el importe y las veces; Deshacer la quita.
    veces_({ id: regla, veces: 2, conservar_deshacer: true });
    const desde = sumarDias_(mes.inicio, 10);   // Ingresos.gs
    const e = guardarRegistro_({ hoja: 'Recurrentes', id: regla, concepto: 'Prueba 18 E',
                                 cambios: { importe: 11, modo: 'cambioPrecio', desde: desde } }, token);
    const nueva = e.id_nuevo;
    if (nueva) ids.push(nueva);
    const e1 = nueva ? [valor(rec, nueva, COL.CONCEPTO), valor(rec, nueva, COL.IMPORTE), vecesDe_(valor(rec, nueva, VEC_COL_))] : [];
    const deE = deshacer(token);
    const e2 = [buscarFilaPorId_(rec, nueva || 'R999999') < 0, valor(rec, regla, COL.CONCEPTO), String(valor(rec, regla, COL.FIN))];
    log(e1.join() === 'Prueba 18 E,11,2' && e2[0] && e2[1] === 'Prueba 18' && e2[2] === '',
        'Cambio de precio con nombre → ' + e.desc + ' · regla nueva ' + nueva + ': ' + e1.join(' · ') + ' · Deshacer → ' + deE.desc +
        ' (nueva borrada: ' + e2[0] + ', nombre «' + e2[1] + '», sin fin: ' + (e2[2] === '') + ')');
  } finally {
    rec.getRange(2, 1, Math.max(rec.getLastRow() - 1, 1), COL.NOTAS).getValues().forEach((f) => {
      if (ids.length && String(f[COL.NOTAS - 1]).indexOf('sustituye a ' + ids[0] + ' ') >= 0 && ids.indexOf(String(f[0])) < 0) ids.push(String(f[0]));
    });
    ids.slice().reverse().forEach((id) => {
      [rec, movs].forEach((h) => { let f; while ((f = buscarFilaPorId_(h, id)) > 0) h.deleteRow(f); });
    });
    limpiarPagosHuerfanos_(libro);   // Pagos.gs
    if (calc.getLastRow() > filasCalc) calc.deleteRows(filasCalc + 1, calc.getLastRow() - filasCalc);
    if (ultimo === null) props.deleteProperty('ULTIMO');
    else props.setProperty('ULTIMO', ultimo);
    const igual = rec.getLastRow() === filasRec && movs.getLastRow() === filasMov && calc.getLastRow() === filasCalc &&
                  props.getProperty('ULTIMO') === ultimo;
    log(igual, 'Limpieza: Recurrentes, Movimientos, Cálculo y el Deshacer pendiente como estaban');
  }
}
