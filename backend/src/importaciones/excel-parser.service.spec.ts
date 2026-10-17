import * as XLSX from 'xlsx';
import { ExcelParserService } from './excel-parser.service';
import { amount, checkContainer, excelDate } from './excel-validation';

function workbookBuffer(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'SEP');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('ExcelParserService', () => {
  const parser = new ExcelParserService();

  it.each([
    ['NOMBRE', 'FECHA', 'P.AÑO'],
    ['FECHA', 'NOMBRE', 'TOTAL'],
    ['FECHA', 'NOMBRE', 'P.AÑO', 'PAGO'],
    ['FECHA', 'NOMBRE', 'P.AÑO', 'NOMBRE'],
  ])('detiene la interpretación tras una cabecera incompatible: %j', (...header) => {
    const sheet = parser.parse(
      workbookBuffer([
        ['FECHA', 'NOMBRE', 'P.AÑO'],
        ['2026-10-16', 'Primero', 75],
        header,
        ['2026-10-17', 'Segundo', 50],
      ]),
    )[0];
    expect(sheet.filas.map((r) => r.filaOrigen)).toEqual([2]);
    expect(sheet.errores).toEqual([expect.stringContaining('Cabecera distinta en fila 3')]);
    expect(sheet.clasificacion).toMatchObject({
      examinadas: 4,
      cabeceras: 2,
      operativas: 1,
      sinClasificar: 1,
    });
  });

  it('no interpreta códigos internos de error de Excel como valores y permite corregirlos', () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['FECHA', 'NOMBRE', 'P.AÑO', 'TOTAL'],
      ['2026-10-16', 'Prueba', 75, 100],
    ]);
    sheet.C2 = { t: 'e', v: 7 }; // #DIV/0!
    sheet.D2 = { t: 'e', v: 23 }; // #REF!
    XLSX.utils.book_append_sheet(book, sheet, 'OCT');
    const row = parser.parse(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))[0].filas[0];
    expect(row.datosNormalizados.importeAnual).toBeNull();
    expect(row.datosNormalizados.total).toBeNull();
    expect(row.lectura.campos.PANO).toMatchObject({ tipo: 'e', valor: 7, estado: 'INVALIDO' });
    expect(row.lectura.incidencias.filter((i) => i.codigo === 'CELDA_ERROR')).toHaveLength(2);
    const corrected = parser.validateRow(row.lectura, { PANO: '75' });
    expect(corrected.datosNormalizados.importeAnual).toBe(75);
    expect(corrected.lectura.incidencias.filter((i) => i.codigo === 'CELDA_ERROR')).toHaveLength(1);
  });

  it('conserva una fila cuyo único contenido es un error de Excel', () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['FECHA', 'NOMBRE'], ['2026-10-16']]);
    sheet.A2 = { t: 'e', v: 7 };
    XLSX.utils.book_append_sheet(book, sheet, 'OCT');
    const result = parser.parse(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))[0];
    expect(result.filas).toHaveLength(1);
    expect(result.clasificacion.operativas).toBe(1);
    expect(result.filas[0].lectura.incidencias.some((i) => i.codigo === 'CELDA_ERROR')).toBe(true);
  });

  it('no copia claves cortas ni direcciones privadas de APP a los campos normalizados', () => {
    const rows = parser.parse(
      workbookBuffer([
        ['FECHA', 'NOMBRE', 'APP'],
        ['2026-10-16', 'Uno', 'MAXPLAYER PIN=ab123 https://privado.test/u/secret'],
        ['2026-10-16', 'Dos', 'DESCONOCIDA clave=abc123'],
      ]),
    )[0].filas;
    expect(rows[0].datosNormalizados.app).toBe('MAXPLAYER');
    expect(rows[1].datosNormalizados.app).toBeNull();
    expect(rows[1].datosNormalizados.productoClave).toBeNull();
    expect(rows[1].lectura.incidencias.some((i) => i.codigo === 'APP_POR_REVISAR')).toBe(true);
    expect(JSON.stringify(rows.map((r) => r.datosNormalizados))).not.toMatch(
      /ab123|abc123|privado/,
    );
    expect(rows[1].datosOriginales.APP).toBe('DESCONOCIDA clave=abc123');
  });

  it('interrumpe un análisis lento y permite reintentar sin dejar la cola ocupada', async () => {
    const buffer = workbookBuffer([
      ['FECHA', 'NOMBRE'],
      ['2026-10-16', 'Cliente ficticio'],
    ]);
    await expect(parser.parseAsync(buffer, 1)).rejects.toThrow(/superó/);
    expect((await parser.parseAsync(buffer))[0].filas).toHaveLength(1);
  }, 30000);

  it('rechaza un ZIP que declara más de 64 MB descomprimidos antes de expandirlo', () => {
    const buffer = workbookBuffer([
      ['FECHA', 'NOMBRE'],
      ['2026-10-16', 'Cliente ficticio'],
    ]);
    const central = buffer.indexOf(Buffer.from('504b0102', 'hex'));
    expect(central).toBeGreaterThan(0);
    buffer.writeUInt32LE(65 * 1024 * 1024, central + 24);
    expect(() => checkContainer(buffer)).toThrow(/descomprimir/);
  });

  it('normaliza variantes conocidas de productos y conserva P.AÑO separado de TOTAL', () => {
    const buffer = workbookBuffer([
      ['FECHA', 'NOMBRE', 'APP', 'SERVIDOR', 'P.AÑO', 'TOTAL', 'PAGO'],
      ['15/09/2027', 'Cliente Uno', 'MAXAPLAYER 00:11:22:33:44:55', 'DEAD', 75, 225, 'STR'],
      ['15/09/2027', 'Cliente Dos', 'K13PLAUER', 'DEAD', 75, 75, 'FREE'],
      ['15/09/2027', 'Cliente Tres', 'KSDPLAYER', 'DEAD', 75, 75, 'GR'],
      ['15/09/2027', 'Cliente Cuatro', 'VUPLER', 'DEAD', 75, 75, 'EF'],
      ['15/09/2027', 'Cliente Cinco', '0PLAYER', 'DEAD', 75, 75, 'EF'],
      ['15/09/2027', 'Cliente Seis', 'BOX-K13-PLAYER', 'DEAD', 75, 75, 'EF'],
    ]);

    const rows = parser.parse(buffer)[0].filas;
    expect(rows.map((row) => row.datosNormalizados.productoClave)).toEqual([
      'MAXPLAYER',
      'K13PLAYER',
      'KDSPLAYER',
      'VUPLAYER',
      '0 PLAYER',
      'K13PLAYER',
    ]);
    expect(rows[0].datosNormalizados.fecha).toBe('2027-09-15');
    expect(rows[0].datosNormalizados.importeAnual).toBe(75);
    expect(rows[0].datosNormalizados.total).toBe(225);
  });

  it('deja como pendiente la información operativa que no puede identificar', () => {
    const buffer = workbookBuffer([
      ['FECHA', 'NOMBRE', 'APP', 'SERVIDOR', 'P.AÑO', 'TOTAL', 'PAGO'],
      ['fecha inválida', 'Cliente', null, null, null, null, null],
    ]);

    const row = parser.parse(buffer)[0].filas[0];
    expect(row.datosNormalizados.fecha).toBeNull();
    expect(row.datosNormalizados.productoClave).toBeNull();
    expect(row.datosNormalizados.importeAnual).toBeNull();
    expect(row.advertencias).toEqual(
      expect.arrayContaining([
        'FECHA ausente o no reconocida.',
        'SERVIDOR ausente.',
        'PAGO ausente: movimiento financiero pendiente.',
        'P.AÑO ausente o inválido: pago anual pendiente.',
      ]),
    );
  });

  it('conserva coordenadas, blancos intermedios, filas sin nombre y clasifica auxiliares', () => {
    const sheet = parser.parse(
      workbookBuffer([
        ['Título'],
        [],
        ['FECHA', 'NOMBRE', 'P.AÑO', 'TOTAL', 999],
        ['15/09/2027', 'Cliente A', 75, 225, 100],
        [],
        ['15/09/2027', null, 75],
        [null, null, null, null, 100],
        ['FECHA', 'NOMBRE', 'P.AÑO', 'TOTAL', 999],
        ['15/09/2027', 'Cliente B', 75, 75],
      ]),
    )[0];
    expect(sheet.filas.map((r) => r.filaOrigen)).toEqual([4, 6, 9]);
    expect(sheet.filas[1].errores).toHaveLength(1);
    expect(sheet.filas[1].lectura.campos.NOMBRE.celda).toBe('B6');
    expect(sheet.clasificacion).toEqual({
      examinadas: 9,
      previas: 2,
      cabeceras: 2,
      vacias: 1,
      auxiliares: 1,
      operativas: 3,
      sinClasificar: 0,
    });
    expect(sheet.filas[0].datosNormalizados.importeAnual).toBe(75);
    expect(sheet.columnasAdicionales).toContain('E: resumen auxiliar');
  });
  it('rechaza cabeceras duplicadas normalizadas y registra hojas sin cabecera', () => {
    expect(
      parser.parse(
        workbookBuffer([
          ['FECHA', 'NOMBRE', 'Teléfono', 'telefono'],
          ['2026-10-16', 'Prueba'],
        ]),
      )[0].errores[0],
    ).toMatch(/duplicada/);
    const invalid = parser.parse(workbookBuffer([['algo'], ['otra fila']]))[0];
    expect(invalid.errores).toHaveLength(1);
    expect(invalid.clasificacion.sinClasificar).toBe(2);
  });
  it('mapea columnas desplazadas y distingue columna ausente, vacío e inválido', () => {
    const row = parser.parse(
      workbookBuffer([
        ['PAGO', 'NOMBRE', 'FECHA', 'TELÉFONO', 'P.AÑO'],
        ['STR', 'Prueba', '31/02/2026', null, 75],
      ]),
    )[0].filas[0];
    expect(row.lectura.campos.SERVIDOR.estado).toBe('COLUMNA_AUSENTE');
    expect(row.lectura.campos.TELEFONO.estado).toBe('VACIO');
    expect(row.lectura.campos.FECHA.estado).toBe('INVALIDO');
    expect(row.datosNormalizados.pagoClave).toBe('STR');
    expect(row.errores).toHaveLength(0);
  });
  it.each([
    ['29/02/2024', '2024-02-29'],
    ['29/02/2025', null],
    ['2026-02-31', null],
    ['2026-10-16T12:00', null],
    ['12/05/2006', '2006-05-12'],
  ])('valida calendario: %s', (input, expected) => expect(excelDate(input, false)).toBe(expected));
  it('respeta el sistema 1904 y rechaza el día inexistente 60 de Excel 1900', () => {
    expect(excelDate(60, false)).toBeNull();
    expect(excelDate(0, true)).toBe('1904-01-01');
    expect(excelDate(1.5, false)).toBeNull();
  });
  it.each([
    ['75,50', 75.5],
    ['1.234,56 €', 1234.56],
    ['1234.56', 1234.56],
    [0.29, 0.29],
    ['75 euros', null],
    ['1,234.56', null],
    ['1.234', null],
    ['1e3', null],
    ['', null],
    ['9999999999', null],
  ])('lee importes sin extraer dígitos ni redondear: %s', (input, expected) =>
    expect(amount(input)).toBe(expected),
  );
  it('preserva PA sin equivalencia y PE impide interpretar un cobro', () => {
    const rows = parser.parse(
      workbookBuffer([
        ['FECHA', 'NOMBRE', 'PAGO', 'ESTADO', 'P.AÑO'],
        ['2026-10-16', 'Uno', 'PA', null, 75],
        ['2026-10-16', 'Dos', 'STR', 'PE', 75],
        ['2026-10-16', 'Tres', null, null, null],
      ]),
    )[0].filas;
    expect(rows[0].datosOriginales.PAGO).toBe('PA');
    expect(rows[0].datosNormalizados.pagoClave).toBeNull();
    expect(rows[1].datosNormalizados.estadoPago).toBe('PENDIENTE');
    expect(rows[1].lectura.incidencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: 'PAGO_PENDIENTE', ambito: 'FINANZAS' }),
      ]),
    );
    expect(rows[2].datosNormalizados.estadoPago).toBe('NO_INFORMADO');
    expect(rows[2].datosNormalizados.importeAnual).toBeNull();
  });
  it('no confunde importe cero con Gratis y detecta contradicciones', () => {
    const rows = parser.parse(
      workbookBuffer([
        ['FECHA', 'NOMBRE', 'PAGO', 'P.AÑO'],
        ['2026-10-16', 'Uno', 'STR', 0],
        ['2026-10-16', 'Dos', 'GR', 75],
        ['2026-10-16', 'Tres', 'FREE', 0],
      ]),
    )[0].filas;
    expect(rows[0].lectura.incidencias.some((i) => i.codigo === 'CERO_NO_GRATUITO')).toBe(true);
    expect(rows[1].lectura.incidencias.some((i) => i.codigo === 'GRATIS_CON_IMPORTE')).toBe(true);
    expect(rows[2].lectura.incidencias.some((i) => i.ambito === 'FINANZAS')).toBe(false);
  });
  it('revalida correcciones sin mutar el original y no trunca nombres', () => {
    const row = parser.parse(
      workbookBuffer([
        ['FECHA', 'NOMBRE', 'ESTADO', 'PAGO', 'P.AÑO'],
        ['31/02/2026', 'x'.repeat(151), 'PE', 'FREE', 75],
      ]),
    )[0].filas[0];
    const before = JSON.stringify(row);
    const result = parser.validateRow(row.lectura, {
      NOMBRE: 'Nombre corregido',
      FECHA: '28/02/2026',
      PANO: '0',
    });
    expect(result.errores).toHaveLength(0);
    expect(result.lectura.incidencias.some((i) => i.codigo === 'GRATIS_CON_IMPORTE')).toBe(false);
    expect(result.lectura.incidencias.some((i) => i.codigo === 'PAGO_PENDIENTE')).toBe(true);
    expect(result.lectura.campos.NOMBRE.valor).toBe('x'.repeat(151));
    expect(JSON.stringify(row)).toBe(before);
  });
  it('identifica fórmula sin caché, error de celda y caché presente sin ejecutar fórmulas', () => {
    const book = XLSX.utils.book_new(),
      sheet = XLSX.utils.aoa_to_sheet([
        ['FECHA', 'NOMBRE', 'P.AÑO', 'TOTAL'],
        ['2026-10-16', 'Prueba', 75, 100],
      ]);
    sheet.C2 = { t: 'n', f: '2+2' };
    sheet.D2 = { t: 'n', f: 'SUM(1,2)', v: 3 };
    XLSX.utils.book_append_sheet(book, sheet, 'ENE');
    const row = parser.parse(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))[0].filas[0];
    expect(row.lectura.incidencias.some((i) => i.codigo === 'FORMULA_SIN_RESULTADO')).toBe(true);
    expect(row.datosNormalizados.total).toBe(3);
    expect(row.lectura.campos.TOTAL.formula).toBe('SUM(1,2)');
  });
  it('rechaza falsos Excel, contenido excesivo y rangos desmesurados', () => {
    expect(() => checkContainer(Buffer.from('a'))).toThrow(/Excel/);
    expect(() => parser.parse(Buffer.from('FECHA,NOMBRE\n2026,Prueba'))).toThrow(/contenido/);
    const book = XLSX.utils.book_new(),
      sheet = XLSX.utils.aoa_to_sheet([['FECHA', 'NOMBRE']]);
    sheet['!ref'] = 'A1:A20001';
    XLSX.utils.book_append_sheet(book, sheet, 'ENE');
    expect(() => parser.parse(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))).toThrow(
      /20.000/,
    );
  });
  it('mantiene teléfonos de texto y bloquea números ambiguos sin inventar identificadores', () => {
    const rows = parser.parse(
      workbookBuffer([
        ['FECHA', 'NOMBRE', 'TELEFONO'],
        ['2026-10-16', 'Uno', '0034612345678'],
        ['2026-10-16', 'Dos', '612345678 / 699999999'],
        ['2026-10-16', 'Tres', null],
      ]),
    )[0].filas;
    expect(rows[0].datosNormalizados.telefonoNormalizado).toBe('34612345678');
    expect(rows[1].datosNormalizados.telefonoNormalizado).toBeNull();
    expect(rows[1].errores).toHaveLength(1);
    expect(rows[2].errores).toHaveLength(0);
  });
});
