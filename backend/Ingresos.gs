/**
 * Ingresos.gs — Fase 9.1: apuntar y borrar ingresos (nómina, comisiones, extras) desde la app.
 * Archivo nuevo. Pestaña Ingresos: A ID · B Fecha · C Mes · D Concepto · E Tipo · F Importe · G Notas · H Registrado.
 * El Resumen suma los importes por Mes (E5, «cobrado»): en cuanto un mes tiene algún ingreso, deja de usar el
 * previsto. Las comisiones llegan a la vez que la nómina, así que no hace falta cambiar esa fórmula.
 * Apuntar la nómina del mes siguiente también cambia el mes por defecto de «Mes» (mesPorDefecto_, Mes.gs).
 *
 * Fase 15 — arrastre: la hoja calcula un solo mes a la vez (el de Resumen!B1) y no puede encadenar el restante de un mes
 * dentro del siguiente. Por eso se guarda como un dato: al apuntar la nómina del mes N+1 (que cierra el N), el servidor
 * lee el «Restante real» del N (Resumen E7, con el patrón A+) y lo copia en una fila de tipo «arrastre» del N+1. Es una
 * foto: si luego cambia un gasto del N, se recalcula con la acción `arrastre`. La app no calcula nada.
 */

const ING_HOJA_ = 'Ingresos';
const ING_TIPOS_ = ['nómina', 'comisiones', 'extra'];   // los que se apuntan desde la app
const ING_ARRASTRE_ = 'arrastre';                       // fase 15: solo lo escribe el servidor
const ING_MAX_IMPORTE_ = 100000;
const ING_MAX_CONCEPTO_ = 60;
const ING_DIAS_FUTURO_ = 60;
const ING_ULTIMOS_ = 20;
const ING_FORMATOS_ = { 2: 'dd/mm/yyyy', 6: '#,##0.00 "€"', 8: 'dd/mm/yyyy hh:mm' };
const ING_NOMBRES_MES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'octubre', 'noviembre', 'diciembre'];

/** Acción "ingresos" (solo lectura, sin tocar B1): los meses con su previsto y los últimos ingresos. */
function ingresos_() {
  const libro = libro_();   // v1
  const zona = libro.getSpreadsheetTimeZone();
  const lista = leerIngresos_(libro.getSheetByName(ING_HOJA_), zona);
  const conNomina = {};
  lista.filter((i) => normalizar(i.tipo) === 'nomina').forEach((i) => { conNomina[i.mes] = true; });   // v1

  const h = libro.getSheetByName('Meses');
  const meses = h.getLastRow() < 2 ? [] : h.getRange(2, 1, h.getLastRow() - 1, 6).getValues()
    .filter((f) => f[0] instanceof Date && String(f[1]).trim())
    .map((f) => ({ etiqueta: String(f[1]), inicio: textoFecha_(f[0], zona), previsto: redondear2_(f[2]),
                   previsto_comisiones: redondear2_(f[3]),   // fase 14: Meses D, vacía = 0
                   nomina: !!conNomina[String(f[1])],
                   periodo_inicio: textoFecha_(f[4], zona) || null, periodo_fin: textoFecha_(f[5], zona) || null }));   // Mes.gs

  return {
    hoy: Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd'),
    meses: meses,
    ingresos: lista.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id.localeCompare(a.id)).slice(0, ING_ULTIMOS_)
  };
}

