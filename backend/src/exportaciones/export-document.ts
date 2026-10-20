import * as ExcelJS from 'exceljs';
import PDFDocument = require('pdfkit');
import { Readable } from 'node:stream';
import { resolve as resolvePath } from 'node:path';

export type Cell = string | number | boolean | null;
export type Table = {
  name: string;
  columns: string[];
  rows: Cell[][];
  types?: ('money' | 'date' | undefined)[];
};
export type ExportDocument = { title: string; generated: string; filters: string; tables: Table[] };
export const MAX_BYTES = 20 * 1024 * 1024;

// Untrusted text is never a spreadsheet formula. CSV additionally needs a
// prefix because applications infer the cell type even inside quoted fields.
export function csvCell(value: Cell) {
  let s = value === null ? '' : String(value);
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/u.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export async function renderDocument(data: ExportDocument, format: 'xlsx' | 'csv' | 'pdf') {
  if (format === 'csv') {
    const columns = [...new Set(data.tables.flatMap((t) => t.columns))];
    const rows: Cell[][] = [['Tabla', ...columns]];
    for (const table of data.tables)
      for (const row of table.rows)
        rows.push([
          table.name,
          ...columns.map((c) => {
            const i = table.columns.indexOf(c);
            return i < 0 ? null : row[i];
          }),
        ]);
    return Buffer.from('\uFEFF' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n');
  }
  if (format === 'xlsx') {
    const book = new ExcelJS.Workbook();
    book.creator = 'K13Group';
    book.created = new Date(data.generated);
    const context = book.addWorksheet('Información');
    context.columns = [{ width: 25 }, { width: 95 }];
    context.addRows([
      ['Informe', data.title],
      ['Generado', data.generated],
      ['Filtros', data.filters],
      ['Alcance', 'Todos los resultados filtrados. Los campos ausentes quedan vacíos.'],
    ]);
    for (const table of data.tables) {
      const sheet = book.addWorksheet(table.name.slice(0, 31), {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      sheet.columns = table.columns.map((header) => ({
        header,
        width: Math.min(38, Math.max(18, header.length + 2)),
      }));
      sheet.addRows(
        table.rows.map((row) =>
          row.map((v, i) =>
            v !== null && table.types?.[i] === 'date' ? new Date(String(v) + 'T00:00:00Z') : v,
          ),
        ),
      );
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, sheet.rowCount), column: table.columns.length },
      };
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16324F' } };
      sheet.eachRow((row, index) => {
        if (index > 1)
          row.eachCell((cell, column) => {
            if (typeof cell.value === 'string') cell.numFmt = '@';
            if (typeof cell.value === 'number' && !Number.isInteger(cell.value))
              cell.numFmt = '0.00';
            if (table.types?.[column - 1] === 'money') cell.numFmt = '0.00';
            if (table.types?.[column - 1] === 'date') cell.numFmt = 'yyyy-mm-dd';
            cell.alignment = { vertical: 'top', wrapText: true };
          });
      });
    }
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 36,
      autoFirstPage: false,
      info: { Title: data.title, Author: 'K13Group' },
    });
    const chunks: Buffer[] = [];
    doc.registerFont('Body', resolvePath(process.cwd(), 'assets/fonts/DejaVuSans.ttf'));
    doc.registerFont('Bold', resolvePath(process.cwd(), 'assets/fonts/DejaVuSans-Bold.ttf'));
    let bytes = 0,
      page = 0;
    doc.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES)
        (doc as unknown as Readable).destroy(new Error('El PDF supera el tamaño permitido.'));
      else chunks.push(chunk);
    });
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const addPage = (subtitle: string) => {
      if (++page > 300) throw new Error('El PDF supera las 300 páginas. Acota los filtros.');
      doc.addPage();
      doc.font('Bold').fontSize(14).text(data.title, 36, 25);
      doc.font('Body').fontSize(8).text(`Generado: ${data.generated} · Página ${page}`, 36, 46);
      doc.fontSize(10).text(subtitle, 36, 65);
    };
    try {
      addPage('Filtros y alcance');
      doc.fontSize(10).text(data.filters, 36, 90, { width: 760 });
      doc
        .moveDown()
        .text(
          'Todos los resultados filtrados. Fechas de negocio en formato AAAA-MM-DD. Campos ausentes vacíos.',
        );
      for (const table of data.tables) {
        // Wide tables are split into column groups; the first column and row
        // number identify each record in every group.
        const groups: number[][] = [];
        for (let start = 1; start < table.columns.length; start += 5)
          groups.push([0, ...table.columns.map((_, i) => i).slice(start, start + 5)]);
        if (!groups.length) groups.push([0]);
        for (const [groupIndex, indices] of groups.entries()) {
          const width = 728 / indices.length,
            lineHeight = 12;
          let y = 110;
          const heading = () => {
            addPage(`${table.name} · columnas ${groupIndex + 1}/${groups.length}`);
            doc.font('Bold').fontSize(8).text('N.º', 36, 89);
            indices.forEach((i, j) =>
              doc.text(table.columns[i], 72 + j * width, 86, { width: width - 8 }),
            );
            doc.font('Body').fontSize(8);
            y = 120;
          };
          heading();
          if (!table.rows.length) doc.text('Sin resultados.', 36, y);
          const wrap = (value: Cell): string[] => {
            const result: string[] = [];
            for (const paragraph of String(value ?? '').split(/\r?\n/)) {
              let line = '';
              for (const character of paragraph) {
                if (line && doc.widthOfString(line + character) > width - 10) {
                  result.push(line);
                  line = '';
                }
                line += character;
              }
              result.push(line);
            }
            return result;
          };
          table.rows.forEach((row, index) => {
            const cells = indices.map((i) => wrap(row[i]));
            const lines = Math.max(...cells.map((c) => c.length));
            for (let l = 0; l < lines;) {
              if (y + lineHeight > 548) heading();
              const count = Math.min(lines - l, Math.floor((548 - y) / lineHeight));
              doc.text(String(index + 1), 36, y, { lineBreak: false });
              cells.forEach((cell, j) => {
                for (let k = 0; k < count; k++)
                  doc.text(cell[l + k] ?? '', 72 + j * width, y + k * lineHeight, {
                    lineBreak: false,
                  });
              });
              y += count * lineHeight;
              l += count;
            }
            y += 7;
          });
        }
      }
      doc.end();
    } catch (error) {
      (doc as unknown as Readable).destroy();
      reject(error);
    }
  });
}
