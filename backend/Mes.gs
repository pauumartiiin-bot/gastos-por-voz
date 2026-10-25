/**
 * Mes.gs — Fase 7.1: el mes elegido, tal como lo calculan las fórmulas de la hoja.
 * Archivo nuevo. La app no recalcula nada (arquitectura A+, «leer y restaurar»): se pone el mes en
 * Resumen!B1, se leen los resultados y B1 vuelve a su valor original aunque algo falle.
 *
 * Acoplamiento: depende de las posiciones de Resumen, Cálculo, Movimientos, Meses e Ingresos.
 * Si cambia el Resumen, hay que revisar este archivo.
 */

const MES_CELDA_ = 'B1';            // Resumen: etiqueta del mes elegido
const MES_PRIMERA_FILA_ = 10;       // Resumen: tabla por categoría, filas 10–129
const MES_ULTIMA_FILA_ = 129;
const MES_COLS_CALCULO_ = 16;       // Cálculo: de A (ID) a P (Importe_en_mes)

/** Acción "mes" de la API: { etiqueta? } → el mes con su cabecera y sus categorías. */
function mes_(p) {
  const inicio = Date.now();
  const libro = libro_();   // v1
  const zona = libro.getSpreadsheetTimeZone();
  const meses = mesesDeLaHoja_(libro, zona);
  const porDefecto = mesPorDefecto_(libro, meses, zona);

  // Sin etiqueta, el mes por defecto. Una etiqueta que no está en Meses es un error de entrada
  // (se devuelve, no se lanza: clasificarError_ enviaría el mensaje de un Error al cliente).
  const etiqueta = p.etiqueta == null ? porDefecto.etiqueta : p.etiqueta;
  const elegido = meses.filter((m) => m.etiqueta === etiqueta)[0];
  if (!elegido) return { ok: false, error: 'entrada' };

  const hoja = conBloqueo_(() => leerMesEnHoja_(libro, elegido.etiqueta));   // v1: un acceso a la vez
  return Object.assign(
    { etiqueta: elegido.etiqueta, mes_inicio: elegido.inicio, por_defecto: porDefecto.etiqueta,
      meses: meses.map((m) => m.etiqueta) },
    construirMes_(hoja, zona, pagosDelMes_(libro, elegido.etiqueta, zona)),   // Pagos.gs (fase 8.2)
    { ms: Date.now() - inicio });
}

/** Filas de Meses en orden: { inicio: 'yyyy-MM-dd', etiqueta }. */
function mesesDeLaHoja_(libro, zona) {
  const h = libro.getSheetByName('Meses');
  if (h.getLastRow() < 2) return [];
  return h.getRange(2, 1, h.getLastRow() - 1, 2).getValues()
    .filter((f) => f[0] instanceof Date && String(f[1]).trim())
    .map((f) => ({ inicio: textoFecha_(f[0], zona), etiqueta: String(f[1]) }));
}

/**
 * Mes en curso, salvo que la nómina del siguiente ya esté apuntada en Ingresos (cobro la última
 * semana y sigo gastando el mes en curso hasta entonces). Si hoy no está en Meses, el más cercano.
 * Devuelve { etiqueta, motivo }; el motivo solo lo usa probarMes().
 */
function mesPorDefecto_(libro, meses, zona) {
  if (!meses.length) return { etiqueta: null, motivo: 'Meses está vacía' };
  const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM') + '-01';
  let i = 0;
  meses.forEach((m, k) => { if (m.inicio <= hoy) i = k; });   // el último que ya ha empezado

  const siguiente = meses[i + 1];
  if (siguiente && nominaApuntada_(libro, siguiente.etiqueta)) {
    return { etiqueta: siguiente.etiqueta, motivo: 'la nómina de «' + siguiente.etiqueta + '» ya está apuntada' };
  }
  const motivo = meses[i].inicio === hoy ? 'mes en curso' : 'hoy no está en Meses: el más cercano';
  return { etiqueta: meses[i].etiqueta, motivo: motivo };
}