/** Acción "ingreso": { tipo, importe, fecha, mes, concepto? } → escribe la fila y se puede deshacer. */
function apuntarIngreso_(p) {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const tipo = String(p.tipo == null ? '' : p.tipo);
  const mes = String(p.mes == null ? '' : p.mes);
  if (ING_TIPOS_.indexOf(tipo) < 0) return { ok: false, error: 'entrada' };
  if (!mesesDeLaHoja_(libro, zona).some((m) => m.etiqueta === mes)) return { ok: false, error: 'entrada' };   // Mes.gs

  const fecha = String(p.fecha == null ? '' : p.fecha);
  const importe = Math.round(Number(p.importe) * 100) / 100;
  const concepto = String(p.concepto == null ? '' : p.concepto).replace(/\s+/g, ' ').trim() ||
                   conceptoPorDefecto_(tipo, fecha);
  const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
  // Errores de negocio con un mensaje para el usuario: se devuelven, no se lanzan.
  const error = validarIngreso_(importe, fecha, concepto, hoy);
  if (error) return { ok: false, error: 'rechazado', mensaje: error };

  return conBloqueo_(() => {   // v1: un acceso a la vez
    const hoja = libro.getSheetByName(ING_HOJA_);
    if (tipo === 'nómina') {
      const repetida = leerIngresos_(hoja, zona).filter((i) => i.mes === mes && normalizar(i.tipo) === 'nomina')[0];
      if (repetida) {
        return { ok: false, error: 'rechazado', mensaje: 'Ya hay una nómina apuntada en ese mes (' + repetida.concepto +
                 '). Si es otro ingreso, apúntalo como «extra».' };
      }
    }
    const id = siguienteId_(hoja, 'I');   // v1: I001, I002…
    // Fecha como número de serie (v1): un objeto Date podría mover el día por la zona horaria.
    escribirFila_(hoja, [id, fechaSerial_(fecha), mes, concepto, tipo, importe, '', ahoraSerial_()], ING_FORMATOS_);   // v1

    // Fase 15: la nómina cierra el mes anterior; su restante pasa a este. Un solo Deshacer quita las dos filas.
    // Si el arrastre falla, la nómina ya está escrita: se responde con ella y su Deshacer, y el motivo dice qué hacer.
    let r = { arrastre: null, motivo: null };
    if (tipo === 'nómina') {
      try {
        r = apuntarArrastre_(libro, hoja, mes, fecha, zona);
      } catch (e) {
        console.error('Arrastre: ' + e);
        r = { arrastre: null, motivo: 'no se ha podido calcular; deshaz y vuelve a apuntar la nómina' };
      }
    }
    const pasos = [{ op: 'borrar', hoja: ING_HOJA_, id: id }];
    if (r.arrastre) pasos.push({ op: 'borrar', hoja: ING_HOJA_, id: r.arrastre.id });
    apuntarDeshacer_('Ingreso «' + concepto + '» borrado' + (r.arrastre ? ' (y su arrastre)' : ''), pasos);   // v1

    return { id: id, desc: '«' + concepto + '» apuntado en ' + mes,
             ingreso: { id: id, fecha: fecha, mes: mes, concepto: concepto, tipo: tipo, importe: importe },
             arrastre: r.arrastre, motivo_arrastre: r.motivo };
  });
}

/** Acción "borrar_ingreso": { id } → borra la fila; Deshacer la vuelve a añadir (paso «fila» de la v1). */
function borrarIngreso_(p) {
  const id = String(p.id == null ? '' : p.id);
  return conBloqueo_(() => {
    const hoja = libro_().getSheetByName(ING_HOJA_);
    const fila = buscarFilaPorId_(hoja, id);   // v1
    if (fila < 0) return { ok: false, error: 'rechazado', mensaje: 'Ese ingreso ya no existe (¿se borró a mano?). Recarga la lista.' };

    const valores = hoja.getRange(fila, 1, 1, 8).getValues()[0];
    // Fase 15: sin su nómina, el mes anterior vuelve a estar abierto → también se va el arrastre de ese mes.
    const arrastre = normalizar(valores[4]) === 'nomina' ? filaArrastre_(hoja, String(valores[2])) : null;   // v1
    const filas = [{ fila: fila, valores: valores }];
    if (arrastre) filas.push({ fila: arrastre.fila, valores: hoja.getRange(arrastre.fila, 1, 1, 8).getValues()[0] });
    filas.slice().sort((a, b) => b.fila - a.fila).forEach((f) => hoja.deleteRow(f.fila));   // de abajo arriba
    // aJSON_ (v1) guarda las fechas como número de serie para que Deshacer las escriba igual.
    apuntarDeshacer_('Ingreso «' + valores[3] + '» recuperado' + (arrastre ? ' (y su arrastre)' : ''),
                     filas.map((f) => ({ op: 'fila', hoja: ING_HOJA_, valores: f.valores.map(aJSON_) })));
    return { id: id, desc: 'Ingreso «' + valores[3] + '» borrado' +
                           (arrastre ? ' y también «' + arrastre.concepto + '» (' + textoEuros_(arrastre.importe) + ')' : ''),
             arrastre_borrado: arrastre ? { id: arrastre.id, importe: arrastre.importe } : null };
  });
}

/* ---------- Fase 15: arrastre del restante al mes siguiente ---------- */

/**
 * Acción "arrastre": { etiqueta } → recalcula el arrastre de ese mes (el restante real del anterior, ahora) y sustituye
 * el importe de su fila; si falta, la crea; si da 0, la borra. Sin Deshacer (como pagar): la respuesta dice el antes y
 * el después y trae el mes ya recalculado (un viaje, como previsto).
 */
