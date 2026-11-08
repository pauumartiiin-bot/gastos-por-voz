/**
 * Conjunta.gs — Fase 21: ahorro conjunto entre dos personas de la app. Archivo nuevo.
 *
 * Opción B: cada persona apunta lo suyo en su propia pestaña «Ahorros» (Quién = yo) y su mes lo resta como siempre
 * (Resumen!E8, sin cambios). El servidor junta las dos hojas solo para lo que es de la cuenta:
 *  - el total y el desglose: la suma de los totales que calcula cada hoja (Objetivos I1:I13; la hoja calcula, el servidor
 *    suma);
 *  - la lista de movimientos, con quién apuntó cada uno (`de`): los IDs se repiten entre hojas (S001 en las dos);
 *  - el saldo inicial y el objetivo, en la hoja del titular. Del objetivo, el progreso, lo que falta y la cuota se
 *    calculan aquí con las mismas fórmulas que la hoja (I8:I10 e I13), porque cada hoja solo ve su parte del total.
 * El saldo nunca en negativo se comprueba con los movimientos de las dos hojas, dentro de conBloqueo_ (un bloqueo para
 * todos: dos retiradas a la vez no se cuelan).
 *
 * Privacidad: de la hoja de la otra persona solo se leen las dos pestañas del ahorro (Ahorros y los totales de Objetivos),
 * nunca sus gastos, ingresos ni su mes. Lo garantiza este código, no los permisos de Google: desde la fase 20 el servidor
 * es editor de las dos hojas.
 *
 * Configuración: propiedad CUENTAS = { "<titular>+<otro>": { "miembros": [titular, otro], "titular": …, "corte": "yyyy-MM-dd" } }.
 * Lo que el titular apuntó como «pareja» antes del corte es el historial de la otra persona y cuenta en el total; desde el
 * corte, cada uno apunta lo suyo desde su app (reglas en reglasCuenta_).
 */

var SIN_CUENTA_ = false;   // true: como si no hubiera cuenta conjunta (las pruebas de una sola hoja, fases 16–19)
const CUE_PROPIEDAD_ = 'CUENTAS';

/* ---------- La cuenta de la persona de la petición ---------- */

/** La cuenta conjunta de una persona ({ nombre, miembros, titular, corte }), o null. */
function cuentaDe_(nombre) {
  if (SIN_CUENTA_) return null;
  const cuentas = leerCuentas_();
  for (const c in cuentas) {
    if (cuentas[c].miembros.indexOf(nombre) >= 0) return Object.assign({ nombre: c }, cuentas[c]);
  }
  return null;
}

/** Ahorros de la persona de la petición: los de la cuenta conjunta si la tiene; si no, los de su hoja (fase 16). */
function ahorrosDe_(libro) {
  const cuenta = cuentaDe_(personaActual_());   // Usuarios.gs
  return cuenta ? leerAhorrosConjunto_(cuenta) : leerAhorros_(libro);   // Ahorros.gs
}

