/**
 * Usuarios.gs — Fase 20: la app para varias personas. Un servidor (este proyecto) y una hoja por persona. Archivo nuevo.
 *
 * El token decide la persona y su hoja:
 *  - el de siempre (propiedad TOKEN, v1) es el de Pau y abre su hoja (CONFIG.ID_HOJA);
 *  - los demás viven en la propiedad USUARIOS: { "<nombre>": { "token": "…", "hoja": "<ID>" } }.
 * doPost (Api.gs) identifica a la persona y la fija con fijarPersona_ para toda la petición: libro_() (v1, cambiada en
 * esta fase) abre HOJA_PETICION_ y el Deshacer de cada persona va en su propia propiedad (claveUltimo_). Las funciones de
 * la v1 siguen exigiendo el token de siempre: doPost les pasa el del servidor (tokenInterno_) una vez identificada la
 * persona. Así la app web antigua (doGet + Index.html) sigue siendo solo de Pau.
 *
 * Funciones del editor (el botón Ejecutar no pasa argumentos, así que las altas y bajas leen una propiedad):
 *  - crearPlantilla(): copia de la hoja de Pau sin ningún dato suyo, para instalar a otra persona.
 *  - altaUsuario(): lee ALTA_USUARIO = "nombre|ID de su hoja", da de alta y enseña su token una sola vez.
 *  - bajaUsuario(): lee BAJA_USUARIO = "nombre"; su token deja de valer al momento.
 *  - listarUsuarios(): nombres y hojas, nunca los tokens.
 *  - probarUsuarios(): la prueba de esta fase.
 * Para las migraciones de fases futuras: enTodasLasHojas_(aplicarFaseN) la ejecuta en la hoja de Pau, en la plantilla y
 * en la de cada persona.
 */

// Persona de la petición en curso. null = Pau (su hoja es la de siempre y su Deshacer, la propiedad ULTIMO).
var HOJA_PETICION_ = null;      // ID de la hoja que abre libro_()
var USUARIO_PETICION_ = null;   // nombre (clave de USUARIOS)

const USU_PROPIEDAD_ = 'USUARIOS';
const USU_PLANTILLA_ = 'PLANTILLA';        // ID de la plantilla, lo guarda crearPlantilla()
const USU_TITULAR_ = 'pau';                // el nombre del token de siempre (no se puede dar de alta otro igual)
const USU_NOMBRE_PLANTILLA_ = 'Control de gastos — plantilla';
const USU_CATEGORIAS_ = ['Formación', 'Financiación', 'Alimentación', 'Ocio', 'Suscripciones', 'Transporte', 'Salud',
                         'Cuidado personal', 'Otros'];
// Pestañas con datos de una persona: la plantilla las deja sin filas (salvo la cabecera).
const USU_PESTANAS_DATOS_ = ['Recurrentes', 'Movimientos', 'Ingresos', 'Ahorros', 'Pagos', 'Evaluación', 'Evaluación resumen'];
// Estructura que tiene que tener la hoja de una persona: la fila 1 de estas pestañas y estas celdas, iguales que en la
// hoja de Pau (que siempre lleva todas las migraciones). Una fase que añada columnas queda cubierta sola.
const USU_FILA1_ = ['Recurrentes', 'Movimientos', 'Ingresos', 'Ahorros', 'Objetivos', 'Meses', 'Cálculo', 'Categorías'];
const USU_CELDAS_ = [['Resumen', 'D2:D8'], ['Objetivos', 'H1:H13']];

/* ---------- La persona de cada petición ---------- */

/** { nombre, hoja } de un token, o null si no vale. El de siempre (v1) es el de Pau, con hoja null. */
function identificar_(token) {
  const t = limpiarToken_(token);   // v1
  if (tokenValido_(t)) return { nombre: USU_TITULAR_, hoja: null };   // v1
  if (!t) return null;
  const usuarios = leerUsuarios_();
  for (const nombre in usuarios) {
    if (tokenIgual_(usuarios[nombre].token, t)) return { nombre: nombre, hoja: usuarios[nombre].hoja };
  }
  return null;
}