function arrastre_(p) {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const etiqueta = String(p.etiqueta == null ? '' : p.etiqueta);
  if (!mesesDeLaHoja_(libro, zona).some((m) => m.etiqueta === etiqueta)) return { ok: false, error: 'entrada' };

  const r = conBloqueo_(() => {
    const hoja = libro.getSheetByName(ING_HOJA_);
    const c = calcularArrastre_(libro, etiqueta, zona);
    if (c.importe == null) return { ok: false, error: 'rechazado', mensaje: 'No se puede recalcular: ' + c.motivo + '.' };
    const actual = filaArrastre_(hoja, etiqueta);
    const anterior = actual ? actual.importe : 0;
    let id = actual ? actual.id : null;
    if (c.importe === 0) {
      if (actual) hoja.deleteRow(actual.fila);
      id = null;
    } else if (actual) {
      hoja.getRange(actual.fila, 6).setValue(c.importe);
    } else {
      id = escribirArrastre_(hoja, etiqueta, c, nominaDelMes_(hoja, etiqueta, zona).fecha);
    }
    return { etiqueta: etiqueta, id: id, desde: c.desde, concepto: 'Restante de ' + c.nombre, anterior: anterior,
             importe: c.importe };
  });
  if (r.ok === false) return r;
  const mes = mes_({ etiqueta: etiqueta });   // Mes.gs; fuera del bloqueo, porque mes_ toma el suyo
  return Object.assign(r, { mes: mes.ok === false ? null : mes });
}

/** Tras apuntar la nómina del mes nuevo: escribe su arrastre o dice por qué no. Dentro del bloqueo de quien llama. */
function apuntarArrastre_(libro, hoja, mesNuevo, fecha, zona) {
  const ya = filaArrastre_(hoja, mesNuevo);
  if (ya) return { arrastre: null, motivo: 'ya había uno (' + textoEuros_(ya.importe) + '): usa «Recalcular» en «Mes»' };
  const c = calcularArrastre_(libro, mesNuevo, zona);
  if (c.importe == null) return { arrastre: null, motivo: c.motivo };
  if (c.importe === 0) return { arrastre: null, motivo: 'el restante de ' + c.nombre + ' es 0,00 €' };
  const id = escribirArrastre_(hoja, mesNuevo, c, fecha);
  return { arrastre: { id: id, importe: c.importe, desde: c.desde, concepto: 'Restante de ' + c.nombre }, motivo: null };
}

/**
 * Restante real del mes anterior a mesNuevo: { desde, nombre, importe } o { motivo } si no se puede. Solo hay arrastre si
 * los dos meses tienen nómina: la del anterior (lo cobrado de verdad) y la del nuevo (que lo cierra: fase 13).
 */
function calcularArrastre_(libro, mesNuevo, zona) {
  const meses = mesesDeLaHoja_(libro, zona);   // Mes.gs
  const i = meses.map((m) => m.etiqueta).indexOf(mesNuevo);
  if (i <= 0) return { motivo: 'no hay un mes anterior en Meses' };
  const cerrado = meses[i - 1];
  const nombre = ING_NOMBRES_MES_[Number(cerrado.inicio.slice(5, 7)) - 1];
  if (!nominaApuntada_(libro, cerrado.etiqueta)) return { motivo: nombre + ' no tiene nómina apuntada' };   // Mes.gs
  if (!nominaApuntada_(libro, mesNuevo)) return { motivo: nombre + ' aún no está cerrado (falta la nómina del mes siguiente)' };
  const valor = enMes_(libro, cerrado.etiqueta, (resumen) => resumen.getRange(MES_RESTANTE_REAL_).getValue());   // Mes.gs
  if (typeof valor !== 'number') return { motivo: 'la hoja no tiene «Restante real» (falta aplicarFase15)' };
  return { desde: cerrado.etiqueta, nombre: nombre, importe: redondear2_(valor) };
}

function escribirArrastre_(hoja, mesNuevo, c, fecha) {
  const id = siguienteId_(hoja, 'I');   // v1
  escribirFila_(hoja, [id, fechaSerial_(fecha), mesNuevo, 'Restante de ' + c.nombre, ING_ARRASTRE_, c.importe, '',
                       ahoraSerial_()], ING_FORMATOS_);   // v1
  return id;
}

/** La fila del arrastre de ese mes: { fila, id, concepto, importe } o null. Hay como mucho una. */
function filaArrastre_(hoja, mes) {
  if (hoja.getLastRow() < 2) return null;
  const valores = hoja.getRange(2, 1, hoja.getLastRow() - 1, 6).getValues();
  const i = valores.findIndex((f) => String(f[0]).trim() && String(f[2]) === mes && String(f[4]) === ING_ARRASTRE_);
  return i < 0 ? null : { fila: i + 2, id: String(valores[i][0]), concepto: String(valores[i][3]), importe: redondear2_(valores[i][5]) };
}

/** La nómina apuntada de ese mes ({ id, fecha, … }) o null. */
function nominaDelMes_(hoja, mes, zona) {
  return leerIngresos_(hoja, zona).filter((i) => i.mes === mes && normalizar(i.tipo) === 'nomina')[0] || null;
}

/** 86 → "86,00 €", -50 → "-50,00 €" (para los textos del servidor). */
function textoEuros_(n) {
  return (n < 0 ? '-' : '') + Math.abs(n).toFixed(2).replace('.', ',') + ' €';
}

