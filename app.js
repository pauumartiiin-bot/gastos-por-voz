// Fases 7–10: «Crear» (dictar → vista previa → guardar o corregir, y nuevo gasto, ingreso o categoría con formulario),
// «Mes» (con pagos) y «Mis registros» (también los ingresos).

const CLAVE_TOKEN = 'gastos_token';
const CLAVE_TEMA = 'gastos_tema';
const CLAVE_PRUEBAS = 'gastos_pruebas';

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
  mostrar('vista-mes', vista === 'mes');
  mostrar('vista-ahorro', vista === 'ahorro');
  mostrar('vista-registros', vista === 'registros');
  // Siempre datos frescos: la hoja puede haber cambiado. «Mes» vuelve al mes que estabas mirando
  // (memoria solo mientras la app sigue abierta; al abrirla, el mes por defecto).
  if (vista === 'mes') cargarMes(mesDestino);
  if (vista === 'ahorro') cargarAhorro();
  if (vista === 'registros') cargarRegistros();
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
    mostrar('vista-mes', false);
    mostrar('vista-ahorro', false);
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
  mostrar('mes-pruebas', modoPruebas() && !!mesDatos);
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
  if (d.veces > 1) partes.push(d.veces + ' veces');   // fase 17
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
  const total = Math.round(performance.now() - inicio);
  dato('ms-vocabulario', r.ms_vocabulario != null
    ? r.ms_vocabulario + ' ms' + (r.vocabulario ? '' : ' (sin vocabulario)') : null);
  dato('ms-groq', r.ms_groq != null ? r.ms_groq + ' ms' : null);
  dato('ms-interpretar', r.ms_interpretar != null ? r.ms_interpretar + ' ms' : null);
  dato('ms-servidor', r.ms_servidor != null ? r.ms_servidor + ' ms' : null);
  // Fase B.1: lo que pasa fuera de doPost (subir el audio, arrancar Apps Script, seguir la redirección).
  dato('ms-red', r.ms_servidor != null ? (total - r.ms_servidor) + ' ms' : null);
  dato('ms-total', total + ' ms');
  dato('prob-sin-voz', r.prob_sin_voz);
}

/* ---------- Indicador de grabación ---------- */

// Las barras se animan mientras graba (CSS); no miden el volumen. El medidor con Web Audio se quitó en la
// 7b.4: en iOS degradaba la grabación y bloqueaba dictados. El silencio lo filtra el servidor (no_speech_prob).
const FORMA = [0.35, 0.55, 0.75, 0.9, 1, 0.9, 0.75, 0.55, 0.35]; // más alto en el centro

function pintarNivelReposo() {
  document.querySelectorAll('#nivel span').forEach((b, i) => { b.style.height = (6 + Math.round(FORMA[i] * 18)) + 'px'; });
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
  $('nivel').classList.toggle('escuchando', grabando);
}

async function empezar() {
  mime = elegirMime();
  if (!navigator.mediaDevices || !mime) {
    estado('Este navegador no puede grabar audio.', true);
    return;
  }

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
    stream.getTracks().forEach((t) => t.stop()); // libera el micrófono
    const blob = new Blob(trozos, { type: mime });
    if (!blob.size) estado('No se ha grabado nada. Inténtalo de nuevo.', true);
    else dictar(blob); // si solo hay silencio, lo rechaza el filtro del servidor
  };
  grabador.start();

  botonGrabando(true);
  estado(corrigiendo ? 'Grabando la corrección…' : 'Te escucho…');
}

