/**
 * Ahorros.gs — Fase 16: la cuenta de ahorro (conjunta con la pareja), el saldo inicial y el objetivo.
 * Archivo nuevo. Dos pestañas, creadas por aplicarFase16() (Migraciones.gs):
 *  - Ahorros: A ID (S001) · B Fecha · C Tipo · D Quién · E Concepto · F Importe · G Notas · H Registrado. Sin fórmulas:
 *    escribirFila_ (v1) escribe tras getLastRow(), y una fórmula más abajo desplazaría las filas (lección de la fase 13).
 *    Tipo ∈ inicial | aportación | retirada; Quién ∈ yo | pareja (vacío en «inicial»). El importe es siempre positivo: la
 *    retirada resta por su tipo.
 *  - Objetivos: A Nombre · B Importe · C Fecha_objetivo · D Activo · E Creado (una fila por objetivo; uno activo) y, en H:I
 *    filas 1–10, los totales que calcula la hoja. Como los totales ocupan esas filas, un objetivo nuevo se escribe en la
 *    primera celda vacía de la columna A, no tras getLastRow().
 * Lo que es mío (yo, no inicial) cuenta en el mes de su fecha: Resumen E8 «Ahorro del mes» lo resta del Restante (B6) y del
 * Restante real (E7). Lo de la pareja y el inicial solo suman al total. La app no calcula: lee lo que calcula la hoja.
 */

const AHO_HOJA_ = 'Ahorros';
const OBJ_HOJA_ = 'Objetivos';
const AHO_TIPOS_ = ['inicial', 'aportación', 'retirada'];
const AHO_QUIEN_ = ['yo', 'pareja'];
const AHO_MAX_ = 1000000;
const AHO_MAX_CONCEPTO_ = 60;
const AHO_DIAS_FUTURO_ = 60;
const AHO_ULTIMOS_ = 20;
const AHO_FORMATOS_ = { 2: 'dd/mm/yyyy', 6: '#,##0.00 "€"', 8: 'dd/mm/yyyy hh:mm' };
const OBJ_TOTALES_ = 'I1:I10';   // total, inicial, yo, pareja, nombre, importe, fecha, progreso, falta, al mes
const OBJ_MAX_NOMBRE_ = 40;

/** Acción "ahorros" (solo lectura): totales, desglose, objetivo activo con su progreso y los últimos movimientos. */
function ahorros_() {
  return leerAhorros_(libro_());   // v1
}

function leerAhorros_(libro) {
  const zona = libro.getSpreadsheetTimeZone();
  const obj = libro.getSheetByName(OBJ_HOJA_);
  if (!obj) throw new Error('No existe la pestaña Objetivos (falta aplicarFase16).');
  const t = obj.getRange(OBJ_TOTALES_).getValues().map((f) => f[0]);
  const lista = leerMovimientosAhorro_(libro.getSheetByName(AHO_HOJA_), zona);
  return {
    hoy: Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd'),
    total: redondear2_(t[0]), inicial: redondear2_(t[1]), yo: redondear2_(t[2]), pareja: redondear2_(t[3]),   // Mes.gs
    objetivo: String(t[4]).trim() ? {
      nombre: String(t[4]), importe: redondear2_(t[5]), fecha: t[6] instanceof Date ? textoFecha_(t[6], zona) : null,
      progreso: typeof t[7] === 'number' ? Math.round(t[7] * 1000) / 10 : null,   // la hoja da la fracción; aquí, en %
      falta: redondear2_(t[8]), al_mes: typeof t[9] === 'number' ? redondear2_(t[9]) : null
    } : null,
    hay_inicial: lista.some((m) => m.tipo === 'inicial'),
    movimientos: lista.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id.localeCompare(a.id)).slice(0, AHO_ULTIMOS_)
  };
}

