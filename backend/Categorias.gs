/**
 * Categorias.gs — Fase 7b.1: crear categorías desde la app.
 * Archivo nuevo. Escribe una fila en la pestaña Categorías (nombre y descripción) justo antes de «Otros».
 * Haiku, las listas desplegables y el Resumen leen esa pestaña, así que la categoría se puede usar al momento.
 * La descripción no es decorativa: Haiku la lee para decidir a qué categoría va cada gasto dictado.
 *
 * Acoplamiento: el límite sale de contar los bloques «cat» del Resumen (filas 10–129, columna G).
 */

const CAT_MAX_NOMBRE_ = 30;
const CAT_MIN_DESCRIPCION_ = 10;
const CAT_MAX_DESCRIPCION_ = 150;
const CAT_ULTIMA_ = 'Otros';   // el cajón de sastre se queda siempre al final

/** Acción "categoria" de la API: { nombre, descripcion } → crea la categoría y se puede deshacer. */
function crearCategoria_(p) {
  const nombre = String(p.nombre == null ? '' : p.nombre).replace(/\s+/g, ' ').trim();
  const descripcion = String(p.descripcion == null ? '' : p.descripcion).replace(/\s+/g, ' ').trim();
  const libro = libro_();   // v1

  return conBloqueo_(() => {   // v1: un acceso a la vez
    const hoja = libro.getSheetByName('Categorías');
    const existentes = nombresCategorias_(hoja);
    const huecos = huecosResumen_(libro);
    const error = validarCategoria_(nombre, descripcion, existentes, huecos);
    // Error de negocio con un mensaje para el usuario: se devuelve, no se lanza.
    if (error) return { ok: false, error: 'rechazado', mensaje: error };

    // Antes de «Otros»; si no existe, al final.
    const iOtros = existentes.map(normalizar).indexOf(normalizar(CAT_ULTIMA_));   // normalizar es de la v1
    let fila;
    if (iOtros >= 0) {
      fila = iOtros + 2;
      hoja.insertRowBefore(fila);
    } else {
      fila = existentes.length + 2;
    }
    // Un texto que empieza por "=" se tomaría como fórmula: el apóstrofo lo deja como texto.
    hoja.getRange(fila, 1, 1, 2).setValues([[nombre, /^[=+\-@]/.test(descripcion) ? "'" + descripcion : descripcion]]);

    // v1: deshacer borra la fila cuya primera columna es el nombre.
    apuntarDeshacer_('Categoría «' + nombre + '» eliminada', [{ op: 'borrar', hoja: 'Categorías', id: nombre }]);
    CacheService.getScriptCache().remove(VOCAB_CLAVE_CACHE_);   // el vocabulario de Whisper incluye categorías

    return { nombre: nombre, desc: 'Categoría «' + nombre + '» creada', huecos_libres: huecos - existentes.length - 1 };
  });
}

/** Devuelve el mensaje del primer problema, o null si se puede crear. No escribe nada. */
function validarCategoria_(nombre, descripcion, existentes, huecos) {
  if (!nombre) return 'Escribe un nombre para la categoría.';
  if (nombre.length > CAT_MAX_NOMBRE_) return 'El nombre puede tener como máximo ' + CAT_MAX_NOMBRE_ + ' caracteres.';
  if (!/\p{L}/u.test(nombre)) return 'El nombre tiene que llevar alguna letra.';
  if (/^[=+\-@]/.test(nombre)) return 'El nombre no puede empezar por =, +, - ni @.';
  if (nombre.indexOf('|') >= 0) return 'El nombre no puede llevar el carácter |.';   // la hoja lo usa como separador en Cálculo
  const igual = existentes.filter((n) => normalizar(n) === normalizar(nombre))[0];
  if (igual) return 'Ya existe la categoría «' + igual + '».';
  if (descripcion.length < CAT_MIN_DESCRIPCION_) {
    return 'Describe en unas palabras qué gastos entran: así se clasifican bien los dictados.';
  }
  if (descripcion.length > CAT_MAX_DESCRIPCION_) {
    return 'La descripción puede tener como máximo ' + CAT_MAX_DESCRIPCION_ + ' caracteres.';
  }
  if (existentes.length >= huecos) {
    return 'El Resumen solo tiene sitio para ' + huecos + ' categorías y ya están todas. Hay que ampliarlo en la hoja.';
  }
  return null;
}

/** Nombres de la pestaña Categorías, en orden (columna A, sin vacíos). */
function nombresCategorias_(hoja) {
  if (hoja.getLastRow() < 2) return [];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues()
    .map((f) => String(f[0]).trim()).filter(Boolean);
}

