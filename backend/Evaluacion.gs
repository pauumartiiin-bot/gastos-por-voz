/**
 * Evaluacion.gs — Fase 6.4: evaluación con audios reales.
 * Archivo nuevo. Se ejecuta a mano desde el editor; no forma parte de la API.
 *
 * Cada audio pasa por 6 configuraciones (2 modelos × 3 vocabularios) y por el mismo camino que un
 * dictado: Whisper → Haiku → validación. No guarda gastos: una fila por audio y configuración en
 * la pestaña "Evaluación" y el resumen en "Evaluación resumen".
 *
 * Preparación:
 *  1. Graba los audios con Notas de voz, renómbralos 01…30 y súbelos a una carpeta de Drive.
 *  2. Propiedad del script CARPETA_EVALUACION = ID de la carpeta (lo que va tras /folders/ en su enlace).
 *  3. Ejecuta evaluarAudios(). Si se acaba el tiempo, vuelve a ejecutarla: sigue donde lo dejó.
 *     Para empezar de cero, borrarEvaluacion().
 */

const EVAL_HOJA_ = 'Evaluación';
const EVAL_HOJA_RESUMEN_ = 'Evaluación resumen';
const EVAL_MAX_MS_ = 5 * 60 * 1000;   // Apps Script corta a los 6 minutos
const EVAL_MODELOS_ = ['whisper-large-v3', 'whisper-large-v3-turbo'];
const EVAL_VOCABULARIOS_ = ['ninguno', 'completo', 'propios'];
const EVAL_COLUMNAS_ = ['Ejecutado', 'Audio', 'Grupo', 'Modelo', 'Vocabulario', 'Transcripción',
  'Prob. sin voz', 'Marca en el texto', 'Resultado', 'Fallos', 'Concepto', 'Importe', 'Categoría',
  'Frecuencia', 'Fecha', 'ms_groq', 'ms_interpretar'];
const EVAL_GRUPOS_ = { A: 'fáciles', B: 'números', C: 'marcas', D: 'fechas', E: 'ambiguas', F: 'silencio', G: 'reales' };

// Hipótesis de la 6.2: un vocabulario corto, solo con nombres propios, ayuda con las marcas sin que
// large-v3 se coma palabras. Decathlon (audio 17) queda fuera a propósito: es la marca de control.
const EVAL_NOMBRES_PROPIOS_ = ['Spotify', 'Netflix', 'Mercadona', 'Amazon', 'Claude', 'ChatGPT',
  'Movistar', 'Vinted', 'Glovo', 'Wallapop', 'Klarna', 'T-jove'];

// Contexto controlado, como evaluarCerebro de la v1: el resultado no depende de las reglas reales.
const EVAL_REGLAS_ = [
  { id: 'R005', concepto: 'Claude', importe: 22, frecuencia: 'mensual', categoria: 'Suscripciones' },
  { id: 'R900', concepto: 'Movistar', importe: 35, frecuencia: 'mensual', categoria: 'Suscripciones' }
];

/**
 * Casos: n (nombre del audio), grupo, lo que se dice, marca (palabra que debe aparecer en la
 * transcripción y en el concepto) y lo esperado. Las fechas se calculan desde hoy (fechasRef_ de la v1).
 */
