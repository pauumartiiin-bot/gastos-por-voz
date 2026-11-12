/**
 * Guardar.gs — Fase 18.2: un solo «Guardar cambios» en el editor de un gasto (nombre, importe, categoría y, en los
 * mensuales, las veces al mes), con un Deshacer que lo revierte todo junto. Archivo nuevo.
 * La v1 guarda una sola acción para deshacer (propiedad ULTIMO, que apuntarDeshacer_ sobrescribe) y editarRegistro (v1),
 * renombrar_ y veces_ escriben cada una la suya. Aquí se ejecutan una tras otra, se recoge lo que cada una apunta y al
 * final se escribe un único ULTIMO con todos los pasos, en orden inverso (el deshacer de la v1 los recorre todos).
 * Primero se valida todo lo que se puede sin escribir; después va la v1 (la única que aún puede rechazar algo, como las
 * fechas de un cambio de precio) y, si falla, no se ha tocado nada. Si algo fallara a mitad, se deshace lo hecho.
 * Cada función toma su propio conBloqueo_ (no se anidan bloqueos).
 * Fase 22: también la fecha de un gasto puntual (la v1 no la edita), con el mismo rango que al crearlo (LIMITES de la v1)
 * y en un mes que esté en Meses. La respuesta dice en qué mes estaba y en cuál queda, y si algún arrastre puede haber
 * cambiado (son fotos, fase 15).
 */

/** Acción "guardar_registro": { hoja, id, concepto?, cambios?: { importe?, categoria?, modo?, desde?, fecha? }, veces? }. */
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
  const zona = libro.getSpreadsheetTimeZone();
  const meses = mesesDeLaHoja_(libro, zona);   // Mes.gs
  const plan = planGuardado_(p, esRec, actual, C, meses, zona);
  if (plan.error) return { ok: false, error: 'rechazado', mensaje: plan.error };
  if (!plan.nombre && !plan.editar && !plan.veces && !plan.fecha) return { ok: false, error: 'rechazado', mensaje: 'No hay cambios que guardar.' };

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
    if (plan.fecha) {
      tandas.push(cambiarFecha_(id, plan.fecha));
      const f = plan.fecha;
      partes.push(textoDia_(f.antes) + ' → ' + textoDia_(f.nueva) +
                  (f.mesNuevo !== f.mesAntes ? ' · movido a ' + f.mesNuevo.split(' (')[0] : ''));
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
  const mesAntes = esRec ? null : mesDeFecha_(meses, textoFecha_(actual[COLM.FECHA - 1], zona));   // Mes.gs
  const mesNuevo = plan.fecha ? plan.fecha.mesNuevo : mesAntes;
  return { id: id, id_nuevo: idNuevo, desc: '«' + final + '»: ' + partes.join(' · '),
           mes_anterior: mesAntes, mes_nuevo: mesNuevo, aviso: avisoTrasGuardar_(libro, meses, plan, esRec, actual, mesAntes, mesNuevo) };
}

/** Lo que cuenta en el mes es el importe, las veces y la fecha: el nombre y la categoría no cambian el restante. */
function avisoTrasGuardar_(libro, meses, plan, esRec, actual, mesAntes, mesNuevo) {
  const cuenta = (plan.editar && plan.editar.importe != null) || plan.veces || plan.fecha;
  if (!cuenta) return null;
  const desde = plan.editar && plan.editar.modo === 'cambioPrecio' ? plan.editar.desde : null;
  return avisoArrastreDe_(libro, meses, esRec, actual, [mesAntes, mesNuevo], desde);
}

/** Fase 22: escribe la fecha nueva de un gasto puntual y devuelve su paso de Deshacer (la de antes, como número de serie). */
function cambiarFecha_(id, f) {
  return conBloqueo_(() => {   // v1
    const h = libro_().getSheetByName('Movimientos');
    const fila = buscarFilaPorId_(h, id);   // v1
    if (fila < 0) throw new Error('Ese gasto ya no existe.');
    const celda = h.getRange(fila, COLM.FECHA);
    const anterior = aJSON_(celda.getValue());   // v1
    celda.setValue(fechaSerial_(f.nueva)).setNumberFormat('dd/mm/yyyy');   // v1
    return [{ op: 'celda', hoja: 'Movimientos', id: id, col: COLM.FECHA, valor: anterior }];
  });
}

