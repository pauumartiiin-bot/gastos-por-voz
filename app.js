// Fase 6.4: dictar → vista previa → guardar (o corregir por voz) → deshacer, y «Mis registros».

const CLAVE_TOKEN = 'gastos_token';
const CLAVE_TEMA = 'gastos_tema';
const CLAVE_PRUEBAS = 'gastos_pruebas';

// Volumen (RMS, 0–1) por debajo del cual se considera que no se habló. Ajustable en la 6.4
// con el dato «Volumen máx.» del modo pruebas.
const UMBRAL_VOZ = 0.02;

// Tiempo que la notificación con Deshacer sigue visible (ms).
const MS_NOTIFICACION = 8000;

const $ = (id) => document.getElementById(id);
const boton = $('boton');

let grabador = null;
let trozos = [];
let mime = '';
let ultima = null;       // última propuesta del servidor (para Guardar / Corregir)
let corrigiendo = false; // si es true, la próxima grabación es una corrección

/* ---------- Almacenamiento (puede fallar en modo privado) ---------- */

function leer(clave) {
  try { return localStorage.getItem(clave); } catch (e) { return null; }
}
function escribir(clave, valor) {
  try {
    if (valor == null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, valor);
  } catch (e) { /* sin almacenamiento: la app sigue funcionando en esta sesión */ }
}

/* ---------- Vistas ---------- */

function mostrar(id, visible) {
  $(id).classList.toggle('oculto', !visible);
}

function irA(vista) {
  mostrar('vista-dictar', vista === 'dictar');
  mostrar('vista-registros', vista === 'registros');
  if (vista === 'registros') cargarRegistros(); // siempre datos frescos: la hoja puede haber cambiado
  document.querySelectorAll('.barra button').forEach((b) => {
    if (b.dataset.vista === vista) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

// Sin token solo se ve la pantalla para introducirlo.
function pantallaInicial() {
  const hayToken = !!leer(CLAVE_TOKEN);
  mostrar('vista-token', !hayToken);
  mostrar('barra', hayToken);
  if (hayToken) irA('dictar');
  else {
    mostrar('vista-dictar', false);
    mostrar('vista-registros', false);
  }
}

/* ---------- Tema ---------- */

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  $('tema').setAttribute('aria-label', tema === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  // La barra de estado de iOS toma el color del fondo.
  const fondo = getComputedStyle(document.documentElement).getPropertyValue('--fondo').trim();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', fondo);
}

const prefiereOscuro = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;

function temaDelSistema() {
  return prefiereOscuro && prefiereOscuro.matches ? 'oscuro' : 'claro';
}

/* ---------- Modo pruebas ---------- */

function modoPruebas() {
  return leer(CLAVE_PRUEBAS) === '1';
}

function aplicarModoPruebas() {
  $('modo-pruebas').checked = modoPruebas();
  mostrar('pruebas', modoPruebas());
}

function dato(id, valor) {
  $(id).textContent = valor == null ? '—' : valor;
}

/* ---------- Llamada a la API ---------- */

const MENSAJES = {
  token: 'El token no es válido. Vuelve a introducirlo.',
  entrada: 'Petición no válida.',
  groq: 'Falló la transcripción. Inténtalo de nuevo.',
  llm: 'Falló la interpretación. Inténtalo de nuevo.',
  interno: 'Error del servidor. Inténtalo de nuevo.'
};

// Envía { t, accion, ...params } y devuelve la respuesta, o lanza un Error con un mensaje legible.
async function api(accion, params = {}) {
  const token = leer(CLAVE_TOKEN);
  if (!token) {
    pantallaInicial();
    throw new Error('Falta el token.');
  }

  // text/plain evita el preflight de CORS; Apps Script responde con una redirección.
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ t: token, accion, ...params }),
    redirect: 'follow'
  });
  const datos = await res.json();
  if (!datos.ok) {
    if (datos.error === 'token') {
      escribir(CLAVE_TOKEN, null);
      pantallaInicial();
    }
    const err = new Error(datos.mensaje || MENSAJES[datos.error] || 'Error: ' + datos.error);
    err.datos = datos; // por si el llamador necesita más campos (p. ej. prob_sin_voz)
    throw err;
  }
  return datos;
}