/** Fija la persona para lo que venga después (libro_, Deshacer, caché). Devuelve la de antes, para restaurarla. */
function fijarPersona_(persona) {
  const antes = { hoja: HOJA_PETICION_, usuario: USUARIO_PETICION_ };
  const titular = persona.nombre === USU_TITULAR_;
  HOJA_PETICION_ = titular ? null : persona.hoja;
  USUARIO_PETICION_ = titular ? null : persona.nombre;
  return antes;
}

function restaurarPersona_(antes) {
  HOJA_PETICION_ = antes.hoja;
  USUARIO_PETICION_ = antes.usuario;
}

/** La propiedad del Deshacer pendiente: ULTIMO para Pau (la de siempre) y ULTIMO:<nombre> para los demás. */
function claveUltimo_() {
  return USUARIO_PETICION_ ? 'ULTIMO:' + USUARIO_PETICION_ : 'ULTIMO';
}

/** La clave de la caché del vocabulario de Whisper (Vocabulario.gs): una por hoja. */
function claveVocabulario_() {
  return HOJA_PETICION_ ? VOCAB_CLAVE_CACHE_ + ':' + HOJA_PETICION_ : VOCAB_CLAVE_CACHE_;
}

/** El token de siempre, para las funciones de la v1 (exigirToken_). Solo se usa dentro del servidor. */
function tokenInterno_() {
  return PropertiesService.getScriptProperties().getProperty('TOKEN') || '';
}

/* ---------- Alta y baja (funciones del editor) ---------- */

/** Rellena la propiedad ALTA_USUARIO con "nombre|ID de su hoja" y ejecuta esto. Enseña el token una sola vez. */
function altaUsuario() {
  const props = PropertiesService.getScriptProperties();
  const alta = String(props.getProperty('ALTA_USUARIO') || '');
  if (alta.indexOf('|') < 0) return Logger.log('❌ Pon en las propiedades del script ALTA_USUARIO = nombre|ID de su hoja.');
  try {
    const u = crearUsuario(alta.split('|')[0], alta.split('|')[1]);
    props.deleteProperty('ALTA_USUARIO');
    Logger.log('✅ «' + u.nombre + '» dado de alta con la hoja «' + u.titulo + '».');
    Logger.log('Su token (cópialo ahora a tu llavero; no se vuelve a enseñar):');
    Logger.log(u.token);
  } catch (err) {
    Logger.log('❌ ' + err.message);
  }
}

/** Rellena la propiedad BAJA_USUARIO con el nombre y ejecuta esto. Su token deja de valer al momento. */
function bajaUsuario() {
  const props = PropertiesService.getScriptProperties();
  const nombre = String(props.getProperty('BAJA_USUARIO') || '').trim();
  if (!nombre) return Logger.log('❌ Pon en las propiedades del script BAJA_USUARIO = nombre.');
  try {
    quitarUsuario(nombre);
    props.deleteProperty('BAJA_USUARIO');
    Logger.log('✅ «' + nombre + '» dado de baja: su token ya no vale. Su hoja sigue en su Drive, intacta.');
  } catch (err) {
    Logger.log('❌ ' + err.message);
  }
}

/**
 * Da de alta a una persona con su hoja (una copia de la plantilla que le ha compartido a Pau como editora) y devuelve
 * { nombre, hoja, token, titulo }. Lanza un Error con un mensaje claro si algo no cuadra; entonces no guarda nada.
 */
