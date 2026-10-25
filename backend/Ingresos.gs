/**
 * Ingresos.gs — Fase 9.1: apuntar y borrar ingresos (nómina, comisiones, extras) desde la app.
 * Archivo nuevo. Pestaña Ingresos: A ID · B Fecha · C Mes · D Concepto · E Tipo · F Importe · G Notas · H Registrado.
 * El Resumen suma los importes por Mes (E5, «cobrado»): en cuanto un mes tiene algún ingreso, deja de usar el
 * previsto. Las comisiones llegan a la vez que la nómina, así que no hace falta cambiar esa fórmula.
 * Apuntar la nómina del mes siguiente también cambia el mes por defecto de «Mes» (mesPorDefecto_, Mes.gs).
 */

const ING_HOJA_ = 'Ingresos';
const ING_TIPOS_ = ['nómina', 'comisiones', 'extra'];   // los del desplegable de la hoja
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
  const meses = h.getLastRow() < 2 ? [] : h.getRange(2, 1, h.getLastRow() - 1, 3).getValues()
    .filter((f) => f[0] instanceof Date && String(f[1]).trim())
    .map((f) => ({ etiqueta: String(f[1]), inicio: textoFecha_(f[0], zona), previsto: redondear2_(f[2]),
                   nomina: !!conNomina[String(f[1])] }));   // Mes.gs

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
    apuntarDeshacer_('Ingreso «' + concepto + '» borrado', [{ op: 'borrar', hoja: ING_HOJA_, id: id }]);   // v1

    return { id: id, desc: '«' + concepto + '» apuntado en ' + mes,
             ingreso: { id: id, fecha: fecha, mes: mes, concepto: concepto, tipo: tipo, importe: importe } };
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
    hoja.deleteRow(fila);
    // aJSON_ (v1) guarda las fechas como número de serie para que Deshacer las escriba igual.
    apuntarDeshacer_('Ingreso «' + valores[3] + '» recuperado', [{ op: 'fila', hoja: ING_HOJA_, valores: valores.map(aJSON_) }]);
    return { id: id, desc: 'Ingreso «' + valores[3] + '» borrado' };
  });
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
 *     que no deja apuntar otra; la borra y prueba el Deshacer. Deja Ingresos y ULTIMO como estaban.
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
  try {
    const r = apuntarIngreso_({ tipo: 'nómina', importe: 1234.56, fecha: fecha, mes: mes });
    if (r.ok === false) { Logger.log('❌ Apuntar → ' + (r.mensaje || r.error)); return; }
    id = r.id;
    const f = hoja.getRange(buscarFilaPorId_(hoja, id), 1, 1, 8).getValues()[0];
    const filaOk = textoFecha_(f[1], zona) === fecha && f[2] === mes && f[4] === 'nómina' && Number(f[5]) === 1234.56 &&
                   f[7] instanceof Date;
    Logger.log((filaOk ? '✅ ' : '❌ ') + 'Apuntado ' + id + ' «' + f[3] + '» · ' + textoFecha_(f[1], zona) + ' · ' + f[5] + ' € en ' + mes);

    const m = mes_({ etiqueta: mes });
    const cobrado = m.cabecera.cobrado === 1234.56 && m.cabecera.origen === 'cobrado';
    Logger.log((cobrado ? '✅ ' : '❌ ') + '«Mes» lo cuenta: cobrado ' + m.cabecera.cobrado + ' (' + m.cabecera.origen + ') · ingreso ' +
               m.cabecera.ingreso + ' · restante ' + m.cabecera.restante);

    const lista = ingresos_();
    const enLista = lista.ingresos.some((i) => i.id === id) && lista.meses.filter((x) => x.etiqueta === mes)[0].nomina;
    Logger.log((enLista ? '✅ ' : '❌ ') + 'Sale en la lista de ingresos y el mes figura con nómina');

    const otra = apuntarIngreso_({ tipo: 'nómina', importe: 1000, fecha: fecha, mes: mes });
    Logger.log((otra.ok === false && otra.mensaje ? '✅ ' : '❌ ') + 'Otra nómina en el mismo mes → ' + (otra.mensaje || 'se apuntó (no debería)'));

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
    if (id) {
      let f;
      while ((f = buscarFilaPorId_(hoja, id)) > 0) hoja.deleteRow(f);
    }
    if (ultimo === null) props.deleteProperty('ULTIMO');
    else props.setProperty('ULTIMO', ultimo);
    const igual = hoja.getLastRow() === filasAntes && props.getProperty('ULTIMO') === ultimo;
    Logger.log((igual ? '✅ ' : '❌ ') + 'Limpieza: Ingresos y el Deshacer pendiente como estaban');
  }
}