function parar() {
  botonGrabando(false);
  grabador.stop();
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
    dato('kb-audio', Math.round(params.audio.length / 1024) + ' KB');   // lo que viaja: el audio en base64
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
    pintarTiempos(err.datos || {}, inicio); // en el silencio llegan prob_sin_voz y ms_servidor con el error
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

/* ---------- Nueva categoría (fase 7b) ---------- */

function estadoCategoria(mensaje, esError = false) {
  $('estado-categoria').textContent = mensaje;
  $('estado-categoria').classList.toggle('error', esError);
}

function textoHuecos(n) {
  if (n <= 0) return 'el Resumen ya está completo';
  return n === 1 ? 'queda 1 hueco' : 'quedan ' + n + ' huecos';
}

async function crearCategoria(e) {
  e.preventDefault();
  const nombre = $('categoria-nombre').value.trim();
  const descripcion = $('categoria-descripcion').value.trim();
  // Aviso rápido antes de enviar; quien decide de verdad es el servidor.
  if (!nombre) return estadoCategoria('Escribe un nombre para la categoría.', true);
  if (descripcion.length < 10) {
    return estadoCategoria('Describe en unas palabras qué gastos entran: así se clasifican bien los dictados.', true);
  }

  const btn = $('crear-categoria');
  btn.disabled = true;
  btn.textContent = 'Creando…';
  estadoCategoria('');
  try {
    const r = await api('categoria', { nombre, descripcion });
    $('form-categoria').reset();
    $('nueva-categoria').open = false;
    notificar('✓ ' + r.desc + ' · ' + textoHuecos(r.huecos_libres), true);
  } catch (err) {
    estadoCategoria(err.message, true); // lo escrito se conserva para corregirlo
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear categoría';
  }
}

/* ---------- Nuevo gasto con formulario (fase 10) ---------- */

// Monta el mismo JSON que devuelve Haiku al dictar y lo guarda con «guardar» de la v1: la validación, el ID
// y el Deshacer son los de siempre. Al validador le da igual quién propone: el modelo o un formulario.

let mesesGasto = [];        // meses de la hoja (con su periodo, fase 13): para dejar un puntual pendiente en su mes

function estadoGasto(mensaje, esError = false) {
  $('estado-gasto').textContent = mensaje;
  $('estado-gasto').classList.toggle('error', esError);
}

// Cada vez que se abre, las categorías de la hoja (puede haber una nueva) y la fecha de hoy.
async function abrirGasto() {
  if (!$('nuevo-gasto').open) return;
  const btn = $('guardar-gasto');
  btn.disabled = true;
  estadoGasto('Cargando…');
  try {
    // Las categorías y la fecha de hoy, de «registros»; los meses, de «ingresos».
    const [r, i] = await Promise.all([api('registros'), api('ingresos')]);
    mesesGasto = i.meses;
    const select = $('gasto-categoria');
    const elegida = select.value;
    const vacia = crear('option', null, 'Elige una categoría');
    vacia.value = '';
    select.replaceChildren(vacia, ...r.categorias.map((c) => {
      const o = crear('option', null, c);
      o.value = c;
      return o;
    }));
    if (r.categorias.includes(elegida)) select.value = elegida;
    if (!$('gasto-fecha').value) $('gasto-fecha').value = r.hoy;
    actualizarGasto();
    estadoGasto('');
    btn.disabled = false;
  } catch (err) {
    estadoGasto(err.message, true);
  }
}

function frecuenciaGasto() {
  return document.querySelector('input[name="gasto-frecuencia"]:checked').value;
}

// Los campos de recurrente solo se ven cuando tocan.
function actualizarGasto() {
  const f = frecuenciaGasto();
  $('gasto-fecha-texto').textContent = f === 'puntual' ? 'Día del gasto' : 'Primer cargo';
  mostrar('campo-gasto-pagado', f === 'puntual');
  mostrar('campo-gasto-cada', f === 'mensual');
  mostrar('campo-gasto-veces', f === 'mensual');
  mostrar('campo-gasto-fin', f !== 'puntual');
}

// «Veces al mes» del 1 al 10 (fase 17): en «+ Nuevo gasto» y en el editor de un recurrente.
function opcionesVeces(select, elegida) {
  select.replaceChildren(...Array.from({ length: 10 }, (_, k) => {
    const o = crear('option', null, k === 0 ? '1 (una vez)' : String(k + 1));
    o.value = String(k + 1);
    o.selected = k + 1 === elegida;
    return o;
  }));
}
opcionesVeces($('gasto-veces'), 1);

async function guardarGasto(e) {
  e.preventDefault();
  const concepto = $('gasto-concepto').value.replace(/\s+/g, ' ').trim();
  const importe = Math.round(Number($('gasto-importe').value.replace(',', '.')) * 100) / 100;
  const categoria = $('gasto-categoria').value;
  const fecha = $('gasto-fecha').value;
  // Aviso rápido antes de enviar; quien decide de verdad es la validación de la v1.
  if (!concepto) return estadoGasto('Escribe el concepto.', true);
  if (!(importe > 0)) return estadoGasto('Escribe un importe válido.', true);
  if (!categoria) return estadoGasto('Elige una categoría.', true);
  if (!fecha) return estadoGasto('Pon la fecha.', true);

  const frecuencia = frecuenciaGasto();
  const recurrente = frecuencia !== 'puntual';
  const interpretacion = {
    concepto, importe, categoria, frecuencia,
    cada_meses: frecuencia === 'mensual' ? Number($('gasto-cada').value) : null,
    tipo: recurrente ? 'fijo' : null,
    fecha_referencia: fecha,
    dia_de_cobro: null, // la v1 usa el día de la fecha
    fecha_fin: recurrente && $('gasto-fin').value ? $('gasto-fin').value : null,
    reemplaza_id: null, supuestos: [], preguntas: []
  };
  // Un puntual sin pagar se guarda y luego se marca pendiente en su mes (fase 11.2).
  const pendiente = frecuencia === 'puntual' && !$('gasto-pagado').checked;
  // Su mes es el del periodo que contiene la fecha (desde la nómina), como en «Mes» (fase 13).
  const mes = pendiente ? mesesGasto.find((m) => m.periodo_inicio <= fecha && fecha <= m.periodo_fin) : null;
  if (pendiente && !mes) return estadoGasto('Ese mes no está en la hoja: no se puede dejar como pendiente.', true);

  // La v1 da prioridad a una categoría nombrada en la frase: aquí solo se nombra la elegida,
  // para que un concepto como «Regalo Aina» no la cambie.
  const frase = '(formulario) categoría ' + categoria;

  const btn = $('guardar-gasto');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  estadoGasto('');
  try {
    const r = await api('guardar', { interpretacion, frase });
    let texto = '✓ ' + r.datos.concepto + ' · ' + euros(r.datos.importe) + ' guardado en ' + r.hoja;
    // Fase 17: varias veces al mes. Sin su propio Deshacer: el de la notificación borra la regla, veces incluidas.
    const veces = frecuencia === 'mensual' ? Number($('gasto-veces').value) : 1;
    if (veces > 1) {
      try {
        await api('veces', { id: r.id, veces, conservar_deshacer: true });
        texto += ' · ' + veces + ' veces al mes';
      } catch (err) {
        texto += ' · no se han podido poner las ' + veces + ' veces: cámbialo en «Mis registros»';
      }
    }
    if (pendiente) {
      try {
        await api('pagar', { etiqueta: mes.etiqueta, id: r.id, pagado: false });
        texto += ' · pendiente de pagar';
      } catch (err) {
        texto += ' · no se ha podido dejar pendiente: desmárcalo en «Mes»';
      }
    }
    $('form-gasto').reset();
    actualizarGasto();
    $('nuevo-gasto').open = false;
    notificar(texto, true);
  } catch (err) {
    estadoGasto(err.message, true); // lo escrito se conserva para corregirlo
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar gasto';
  }
}

/* ---------- Nuevo ingreso (fase 9) ---------- */

let datosIngresos = null;    // respuesta de "ingresos": { hoy, meses: [{ etiqueta, inicio, previsto, nomina }], ingresos }
let importeAuto = true;      // el importe lo puso la app (el previsto de la nómina): puede cambiarlo sola
let mesAMano = false;        // el mes lo eligió la persona: al abrir la tarjeta no se vuelve a proponer

const NOMBRES_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'octubre', 'noviembre', 'diciembre'];

function estadoIngreso(mensaje, esError = false) {
  $('estado-ingreso').textContent = mensaje;
  $('estado-ingreso').classList.toggle('error', esError);
}

// Cada vez que se abre, datos frescos: la nómina de un mes puede haberse apuntado o borrado mientras tanto.
async function abrirIngreso() {
  if (!$('nuevo-ingreso').open) return;
  const btn = $('apuntar-ingreso');
  btn.disabled = true;
  estadoIngreso('Cargando…');
  try {
    datosIngresos = await api('ingresos');
    const select = $('ingreso-mes');
    const elegido = select.value;
    select.replaceChildren(...datosIngresos.meses.map((m) => {
      const o = crear('option', null, m.etiqueta);
      o.value = m.etiqueta;
      return o;
    }));
    if (!$('ingreso-fecha').value) $('ingreso-fecha').value = datosIngresos.hoy;
    if (mesAMano && datosIngresos.meses.some((m) => m.etiqueta === elegido)) select.value = elegido;
    else proponerMes();
    actualizarIngreso();
    estadoIngreso('');
    btn.disabled = false;
  } catch (err) {
    estadoIngreso(err.message, true);
  }
}

// Regla de la Guía de la hoja: si el dinero entra a partir del día 20, va al mes siguiente. Propone; tú decides.
function proponerMes() {
  const f = $('ingreso-fecha').value;
  if (!datosIngresos || !f) return;
  let [a, m, d] = f.split('-').map(Number);
  if (d >= 20) [a, m] = m === 12 ? [a + 1, 1] : [a, m + 1];
  const inicio = a + '-' + String(m).padStart(2, '0') + '-01';
  const mes = datosIngresos.meses.find((x) => x.inicio === inicio);
  if (mes) $('ingreso-mes').value = mes.etiqueta;
  mesAMano = false;
}

function tipoIngreso() {
  return document.querySelector('input[name="ingreso-tipo"]:checked').value;
}

