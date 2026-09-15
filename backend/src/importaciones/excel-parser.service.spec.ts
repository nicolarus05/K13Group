import * as XLSX from 'xlsx';
import { ExcelParserService } from './excel-parser.service';

function workbookBuffer(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'SEP');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('ExcelParserService', () => {
  const parser = new ExcelParserService();

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
    expect(row.advertencias).toEqual(expect.arrayContaining([
      'FECHA ausente o no reconocida.',
      'SERVIDOR ausente.',
      'PAGO ausente: movimiento financiero pendiente.',
      'P.AÑO ausente: pago anual pendiente.',
    ]));
  });
});
