/**
 * Migraciones.gs — Cambios en la hoja que pide cada fase, para ejecutar UNA vez desde el editor (no los usa la app).
 * Archivo nuevo. Cada función comprueba antes de escribir: si algo no está como se espera, no toca nada y lo dice.
 * Si ya estaba aplicada, lo detecta y no la repite. Las fórmulas nuevas usan el separador de la hoja, que se deduce
 * de sus propias fórmulas: en la configuración regional de España es «;» (la coma es el decimal) y setFormula no
 * acepta comas.
 */

// Fase 13: el filtro de fechas de Movimientos en el Resumen («>=» con B2 y «<=» con B3; después, con E2 y E3).
// Tolera espacios y punto y coma: la fórmula que lee Apps Script no siempre se escribe igual que la del export.
const MIG_FILTRO_ = (col) => new RegExp('Movimientos!\\$B:\\$B(\\s*[,;]\\s*)"(>=|<=)"(\\s*&\\s*)\\$' + col + '\\$([23])(?![0-9])', 'g');
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
    // Apariciones de «>=» y de «<=» con la columna dada (B = antes del cambio, E = ya cambiado).
    const veces = (col) => [0, 0].map((_, k) => formulas.reduce((s, fila) => s + fila.reduce((t, f) =>
      t + (f.match(MIG_FILTRO_(col)) || []).filter((m) => m.indexOf(k ? '"<="' : '">="') >= 0).length, 0), 0));
    const cuenta = veces('B');
    const hecho = veces('E');
    if (cuenta.some((n) => n !== 0 && n !== MIG_APARICIONES_)) {
      return Logger.log('❌ El filtro de Movimientos aparece ' + cuenta.join(' y ') + ' veces (se esperaban ' +
                        MIG_APARICIONES_ + '). No se ha cambiado nada: revisa el Resumen.');
    }
    // El separador de argumentos, tal como lo usan las fórmulas del Resumen (por defecto, la coma).
    const ejemplo = formulas.reduce((a, fila) => a.concat(fila), []).map((f) => MIG_FILTRO_('B').exec(f) ||
      MIG_FILTRO_('E').exec(f)).filter((m) => m)[0];
    const sep = ejemplo ? ejemplo[1].trim() : ',';
    const local = (formula) => formula.replace(/,/g, sep);   // las fórmulas de aquí no llevan comas dentro de textos
    if (cuenta[0] === 0 && hecho[0] === 0) {
      const muestra = formulas.map((fila) => fila[3]).filter((f) => f.indexOf('Movimientos') >= 0)[0] || '(ninguna fórmula de la columna D usa Movimientos)';
      return Logger.log('❌ No encuentro el filtro de Movimientos en el Resumen (ni con B2 ni con E2). No se ha cambiado nada.\n' +
                        'Así ve Apps Script una fórmula de la columna D: ' + muestra);
    }

    // 2. Meses: Inicio_periodo (E) y Fin_periodo (F), una fórmula por fila.
    const ultima = meses.getLastRow();
    if (!yaMeses) {
      meses.getRange('E1:F1').setValues([['Inicio_periodo', 'Fin_periodo']]);
      const filas = [];
      for (let r = 2; r <= ultima; r++) {
        // Sin LET: Sheets no acepta nombres como «c» (se confunden con una columna) y así no depende de ella.
        const nomina = 'Ingresos!$C:$C, B' + r + ', Ingresos!$E:$E, "nómina"';
        filas.push([
          '=IF(COUNTIFS(' + nomina + ')>0, MIN(A' + r + ', MINIFS(Ingresos!$B:$B, ' + nomina + ')), A' + r + ')',
          '=IF(A' + (r + 1) + '="", EOMONTH(A' + r + ', 0), E' + (r + 1) + '-1)'
        ]);
      }
      meses.getRange(2, 5, filas.length, 2).setFormulas(filas.map((f) => f.map(local))).setNumberFormat('dd/mm/yyyy');
      SpreadsheetApp.flush();
      // Si la hoja no acepta la fórmula (daría un error en vez de una fecha), se deshace y no se sigue.
      const prueba = meses.getRange('E2:F2').getValues()[0];
      if (!(prueba[0] instanceof Date && prueba[1] instanceof Date)) {
        const visto = meses.getRange('E2:F2').getDisplayValues()[0].join(' · ');
        meses.getRange(1, 5, ultima, 2).clearContent();
        return Logger.log('❌ Las fórmulas de Meses E:F no dan una fecha (' + visto + '). Se han quitado: no se ha cambiado nada.\n' +
                          'Separador usado: «' + sep + '». Fórmula de E2: ' + local(filas[0][0]));
      }
      Logger.log('✅ Meses: E «Inicio_periodo» y F «Fin_periodo» en las filas 2–' + ultima + ' (separador «' + sep + '»)');
    } else {
      Logger.log('· Meses: E y F ya estaban');
    }

    // 3. Resumen D2:E3: el periodo del mes elegido.
    if (!yaResumen) {
      resumen.getRange('D2:D3').setValues([['Periodo desde'], ['Periodo hasta']]);
      resumen.getRange('E2:E3').setFormulas([[local('=INDEX(Meses!$E:$E, MATCH($B$1, Meses!$B:$B, 0))')],
                                             [local('=INDEX(Meses!$F:$F, MATCH($B$1, Meses!$B:$B, 0))')]])
        .setNumberFormat('dd/mm/yyyy');
      Logger.log('✅ Resumen: D2:E3 «Periodo desde / hasta»');
    } else {
      Logger.log('· Resumen: D2:E3 ya estaban');
    }

    // 4. Resumen: el filtro de Movimientos pasa de B2:B3 (mes natural) a E2:E3 (periodo). Solo las celdas que lo usan.
    let celdas = 0;
    formulas.forEach((fila, i) => fila.forEach((f, j) => {
      const nueva = f.replace(MIG_FILTRO_('B'), (m, s1, op, s2, n) => 'Movimientos!$B:$B' + s1 + '"' + op + '"' + s2 + '$E$' + n);
      if (nueva === f) return;
      resumen.getRange(i + 1, j + 1).setFormula(nueva);   // el resto de la fórmula, tal cual la devolvió Apps Script
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
    Logger.log((control === 0 ? '✅ ' : '❌ ') + 'Resumen B7 (Control) = ' + control);
    Logger.log((periodo.every((p) => p) ? '✅ ' : '❌ ') + resumen.getRange('B1').getValue() + ': periodo ' +
               periodo.join(' → ') + (periodo.every((p) => p) ? '' : ' (E2:E3 no dan una fecha: ' +
               resumen.getRange('E2:E3').getDisplayValues().map((f) => f[0]).join(' · ') + ')'));
    mesesDeLaHoja_(libro, zona).slice(0, 3).forEach((m) =>
      Logger.log('   ' + m.etiqueta + ': ' + m.periodo_inicio + ' → ' + m.periodo_fin));
  });
}