// Importe propuesto, concepto por defecto y aviso, según el tipo, la fecha y el mes elegidos.
function actualizarIngreso() {
  if (!datosIngresos) return;
  const tipo = tipoIngreso();
  const mes = datosIngresos.meses.find((m) => m.etiqueta === $('ingreso-mes').value);
  const importe = $('ingreso-importe');
  // El importe propuesto es el previsto de ese tipo (fase 14: también las comisiones); los extras no tienen previsto.
  const previsto = !mes ? 0 : tipo === 'nómina' ? mes.previsto : tipo === 'comisiones' ? mes.previsto_comisiones : 0;
  if (importeAuto) importe.value = previsto ? String(previsto).replace('.', ',') : '';

  const f = $('ingreso-fecha').value;
  const nombre = tipo.charAt(0).toUpperCase() + tipo.slice(1);
  $('ingreso-concepto').placeholder = f ? nombre + ' ' + NOMBRES_MES[Number(f.slice(5, 7)) - 1] : nombre;

  // Con la regla por tipo (fase 14), unas comisiones sin nómina ya no dejan fuera la nómina prevista: solo queda este aviso.
  const aviso = mes && tipo === 'nómina' && mes.nomina ? 'Este mes ya tiene una nómina apuntada.' : '';
  $('aviso-ingreso').textContent = aviso;
  mostrar('aviso-ingreso', !!aviso);
}

async function apuntarIngreso(e) {
  e.preventDefault();
  const importe = Math.round(Number($('ingreso-importe').value.replace(',', '.')) * 100) / 100;
  const fecha = $('ingreso-fecha').value;
  // Aviso rápido antes de enviar; quien decide de verdad es el servidor.
  if (!(importe > 0)) return estadoIngreso('Escribe un importe válido.', true);
  if (!fecha) return estadoIngreso('Pon el día en que entra.', true);

  const btn = $('apuntar-ingreso');
  btn.disabled = true;
  btn.textContent = 'Apuntando…';
  estadoIngreso('');
  try {
    const r = await api('ingreso', { tipo: tipoIngreso(), importe, fecha, mes: $('ingreso-mes').value,
      concepto: $('ingreso-concepto').value.trim() });
    $('form-ingreso').reset();
    importeAuto = true;
    mesAMano = false;
    $('nuevo-ingreso').open = false;
    // Fase 15: al apuntar la nómina, el restante del mes anterior pasa a este (o el motivo de que no).
    const arrastre = r.arrastre ? ' · ' + conSigno(r.arrastre.importe) + ' del ' + r.arrastre.concepto.toLowerCase()
      : r.motivo_arrastre ? ' · sin arrastre: ' + r.motivo_arrastre : '';
    notificar('✓ ' + r.desc + arrastre, true);
  } catch (err) {
    estadoIngreso(err.message, true); // lo escrito se conserva para corregirlo
  } finally {
    btn.disabled = false;
    btn.textContent = 'Apuntar ingreso';
  }
}

/* ---------- Mes (fase 7), casillas de pagado (8.3) y caché de meses (8.4) ---------- */

let mesDatos = null;    // mes en pantalla (una respuesta de "mes", del servidor o de la caché)
let mesDestino = null;  // mes al que apuntan las flechas: cambia en cada toque, antes de que llegue la respuesta
let esperaMes = 0;      // temporizador de la petición
let peticionMes = 0;    // red de seguridad: si llegan respuestas desordenadas, solo vale la última

// Caché solo en memoria, mientras la app está abierta: un mes ya visto se pinta al instante y, a la vez,
// se pide al servidor; cuando llega, se repinta (enseña lo que tienes mientras compruebas si ha cambiado).
const cacheMes = new Map();   // etiqueta → respuesta de "mes"
const pagosMes = new Map();   // etiqueta → { cambios, enVuelo }: una respuesta pedida antes de marcar no pisa la casilla

// Los toques seguidos se agrupan: la petición sale cuando dejas de tocar. Cada petición reescribe
// Resumen!B1 en el servidor y espera su turno, así que pedir los meses intermedios solo retrasaría el final.
const MS_ESPERA_MES = 300;

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function estadoMes(mensaje, esError = false) {
  $('estado-mes').textContent = mensaje;
  $('estado-mes').classList.toggle('error', esError);
}

// Sin etiqueta, el servidor devuelve el mes por defecto. Si el mes ya está en la caché, se ve al instante.
async function cargarMes(etiqueta) {
  clearTimeout(esperaMes);
  const n = ++peticionMes;
  const guardado = etiqueta ? cacheMes.get(etiqueta) : null;
  if (guardado) mostrarGuardado(guardado);
  else atenuarMes(true);
  const cambios = etiqueta ? pagosDe(etiqueta).cambios : 0;
  try {
    const r = await api('mes', etiqueta ? { etiqueta } : {});
    // Si mientras tanto se marcó una casilla de ese mes, la respuesta puede no traerla: manda la caché.
    const pagos = pagosDe(r.etiqueta);
    const vieja = !!etiqueta && cacheMes.has(r.etiqueta) && (pagos.cambios !== cambios || pagos.enVuelo > 0);
    if (!vieja) cacheMes.set(r.etiqueta, r);
    if (n !== peticionMes) return;
    mesDatos = cacheMes.get(r.etiqueta);
    mesDestino = r.etiqueta;
    estadoMes('');
    pintarMes(vieja ? 'caché' : 'servidor');
  } catch (err) {
    if (n !== peticionMes) return;
    estadoMes((guardado ? 'No se ha podido actualizar: ' : '') + err.message, true);
    // Vuelve al mes que se está viendo: el título no puede quedarse en uno que no ha cargado.
    mesDestino = mesDatos ? mesDatos.etiqueta : null;
    if (mesDatos) pintarTituloMes(mesDatos.etiqueta);
  } finally {
    if (n === peticionMes) {
      atenuarMes(false);
      actualizarNavMes();
    }
  }
}

// Flechas y «Hoy»: el título (o el mes entero, si está en la caché) cambia al instante y la petición
// sale al dejar de tocar.
function irAMes(etiqueta) {
  peticionMes++; // la respuesta que esté en camino ya no es la del mes que quieres ver
  mesDestino = etiqueta;
  const guardado = cacheMes.get(etiqueta);
  if (guardado) mostrarGuardado(guardado);
  else {
    pintarTituloMes(etiqueta);
    actualizarNavMes();
    atenuarMes(true);
  }
  clearTimeout(esperaMes);
  esperaMes = setTimeout(() => cargarMes(etiqueta), MS_ESPERA_MES);
}

function mostrarGuardado(datos) {
  mesDatos = datos;
  pintarMes('caché');
  atenuarMes(false);
  estadoMes('Actualizando…');
}

function pagosDe(etiqueta) {
  if (!pagosMes.has(etiqueta)) pagosMes.set(etiqueta, { cambios: 0, enVuelo: 0 });
  return pagosMes.get(etiqueta);
}

function moverMes(paso) {
  const i = mesDatos.meses.indexOf(mesDestino);
  const destino = mesDatos.meses[i + paso];
  if (destino) irAMes(destino);
}

// Las flechas nunca se bloquean mientras carga; solo en los extremos de la lista de meses.
function actualizarNavMes() {
  const meses = mesDatos ? mesDatos.meses : [];
  const i = meses.indexOf(mesDestino);
  $('mes-anterior').disabled = i <= 0;
  $('mes-siguiente').disabled = i < 0 || i >= meses.length - 1;
  mostrar('mes-hoy', !!mesDatos && mesDestino !== mesDatos.por_defecto);
}

function atenuarMes(activo) {
  if (activo) estadoMes('Cargando…');
  $('mes-cifras').classList.toggle('cargando', activo);
  $('mes-categorias').classList.toggle('cargando', activo);
}