/* ---------- Estado y vista previa ---------- */

function estado(mensaje, esError = false) {
  $('estado').textContent = mensaje;
  $('estado').classList.toggle('error', esError);
}

function euros(n) {
  return n == null ? '¿importe?' : n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

function fecha(iso) {
  return iso ? iso.split('-').reverse().join('/') : '—';
}

const FRECUENCIAS = { puntual: 'Puntual', semanal: 'Semanal', mensual: 'Mensual', anual: 'Anual' };

function textoFrecuencia(d) {
  if (!d.frecuencia) return '¿Frecuencia?';
  const partes = [FRECUENCIAS[d.frecuencia] || d.frecuencia];
  if (d.cada_meses) partes.push('cada ' + d.cada_meses + ' meses');
  if (d.dia_de_cobro) partes.push('día ' + d.dia_de_cobro);
  return partes.join(' · ');
}

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto != null) el.textContent = texto;
  return el;
}

// Todo lo que viene del modelo se pinta con textContent (nunca innerHTML): es texto, no código.
function pintarPrevia(v) {
  const d = v.datos || {};
  $('texto').textContent = v.texto || v.frase || '';
  $('concepto').textContent = d.concepto || '¿Concepto?';
  $('importe').textContent = euros(d.importe);

  const chips = [crear('span', 'chip chip-prim', textoFrecuencia(d))];
  if (d.categoria) chips.push(crear('span', 'chip chip-acento', d.categoria));
  chips.push(crear('span', 'chip', (d.frecuencia === 'puntual' ? '' : 'Desde ') + fecha(d.fecha_referencia)));
  if (d.fecha_fin) chips.push(crear('span', 'chip', 'Hasta ' + fecha(d.fecha_fin)));
  $('chips').replaceChildren(...chips);

  const bloques = [
    ['Necesito que me aclares', v.preguntas, 'aviso aviso-pregunta'],
    ['No se puede guardar', v.errores, 'aviso aviso-error'],
    ['He supuesto', v.supuestos, 'aviso'],
    ['Ajustes del sistema', v.avisos, 'aviso']
  ];
  $('avisos').replaceChildren(...bloques.filter((b) => b[1] && b[1].length).map(([titulo, items, clase]) => {
    const div = crear('div', clase);
    const ul = crear('ul');
    items.forEach((t) => ul.appendChild(crear('li', null, t)));
    div.append(crear('b', null, titulo), ul);
    return div;
  }));

  $('guardar').disabled = v.bloqueado;
  mostrar('previa', true);
}

function pintarTiempos(r, inicio) {
  dato('ms-vocabulario', r.ms_vocabulario != null
    ? r.ms_vocabulario + ' ms' + (r.vocabulario ? '' : ' (sin vocabulario)') : null);
  dato('ms-groq', r.ms_groq != null ? r.ms_groq + ' ms' : null);
  dato('ms-interpretar', r.ms_interpretar != null ? r.ms_interpretar + ' ms' : null);
  dato('ms-total', Math.round(performance.now() - inicio) + ' ms');
  dato('prob-sin-voz', r.prob_sin_voz);
}

/* ---------- Nivel de volumen (Web Audio API) ---------- */

// Forma del indicador: más alto en el centro.
const FORMA = [0.35, 0.55, 0.75, 0.9, 1, 0.9, 0.75, 0.55, 0.35];
const barras = Array.from(document.querySelectorAll('#nivel span'));
let audioCtx = null;
let medidor = null; // { fuente, analizador, datos, pico, animacion }

function pintarNivel(nivel) {
  barras.forEach((b, i) => { b.style.height = (6 + Math.round(nivel * FORMA[i] * 22)) + 'px'; });
}

function pintarNivelReposo() {
  barras.forEach((b, i) => { b.style.height = (6 + Math.round(FORMA[i] * 18)) + 'px'; });
}