/** Acción "ahorro": { tipo, quien, importe, fecha, concepto? } → escribe el movimiento y se puede deshacer. */
function apuntarAhorro_(p) {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const tipo = String(p.tipo == null ? '' : p.tipo);
  if (AHO_TIPOS_.indexOf(tipo) < 0) return { ok: false, error: 'entrada' };
  const quien = tipo === 'inicial' ? '' : String(p.quien == null ? '' : p.quien);   // el inicial no es de nadie
  if (tipo !== 'inicial' && AHO_QUIEN_.indexOf(quien) < 0) return { ok: false, error: 'entrada' };

  const fecha = String(p.fecha == null ? '' : p.fecha);
  const importe = Math.round(Number(p.importe) * 100) / 100;
  const concepto = String(p.concepto == null ? '' : p.concepto).replace(/\s+/g, ' ').trim() ||
                   conceptoAhorro_(tipo, quien, fecha);
  const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
  const error = validarAhorro_(importe, fecha, concepto, hoy);
  if (error) return { ok: false, error: 'rechazado', mensaje: error };

  const r = conBloqueo_(() => {   // v1: un acceso a la vez
    const hoja = libro.getSheetByName(AHO_HOJA_);
    if (!hoja) throw new Error('No existe la pestaña Ahorros (falta aplicarFase16).');
    const lista = leerMovimientosAhorro_(hoja, zona);
    const inicial = lista.filter((m) => m.tipo === 'inicial')[0];
    if (tipo === 'inicial' && inicial) {
      return { ok: false, error: 'rechazado', mensaje: 'Ya hay un saldo inicial (' + textoEuros_(inicial.importe) +   // Ingresos.gs
               '). Para cambiarlo, bórralo y vuelve a apuntarlo.' };
    }
    if (tipo === 'retirada') {
      const total = totalAhorrado_(libro);
      if (redondear2_(total - importe) < 0) {
        return { ok: false, error: 'rechazado', mensaje: 'No puedes retirar ' + textoEuros_(importe) + ': en la cuenta hay ' +
                 textoEuros_(total) + '.' };
      }
    }
    const id = siguienteId_(hoja, 'S');   // v1: S001, S002…
    // Fecha como número de serie (v1): un objeto Date podría mover el día por la zona horaria.
    escribirFila_(hoja, [id, fechaSerial_(fecha), tipo, quien, concepto, importe, '', ahoraSerial_()], AHO_FORMATOS_);   // v1
    apuntarDeshacer_('Movimiento de ahorro «' + concepto + '» borrado', [{ op: 'borrar', hoja: AHO_HOJA_, id: id }]);   // v1
    return { id: id, desc: '«' + concepto + '» · ' + textoEuros_(importe) + ' apuntado en Ahorros',
             movimiento: { id: id, fecha: fecha, tipo: tipo, quien: quien, concepto: concepto, importe: importe } };
  });
  if (r.ok === false) return r;
  // El mes que cambia (para que la app lo vuelva a pedir) y los totales ya recalculados: un viaje en vez de dos.
  return Object.assign(r, { mes: cuentaEnMes_(tipo, quien) ? mesDeFecha_(libro, fecha, zona) : null,
                            ahorros: leerAhorros_(libro) });
}

/** Acción "borrar_ahorro": { id } → borra la fila; Deshacer la vuelve a añadir. El total no puede quedar en negativo. */
function borrarAhorro_(p) {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const id = String(p.id == null ? '' : p.id);
  const r = conBloqueo_(() => {
    const hoja = libro.getSheetByName(AHO_HOJA_);
    const fila = hoja ? buscarFilaPorId_(hoja, id) : -1;   // v1
    if (fila < 0) return { ok: false, error: 'rechazado', mensaje: 'Ese movimiento ya no existe (¿se borró a mano?). Recarga la lista.' };
    const valores = hoja.getRange(fila, 1, 1, 8).getValues()[0];
    const tipo = String(valores[2]);
    const importe = redondear2_(valores[5]);
    if (tipo !== 'retirada') {   // quitar algo que sumaba
      const total = totalAhorrado_(libro);
      if (redondear2_(total - importe) < 0) {
        return { ok: false, error: 'rechazado', mensaje: 'No se puede borrar: el total ahorrado quedaría en ' +
                 textoEuros_(redondear2_(total - importe)) + '. Borra antes alguna retirada.' };
      }
    }
    hoja.deleteRow(fila);
    // aJSON_ (v1) guarda las fechas como número de serie para que Deshacer las escriba igual.
    apuntarDeshacer_('Movimiento de ahorro «' + valores[4] + '» recuperado', [{ op: 'fila', hoja: AHO_HOJA_, valores: valores.map(aJSON_) }]);
    return { id: id, desc: '«' + valores[4] + '» borrado de Ahorros',
             mes: cuentaEnMes_(tipo, String(valores[3])) ? mesDeFecha_(libro, textoFecha_(valores[1], zona), zona) : null };
  });
  if (r.ok === false) return r;
  return Object.assign(r, { ahorros: leerAhorros_(libro) });
}

/**
 * Acción "objetivo": { nombre, importe, fecha? } → el objetivo nuevo pasa a ser el activo y el anterior queda con
 * Activo = «No» (se guarda el historial; el modelo ya admite varios). Sin Deshacer (como previsto): la respuesta dice el
 * antes y el después y trae los totales recalculados.
 */