function casosEvaluacion_(hoy) {
  const F = fechasRef_(hoy);
  return [
    { n: '01', g: 'A', dice: 'Spotify 10,99 al mes, ocio', marca: 'Spotify', e: { frecuencia: 'mensual', importe: 10.99, categoria: 'Ocio' } },
    { n: '02', g: 'A', dice: 'Gasolina 50 euros hoy', marca: 'Gasolina', e: { frecuencia: 'puntual', importe: 50, fecha_referencia: hoy, categoria: 'Transporte' } },
    { n: '03', g: 'A', dice: 'Farmacia 8,45 ayer', marca: 'Farmacia', e: { frecuencia: 'puntual', importe: 8.45, fecha_referencia: F.ayer, categoria: 'Salud' } },
    { n: '04', g: 'A', dice: 'Netflix 13,99 mensual', marca: 'Netflix', e: { frecuencia: 'mensual', importe: 13.99 } },
    { n: '05', g: 'A', dice: 'Mercadona 62,30 hoy', marca: 'Mercadona', e: { frecuencia: 'puntual', importe: 62.3, fecha_referencia: hoy } },
    { n: '06', g: 'A', dice: 'Barbero 24 euros cada mes, cuidado personal', marca: 'Barbero', e: { frecuencia: 'mensual', importe: 24, categoria: 'Cuidado personal' } },

    { n: '07', g: 'B', dice: 'Café tres con veinte hoy', marca: 'Café', e: { frecuencia: 'puntual', importe: 3.2, fecha_referencia: hoy } },
    { n: '08', g: 'B', dice: 'Cena de empresa ciento veinticinco euros hoy', marca: 'Cena', e: { frecuencia: 'puntual', importe: 125, fecha_referencia: hoy } },
    { n: '09', g: 'B', dice: 'Amazon diecinueve noventa y nueve ayer', marca: 'Amazon', e: { frecuencia: 'puntual', importe: 19.99, fecha_referencia: F.ayer } },
    { n: '10', g: 'B', dice: 'Gimnasio treinta y nueve con noventa al mes', marca: 'Gimnasio', e: { frecuencia: 'mensual', importe: 39.9 } },
    { n: '11', g: 'B', dice: 'Seguro de casa doscientos ochenta al año, se paga en marzo', marca: 'Seguro', e: { frecuencia: 'anual', importe: 280, fecha_referencia: F.proxMarzo } },

    { n: '12', g: 'C', dice: 'Claude ahora me cobra 25 euros', marca: 'Claude', e: { reemplaza_id: 'R005', importe: 25, frecuencia: 'mensual' } },
    { n: '13', g: 'C', dice: 'Vinted 18 euros hoy', marca: 'Vinted', e: { frecuencia: 'puntual', importe: 18, fecha_referencia: hoy } },
    { n: '14', g: 'C', dice: 'Glovo 23,50 ayer', marca: 'Glovo', e: { frecuencia: 'puntual', importe: 23.5, fecha_referencia: F.ayer } },
    { n: '15', g: 'C', dice: 'ChatGPT Plus 23 euros al mes', marca: 'ChatGPT', e: { frecuencia: 'mensual', importe: 23 } },
    { n: '16', g: 'C', dice: 'Wallapop 40 euros hoy', marca: 'Wallapop', e: { frecuencia: 'puntual', importe: 40, fecha_referencia: hoy } },
    { n: '17', g: 'C', dice: 'Decathlon 34,99 hoy', marca: 'Decathlon', e: { frecuencia: 'puntual', importe: 34.99, fecha_referencia: hoy } },

    { n: '18', g: 'D', dice: 'Pádel 15 euros todos los viernes', marca: 'Pádel', e: { frecuencia: 'semanal', importe: 15, fecha_referencia: F.proxViernes } },
    { n: '19', g: 'D', dice: 'T-jove 45 euros trimestral', marca: 'T-jove', e: { frecuencia: 'mensual', cada_meses: 3, importe: 45, categoria: 'Transporte' } },
    { n: '20', g: 'D', dice: 'Creatina 44 euros cada dos meses', marca: 'Creatina', e: { frecuencia: 'mensual', cada_meses: 2, importe: 44 } },
    { n: '21', g: 'D', dice: 'Klarna 79 al mes, tres cuotas', marca: 'Klarna', e: { frecuencia: 'mensual', importe: 79, fecha_fin: F.finTercerMes, categoria: 'Financiación' } },
    { n: '22', g: 'D', dice: 'Cena de cumpleaños 45 euros el mes pasado', marca: 'Cena', e: { frecuencia: 'puntual', importe: 45, fecha_referencia: F.mesPasado } },

    { n: '23', g: 'E', dice: 'Apúntame Netflix', e: { bloqueado: true } },
    { n: '24', g: 'E', dice: 'Cena 30 y taxi 12', e: { bloqueado: true } },
    { n: '25', g: 'E', dice: 'Movistar 35 euros al mes', e: { bloqueado: true } },   // duplicado de R900

    { n: '26', g: 'F', dice: '(5 s de silencio)', e: { rechazado: true } },
    { n: '27', g: 'F', dice: '(5 s de ruido de fondo, sin hablar)', e: { rechazado: true } },

    { n: '28', g: 'G', dice: 'Gasolina 40 euros hoy (con la tele o música de fondo)', marca: 'Gasolina', e: { frecuencia: 'puntual', importe: 40, fecha_referencia: hoy, categoria: 'Transporte' } },
    { n: '29', g: 'G', dice: 'Farmacia doce con cincuenta hoy (en voz baja)', marca: 'Farmacia', e: { frecuencia: 'puntual', importe: 12.5, fecha_referencia: hoy, categoria: 'Salud' } },
    { n: '30', g: 'G', dice: 'Taxi catorce euros ayer (en la calle)', marca: 'Taxi', e: { frecuencia: 'puntual', importe: 14, fecha_referencia: F.ayer, categoria: 'Transporte' } }
  ];
}