// Debe llamarse dentro del gesto del usuario (iOS solo deja arrancar el audio así).
function prepararAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function empezarMedidor(stream) {
  if (!audioCtx) return;
  const fuente = audioCtx.createMediaStreamSource(stream);
  const analizador = audioCtx.createAnalyser();
  analizador.fftSize = 1024;
  fuente.connect(analizador);
  medidor = { fuente, analizador, datos: new Uint8Array(analizador.fftSize), pico: 0, animacion: 0 };

  const medir = () => {
    analizador.getByteTimeDomainData(medidor.datos);
    let suma = 0;
    for (const v of medidor.datos) {
      const x = (v - 128) / 128;
      suma += x * x;
    }
    const rms = Math.sqrt(suma / medidor.datos.length);
    medidor.pico = Math.max(medidor.pico, rms);
    pintarNivel(Math.min(1, rms * 6));
    medidor.animacion = requestAnimationFrame(medir);
  };
  medir();
}

// Devuelve el volumen máximo detectado (null si no se pudo medir).
function pararMedidor() {
  if (!medidor) return null;
  cancelAnimationFrame(medidor.animacion);
  medidor.fuente.disconnect();
  const pico = medidor.pico;
  medidor = null;
  pintarNivelReposo();
  return pico;
}

/* ---------- Grabación ---------- */

// Primero audio/mp4 (iOS); si no, audio/webm (Chrome, Firefox).
function elegirMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

function mensajeErrorMicro(err) {
  switch (err.name) {
    case 'NotAllowedError':
      return 'Permiso de micrófono denegado. Actívalo en Ajustes > Safari > Micrófono y vuelve a intentarlo.';
    case 'NotFoundError':
      return 'No se ha encontrado ningún micrófono.';
    case 'NotReadableError':
      return 'El micrófono está ocupado por otra aplicación.';
    default:
      return 'No se pudo acceder al micrófono: ' + err.name;
  }
}

function botonGrabando(grabando) {
  boton.classList.toggle('grabando', grabando);
  boton.setAttribute('aria-label', grabando ? 'Parar' : 'Grabar');
}

async function empezar() {
  mime = elegirMime();
  if (!navigator.mediaDevices || !mime) {
    estado('Este navegador no puede grabar audio.', true);
    return;
  }
  prepararAudio();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    estado(mensajeErrorMicro(err), true);
    return;
  }

  trozos = [];
  grabador = new MediaRecorder(stream, { mimeType: mime });
  grabador.ondataavailable = (e) => { if (e.data.size > 0) trozos.push(e.data); };
  grabador.onstop = () => {
    const pico = pararMedidor();
    stream.getTracks().forEach((t) => t.stop()); // libera el micrófono
    terminarGrabacion(new Blob(trozos, { type: mime }), pico);
  };
  grabador.start();
  empezarMedidor(stream);

  botonGrabando(true);
  estado(corrigiendo ? 'Grabando la corrección…' : 'Te escucho…');
}

function parar() {
  botonGrabando(false);
  grabador.stop();
}

// Si no se oyó nada, no se envía: evita el viaje al servidor y las alucinaciones de Whisper.
function terminarGrabacion(blob, pico) {
  dato('vol-max', pico == null ? null : pico.toFixed(3));
  if (pico != null && pico < UMBRAL_VOZ) {
    estado('No te he oído. Prueba a hablar un poco más cerca.', true);
    return;
  }
  dictar(blob);
}

// Blob → base64 sin el prefijo "data:...;base64,".
function aBase64(blob) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result.split(',')[1]);
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(blob);
  });
}

/* ---------- Acciones ---------- */

