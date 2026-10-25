// Fases 7–8: «Crear» (dictar → vista previa → guardar o corregir, y nueva categoría), «Mes» (con pagos) y «Mis registros».

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
  mostrar('vista-registros', vista === 'registros');
  // Siempre datos frescos: la hoja puede haber cambiado. «Mes» vuelve al mes que estabas mirando
  // (memoria solo mientras la app sigue abierta; al abrirla, el mes por defecto).
  if (vista === 'mes') cargarMes(mesDestino);
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
  $('mes-restante').textContent = euros(c.restante);
  $('mes-restante').classList.toggle('negativo', c.restante < 0);

  $('mes-categorias').replaceChildren(...(r.categorias.length
    ? r.categorias.map(tarjetaCategoria)
    : [crear('p', 'vacio', 'Este mes no tiene gastos previstos.')]));

  $('mes-pruebas').textContent = (origen === 'caché' ? 'desde caché' : 'del servidor') + ' · ' + r.ms + ' ms · cuadra ' +
    (r.cuadra ? '✅' : '❌');
  mostrar('mes-pruebas', modoPruebas());
}

function tarjetaCategoria(k) {
  const t = crear('article', 'tarjeta categoria-mes');
  const cab = crear('div', 'categoria-cabecera');
  cab.append(crear('h3', null, k.nombre), crear('span', 'categoria-total', euros(k.total)));
  t.append(cab);

  // Las reglas de presupuesto no son un cargo: se ven como barra, no como línea, y no se marcan.
  k.reglas.filter((g) => g.tipo !== 'presupuesto').forEach((g) => t.append(lineaCargo(g)));
  if (k.presupuesto > 0) t.append(barraPresupuesto(k));
  if (k.movimientos.length) {
    const movs = crear('div', 'movimientos-mes');
    k.movimientos.forEach((m) => movs.append(lineaMes(m.concepto, fechaCorta(m.fecha), m.importe, '')));
    t.append(movs);
  }
  return t;
}

function lineaMes(concepto, cuando, importe, veces, etiqueta = 'div') {
  const linea = crear(etiqueta, 'linea-mes');
  linea.append(crear('span', 'linea-concepto', concepto),
    crear('span', 'linea-fecha', veces ? cuando + ' ' + veces : cuando),
    crear('span', 'linea-importe', euros(importe)));
  return linea;
}

// Cargo fijo con su casilla de «pagado»: toda la línea es la zona de toque (es un <label>).
function lineaCargo(g) {
  const linea = lineaMes(g.concepto, g.fecha_cargo ? fechaCorta(g.fecha_cargo) : 'semanal',
    g.importe, g.veces > 1 ? '× ' + g.veces : '', 'label');
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

$('mes-anterior').addEventListener('click', () => moverMes(-1));
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