/** El separador de argumentos de la hoja, deducido de sus fórmulas: «;» en la configuración de España, «,» en inglés. */
function separadorDeHoja_(formulas) {
  return formulas.some((fila) => fila.some((f) => f.indexOf(';') >= 0)) ? ';' : ',';
}

/**
 * Fase 14: comisiones previstas (Meses D) y reparto del ingreso por tipo (Resumen H1:K4). B4 pasa a sumar lo que cuenta
 * de cada tipo (cobrado si hay; si no, previsto), E4 y E5 suman el reparto y E6 dice previsto, parcial o cobrado.
 * Si algo no da un número al escribirlo, se deshace todo (también las cuatro fórmulas de la cabecera) y se para.
 */
function aplicarFase14() {
  const libro = libro_();   // v1
  conBloqueo_(() => {       // v1
    const meses = libro.getSheetByName('Meses');
    const resumen = libro.getSheetByName('Resumen');
    const guia = libro.getSheetByName('Guía');
    const ultima = meses.getLastRow();
    const sep = separadorDeHoja_(resumen.getDataRange().getFormulas());
    const local = (formula) => formula.replace(/,/g, sep);   // estas fórmulas no llevan comas dentro de textos
    const sinEspacios = (f) => f.replace(/\s/g, '');

    // 1. Comprobaciones: nada se escribe si algo no cuadra.
    const columnaD = meses.getRange(1, 4, ultima, 1).getValues().map((f) => f[0]);
    const yaMeses = columnaD[0] === 'Comisiones_previstas';
    if (!yaMeses && columnaD.some((v) => v !== '')) {
      return Logger.log('❌ Meses D no está vacía (D1: «' + columnaD[0] + '»). No se ha cambiado nada.');
    }
    const reparto = resumen.getRange('H1:K4');
    const yaReparto = reparto.getValues()[0][0] === 'Ingreso';
    if (!yaReparto && reparto.getValues().some((f) => f.some((v) => v !== ''))) {
      return Logger.log('❌ Resumen H1:K4 no está vacía. No se ha cambiado nada.');
    }
    const cabecera = ['B4', 'E4', 'E5', 'E6'].map((a) => resumen.getRange(a));
    const antes = cabecera.map((c) => c.getFormula());
    const yaCabecera = sinEspacios(antes[0]).indexOf('K2:K4') >= 0;
    const esperado = [/E5>0/, /Meses!\$C:\$C/, /Ingresos!\$F:\$F/, /"cobrado"/];
    if (!yaCabecera && antes.some((f, i) => !esperado[i].test(sinEspacios(f)))) {
      return Logger.log('❌ Las fórmulas de la cabecera no son las esperadas. No se ha cambiado nada.\n' +
                        ['B4', 'E4', 'E5', 'E6'].map((a, i) => a + ': ' + antes[i]).join('\n'));
    }

    const deshacer = (motivo) => {
      if (!yaCabecera) cabecera.forEach((c, i) => c.setFormula(antes[i]));
      if (!yaReparto) reparto.clearContent();
      if (!yaMeses) meses.getRange('D1').clearContent();
      Logger.log('❌ ' + motivo + ' Se ha deshecho: no se ha cambiado nada (separador «' + sep + '»).');
    };

    // 2. Meses D: Comisiones_previstas (vacía = 0; se pone desde la app).
    if (!yaMeses) {
      meses.getRange('D1').setValue('Comisiones_previstas');
      meses.getRange(2, 4, ultima - 1, 1).setNumberFormat('#,##0.00 "€"');
      Logger.log('✅ Meses: D «Comisiones_previstas»');
    } else {
      Logger.log('· Meses: D ya estaba');
    }

    // 3. Resumen H1:K4: el reparto del mes elegido (B1), una fila por tipo.
    if (!yaReparto) {
      const sumar = (tipo) => local('=SUMIFS(Ingresos!$F:$F, Ingresos!$C:$C, $B$1, Ingresos!$E:$E, "' + tipo + '")');
      const cuenta = (r) => local('=IF(J' + r + '>0, J' + r + ', I' + r + ')');
      reparto.setValues([['Ingreso', 'Previsto', 'Cobrado', 'Cuenta'], ['Nómina', '', '', ''], ['Comisiones', '', '', ''],
                         ['Extras', 0, '', '']]);
      resumen.getRange('I2').setFormula(local('=IFERROR(INDEX(Meses!$C:$C, MATCH($B$1, Meses!$B:$B, 0)), 0)'));
      resumen.getRange('I3').setFormula(local('=IFERROR(N(INDEX(Meses!$D:$D, MATCH($B$1, Meses!$B:$B, 0))), 0)'));
      resumen.getRange('J2:K4').setFormulas([[sumar('nómina'), cuenta(2)], [sumar('comisiones'), cuenta(3)],
                                             [sumar('extra'), cuenta(4)]]);
      resumen.getRange('I2:K4').setNumberFormat('#,##0.00 "€"');
      SpreadsheetApp.flush();
      const valores = resumen.getRange('I2:K4').getValues();
      if (!valores.every((f) => f.every((v) => typeof v === 'number'))) {
        return deshacer('El reparto H2:K4 no da números (' + resumen.getRange('I2:K4').getDisplayValues().map((f) => f.join(' · ')).join(' | ') + ').');
      }
      Logger.log('✅ Resumen: reparto H1:K4');
    } else {
      Logger.log('· Resumen: el reparto ya estaba');
    }

    // 4. Cabecera: el ingreso, el previsto y el cobrado salen del reparto; el origen puede ser «parcial».
    if (!yaCabecera) {
      cabecera[0].setFormula(local('=SUM(K2:K4)'));
      cabecera[1].setFormula(local('=SUM(I2:I4)'));
      cabecera[2].setFormula(local('=SUM(J2:J4)'));
      cabecera[3].setFormula(local('=IF(E5=0, "previsto", IF(AND(OR(I2=0, J2>0), OR(I3=0, J3>0)), "cobrado", "parcial"))'));
      SpreadsheetApp.flush();
      const b4 = cabecera[0].getValue();
      const k = resumen.getRange('K2:K4').getValues().reduce((s, f) => s + f[0], 0);
      if (typeof b4 !== 'number' || Math.round(b4 * 100) !== Math.round(k * 100) ||
          ['previsto', 'parcial', 'cobrado'].indexOf(cabecera[3].getValue()) < 0) {
        return deshacer('La cabecera no da lo esperado (B4 «' + cabecera[0].getDisplayValue() + '», E6 «' +
                        cabecera[3].getDisplayValue() + '»).');
      }
      Logger.log('✅ Resumen: B4, E4, E5 y E6 calculan por tipo');
    } else {
      Logger.log('· Resumen: la cabecera ya calculaba por tipo');
    }

    // 5. Guía: filas nuevas y la descripción de B4.
    const filasGuia = guia.getRange(1, 1, guia.getLastRow(), 3).getValues();
    if (!filasGuia.some((f) => f[1] === 'Comisiones_previstas')) {
      const nuevas = [
        ['Meses', 'Comisiones_previstas', 'Comisiones que esperas cobrar ese mes. Se ponen desde la app («Mes» → toca el Ingreso → Cambiar previsto). Vacía = 0.', 'Número o vacío', '250'],
        ['Resumen', 'H1:K4 Reparto', 'El ingreso del mes elegido por tipo: previsto, cobrado y lo que cuenta (de cada tipo, lo cobrado si hay; si no, lo previsto). Los extras solo cuentan cobrados.', 'Solo fórmulas: no editar', '']
      ];
      guia.getRange(guia.getLastRow() + 1, 1, nuevas.length, 5).setValues(nuevas);
      const fb4 = filasGuia.map((f) => f[1]).indexOf('B4 Ingreso del mes');
      if (fb4 >= 0) {
        guia.getRange(fb4 + 1, 3).setValue('Suma de lo que cuenta de cada tipo (H2:K4): lo cobrado de un tipo sustituye a su previsto.');
      }
      Logger.log('✅ Guía: 2 filas nuevas' + (fb4 >= 0 ? ' y la descripción de B4 actualizada' : ''));
    } else {
      Logger.log('· Guía: las filas ya estaban');
    }

    // 6. Cómo queda el mes que tiene el Resumen.
    SpreadsheetApp.flush();
    const tabla = resumen.getRange('H2:K4').getValues();
    Logger.log('✅ ' + resumen.getRange('B1').getValue() + ': ingreso ' + resumen.getRange('B4').getValue() + ' (' +
               resumen.getRange('E6').getValue() + ') · B7 (Control) = ' + resumen.getRange('B7').getValue());
    tabla.forEach((f) => Logger.log('   ' + f[0] + ': previsto ' + f[1] + ' · cobrado ' + f[2] + ' · cuenta ' + f[3]));
  });
}