function objetivo_(p) {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const nombre = String(p.nombre == null ? '' : p.nombre).replace(/\s+/g, ' ').trim();
  const fecha = p.fecha == null ? '' : String(p.fecha).trim();
  const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
  const error = validarObjetivo_(nombre, p.importe, fecha, hoy);
  if (error) return { ok: false, error: 'rechazado', mensaje: error };
  const importe = Math.round(Number(String(p.importe).replace(',', '.')) * 100) / 100;

  const anterior = conBloqueo_(() => {
    const hoja = libro.getSheetByName(OBJ_HOJA_);
    if (!hoja) throw new Error('No existe la pestaña Objetivos (falta aplicarFase16).');
    const filas = filasObjetivos_(hoja);
    let antes = null;
    filas.forEach((f, i) => {
      if (f[3] !== 'Sí') return;
      if (!antes) antes = { nombre: String(f[0]), importe: redondear2_(f[1]), fecha: f[2] instanceof Date ? textoFecha_(f[2], zona) : null };
      hoja.getRange(i + 2, 4).setValue('No');
    });
    const fila = filas.length + 2;   // la primera vacía de la columna A (los totales de H:I no cuentan)
    hoja.getRange(fila, 1, 1, 5).setValues([[nombre, importe, fecha ? fechaSerial_(fecha) : '', 'Sí', ahoraSerial_()]]);   // v1
    hoja.getRange(fila, 2).setNumberFormat('#,##0.00 "€"');
    hoja.getRange(fila, 3).setNumberFormat('dd/mm/yyyy');
    hoja.getRange(fila, 5).setNumberFormat('dd/mm/yyyy hh:mm');
    return antes;
  });
  return { anterior: anterior, objetivo: { nombre: nombre, importe: importe, fecha: fecha || null },
           ahorros: leerAhorros_(libro) };
}

/* ---------- Ayudantes ---------- */

/** Filas con ID: { id, fecha, tipo, quien, concepto, importe }. */
function leerMovimientosAhorro_(hoja, zona) {
  if (!hoja) throw new Error('No existe la pestaña Ahorros (falta aplicarFase16).');
  if (hoja.getLastRow() < 2) return [];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, 6).getValues().filter((f) => String(f[0]).trim()).map((f) => ({
    id: String(f[0]), fecha: textoFecha_(f[1], zona), tipo: String(f[2]), quien: String(f[3]), concepto: String(f[4]),
    importe: redondear2_(f[5])
  }));
}

/** Filas de objetivos (A:E) hasta la primera celda vacía de la columna A. */
function filasObjetivos_(hoja) {
  const alto = Math.max(hoja.getLastRow() - 1, 1);
  const valores = hoja.getRange(2, 1, alto, 5).getValues();
  const fin = valores.findIndex((f) => !String(f[0]).trim());
  return fin < 0 ? valores : valores.slice(0, fin);
}

/** El total ahorrado tal como lo calcula la hoja (Objetivos!I1), con lo último escrito ya recalculado. */
function totalAhorrado_(libro) {
  SpreadsheetApp.flush();
  return redondear2_(libro.getSheetByName(OBJ_HOJA_).getRange('I1').getValue());
}

/** ¿Cuenta en mi mes? Solo lo mío y que no sea el saldo inicial. */
function cuentaEnMes_(tipo, quien) {
  return quien === 'yo' && tipo !== 'inicial';
}

/** Etiqueta del mes cuyo periodo (fase 13) contiene la fecha, o null. */
function mesDeFecha_(libro, fecha, zona) {
  const m = mesesDeLaHoja_(libro, zona).filter((x) => x.periodo_inicio && x.periodo_inicio <= fecha && fecha <= x.periodo_fin)[0];   // Mes.gs
  return m ? m.etiqueta : null;
}

/** "aportación", "yo", "2026-11-27" → "Aportación noviembre"; de la pareja, « (pareja)»; el inicial, «Saldo inicial». */
function conceptoAhorro_(tipo, quien, fecha) {
  if (tipo === 'inicial') return 'Saldo inicial';
  return conceptoPorDefecto_(tipo, fecha) + (quien === 'pareja' ? ' (pareja)' : '');   // Ingresos.gs
}

/** Mensaje del primer problema, o null. No escribe nada. */
function validarAhorro_(importe, fecha, concepto, hoy) {
  if (!(importe > 0)) return 'Pon un importe mayor que 0.';
  if (importe > AHO_MAX_) return 'El importe parece demasiado alto (máximo ' + AHO_MAX_ + ' €).';
  if (!fechaValida_(fecha)) return 'Pon una fecha válida.';   // Ingresos.gs
  if (fecha > sumarDias_(hoy, AHO_DIAS_FUTURO_)) return 'La fecha no puede ser de dentro de más de ' + AHO_DIAS_FUTURO_ + ' días.';
  if (concepto.length > AHO_MAX_CONCEPTO_) return 'El concepto puede tener como máximo ' + AHO_MAX_CONCEPTO_ + ' caracteres.';
  if (/^[=+\-@]/.test(concepto)) return 'El concepto no puede empezar por =, +, - ni @.';
  return null;
}