async function dictar(blob) {
  const inicio = performance.now();
  boton.disabled = true;
  boton.setAttribute('aria-busy', 'true');
  estado('Interpretando…');
  try {
    const params = { audio: await aBase64(blob), mime };
    // Fuera del modo pruebas se usan los valores por defecto del servidor.
    if (modoPruebas()) {
      params.modelo = $('modelo').value;
      params.vocabulario = $('vocabulario').checked;
    }
    // En una corrección se manda la frase original y la interpretación anterior.
    if (corrigiendo && ultima) {
      let anterior = ultima.interpretacion;
      try { anterior = JSON.parse(anterior); } catch (e) { /* se manda tal cual */ }
      params.corrige = { frase: ultima.frase, anterior };
    }

    const v = await api('dictar', params);
    pintarTiempos(v, inicio);
    ultima = v;
    pintarPrevia(v);

    // Si el modelo tiene preguntas, la próxima grabación será la respuesta.
    corrigiendo = v.preguntas && v.preguntas.length > 0;
    estado(corrigiendo ? 'Responde grabando: ' + v.preguntas[0] : 'Revisa y guarda.');
  } catch (err) {
    dato('ms-total', Math.round(performance.now() - inicio) + ' ms');
    dato('prob-sin-voz', err.datos && err.datos.prob_sin_voz); // en el silencio llega con el error
    estado(err.message, true);
  } finally {
    boton.disabled = false;
    boton.removeAttribute('aria-busy');
  }
}

// Desactiva el botón mientras dura la acción; solo se reactiva si falla (para reintentar).
async function ejecutar(btn, mensajeEspera, fn) {
  btn.disabled = true;
  estado(mensajeEspera);
  try {
    await fn();
  } catch (err) {
    estado(err.message, true);
    btn.disabled = false;
  }
}

/* ---------- Notificación flotante con Deshacer ---------- */

// Una sola para las dos vistas: el servidor solo puede deshacer la última acción.
let temporizador = 0;

function notificar(texto, conDeshacer, esError = false) {
  clearTimeout(temporizador);
  $('notificacion-texto').textContent = texto;
  $('notificacion-texto').classList.toggle('error', esError);
  mostrar('deshacer', conDeshacer);
  $('deshacer').disabled = false;
  mostrar('notificacion', true);
  temporizador = setTimeout(() => mostrar('notificacion', false), conDeshacer ? MS_NOTIFICACION : 3000);
}

/* ---------- Mis registros ---------- */

let registros = null; // última respuesta de "registros": { recurrentes, movimientos, categorias, hoy }
let abierto = null;   // id del registro desplegado (solo uno a la vez)

function estadoRegistros(mensaje, esError = false) {
  $('estado-registros').textContent = mensaje;
  $('estado-registros').classList.toggle('error', esError);
}

async function cargarRegistros() {
  estadoRegistros('Cargando…');
  try {
    registros = await api('registros');
    estadoRegistros('');
    pintarRegistros();
  } catch (err) {
    estadoRegistros(err.message, true);
  }
}

function pintarRegistros() {
  pintarLista('lista-recurrentes', registros.recurrentes, 'Recurrentes', 'No tienes gastos recurrentes activos.');
  pintarLista('lista-movimientos', registros.movimientos, 'Movimientos', 'Todavía no hay gastos puntuales.');
}

function pintarLista(id, items, hoja, textoVacio) {
  $(id).replaceChildren(...(items.length
    ? items.map((r) => tarjetaRegistro(r, hoja))
    : [crear('p', 'vacio', textoVacio)]));
}

function tarjetaRegistro(r, hoja) {
  const esRec = hoja === 'Recurrentes';
  const estaAbierto = abierto === r.id;
  const tarjeta = crear('article', 'registro' + (estaAbierto ? ' abierto' : ''));

  const cabecera = crear('button', 'registro-cabecera');
  cabecera.type = 'button';
  cabecera.setAttribute('aria-expanded', String(estaAbierto));
  const fila = crear('span', 'registro-fila');
  fila.append(crear('span', 'registro-concepto', r.concepto), crear('span', 'registro-importe', euros(r.importe)));

  const meta = crear('span', 'registro-meta');
  if (esRec) meta.append(crear('span', 'chip chip-prim', textoFrecuencia({ frecuencia: r.frecuencia, cada_meses: r.cada_meses })));
  else meta.append(crear('span', 'chip', fecha(r.fecha)));
  if (r.categoria) meta.append(crear('span', 'chip chip-acento', r.categoria));
  if (esRec && r.tipo === 'presupuesto') meta.append(crear('span', 'chip', 'Presupuesto'));
  if (esRec) meta.append(crear('span', 'chip', 'Desde ' + fecha(r.inicio)));
  if (esRec && r.fin) meta.append(crear('span', 'chip', 'Hasta ' + fecha(r.fin)));

  cabecera.append(fila, meta);
  cabecera.addEventListener('click', () => {
    abierto = estaAbierto ? null : r.id;
    pintarRegistros();
  });
  tarjeta.append(cabecera);
  if (estaAbierto) tarjeta.append(editorRegistro(r, hoja));
  return tarjeta;
}