/** Total, desglose, objetivo y movimientos de la cuenta, vistos por la persona de la petición. */
function leerAhorrosConjunto_(cuenta) {
  const yo = personaActual_();
  const otro = otroMiembro_(cuenta, yo);
  const libros = {};
  cuenta.miembros.forEach((m) => { libros[m] = libroDe_(m); });
  const zona = libros[cuenta.titular].getSpreadsheetTimeZone();
  const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
  const totales = {};
  const lista = [];
  cuenta.miembros.forEach((m) => {
    totales[m] = libros[m].getSheetByName(OBJ_HOJA_).getRange(OBJ_TOTALES_).getValues().map((f) => f[0]);   // Ahorros.gs
    leerMovimientosAhorro_(libros[m].getSheetByName(AHO_HOJA_), zona).forEach((mv) => {
      // De quién es el dinero: lo apuntado como «pareja» (historial, en la hoja del titular) es de la otra persona.
      const duena = mv.tipo === 'inicial' ? '' : (mv.quien === 'pareja' ? otroMiembro_(cuenta, m) : m);
      lista.push(Object.assign(mv, { de: m, de_visible: visible_(m), tuyo: m === yo, programado: mv.fecha > hoy,
                                     quien_visible: !duena ? '' : (duena === yo ? 'Tú' : visible_(duena)) }));
    });
  });
  const num = (x) => (typeof x === 'number' ? x : 0);
  const suma = (i) => redondear2_(cuenta.miembros.reduce((s, m) => s + num(totales[m][i]), 0));   // Mes.gs
  const titular = totales[cuenta.titular];
  // Lo de cada persona: lo suyo como «yo» y, quien no es titular, también lo que el titular apuntó como «pareja».
  const deCada = (m) => redondear2_(num(totales[m][2]) + (m === cuenta.titular ? 0 : num(titular[3])));
  const total = suma(0);
  const conProgramado = suma(11);
  const programados = lista.filter((m) => m.programado).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.de.localeCompare(b.de) || a.id.localeCompare(b.id));
  const hechos = lista.filter((m) => !m.programado).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.de.localeCompare(a.de) || b.id.localeCompare(a.id));
  return {
    hoy: hoy,
    total: total, inicial: suma(1), yo: deCada(yo), pareja: deCada(otro),
    programado: suma(10), con_programado: conProgramado,
    objetivo: objetivoConjunto_(titular, total, conProgramado, zona, hoy),
    hay_inicial: lista.some((m) => m.tipo === 'inicial'),
    movimientos: programados.concat(hechos.slice(0, AHO_ULTIMOS_)),
    conjunta: { nombre: cuenta.nombre, tu: yo, otro: otro, otro_visible: visible_(otro), titular: yo === cuenta.titular,
                titular_visible: visible_(cuenta.titular), corte: cuenta.corte }
  };
}

/**
 * El objetivo activo (de la hoja del titular) con el total de la cuenta. Mismas fórmulas que Objetivos I8:I10 e I13:
 * progreso = MAX(0, total)/importe; falta = MAX(0, importe − total); al mes = falta / MAX(1, meses hasta la fecha), sin
 * cuota si la fecha ya pasó; progreso con lo programado = MAX(0, con lo programado)/importe.
 */
function objetivoConjunto_(t, total, conProgramado, zona, hoy) {
  if (!String(t[4]).trim()) return null;
  const importe = redondear2_(t[5]);
  const fecha = t[6] instanceof Date ? textoFecha_(t[6], zona) : null;   // Mes.gs
  const porciento = (x) => (importe > 0 ? Math.round(Math.max(0, x) / importe * 1000) / 10 : null);
  const falta = importe > 0 ? redondear2_(Math.max(0, importe - total)) : null;
  let alMes = null;
  if (fecha && importe > 0 && fecha >= hoy) {
    const meses = Math.max(1, (Number(fecha.slice(0, 4)) - Number(hoy.slice(0, 4))) * 12 + Number(fecha.slice(5, 7)) - Number(hoy.slice(5, 7)));
    alMes = redondear2_(falta / meses);
  }
  return { nombre: String(t[4]), importe: importe, fecha: fecha, progreso: porciento(total), falta: falta, al_mes: alMes,
           progreso_con_programado: porciento(conProgramado) };
}

/**
 * Las reglas de la cuenta al apuntar o editar un movimiento (mensaje, o null). El saldo inicial es de la cuenta y solo lo
 * toca el titular (su Deshacer va con su hoja); «pareja» solo vale para el historial del titular, antes del corte; y quien
 * no es titular no apunta nada anterior al corte (ese historial ya está en la hoja del titular).
 */
function reglasCuenta_(cuenta, tipo, quien, fecha) {
  if (!cuenta) return null;
  const yo = personaActual_();
  const corte = cuenta.corte.split('-').reverse().join('/');
  if (tipo === 'inicial' && yo !== cuenta.titular) {
    return 'El saldo inicial es de la cuenta y está en la hoja de ' + visible_(cuenta.titular) + ': lo cambia desde su app.';
  }
  if (quien === 'pareja' && (yo !== cuenta.titular || fecha >= cuenta.corte)) {
    return 'En la cuenta conjunta cada uno apunta lo suyo: lo de ' + visible_(otroMiembro_(cuenta, yo)) + ' se apunta desde su app.';
  }
  if (tipo !== 'inicial' && yo !== cuenta.titular && fecha < cuenta.corte) {
    return 'Lo anterior al ' + corte + ' ya está en la cuenta (lo apuntó ' + visible_(cuenta.titular) + ').';
  }
  return null;
}