/**
 * Fase 22: «Eliminar» de la v1 (eliminarRegistro, sin tocar) y, si el gasto contaba en algún mes cerrado, el aviso de
 * arrastre. La fila se lee antes de borrarla: después ya no se sabe su fecha ni desde cuándo contaba.
 */
function eliminarConAviso_(p, token) {
  let previo = null;
  if (p.hoja === 'Recurrentes' || p.hoja === 'Movimientos') {
    const h = libro_().getSheetByName(p.hoja);
    const fila = buscarFilaPorId_(h, String(p.id == null ? '' : p.id));   // v1
    if (fila > 0) previo = h.getRange(fila, 1, 1, p.hoja === 'Recurrentes' ? COL.REG : COLM.REG).getValues()[0];   // v1
  }
  const r = eliminarRegistro(token, p.hoja, p.id);   // v1: valida la hoja y el ID y lanza un Error si no puede
  if (previo) {
    const libro = libro_();
    const zona = libro.getSpreadsheetTimeZone();
    const meses = mesesDeLaHoja_(libro, zona);
    const esRec = p.hoja === 'Recurrentes';
    const mes = esRec ? null : mesDeFecha_(meses, textoFecha_(previo[COLM.FECHA - 1], zona));
    r.aviso = avisoArrastreDe_(libro, meses, esRec, previo, [mes], null);
  }
  return r;
}

/** El mes de Meses cuyo periodo (fase 13) contiene la fecha; sin periodo, el mes natural. null si no está en ninguno. */
function mesDeFecha_(meses, fecha) {
  if (!fecha) return null;
  const m = meses.filter((x) => (x.periodo_inicio || x.inicio) <= fecha &&
                                fecha <= (x.periodo_fin || x.inicio.slice(0, 8) + '31'))[0];
  return m ? m.etiqueta : null;
}

/** "2026-11-03" → "03/11/2026" */
function textoDia_(iso) {
  return iso.split('-').reverse().join('/');
}

/**
 * Fase 22: arrastres que un cambio puede haber dejado viejos (avisoArrastre_, Ingresos.gs; son fotos, fase 15). Un gasto
 * puntual toca sus meses (mesesPuntual: el de antes y, si se mueve, el nuevo); una regla, todos los meses desde que empieza
 * (o desde la fecha de un cambio de precio) hasta el de hoy. Texto para la notificación, o null.
 */
function avisoArrastreDe_(libro, meses, esRec, fila, mesesPuntual, desde) {
  let tocados;
  if (esRec) {
    const zona = libro.getSpreadsheetTimeZone();
    const inicio = String(desde || textoFecha_(fila[COL.INICIO - 1], zona)).slice(0, 7);
    const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
    tocados = meses.filter((m) => m.inicio.slice(0, 7) >= inicio && m.inicio <= hoy).map((m) => m.etiqueta);
  } else {
    tocados = mesesPuntual.filter((x, i, a) => x && a.indexOf(x) === i);
  }
  if (!tocados.length) return null;
  return avisoArrastre_(libro.getSheetByName(ING_HOJA_), meses.map((m) => m.etiqueta), tocados, false);   // Ingresos.gs
}

/**
 * Lo que hay que hacer, ya validado: { nombre?, editar?: cambios para editarRegistro (v1), veces? } o { error }.
 * Los mensajes son los de la v1, renombrar y veces, para que digan lo mismo por cualquier camino.
 */