/** Nombre de 1–40 caracteres, importe > 0 (número o texto numérico) y fecha opcional, válida y no pasada. */
function validarObjetivo_(nombre, importe, fecha, hoy) {
  if (!nombre) return 'Ponle un nombre al objetivo.';
  if (nombre.length > OBJ_MAX_NOMBRE_) return 'El nombre puede tener como máximo ' + OBJ_MAX_NOMBRE_ + ' caracteres.';
  if (/^[=+\-@]/.test(nombre)) return 'El nombre no puede empezar por =, +, - ni @.';
  const texto = String(importe == null ? '' : importe).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(texto) || !(Number(texto) > 0)) return 'Pon un importe mayor que 0.';
  if (Number(texto) > AHO_MAX_) return 'El importe parece demasiado alto (máximo ' + AHO_MAX_ + ' €).';
  if (fecha && !fechaValida_(fecha)) return 'Pon una fecha válida (o déjala vacía).';
  if (fecha && fecha < hoy) return 'La fecha del objetivo ya ha pasado.';
  return null;
}

/**
 * Prueba desde el editor (fase 16). Los importes se comprueban como diferencias, así que vale con datos reales; el mes es
 * el de hoy (apuntarAhorro_ no acepta fechas a más de 60 días). Limpieza en finally: Ahorros, Objetivos y el Deshacer
 * pendiente como estaban.
 */