/**
 * Fase 15: arrastre del restante al mes siguiente. Resumen H5:K5 «Arrastre» (previsto 0; cuenta = cobrado, también si es
 * negativo: no vale IF(J>0, J, I)), B4/E4/E5 suman la fila 5, E6 no la mira (el arrastre no cambia el origen) y D7:E7
 * «Restante real» = cobrado − fijos − gastos puntuales (los presupuestos no reservan nada). En Ingresos, el Tipo admite
 * «arrastre» y el Importe puede ser negativo solo en él. Si algo no da lo esperado, se deshace y se para.
 */
function aplicarFase15() {
  const libro = libro_();   // v1
  conBloqueo_(() => {       // v1
    const resumen = libro.getSheetByName('Resumen');
    const ingresos = libro.getSheetByName('Ingresos');
    const guia = libro.getSheetByName('Guía');
    const sep = separadorDeHoja_(resumen.getDataRange().getFormulas());
    const local = (formula) => formula.replace(/,/g, sep);   // estas fórmulas no llevan comas dentro de textos
    const sinEspacios = (f) => f.replace(/\s/g, '');

    // 1. Comprobaciones: nada se escribe si algo no cuadra.
    const fila5 = resumen.getRange('H5:K5');
    const yaFila5 = fila5.getValues()[0][0] === 'Arrastre';
    if (!yaFila5 && fila5.getValues()[0].some((v) => v !== '')) {
      return Logger.log('❌ Resumen H5:K5 no está vacía. No se ha cambiado nada.');
    }
    const d7e7 = resumen.getRange('D7:E7');
    const yaReal = d7e7.getValues()[0][0] === 'Restante real';
    if (!yaReal && d7e7.getValues()[0].some((v) => v !== '')) {
      return Logger.log('❌ Resumen D7:E7 no está vacía. No se ha cambiado nada.');
    }
    const cabecera = ['B4', 'E4', 'E5', 'E6'].map((a) => resumen.getRange(a));
    const antes = cabecera.map((c) => c.getFormula());
    const yaCabecera = sinEspacios(antes[0]).indexOf('K2:K5') >= 0;
    const esperado = [/^=SUM\(K2:K4\)$/i, /^=SUM\(I2:I4\)$/i, /^=SUM\(J2:J4\)$/i, /^=IF\(E5=0[,;]"previsto"/i];
    if (!yaCabecera && antes.some((f, i) => !esperado[i].test(sinEspacios(f)))) {
      return Logger.log('❌ Las fórmulas de la cabecera no son las de la fase 14 (¿falta aplicarFase14?). No se ha cambiado nada.\n' +
                        ['B4', 'E4', 'E5', 'E6'].map((a, i) => a + ': ' + antes[i]).join('\n'));
    }
    const reglaTipo = ingresos.getRange('E2').getDataValidation();
    const reglaImporte = ingresos.getRange('F2').getDataValidation();
    if (!reglaTipo || reglaTipo.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      return Logger.log('❌ Ingresos E2 no tiene la lista de tipos. No se ha cambiado nada.');
    }

    const deshacer = (motivo) => {
      if (!yaCabecera) cabecera.forEach((c, i) => c.setFormula(antes[i]));
      if (!yaFila5) fila5.clearContent();
      if (!yaReal) d7e7.clearContent();
      Logger.log('❌ ' + motivo + ' Se ha deshecho: no se ha cambiado nada (separador «' + sep + '»).');
    };

    // 2. Reparto, fila 5: el arrastre solo se cobra (lo apunta la app al cerrar el mes anterior).
    if (!yaFila5) {
      fila5.setValues([['Arrastre', 0, '', '']]);
      resumen.getRange('J5').setFormula(local('=SUMIFS(Ingresos!$F:$F, Ingresos!$C:$C, $B$1, Ingresos!$E:$E, "arrastre")'));
      resumen.getRange('K5').setFormula('=J5');   // con signo: un arrastre negativo resta
      resumen.getRange('I5:K5').setNumberFormat('#,##0.00 "€"');
      Logger.log('✅ Resumen: fila 5 del reparto, «Arrastre»');
    } else {
      Logger.log('· Resumen: la fila del arrastre ya estaba');
    }

    // 3. Cabecera: el arrastre suma al ingreso y al cobrado, pero no cambia el origen (E6 mira J2:J4).
    if (!yaCabecera) {
      cabecera[0].setFormula(local('=SUM(K2:K5)'));
      cabecera[1].setFormula(local('=SUM(I2:I5)'));
      cabecera[2].setFormula(local('=SUM(J2:J5)'));
      cabecera[3].setFormula(local('=IF(SUM(J2:J4)=0, "previsto", IF(AND(OR(I2=0, J2>0), OR(I3=0, J3>0)), "cobrado", "parcial"))'));
      Logger.log('✅ Resumen: B4, E4 y E5 suman el arrastre; E6 no lo mira');
    } else {
      Logger.log('· Resumen: la cabecera ya sumaba el arrastre');
    }

    // 4. Restante real: lo cobrado (con el arrastre) menos lo gastado de verdad. Es lo que pasa al mes siguiente.
    if (!yaReal) {
      resumen.getRange('D7').setValue('Restante real');
      resumen.getRange('E7').setFormula(local('=E5-B130-D130')).setNumberFormat('#,##0.00 "€"');
      Logger.log('✅ Resumen: D7:E7 «Restante real»');
    } else {
      Logger.log('· Resumen: el restante real ya estaba');
    }

    // 5. Comprobación con la hoja recalculada (antes de tocar Ingresos y la Guía).
    SpreadsheetApp.flush();
    const k = resumen.getRange('K2:K5').getValues().map((f) => f[0]);
    const b4 = resumen.getRange('B4').getValue();
    const real = resumen.getRange('E7').getValue();
    const [e5, b130, d130] = ['E5', 'B130', 'D130'].map((a) => resumen.getRange(a).getValue());
    if (!k.every((v) => typeof v === 'number') || typeof b4 !== 'number' ||
        Math.round(b4 * 100) !== Math.round(k.reduce((s, v) => s + v, 0) * 100) ||
        typeof real !== 'number' || Math.round(real * 100) !== Math.round((e5 - b130 - d130) * 100) ||
        ['previsto', 'parcial', 'cobrado'].indexOf(resumen.getRange('E6').getValue()) < 0) {
      return deshacer('La hoja no da lo esperado (K2:K5 «' + resumen.getRange('K2:K5').getDisplayValues().map((f) => f[0]).join(' · ') +
                      '», B4 «' + resumen.getRange('B4').getDisplayValue() + '», E7 «' + resumen.getRange('E7').getDisplayValue() +
                      '», E6 «' + resumen.getRange('E6').getDisplayValue() + '»).');
    }

    // 6. Ingresos: el Tipo admite «arrastre» y el Importe solo puede ser negativo en un arrastre.
    const columna = (c) => ingresos.getRange(2, c, ingresos.getMaxRows() - 1, 1);
    const tipos = reglaTipo.getCriteriaValues()[0];
    if (tipos.indexOf('arrastre') < 0) {
      columna(5).setDataValidation(reglaTipo.copy().requireValueInList(tipos.concat('arrastre'), true).build());
      Logger.log('✅ Ingresos: el Tipo admite «arrastre»');
    } else {
      Logger.log('· Ingresos: el Tipo ya admitía «arrastre»');
    }
    const formulaImporte = local('=OR(F2>0, E2="arrastre")');
    if (!reglaImporte || reglaImporte.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.CUSTOM_FORMULA) {
      const base = reglaImporte ? reglaImporte.copy() : SpreadsheetApp.newDataValidation().setAllowInvalid(false);
      columna(6).setDataValidation(base.requireFormulaSatisfied(formulaImporte)
        .setHelpText('Mayor que 0 (solo el arrastre puede ser negativo).').build());
      Logger.log('✅ Ingresos: el Importe puede ser negativo solo en un arrastre');
    } else {
      Logger.log('· Ingresos: la validación del Importe ya estaba');
    }

    // 7. Guía: dos filas nuevas y las descripciones que cambian.
    const filasGuia = guia.getRange(1, 1, guia.getLastRow(), 4).getValues();
    if (!filasGuia.some((f) => f[1] === 'E7 Restante real')) {
      const nuevas = [
        ['Ingresos', 'Tipo «arrastre»', 'Lo que quedó (o faltó, en negativo) del mes anterior. Lo apunta la app al apuntar la nómina de este mes, con la fecha de la nómina; se recalcula desde «Mes» (toca el Ingreso → Recalcular). No lo escribas a mano.', 'Solo la app', '86'],
        ['Resumen', 'E7 Restante real', 'Lo cobrado (E5, con el arrastre) − fijos (B130) − gastos puntuales (D130). Los presupuestos no reservan nada: lo no gastado también pasa. Es lo que se arrastra al mes siguiente.', 'Solo fórmulas: no editar', '']
      ];
      guia.getRange(guia.getLastRow() + 1, 1, nuevas.length, 5).setValues(nuevas);
      const cambiar = (pestana, columnaGuia, col, valor) => {
        const i = filasGuia.findIndex((f) => f[0] === pestana && f[1] === columnaGuia);
        if (i >= 0) guia.getRange(i + 1, col).setValue(valor);
      };
      cambiar('Ingresos', 'Tipo', 4, 'nómina | comisiones | extra | arrastre (solo la app)');
      cambiar('Ingresos', 'Importe', 3, 'Euros, positivo. Una fila por transferencia: la nómina y las comisiones van separadas. Solo el arrastre puede ser negativo.');
      cambiar('Resumen', 'H1:K4 Reparto', 3, 'El ingreso del mes elegido por tipo: previsto, cobrado y lo que cuenta (de cada tipo, lo cobrado si hay; si no, lo previsto). Los extras solo cuentan cobrados. Fila 5: el arrastre del mes anterior (puede ser negativo).');
      cambiar('Resumen', 'H1:K4 Reparto', 2, 'H1:K5 Reparto');
      Logger.log('✅ Guía: 2 filas nuevas y las descripciones de Tipo, Importe y Reparto');
    } else {
      Logger.log('· Guía: las filas ya estaban');
    }

    // 8. Cómo queda el mes que tiene el Resumen.
    SpreadsheetApp.flush();
    Logger.log('✅ ' + resumen.getRange('B1').getValue() + ': ingreso ' + resumen.getRange('B4').getValue() + ' (' +
               resumen.getRange('E6').getValue() + ') · restante ' + resumen.getRange('B6').getValue() + ' · restante real ' +
               resumen.getRange('E7').getValue() + ' (cobrado ' + e5 + ' − fijos ' + b130 + ' − puntuales ' + d130 + ') · B7 = ' +
               resumen.getRange('B7').getValue());
  });
}
