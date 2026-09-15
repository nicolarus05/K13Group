import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import {
  cleanOptionalText,
  normalizeComparable,
  normalizeName,
  normalizePhone,
} from '../common/helpers/normalization';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface NormalizedExcelRow {
  fecha: string | null;
  nombre: string;
  nombreClave: string;
  telefono: string | null;
  telefonoNormalizado: string | null;
  servidor: string | null;
  servidorClave: string | null;
  app: string | null;
  productoClave: string | null;
  tipoDispositivo: string | null;
  identificadorOperativoHash: string | null;
  referencia: string | null;
  referenciaClave: string | null;
  importeAnual: number | null;
  total: number | null;
  observaciones: string | null;
  pago: string | null;
  pagoClave: string | null;
}

export interface ParsedExcelRow {
  hojaOrigen: string;
  filaOrigen: number;
  hashFila: string;
  datosOriginales: Record<string, JsonValue>;
  datosNormalizados: NormalizedExcelRow;
  errores: string[];
  advertencias: string[];
}

export interface ParsedExcelSheet {
  hoja: string;
  filas: ParsedExcelRow[];
  errores: string[];
}

const EXPECTED_SHEETS = new Set([
  'ENE',
  'FEB',
  'MAR',
  'ABR',
  'MAY',
  'JUN',
  'JUL',
  'AGO',
  'SEP',
  'OCT',
  'NOV',
  'DIC',
]);

const PRODUCT_ALIASES = [
  'MAXPLAYER',
  'K13PLAYER',
  'K13TIVI',
  'KDSPLAYER',
  'K13IBO39',
  'SMARTONE',
  'VUPLAYER',
  'K13 PLAYER',
  'K13`PLAYER',
  'K13PLAUER',
  'K13IB39',
  'KSDPLAYER',
  'VUPLER',
  '0PLAYER',
  'DUPLECAST',
  'DUPELCAST',
  'DUPLEXPLAY',
  'DUPLEX',
  'ARC PLAYER',
  'IBOPLAYER',
  'IBO PLAYER',
  'BOBPLAYER',
  'BOB PLAYER',
  'DEADPLAYER',
  'K13GROUP',
  'K13YOUTIVI',
  'K13TVPLAYER',
  'K13TV3',
  'K13TV2',
  'K13TV1',
  'K13TV',
  'K13WIN',
  'K13SMART',
  'CASTORA',
  'SET IPTV',
  'IPTV EXTREME',
  'VARPLAYER',
  'VAR PLAYER',
  '0 PLAYER',
  '000 PLAYER',
  'WEBPLAYER',
  'SMARTERS',
  'NEXT+',
  'SPLAYER',
  'S PLAYER',
  'STB IBO',
  'IBO',
];

const MAC_PATTERN = /(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}/i;