function probarAhorros() {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
  const hoja = libro.getSheetByName(AHO_HOJA_);
  const obj = libro.getSheetByName(OBJ_HOJA_);
  if (!hoja || !obj) return Logger.log('❌ Faltan las pestañas Ahorros u Objetivos: ejecuta antes aplicarFase16().');

  // 1. Validaciones, sin escribir nada.
  const casos = [
    ['tipo inventado', { tipo: 'regalo', quien: 'yo', importe: 1, fecha: hoy }, 'entrada'],
    ['quién inventado', { tipo: 'aportación', quien: 'vecino', importe: 1, fecha: hoy }, 'entrada'],
    ['importe 0', { tipo: 'aportación', quien: 'yo', importe: 0, fecha: hoy }, 'rechazado'],
    ['importe negativo', { tipo: 'aportación', quien: 'yo', importe: -5, fecha: hoy }, 'rechazado'],
    ['importe enorme', { tipo: 'aportación', quien: 'yo', importe: AHO_MAX_ + 1, fecha: hoy }, 'rechazado'],
    ['fecha imposible', { tipo: 'aportación', quien: 'yo', importe: 1, fecha: '2027-02-31' }, 'rechazado'],
    ['fecha a más de 60 días', { tipo: 'aportación', quien: 'yo', importe: 1, fecha: sumarDias_(hoy, AHO_DIAS_FUTURO_ + 1) }, 'rechazado'],
    ['concepto largo', { tipo: 'aportación', quien: 'yo', importe: 1, fecha: hoy, concepto: 'x'.repeat(AHO_MAX_CONCEPTO_ + 1) }, 'rechazado'],
    ['concepto con =', { tipo: 'aportación', quien: 'yo', importe: 1, fecha: hoy, concepto: '=1+1' }, 'rechazado']
  ];
  const objetivos = [
    ['objetivo sin nombre', { nombre: ' ', importe: 100 }],
    ['objetivo con nombre largo', { nombre: 'x'.repeat(OBJ_MAX_NOMBRE_ + 1), importe: 100 }],
    ['objetivo de 0 €', { nombre: 'Viaje', importe: 0 }],
    ['objetivo con fecha pasada', { nombre: 'Viaje', importe: 100, fecha: sumarDias_(hoy, -1) }]
  ];
  let ok = 0;
  casos.forEach(([caso, params, esperado]) => {
    const r = apuntarAhorro_(params);
    const bien = r.ok === false && r.error === esperado;
    if (bien) ok++;
    Logger.log((bien ? '✅ ' : '❌ ') + caso + ' → ' + (r.mensaje || r.error || 'se apuntó (no debería)'));
  });
  objetivos.forEach(([caso, params]) => {
    const r = objetivo_(params);
    const bien = r.ok === false && r.error === 'rechazado';
    if (bien) ok++;
    Logger.log((bien ? '✅ ' : '❌ ') + caso + ' → ' + (r.mensaje || 'se creó (no debería)'));
  });
  Logger.log('Validaciones: ' + ok + '/' + (casos.length + objetivos.length));

  const props = PropertiesService.getScriptProperties();
  const ultimo = props.getProperty('ULTIMO');
  const filasAntes = hoja.getLastRow();
  const objAntes = filasObjetivos_(obj);
  const objFormatos = obj.getRange(2, 1, Math.max(objAntes.length, 1), 5).getNumberFormats();
  const ids = [];
  const mes = mesDeFecha_(libro, hoy, zona);
  const cab = () => mes_({ etiqueta: mes }).cabecera;   // Mes.gs
  const apuntar = (p) => { const r = apuntarAhorro_(Object.assign({ fecha: hoy, concepto: 'Prueba 16' }, p)); if (r.id) ids.push(r.id); return r; };
  try {
    Logger.log('== Mes de hoy: ' + mes);
    const c0 = cab();
    const a0 = leerAhorros_(libro);

    // 2. Saldo inicial (si no lo había) y un segundo, rechazado.
    if (!a0.hay_inicial) {
      const i = apuntar({ tipo: 'inicial', importe: 500 });
      const a = i.ahorros;
      const c = cab();
      const bien = a.total === redondear2_(a0.total + 500) && a.inicial === 500 && i.mes === null && c.restante === c0.restante;
      Logger.log((bien ? '✅ ' : '❌ ') + 'Saldo inicial de 500 → total ' + a0.total + ' → ' + a.total + ' · el mes no cambia (restante ' + c.restante + ')');
    } else {
      Logger.log('· Ya hay un saldo inicial real: no se apunta otro de prueba');
    }
    const otro = apuntarAhorro_({ tipo: 'inicial', importe: 1, fecha: hoy });
    Logger.log((otro.error === 'rechazado' ? '✅ ' : '❌ ') + 'Otro saldo inicial → ' + (otro.mensaje || 'se apuntó (no debería)'));

    // 3. Aportación mía de 100 → el ahorro del mes sube 100 y el restante baja 100.
    const c1 = cab();
    const ap = apuntar({ tipo: 'aportación', quien: 'yo', importe: 100 });
    const c2 = cab();
    const bien3 = ap.mes === mes && c2.ahorro_mes === redondear2_(c1.ahorro_mes + 100) && c2.restante === redondear2_(c1.restante - 100) &&
                  ap.ahorros.yo === redondear2_(a0.yo + 100);
    Logger.log((bien3 ? '✅ ' : '❌ ') + 'Aportación mía de 100 → ahorro del mes ' + c1.ahorro_mes + ' → ' + c2.ahorro_mes +
               ' · restante ' + c1.restante + ' → ' + c2.restante + ' · mes ' + ap.mes);

    // 4. Aportación de la pareja de 50 → el total sube 50 y el mes no cambia.
    const pa = apuntar({ tipo: 'aportación', quien: 'pareja', importe: 50 });
    const c3 = cab();
    const bien4 = pa.mes === null && pa.ahorros.total === redondear2_(ap.ahorros.total + 50) && pa.ahorros.pareja === redondear2_(a0.pareja + 50) &&
                  c3.restante === c2.restante && c3.ahorro_mes === c2.ahorro_mes;
    Logger.log((bien4 ? '✅ ' : '❌ ') + 'Aportación de la pareja de 50 → total ' + ap.ahorros.total + ' → ' + pa.ahorros.total +
               ' · el mes no cambia (restante ' + c3.restante + ')');

    // 5. Retirada mía de 30 → el restante sube 30.
    const re = apuntar({ tipo: 'retirada', quien: 'yo', importe: 30 });
    const c4 = cab();
    const bien5 = c4.restante === redondear2_(c3.restante + 30) && c4.ahorro_mes === redondear2_(c3.ahorro_mes - 30) &&
                  re.ahorros.total === redondear2_(pa.ahorros.total - 30);
    Logger.log((bien5 ? '✅ ' : '❌ ') + 'Retirada mía de 30 → restante ' + c3.restante + ' → ' + c4.restante + ' · total ' + re.ahorros.total);

    // 6. Una retirada mayor que el total → rechazada.
    const mucho = apuntarAhorro_({ tipo: 'retirada', quien: 'yo', importe: redondear2_(re.ahorros.total + 1), fecha: hoy });
    Logger.log((mucho.error === 'rechazado' ? '✅ ' : '❌ ') + 'Retirar ' + redondear2_(re.ahorros.total + 1) + ' → ' + (mucho.mensaje || 'se apuntó (no debería)'));

    // 7. Objetivo de 1.000 (con fecha a ~3 meses) y cambiarlo por otro de 2.000.
    const total = re.ahorros.total;
    const fechaObj = sumarDias_(hoy, 90);
    const o1 = objetivo_({ nombre: 'Prueba 16', importe: 1000, fecha: fechaObj });
    const g = o1.ahorros.objetivo;
    const meses = Math.max(1, (Number(fechaObj.slice(0, 4)) - Number(hoy.slice(0, 4))) * 12 + Number(fechaObj.slice(5, 7)) - Number(hoy.slice(5, 7)));
    const falta = Math.max(0, redondear2_(1000 - total));
    const bien7 = g && g.nombre === 'Prueba 16' && g.progreso === Math.round(Math.max(0, total) / 1000 * 1000) / 10 &&
                  g.falta === falta && g.fecha === fechaObj && g.al_mes === redondear2_(falta / meses);
    Logger.log((bien7 ? '✅ ' : '❌ ') + 'Objetivo de 1000 hasta ' + fechaObj + ' → ' + JSON.stringify(g) + ' (esperado: ' +
               Math.round(total / 1000 * 1000) / 10 + ' %, faltan ' + falta + ', ' + redondear2_(falta / meses) + ' al mes en ' + meses + ' meses)');
    const o2 = objetivo_({ nombre: 'Prueba 16 bis', importe: '2000' });
    const activos = filasObjetivos_(obj).filter((f) => f[3] === 'Sí');
    const bien8 = o2.anterior && o2.anterior.nombre === 'Prueba 16' && o2.anterior.importe === 1000 && activos.length === 1 &&
                  activos[0][0] === 'Prueba 16 bis' && o2.ahorros.objetivo.al_mes === null;
    Logger.log((bien8 ? '✅ ' : '❌ ') + 'Cambiar el objetivo → antes ' + JSON.stringify(o2.anterior) + ' · ahora ' +
               JSON.stringify(o2.objetivo) + ' · activos: ' + activos.length);

    // 8. Deshacer la retirada; borrar la aportación y Deshacer; borrar algo que dejaría el total en negativo.
    const d1 = deshacer(props.getProperty('TOKEN'));   // v1
    const sinRetirada = buscarFilaPorId_(hoja, re.id) < 0;
    Logger.log((sinRetirada ? '✅ ' : '❌ ') + 'Deshacer → ' + d1.desc);
    const b = borrarAhorro_({ id: ap.id });
    const borrada = b.ok !== false && buscarFilaPorId_(hoja, ap.id) < 0 && b.mes === mes;
    const d2 = deshacer(props.getProperty('TOKEN'));
    const vuelve = buscarFilaPorId_(hoja, ap.id) > 0;
    Logger.log((borrada && vuelve ? '✅ ' : '❌ ') + 'Borrar la aportación → ' + (b.desc || b.mensaje) + ' · Deshacer → ' + d2.desc);
    const casiTodo = apuntar({ tipo: 'retirada', quien: 'yo', importe: redondear2_(totalAhorrado_(libro) - 10) });
    const negativo = borrarAhorro_({ id: ap.id });
    Logger.log((negativo.error === 'rechazado' ? '✅ ' : '❌ ') + 'Retirar casi todo (' + casiTodo.movimiento.importe +
               ') y borrar la aportación de 100 → ' + (negativo.mensaje || 'se borró (no debería)'));
  } finally {
    ids.forEach((id) => { let f; while ((f = buscarFilaPorId_(hoja, id)) > 0) hoja.deleteRow(f); });
    const ahora = filasObjetivos_(obj).length;
    if (ahora) obj.getRange(2, 1, ahora, 5).clearContent();
    if (objAntes.length) obj.getRange(2, 1, objAntes.length, 5).setValues(objAntes).setNumberFormats(objFormatos);
    if (ultimo === null) props.deleteProperty('ULTIMO');
    else props.setProperty('ULTIMO', ultimo);
    const igual = hoja.getLastRow() === filasAntes && JSON.stringify(filasObjetivos_(obj)) === JSON.stringify(objAntes) &&
                  props.getProperty('ULTIMO') === ultimo;
    Logger.log((igual ? '✅ ' : '❌ ') + 'Limpieza: Ahorros, Objetivos y el Deshacer pendiente como estaban');
  }
}

