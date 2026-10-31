/**
 * Previstos.gs — Fase 14: el ingreso previsto de cada tipo, puesto desde la app.
 * Archivo nuevo. La hoja sigue siendo la fuente de verdad: la acción solo escribe una celda de Meses y el reparto
 * (Resumen H1:K4) lo calcula la hoja. La nómina prevista (Meses C) y las comisiones previstas (Meses D). La nómina
 * puede cambiarse también en los meses siguientes (una subida de sueldo dura); las comisiones, solo mes a mes.
 * Sin Deshacer de la v1 (como pagar): para corregir se vuelve a cambiar, y así no se pisa el de la última acción real.
 */

const PREV_COLUMNAS_ = { 'nómina': 3, comisiones: 4 };   // tipo → columna de Meses
const PREV_CON_SIGUIENTES_ = ['nómina'];                 // tipos que se pueden cambiar también en los meses siguientes
const PREV_MAX_ = 100000;
const PREV_FORMATO_ = '#,##0.00 "€"';

/**
 * Acción "previsto": { etiqueta, tipo, importe, siguientes? } → escribe el previsto (con `siguientes`, también en los
 * meses que vienen después, hasta el último de Meses) y devuelve el mes ya recalculado y cuántos meses ha cambiado.
 */
function previsto_(p) {
  const etiqueta = String(p.etiqueta == null ? '' : p.etiqueta);
  const tipo = String(p.tipo == null ? '' : p.tipo);
  const columna = PREV_COLUMNAS_[tipo];
  if (!columna) return { ok: false, error: 'entrada' };
  if (p.siguientes != null && typeof p.siguientes !== 'boolean') return { ok: false, error: 'entrada' };   // como pagado en pagar
  const siguientes = p.siguientes === true;
  if (siguientes && PREV_CON_SIGUIENTES_.indexOf(tipo) < 0) return { ok: false, error: 'entrada' };
  const libro = libro_();   // v1
  const meses = libro.getSheetByName('Meses');
  const fila = filaDeMes_(meses, etiqueta);
  if (fila < 0) return { ok: false, error: 'entrada' };

  // Errores de negocio con un mensaje para el usuario: se devuelven, no se lanzan.
  const error = validarPrevisto_(p.importe);
  if (error) return { ok: false, error: 'rechazado', mensaje: error };
  const importe = Math.round(Number(String(p.importe).replace(',', '.')) * 100) / 100;

  const filas = siguientes ? meses.getLastRow() - fila + 1 : 1;   // este mes y, si se pide, todos los de después
  const anterior = conBloqueo_(() => {   // v1: un acceso a la vez
    const rango = meses.getRange(fila, columna, filas, 1);
    const antes = redondear2_(rango.getCell(1, 1).getValue());   // Mes.gs; una celda vacía es 0
    if (importe === 0) rango.clearContent();                      // 0 quita el previsto
    else rango.setValues(Array.from({ length: filas }, () => [importe])).setNumberFormat(PREV_FORMATO_);
    return antes;
  });

  // El mes ya recalculado en la misma respuesta: un viaje a Apps Script (~2 s) en vez de dos (fase B).
  const mes = mes_({ etiqueta: etiqueta });   // Mes.gs; fuera del bloqueo, porque mes_ toma el suyo
  return { etiqueta: etiqueta, tipo: tipo, anterior: anterior, importe: importe, meses_cambiados: filas,
           mes: mes.ok === false ? null : mes };
}

/** Mensaje del problema, o null. Vale un número o un texto numérico («250», «250,5»); 0 quita el previsto. */
function validarPrevisto_(valor) {
  const texto = String(valor == null ? '' : valor).trim().replace(',', '.');
  if (!texto || !/^-?\d+(\.\d+)?$/.test(texto)) return 'Escribe un importe (0 para quitar el previsto).';
  const n = Number(texto);
  if (n < 0) return 'El importe no puede ser negativo.';
  if (n > PREV_MAX_) return 'El importe parece demasiado alto (máximo ' + PREV_MAX_ + ' €).';
  return null;
}

/** Número de fila de esa etiqueta en Meses (columna B), o -1. */
function filaDeMes_(hoja, etiqueta) {
  if (hoja.getLastRow() < 2) return -1;
  const i = hoja.getRange(2, 2, hoja.getLastRow() - 1, 1).getValues().map((f) => String(f[0])).indexOf(etiqueta);
  return i < 0 ? -1 : i + 2;
}

/**
 * Prueba desde el editor: las validaciones; en el último mes de Meses, poner 250 de comisiones previstas, ver que el
 * reparto las cuenta, cambiarlas a 0 y que la celda quede vacía; y la nómina prevista, en el penúltimo mes «y los
 * siguientes» (cambian los dos últimos). Las celdas quedan como estaban (finally).
 */