function campo(texto, control) {
  const label = crear('label', 'campo', texto);
  label.append(control);
  return label;
}

function entrada(tipo, valor) {
  const input = document.createElement('input');
  input.type = tipo;
  input.value = valor;
  return input;
}

function opcion(nombre, valor, titulo, ayuda, marcada) {
  const label = crear('label', 'opcion');
  const radio = entrada('radio', valor);
  radio.name = nombre;
  radio.checked = marcada;
  const texto = crear('span', null, titulo);
  texto.append(document.createElement('br'), crear('small', null, ayuda));
  label.append(radio, texto);
  return { label, radio };
}

// Panel de edición de un registro desplegado.
function editorRegistro(r, hoja) {
  const esRec = hoja === 'Recurrentes';
  const editor = crear('div', 'editor');

  const importe = entrada('text', String(r.importe).replace('.', ','));
  importe.inputMode = 'decimal';
  const categoria = document.createElement('select');
  registros.categorias.forEach((c) => {
    const o = crear('option', null, c);
    o.value = c;
    o.selected = c === r.categoria;
    categoria.append(o);
  });
  editor.append(campo('Importe (€)', importe), campo('Categoría', categoria));

  // Recurrentes: un cambio de importe puede ser una corrección o un cambio de precio desde una fecha.
  let esCambioPrecio = () => false;
  let desde = null;
  if (esRec) {
    const grupo = document.createElement('fieldset');
    grupo.append(crear('legend', null, 'Si cambia el importe…'));
    const correccion = opcion('modo-' + r.id, 'correccion', 'Corrección',
      'El importe siempre fue este; cambia también los meses pasados.', true);
    const cambio = opcion('modo-' + r.id, 'cambioPrecio', 'Cambio de precio',
      'Desde una fecha; los meses anteriores se quedan como estaban.', false);
    desde = entrada('date', registros.hoy);
    const campoDesde = campo('Desde', desde);
    campoDesde.classList.add('oculto');
    grupo.addEventListener('change', () => campoDesde.classList.toggle('oculto', !cambio.radio.checked));
    grupo.append(correccion.label, cambio.label, campoDesde);
    editor.append(grupo);
    esCambioPrecio = () => cambio.radio.checked;
  }

  const guardar = crear('button', 'btn-primario', 'Guardar cambios');
  guardar.type = 'button';
  guardar.addEventListener('click', () => ejecutarRegistro(guardar, 'Guardando…', () => {
    const cambios = {};
    const nuevo = Math.round(Number(importe.value.replace(',', '.')) * 100) / 100;
    if (!(nuevo > 0)) throw new Error('Escribe un importe válido.');
    if (nuevo !== r.importe) cambios.importe = nuevo;
    if (categoria.value !== r.categoria) cambios.categoria = categoria.value;
    if (!Object.keys(cambios).length) throw new Error('No hay cambios que guardar.');
    if (cambios.importe != null && esCambioPrecio()) {
      cambios.modo = 'cambioPrecio';
      cambios.desde = desde.value;
    } else {
      cambios.modo = 'correccion';
    }
    return api('editar', { hoja, id: r.id, cambios });
  }));
  editor.append(guardar);

  const acciones = crear('div', 'fila');
  if (esRec) {
    const fechaBaja = entrada('date', registros.hoy);
    editor.append(campo('Fecha de baja', fechaBaja));
    const baja = crear('button', 'btn-borde', 'Dar de baja');
    baja.type = 'button';
    dosToques(baja, () => ejecutarRegistro(baja, 'Dando de baja…',
      () => api('baja', { id: r.id, fecha_fin: fechaBaja.value })));
    acciones.append(baja);
  }
  const eliminar = crear('button', 'btn-peligro', 'Eliminar');
  eliminar.type = 'button';
  dosToques(eliminar, () => ejecutarRegistro(eliminar, 'Eliminando…',
    () => api('eliminar', { hoja, id: r.id })));
  acciones.append(eliminar);
  editor.append(acciones);
  return editor;
}