/** Devuelve el mensaje del primer problema, o null si se puede apuntar. No escribe nada. */
function validarIngreso_(importe, fecha, concepto, hoy) {
  if (!(importe > 0)) return 'Pon un importe mayor que 0.';
  if (importe > ING_MAX_IMPORTE_) return 'El importe parece demasiado alto (máximo ' + ING_MAX_IMPORTE_ + ' €).';
  if (!fechaValida_(fecha)) return 'Pon una fecha válida.';
  if (fecha > sumarDias_(hoy, ING_DIAS_FUTURO_)) return 'La fecha no puede ser de dentro de más de ' + ING_DIAS_FUTURO_ + ' días.';
  if (concepto.length > ING_MAX_CONCEPTO_) return 'El concepto puede tener como máximo ' + ING_MAX_CONCEPTO_ + ' caracteres.';
  if (/^[=+\-@]/.test(concepto)) return 'El concepto no puede empezar por =, +, - ni @.';
  return null;
}

/** "nómina" + "2026-10-28" → "Nómina octubre" (el mes en que entra el dinero, como en la Guía). */
function conceptoPorDefecto_(tipo, fecha) {
  const t = tipo.charAt(0).toUpperCase() + tipo.slice(1);
  return fechaValida_(fecha) ? t + ' ' + ING_NOMBRES_MES_[Number(fecha.slice(5, 7)) - 1] : t;
}

/** Filas con ID: { id, fecha, mes, concepto, tipo, importe }. */
function leerIngresos_(hoja, zona) {
  if (!hoja) throw new Error('No existe la pestaña Ingresos.');
  if (hoja.getLastRow() < 2) return [];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, 6).getValues().filter((f) => String(f[0]).trim()).map((f) => ({
    id: String(f[0]), fecha: textoFecha_(f[1], zona), mes: String(f[2]), concepto: String(f[3]), tipo: String(f[4]),
    importe: redondear2_(f[5])
  }));
}

function fechaValida_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];   // descarta el 31 de febrero
}

