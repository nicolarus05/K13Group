import * as ExcelJS from 'exceljs';
import { csvCell, ExportDocument, renderDocument } from './export-document';

describe('Documentos de exportación', () => {
  const data: ExportDocument = {
    title: 'Ensayo Áéñ',
    generated: '2026-10-20T10:00:00.000Z',
    filters: 'Sin filtros',
    tables: [
      {
        name: 'Clientes',
        columns: ['Nombre', 'Teléfono', 'Importe', 'Vacío', 'Fecha'],
        types: [undefined, undefined, 'money', undefined, 'date'],
        rows: [
          ['=1+1', '0012345', 0, null, '2026-10-20'],
          ['Áéñ;"\nlínea', '+34123456789', 25.1, null, null],
        ],
      },
    ],
  };
  it('CSV protege fórmulas incluso tras controles y escapa comillas y saltos sin convertir cero en vacío', async () => {
    for (const text of ['=1+1', '  +1', '\t@SUM(A1)', '\r-1'])
      expect(csvCell(text)).toContain('"\'');
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell(-12.5)).toBe('"-12.5"');
    expect(csvCell(null)).toBe('""');
    const csv = (await renderDocument(data, 'csv')).toString('utf8');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Áéñ;""\nlínea"');
    expect(csv).toContain('"0012345"');
  });
  it('Excel conserva texto literal, fechas, vacíos y números; contiene filtro y cabecera inmovilizada', async () => {
    const buffer = await renderDocument(data, 'xlsx');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = book.getWorksheet('Clientes')!;
    expect(sheet.getCell('A2').value).toBe('=1+1');
    expect(sheet.getCell('A2').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('B2').value).toBe('0012345');
    expect(sheet.getCell('C2').value).toBe(0);
    expect(sheet.getCell('D2').value).toBeNull();
    expect(sheet.getCell('E2').value).toEqual(new Date('2026-10-20T00:00:00Z'));
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
  });
  it('PDF produce un documento paginado para columnas anchas y textos extensos', async () => {
    const buffer = await renderDocument(
      {
        ...data,
        tables: [
          {
            name: 'Ensayo',
            columns: Array.from({ length: 12 }, (_, i) => `Columna ${i}`),
            rows: [Array.from({ length: 12 }, () => 'áéíóú ñ € texto largo '.repeat(80))],
          },
        ],
      },
      'pdf',
    );
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.toString('latin1')).toMatch(/\/Count [2-9]\d*/);
  });
});
