/**
 * Migraciones.gs — Cambios en la hoja que pide cada fase, para ejecutar UNA vez desde el editor (no los usa la app).
 * Archivo nuevo. Cada función comprueba antes de escribir: si algo no está como se espera, no toca nada y lo dice.
 * Si ya estaba aplicada, lo detecta y no la repite. Las fórmulas van en inglés y con comas (lo exige setFormula),
 * aunque la hoja las enseñe con punto y coma.
 */

const MIG_FILTRO_ = [   // fase 13: el filtro de fechas de Movimientos en el Resumen, antes → después
  ['Movimientos!$B:$B,">="&$B$2', 'Movimientos!$B:$B,">="&$E$2'],
  ['Movimientos!$B:$B,"<="&$B$3', 'Movimientos!$B:$B,"<="&$E$3']
];
const MIG_APARICIONES_ = 37;   // B7 (1) + la D de los 12 bloques «cat» (12) + las 12 filas de detalle (2 cada una)

/** Fase 13: periodo de cada mes en Meses (E:F), Resumen D2:E3, el filtro de Movimientos y la Guía. */
function aplicarFase13() {
  const libro = libro_();   // v1
  conBloqueo_(() => {       // v1: que la app no escriba mientras tanto
    const meses = libro.getSheetByName('Meses');
    const resumen = libro.getSheetByName('Resumen');
    const guia = libro.getSheetByName('Guía');

    // 1. Comprobaciones: nada se escribe si algo no cuadra.
    const cabecera = meses.getRange('E1:F1').getValues()[0];
    const yaMeses = cabecera[0] === 'Inicio_periodo' && cabecera[1] === 'Fin_periodo';
    if (!yaMeses && (cabecera[0] !== '' || cabecera[1] !== '')) {
      return Logger.log('❌ Meses E1:F1 no están vacías (' + cabecera.join(' · ') + '). No se ha cambiado nada.');
    }
    const d2e3 = resumen.getRange('D2:E3').getValues();
    const yaResumen = d2e3[0][0] === 'Periodo desde';
    if (!yaResumen && d2e3.some((f) => f.some((v) => v !== ''))) {
      return Logger.log('❌ Resumen D2:E3 no están vacías. No se ha cambiado nada.');
    }
    const rango = resumen.getDataRange();
    const formulas = rango.getFormulas();
    const veces = (texto) => formulas.reduce((s, fila) => s + fila.reduce((t, f) => t + f.split(texto).length - 1, 0), 0);
    const cuenta = MIG_FILTRO_.map(([antes]) => veces(antes));
    const hecho = MIG_FILTRO_.map(([, despues]) => veces(despues));
    if (cuenta.some((n) => n !== 0 && n !== MIG_APARICIONES_)) {
      return Logger.log('❌ El filtro de Movimientos aparece ' + cuenta.join(' y ') + ' veces (se esperaban ' +
                        MIG_APARICIONES_ + '). No se ha cambiado nada: revisa el Resumen.');
    }
    if (cuenta[0] === 0 && hecho[0] === 0) {
      return Logger.log('❌ No encuentro el filtro de Movimientos en el Resumen (ni con B2 ni con E2). No se ha cambiado nada.');
    }

    // 2. Meses: Inicio_periodo (E) y Fin_periodo (F), una fórmula por fila.
    const ultima = meses.getLastRow();
    if (!yaMeses) {
      meses.getRange('E1:F1').setValues([['Inicio_periodo', 'Fin_periodo']]);
      const filas = [];
      for (let r = 2; r <= ultima; r++) {
        filas.push([
          '=LET(c, MINIFS(Ingresos!$B:$B, Ingresos!$C:$C, B' + r + ', Ingresos!$E:$E, "nómina"), IF(c>0, MIN(A' + r + ', c), A' + r + '))',
          '=IF(A' + (r + 1) + '="", EOMONTH(A' + r + ', 0), E' + (r + 1) + '-1)'
        ]);
      }
      meses.getRange(2, 5, filas.length, 2).setFormulas(filas).setNumberFormat('dd/mm/yyyy');
      Logger.log('✅ Meses: E «Inicio_periodo» y F «Fin_periodo» en las filas 2–' + ultima);
    } else {
      Logger.log('· Meses: E y F ya estaban');
    }

    // 3. Resumen D2:E3: el periodo del mes elegido.
    if (!yaResumen) {
      resumen.getRange('D2:D3').setValues([['Periodo desde'], ['Periodo hasta']]);
      resumen.getRange('E2:E3').setFormulas([['=INDEX(Meses!$E:$E, MATCH($B$1, Meses!$B:$B, 0))'],
                                             ['=INDEX(Meses!$F:$F, MATCH($B$1, Meses!$B:$B, 0))']])
        .setNumberFormat('dd/mm/yyyy');
      Logger.log('✅ Resumen: D2:E3 «Periodo desde / hasta»');
    } else {
      Logger.log('· Resumen: D2:E3 ya estaban');
    }

    // 4. Resumen: el filtro de Movimientos pasa de B2:B3 (mes natural) a E2:E3 (periodo). Solo las celdas que lo usan.
    let celdas = 0;
    formulas.forEach((fila, i) => fila.forEach((f, j) => {
      if (!MIG_FILTRO_.some(([antes]) => f.indexOf(antes) >= 0)) return;
      const nueva = MIG_FILTRO_.reduce((t, [antes, despues]) => t.split(antes).join(despues), f);
      resumen.getRange(i + 1, j + 1).setFormula(nueva);
      celdas++;
    }));
    Logger.log(cuenta[0] ? '✅ Resumen: filtro de Movimientos cambiado (' + cuenta.join(' + ') + ' apariciones en ' +
                           celdas + ' celdas)' : '· Resumen: el filtro ya usaba E2:E3');

    // 5. Guía: tres filas, si no están.
    const columnaB = guia.getRange(1, 2, guia.getLastRow(), 1).getValues().map((f) => String(f[0]));
    if (columnaB.indexOf('Inicio_periodo') < 0) {
      const nuevas = [
        ['Meses', 'Inicio_periodo', 'Primer día del mes para los gastos puntuales: el día en que se cobra su nómina (nunca después del día 1). Sin nómina apuntada, el día 1.', 'Solo fórmulas: no editar', '26/10/2026'],
        ['Meses', 'Fin_periodo', 'Último día: la víspera del inicio del mes siguiente (en la última fila, fin de mes).', 'Solo fórmulas: no editar', '30/11/2026'],
        ['Resumen', 'E2:E3 Periodo', 'Periodo del mes elegido. Los gastos puntuales cuentan por este periodo; los recurrentes, por B2:B3 (mes natural).', 'Solo fórmulas: no editar', '']
      ];
      guia.getRange(guia.getLastRow() + 1, 1, nuevas.length, 5).setValues(nuevas);
      Logger.log('✅ Guía: 3 filas nuevas');
    } else {
      Logger.log('· Guía: las filas ya estaban');
    }

    // 6. Comprobación final con la hoja ya recalculada.
    SpreadsheetApp.flush();
    const zona = libro.getSpreadsheetTimeZone();
    const control = resumen.getRange('B7').getValue();
    const periodo = resumen.getRange('E2:E3').getValues().map((f) => textoFecha_(f[0], zona));   // Mes.gs
    Logger.log((control === 0 ? '✅ ' : '❌ ') + 'Resumen B7 (Control) = ' + control + ' · ' + resumen.getRange('B1').getValue() +
               ': periodo ' + periodo.join(' → '));
    mesesDeLaHoja_(libro, zona).slice(0, 3).forEach((m) =>
      Logger.log('   ' + m.etiqueta + ': ' + m.periodo_inicio + ' → ' + m.periodo_fin));
  });
}
