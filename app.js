// Fase 6.0: grabar audio, enviarlo a Apps Script y mostrar la transcripción con tiempos.

const CLAVE_TOKEN = 'gastos_token';

const $ = (id) => document.getElementById(id);
const boton = $('boton');

let grabador = null;
let trozos = [];
let mime = '';

// Primero audio/mp4 (iOS); si no, audio/webm (Chrome, Firefox).
function elegirMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

function obtenerToken() {
  let token = localStorage.getItem(CLAVE_TOKEN);
  if (!token) {
    token = (prompt('Introduce el token de la API (se guarda solo en este dispositivo):') || '').trim();
    if (token) localStorage.setItem(CLAVE_TOKEN, token);
  }
  return token;
}

function estado(mensaje, esError = false) {
  $('estado').textContent = mensaje;
  $('estado').className = esError ? 'error' : '';
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
    enviar(new Blob(trozos, { type: mime }));
  };
  grabador.start();

  $('mime').textContent = mime;
  boton.textContent = 'Parar';
  boton.classList.add('grabando');
  estado('Grabando…');
}

function parar() {
  boton.textContent = 'Grabar';
  boton.classList.remove('grabando');
  boton.disabled = true;
  estado('Enviando…');
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

async function enviar(blob) {
  const inicio = performance.now();
  try {
    const token = obtenerToken();
    if (!token) {
      estado('Falta el token.', true);
      return;
    }

    const cuerpo = {
      t: token,
      accion: 'transcribir',
      audio: await aBase64(blob),
      mime: mime,
      modelo: $('modelo').value
    };

    // text/plain evita el preflight de CORS; Apps Script responde con una redirección.
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(cuerpo),
      redirect: 'follow'
    });
    const datos = await res.json();
    $('ms-total').textContent = Math.round(performance.now() - inicio) + ' ms';

    if (!datos.ok) {
      if (datos.error === 'token') localStorage.removeItem(CLAVE_TOKEN);
      estado('Error del servidor: ' + datos.error, true);
      return;
    }

    $('texto').textContent = datos.texto || '(vacío)';
    $('ms-groq').textContent = datos.ms_groq + ' ms';
    estado('Hecho (' + datos.modelo + ')');
  } catch (err) {
    $('ms-total').textContent = Math.round(performance.now() - inicio) + ' ms';
    estado('Error de red: ' + err.message, true);
  } finally {
    boton.disabled = false;
  }
}

boton.addEventListener('click', () => {
  if (grabador && grabador.state === 'recording') parar();
  else empezar();
});

$('borrar-token').addEventListener('click', (e) => {
  e.preventDefault();
  localStorage.removeItem(CLAVE_TOKEN);
  estado('Token borrado. Se pedirá en el próximo envío.');
});

// Pide el token la primera vez que se abre la página.
obtenerToken();