function probarPrevistos() {
  const libro = libro_();
  const zona = libro.getSpreadsheetTimeZone();
  const etiquetas = mesesDeLaHoja_(libro, zona).map((m) => m.etiqueta);   // Mes.gs
  const mes = etiquetas[etiquetas.length - 1];   // el más lejano: casi seguro que no tiene ingresos
  const casos = [
    ['mes inventado', { etiqueta: 'Mes inventado', tipo: 'comisiones', importe: 1 }, 'entrada'],
    ['«siguientes» en comisiones (solo la nómina)', { etiqueta: mes, tipo: 'comisiones', importe: 1, siguientes: true }, 'entrada'],
    ['«siguientes» que no es sí/no', { etiqueta: mes, tipo: 'nómina', importe: 1, siguientes: 'sí' }, 'entrada'],
    ['tipo inventado', { etiqueta: mes, tipo: 'sueldo', importe: 1 }, 'entrada'],
    ['importe negativo', { etiqueta: mes, tipo: 'comisiones', importe: -5 }, 'rechazado'],
    ['importe enorme', { etiqueta: mes, tipo: 'comisiones', importe: PREV_MAX_ + 1 }, 'rechazado'],
    ['importe con texto', { etiqueta: mes, tipo: 'comisiones', importe: 'mucho' }, 'rechazado'],
    ['importe vacío', { etiqueta: mes, tipo: 'comisiones', importe: '' }, 'rechazado']
  ];
  let ok = 0;
  casos.forEach(([caso, params, esperado]) => {
    const r = previsto_(params);
    const bien = r.ok === false && r.error === esperado;
    if (bien) ok++;
    Logger.log((bien ? '✅ ' : '❌ ') + caso + ' → ' + (r.mensaje || r.error || JSON.stringify(r)));
  });
  Logger.log('Validaciones: ' + ok + '/' + casos.length);

  const hoja = libro.getSheetByName('Meses');
  const celda = hoja.getRange(filaDeMes_(hoja, mes), PREV_COLUMNAS_.comisiones);
  const original = celda.getValue();
  const formato = celda.getNumberFormat();
  const penultimo = etiquetas[etiquetas.length - 2];
  const nominas = hoja.getRange(filaDeMes_(hoja, penultimo), PREV_COLUMNAS_['nómina'], 2, 1);   // C del penúltimo y del último
  const nominasAntes = nominas.getValues();
  const nominasFormato = nominas.getNumberFormats();
  try {
    const comisiones = (r) => r.mes.cabecera.desglose.filter((d) => d.tipo === 'comisiones')[0];
    const r1 = previsto_({ etiqueta: mes, tipo: 'comisiones', importe: '250' });
    const c1 = comisiones(r1);
    const bien1 = r1.importe === 250 && Number(celda.getValue()) === 250 && c1.previsto === 250 &&
                  c1.cuenta === (c1.cobrado > 0 ? c1.cobrado : 250);
    Logger.log((bien1 ? '✅ ' : '❌ ') + 'Poner 250 en ' + mes + ' → ' + r1.anterior + ' € → ' + r1.importe + ' € · celda ' +
               celda.getValue() + ' · reparto: previsto ' + c1.previsto + ', cobrado ' + c1.cobrado + ', cuenta ' + c1.cuenta +
               ' · ingreso ' + r1.mes.cabecera.ingreso + ' (' + r1.mes.cabecera.origen + ')');
    const r2 = previsto_({ etiqueta: mes, tipo: 'comisiones', importe: 0 });
    const bien2 = r2.anterior === 250 && celda.getValue() === '' && comisiones(r2).previsto === 0 &&
                  r2.mes.cabecera.ingreso === Math.round((r1.mes.cabecera.ingreso - (c1.cobrado > 0 ? 0 : 250)) * 100) / 100;
    Logger.log((bien2 ? '✅ ' : '❌ ') + 'Ponerlo a 0 → celda vacía · ingreso ' + r2.mes.cabecera.ingreso);

    // Nómina prevista en el penúltimo mes «y los siguientes»: cambian el penúltimo y el último.
    const r3 = previsto_({ etiqueta: penultimo, tipo: 'nómina', importe: 1500.5, siguientes: true });
    const n3 = r3.mes.cabecera.desglose.filter((d) => d.tipo === 'nómina')[0];
    const valores = nominas.getValues().map((f) => f[0]);
    const bien3 = r3.meses_cambiados === 2 && valores[0] === 1500.5 && valores[1] === 1500.5 && n3.previsto === 1500.5;
    Logger.log((bien3 ? '✅ ' : '❌ ') + 'Nómina prevista de ' + penultimo + ' y siguientes → ' + r3.anterior + ' € → ' +
               r3.importe + ' € en ' + r3.meses_cambiados + ' meses · celdas ' + valores.join(' y ') + ' · reparto ' + n3.previsto);
    const r4 = previsto_({ etiqueta: mes, tipo: 'nómina', importe: 1400 });
    const bien4 = r4.meses_cambiados === 1 && nominas.getValues()[0][0] === 1500.5 && nominas.getValues()[1][0] === 1400;
    Logger.log((bien4 ? '✅ ' : '❌ ') + 'Nómina prevista solo de ' + mes + ' → 1400 sin tocar el mes anterior (' +
               nominas.getValues().map((f) => f[0]).join(' y ') + ')');
  } finally {
    if (original === '') celda.clearContent();
    else celda.setValue(original);
    celda.setNumberFormat(formato);
    nominas.setValues(nominasAntes).setNumberFormats(nominasFormato);
    const igual = celda.getValue() === original &&
                  JSON.stringify(nominas.getValues()) === JSON.stringify(nominasAntes);
    Logger.log((igual ? '✅ ' : '❌ ') + 'Limpieza: Meses C y D de los meses de prueba como estaban');
  }
}