function planGuardado_(p, esRec, actual, C, meses, zona) {
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
  if (c.fecha != null && c.fecha !== '') {
    const error = planFecha_(plan, c.fecha, esRec, actual, meses, zona);
    if (error) return { error: error };
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

/**
 * Fase 22: la fecha nueva de un gasto puntual, con las reglas de la v1 al crearlo (fechaValida y LIMITES, ±730 días desde
 * hoy) y en un mes de Meses (si no, no saldría en ningún «Mes»). La de un recurrente no se edita aquí. Devuelve el error
 * o rellena plan.fecha = { nueva, antes, mesAntes, mesNuevo }.
 */
function planFecha_(plan, valor, esRec, actual, meses, zona) {
  if (esRec) return 'La fecha de un gasto recurrente no se edita: usa «Cambio de precio» o «Dar de baja».';
  const nueva = fechaValida(String(valor));   // v1
  if (!nueva) return 'Fecha no válida: ' + valor;
  const hoy = Utilities.formatDate(new Date(), CONFIG.ZONA, 'yyyy-MM-dd');   // v1: el mismo «hoy» que al crear
  const dif = diasEntre(hoy, nueva);   // v1
  if (dif < -LIMITES.diasPasado || dif > LIMITES.diasFuturo) {   // v1
    return 'Fecha fuera de rango: ' + textoDia_(nueva) + ' (como mucho dos años antes o después de hoy).';
  }
  const antes = textoFecha_(actual[COLM.FECHA - 1], zona);   // Mes.gs
  if (nueva === antes) return null;
  const mesNuevo = mesDeFecha_(meses, nueva);
  if (!mesNuevo) return 'Ese mes aún no está en la pestaña Meses: el gasto no saldría en «Mes».';
  plan.fecha = { nueva: nueva, antes: antes, mesAntes: mesDeFecha_(meses, antes), mesNuevo: mesNuevo };
  return null;
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
 * gasto puntual de prueba (5 €, hoy). Fase 22: la fecha del gasto (validaciones, moverlo a otro mes con su marca
 * «pendiente», fecha + nombre + importe con un solo Deshacer, y eliminar con aviso).
 * Limpieza en finally: Recurrentes, Movimientos, Cálculo, Pagos y ULTIMO como estaban.
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

    // Fase 22: el mes de hoy y el siguiente (para mover el gasto), y una fecha fuera de Meses si cabe en el rango de la v1.
    const iHoy = meses.findIndex((m) => m.etiqueta === mesDeFecha_(meses, hoy));
    const mesHoy = meses[iHoy];
    const mesSig = meses[iHoy + 1];
    const ultimoFin = meses[meses.length - 1].periodo_fin || sumarDias_(mes.inicio, 27);
    const fueraDeMeses = sumarDias_(ultimoFin, 1);
    const fechaGasto = () => { const f = buscarFilaPorId_(movs, gasto); return f > 0 ? textoFecha_(movs.getRange(f, COLM.FECHA).getValue(), zona) : null; };

    // Validaciones: sin cambios, el mismo nombre, veces en un puntual, importe no válido con un nombre válido y, fase 22,
    // las fechas (en un recurrente, no válida, fuera de rango, fuera de Meses y no válida junto a un nombre válido).
    const casos = [
      ['sin cambios', { hoja: 'Movimientos', id: gasto }],
      ['el mismo nombre y el mismo importe', { hoja: 'Movimientos', id: gasto, concepto: 'Prueba 18 gasto', cambios: { importe: 5 } }],
      ['veces en un gasto puntual', { hoja: 'Movimientos', id: gasto, veces: 2 }],
      ['nombre válido + importe no válido', { hoja: 'Recurrentes', id: regla, concepto: 'No debería', cambios: { importe: -5 } }],
      ['nombre válido + categoría inventada', { hoja: 'Recurrentes', id: regla, concepto: 'No debería', cambios: { categoria: 'Inventada' } }],
      ['fecha en un recurrente', { hoja: 'Recurrentes', id: regla, cambios: { fecha: hoy } }],
      ['fecha que no existe (30 de febrero)', { hoja: 'Movimientos', id: gasto, cambios: { fecha: '2027-02-30' } }],
      ['fecha a más de dos años', { hoja: 'Movimientos', id: gasto, cambios: { fecha: sumarDias_(hoy, LIMITES.diasFuturo + 1) } }],
      ['fecha de hace más de dos años', { hoja: 'Movimientos', id: gasto, cambios: { fecha: sumarDias_(hoy, -LIMITES.diasPasado - 1) } }],
      ['nombre válido + fecha no válida', { hoja: 'Movimientos', id: gasto, concepto: 'No debería', cambios: { fecha: 'mañana' } }]
    ].concat(diasEntre(hoy, fueraDeMeses) <= LIMITES.diasFuturo
      ? [['fecha fuera de Meses (' + fueraDeMeses + ')', { hoja: 'Movimientos', id: gasto, cambios: { fecha: fueraDeMeses } }]] : []);
    let ok = 0;
    casos.forEach(([caso, params]) => {
      const antes = props.getProperty('ULTIMO');
      const r = guardarRegistro_(params, token);
      const bien = r.ok === false && r.error === 'rechazado' && valor(rec, regla, COL.CONCEPTO) === 'Prueba 18' &&
                   valor(movs, gasto, COLM.CONCEPTO) === 'Prueba 18 gasto' && fechaGasto() === hoy &&
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

    // Fase 22: fechas de un gasto puntual.
    if (!mesHoy || !mesSig) {
      log(false, 'Fecha: hoy (' + hoy + ') no está en Meses o es su último mes: no se puede probar el cambio de mes');
    } else {
      // Solo la fecha, dentro del mismo mes → cambia, mes_nuevo = mes_anterior; Deshacer la devuelve.
      const mismoMes = hoy === mesHoy.periodo_inicio ? sumarDias_(hoy, 1) : sumarDias_(hoy, -1);
      const f = guardarRegistro_({ hoja: 'Movimientos', id: gasto, cambios: { fecha: mismoMes } }, token);
      const f1 = fechaGasto();
      deshacer(token);   // v1
      log(f1 === mismoMes && f.mes_nuevo === mesHoy.etiqueta && f.mes_anterior === mesHoy.etiqueta && fechaGasto() === hoy,
          'Solo la fecha → ' + f.desc + ' · mes ' + String(f.mes_nuevo).split(' (')[0] + ' · Deshacer → ' + fechaGasto());

      // A otro mes con la marca «pendiente» → sale en el mes nuevo, pendiente, y no en el de antes; Deshacer lo devuelve.
      pagar_({ etiqueta: mesHoy.etiqueta, id: gasto, pagado: false });   // Pagos.gs
      const destino = mesSig.periodo_inicio || mesSig.inicio;
      const g = guardarRegistro_({ hoja: 'Movimientos', id: gasto, cambios: { fecha: destino } }, token);
      const buscar = (m) => [].concat(...m.categorias.map((k) => k.movimientos)).filter((x) => x.id === gasto)[0] || null;
      const enSig = buscar(mes_({ etiqueta: mesSig.etiqueta }));   // Mes.gs
      const enHoy = buscar(mes_({ etiqueta: mesHoy.etiqueta }));
      deshacer(token);
      log(g.mes_anterior === mesHoy.etiqueta && g.mes_nuevo === mesSig.etiqueta && /movido a/.test(g.desc) &&
          enSig && enSig.pagado === false && !enHoy && fechaGasto() === hoy,
          'A otro mes → ' + g.desc + ' · en ' + mesSig.etiqueta.split(' (')[0] + ': ' + (enSig ? (enSig.pagado ? 'pagado' : 'pendiente') : 'no sale') +
          ' · en ' + mesHoy.etiqueta.split(' (')[0] + ': ' + (enHoy ? 'sigue (no debería)' : 'ya no sale') + ' · aviso: ' + (g.aviso || 'ninguno') +
          ' · Deshacer → ' + fechaGasto());
      pagar_({ etiqueta: mesHoy.etiqueta, id: gasto, pagado: true });   // vuelve a lo normal (sin fila en Pagos)

      // Fecha + nombre + importe → los tres; un solo Deshacer los devuelve todos.
      const h = guardarRegistro_({ hoja: 'Movimientos', id: gasto, concepto: 'Prueba 22', cambios: { importe: 7.5, fecha: mismoMes } }, token);
      const h1 = [valor(movs, gasto, COLM.CONCEPTO), valor(movs, gasto, COLM.IMPORTE), fechaGasto()];
      deshacer(token);
      const h2 = [valor(movs, gasto, COLM.CONCEPTO), valor(movs, gasto, COLM.IMPORTE), fechaGasto()];
      log(h1.join() === ['Prueba 22', 7.5, mismoMes].join() && h2.join() === ['Prueba 18 gasto', 5, hoy].join(),
          'Fecha + nombre + importe → ' + h.desc + ' · tras Deshacer: ' + h2.join(' · '));
    }

    // Fase 22: eliminar (v1) devuelve el aviso de arrastre (texto o null) y el Deshacer de la v1 lo recupera.
    const el = eliminarConAviso_({ hoja: 'Movimientos', id: gasto }, token);
    const borrado = buscarFilaPorId_(movs, gasto) < 0;
    deshacer(token);
    log(borrado && 'aviso' in el && buscarFilaPorId_(movs, gasto) > 0,
        'Eliminar con aviso → ' + el.desc + ' · aviso: ' + (el.aviso || 'ninguno') + ' · Deshacer → vuelve');
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