function crearUsuario(nombre, idHoja) {
  nombre = String(nombre == null ? '' : nombre).trim().toLowerCase();
  idHoja = String(idHoja == null ? '' : idHoja).trim();
  if (!/^[a-z][a-z0-9_-]{1,19}$/.test(nombre)) {
    throw new Error('El nombre tiene que ser de 2 a 20 letras minúsculas sin tildes, números, «-» o «_», empezando por una letra.');
  }
  if (nombre === USU_TITULAR_) throw new Error('«' + USU_TITULAR_ + '» es el nombre del token de siempre: elige otro.');
  const usuarios = leerUsuarios_();
  if (usuarios[nombre]) throw new Error('Ya hay una persona llamada «' + nombre + '».');
  if (!idHoja) throw new Error('Falta el ID de su hoja (lo que va entre /d/ y /edit en su enlace).');
  if (idHoja === CONFIG.ID_HOJA) throw new Error('Ese es el ID de tu hoja: cada persona necesita la suya.');   // v1
  if (idHoja === PropertiesService.getScriptProperties().getProperty(USU_PLANTILLA_)) {
    throw new Error('Ese es el ID de la plantilla: la persona tiene que hacer una copia en su Drive y usar esa.');
  }
  for (const n in usuarios) {
    if (usuarios[n].hoja === idHoja) throw new Error('Esa hoja ya es la de «' + n + '».');
  }
  let libro;
  try {
    libro = SpreadsheetApp.openById(idHoja);
    // Escribir lo mismo que hay: falla si solo la puede ver (el servidor escribe en ella en cada gasto).
    const b1 = libro.getSheetByName('Resumen').getRange('B1');
    b1.setValue(b1.getValue());
    SpreadsheetApp.flush();
  } catch (err) {
    throw new Error('No puedo abrir esa hoja para editarla (' + idHoja + '): ¿te la ha compartido como editora? (' + err.message + ')');
  }
  const diferencias = diferenciasDeEstructura_(libro, libro_());   // v1: la hoja de Pau, la de referencia
  if (diferencias.length) {
    throw new Error('Esa hoja no tiene la estructura de la tuya: ' + diferencias.join(' · ') +
                    '. ¿Es una copia de la plantilla al día (con todas las migraciones)?');
  }
  const token = nuevoToken_();
  usuarios[nombre] = { token: token, hoja: idHoja };
  guardarUsuarios_(usuarios);
  return { nombre: nombre, hoja: idHoja, token: token, titulo: libro.getName() };
}

/** Quita a una persona: su token deja de valer al momento y su Deshacer pendiente se borra. Su hoja no se toca. */
function quitarUsuario(nombre) {
  nombre = String(nombre == null ? '' : nombre).trim().toLowerCase();
  const usuarios = leerUsuarios_();
  if (!usuarios[nombre]) throw new Error('No hay ninguna persona llamada «' + nombre + '».');
  delete usuarios[nombre];
  guardarUsuarios_(usuarios);
  PropertiesService.getScriptProperties().deleteProperty('ULTIMO:' + nombre);
}

/** Nombres y hojas (nunca los tokens), y si el servidor puede abrir cada una. */
function listarUsuarios() {
  const usuarios = leerUsuarios_();
  const plantilla = PropertiesService.getScriptProperties().getProperty(USU_PLANTILLA_);
  Logger.log('· ' + USU_TITULAR_ + ' (token de siempre) → ' + libro_().getName());   // v1
  if (plantilla) Logger.log('· plantilla → ' + plantilla);
  const nombres = Object.keys(usuarios);
  if (!nombres.length) return Logger.log('No hay más personas dadas de alta.');
  nombres.forEach((n) => {
    let estado;
    try {
      estado = '«' + SpreadsheetApp.openById(usuarios[n].hoja).getName() + '»';
    } catch (err) {
      estado = '❌ no se puede abrir (¿ha dejado de compartirla?)';
    }
    Logger.log('· ' + n + ' → ' + usuarios[n].hoja + ' ' + estado);
  });
}

/* ---------- La plantilla ---------- */

/**
 * Copia de la hoja de Pau con todas las fases aplicadas y ningún dato suyo. Nunca toca la original: comprueba que el ID
 * de la copia no es el de ninguna hoja con datos antes de vaciar nada. Guarda su ID en la propiedad PLANTILLA.
 */