function pintarTituloMes(etiqueta) {
  const [nombre, nomina] = partirEtiqueta(etiqueta);
  $('mes-nombre').textContent = nombre;
  $('mes-nomina').textContent = nomina;
}

// "Noviembre 2026 (nómina de octubre)" → ["Noviembre 2026", "nómina de octubre"]
function partirEtiqueta(etiqueta) {
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(etiqueta);
  return m ? [m[1], m[2]] : [etiqueta, ''];
}

// "2026-11-01" → "1 nov"
function fechaCorta(iso) {
  const [, mes, dia] = iso.split('-');
  return Number(dia) + ' ' + MESES_CORTOS[Number(mes) - 1];
}

function pintarMes(origen) {
  const r = mesDatos;
  const c = r.cabecera;
  pintarTituloMes(r.etiqueta);
  actualizarNavMes();

  $('mes-ingreso').textContent = euros(c.ingreso);
  $('mes-origen').textContent = c.origen;
  $('mes-previsto').textContent = euros(c.total_previsto);
  $('mes-pendiente').textContent = euros(c.pendiente);
  // Fase 16: lo que apartas a ahorro sale de tu mes (o vuelve, si retiras más de lo que apartas). Ya viene restado.
  const ahorro = c.ahorro_mes || 0;
  mostrar('mes-ahorro', ahorro !== 0);
  $('mes-ahorro-texto').textContent = ahorro > 0 ? 'Apartado a ahorro' : 'Sacado del ahorro';
  $('mes-ahorro-importe').textContent = (ahorro > 0 ? '−' : '+') + euros(Math.abs(ahorro));
  $('mes-restante').textContent = euros(c.restante);
  $('mes-restante').classList.toggle('negativo', c.restante < 0);
  pintarReparto(r);

  $('mes-categorias').replaceChildren(...(r.categorias.length
    ? r.categorias.map(tarjetaCategoria)
    : [crear('p', 'vacio', 'Este mes no tiene gastos previstos.')]));

  $('mes-pruebas').textContent = (origen === 'caché' ? 'desde caché' : 'del servidor') + ' · ' + r.ms + ' ms · cuadra ' +
    (r.cuadra ? '✅' : '❌');
  mostrar('mes-pruebas', modoPruebas());
}

/* ---------- Reparto del ingreso y comisiones previstas (fase 14) ---------- */

// Cerrado por defecto: se abre al tocar la cifra de Ingreso. Dentro, cada tipo (lo que cuenta: cobrado si hay, si no,
// previsto) y debajo cada ingreso apuntado (fase 12). La app no calcula: el reparto viene de la hoja (Resumen H2:K4).
const NOMBRES_TIPO = { 'nómina': ['Nómina', 'prevista', 'cobrada'], comisiones: ['Comisiones', 'previstas', 'cobradas'],
  extra: ['Extras', 'previstos', 'cobrados'], arrastre: ['Arrastre', '', ''] };
let repartoAbierto = false;
let editandoPrevisto = null;   // etiqueta del mes cuyo previsto se está cambiando

function pintarReparto(r) {
  const c = r.cabecera;
  $('mes-ingreso').setAttribute('aria-expanded', String(repartoAbierto));
  mostrar('mes-reparto', repartoAbierto && !!c.desglose);
  if (!c.desglose) return;   // backend anterior a la fase 14
  // Mientras se escribe un previsto no se repinta: una actualización de la caché borraría lo escrito.
  if (editandoPrevisto !== r.etiqueta) {
    $('reparto-tipos').replaceChildren(...c.desglose
      .filter((d) => d.tipo !== 'extra' || d.cobrado > 0)      // los extras no tienen previsto: solo si hay
      .filter((d) => d.tipo !== 'arrastre' || d.cobrado !== 0)  // el arrastre (fase 15), solo si hay; puede ser negativo
      .map((d) => d.tipo === 'arrastre' ? lineaArrastre(d, r) : lineaTipo(d, r.etiqueta)));
  }
  $('reparto-lineas').replaceChildren(...(r.ingresos || []).map((i) =>
    lineaMes(i.concepto || i.tipo, i.fecha ? fechaCorta(i.fecha) : '', i.importe, '')));
}

// «Nómina · prevista 1.370 € · cobrada 1.370 € ✓». Las comisiones salen siempre: desde aquí se pone su previsto.
// La nómina y las comisiones llevan «Cambiar previsto» (los extras no tienen previsto).
function lineaTipo(d, etiqueta) {
  const [nombre, prevista, cobrada] = NOMBRES_TIPO[d.tipo] || [d.tipo, 'previsto', 'cobrado'];
  const linea = crear('div', 'reparto-tipo');
  const detalle = [];
  if (d.tipo !== 'extra') detalle.push(prevista + ' ' + euros(d.previsto));
  detalle.push(d.cobrado > 0 ? cobrada + ' ' + euros(d.cobrado) : 'sin cobrar');
  linea.append(crear('span', 'reparto-nombre', nombre),
    crear('span', 'reparto-cuenta', euros(d.cuenta) + (d.cobrado > 0 ? ' ✓' : '')),
    crear('span', 'reparto-detalle', detalle.join(' · ')));
  if (d.tipo === 'nómina' || d.tipo === 'comisiones') {
    const cambiar = crear('button', 'reparto-cambiar', 'Cambiar previsto');
    cambiar.type = 'button';
    cambiar.addEventListener('click', () => linea.append(formPrevisto(d, etiqueta, cambiar)));
    linea.append(cambiar);
  }
  return linea;
}

// Campo de importe con Guardar y Cancelar. 0 quita el previsto. Si el servidor rechaza, el mensaje sale aquí mismo.
// En la nómina, «También los meses siguientes» (una subida de sueldo dura). Un formulario a la vez.
function formPrevisto(d, etiqueta, boton) {
  editandoPrevisto = etiqueta;
  const botones = document.querySelectorAll('.reparto-cambiar');
  botones.forEach((b) => { b.disabled = true; });
  const form = crear('form', 'reparto-editar');
  const campo = crear('input', 'campo-importe');
  campo.inputMode = 'decimal';
  campo.autocomplete = 'off';
  campo.value = d.previsto ? String(d.previsto).replace('.', ',') : '';
  campo.placeholder = '0';
  const nombre = d.tipo === 'nómina' ? 'Nómina prevista' : 'Comisiones previstas';
  campo.setAttribute('aria-label', nombre);
  const guardar = crear('button', 'btn-suave', 'Guardar');
  guardar.type = 'submit';
  const cancelar = crear('button', 'btn-suave', 'Cancelar');
  cancelar.type = 'button';
  const mensaje = crear('p', 'estado error');
  form.append(campo, guardar, cancelar);
  const siguientes = crear('input');
  if (d.tipo === 'nómina') {
    siguientes.type = 'checkbox';
    const etiquetaSiguientes = crear('label', 'reparto-siguientes');
    etiquetaSiguientes.append(siguientes, crear('span', null, 'También los meses siguientes'));
    form.append(etiquetaSiguientes);
  }
  form.append(mensaje);
  const cerrar = () => {
    editandoPrevisto = null;
    form.remove();
    botones.forEach((b) => { b.disabled = false; });
  };
  cancelar.addEventListener('click', cerrar);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = campo.value.trim();
    if (!texto) return (mensaje.textContent = 'Escribe un importe (0 para quitarlo).');
    guardar.disabled = true;
    guardar.textContent = 'Guardando…';
    mensaje.textContent = '';
    // Cuenta como un cambio del mes: una respuesta de «mes» pedida antes ya no vale (como al marcar un pago, 8.4).
    const cambios = pagosDe(etiqueta);
    cambios.cambios++;
    cambios.enVuelo++;
    try {
      const params = { etiqueta, tipo: d.tipo, importe: texto };
      if (siguientes.checked) params.siguientes = true;
      const r = await api('previsto', params);
      cerrar();
      const mes = partirEtiqueta(etiqueta)[0].split(' ')[0].toLowerCase();
      const otros = (r.meses_cambiados || 1) - 1;
      notificar(nombre + ' de ' + mes + ': ' + euros(r.anterior) + ' → ' + euros(r.importe) +
        (otros ? ' (y ' + (otros === 1 ? 'el mes siguiente' : 'los ' + otros + ' meses siguientes') + ')' : ''), false);
      // Los meses siguientes guardados en la caché ya no valen: se vuelven a pedir al visitarlos.
      if (otros && r.mes) r.mes.meses.slice(r.mes.meses.indexOf(etiqueta) + 1).forEach((m) => cacheMes.delete(m));
      ponerMesRecalculado(etiqueta, r.mes);
    } catch (err) {
      mensaje.textContent = err.message;   // lo escrito se conserva para corregirlo
      guardar.disabled = false;
      guardar.textContent = 'Guardar';
    } finally {
      cambios.enVuelo--;
    }
  });
  setTimeout(() => campo.focus(), 0);
  return form;
}