/* ---------- Fase 18.3: editar un movimiento de ahorro ---------- */

/**
 * Acción "editar_ahorro": { id, concepto?, importe?, fecha?, quien? } → cambia lo que llegue, con las validaciones de
 * apuntar y un Deshacer que lo devuelve todo (un paso «celda» por campo). El tipo no se cambia (de aportación a retirada
 * es otro movimiento); del saldo inicial solo el concepto y el importe (es único y no cuenta en ningún mes). El total
 * ahorrado nunca queda en negativo. La respuesta trae los meses afectados y los totales recalculados.
 */
function editarAhorro_(p) {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const id = String(p.id == null ? '' : p.id);
  const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
  const r = conBloqueo_(() => {   // v1
    const hoja = libro.getSheetByName(AHO_HOJA_);
    const fila = hoja ? buscarFilaPorId_(hoja, id) : -1;   // v1
    if (fila < 0) return { ok: false, error: 'rechazado', mensaje: 'Ese movimiento ya no existe (¿se borró a mano?). Recarga la lista.' };
    const f = hoja.getRange(fila, 1, 1, 8).getValues()[0];
    const tipo = String(f[2]);
    if (p.tipo != null && String(p.tipo) !== tipo) {
      return { ok: false, error: 'rechazado', mensaje: 'El tipo no se cambia: bórralo y vuelve a apuntarlo.' };
    }
    const antes = { concepto: String(f[4]), importe: redondear2_(f[5]), fecha: textoFecha_(f[1], zona), quien: String(f[3]) };
    const despues = Object.assign({}, antes);
    if (p.concepto != null) despues.concepto = String(p.concepto).replace(/\s+/g, ' ').trim();
    if (p.importe != null && p.importe !== '') despues.importe = Math.round(Number(String(p.importe).replace(',', '.')) * 100) / 100;
    if (p.fecha != null) despues.fecha = String(p.fecha);
    if (p.quien != null) despues.quien = String(p.quien);
    if (tipo === 'inicial') {
      if (despues.fecha !== antes.fecha) return { ok: false, error: 'rechazado', mensaje: 'La fecha del saldo inicial no se cambia: no cuenta en ningún mes.' };
      if (despues.quien !== antes.quien) return { ok: false, error: 'rechazado', mensaje: 'El saldo inicial no es de nadie: no tiene «quién».' };
    } else if (AHO_QUIEN_.indexOf(despues.quien) < 0) {
      return { ok: false, error: 'entrada' };
    }
    const cambia = Object.keys(antes).filter((k) => despues[k] !== antes[k]);
    if (!cambia.length) return { ok: false, error: 'rechazado', mensaje: 'No hay cambios que guardar.' };
    if (!despues.concepto) return { ok: false, error: 'rechazado', mensaje: 'Escribe el concepto.' };
    const error = validarAhorro_(despues.importe, despues.fecha, despues.concepto, hoy);
    if (error) return { ok: false, error: 'rechazado', mensaje: error };
    // El total con el cambio: lo de antes sale y entra lo de ahora (una retirada resta).
    const efecto = (importe) => (tipo === 'retirada' ? -importe : importe);
    const total = redondear2_(totalAhorrado_(libro) - efecto(antes.importe) + efecto(despues.importe));
    if (total < 0) return { ok: false, error: 'rechazado', mensaje: 'No se puede: el total ahorrado quedaría en ' + textoEuros_(total) + '.' };   // Ingresos.gs

    const columnas = { fecha: 2, quien: 4, concepto: 5, importe: 6 };
    const pasos = cambia.map((k) => {
      const col = columnas[k];
      const anterior = f[col - 1];
      hoja.getRange(fila, col).setValue(k === 'fecha' ? fechaSerial_(despues.fecha) : despues[k]);   // v1
      return { op: 'celda', hoja: AHO_HOJA_, id: id, col: col, valor: aJSON_(anterior) };   // v1
    });
    apuntarDeshacer_('Deshechos los cambios de «' + despues.concepto + '»', pasos);   // v1

    const nombreQuien = (q) => (q === 'yo' ? 'tú' : q === 'pareja' ? 'pareja' : '—');
    const textos = { concepto: () => '«' + antes.concepto + '» → «' + despues.concepto + '»',
                     importe: () => textoEuros_(antes.importe) + ' → ' + textoEuros_(despues.importe),
                     fecha: () => antes.fecha.split('-').reverse().join('/') + ' → ' + despues.fecha.split('-').reverse().join('/'),
                     quien: () => nombreQuien(antes.quien) + ' → ' + nombreQuien(despues.quien) };
    // Los meses que cambian (el de antes y el de ahora, si cuentan en un mes), para que la app los vuelva a pedir.
    const meses = [[antes.quien, antes.fecha], [despues.quien, despues.fecha]]
      .filter(([q]) => cuentaEnMes_(tipo, q)).map(([, fecha]) => mesDeFecha_(libro, fecha, zona)).filter((m, i, a) => m && a.indexOf(m) === i);
    return { id: id, desc: '«' + despues.concepto + '»: ' + cambia.map((k) => textos[k]()).join(' · '), meses: meses };
  });
  if (r.ok === false) return r;
  return Object.assign(r, { ahorros: leerAhorros_(libro) });
}