function crearPlantilla() {
  const original = libro_();   // v1: la de Pau
  const zona = original.getSpreadsheetTimeZone();
  const copia = original.copy(USU_NOMBRE_PLANTILLA_);
  const id = copia.getId();
  const usuarios = leerUsuarios_();
  const conDatos = [CONFIG.ID_HOJA, original.getId()].concat(Object.keys(usuarios).map((n) => usuarios[n].hoja));   // v1
  if (conDatos.indexOf(id) >= 0) return Logger.log('❌ La copia tiene el ID de una hoja con datos (' + id + '). No se ha tocado nada.');

  // 1. Vaciar los datos (clearContent, sin borrar filas: Cálculo apunta a Recurrentes por número de fila).
  USU_PESTANAS_DATOS_.forEach((nombre) => {
    const h = copia.getSheetByName(nombre);
    if (h && h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, Math.max(1, h.getLastColumn())).clearContent();
  });
  const obj = copia.getSheetByName(OBJ_HOJA_);   // Ahorros.gs
  const objetivos = filasObjetivos_(obj).length;   // Ahorros.gs: solo A:E; los totales de H:I no se tocan
  if (objetivos) obj.getRange(2, 1, objetivos, 5).clearContent();
  const meses = copia.getSheetByName('Meses');
  if (meses.getLastRow() > 1) meses.getRange(2, 3, meses.getLastRow() - 1, 2).clearContent();   // C y D: previstos

  // 2. Categorías: solo las genéricas (de abajo arriba, para no mover las que quedan por mirar).
  const cats = copia.getSheetByName('Categorías');
  const genericas = USU_CATEGORIAS_.map(normalizar);   // v1
  const quitadas = [];
  for (let f = cats.getLastRow(); f >= 2; f--) {
    const nombre = String(cats.getRange(f, 1).getValue()).trim();
    if (genericas.indexOf(normalizar(nombre)) < 0) { cats.deleteRow(f); if (nombre) quitadas.push(nombre); }
  }

  // 3. Resumen!B1 en el mes actual (el natural: la plantilla no tiene nóminas).
  const hoy = Utilities.formatDate(new Date(), zona, 'yyyy-MM');
  const actual = mesesDeLaHoja_(copia, zona).filter((m) => m.inicio.slice(0, 7) === hoy)[0];   // Mes.gs
  if (actual) copia.getSheetByName('Resumen').getRange('B1').setValue(actual.etiqueta);
  SpreadsheetApp.flush();

  // 4. Comprobar: ningún dato, B7 = 0, las categorías genéricas y la misma estructura que la original.
  const problemas = [];
  USU_PESTANAS_DATOS_.forEach((nombre) => {
    const h = copia.getSheetByName(nombre);
    if (h && h.getRange(1, 1, Math.max(1, h.getLastRow()), Math.max(1, h.getLastColumn())).getValues().slice(1)
      .some((fila) => fila.some((v) => v !== ''))) problemas.push(nombre + ' tiene datos');
  });
  if (filasObjetivos_(obj).length) problemas.push('Objetivos tiene objetivos');
  if (meses.getLastRow() > 1 && meses.getRange(2, 3, meses.getLastRow() - 1, 2).getValues().some((f) => f[0] !== '' || f[1] !== '')) {
    problemas.push('Meses tiene previstos');
  }
  const b7 = copia.getSheetByName('Resumen').getRange('B7').getValue();
  if (b7 !== 0) problemas.push('Resumen!B7 = ' + b7);
  const quedan = cats.getLastRow() < 2 ? [] : cats.getRange(2, 1, cats.getLastRow() - 1, 1).getValues().map((f) => String(f[0]).trim());
  const faltan = USU_CATEGORIAS_.filter((c) => quedan.map(normalizar).indexOf(normalizar(c)) < 0);
  if (faltan.length) problemas.push('faltan las categorías ' + faltan.join(', '));
  diferenciasDeEstructura_(copia, original).forEach((d) => problemas.push(d));
  if (problemas.length) {
    return Logger.log('❌ La plantilla no ha quedado limpia: ' + problemas.join(' · ') + '. Revísala o mándala a la papelera: ' + copia.getUrl());
  }

  const props = PropertiesService.getScriptProperties();
  const anterior = props.getProperty(USU_PLANTILLA_);
  props.setProperty(USU_PLANTILLA_, id);
  Logger.log('✅ Plantilla creada, sin datos (B7 = 0), con la estructura de tu hoja: ' + copia.getUrl());
  if (quitadas.length) Logger.log('· Categorías quitadas: ' + quitadas.join(', '));
  if (anterior && anterior !== id) Logger.log('· La plantilla anterior (' + anterior + ') ya no se usa: mándala a la papelera si quieres.');
  Logger.log('· Pestañas: ' + copia.getSheets().map((h) => h.getName()).join(', ') + ' (comprueba que no hay ninguna tuya de más).');
  Logger.log('· Revisa las descripciones de las categorías (Haiku las lee para clasificar) y cambia las que sean demasiado tuyas:');
  if (cats.getLastRow() > 1) {
    cats.getRange(2, 1, cats.getLastRow() - 1, 2).getValues().forEach((f) => Logger.log('   ' + f[0] + ': ' + f[1]));
  }
}