// El mes ya recalculado que trae la respuesta (previsto y arrastre): a la caché y, si es el que se ve, a la pantalla.
function ponerMesRecalculado(etiqueta, mes) {
  if (mes) {
    cacheMes.set(etiqueta, mes);
    if (mesDestino === etiqueta) {
      mesDatos = mes;
      pintarMes('servidor');
    }
  } else if (mesDestino === etiqueta) {
    cargarMes(etiqueta);
  }
}

// «Arrastre · Restante de octubre · +86,00 €» con «Recalcular» (fase 15). El importe lo calcula la hoja, no la app:
// es una foto del restante real del mes anterior al apuntar la nómina; si luego cambia un gasto de ese mes, se recalcula.
function lineaArrastre(d, r) {
  const fila = (r.ingresos || []).filter((i) => i.tipo === 'arrastre')[0];
  const linea = crear('div', 'reparto-tipo');
  linea.append(crear('span', 'reparto-nombre', 'Arrastre'),
    crear('span', 'reparto-cuenta' + (d.cuenta < 0 ? ' negativo' : ''), conSigno(d.cuenta)),
    crear('span', 'reparto-detalle', fila ? fila.concepto : 'del mes anterior'));
  const boton = crear('button', 'reparto-cambiar', 'Recalcular');
  boton.type = 'button';
  const mensaje = crear('p', 'estado error reparto-mensaje');
  boton.addEventListener('click', async () => {
    boton.disabled = true;
    boton.textContent = 'Recalculando…';
    mensaje.textContent = '';
    const cambios = pagosDe(r.etiqueta);   // cuenta como un cambio del mes, como guardar un previsto
    cambios.cambios++;
    cambios.enVuelo++;
    try {
      const x = await api('arrastre', { etiqueta: r.etiqueta });
      notificar(x.concepto + ': ' + (x.anterior === x.importe ? euros(x.importe) + ' (sin cambios)'
        : conSigno(x.anterior) + ' → ' + conSigno(x.importe)), false);
      ponerMesRecalculado(r.etiqueta, x.mes);
    } catch (err) {
      mensaje.textContent = err.message;
      boton.disabled = false;
      boton.textContent = 'Recalcular';
    } finally {
      cambios.enVuelo--;
    }
  });
  linea.append(boton, mensaje);
  return linea;
}

// 86 → «+86,00 €»; −50 → «-50,00 €» (el arrastre puede ser de los dos signos).
function conSigno(n) {
  return (n > 0 ? '+' : '') + euros(n);
}

function alternarReparto() {
  repartoAbierto = !repartoAbierto;
  if (mesDatos) pintarReparto(mesDatos);
}

// Fase 17: una regla con varias veces en el mes llega como una línea por vez («1.ª vez», «2.ª semana»), cada una con su
// casilla y el importe de una vez. Las de una sola vez no llevan nada (o «× N» si viniera de un backend anterior).
function textoVez(g) {
  if (g.vez) return g.vez + '.ª ' + (g.frecuencia === 'semanal' ? 'semana' : 'vez');
  return g.veces > 1 ? '× ' + g.veces : '';
}

function tarjetaCategoria(k) {
  const t = crear('article', 'tarjeta categoria-mes');
  const cab = crear('div', 'categoria-cabecera');
  cab.append(crear('h3', null, k.nombre), crear('span', 'categoria-total', euros(k.total)));
  t.append(cab);

  // Las reglas de presupuesto no son un cargo: se ven como barra, no como línea, y no se marcan.
  k.reglas.filter((g) => g.tipo !== 'presupuesto').forEach((g) => t.append(
    lineaPagable(g, g.fecha_cargo ? fechaCorta(g.fecha_cargo) : (g.vez ? '' : 'semanal'), textoVez(g))));
  if (k.presupuesto > 0) t.append(barraPresupuesto(k));
  if (k.movimientos.length) {
    const movs = crear('div', 'movimientos-mes');
    k.movimientos.forEach((m) => movs.append(lineaPagable(m, fechaCorta(m.fecha), '')));
    t.append(movs);
  }
  return t;
}

function lineaMes(concepto, cuando, importe, veces, etiqueta = 'div') {
  const linea = crear(etiqueta, 'linea-mes');
  linea.append(crear('span', 'linea-concepto', concepto),
    crear('span', 'linea-fecha', [cuando, veces].filter((x) => x).join(' ')),
    crear('span', 'linea-importe', euros(importe)));
  return linea;
}

// Cargo fijo o gasto puntual (fase 11.2) con su casilla de «pagado»: toda la línea es la zona de toque (un <label>).
function lineaPagable(g, cuando, veces) {
  const linea = lineaMes(g.concepto, cuando, g.importe, veces, 'label');
  linea.classList.add('linea-cargo');
  linea.classList.toggle('pagada', g.pagado);
  linea.dataset.id = g.id;
  const casilla = crear('input');
  casilla.type = 'checkbox';
  casilla.checked = g.pagado;
  casilla.disabled = !!g.guardando;
  const datos = mesDatos;
  casilla.addEventListener('change', () => marcarPago(datos, g, casilla.checked));
  linea.prepend(casilla);
  return linea;
}