/** Ejecuta lo que falte de la evaluación y actualiza el resumen. */
function evaluarAudios() {
  const inicio = Date.now();
  const idCarpeta = PropertiesService.getScriptProperties().getProperty('CARPETA_EVALUACION');
  if (!idCarpeta) throw new Error('Falta la propiedad CARPETA_EVALUACION (ID de la carpeta de Drive).');

  const audios = audiosDeCarpeta_(DriveApp.getFolderById(idCarpeta));
  const base = leerContexto_();   // v1: se usan las categorías reales
  const ctx = { hoy: base.hoy, categorias: base.categorias, recurrentesActivas: EVAL_REGLAS_ };
  const casos = casosEvaluacion_(base.hoy);
  const vocab = {
    ninguno: '',
    completo: vocabulario_(),
    propios: 'Gastos: ' + EVAL_NOMBRES_PROPIOS_.join(', ') + '. Importe: 10,99 €.'
  };

  const faltan = casos.filter((c) => !audios[c.n]).map((c) => c.n);
  if (faltan.length) Logger.log('Faltan audios (se saltan): ' + faltan.join(', '));

  const hoja = hojaEvaluacion_();
  const hechas = filasHechas_(hoja);
  let nuevas = 0;
  for (const c of casos) {
    if (!audios[c.n]) continue;
    let audio = null;   // se lee de Drive solo si queda alguna configuración pendiente
    for (const modelo of EVAL_MODELOS_) {
      for (const tipo of EVAL_VOCABULARIOS_) {
        if (hechas[c.n + '|' + modelo + '|' + tipo]) continue;
        if (Date.now() - inicio > EVAL_MAX_MS_) {
          Logger.log(nuevas + ' filas nuevas. Se acabó el tiempo: vuelve a ejecutar evaluarAudios().');
          return;
        }
        if (!audio) audio = Utilities.base64Encode(audios[c.n].getBlob().getBytes());
        hoja.appendRow(evaluarUno_(c, audio, modelo, tipo, vocab[tipo], ctx));
        nuevas++;
      }
    }
  }
  Logger.log(nuevas + ' filas nuevas. Evaluación completa.');
  resumirEvaluacion();
}

/** Un audio con una configuración → fila de la pestaña "Evaluación". */
function evaluarUno_(c, audio, modelo, tipo, prompt, ctx) {
  const tr = transcribirEval_(audio, modelo, prompt);
  const texto = tr.texto || '';
  let v = null;
  let msInterpretar = null;
  let fallos = [];

  if (!tr.ok) {
    fallos.push('Groq: ' + tr.error);
  } else if (c.e.rechazado) {
    if (texto) fallos.push('alucinación');
  } else if (!texto) {
    fallos.push('rechazado: no se entendió nada');
  } else {
    // Mismo camino que interpretar() de la v1, pero con el contexto controlado.
    const t0 = Date.now();
    try {
      const ctxFrase = Object.assign({}, ctx, { frase: texto });
      const bruto = llamarLLM_(construirMensajeUsuario(texto, ctxFrase, null),
        construirEsquema(ctx.categorias.map((k) => k.nombre)));
      v = validarInterpretacion(bruto, ctxFrase);
      fallos = comprobar_(c, v);
    } catch (err) {
      fallos.push('ERROR: ' + err.message);
    }
    msInterpretar = Date.now() - t0;
  }

  const d = (v && v.datos) || {};
  const marcaEnTexto = c.marca ? (contiene_(texto, c.marca) ? '✓' : '✗') : '—';
  return [new Date(), "'" + c.n, c.g, modelo, tipo, celdaTexto_(texto), tr.prob_sin_voz, marcaEnTexto,
    fallos.length ? '❌' : '✅', celdaTexto_(fallos.join(' · ')), celdaTexto_(d.concepto || ''),
    d.importe == null ? '' : d.importe, d.categoria || '', d.frecuencia || '', d.fecha_referencia || '',
    tr.ms_groq || '', msInterpretar == null ? '' : msInterpretar];
}

/** Compara la propuesta con lo esperado (mismo criterio que evaluarCerebro) y el concepto con la marca. */
function comprobar_(c, v) {
  const d = v.datos || {};
  const fallos = [];
  Object.keys(c.e).forEach((k) => {
    const real = k === 'bloqueado' ? v.bloqueado : d[k];
    const esperado = c.e[k];
    const igual = typeof esperado === 'number' ? Number(real) === esperado : real === esperado;
    if (!igual) fallos.push(k + ': esperaba ' + esperado + ', salió ' + real);
  });
  if (!c.e.bloqueado && v.bloqueado) fallos.push('bloqueado: ' + v.errores.concat(v.preguntas).join(' / '));
  if (c.marca && !c.e.bloqueado && !contiene_(d.concepto, c.marca)) {
    fallos.push('concepto: esperaba ' + c.marca + ', salió ' + d.concepto);
  }
  return fallos;
}