/**
 * Lo que distingue la estructura de una hoja de la de referencia (la de Pau): la fila 1 de las pestañas de USU_FILA1_
 * y las celdas de USU_CELDAS_, solo donde la referencia tiene texto (los números son totales, no estructura).
 */
function diferenciasDeEstructura_(libro, referencia) {
  const diferencias = [];
  const textos = (h, a1) => h.getRange(a1).getValues().map((f) => f.map((v) => (typeof v === 'string' ? v.trim() : null)));
  const comparar = (nombre, a1) => {
    const h = libro.getSheetByName(nombre);
    const r = referencia.getSheetByName(nombre);
    if (!r) return;
    if (!h) return diferencias.push('falta la pestaña ' + nombre);
    const esperado = textos(r, a1);
    const real = textos(h, a1);
    esperado.forEach((fila, i) => fila.forEach((v, j) => {
      if (v !== null && v !== '' && v !== real[i][j]) {
        diferencias.push(nombre + '!' + h.getRange(a1).getCell(i + 1, j + 1).getA1Notation() + ' «' + (real[i][j] || '') + '» (en la tuya, «' + v + '»)');
      }
    }));
  };
  USU_FILA1_.forEach((nombre) => {
    const r = referencia.getSheetByName(nombre);
    if (r) comparar(nombre, 'A1:' + r.getRange(1, Math.max(1, r.getLastColumn())).getA1Notation());
  });
  USU_CELDAS_.forEach(([nombre, a1]) => comparar(nombre, a1));
  return diferencias;
}

/* ---------- Migraciones en todas las hojas ---------- */

/**
 * Ejecuta una función que trabaja con libro_() (una migración aplicarFaseN) en la hoja de Pau, en la plantilla y en la de
 * cada persona. Si una falla, sigue con las demás; al final, un resumen. Cada fase futura que cambie la hoja añade una
 * línea: function aplicarFaseNEnTodas() { enTodasLasHojas_(aplicarFaseN); }
 */
function enTodasLasHojas_(fn) {
  const usuarios = leerUsuarios_();
  const plantilla = PropertiesService.getScriptProperties().getProperty(USU_PLANTILLA_);
  const hojas = [{ nombre: USU_TITULAR_, hoja: null }];
  if (plantilla) hojas.push({ nombre: 'plantilla', hoja: plantilla });
  Object.keys(usuarios).forEach((n) => hojas.push({ nombre: n, hoja: usuarios[n].hoja }));
  const resumen = [];
  hojas.forEach((h) => {
    Logger.log('===== ' + h.nombre);
    const antes = fijarPersona_(h);
    try {
      fn();
      resumen.push(h.nombre + ' ejecutada');
    } catch (err) {
      Logger.log('❌ ' + err.message);
      resumen.push(h.nombre + ' ❌ ' + err.message);
    } finally {
      restaurarPersona_(antes);
    }
  });
  Logger.log('== En todas las hojas: ' + resumen.join(' · ') + ' (mira arriba los ✅ y ❌ de cada una)');
}

/* ---------- Ayudantes ---------- */

function leerUsuarios_() {
  const texto = PropertiesService.getScriptProperties().getProperty(USU_PROPIEDAD_);
  return texto ? JSON.parse(texto) : {};
}

