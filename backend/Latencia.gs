/**
 * Latencia.gs — Fase B.1: de dónde salen los segundos de un dictado. Archivo nuevo; se ejecuta desde el editor y
 * no guarda nada (interpretar solo propone).
 *
 * Cada vuelta cronometra, en este orden, lo mismo que hace un dictado dentro del servidor:
 *  - libro_()        abrir el libro (v1)
 *  - leerContexto_() leer Categorías y Recurrentes (v1; interpretar lo hace en cada dictado)
 *  - interpretar()   una frase fija: leer el contexto otra vez + Haiku + validación (v1)
 * La 1.ª vuelta es la realista: cada dictado es una ejecución nueva de Apps Script. Las siguientes van «en caliente».
 */

const LAT_VUELTAS_ = 5;
const LAT_FRASE_ = 'Spotify 10,99 al mes en suscripciones';

function medirLatencia() {
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  const tramos = [
    ['libro_()', () => libro_()],
    ['leerContexto_()', () => leerContexto_()],
    ['interpretar()', () => interpretar(token, LAT_FRASE_, null)]
  ];
  const tiempos = tramos.map(() => []);

  for (let v = 0; v < LAT_VUELTAS_; v++) {
    tramos.forEach(([, fn], i) => {
      const inicio = Date.now();
      fn();
      tiempos[i].push(Date.now() - inicio);
    });
  }

  const medianas = tiempos.map(mediana_);
  tramos.forEach(([nombre], i) => {
    Logger.log(nombre + ': 1.ª ' + tiempos[i][0] + ' ms · mediana ' + medianas[i] + ' ms · [' + tiempos[i].join(', ') + ']');
  });
  // interpretar lee el contexto por dentro: lo que queda es sobre todo Haiku y la validación.
  Logger.log('Haiku + validación ≈ ' + (medianas[2] - medianas[1]) + ' ms (mediana de interpretar − mediana de leerContexto_)');
  // Un dictado real lo hace todo en frío: la referencia es la 1.ª vuelta.
  Logger.log('Abrir el libro y leer el contexto en frío ≈ ' + (tiempos[0][0] + tiempos[1][0]) + ' ms (1.ª de libro_ + 1.ª de leerContexto_)');
}

function mediana_(lista) {
  const o = lista.slice().sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
}