/** Cuántas categorías caben en el Resumen: sus bloques llevan «cat» en la columna G. */
function huecosResumen_(libro) {
  return libro.getSheetByName('Resumen').getRange(MES_PRIMERA_FILA_, 7, MES_ULTIMA_FILA_ - MES_PRIMERA_FILA_ + 1, 1)
    .getValues().filter((f) => f[0] === 'cat').length;   // constantes de Mes.gs
}

/**
 * Prueba desde el editor (sin la app):
 *  1. Las validaciones, sin escribir nada.
 *  2. Crea una categoría de prueba, comprueba que queda antes de «Otros» y que sale en el Resumen, y la borra.
 * Deja como estaban la pestaña Categorías y la propiedad ULTIMO (el Deshacer pendiente).
 */
function probarCategorias() {
  const libro = libro_();
  const hoja = libro.getSheetByName('Categorías');
  const existentes = nombresCategorias_(hoja);
  const huecos = huecosResumen_(libro);
  Logger.log('Categorías: ' + existentes.length + ' de ' + huecos + ' huecos del Resumen · ' + existentes.join(', '));

  const desc = 'Gastos de prueba para comprobar la validación';
  const casos = [
    ['vacío', '', desc, true],
    ['solo espacios', '   ', desc, true],
    ['demasiado largo', 'x'.repeat(CAT_MAX_NOMBRE_ + 1), desc, true],
    ['sin letras', '123', desc, true],
    ['empieza por =', '=SUMA(A1)', desc, true],
    ['con |', 'Casa|Aina', desc, true],
    ['repetido', existentes[0] || 'Ocio', desc, true],
    ['repetido sin tildes ni mayúsculas', normalizar(existentes[0] || 'Ocio').toUpperCase(), desc, true],
    ['sin descripción', 'Nueva', '', true],
    ['descripción corta', 'Nueva', 'gastos', true],
    ['válido', 'Nueva categoría', desc, false]
  ];
  let ok = 0;
  casos.forEach(([caso, nombre, d, debeFallar]) => {
    const n = String(nombre).replace(/\s+/g, ' ').trim();
    const error = validarCategoria_(n, d, existentes, huecos);
    const bien = debeFallar ? !!error : !error;
    if (bien) ok++;
    Logger.log((bien ? '✅ ' : '❌ ') + caso + ' → ' + (error || 'se puede crear'));
  });
  const lleno = validarCategoria_('Nueva categoría', desc, new Array(huecos).fill('x'), huecos);
  if (lleno) ok++;
  Logger.log((lleno ? '✅ ' : '❌ ') + 'Resumen lleno → ' + (lleno || 'se puede crear'));
  Logger.log('Validaciones: ' + ok + '/' + (casos.length + 1));

  // Creación real, con limpieza en el finally.
  const props = PropertiesService.getScriptProperties();
  const ultimo = props.getProperty('ULTIMO');
  const nombre = 'Prueba 7b';
  try {
    const r = crearCategoria_({ nombre: nombre, descripcion: 'Categoría temporal de probarCategorias' });
    if (r.ok === false) { Logger.log('❌ Crear → ' + r.mensaje); return; }
    const ahora = nombresCategorias_(hoja);
    const i = ahora.indexOf(nombre);
    const antesDeOtros = ahora.indexOf(CAT_ULTIMA_) < 0 || i === ahora.indexOf(CAT_ULTIMA_) - 1;
    Logger.log((antesDeOtros ? '✅ ' : '❌ ') + 'Creada en la posición ' + (i + 1) + ' (justo antes de «Otros») · quedan ' +
               r.huecos_libres + ' huecos');
    SpreadsheetApp.flush();
    const enResumen = libro.getSheetByName('Resumen').getRange(MES_PRIMERA_FILA_, 1, MES_ULTIMA_FILA_ - MES_PRIMERA_FILA_ + 1, 7)
      .getValues().some((f) => f[6] === 'cat' && String(f[0]).trim() === nombre);
    Logger.log((enResumen ? '✅ ' : '❌ ') + 'Aparece en el Resumen');
    const dup = crearCategoria_({ nombre: nombre.toLowerCase(), descripcion: 'Otra vez la misma, en minúsculas' });
    Logger.log((dup.ok === false ? '✅ ' : '❌ ') + 'Crearla otra vez → ' + (dup.mensaje || 'se creó (no debería)'));
  } finally {
    const fila = nombresCategorias_(hoja).indexOf(nombre);
    if (fila >= 0) hoja.deleteRow(fila + 2);
    if (ultimo === null) props.deleteProperty('ULTIMO');
    else props.setProperty('ULTIMO', ultimo);
    const iguales = nombresCategorias_(hoja).join('|') === existentes.join('|');
    Logger.log((iguales ? '✅ ' : '❌ ') + 'Limpieza: Categorías y Deshacer pendiente como estaban');
  }
}