function guardarUsuarios_(usuarios) {
  const props = PropertiesService.getScriptProperties();
  if (Object.keys(usuarios).length) props.setProperty(USU_PROPIEDAD_, JSON.stringify(usuarios));
  else props.deleteProperty(USU_PROPIEDAD_);
}

/** Como generarToken (v1): 40 caracteres aleatorios. */
function nuevoToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

/** Comparación sin atajos, como tokenValido_ (v1): no deja adivinar el token por el tiempo de respuesta. */
function tokenIgual_(real, token) {
  real = String(real || '');
  if (!real || !token || real.length !== token.length) return false;
  let dif = 0;
  for (let i = 0; i < real.length; i++) dif |= real.charCodeAt(i) ^ token.charCodeAt(i);
  return dif === 0;
}

/* ---------- Prueba (editor) ---------- */

/**
 * Prueba de la fase 20. Copia la plantilla en una hoja de prueba, da de alta a «prueba20» y llama a doPost con su token y
 * con el de Pau. Comprueba que todo ocurre en la hoja de prueba, que la de Pau no cambia (filas de cada pestaña y B5) y
 * que su Deshacer tampoco. Limpieza en finally: USUARIOS, los Deshacer y la hoja de prueba a la papelera.
 */
function probarUsuarios() {
  const props = PropertiesService.getScriptProperties();
  const idPlantilla = props.getProperty(USU_PLANTILLA_);
  if (!idPlantilla) return Logger.log('❌ No hay plantilla: ejecuta antes crearPlantilla().');
  const log = (bien, texto) => Logger.log((bien ? '✅ ' : '❌ ') + texto);
  const miToken = tokenInterno_();
  const miLibro = libro_();   // v1
  const foto = () => JSON.stringify(['Recurrentes', 'Movimientos', 'Ingresos', 'Ahorros', 'Pagos', 'Categorías']
    .map((n) => { const h = miLibro.getSheetByName(n); return h ? h.getLastRow() : null; })
    .concat([miLibro.getSheetByName('Resumen').getRange('B1').getValue(), miLibro.getSheetByName('Resumen').getRange('B5').getValue()]));
  const fotoAntes = foto();
  const usuariosAntes = props.getProperty(USU_PROPIEDAD_);
  const miUltimo = props.getProperty('ULTIMO');
  const nombre = 'prueba20';
  const llamar = (token, accion, extra) =>
    JSON.parse(doPost({ postData: { contents: JSON.stringify(Object.assign({ t: token, accion: accion }, extra || {})) } }).getContent());
  let copia = null;
  try {
    copia = SpreadsheetApp.openById(idPlantilla).copy('Prueba 20 (se borra sola)');
    const movsSuyos = () => copia.getSheetByName('Movimientos').getLastRow() - 1;
    const u = crearUsuario(nombre, copia.getId());
    log(u.token && u.token !== miToken && identificar_(u.token).hoja === copia.getId(), 'Alta de «' + nombre + '» con la hoja de prueba');

    // 1. Validaciones del alta (no guardan nada).
    const rechazos = [['', copia.getId()], [USU_TITULAR_, copia.getId()], [nombre, copia.getId()], ['otra', CONFIG.ID_HOJA],   // v1
                      ['otra', idPlantilla], ['otra', copia.getId()], ['otra', 'no-existe']].map(([n, id]) => {
      try { crearUsuario(n, id); return 'se dio de alta (no debería)'; } catch (err) { return err.message; }
    });
    log(rechazos.every((r) => r !== 'se dio de alta (no debería)') && Object.keys(leerUsuarios_()).filter((n) => n === 'otra').length === 0,
        'Altas rechazadas (nombre vacío, «pau», repetido, tu hoja, la plantilla, una hoja ya usada, un ID que no existe): ' + rechazos.length + '/7');

    // 2. «Mes» con su token: su hoja (vacía: ni reglas, ni gastos, ni ingreso), no la tuya. Y en serie (tú → ella → tú)
    //    cada uno ve la suya.
    const miMes = llamar(miToken, 'mes');
    const suMes = llamar(u.token, 'mes');
    const miMes2 = llamar(miToken, 'mes');
    const vacio = suMes.ok && suMes.cabecera.ingreso === 0 && suMes.categorias.every((c) => !c.reglas.length && !c.movimientos.length);
    log(vacio && miMes.ok && miMes2.ok && JSON.stringify(miMes.cabecera) === JSON.stringify(miMes2.cabecera) &&
        libro_().getId() === miLibro.getId(),
        '«Mes»: el suyo, vacío (ingreso ' + (suMes.cabecera && suMes.cabecera.ingreso) + ', total previsto ' +
        (suMes.cabecera && suMes.cabecera.total_previsto) + ') · el tuyo, igual antes y después (total previsto ' +
        (miMes.cabecera && miMes.cabecera.total_previsto) + ') · al acabar, libro_() vuelve a tu hoja');

    // 3. Un gasto suyo (como el formulario): en su hoja, con su Deshacer; la tuya y tu Deshacer, igual.
    const hoy = Utilities.formatDate(new Date(), copia.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    const interpretacion = { concepto: 'Prueba 20', importe: 1.23, categoria: 'Otros', frecuencia: 'puntual', cada_meses: null,
                             tipo: null, fecha_referencia: hoy, dia_de_cobro: null, fecha_fin: null, reemplaza_id: null,
                             supuestos: [], preguntas: [] };
    const g = llamar(u.token, 'guardar', { interpretacion: interpretacion, frase: '(formulario) categoría Otros' });
    log(g.ok && movsSuyos() === 1 && props.getProperty('ULTIMO:' + nombre) && props.getProperty('ULTIMO') === miUltimo && foto() === fotoAntes,
        'Gasto suyo → ' + (g.ok ? g.hoja + ' ' + g.id : g.mensaje || g.error) + ' en su hoja (' + movsSuyos() + ' fila); tu hoja y tu Deshacer, igual');

    // 4. Deshacer con tu token no toca su gasto (tu Deshacer se vacía antes para no deshacer nada tuyo de verdad).
    props.deleteProperty('ULTIMO');
    const miD = llamar(miToken, 'deshacer');
    log(miD.ok === false && movsSuyos() === 1, 'Deshacer con tu token → ' + (miD.mensaje || miD.error) + ' · su gasto sigue');
    if (miUltimo !== null) props.setProperty('ULTIMO', miUltimo);

    // 5. Deshacer con su token: se va su gasto; lo tuyo, igual.
    const suD = llamar(u.token, 'deshacer');
    log(suD.ok && movsSuyos() === 0 && !props.getProperty('ULTIMO:' + nombre) && props.getProperty('ULTIMO') === miUltimo && foto() === fotoAntes,
        'Deshacer con su token → ' + (suD.desc || suD.mensaje) + ' · tu hoja y tu Deshacer, igual');

    // 6. Un token desconocido, y tras quitar a la persona, el suyo → «token».
    const malo = llamar('x'.repeat(40), 'mes');
    quitarUsuario(nombre);
    const quitado = llamar(u.token, 'mes');
    log(malo.error === 'token' && quitado.error === 'token', 'Token desconocido → ' + malo.error + ' · tras quitarUsuario, el suyo → ' + quitado.error);
  } catch (err) {
    log(false, 'La prueba se ha parado: ' + err.message);
  } finally {
    if (usuariosAntes === null) props.deleteProperty(USU_PROPIEDAD_);
    else props.setProperty(USU_PROPIEDAD_, usuariosAntes);
    props.deleteProperty('ULTIMO:' + nombre);
    if (miUltimo === null) props.deleteProperty('ULTIMO');
    else props.setProperty('ULTIMO', miUltimo);
    if (copia) {
      try {
        DriveApp.getFileById(copia.getId()).setTrashed(true);
      } catch (err) {
        Logger.log('⚠️ No he podido mandar la hoja de prueba a la papelera: bórrala tú (' + copia.getUrl() + ').');
      }
    }
    log(foto() === fotoAntes && props.getProperty(USU_PROPIEDAD_) === usuariosAntes && props.getProperty('ULTIMO') === miUltimo,
        'Limpieza: tu hoja, USUARIOS y tu Deshacer como estaban; la hoja de prueba, a la papelera');
  }
}