/** Un movimiento de otra persona no se edita ni se borra (mensaje, o null). Sin `de`, es de la persona de la petición. */
function deOtraPersona_(cuenta, de) {
  if (!cuenta || de == null || String(de) === personaActual_()) return null;
  return 'Ese movimiento lo apuntó ' + visible_(String(de)) + ': solo lo puede cambiar o borrar desde su app.';
}

/** Los movimientos para comprobar el saldo: los de la hoja propia y, con cuenta, los de la otra (IDs con su nombre delante). */
function movimientosParaSaldo_(cuenta, propios, zona) {
  if (!cuenta) return propios;
  const yo = personaActual_();
  return cuenta.miembros.filter((m) => m !== yo).reduce((lista, m) =>
    lista.concat(leerMovimientosAhorro_(libroDe_(m).getSheetByName(AHO_HOJA_), zona).map((mv) => Object.assign(mv, { id: m + ':' + mv.id }))), propios.slice());
}

/** La hoja de una persona: la de la petición, la de Pau o la de USUARIOS. De la ajena, solo se usan sus pestañas de ahorro. */
function libroDe_(nombre) {
  if (nombre === personaActual_()) return libro_();   // v1
  if (nombre === USU_TITULAR_) return SpreadsheetApp.openById(CONFIG.ID_HOJA);   // v1
  const u = leerUsuarios_()[nombre];   // Usuarios.gs
  if (!u) throw new Error('«' + nombre + '» ya no está dado de alta: quita la cuenta conjunta.');
  return SpreadsheetApp.openById(u.hoja);
}

function otroMiembro_(cuenta, nombre) {
  return cuenta.miembros.filter((m) => m !== nombre)[0];
}

/** «aina» → «Aina». */
function visible_(nombre) {
  return nombre ? nombre.charAt(0).toUpperCase() + nombre.slice(1) : '';
}

function leerCuentas_() {
  const texto = PropertiesService.getScriptProperties().getProperty(CUE_PROPIEDAD_);
  return texto ? JSON.parse(texto) : {};
}

function guardarCuentas_(cuentas) {
  const props = PropertiesService.getScriptProperties();
  if (Object.keys(cuentas).length) props.setProperty(CUE_PROPIEDAD_, JSON.stringify(cuentas));
  else props.deleteProperty(CUE_PROPIEDAD_);
}

/** Para las pruebas de una sola hoja (fases 16–19): como si no hubiera cuenta conjunta mientras dura fn. */
function sinCuenta_(fn) {
  const antes = SIN_CUENTA_;
  SIN_CUENTA_ = true;
  try {
    fn();
  } finally {
    SIN_CUENTA_ = antes;
  }
}

/* ---------- Alta y baja (funciones del editor) ---------- */

/** Propiedad ALTA_CUENTA = "titular|otra persona" (o "…|yyyy-MM-dd" para el corte; sin él, hoy). */
function altaCuentaConjunta() {
  const props = PropertiesService.getScriptProperties();
  const partes = String(props.getProperty('ALTA_CUENTA') || '').split('|').map((s) => s.trim());
  if (partes.length < 2) return Logger.log('❌ Pon en las propiedades del script ALTA_CUENTA = titular|otra persona (p. ej. pau|aina).');
  try {
    const c = crearCuentaConjunta(partes[0], partes[1], partes[2] || '');
    props.deleteProperty('ALTA_CUENTA');
    Logger.log('✅ Cuenta conjunta «' + c.nombre + '» creada: titular ' + visible_(c.titular) + ', corte ' + c.corte +
               '. Desde hoy, cada uno ve el mismo total y apunta lo suyo desde su app.');
  } catch (err) {
    Logger.log('❌ ' + err.message);
  }
}