/**
 * Prueba desde el editor (fase 18.3). Mes de hoy; se comprueban diferencias, así que vale con datos reales. Limpieza en
 * finally: Ahorros (también el importe del saldo inicial real, si lo hay) y el Deshacer pendiente como estaban.
 */
function probarEditarAhorro() {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
  const hoja = libro.getSheetByName(AHO_HOJA_);
  if (!hoja) return Logger.log('❌ Falta la pestaña Ahorros: ejecuta antes aplicarFase16().');
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TOKEN');
  const ultimo = props.getProperty('ULTIMO');
  const filasAntes = hoja.getLastRow();
  const mes = mesDeFecha_(libro, hoy, zona);
  const cab = () => mes_({ etiqueta: mes }).cabecera;   // Mes.gs
  const ids = [];
  const valor = (id, col) => { const f = buscarFilaPorId_(hoja, id); return f > 0 ? hoja.getRange(f, col).getValue() : null; };
  const log = (bien, texto) => Logger.log((bien ? '✅ ' : '❌ ') + texto);
  const inicialReal = leerMovimientosAhorro_(hoja, zona).filter((m) => m.tipo === 'inicial')[0];
  const importeInicialReal = inicialReal ? valor(inicialReal.id, 6) : null;
  try {
    // Aportación mía de 100 pasada a «pareja» → el ahorro del mes baja 100 y el total no cambia; Deshacer la devuelve.
    const ap = apuntarAhorro_({ tipo: 'aportación', quien: 'yo', importe: 100, fecha: hoy, concepto: 'Prueba 18' });
    ids.push(ap.id);
    const c1 = cab();
    const a = editarAhorro_({ id: ap.id, quien: 'pareja' });
    const c2 = cab();
    log(a.ok !== false && c2.ahorro_mes === redondear2_(c1.ahorro_mes - 100) && a.ahorros.total === ap.ahorros.total && a.meses.join() === mes,
        'De «yo» a «pareja» → ' + a.desc + ' · ahorro del mes ' + c1.ahorro_mes + ' → ' + c2.ahorro_mes + ' · total ' + a.ahorros.total);
    const d = deshacer(token);   // v1
    log(valor(ap.id, 4) === 'yo', 'Deshacer → ' + d.desc + ' · vuelve a «' + valor(ap.id, 4) + '»');

    // El tipo no se cambia; sin cambios; un importe que dejaría el total en negativo.
    const t = editarAhorro_({ id: ap.id, tipo: 'retirada' });
    const s = editarAhorro_({ id: ap.id, concepto: 'Prueba 18' });
    const re = apuntarAhorro_({ tipo: 'retirada', quien: 'yo', importe: redondear2_(totalAhorrado_(libro) - 10), fecha: hoy, concepto: 'Prueba 18' });
    ids.push(re.id);
    const neg = editarAhorro_({ id: ap.id, importe: 1 });
    log(t.error === 'rechazado' && s.error === 'rechazado' && neg.error === 'rechazado' && valor(ap.id, 6) === 100,
        'Tipo → ' + t.mensaje + ' · sin cambios → ' + s.mensaje + ' · importe 1 con casi todo retirado → ' + neg.mensaje);

    // Saldo inicial (el real, si lo hay; si no, uno de prueba): la fecha no se cambia; el importe sí, sin tocar el mes.
    let idInicial = inicialReal ? inicialReal.id : null;
    if (!idInicial) { idInicial = apuntarAhorro_({ tipo: 'inicial', importe: 500, fecha: hoy }).id; ids.push(idInicial); }
    const fi = editarAhorro_({ id: idInicial, fecha: sumarDias_(hoy, -1) });
    const c3 = cab();
    const total0 = totalAhorrado_(libro);
    const im = editarAhorro_({ id: idInicial, importe: redondear2_(Number(valor(idInicial, 6)) + 100) });
    const c4 = cab();
    log(fi.error === 'rechazado' && im.ok !== false && im.ahorros.total === redondear2_(total0 + 100) && c4.restante === c3.restante && !im.meses.length,
        'Saldo inicial: fecha → ' + fi.mensaje + ' · importe → ' + im.desc + ' · total ' + total0 + ' → ' + im.ahorros.total + ' · el mes no cambia');
  } finally {
    ids.slice().reverse().forEach((id) => { let f; while ((f = buscarFilaPorId_(hoja, id)) > 0) hoja.deleteRow(f); });
    if (inicialReal) hoja.getRange(buscarFilaPorId_(hoja, inicialReal.id), 6).setValue(importeInicialReal);
    if (ultimo === null) props.deleteProperty('ULTIMO');
    else props.setProperty('ULTIMO', ultimo);
    log(hoja.getLastRow() === filasAntes && props.getProperty('ULTIMO') === ultimo &&
        (!inicialReal || valor(inicialReal.id, 6) === importeInicialReal), 'Limpieza: Ahorros y el Deshacer pendiente como estaban');
  }
}