// Marcado optimista: la casilla y el pendiente cambian al instante; si el servidor falla, vuelven atrás.
// Se cambian los datos del mes (los de la caché) y desde ellos la pantalla, que puede haberse repintado.
async function marcarPago(datos, g, pagado) {
  const pagos = pagosDe(datos.etiqueta);
  pagos.cambios++;
  pagos.enVuelo++;
  g.guardando = true; // una petición por casilla: dos toques rápidos podrían llegar desordenados
  aplicarPago(datos, g, pagado);
  try {
    await api('pagar', { etiqueta: datos.etiqueta, id: g.id, pagado });
  } catch (err) {
    aplicarPago(datos, g, !pagado);
    notificar('No se ha podido marcar «' + g.concepto + '»: ' + err.message, false, true);
  } finally {
    g.guardando = false;
    pagos.cambios++;
    pagos.enVuelo--;
    pintarCasilla(datos, g);
  }
}

function aplicarPago(datos, g, pagado) {
  g.pagado = pagado;
  const c = datos.cabecera;
  c.pendiente = Math.round((c.pendiente + (pagado ? -g.importe : g.importe)) * 100) / 100;
  pintarCasilla(datos, g);
}

// La línea se busca cada vez: si el mes se ha repintado, la de antes ya no está en pantalla.
function pintarCasilla(datos, g) {
  if (datos !== mesDatos) return; // ya estás en otro mes: sus datos cambian, la pantalla no
  $('mes-pendiente').textContent = euros(datos.cabecera.pendiente);
  const linea = document.querySelector('.linea-cargo[data-id="' + CSS.escape(g.id) + '"]');
  if (!linea) return;
  linea.classList.toggle('pagada', g.pagado);
  const casilla = linea.querySelector('input');
  casilla.checked = g.pagado;
  casilla.disabled = !!g.guardando;
}

function barraPresupuesto(k) {
  const caja = crear('div', 'presupuesto');
  const pasado = k.puntuales > k.presupuesto;
  caja.classList.toggle('pasado', pasado);

  const barra = crear('div', 'presupuesto-barra');
  barra.setAttribute('role', 'progressbar');
  barra.setAttribute('aria-valuemin', '0');
  barra.setAttribute('aria-valuemax', String(k.presupuesto));
  barra.setAttribute('aria-valuenow', String(k.puntuales));
  const relleno = crear('span');
  relleno.style.width = Math.min(100, (k.puntuales / k.presupuesto) * 100) + '%';
  barra.append(relleno);

  const gastado = k.puntuales.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const exceso = Math.round((k.puntuales - k.presupuesto) * 100) / 100;
  caja.append(barra, crear('p', 'presupuesto-texto', gastado + ' de ' + euros(k.presupuesto) + ' · ' +
    (pasado ? 'te has pasado ' + euros(exceso) : 'quedan ' + euros(k.disponible))));
  return caja;
}

/* ---------- Ahorro (fase 16) ---------- */

// La cuenta es conjunta: lo mío sale de mi mes (Resumen E8) y lo de la pareja solo suma al total. La app no calcula:
// totales, progreso y cuota al mes vienen de la hoja (pestaña Objetivos, H1:I10).
let datosAhorro = null;     // respuesta de "ahorros"
let editandoObjetivo = false;

function estadoAhorro(id, mensaje, esError = false) {
  $(id).textContent = mensaje;
  $(id).classList.toggle('error', esError);
}

async function cargarAhorro() {
  if (!datosAhorro) estadoAhorro('estado-ahorro', 'Cargando…');
  try {
    datosAhorro = await api('ahorros');
    estadoAhorro('estado-ahorro', '');
    pintarAhorro();
  } catch (err) {
    estadoAhorro('estado-ahorro', err.message, true);
  }
}

// Respuesta de ahorro, borrar_ahorro u objetivo: trae los totales ya recalculados y, si cambia, el mes afectado,
// que se quita de la caché de «Mes» para que no se vea con el restante de antes.
function aplicarAhorro(r) {
  if (r.mes) cacheMes.delete(r.mes);
  if (r.ahorros) {
    datosAhorro = r.ahorros;
    pintarAhorro();
  }
}

function pintarAhorro() {
  const a = datosAhorro;
  $('ahorro-total').textContent = euros(a.total);
  $('ahorro-inicial').textContent = euros(a.inicial);
  $('ahorro-yo').textContent = euros(a.yo);
  $('ahorro-pareja').textContent = euros(a.pareja);
  if (!editandoObjetivo) pintarObjetivo();
  mostrar('saldo-inicial', !a.hay_inicial);
  $('lista-ahorros').replaceChildren(...(a.movimientos.length
    ? a.movimientos.map(tarjetaAhorro)
    : [crear('p', 'vacio', 'Todavía no hay movimientos de ahorro.')]));
  explicarAhorro();
}

// Tarjeta del objetivo activo: nombre, barra, porcentaje, lo que falta y, con fecha, cuánto al mes hasta entonces.
function pintarObjetivo() {
  const o = datosAhorro.objetivo;
  const t = $('ahorro-objetivo');
  const boton = crear('button', 'reparto-cambiar', o ? 'Cambiar objetivo' : 'Crear objetivo');
  boton.type = 'button';
  boton.addEventListener('click', () => formObjetivo(o));
  if (!o) {
    t.replaceChildren(crear('h3', null, 'Ponte un objetivo'),
      crear('p', 'ahorro-explica', 'Un nombre, un importe y, si quieres, una fecha: verás cuánto te falta y cuánto ahorrar al mes.'), boton);
    return;
  }
  const cab = crear('div', 'categoria-cabecera');
  cab.append(crear('h3', null, o.nombre), crear('span', 'categoria-total', euros(o.importe)));
  const progreso = o.progreso || 0;
  const barra = crear('div', 'presupuesto-barra');
  barra.setAttribute('role', 'progressbar');
  barra.setAttribute('aria-valuemin', '0');
  barra.setAttribute('aria-valuemax', '100');
  barra.setAttribute('aria-valuenow', String(Math.min(100, progreso)));
  const relleno = crear('span');
  relleno.style.width = Math.min(100, progreso) + '%';
  barra.append(relleno);
  const lineas = [progreso.toLocaleString('es-ES') + ' % · ' + (o.falta > 0 ? 'faltan ' + euros(o.falta) : '¡conseguido!')];
  if (o.fecha && o.falta > 0) {
    lineas.push(o.al_mes != null ? euros(o.al_mes) + '/mes hasta el ' + fecha(o.fecha) : 'La fecha (' + fecha(o.fecha) + ') ya ha pasado');
  }
  const caja = crear('div', 'presupuesto');
  caja.append(barra, ...lineas.map((l) => crear('p', 'presupuesto-texto', l)));
  t.replaceChildren(cab, caja, boton);
}

