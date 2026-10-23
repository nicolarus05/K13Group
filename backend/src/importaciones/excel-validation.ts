import * as XLSX from 'xlsx';

export const PARSER_VERSION = '12.1.0';
export const FIELDS = [
  'FECHA',
  'NOMBRE',
  'TELEFONO',
  'EMAIL',
  'SERVIDOR',
  'APP',
  'REFERENCIA',
  'PANO',
  'TOTAL',
  'OBSERV',
  'PAGO',
  'ESTADO',
] as const;
export type Field = (typeof FIELDS)[number];
export type Scope = 'CLIENTE' | 'SUSCRIPCION' | 'FINANZAS' | 'AVISO';
export type CellValue = string | number | boolean | null;
export interface SourceCell {
  celda: string | null;
  encabezado: string;
  valor: CellValue;
  tipo: string | null;
  formula?: string;
  estado: 'COLUMNA_AUSENTE' | 'VACIO' | 'PRESENTE' | 'INVALIDO';
}
export interface Issue {
  codigo: string;
  campo: Field;
  celda: string | null;
  ambito: Scope;
  mensaje: string;
}
export interface RowReading {
  campos: Record<Field, SourceCell>;
  incidencias: Issue[];
  date1904: boolean;
  anoReferencia: number;
}
export type Corrections = Partial<Record<Field, string | null>>;

export function headerKey(value: unknown): string {
  const key = String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return (
    (
      {
        OBSERVACIONES: 'OBSERV',
        OBSERVACION: 'OBSERV',
        CORREO: 'EMAIL',
        CORREOELECTRONICO: 'EMAIL',
        IMPORTEANUAL: 'PANO',
      } as Record<string, string>
    )[key] ?? key
  );
}

// Decimal exacto expresado en céntimos. Rechaza separadores ambiguos y no redondea.
export function amount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim().replace(/\s*€$/, '').trim();
  let canonical: string;
  if (/^-?\d+(?:[.,]\d{1,2})?$/.test(text)) canonical = text.replace(',', '.');
  else if (/^-?\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(text))
    canonical = text.replace(/\./g, '').replace(',', '.');
  else return null;
  const [whole, fraction = ''] = canonical.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 9999999999) return null;
  return (canonical.startsWith('-') ? -cents : cents) / 100;
}

function validDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d)
    return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function excelDate(value: unknown, date1904: boolean): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return null;
    const parts = XLSX.SSF.parse_date_code(value, { date1904 });
    return parts ? validDate(parts.y, parts.m, parts.d) : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const eu = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (eu) return validDate(Number(eu[3]), Number(eu[2]), Number(eu[1]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return iso ? validDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) : null;
}

// Evita expandir ZIP enormes antes de invocar SheetJS. No acepta ZIP64 ni cifrados.
export function checkContainer(buffer: Buffer) {
  if (buffer.length < 8 || buffer.length > 10 * 1024 ** 2)
    throw new Error('Selecciona un Excel de hasta 10 MB.');
  if (buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) return;
  if (buffer.readUInt16LE(0) !== 0x4b50)
    throw new Error('El contenido no corresponde a un archivo Excel XLSX o XLS.');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (
      buffer.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + buffer.readUInt16LE(i + 20) === buffer.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('El archivo XLSX está incompleto.');
  const entries = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16),
    total = 0,
    workbook = false;
  if (entries > 2048 || buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0)
    throw new Error('El libro supera los límites de estructura.');
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('Estructura XLSX inválida.');
    const size = buffer.readUInt32LE(offset + 24),
      length = buffer.readUInt16LE(offset + 28);
    total += size;
    if (total > 64 * 1024 ** 2 || buffer.readUInt16LE(offset + 8) & 1)
      throw new Error('Libro cifrado o demasiado grande al descomprimir (máximo 64 MB).');
    const name = buffer.toString('utf8', offset + 46, offset + 46 + length);
    if (name === 'xl/workbook.xml') workbook = true;
    offset += 46 + length + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  if (!workbook || offset > end) throw new Error('El archivo no contiene un libro XLSX válido.');
}