function sumarDias_(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Prueba desde el editor (sin la app):
 *  1. Las validaciones, sin escribir nada.
 *  2. Apunta una nómina de prueba en el último mes de Meses, comprueba la fila, que «Mes» la cuenta como cobrada y
 *     que no deja apuntar otra; añade unas comisiones y comprueba que «Mes» devuelve los dos ingresos y que suman el
 *     cobrado (fase 12); borra la nómina y prueba el Deshacer. Deja Ingresos y ULTIMO como estaban.
 *  3. Fase 14, cada tipo por separado (con 300 € de comisiones previstas en ese mes): (a) nada cobrado → nómina y
 *     comisiones previstas, «previsto»; (b) solo la nómina → nómina cobrada + comisiones previstas, «parcial»;
 *     (c) las dos → lo cobrado, «cobrado»; (d) un extra → se suma aparte. Meses D queda como estaba.
 */
function probarIngresos() {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
  const casos = [
    ['importe 0', 0, hoy, 'Nómina', true],
    ['importe negativo', -5, hoy, 'Nómina', true],
    ['importe no numérico', NaN, hoy, 'Nómina', true],
    ['importe enorme', ING_MAX_IMPORTE_ + 1, hoy, 'Nómina', true],
    ['fecha vacía', 1370, '', 'Nómina', true],
    ['fecha imposible (31 feb)', 1370, '2027-02-31', 'Nómina', true],
    ['fecha a más de 60 días', 1370, sumarDias_(hoy, ING_DIAS_FUTURO_ + 1), 'Nómina', true],
    ['concepto largo', 1370, hoy, 'x'.repeat(ING_MAX_CONCEPTO_ + 1), true],
    ['concepto que empieza por =', 1370, hoy, '=SUMA(A1)', true],
    ['válido', 1370, hoy, 'Nómina octubre', false],
    ['válido a 60 días', 1370, sumarDias_(hoy, ING_DIAS_FUTURO_), 'Nómina', false]
  ];
  let ok = 0;
  casos.forEach(([caso, importe, fecha, concepto, debeFallar]) => {
    const error = validarIngreso_(importe, fecha, concepto, hoy);
    const bien = debeFallar ? !!error : !error;
    if (bien) ok++;
    Logger.log((bien ? '✅ ' : '❌ ') + caso + ' → ' + (error || 'se puede apuntar'));
  });
  const defecto = conceptoPorDefecto_('nómina', '2026-10-28');
  if (defecto === 'Nómina octubre') ok++;
  Logger.log((defecto === 'Nómina octubre' ? '✅ ' : '❌ ') + 'concepto por defecto → ' + defecto);

  const meses = mesesDeLaHoja_(libro, zona).map((m) => m.etiqueta);
  const mes = meses[meses.length - 1];   // el más lejano: casi seguro que no tiene ingresos
  const entrada = [
    ['tipo inventado', { tipo: 'sueldo', importe: 1, fecha: hoy, mes: mes }],
    ['mes inventado', { tipo: 'extra', importe: 1, fecha: hoy, mes: 'Mes inventado' }]
  ];
  entrada.forEach(([caso, params]) => {
    const r = apuntarIngreso_(params);
    if (r.error === 'entrada') ok++;
    Logger.log((r.error === 'entrada' ? '✅ ' : '❌ ') + caso + ' → error ' + r.error);
  });
  Logger.log('Validaciones: ' + ok + '/' + (casos.length + 1 + entrada.length));

  // Ingreso real, con limpieza en el finally.
  const hoja = libro.getSheetByName(ING_HOJA_);
  const props = PropertiesService.getScriptProperties();
  const ultimo = props.getProperty('ULTIMO');
  const filasAntes = hoja.getLastRow();
  const fecha = hoy;
  let id = null;
  let idComisiones = null;
  let idExtra = null;
  const celdaComisiones = libro.getSheetByName('Meses').getRange(filaDeMes_(libro.getSheetByName('Meses'), mes), PREV_COLUMNAS_.comisiones);   // Previstos.gs
  const comisionesAntes = celdaComisiones.getValue();
  const reparto = (r, tipo) => r.cabecera.desglose.filter((x) => x.tipo === tipo)[0];
  try {
    // (a) Nada cobrado: cuentan la nómina prevista y las comisiones previstas.
    celdaComisiones.setValue(300);
    const m0 = mes_({ etiqueta: mes });
    const nominaPrevista = reparto(m0, 'nómina').previsto;
    const a = m0.cabecera.ingreso === redondear2_(nominaPrevista + 300) && m0.cabecera.origen === 'previsto';
    Logger.log((a ? '✅ ' : '❌ ') + '(a) nada cobrado → ingreso ' + m0.cabecera.ingreso + ' = nómina prevista ' + nominaPrevista +
               ' + comisiones previstas 300 (' + m0.cabecera.origen + ')');

    const r = apuntarIngreso_({ tipo: 'nómina', importe: 1234.56, fecha: fecha, mes: mes });
    if (r.ok === false) { Logger.log('❌ Apuntar → ' + (r.mensaje || r.error)); return; }
    id = r.id;
    // Fase 15: si el mes anterior tuviera nómina, se habría creado un arrastre; aquí estorba (las cuentas son fijas).
    if (r.arrastre) {
      hoja.deleteRow(buscarFilaPorId_(hoja, r.arrastre.id));
      Logger.log('· Arrastre de prueba quitado (' + r.arrastre.importe + '): esta prueba no va de arrastres');
    }
    const f = hoja.getRange(buscarFilaPorId_(hoja, id), 1, 1, 8).getValues()[0];
    const filaOk = textoFecha_(f[1], zona) === fecha && f[2] === mes && f[4] === 'nómina' && Number(f[5]) === 1234.56 &&
                   f[7] instanceof Date;
    Logger.log((filaOk ? '✅ ' : '❌ ') + 'Apuntado ' + id + ' «' + f[3] + '» · ' + textoFecha_(f[1], zona) + ' · ' + f[5] + ' € en ' + mes);

    // (b) Solo la nómina cobrada: sustituye a la nómina prevista; las comisiones previstas siguen contando.
    const m = mes_({ etiqueta: mes });
    const cobrado = m.cabecera.cobrado === 1234.56 && m.cabecera.origen === 'parcial' && m.cabecera.ingreso === redondear2_(1234.56 + 300);
    Logger.log((cobrado ? '✅ ' : '❌ ') + '(b) solo la nómina → cobrado ' + m.cabecera.cobrado + ' · ingreso ' + m.cabecera.ingreso +
               ' = 1234.56 + 300 previstas (' + m.cabecera.origen + ') · restante ' + m.cabecera.restante);

    const lista = ingresos_();
    const enLista = lista.ingresos.some((i) => i.id === id) && lista.meses.filter((x) => x.etiqueta === mes)[0].nomina;
    Logger.log((enLista ? '✅ ' : '❌ ') + 'Sale en la lista de ingresos y el mes figura con nómina');

    const otra = apuntarIngreso_({ tipo: 'nómina', importe: 1000, fecha: fecha, mes: mes });
    Logger.log((otra.ok === false && otra.mensaje ? '✅ ' : '❌ ') + 'Otra nómina en el mismo mes → ' + (otra.mensaje || 'se apuntó (no debería)'));

    // Fase 12: «Mes» devuelve los ingresos que forman el cobrado.
    const com = apuntarIngreso_({ tipo: 'comisiones', importe: 250, fecha: fecha, mes: mes });
    idComisiones = com.id || null;
    const m2 = mes_({ etiqueta: mes });
    const ids = m2.ingresos.map((i) => i.id);
    const suma = redondear2_(m2.ingresos.reduce((s, i) => s + i.importe, 0));
    const listaMes = com.ok !== false && ids.length === 2 && ids.indexOf(id) >= 0 && ids.indexOf(idComisiones) >= 0 &&
                     suma === 1484.56 && suma === m2.cabecera.cobrado;
    Logger.log((listaMes ? '✅ ' : '❌ ') + '«Mes» lista los ingresos del mes: ' +
               m2.ingresos.map((i) => i.concepto + ' ' + i.importe).join(' + ') + ' = ' + suma + ' · cobrado ' + m2.cabecera.cobrado);
    // (c) Las dos cobradas: las comisiones cobradas (250) sustituyen a las previstas (300).
    const c = m2.cabecera.ingreso === 1484.56 && m2.cabecera.origen === 'cobrado';
    Logger.log((c ? '✅ ' : '❌ ') + '(c) nómina y comisiones cobradas → ingreso ' + m2.cabecera.ingreso + ' (' + m2.cabecera.origen + ')');

    // (d) Un extra: no tiene previsto, se suma aparte.
    const ext = apuntarIngreso_({ tipo: 'extra', importe: 50, fecha: fecha, mes: mes });
    idExtra = ext.id || null;
    const m3 = mes_({ etiqueta: mes });
    const d4 = m3.cabecera.ingreso === 1534.56 && m3.cabecera.cobrado === 1534.56 && reparto(m3, 'extra').cuenta === 50 &&
               m3.cabecera.origen === 'cobrado';
    Logger.log((d4 ? '✅ ' : '❌ ') + '(d) extra de 50 → ingreso ' + m3.cabecera.ingreso + ' · reparto ' +
               m3.cabecera.desglose.map((x) => x.tipo + ' ' + x.cuenta).join(' + ') + ' (' + m3.cabecera.origen + ')');

    const b = borrarIngreso_({ id: id });
    const borrada = b.ok !== false && buscarFilaPorId_(hoja, id) < 0;
    const u = JSON.parse(props.getProperty('ULTIMO') || 'null');
    const paso = u && u.pasos && u.pasos[0].op === 'fila';
    Logger.log((borrada && paso ? '✅ ' : '❌ ') + 'Borrado → ' + (b.desc || b.mensaje) + ' · Deshacer apuntado: ' + (u ? u.desc : 'nada'));

    const d = deshacer(props.getProperty('TOKEN'));   // v1: el Deshacer de verdad, como lo usaría la app
    const vuelta = buscarFilaPorId_(hoja, id);
    const g = vuelta > 0 ? hoja.getRange(vuelta, 1, 1, 6).getValues()[0] : [];
    const recuperada = vuelta > 0 && textoFecha_(g[1], zona) === fecha && Number(g[5]) === 1234.56;
    Logger.log((recuperada ? '✅ ' : '❌ ') + 'Deshacer → ' + d.desc + ' · fecha ' + textoFecha_(g[1], zona) + ' · ' + g[5] + ' €');
  } finally {
    [id, idComisiones, idExtra].filter((x) => x).forEach((x) => {
      let f;
      while ((f = buscarFilaPorId_(hoja, x)) > 0) hoja.deleteRow(f);
    });
    if (comisionesAntes === '') celdaComisiones.clearContent();
    else celdaComisiones.setValue(comisionesAntes);
    if (ultimo === null) props.deleteProperty('ULTIMO');
    else props.setProperty('ULTIMO', ultimo);
    const igual = hoja.getLastRow() === filasAntes && props.getProperty('ULTIMO') === ultimo &&
                  celdaComisiones.getValue() === comisionesAntes;
    Logger.log((igual ? '✅ ' : '❌ ') + 'Limpieza: Ingresos, Meses D y el Deshacer pendiente como estaban');
  }
}

/**
 * Prueba desde el editor (fase 15), en los dos últimos meses de Meses (N y N+1), que no deben tener ingresos. Las nóminas
 * de prueba de (a), (b) y (e) se escriben con la fecha del día 1 de su mes para que el periodo de N sea el mes natural
 * (apuntarIngreso_ no acepta fechas a más de 60 días); (c) y (d) pasan por apuntarIngreso_ de verdad, con fecha de hoy.
 *  (a) nómina en N, un gasto puntual en N y nómina en N+1 → arrastre = cobrado − fijos − puntuales = «Restante real».
 *  (e) «arrastre» (Recalcular) tras otro gasto en N → baja justo ese gasto; dos veces → una sola fila.
 *  (b) más gasto que ingreso → arrastre negativo.
 *  (d) apuntar la nómina de N+1 y Deshacer → se van las dos filas; borrarla → también su arrastre, y Deshacer las recupera.
 *  (c) N sin nómina → no hay arrastre y el motivo lo dice; Recalcular → rechazado.
 *  (f) el tipo «arrastre» desde la acción ingreso → entrada.
 * Limpieza en finally: Ingresos de N y N+1, los gastos de prueba y el Deshacer pendiente como estaban.
 */
function probarArrastre() {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
  const meses = mesesDeLaHoja_(libro, zona);   // Mes.gs
  const n = meses[meses.length - 2];
  const n1 = meses[meses.length - 1];
  const hoja = libro.getSheetByName(ING_HOJA_);
  const movs = libro.getSheetByName('Movimientos');
  const props = PropertiesService.getScriptProperties();
  const ultimo = props.getProperty('ULTIMO');
  const filasAntes = hoja.getLastRow();
  if (leerIngresos_(hoja, zona).some((i) => i.mes === n.etiqueta || i.mes === n1.etiqueta)) {
    return Logger.log('⚠️ ' + n.etiqueta + ' o ' + n1.etiqueta + ' ya tienen ingresos: no se prueba para no tocar datos reales.');
  }
  Logger.log('== N = ' + n.etiqueta + ' · N+1 = ' + n1.etiqueta);

  const r0 = apuntarIngreso_({ tipo: ING_ARRASTRE_, importe: 10, fecha: hoy, mes: n1.etiqueta });
  Logger.log((r0.error === 'entrada' ? '✅ ' : '❌ ') + '(f) tipo «arrastre» desde ingreso → error ' + r0.error);

  const cat = nombresCategorias_(libro.getSheetByName('Categorías'));   // Categorias.gs
  const categoria = cat.indexOf('Otros') >= 0 ? 'Otros' : cat[0];
  const idsMov = [];
  const gasto = (importe) => {
    const id = siguienteId_(movs, 'M');   // v1
    escribirFila_(movs, [id, fechaSerial_(sumarDias_(n.inicio, 14)), 'Prueba 15', importe, categoria, 'probarArrastre',
                         ahoraSerial_()], { 2: 'dd/mm/yyyy', 4: '#,##0.00 "€"', 7: 'dd/mm/yyyy hh:mm' });
    idsMov.push(id);
    return id;
  };
  const nomina = (mes, fecha, importe) => {   // directa, sin las validaciones de apuntarIngreso_
    const id = siguienteId_(hoja, 'I');
    escribirFila_(hoja, [id, fechaSerial_(fecha), mes, 'Prueba 15', 'nómina', importe, '', ahoraSerial_()], ING_FORMATOS_);
    return id;
  };
  const borrarId = (h, id) => { let f; while ((f = buscarFilaPorId_(h, id)) > 0) h.deleteRow(f); };
  // Lo que dice la hoja del mes N: cobrado (E5), fijos (B130), puntuales (D130) y el restante real (E7).
  const hojaN = () => enMes_(libro, n.etiqueta, (r) => ({ cobrado: r.getRange('E5').getValue(),
    fijos: r.getRange('B130').getValue(), puntuales: r.getRange('D130').getValue(),
    real: r.getRange(MES_RESTANTE_REAL_).getValue() }));
  const filasArrastre = () => leerIngresos_(hoja, zona).filter((i) => i.mes === n1.etiqueta && i.tipo === ING_ARRASTRE_);
  try {
    // (a) Nómina en N (1500), un gasto puntual de 40 € en N y nómina en N+1 → arrastre.
    const idN = nomina(n.etiqueta, n.inicio, 1500);
    gasto(40);
    let idN1 = nomina(n1.etiqueta, n1.inicio, 1400);
    const a = apuntarArrastre_(libro, hoja, n1.etiqueta, n1.inicio, zona);
    const h = hojaN();
    const esperado = redondear2_(h.cobrado - h.fijos - h.puntuales);
    const bienA = a.arrastre && a.arrastre.importe === esperado && esperado === redondear2_(h.real) &&
                  h.puntuales >= 40 && filasArrastre().length === 1;
    Logger.log((bienA ? '✅ ' : '❌ ') + '(a) arrastre ' + (a.arrastre ? a.arrastre.importe : a.motivo) + ' = cobrado ' +
               h.cobrado + ' − fijos ' + h.fijos + ' − puntuales ' + h.puntuales + ' = ' + esperado + ' · Restante real ' +
               h.real + ' · «' + (a.arrastre ? a.arrastre.concepto : '') + '»');
    const m1 = mes_({ etiqueta: n1.etiqueta });
    const enReparto = m1.cabecera.desglose.filter((d) => d.tipo === ING_ARRASTRE_)[0];
    const bienR = enReparto && enReparto.cobrado === esperado && enReparto.cuenta === esperado && enReparto.previsto === 0;
    Logger.log((bienR ? '✅ ' : '❌ ') + '«Mes» de N+1: reparto arrastre ' + JSON.stringify(enReparto) + ' · ingreso ' +
               m1.cabecera.ingreso + ' (' + m1.cabecera.origen + ')');

    // (e) Otro gasto de 10 € en N y Recalcular dos veces → baja 10, una sola fila.
    const idGasto2 = gasto(10);
    const e1 = arrastre_({ etiqueta: n1.etiqueta });
    const e2 = arrastre_({ etiqueta: n1.etiqueta });
    const bienE = e1.anterior === esperado && e1.importe === redondear2_(esperado - 10) && e2.anterior === e1.importe &&
                  e2.importe === e1.importe && filasArrastre().length === 1 && e1.mes && e1.mes.etiqueta === n1.etiqueta;
    Logger.log((bienE ? '✅ ' : '❌ ') + '(e) Recalcular tras un gasto de 10 → ' + e1.anterior + ' → ' + e1.importe +
               '; otra vez → ' + e2.anterior + ' → ' + e2.importe + ' · filas de arrastre: ' + filasArrastre().length);

    // (b) Más gasto que ingreso → negativo.
    movs.getRange(buscarFilaPorId_(movs, idGasto2), 4).setValue(5000);
    const b = arrastre_({ etiqueta: n1.etiqueta });
    const realB = redondear2_(hojaN().real);
    const bienB = b.importe < 0 && b.importe === realB && filasArrastre()[0].importe === b.importe;
    Logger.log((bienB ? '✅ ' : '❌ ') + '(b) con un gasto de 5000 → arrastre ' + b.importe + ' (Restante real ' + realB + ')');

    // (d) apuntarIngreso_ de verdad: quitar la nómina de N+1 y su arrastre, apuntarla otra vez y Deshacer.
    borrarId(hoja, idN1);
    filasArrastre().forEach((x) => borrarId(hoja, x.id));
    const d = apuntarIngreso_({ tipo: 'nómina', importe: 1400, fecha: hoy, mes: n1.etiqueta });
    idN1 = d.id;
    const conDos = d.arrastre && buscarFilaPorId_(hoja, d.id) > 0 && buscarFilaPorId_(hoja, d.arrastre.id) > 0;
    Logger.log((conDos ? '✅ ' : '❌ ') + '(d) apuntar la nómina de N+1 → ' + d.desc + ' · arrastre ' +
               (d.arrastre ? d.arrastre.id + ' ' + d.arrastre.importe : 'ninguno (' + d.motivo_arrastre + ')'));
    const token = props.getProperty('TOKEN');
    const u = deshacer(token);   // v1: el Deshacer de verdad
    const sinDos = buscarFilaPorId_(hoja, d.id) < 0 && filasArrastre().length === 0;
    Logger.log((sinDos ? '✅ ' : '❌ ') + '(d) Deshacer → ' + u.desc + ' · quedan ' + filasArrastre().length + ' arrastres');

    const d2 = apuntarIngreso_({ tipo: 'nómina', importe: 1400, fecha: hoy, mes: n1.etiqueta });
    idN1 = d2.id;
    const bo = borrarIngreso_({ id: d2.id });
    const sinAmbas = bo.arrastre_borrado && buscarFilaPorId_(hoja, d2.id) < 0 && filasArrastre().length === 0;
    Logger.log((sinAmbas ? '✅ ' : '❌ ') + '(d) borrar la nómina de N+1 → ' + bo.desc);
    const u2 = deshacer(token);
    const vuelven = buscarFilaPorId_(hoja, d2.id) > 0 && filasArrastre().length === 1;
    Logger.log((vuelven ? '✅ ' : '❌ ') + '(d) Deshacer → ' + u2.desc + ' · nómina y arrastre de vuelta');

    // (c) N sin nómina: Recalcular se rechaza y una nómina nueva en N+1 no crea arrastre.
    borrarId(hoja, idN);
    const c1 = arrastre_({ etiqueta: n1.etiqueta });
    borrarId(hoja, d2.id);
    filasArrastre().forEach((x) => borrarId(hoja, x.id));
    const c2 = apuntarIngreso_({ tipo: 'nómina', importe: 1400, fecha: hoy, mes: n1.etiqueta });
    idN1 = c2.id;
    const bienC = c1.error === 'rechazado' && !c2.arrastre && /no tiene nómina/.test(c2.motivo_arrastre || '');
    Logger.log((bienC ? '✅ ' : '❌ ') + '(c) N sin nómina → Recalcular: ' + (c1.mensaje || c1.error) +
               ' · nómina en N+1: sin arrastre (' + c2.motivo_arrastre + ')');
  } finally {
    leerIngresos_(hoja, zona).filter((i) => i.mes === n.etiqueta || i.mes === n1.etiqueta).forEach((i) => borrarId(hoja, i.id));
    idsMov.forEach((id) => borrarId(movs, id));
    if (ultimo === null) props.deleteProperty('ULTIMO');
    else props.setProperty('ULTIMO', ultimo);
    const igual = hoja.getLastRow() === filasAntes && idsMov.every((id) => buscarFilaPorId_(movs, id) < 0) &&
                  props.getProperty('ULTIMO') === ultimo;
    Logger.log((igual ? '✅ ' : '❌ ') + 'Limpieza: Ingresos, Movimientos y el Deshacer pendiente como estaban');
  }
}
