// Fases 6.1–6.2: dictar un gasto → vista previa → guardar (o corregir por voz) → deshacer.

const CLAVE_TOKEN = 'gastos_token';

const $ = (id) => document.getElementById(id);
const boton = $('boton');

let grabador = null;
let trozos = [];
let mime = '';
let ultima = null;      // última propuesta del servidor (para Guardar / Corregir)
let corrigiendo = false; // si es true, la próxima grabación es una corrección

/* ---------- Token ---------- */

function obtenerToken() {
  let token = localStorage.getItem(CLAVE_TOKEN);
  if (!token) {
    token = (prompt('Introduce el token de la API (se guarda solo en este dispositivo):') || '').trim();
    if (token) localStorage.setItem(CLAVE_TOKEN, token);
  }
  return token;
}

/* ---------- Llamada a la API ---------- */

const MENSAJES = {
  token: 'Token incorrecto. Se pedirá de nuevo.',
  entrada: 'Petición no válida.',
  groq: 'Falló la transcripción (Groq).',
  llm: 'Falló la interpretación (Claude).',
  interno: 'Error interno del servidor.'
};

// Envía { t, accion, ...params } y devuelve la respuesta, o lanza un Error con un mensaje legible.
async function api(accion, params = {}) {
  const token = obtenerToken();
  if (!token) throw new Error('Falta el token.');

  // text/plain evita el preflight de CORS; Apps Script responde con una redirección.
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ t: token, accion, ...params }),
    redirect: 'follow'
  });
  const datos = await res.json();
  if (!datos.ok) {
    if (datos.error === 'token') localStorage.removeItem(CLAVE_TOKEN);
    throw new Error(datos.mensaje || MENSAJES[datos.error] || 'Error: ' + datos.error);
  }
  return datos;
}

/* ---------- Interfaz ---------- */

function estado(mensaje, esError = false) {
  $('estado').textContent = mensaje;
  $('estado').className = esError ? 'error' : '';
}

function mostrar(id, visible) {
  $(id).classList.toggle('oculto', !visible);
}

function euros(n) {
  return n == null ? '¿importe?' : n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

function fecha(iso) {
  return iso ? iso.split('-').reverse().join('/') : '—';
}

// Todo lo que viene del modelo se pinta con textContent (nunca innerHTML): es texto, no código.
function pintarPrevia(v) {
  const d = v.datos || {};
  $('texto').textContent = v.texto || v.frase || '';

  const frecuencia = d.frecuencia === 'mensual' && d.cada_meses ? 'cada ' + d.cada_meses + ' meses' : d.frecuencia;
  const filas = [
    ['Concepto', d.concepto || '¿concepto?'],
    ['Importe', euros(d.importe)],
    ['Categoría', d.categoria],
    ['Frecuencia', frecuencia || '¿frecuencia?'],
    [d.frecuencia === 'puntual' ? 'Fecha' : 'Desde', fecha(d.fecha_referencia)],
    ['Hasta', d.fecha_fin && fecha(d.fecha_fin)],
    ['Día de cobro', d.dia_de_cobro],
    ['Se guarda en', v.destino]
  ];
  $('datos').replaceChildren(...filas.filter((f) => f[1]).flatMap(([k, val]) => {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = val;
    return [dt, dd];
  }));

  const listas = [
    ['Necesito que me aclares', v.preguntas],
    ['No se puede guardar', v.errores],
    ['He supuesto', v.supuestos],
    ['Ajustes del sistema', v.avisos]
  ];
  $('listas').replaceChildren(...listas.filter((l) => l[1] && l[1].length).map(([titulo, items]) => {
    const div = document.createElement('div');
    const b = document.createElement('b');
    const ul = document.createElement('ul');
    b.textContent = titulo;
    items.forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    });
    div.append(b, ul);
    return div;
  }));

  $('guardar').disabled = v.bloqueado;
  mostrar('previa', true);
}

function pintarTiempos(r, inicio) {
  $('ms-vocabulario').textContent = r.ms_vocabulario != null
    ? r.ms_vocabulario + ' ms' + (r.vocabulario ? '' : ' (sin vocabulario)') : '—';
  $('ms-groq').textContent = r.ms_groq != null ? r.ms_groq + ' ms' : '—';
  $('ms-interpretar').textContent = r.ms_interpretar != null ? r.ms_interpretar + ' ms' : '—';
  $('ms-total').textContent = Math.round(performance.now() - inicio) + ' ms';
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
      return 'Permiso de micrófono denegado. Actívalo en Ajustes > Safari > Micrófono (o en los ajustes del navegador) y vuelve a intentarlo.';
    case 'NotFoundError':
      return 'No se ha encontrado ningún micrófono.';
    case 'NotReadableError':
      return 'El micrófono está ocupado por otra aplicación.';
    default:
      return 'No se pudo acceder al micrófono: ' + err.name;
  }
}

async function empezar() {
  mime = elegirMime();
  if (!navigator.mediaDevices || !mime) {
    estado('Este navegador no puede grabar audio (sin MediaRecorder compatible).', true);
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
    dictar(new Blob(trozos, { type: mime }));
  };
  grabador.start();

  boton.textContent = 'Parar';
  boton.classList.add('grabando');
  mostrar('resultado', false);
  estado(corrigiendo ? 'Grabando la corrección…' : 'Grabando…');
}

function parar() {
  boton.textContent = 'Grabar';
  boton.classList.remove('grabando');
  boton.disabled = true;
  estado('Interpretando…');
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
  try {
    const params = {
      audio: await aBase64(blob),
      mime,
      modelo: $('modelo').value,
      vocabulario: $('vocabulario').checked
    };
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
    $('ms-total').textContent = Math.round(performance.now() - inicio) + ' ms';
    estado(err.message, true);
  } finally {
    boton.disabled = false;
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

/* ---------- Eventos ---------- */

boton.addEventListener('click', () => {
  if (grabador && grabador.state === 'recording') parar();
  else empezar();
});

$('guardar').addEventListener('click', () => ejecutar($('guardar'), 'Guardando…', async () => {
  const r = await api('guardar', { interpretacion: ultima.interpretacion, frase: ultima.frase });
  $('resultado-texto').textContent =
    '✓ ' + r.datos.concepto + ' (' + euros(r.datos.importe) + ') guardado en ' + r.hoja + ' como ' + r.id;
  ultima = null;
  corrigiendo = false;
  mostrar('previa', false);
  mostrar('resultado', true);
  $('deshacer').disabled = false;
  estado('Guardado.');
}));

$('corregir').addEventListener('click', () => {
  corrigiendo = true;
  estado('Pulsa Grabar y di qué cambio: «no, es anual», «son 12,99»…');
});

$('descartar').addEventListener('click', () => {
  ultima = null;
  corrigiendo = false;
  mostrar('previa', false);
  estado('Descartado. No se ha guardado nada.');
});

$('deshacer').addEventListener('click', () => ejecutar($('deshacer'), 'Deshaciendo…', async () => {
  const r = await api('deshacer');
  $('resultado-texto').textContent = '↩︎ Deshecho: ' + r.desc;
  estado('Deshecho.');
}));

$('borrar-token').addEventListener('click', (e) => {
  e.preventDefault();
  localStorage.removeItem(CLAVE_TOKEN);
  estado('Token borrado. Se pedirá en el próximo envío.');
});

// Pide el token la primera vez que se abre la página.
obtenerToken();