// Acciones con consecuencias: el primer toque pide confirmación y el segundo la ejecuta.
function dosToques(boton, accion) {
  const texto = boton.textContent;
  let espera = 0;
  const restaurar = () => {
    boton.classList.remove('confirmar');
    boton.textContent = texto;
  };
  boton.addEventListener('click', () => {
    if (boton.classList.contains('confirmar')) {
      clearTimeout(espera);
      restaurar();
      accion();
      return;
    }
    boton.classList.add('confirmar');
    boton.textContent = '¿Seguro? Toca otra vez';
    espera = setTimeout(restaurar, 4000);
  });
}

async function ejecutarRegistro(btn, mensajeEspera, fn) {
  btn.disabled = true;
  estadoRegistros(mensajeEspera);
  try {
    const r = await fn();
    abierto = null;
    estadoRegistros('');
    notificar(r.desc, true);
    await cargarRegistros();
  } catch (err) {
    estadoRegistros(err.message, true);
    btn.disabled = false;
  }
}

/* ---------- Eventos ---------- */

boton.addEventListener('click', () => {
  if (grabador && grabador.state === 'recording') parar();
  else empezar();
});

$('guardar').addEventListener('click', () => ejecutar($('guardar'), 'Guardando…', async () => {
  const r = await api('guardar', { interpretacion: ultima.interpretacion, frase: ultima.frase });
  ultima = null;
  corrigiendo = false;
  mostrar('previa', false);
  estado('Toca y di tu gasto');
  notificar('✓ ' + r.datos.concepto + ' · ' + euros(r.datos.importe) + ' guardado en ' + r.hoja, true);
}));

$('corregir').addEventListener('click', () => {
  corrigiendo = true;
  estado('Graba qué cambio: «no, es anual», «son 12,99»…');
});

$('descartar').addEventListener('click', () => {
  ultima = null;
  corrigiendo = false;
  mostrar('previa', false);
  estado('Descartado. No se ha guardado nada.');
});

$('deshacer').addEventListener('click', async () => {
  clearTimeout(temporizador); // no se oculta mientras se deshace
  $('deshacer').disabled = true;
  $('notificacion-texto').textContent = 'Deshaciendo…';
  try {
    const r = await api('deshacer');
    notificar('↩︎ Deshecho: ' + r.desc, false);
    if (!$('vista-registros').classList.contains('oculto')) await cargarRegistros();
  } catch (err) {
    notificar(err.message, true, true); // se puede reintentar
  }
});

$('form-token').addEventListener('submit', (e) => {
  e.preventDefault();
  const token = $('campo-token').value.trim();
  if (!token) return;
  escribir(CLAVE_TOKEN, token);
  $('campo-token').value = '';
  pantallaInicial();
});

$('borrar-token').addEventListener('click', () => {
  escribir(CLAVE_TOKEN, null);
  pantallaInicial();
});

$('tema').addEventListener('click', () => {
  const nuevo = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
  escribir(CLAVE_TEMA, nuevo); // elegirlo a mano lo fija; si no, se sigue el del iPhone
  aplicarTema(nuevo);
});

if (prefiereOscuro && prefiereOscuro.addEventListener) {
  prefiereOscuro.addEventListener('change', () => {
    if (!leer(CLAVE_TEMA)) aplicarTema(temaDelSistema());
  });
}

$('modo-pruebas').addEventListener('change', (e) => {
  escribir(CLAVE_PRUEBAS, e.target.checked ? '1' : null);
  aplicarModoPruebas();
});

document.querySelectorAll('.barra button').forEach((b) => {
  b.addEventListener('click', () => irA(b.dataset.vista));
});

/* ---------- Inicio ---------- */

aplicarTema(document.documentElement.dataset.tema || temaDelSistema());
aplicarModoPruebas();
pintarNivelReposo();
pantallaInicial();