/** Propiedad BAJA_CUENTA = nombre de la cuenta o de uno de sus miembros. Los movimientos de cada uno se quedan en su hoja. */
function bajaCuentaConjunta() {
  const props = PropertiesService.getScriptProperties();
  const nombre = String(props.getProperty('BAJA_CUENTA') || '').trim().toLowerCase();
  if (!nombre) return Logger.log('❌ Pon en las propiedades del script BAJA_CUENTA = nombre de la cuenta o de uno de sus miembros.');
  try {
    const quitada = quitarCuentaConjunta(nombre);
    props.deleteProperty('BAJA_CUENTA');
    Logger.log('✅ Cuenta conjunta «' + quitada + '» quitada: cada uno vuelve a ver solo lo suyo. No se ha borrado ningún movimiento.');
  } catch (err) {
    Logger.log('❌ ' + err.message);
  }
}

/**
 * Crea la cuenta conjunta de dos personas (el titular guarda el saldo inicial y el objetivo). Antes de guardar nada
 * comprueba que nada se contaría dos veces: el titular no tiene «pareja» desde el corte (ni programado), y la otra
 * persona no tiene movimientos anteriores al corte ni saldo inicial.
 */
function crearCuentaConjunta(titular, otro, corte) {
  titular = String(titular || '').trim().toLowerCase();
  otro = String(otro || '').trim().toLowerCase();
  const usuarios = leerUsuarios_();
  const existe = (n) => n === USU_TITULAR_ || !!usuarios[n];
  if (!existe(titular) || !existe(otro)) throw new Error('Los dos tienen que estar dados de alta («pau» o uno de USUARIOS): «' + titular + '», «' + otro + '».');
  if (titular === otro) throw new Error('Una cuenta conjunta es de dos personas distintas.');
  const cuentas = leerCuentas_();
  for (const c in cuentas) {
    if (cuentas[c].miembros.indexOf(titular) >= 0 || cuentas[c].miembros.indexOf(otro) >= 0) throw new Error('Alguno de los dos ya está en la cuenta «' + c + '».');
  }
  const libroTitular = libroDe_(titular);
  const zona = libroTitular.getSpreadsheetTimeZone();
  corte = String(corte || '').trim() || Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
  if (!fechaValida_(corte)) throw new Error('El corte tiene que ser una fecha yyyy-MM-dd: «' + corte + '».');   // Ingresos.gs
  const fecha = (m) => m.fecha.split('-').reverse().join('/');

  const pareja = leerMovimientosAhorro_(libroTitular.getSheetByName(AHO_HOJA_), zona).filter((m) => m.quien === 'pareja' && m.fecha >= corte);
  if (pareja.length) {
    throw new Error('En la hoja de ' + visible_(titular) + ' hay ' + pareja.length + ' movimiento(s) de «pareja» desde el corte (' +
                    pareja.map((m) => m.id + ' ' + fecha(m) + ' ' + textoEuros_(m.importe)).join(', ') + '). Bórralos o adelanta el corte: si no, ' +
                    'contarían dos veces cuando ' + visible_(otro) + ' los apunte en su app.');   // Ingresos.gs
  }
  const suyos = leerMovimientosAhorro_(libroDe_(otro).getSheetByName(AHO_HOJA_), zona);
  const previos = suyos.filter((m) => m.tipo === 'inicial' || m.fecha < corte);
  if (previos.length) {
    throw new Error('En la hoja de ' + visible_(otro) + ' hay ' + previos.length + ' movimiento(s) de antes del corte o un saldo inicial (' +
                    previos.map((m) => m.id + ' ' + fecha(m) + ' ' + textoEuros_(m.importe)).join(', ') + '). Lo anterior al corte va en la hoja de ' +
                    visible_(titular) + ' como «pareja», y el saldo inicial es de la cuenta: bórralos de su hoja o atrasa el corte.');
  }
  const nombre = titular + '+' + otro;
  cuentas[nombre] = { miembros: [titular, otro], titular: titular, corte: corte };
  guardarCuentas_(cuentas);
  return { nombre: nombre, titular: titular, corte: corte };
}