/** Groq gratuito limita las peticiones por minuto: si falla, espera y reintenta (hasta 3 veces). */
function transcribirEval_(audio, modelo, prompt) {
  for (let i = 0; ; i++) {
    const tr = transcribir_(audio, 'audio/mp4', modelo, prompt);   // .m4a de Notas de voz = audio/mp4
    if (tr.ok || tr.error !== 'groq' || i === 2) return tr;
    Utilities.sleep(20000);
  }
}

/** "T-Jove" contiene "t jove": sin tildes, mayúsculas ni signos. */
function contiene_(texto, marca) {
  const limpiar = (s) => normalizar(s).replace(/[^a-z0-9ñ]/g, '');   // normalizar es de la v1
  return limpiar(texto).indexOf(limpiar(marca)) >= 0;
}

/** Evita que un texto que empiece por "=", "+", "-" o "@" se interprete como fórmula. */
function celdaTexto_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** { '01': archivo, ... } con los audios de la carpeta (el nombre sin extensión). */
function audiosDeCarpeta_(carpeta) {
  const audios = {};
  const archivos = carpeta.getFiles();
  while (archivos.hasNext()) {
    const a = archivos.next();
    audios[a.getName().replace(/\.[^.]+$/, '')] = a;
  }
  return audios;
}

function hojaEvaluacion_() {
  const libro = libro_();
  let hoja = libro.getSheetByName(EVAL_HOJA_);
  if (!hoja) {
    hoja = libro.insertSheet(EVAL_HOJA_);
    hoja.appendRow(EVAL_COLUMNAS_);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

/** Audio|modelo|vocabulario de las filas ya escritas (para seguir donde se dejó). */
function filasHechas_(hoja) {
  const hechas = {};
  if (hoja.getLastRow() < 2) return hechas;
  hoja.getRange(2, 2, hoja.getLastRow() - 1, 4).getValues().forEach((f) => {
    hechas[f[0] + '|' + f[2] + '|' + f[3]] = true;
  });
  return hechas;
}

/** Resumen por configuración: aciertos (total y por grupo), marcas, alucinaciones y tiempos medios. */
function resumirEvaluacion() {
  const hoja = hojaEvaluacion_();
  if (hoja.getLastRow() < 2) return;
  const col = (nombre) => EVAL_COLUMNAS_.indexOf(nombre);
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, EVAL_COLUMNAS_.length).getValues();

  const grupos = Object.keys(EVAL_GRUPOS_);
  const salida = [['Modelo', 'Vocabulario', 'Aciertos']
    .concat(grupos.map((g) => g + ' ' + EVAL_GRUPOS_[g]))
    .concat(['Marca en el texto', 'Alucinaciones', 'ms_groq medio', 'ms_interpretar medio'])];

  for (const modelo of EVAL_MODELOS_) {
    for (const tipo of EVAL_VOCABULARIOS_) {
      const mias = filas.filter((f) => f[col('Modelo')] === modelo && f[col('Vocabulario')] === tipo);
      if (!mias.length) continue;
      const ok = (lista) => lista.filter((f) => f[col('Resultado')] === '✅').length + '/' + lista.length;
      const conMarca = mias.filter((f) => f[col('Marca en el texto')] !== '—');
      const silencios = mias.filter((f) => f[col('Grupo')] === 'F');
      salida.push([modelo, tipo, ok(mias)]
        .concat(grupos.map((g) => ok(mias.filter((f) => f[col('Grupo')] === g))))
        .concat([
          conMarca.filter((f) => f[col('Marca en el texto')] === '✓').length + '/' + conMarca.length,
          silencios.filter((f) => String(f[col('Fallos')]) === 'alucinación').length + '/' + silencios.length,
          media_(mias.map((f) => f[col('ms_groq')])),
          media_(mias.map((f) => f[col('ms_interpretar')]))
        ]));
    }
  }

  const libro = libro_();
  const resumen = libro.getSheetByName(EVAL_HOJA_RESUMEN_) || libro.insertSheet(EVAL_HOJA_RESUMEN_);
  resumen.clear();
  // Formato texto: "3/5" no debe convertirse en fecha.
  resumen.getRange(1, 1, salida.length, salida[0].length).setNumberFormat('@').setValues(salida);
  resumen.setFrozenRows(1);
  Logger.log('PROMPT ' + PROMPT_VERSION + ' · MODELO LLM ' + CONFIG.MODELO);
  salida.forEach((f) => Logger.log(f.join(' | ')));
}

function media_(valores) {
  const nums = valores.filter((x) => typeof x === 'number');
  return nums.length ? String(Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)) : '—';
}

/** Borra los resultados para repetir la evaluación desde cero. */
function borrarEvaluacion() {
  const hoja = libro_().getSheetByName(EVAL_HOJA_);
  if (hoja && hoja.getLastRow() > 1) hoja.deleteRows(2, hoja.getLastRow() - 1);
  Logger.log('Resultados borrados.');
}