/** ¿Hay en Ingresos una fila de tipo «nómina» para ese mes? Las comisiones y los extras no cuentan. */
function nominaApuntada_(libro, etiqueta) {
  const h = libro.getSheetByName('Ingresos');
  if (h.getLastRow() < 2) return false;
  return h.getRange(2, 3, h.getLastRow() - 1, 3).getValues()   // C Mes, D Concepto, E Tipo
    .some((f) => String(f[0]) === etiqueta && normalizar(f[2]) === 'nomina');   // normalizar es de la v1
}

/** Pone el mes en B1, lee lo que calculan las fórmulas y deja B1 como estaba (también si algo falla). */
function leerMesEnHoja_(libro, etiqueta) {
  const resumen = libro.getSheetByName('Resumen');
  const celda = resumen.getRange(MES_CELDA_);
  const original = celda.getValue();
  const cambia = original !== etiqueta;   // si ya es ese mes, no hace falta recalcular
  try {
    if (cambia) {
      celda.setValue(etiqueta);
      SpreadsheetApp.flush();
    }
    const calculo = libro.getSheetByName('Cálculo');
    const movs = libro.getSheetByName('Movimientos');
    return {
      cabecera: resumen.getRange('B2:B6').getValues().map((f) => f[0]),   // inicio, fin, ingreso, previsto, restante
      ingreso: resumen.getRange('E4:E6').getValues().map((f) => f[0]),    // previsto, cobrado, origen
      tabla: resumen.getRange(MES_PRIMERA_FILA_, 1, MES_ULTIMA_FILA_ - MES_PRIMERA_FILA_ + 1, 7).getValues(),
      calculo: calculo.getLastRow() < 2 ? []
        : calculo.getRange(2, 1, calculo.getLastRow() - 1, MES_COLS_CALCULO_).getValues(),
      movimientos: movs.getLastRow() < 2 ? []
        : movs.getRange(2, 1, movs.getLastRow() - 1, 5).getValues()
    };
  } finally {
    if (cambia) {
      celda.setValue(original);
      SpreadsheetApp.flush();
    }
  }
}

/**
 * Valores leídos → cabecera, categorías (orden del Resumen) y control «cuadra». Solo transforma, no calcula.
 * pagos = { id: 'yyyy-MM-ddTHH:mm' } de las reglas marcadas como pagadas ese mes (fase 8.2).
 */
function construirMes_(h, zona, pagos) {
  pagos = pagos || {};
  const desde = textoFecha_(h.cabecera[0], zona);
  const hasta = textoFecha_(h.cabecera[1], zona);

  // Cálculo: A ID, B Concepto, C Categoría, D Tipo, N Fecha_cargo, O Veces_en_mes, P Importe_en_mes.
  // Las semanales no tienen Fecha_cargo en la hoja: van con null.
  const reglas = agrupar_(h.calculo.filter((f) => f[0] && Number(f[14]) > 0).map((f) => ({
    categoria: String(f[2]).trim(),
    id: String(f[0]), concepto: String(f[1]), tipo: String(f[3]), importe: redondear2_(f[15]),
    fecha_cargo: f[13] instanceof Date ? textoFecha_(f[13], zona) : null, veces: Number(f[14]),
    pagado: String(f[0]) in pagos, pagado_el: pagos[String(f[0])] || null
  })));

  // Movimientos: A ID, B Fecha, C Concepto, D Importe, E Categoría; solo los del mes.
  const movimientos = agrupar_(h.movimientos.filter((f) => f[0] && f[1] instanceof Date).map((f) => ({
    categoria: String(f[4]).trim(),
    id: String(f[0]), fecha: textoFecha_(f[1], zona), concepto: String(f[2]), importe: redondear2_(f[3])
  })).filter((m) => m.fecha >= desde && m.fecha <= hasta));

  // Resumen, filas «cat»: A nombre, B fijos, C presupuesto, D puntuales, E total, F disponible, G nivel.
  const categorias = h.tabla.filter((f) => f[6] === 'cat' && String(f[0]).trim()).map((f) => {
    const nombre = String(f[0]).trim();
    return {
      nombre: nombre, fijos: redondear2_(f[1]), presupuesto: redondear2_(f[2]), puntuales: redondear2_(f[3]),
      total: redondear2_(f[4]), disponible: redondear2_(f[5]),
      reglas: (reglas[nombre] || []).sort((a, b) =>
        (a.fecha_cargo || '9999').localeCompare(b.fecha_cargo || '9999') || a.concepto.localeCompare(b.concepto)),
      movimientos: (movimientos[nombre] || []).sort((a, b) => a.fecha.localeCompare(b.fecha))
    };
  }).filter((c) => c.total > 0 || c.movimientos.length);

  const totalPrevisto = redondear2_(h.cabecera[3]);
  const suma = categorias.reduce((s, c) => s + c.total, 0);
  // Pendiente de pagar: cargos fijos sin marcar (los presupuestos y los gastos puntuales no se marcan).
  const pendiente = categorias.reduce((s, c) => s + c.reglas
    .filter((g) => g.tipo !== 'presupuesto' && !g.pagado).reduce((t, g) => t + g.importe, 0), 0);
  return {
    cabecera: {
      ingreso: redondear2_(h.cabecera[2]), previsto_ingreso: redondear2_(h.ingreso[0]),
      cobrado: redondear2_(h.ingreso[1]), origen: String(h.ingreso[2]),
      total_previsto: totalPrevisto, restante: redondear2_(h.cabecera[4]), pendiente: redondear2_(pendiente)
    },
    categorias: categorias,
    cuadra: Math.round(suma * 100) === Math.round(totalPrevisto * 100)
  };
}