// Crear o cambiar el objetivo. Sin Deshacer (como los previstos): la notificación dice el antes y el después.
function formObjetivo(o) {
  editandoObjetivo = true;
  const form = crear('form', 'form-categoria');
  form.noValidate = true;
  const nombre = entrada('text', o ? o.nombre : '');
  nombre.maxLength = 40;
  nombre.autocomplete = 'off';
  const importe = entrada('text', o ? String(o.importe).replace('.', ',') : '');
  importe.inputMode = 'decimal';
  importe.autocomplete = 'off';
  const fechaObj = entrada('date', o && o.fecha ? o.fecha : '');
  const mensaje = crear('p', 'estado error reparto-mensaje');
  const guardar = crear('button', 'btn-primario', 'Guardar objetivo');
  guardar.type = 'submit';
  const cancelar = crear('button', 'btn-suave', 'Cancelar');
  cancelar.type = 'button';
  const botones = crear('div', 'objetivo-botones');
  botones.append(cancelar, guardar);
  form.append(crear('h3', null, o ? 'Cambiar objetivo' : 'Nuevo objetivo'), campo('Nombre', nombre), campo('Importe (€)', importe),
    campo('Fecha (opcional)', fechaObj), mensaje, botones);
  const cerrar = () => {
    editandoObjetivo = false;
    pintarObjetivo();
  };
  cancelar.addEventListener('click', cerrar);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!nombre.value.trim()) return (mensaje.textContent = 'Ponle un nombre al objetivo.');
    if (!importe.value.trim()) return (mensaje.textContent = 'Pon un importe.');
    guardar.disabled = true;
    guardar.textContent = 'Guardando…';
    mensaje.textContent = '';
    try {
      const r = await api('objetivo', { nombre: nombre.value.trim(), importe: importe.value.trim(), fecha: fechaObj.value || null });
      const texto = (x) => '«' + x.nombre + '» ' + euros(x.importe) + (x.fecha ? ' (' + fecha(x.fecha) + ')' : '');
      notificar(r.anterior ? 'Objetivo: ' + texto(r.anterior) + ' → ' + texto(r.objetivo) : 'Objetivo creado: ' + texto(r.objetivo), false);
      editandoObjetivo = false;
      aplicarAhorro(r);
    } catch (err) {
      mensaje.textContent = err.message;   // lo escrito se conserva para corregirlo
      guardar.disabled = false;
      guardar.textContent = 'Guardar objetivo';
    }
  });
  $('ahorro-objetivo').replaceChildren(form);
  setTimeout(() => nombre.focus(), 0);
}

function valorRadio(nombre) {
  return document.querySelector('input[name="' + nombre + '"]:checked').value;
}

// Debajo de «Quién»: qué le pasa a tu mes con este movimiento.
function explicarAhorro() {
  const tipo = valorRadio('ahorro-tipo');
  const quien = valorRadio('ahorro-quien');
  $('ahorro-explica').textContent = quien === 'pareja'
    ? 'Lo de tu pareja no toca tu mes: solo cambia el total ahorrado.'
    : tipo === 'aportación' ? 'Sale de tu mes: baja el restante y no pasa al mes siguiente.'
      : 'Vuelve a tu mes: sube el restante.';
}

function abrirMovimiento() {
  if (!$('nuevo-movimiento').open) return;
  if (!$('ahorro-fecha').value && datosAhorro) $('ahorro-fecha').value = datosAhorro.hoy;
  estadoAhorro('estado-movimiento', '');
}

async function apuntarMovimiento(e) {
  e.preventDefault();
  const importe = Math.round(Number($('ahorro-importe').value.replace(',', '.')) * 100) / 100;
  if (!(importe > 0)) return estadoAhorro('estado-movimiento', 'Escribe un importe válido.', true);
  if (!$('ahorro-fecha').value) return estadoAhorro('estado-movimiento', 'Pon la fecha.', true);
  const btn = $('apuntar-ahorro');
  btn.disabled = true;
  btn.textContent = 'Apuntando…';
  estadoAhorro('estado-movimiento', '');
  try {
    const r = await api('ahorro', { tipo: valorRadio('ahorro-tipo'), quien: valorRadio('ahorro-quien'), importe,
      fecha: $('ahorro-fecha').value, concepto: $('ahorro-concepto').value.trim() });
    $('form-ahorro').reset();
    $('nuevo-movimiento').open = false;
    notificar('✓ ' + r.desc + (r.mes ? ' · cuenta en ' + partirEtiqueta(r.mes)[0] : ''), true);
    aplicarAhorro(r);
  } catch (err) {
    estadoAhorro('estado-movimiento', err.message, true);   // lo escrito se conserva para corregirlo
  } finally {
    btn.disabled = false;
    btn.textContent = 'Apuntar';
  }
}

async function apuntarInicial(e) {
  e.preventDefault();
  const importe = Math.round(Number($('inicial-importe').value.replace(',', '.')) * 100) / 100;
  if (!(importe > 0)) return estadoAhorro('estado-inicial', 'Escribe un importe válido.', true);
  const btn = $('apuntar-inicial');
  btn.disabled = true;
  estadoAhorro('estado-inicial', '');
  try {
    const r = await api('ahorro', { tipo: 'inicial', importe, fecha: datosAhorro ? datosAhorro.hoy : '' });
    $('form-inicial').reset();
    $('saldo-inicial').open = false;
    notificar('✓ ' + r.desc, true);
    aplicarAhorro(r);
  } catch (err) {
    estadoAhorro('estado-inicial', err.message, true);
  } finally {
    btn.disabled = false;
  }
}

const NOMBRES_AHORRO = { inicial: 'Saldo inicial', 'aportación': 'Aportación', retirada: 'Retirada' };

// Movimiento de ahorro: la retirada se ve en negativo. Para corregirlo, se borra y se vuelve a apuntar.
function tarjetaAhorro(m) {
  const chips = [crear('span', 'chip', fecha(m.fecha)), crear('span', 'chip chip-prim', NOMBRES_AHORRO[m.tipo] || m.tipo)];
  if (m.quien) chips.push(crear('span', 'chip chip-acento', m.quien === 'yo' ? 'Tú' : 'Pareja'));
  return tarjetaLista(m.id, m.concepto, m.tipo === 'retirada' ? -m.importe : m.importe, chips, () => {
    const editor = crear('div', 'editor');
    const eliminar = crear('button', 'btn-peligro', 'Eliminar');
    eliminar.type = 'button';
    dosToques(eliminar, async () => {
      eliminar.disabled = true;
      estadoAhorro('estado-ahorro', 'Eliminando…');
      try {
        const r = await api('borrar_ahorro', { id: m.id });
        abierto = null;
        estadoAhorro('estado-ahorro', '');
        notificar(r.desc, true);
        aplicarAhorro(r);
      } catch (err) {
        estadoAhorro('estado-ahorro', err.message, true);
        eliminar.disabled = false;
      }
    });
    editor.append(crear('p', 'aviso', 'Para corregirlo, elimínalo y vuelve a apuntarlo.'), eliminar);
    return editor;
  }, pintarAhorro);
}

/* ---------- Mis registros ---------- */

let registros = null; // "registros" ({ recurrentes, movimientos, categorias, hoy }) + los ingresos de "ingresos"
let abierto = null;   // id del registro desplegado (solo uno a la vez)

function estadoRegistros(mensaje, esError = false) {
  $('estado-registros').textContent = mensaje;
  $('estado-registros').classList.toggle('error', esError);
}

async function cargarRegistros() {
  estadoRegistros('Cargando…');
  try {
    const [r, i] = await Promise.all([api('registros'), api('ingresos')]);
    registros = Object.assign(r, { ingresos: i.ingresos });
    estadoRegistros('');
    pintarRegistros();
  } catch (err) {
    estadoRegistros(err.message, true);
  }
}

function pintarRegistros() {
  pintarLista('lista-recurrentes', registros.recurrentes, 'Recurrentes', 'No tienes gastos recurrentes activos.');
  pintarLista('lista-movimientos', registros.movimientos, 'Movimientos', 'Todavía no hay gastos puntuales.');
  $('lista-ingresos').replaceChildren(...(registros.ingresos.length
    ? registros.ingresos.map(tarjetaIngreso)
    : [crear('p', 'vacio', 'Todavía no hay ingresos apuntados.')]));
}