function jsonValue(value: unknown): JsonValue {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

function headerKey(value: unknown): string {
  return normalizeComparable(value).replace(/[^A-Z0-9]/g, '');
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = cleanOptionalText(value);
  if (!text) return null;

  const numeric = text.replace(/[^0-9,.-]/g, '');
  if (!numeric) return null;
  const normalized = numeric.includes(',')
    ? numeric.replace(/\./g, '').replace(',', '.')
    : numeric.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateFromSerial(value: number): string | null {
  const parts = XLSX.SSF.parse_date_code(value);
  if (!parts || !parts.y || !parts.m || !parts.d) return null;
  return `${String(parts.y).padStart(4, '0')}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Excel almacena la fecha en la zona horaria local. Usar ISO aquí puede
    // desplazarla al día anterior en España por la conversión a UTC.
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number') return dateFromSerial(value);

  const text = cleanOptionalText(value);
  if (!text) return null;
  const european = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (european) {
    return `${european[3]}-${european[2].padStart(2, '0')}-${european[1].padStart(2, '0')}`;
  }
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return null;
}

function extractProduct(value: string | null): string | null {
  if (!value) return null;
  const maxPlayerTypos = ['MAXAPLAYER', 'MAXLPAYER', 'MAXPLER', 'MAXPLEYER', 'MAAXPLAYER', 'MAPLXAYER'];
  if (maxPlayerTypos.some((alias) => value.includes(alias))) return 'MAXPLAYER';
  if (value.includes('K13 PLAYER') || value.includes('K13-PLAYER') || value.includes('K13`PLAYER') || value.includes('K13PLAUER')) return 'K13PLAYER';
  if (value.includes('K13IB39')) return 'K13IBO39';
  if (value.includes('KSDPLAYER')) return 'KDSPLAYER';
  if (value.includes('VUPLER')) return 'VUPLAYER';
  if (value.includes('0PLAYER')) return '0 PLAYER';
  const known = PRODUCT_ALIASES.find((alias) => value.includes(alias));
  if (known) return known;
  const cleaned = value
    .replace(/\[ID\]/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ')
    .replace(/[|:]/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\b(ANDROID|APPLE|SMART) TV\b/g, ' ')
    .replace(/\b(BOX|TV|FIRESTICK|MEECOOL)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

function sanitizeApp(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(MAC_PATTERN, '[ID]')
    .replace(/\b[A-Z0-9]{12,}\b/gi, '[ID]')
    .trim();
}

function extractDevice(value: string | null): string | null {
  if (!value) return null;
  if (value.includes('MEECOOL')) return 'MEECOOL';
  if (value.includes('SMART TV') || value.includes('SMARTTV')) return 'SMART TV';
  if (value.includes('BOX')) return 'BOX';
  if (value.includes('TV')) return 'TV';
  return null;
}

function extractIdentifierHash(value: string | null): string | null {
  if (!value) return null;
  const mac = value.match(MAC_PATTERN)?.[0];
  if (!mac) return null;
  return createHash('sha256').update(mac.replace(/[:-]/g, '').toUpperCase()).digest('hex');
}

function getValue(row: unknown[], indexes: Map<string, number>, key: string): unknown {
  const index = indexes.get(key);
  return index === undefined ? null : row[index];
}

@Injectable()
export class ExcelParserService {
  parse(buffer: Buffer): ParsedExcelSheet[] {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true });
    } catch {
      throw new Error('El archivo no es un Excel válido o está dañado.');
    }

    return workbook.SheetNames.map((sheetName) => this.parseSheet(workbook, sheetName));
  }

  private parseSheet(workbook: XLSX.WorkBook, sheetName: string): ParsedExcelSheet {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: false,
    });
    const headerIndex = rows.findIndex((row) => {
      const keys = row.map(headerKey);
      return keys.includes('NOMBRE') && keys.includes('FECHA');
    });

    if (headerIndex < 0) {
      return {
        hoja: sheetName,
        filas: [],
        errores: [`La hoja ${sheetName} no contiene las columnas FECHA y NOMBRE.`],
      };
    }

    const headers = rows[headerIndex].map((value, index) => {
      const original = cleanOptionalText(value);
      return original || `COLUMNA_${index + 1}`;
    });
    const indexes = new Map<string, number>();
    headers.forEach((header, index) => indexes.set(headerKey(header), index));
    const parsedRows: ParsedExcelRow[] = [];

    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      const raw = Object.fromEntries(
        headers.map((header, columnIndex) => [header, jsonValue(row[columnIndex])]),
      ) as Record<string, JsonValue>;
      const nombre = cleanOptionalText(getValue(row, indexes, 'NOMBRE'));
      if (!nombre) continue;

      const telefono = cleanOptionalText(getValue(row, indexes, 'TELEFONO'));
      const app = cleanOptionalText(getValue(row, indexes, 'APP'));
      const servidor = cleanOptionalText(getValue(row, indexes, 'SERVIDOR'));
      const referencia = cleanOptionalText(getValue(row, indexes, 'REFERENCIA'));
      const pago = cleanOptionalText(getValue(row, indexes, 'PAGO'));
      const fecha = parseDate(getValue(row, indexes, 'FECHA'));
      const total = parseAmount(getValue(row, indexes, 'TOTAL'));
      const importeAnual = parseAmount(getValue(row, indexes, 'PANO'));
      const appClave = sanitizeApp(normalizeComparable(app)) || null;
      const normalized: NormalizedExcelRow = {
        fecha,
        nombre,
        nombreClave: normalizeName(nombre),
        telefono,
        telefonoNormalizado: normalizePhone(telefono),
        servidor,
        servidorClave: servidor ? normalizeComparable(servidor) : null,
        app: appClave,
        productoClave: extractProduct(appClave),
        tipoDispositivo: extractDevice(appClave),
        identificadorOperativoHash: extractIdentifierHash(app),
        referencia,
        referenciaClave: referencia ? normalizeComparable(referencia) : null,
        importeAnual,
        total,
        observaciones: cleanOptionalText(getValue(row, indexes, 'OBSERV')),
        pago,
        pagoClave: pago ? normalizeComparable(pago) : null,
      };

      const advertencias: string[] = [];
      if (!fecha) advertencias.push('FECHA ausente o no reconocida.');
      if (!telefono) advertencias.push('Sin teléfono: la identidad requiere revisión.');
      if (!servidor) advertencias.push('SERVIDOR ausente.');
      if (!app) advertencias.push('APP ausente.');
      if (!referencia) advertencias.push('REFERENCIA ausente.');
      if (!pago) advertencias.push('PAGO ausente: movimiento financiero pendiente.');
      if (importeAnual === null) advertencias.push('P.AÑO ausente: pago anual pendiente.');
      if (total === null) advertencias.push('TOTAL ausente: no se podrá validar el acumulado histórico.');
      if (fecha && (Number(fecha.slice(0, 4)) < 2020 || Number(fecha.slice(0, 4)) > new Date().getFullYear() + 1)) {
        advertencias.push('Fecha fuera del periodo operativo habitual: revisar.');
      }
      if (sheetName && !EXPECTED_SHEETS.has(normalizeComparable(sheetName))) {
        advertencias.push('Hoja no perteneciente al calendario mensual esperado.');
      }

      const datosParaHash = JSON.stringify({ hoja: sheetName, fila: index + 1, raw });
      parsedRows.push({
        hojaOrigen: sheetName,
        filaOrigen: index + 1,
        hashFila: createHash('sha256').update(datosParaHash).digest('hex'),
        datosOriginales: raw,
        datosNormalizados: normalized,
        errores: [],
        advertencias,
      });
    }

    return { hoja: sheetName, filas: parsedRows, errores: [] };
  }
}