/** Quita la cuenta conjunta (por su nombre o el de uno de sus miembros) y devuelve su nombre. No borra ningún movimiento. */
function quitarCuentaConjunta(nombre) {
  nombre = String(nombre || '').trim().toLowerCase();
  const cuentas = leerCuentas_();
  const clave = cuentas[nombre] ? nombre : Object.keys(cuentas).filter((c) => cuentas[c].miembros.indexOf(nombre) >= 0)[0];
  if (!clave) throw new Error('No hay ninguna cuenta conjunta llamada «' + nombre + '» ni con esa persona.');
  delete cuentas[clave];
  guardarCuentas_(cuentas);
  return clave;
}

function listarCuentas() {
  const cuentas = leerCuentas_();
  const nombres = Object.keys(cuentas);
  if (!nombres.length) return Logger.log('No hay cuentas conjuntas.');
  nombres.forEach((c) => Logger.log('· ' + c + ' → titular ' + visible_(cuentas[c].titular) + ' (saldo inicial y objetivo en su hoja) · ' +
                                    'miembros ' + cuentas[c].miembros.map(visible_).join(' y ') + ' · corte ' + cuentas[c].corte));
}

/* ---------- Prueba (editor) ---------- */

/**
 * Prueba de la fase 21. Dos hojas de prueba (copias de la plantilla), dos usuarios («prueba21a», titular, y «prueba21b»)
 * y su cuenta conjunta. Todo por doPost con sus tokens, como desde los móviles. La hoja de Pau no se toca (lo comprueba al
 * final). Limpieza en finally: CUENTAS, USUARIOS, sus Deshacer y las dos hojas a la papelera.
 */