function pintarLista(id, items, hoja, textoVacio) {
  $(id).replaceChildren(...(items.length
    ? items.map((r) => tarjetaRegistro(r, hoja))
    : [crear('p', 'vacio', textoVacio)]));
}

function tarjetaRegistro(r, hoja) {
  const esRec = hoja === 'Recurrentes';
  const chips = [];
  if (esRec) chips.push(crear('span', 'chip chip-prim', textoFrecuencia({ frecuencia: r.frecuencia, cada_meses: r.cada_meses, veces: r.veces })));
  else chips.push(crear('span', 'chip', fecha(r.fecha)));
  if (r.categoria) chips.push(crear('span', 'chip chip-acento', r.categoria));
  if (esRec && r.tipo === 'presupuesto') chips.push(crear('span', 'chip', 'Presupuesto'));
  if (esRec) chips.push(crear('span', 'chip', 'Desde ' + fecha(r.inicio)));
  if (esRec && r.fin) chips.push(crear('span', 'chip', 'Hasta ' + fecha(r.fin)));
  return tarjetaLista(r.id, r.concepto, r.importe, chips, () => editorRegistro(r, hoja));
}

// Ingreso (fase 9): se ve con su tipo y el mes al que va; para corregirlo, se borra y se vuelve a apuntar.
function tarjetaIngreso(i) {
  const chips = [crear('span', 'chip', fecha(i.fecha)), crear('span', 'chip chip-prim', i.tipo),
    crear('span', 'chip chip-acento', partirEtiqueta(i.mes)[0])];
  return tarjetaLista(i.id, i.concepto, i.importe, chips, () => {
    const editor = crear('div', 'editor');
    const eliminar = crear('button', 'btn-peligro', 'Eliminar');
    eliminar.type = 'button';
    dosToques(eliminar, () => ejecutarRegistro(eliminar, 'Eliminando…', () => api('borrar_ingreso', { id: i.id })));
    editor.append(crear('p', 'aviso', 'Para corregirlo, elimínalo y vuelve a apuntarlo en «Crear».'), eliminar);
    return editor;
  });
}

// Tarjeta de una lista: la cabecera (concepto, importe y chips) despliega su editor. Solo una abierta a la vez.
function tarjetaLista(id, concepto, importe, chips, crearEditor, repintar = pintarRegistros) {
  const estaAbierto = abierto === id;
  const tarjeta = crear('article', 'registro' + (estaAbierto ? ' abierto' : ''));

  const cabecera = crear('button', 'registro-cabecera');
  cabecera.type = 'button';
  cabecera.setAttribute('aria-expanded', String(estaAbierto));
  const fila = crear('span', 'registro-fila');
  fila.append(crear('span', 'registro-concepto', concepto), crear('span', 'registro-importe', euros(importe)));
  const meta = crear('span', 'registro-meta');
  meta.append(...chips);

  cabecera.append(fila, meta);
  cabecera.addEventListener('click', () => {
    abierto = estaAbierto ? null : id;
    repintar();
  });
  tarjeta.append(cabecera);
  if (estaAbierto) tarjeta.append(crearEditor());
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

  // Nombre, con su propio botón: así cada cambio tiene su Deshacer (el servidor solo guarda el último).
  const nombre = entrada('text', r.concepto);
  nombre.maxLength = 60;
  nombre.autocapitalize = 'sentences';
  const renombrar = crear('button', 'btn-suave', 'Cambiar nombre');
  renombrar.type = 'button';
  renombrar.addEventListener('click', () => ejecutarRegistro(renombrar, 'Cambiando el nombre…', () => {
    const concepto = nombre.value.trim();
    if (!concepto) throw new Error('Escribe el nombre nuevo.');
    if (concepto === r.concepto) throw new Error('Es el mismo nombre que ya tiene.');
    return api('renombrar', { hoja, id: r.id, concepto });
  }));
  editor.append(campo('Nombre', nombre), renombrar, crear('hr', 'separador'));

  // Fase 17: veces al mes de un mensual (no presupuesto), con su botón y su Deshacer. Afecta a todos los meses: la caché fuera.
  if (esRec && r.veces != null) {
    const veces = document.createElement('select');
    opcionesVeces(veces, r.veces);
    const cambiarVeces = crear('button', 'btn-suave', 'Cambiar');
    cambiarVeces.type = 'button';
    cambiarVeces.addEventListener('click', () => ejecutarRegistro(cambiarVeces, 'Cambiando las veces…', async () => {
      const n = Number(veces.value);
      if (n === r.veces) throw new Error('Ya se cobra ' + n + (n === 1 ? ' vez' : ' veces') + ' al mes.');
      const x = await api('veces', { id: r.id, veces: n });
      cacheMes.clear();
      return x;
    }));
    const fila = crear('div', 'fila-veces');
    fila.append(campo('Veces al mes', veces), cambiarVeces);
    editor.append(fila, crear('small', 'ayuda-veces', 'El importe es el de cada vez: en «Mes», cada vez lleva su casilla.'),
      crear('hr', 'separador'));
  }

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
    if (!$('vista-mes').classList.contains('oculto')) await cargarMes(mesDatos && mesDatos.etiqueta);
    if (!$('vista-ahorro').classList.contains('oculto')) await cargarAhorro();
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

$('form-categoria').addEventListener('submit', crearCategoria);

$('nuevo-gasto').addEventListener('toggle', abrirGasto);
$('form-gasto').addEventListener('submit', guardarGasto);
$('form-gasto').addEventListener('change', actualizarGasto);

$('nuevo-ingreso').addEventListener('toggle', abrirIngreso);
$('nuevo-movimiento').addEventListener('toggle', abrirMovimiento);
$('form-ahorro').addEventListener('submit', apuntarMovimiento);
$('form-inicial').addEventListener('submit', apuntarInicial);
document.querySelectorAll('input[name="ahorro-tipo"], input[name="ahorro-quien"]').forEach((r) => r.addEventListener('change', explicarAhorro));
$('form-ingreso').addEventListener('submit', apuntarIngreso);
$('form-ingreso').addEventListener('change', (e) => {
  if (e.target.id === 'ingreso-fecha') proponerMes();
  if (e.target.id === 'ingreso-mes') mesAMano = true;
  actualizarIngreso();
});
$('ingreso-importe').addEventListener('input', () => { importeAuto = $('ingreso-importe').value === ''; });

$('mes-anterior').addEventListener('click', () => moverMes(-1));
$('mes-ingreso').addEventListener('click', alternarReparto);
$('mes-siguiente').addEventListener('click', () => moverMes(1));
$('mes-hoy').addEventListener('click', () => irAMes(mesDatos.por_defecto));

document.querySelectorAll('.barra button').forEach((b) => {
  b.addEventListener('click', () => irA(b.dataset.vista));
});

/* ---------- Inicio ---------- */

aplicarTema(document.documentElement.dataset.tema || temaDelSistema());
aplicarModoPruebas();
pintarNivelReposo();
pantallaInicial();