/** { categoría: [elementos sin el campo categoria] } */
function agrupar_(lista) {
  const grupos = {};
  lista.forEach((x) => {
    const k = x.categoria;
    delete x.categoria;
    (grupos[k] = grupos[k] || []).push(x);
  });
  return grupos;
}

/** Fecha como texto con la zona de la hoja (un objeto Date puede mover el día al serializarse). */
function textoFecha_(d, zona) {
  return d instanceof Date ? Utilities.formatDate(d, zona, 'yyyy-MM-dd') : '';
}

function redondear2_(x) {
  const n = Number(x);
  return isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/**
 * Evaluación 7.3: tres meses elegidos a propósito, con su total esperado (con Movimientos vacío) y las
 * reglas que deben estar o no. Se identifican por ID, que no cambia aunque se renombre el concepto.
 */
// Totales sin el R004 (Aina, 86 €), que se quitó al migrarlo a la categoría «Aina» (7b): antes 1.239 · 1.115 · 1.049.
const MES_CASOS_ = [
  { prefijo: 'Noviembre 2026', total: 1153, estan: ['R008', 'R010', 'R012'], faltan: [],
    motivo: 'todo activo: Klarna (último mes), T Jove y Creatina' },
  { prefijo: 'Enero 2027', total: 1029, estan: ['R009', 'R012'], faltan: ['R008', 'R010'],
    motivo: 'última cuota de Shein; sin Klarna ni T Jove; con Creatina' },
  { prefijo: 'Febrero 2027', total: 963, estan: ['R010'], faltan: ['R009', 'R012'],
    motivo: 'sin Shein ni Creatina; vuelve T Jove (cada 3 meses)' }
];

/** Desde el editor (sin la app): mes por defecto, los 3 meses de la evaluación, una etiqueta inventada y B1. */
function probarMes() {
  const libro = libro_();
  const celda = libro.getSheetByName('Resumen').getRange(MES_CELDA_);
  const antes = celda.getValue();
  Logger.log('B1 antes: ' + antes);

  const zona = libro.getSpreadsheetTimeZone();
  const meses = mesesDeLaHoja_(libro, zona);
  const def = mesPorDefecto_(libro, meses, zona);
  Logger.log('Mes por defecto: ' + def.etiqueta + ' (' + def.motivo + ')');

  let aciertos = 0;
  MES_CASOS_.forEach((caso) => {
    const etiqueta = meses.map((m) => m.etiqueta).filter((e) => e.indexOf(caso.prefijo) === 0)[0];
    if (!etiqueta) { Logger.log('❌ ' + caso.prefijo + ': no está en Meses'); return; }
    const r = mes_({ etiqueta: etiqueta });
    logMes_(r);
    if (r.ok === false) return;
    if (comprobarCasoMes_(caso, r)) aciertos++;
  });

  const malo = mes_({ etiqueta: 'Mes inventado' });
  const maloOk = malo.ok === false && malo.error === 'entrada';
  Logger.log('Etiqueta inventada → ' + (maloOk ? '✅ error entrada' : '❌ ' + JSON.stringify(malo)));

  const despues = celda.getValue();
  const restaurado = despues === antes;
  Logger.log('B1 después: ' + despues + (restaurado ? '  ✅ restaurado' : '  ❌ NO coincide con el de antes'));
  Logger.log('== Evaluación del mes: ' + aciertos + '/' + MES_CASOS_.length + (aciertos === MES_CASOS_.length ? ' ✅' : ' ❌') +
             ' · etiqueta inventada ' + (maloOk ? '✅' : '❌') + ' · B1 restaurado ' + (restaurado ? '✅' : '❌'));
}

/** Comprueba un mes contra lo esperado y lo deja en el registro. Devuelve si acierta. */
function comprobarCasoMes_(caso, r) {
  const ids = [];
  let movimientos = 0;
  r.categorias.forEach((k) => {
    k.reglas.forEach((g) => ids.push(g.id));
    movimientos += k.movimientos.length;
  });
  const fallos = [];
  if (!r.cuadra) fallos.push('no cuadra');
  caso.estan.filter((id) => ids.indexOf(id) < 0).forEach((id) => fallos.push('falta ' + id));
  caso.faltan.filter((id) => ids.indexOf(id) >= 0).forEach((id) => fallos.push('sobra ' + id));
  // El total esperado supone Movimientos vacío: con gastos puntuales en el mes, puede cambiar sin ser un error.
  const totalOk = r.cabecera.total_previsto === caso.total;
  if (!totalOk && !movimientos) fallos.push('total ' + r.cabecera.total_previsto + ', esperaba ' + caso.total);

  const aviso = !totalOk && movimientos
    ? ' ⚠️ total ' + r.cabecera.total_previsto + ' (esperaba ' + caso.total + ' con Movimientos vacío; este mes tiene ' + movimientos + ')'
    : '';
  Logger.log((fallos.length ? '❌ ' : '✅ ') + caso.prefijo + ' (' + caso.motivo + ') · ' + r.ms + ' ms' +
             (fallos.length ? ' → ' + fallos.join(' · ') : '') + aviso);
  return !fallos.length;
}

function logMes_(r) {
  if (r.ok === false) { Logger.log('ERROR ' + r.error); return; }
  const c = r.cabecera;
  Logger.log('== ' + r.etiqueta + ' (inicio ' + r.mes_inicio + ') · ' + r.ms + ' ms');
  Logger.log('Ingreso ' + c.ingreso + ' (' + c.origen + '; previsto ' + c.previsto_ingreso + ', cobrado ' + c.cobrado +
             ') · Total previsto ' + c.total_previsto + ' · Restante ' + c.restante + ' · Pendiente de pagar ' + c.pendiente);
  r.categorias.forEach((k) => {
    Logger.log('  ' + k.nombre + ': total ' + k.total + ' (fijos ' + k.fijos + ', presupuesto ' + k.presupuesto +
               ', puntuales ' + k.puntuales + ', disponible ' + k.disponible + ')');
    k.reglas.forEach((g) => Logger.log('      ' + g.id + ' ' + g.concepto + ' · ' + g.tipo + ' · ' + g.importe +
                                       ' · ' + (g.fecha_cargo || 'semanal') + (g.veces > 1 ? ' × ' + g.veces : '') +
                                       (g.pagado ? ' · ✓ pagado' : '')));
    k.movimientos.forEach((m) => Logger.log('      ' + m.id + ' ' + m.concepto + ' · ' + m.fecha + ' · ' + m.importe));
  });
  Logger.log('Cuadra: ' + (r.cuadra ? '✅' : '❌') + ' (suma de categorías = total previsto)');
}