function probarAhorroConjunto() {
  const props = PropertiesService.getScriptProperties();
  const idPlantilla = props.getProperty(USU_PLANTILLA_);   // Usuarios.gs
  if (!idPlantilla) return Logger.log('❌ No hay plantilla: ejecuta antes crearPlantilla().');
  const log = (bien, texto) => Logger.log((bien ? '✅ ' : '❌ ') + texto);
  const miLibro = libro_();   // v1
  const foto = () => JSON.stringify(['Ahorros', 'Objetivos', 'Movimientos'].map((n) => miLibro.getSheetByName(n).getLastRow())
    .concat([miLibro.getSheetByName('Resumen').getRange('B5').getValue()]));
  const fotoAntes = foto();
  const antes = { usuarios: props.getProperty(USU_PROPIEDAD_), cuentas: props.getProperty(CUE_PROPIEDAD_), ultimo: props.getProperty('ULTIMO') };
  const A = 'prueba21a';
  const B = 'prueba21b';
  const hojas = [];
  const llamar = (token, accion, extra) =>
    JSON.parse(doPost({ postData: { contents: JSON.stringify(Object.assign({ t: token, accion: accion }, extra || {})) } }).getContent());
  try {
    const plantilla = SpreadsheetApp.openById(idPlantilla);
    hojas.push(plantilla.copy('Prueba 21 A (se borra sola)'), plantilla.copy('Prueba 21 B (se borra sola)'));
    const zona = hojas[0].getSpreadsheetTimeZone();
    const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
    const ayer = sumarDias_(hoy, -1);   // Ingresos.gs
    const tA = crearUsuario(A, hojas[0].getId()).token;
    const tB = crearUsuario(B, hojas[1].getId()).token;
    const mesDe = (t) => llamar(t, 'mes').cabecera.ahorro_mes;

    // 1. Antes de la cuenta: A con su saldo inicial (1.000) y una aportación «pareja» de ayer (50, historial de B);
    //    un «pareja» programado y un movimiento de B de ayer impiden crearla, hasta que se borran.
    llamar(tA, 'ahorro', { tipo: 'inicial', importe: 1000, fecha: hoy });
    llamar(tA, 'ahorro', { tipo: 'aportación', quien: 'pareja', importe: 50, fecha: ayer });
    const futuro = llamar(tA, 'ahorro', { tipo: 'aportación', quien: 'pareja', importe: 30, fecha: sumarDias_(hoy, 30) });
    const deAyer = llamar(tB, 'ahorro', { tipo: 'aportación', quien: 'yo', importe: 20, fecha: ayer });
    const intento = (fn) => { try { fn(); return 'se creó (no debería)'; } catch (err) { return err.message; } };
    const r1 = intento(() => crearCuentaConjunta(A, B, hoy));
    llamar(tA, 'borrar_ahorro', { id: futuro.id });
    const r2 = intento(() => crearCuentaConjunta(A, B, hoy));
    llamar(tB, 'borrar_ahorro', { id: deAyer.id });
    const cuenta = crearCuentaConjunta(A, B, hoy);
    log(/pareja/.test(r1) && /antes del corte/.test(r2) && cuenta.nombre === A + '+' + B,
        'Crear la cuenta: con «pareja» programado → ' + r1.slice(0, 60) + '… · con un movimiento de B de ayer → ' + r2.slice(0, 60) + '… · sin ellos → «' + cuenta.nombre + '»');

    // 2. Una aportación de cada uno: el total suma los dos y cada mes resta solo la suya.
    const mA0 = mesDe(tA);
    const mB0 = mesDe(tB);
    const apB = llamar(tB, 'ahorro', { tipo: 'aportación', importe: 100, fecha: hoy });   // sin «quién»: con cuenta, lo suyo
    const apA = llamar(tA, 'ahorro', { tipo: 'aportación', quien: 'yo', importe: 200, fecha: hoy });
    const vA = llamar(tA, 'ahorros');
    const vB = llamar(tB, 'ahorros');
    log(apB.ok && apA.ok && vA.total === 1350 && vB.total === 1350 && mesDe(tA) === redondear2_(mA0 + 200) && mesDe(tB) === redondear2_(mB0 + 100),
        'Aportaciones de B (100) y A (200) → total 1350 para los dos (A ' + vA.total + ', B ' + vB.total + ') · ahorro del mes de A ' + mA0 + ' → ' +
        mesDe(tA) + ', de B ' + mB0 + ' → ' + mesDe(tB));
    log(vA.yo === 200 && vA.pareja === 150 && vB.yo === 150 && vB.pareja === 200 && vA.inicial === 1000 && vA.conjunta.otro === B && vB.conjunta.otro === A,
        'Desglose: A ve tú ' + vA.yo + ' · ' + vA.conjunta.otro_visible + ' ' + vA.pareja + ' (100 + 50 de antes del corte) · B ve tú ' + vB.yo + ' · ' +
        vB.conjunta.otro_visible + ' ' + vB.pareja + ' · inicial ' + vA.inicial);

    // 3. Las reglas de la cuenta.
    const reglas = [llamar(tB, 'ahorro', { tipo: 'aportación', quien: 'pareja', importe: 5, fecha: hoy }),
                    llamar(tA, 'ahorro', { tipo: 'aportación', quien: 'pareja', importe: 5, fecha: hoy }),
                    llamar(tB, 'ahorro', { tipo: 'aportación', importe: 5, fecha: ayer }),
                    llamar(tB, 'ahorro', { tipo: 'inicial', importe: 5, fecha: hoy })];
    log(reglas.every((r) => r.error === 'rechazado'), 'Rechazados: «pareja» de B, «pareja» de A desde el corte, B antes del corte y saldo inicial de B → ' +
        reglas.map((r) => r.mensaje).join(' | '));

    // 4. Saldo conjunto: B retira 300 (en su hoja solo hay 100, en la cuenta 1350) → vale; 1400 → no. Deshacer de B: solo lo suyo.
    const re = llamar(tB, 'ahorro', { tipo: 'retirada', importe: 300, fecha: hoy });
    const mucho = llamar(tB, 'ahorro', { tipo: 'retirada', importe: 1400, fecha: hoy });
    const des = llamar(tB, 'deshacer');
    const vB2 = llamar(tB, 'ahorros');
    log(re.ok && re.ahorros.total === 1050 && mucho.error === 'rechazado' && des.ok && vB2.total === 1350,
        'Retirada de B de 300 (más que lo suyo, menos que la cuenta) → total ' + (re.ahorros && re.ahorros.total) + ' · de 1400 → ' + mucho.mensaje +
        ' · Deshacer de B → ' + des.desc + ' · total ' + vB2.total);

    // 5. Lo del otro no se toca: con los mismos IDs (S001 en las dos hojas), A no puede borrar ni editar lo de B.
    const deB = vA.movimientos.filter((m) => m.de === B)[0];
    const borrar = llamar(tA, 'borrar_ahorro', { id: deB.id, de: B });
    const editar = llamar(tA, 'editar_ahorro', { id: deB.id, de: B, importe: 1 });
    const mio = vA.movimientos.filter((m) => m.de === A && m.id === deB.id)[0];
    log(borrar.error === 'rechazado' && editar.error === 'rechazado' && llamar(tB, 'ahorros').total === 1350,
        'A no borra ni edita lo de B (' + deB.id + (mio ? ', el mismo ID que su «' + mio.concepto + '»' : '') + ') → ' + borrar.mensaje);

    // 6. El objetivo es de la cuenta: lo pone B, se guarda en la hoja de A y los dos lo ven con el total conjunto.
    const ob = llamar(tB, 'objetivo', { nombre: 'Prueba 21', importe: 5000 });
    const gA = llamar(tA, 'ahorros').objetivo;
    const gB = llamar(tB, 'ahorros').objetivo;
    const enA = hojas[0].getSheetByName(OBJ_HOJA_).getRange('A2').getValue();
    const enB = hojas[1].getSheetByName(OBJ_HOJA_).getRange('A2').getValue();
    log(ob.ok && gA && gB && gA.nombre === 'Prueba 21' && gB.progreso === 27 && gA.progreso === 27 && gA.falta === 3650 && enA === 'Prueba 21' && enB === '',
        'Objetivo de 5000 puesto por B → en la hoja de A («' + enA + '»), no en la de B · los dos lo ven: progreso ' + (gA && gA.progreso) + ' % y ' +
        (gB && gB.progreso) + ' %, faltan ' + (gA && gA.falta));

    // 7. Lo de antes del corte («pareja» de A) cuenta y es de B en la lista; quitar la cuenta → cada uno ve solo lo suyo.
    const antiguo = vB.movimientos.filter((m) => m.de === A && m.quien === 'pareja')[0];
    const quitada = quitarCuentaConjunta(B);
    const sola = llamar(tB, 'ahorros');
    log(antiguo && antiguo.quien_visible === 'Tú' && !antiguo.tuyo && quitada === cuenta.nombre && sola.total === 100 && !sola.conjunta,
        'El «pareja» de antes del corte, en la lista de B: «' + (antiguo && antiguo.quien_visible) + '», no editable · quitar la cuenta → B ve ' + sola.total + ' (solo lo suyo)');
  } catch (err) {
    log(false, 'La prueba se ha parado: ' + err.message);
  } finally {
    [['USUARIOS', antes.usuarios], ['CUENTAS', antes.cuentas], ['ULTIMO', antes.ultimo]].forEach(([k, v]) => {
      if (v === null) props.deleteProperty(k); else props.setProperty(k, v);
    });
    props.deleteProperty('ULTIMO:' + A);
    props.deleteProperty('ULTIMO:' + B);
    hojas.forEach((h) => {
      try { DriveApp.getFileById(h.getId()).setTrashed(true); } catch (err) { Logger.log('⚠️ Borra a mano la hoja de prueba ' + h.getUrl()); }
    });
    log(foto() === fotoAntes && props.getProperty(USU_PROPIEDAD_) === antes.usuarios && props.getProperty(CUE_PROPIEDAD_) === antes.cuentas &&
        props.getProperty('ULTIMO') === antes.ultimo, 'Limpieza: tu hoja, USUARIOS, CUENTAS y tu Deshacer como estaban; las dos hojas de prueba, a la papelera');
  }
}
