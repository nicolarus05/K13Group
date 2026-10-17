import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { Worker } from 'node:worker_threads';
import {
  amount,
  checkContainer,
  excelDate,
  FIELDS,
  Field,
  headerKey,
  RowReading,
  Corrections,
  SourceCell,
  Scope,
} from './excel-validation';
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
  estadoPago?: 'PENDIENTE' | 'NO_INFORMADO' | 'DESCONOCIDO';
}

export interface ParsedExcelRow {
  hojaOrigen: string;
  filaOrigen: number;
  hashFila: string;
  datosOriginales: Record<string, JsonValue>;
  datosNormalizados: NormalizedExcelRow;
  errores: string[];
  advertencias: string[];
  lectura: RowReading;
}

export interface ParsedExcelSheet {
  hoja: string;
  filas: ParsedExcelRow[];
  errores: string[];
  cabecera: number | null;
  columnasAusentes: string[];
  columnasAdicionales: string[];
  clasificacion: {
    examinadas: number;
    previas: number;
    cabeceras: number;
    vacias: number;
    auxiliares: number;
    operativas: number;
    sinClasificar: number;
  };
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

function extractProduct(value: string | null): string | null {
  if (!value) return null;
  const maxPlayerTypos = [
    'MAXAPLAYER',
    'MAXLPAYER',
    'MAXPLER',
    'MAXPLEYER',
    'MAAXPLAYER',
    'MAPLXAYER',
  ];
  if (maxPlayerTypos.some((alias) => value.includes(alias))) return 'MAXPLAYER';
  if (
    value.includes('K13 PLAYER') ||
    value.includes('K13-PLAYER') ||
    value.includes('K13`PLAYER') ||
    value.includes('K13PLAUER')
  )
    return 'K13PLAYER';
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
    .replace(new RegExp(MAC_PATTERN.source, 'gi'), '[ID]')
    .replace(/\b[A-Z0-9]{12,}\b/gi, '[ID]')
    .trim();
}

// Solo se exponen nombres de catálogo, nunca el texto libre operativo de APP.
export function publicAppLabel(value: unknown): string | null {
  const text = cleanOptionalText(value);
  if (!text) return null;
  const product = extractProduct(normalizeComparable(text));
  return PRODUCT_ALIASES.includes(product ?? '') ? product : '[DATO OPERATIVO PROTEGIDO]';
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

@Injectable()
export class ExcelParserService {
  private active = 0;
  async parseAsync(buffer: Buffer, timeoutMs = 20000): Promise<ParsedExcelSheet[]> {
    checkContainer(buffer);
    if (this.active >= 2) throw new Error('Hay dos análisis en curso. Reintenta en unos segundos.');
    this.active++;
    try {
      return await new Promise<ParsedExcelSheet[]>((resolve, reject) => {
        const worker = new Worker(
          `const {parentPort,workerData}=require('node:worker_threads');
          try { const {ExcelParserService}=require(workerData.module); parentPort.postMessage({sheets:new ExcelParserService().parse(Buffer.from(workerData.buffer))}); }
          catch { parentPort.postMessage({error:'No se pudo analizar el libro. Comprueba su estructura y los límites de lectura.'}); }`,
          {
            eval: true,
            workerData: { module: __filename, buffer },
            execArgv: __filename.endsWith('.ts') ? ['-r', 'ts-node/register'] : [],
            resourceLimits: { maxOldGenerationSizeMb: 512 },
          },
        );
        const timer = setTimeout(() => {
          void worker.terminate();
          reject(new Error('El análisis superó los 20 segundos. Divide el libro y reintenta.'));
        }, timeoutMs);
        worker.once('message', (result: { sheets?: ParsedExcelSheet[]; error?: string }) => {
          clearTimeout(timer);
          void worker.terminate();
          if (result.sheets) resolve(result.sheets);
          else reject(new Error(result.error));
        });
        worker.once('error', () => {
          clearTimeout(timer);
          reject(new Error('El análisis no pudo completarse dentro de los límites de memoria.'));
        });
        worker.once('exit', () => {
          clearTimeout(timer);
          reject(new Error('Análisis interrumpido. Puedes volver a intentarlo.'));
        });
      });
    } finally {
      this.active--;
    }
  }
  parse(buffer: Buffer): ParsedExcelSheet[] {
    checkContainer(buffer);
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: false,
        raw: true,
        cellFormula: true,
        sheetStubs: true,
      });
    } catch {
      throw new Error('El archivo no es un Excel válido o está dañado.');
    }
    if (!workbook.SheetNames.length || workbook.SheetNames.length > 24)
      throw new Error('El libro debe contener entre 1 y 24 hojas.');
    let cells = 0;
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
      if (range.e.r >= 20000 || range.e.c >= 64)
        throw new Error('Máximo 20.000 filas y 64 columnas por hoja.');
      cells += (range.e.r + 1) * (range.e.c + 1);
      if (cells > 500000) throw new Error('El libro supera las 500.000 celdas de lectura.');
      for (const [key, cell] of Object.entries(sheet)) {
        if (
          !key.startsWith('!') &&
          (String(cell.v ?? '').length > 10000 || String(cell.f ?? '').length > 10000)
        )
          throw new Error('Una celda supera los 10.000 caracteres.');
      }
    }
    const sheets = workbook.SheetNames.map((sheetName) => this.parseSheet(workbook, sheetName));
    if (sheets.reduce((n, s) => n + s.filas.length, 0) > 10000)
      throw new Error('Máximo 10.000 filas operativas por archivo. Divide el libro.');
    return sheets;
  }

  private parseSheet(workbook: XLSX.WorkBook, sheetName: string): ParsedExcelSheet {
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1');
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      range: { s: { r: 0, c: 0 }, e: range.e },
      defval: null,
      raw: true,
      blankrows: true,
    });
    const result: ParsedExcelSheet = {
      hoja: sheetName,
      filas: [],
      errores: [],
      cabecera: null,
      columnasAusentes: [],
      columnasAdicionales: [],
      clasificacion: {
        examinadas: rows.length,
        previas: 0,
        cabeceras: 0,
        vacias: 0,
        auxiliares: 0,
        operativas: 0,
        sinClasificar: 0,
      },
    };
    const headerIndex = rows.findIndex(
      (row) => row.map(headerKey).includes('NOMBRE') && row.map(headerKey).includes('FECHA'),
    );
    if (headerIndex < 0) {
      result.errores.push('La hoja no contiene una cabecera con FECHA y NOMBRE.');
      result.clasificacion.sinClasificar = rows.length;
      return result;
    }
    result.cabecera = headerIndex + 1;
    result.clasificacion.previas = headerIndex;
    result.clasificacion.cabeceras = 1;
    const indexes = new Map<string, number>();
    rows[headerIndex].forEach((value, column) => {
      const key = headerKey(value);
      if ((FIELDS as readonly string[]).includes(key)) {
        if (indexes.has(key))
          result.errores.push(`La columna ${key} está duplicada; corrige la cabecera.`);
        indexes.set(key, column);
      } else if (value !== null)
        result.columnasAdicionales.push(
          `${XLSX.utils.encode_col(column)}: ${typeof value === 'number' ? 'resumen auxiliar' : String(value).slice(0, 100)}`,
        );
    });
    result.columnasAusentes = FIELDS.filter((key) => !indexes.has(key));
    if (result.errores.length) {
      result.clasificacion.sinClasificar = rows.length - headerIndex - 1;
      return result;
    }
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      const has = (column: number) =>
        cleanOptionalText(row[column]) !== null ||
        worksheet[XLSX.utils.encode_cell({ r: index, c: column })]?.t === 'e' ||
        Boolean(worksheet[XLSX.utils.encode_cell({ r: index, c: column })]?.f);
      const header = row.map(headerKey);
      if (header.includes('NOMBRE') && header.includes('FECHA')) {
        const same =
          [...indexes].every(([key, column]) => header[column] === key) &&
          header.every(
            (key, column) =>
              !(FIELDS as readonly string[]).includes(key) || indexes.get(key) === column,
          );
        result.clasificacion.cabeceras++;
        if (!same) {
          result.errores.push(
            `Cabecera distinta en fila ${index + 1}; divide la hoja o unifica las columnas.`,
          );
          // No interpretar las filas restantes con un mapa de columnas que ya no es fiable.
          result.clasificacion.sinClasificar = rows.length - index - 1;
          break;
        }
        continue;
      }
      if (![...indexes.values()].some(has)) {
        if (row.some((_, column) => has(column))) result.clasificacion.auxiliares++;
        else result.clasificacion.vacias++;
        continue;
      }
      const campos = Object.fromEntries(
        FIELDS.map((key) => {
          const column = indexes.get(key);
          const address =
            column === undefined ? null : XLSX.utils.encode_cell({ r: index, c: column });
          const cell = address ? worksheet[address] : undefined;
          return [
            key,
            {
              celda: address,
              encabezado: column === undefined ? key : String(rows[headerIndex][column]),
              valor: cell?.t === 'z' ? null : jsonValue(cell?.v),
              tipo: cell?.t ?? null,
              ...(cell?.f ? { formula: cell.f } : {}),
              estado:
                column === undefined
                  ? 'COLUMNA_AUSENTE'
                  : cleanOptionalText(cell?.v) === null
                    ? 'VACIO'
                    : 'PRESENTE',
            },
          ];
        }),
      ) as Record<Field, SourceCell>;
      const lectura: RowReading = {
        campos,
        incidencias: [],
        date1904: Boolean(workbook.Workbook?.WBProps?.date1904),
        anoReferencia: new Date().getUTCFullYear(),
      };
      const validated = this.validateRow(lectura);
      const raw = Object.fromEntries(
        FIELDS.filter((key) => indexes.has(key)).map((key) => [
          campos[key].encabezado,
          campos[key].valor,
        ]),
      );
      if (!EXPECTED_SHEETS.has(normalizeComparable(sheetName)))
        validated.advertencias.push('Hoja no perteneciente al calendario mensual esperado.');
      result.filas.push({
        hojaOrigen: sheetName,
        filaOrigen: index + 1,
        hashFila: createHash('sha256')
          .update(JSON.stringify({ hoja: sheetName, fila: index + 1, campos }))
          .digest('hex'),
        datosOriginales: raw,
        ...validated,
      });
      result.clasificacion.operativas++;
    }
    return result;
  }

  validateRow(original: RowReading, corrections: Corrections = {}) {
    const lectura: RowReading = JSON.parse(JSON.stringify(original));
    lectura.incidencias = [];
    const value = (key: Field) =>
      Object.prototype.hasOwnProperty.call(corrections, key)
        ? corrections[key]
        : original.campos[key].tipo === 'e'
          ? null
          : original.campos[key].valor;
    const text = (key: Field) => cleanOptionalText(value(key));
    const issue = (
      campo: Field,
      codigo: string,
      ambito: Scope,
      mensaje: string,
      invalid = false,
    ) => {
      lectura.incidencias.push({
        campo,
        codigo,
        ambito,
        mensaje,
        celda: original.campos[campo].celda,
      });
      if (invalid) lectura.campos[campo].estado = 'INVALIDO';
    };
    const scope = (key: Field): Scope =>
      ['NOMBRE', 'TELEFONO', 'EMAIL'].includes(key)
        ? 'CLIENTE'
        : ['FECHA', 'SERVIDOR', 'APP'].includes(key)
          ? 'SUSCRIPCION'
          : ['PANO', 'PAGO', 'ESTADO'].includes(key)
            ? 'FINANZAS'
            : 'AVISO';
    for (const key of FIELDS) {
      const source = original.campos[key];
      lectura.campos[key].estado = Object.prototype.hasOwnProperty.call(corrections, key)
        ? text(key) === null
          ? 'VACIO'
          : 'PRESENTE'
        : source.celda === null
          ? 'COLUMNA_AUSENTE'
          : cleanOptionalText(source.valor) === null
            ? 'VACIO'
            : 'PRESENTE';
      if (!Object.prototype.hasOwnProperty.call(corrections, key)) {
        if (source.tipo === 'e')
          issue(
            key,
            'CELDA_ERROR',
            scope(key),
            'La celda contiene un error de Excel. Corrige el valor.',
            true,
          );
        if (source.formula) {
          if (source.valor === null)
            issue(
              key,
              'FORMULA_SIN_RESULTADO',
              scope(key),
              'Fórmula sin resultado almacenado. Recalcula y guarda el Excel o corrige el valor.',
              true,
            );
          else
            issue(
              key,
              'FORMULA_CACHE',
              'AVISO',
              'Resultado almacenado de una fórmula; no se ha recalculado.',
            );
        }
      }
    }
    const nombre = (text('NOMBRE') ?? '').replace(/\s+/g, ' ');
    if (nombre.length < 2 || nombre.length > 150)
      issue(
        'NOMBRE',
        'NOMBRE_INVALIDO',
        'CLIENTE',
        'Nombre obligatorio de 2 a 150 caracteres; corrige la identidad.',
        true,
      );
    const telefono = text('TELEFONO');
    let phone = normalizePhone(telefono);
    if (!telefono)
      issue(
        'TELEFONO',
        'TELEFONO_AUSENTE',
        'AVISO',
        'Sin teléfono: la identidad requiere revisión.',
      );
    else if (
      !/^\+?[\d ()-]+$/.test(telefono) ||
      !phone ||
      phone.length > 15 ||
      telefono.length > 30 ||
      (typeof value('TELEFONO') === 'number' && !Number.isSafeInteger(value('TELEFONO')))
    ) {
      phone = null;
      issue(
        'TELEFONO',
        'TELEFONO_INVALIDO',
        'CLIENTE',
        'Teléfono ambiguo o inválido. Revisa el original; no se usará para vincular clientes.',
        true,
      );
    } else if (typeof value('TELEFONO') === 'number')
      issue(
        'TELEFONO',
        'TELEFONO_NUMERICO',
        'AVISO',
        'Teléfono almacenado como número: comprueba prefijo y ceros iniciales.',
      );
    const email = text('EMAIL');
    if (email && (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
      issue(
        'EMAIL',
        'EMAIL_INVALIDO',
        'CLIENTE',
        'Correo inválido; corrígelo o déjalo vacío.',
        true,
      );
    const fecha = excelDate(value('FECHA'), original.date1904);
    if (!fecha)
      issue('FECHA', 'FECHA_INVALIDA', 'SUSCRIPCION', 'FECHA ausente o no reconocida.', true);
    else if (+fecha.slice(0, 4) < 2020 || +fecha.slice(0, 4) > original.anoReferencia + 1)
      issue(
        'FECHA',
        'FECHA_FUERA_PERIODO',
        'SUSCRIPCION',
        'Fecha fuera del periodo operativo habitual: revisar.',
        true,
      );
    const servidor = text('SERVIDOR'),
      app = text('APP'),
      referencia = text('REFERENCIA');
    if (!servidor) issue('SERVIDOR', 'SERVIDOR_AUSENTE', 'SUSCRIPCION', 'SERVIDOR ausente.');
    if (!app) issue('APP', 'APP_AUSENTE', 'SUSCRIPCION', 'APP ausente.');
    if (!referencia) issue('REFERENCIA', 'REFERENCIA_AUSENTE', 'AVISO', 'REFERENCIA ausente.');
    for (const key of ['SERVIDOR', 'REFERENCIA', 'PAGO', 'ESTADO'] as const)
      if ((text(key)?.length ?? 0) > 100)
        issue(
          key,
          'TEXTO_EXCESIVO',
          scope(key),
          'El valor supera los 100 caracteres. No se truncará.',
          true,
        );
    const pago = text('PAGO'),
      code = normalizeComparable(pago),
      state = normalizeComparable(text('ESTADO'));
    const allowed = [
      'EF',
      'STR',
      'B-RE',
      'T-IM',
      'B-SA',
      'T-SA',
      'T-RE',
      'B-UN',
      'B-IM',
      'B-MY',
      'B-PR',
      'FREE',
      'GR',
      'RE',
      'T-MY',
      'T-PR',
      'T-UN',
      'T-WI',
    ];
    if (!pago)
      issue('PAGO', 'PAGO_AUSENTE', 'FINANZAS', 'PAGO ausente: movimiento financiero pendiente.');
    else if (code === 'PA')
      issue(
        'PAGO',
        'PAGO_PA_EXCLUIDO',
        'FINANZAS',
        'PA no se utiliza como método de pago. Conserva el original y resuelve el pago.',
      );
    else if (!allowed.includes(code))
      issue(
        'PAGO',
        'PAGO_DESCONOCIDO',
        'FINANZAS',
        'Código de pago sin interpretación confirmada. Revisa su equivalencia.',
      );
    if (state === 'PE')
      issue(
        'ESTADO',
        'PAGO_PENDIENTE',
        'FINANZAS',
        'PE: pendiente de pago. No se confirmará ningún cobro.',
      );
    else if (state)
      issue(
        'ESTADO',
        'ESTADO_DESCONOCIDO',
        'FINANZAS',
        'Estado no reconocido. Revisa su significado.',
        true,
      );
    const importeAnual = amount(value('PANO')),
      total = amount(value('TOTAL'));
    for (const [key, n] of [
      ['PANO', importeAnual],
      ['TOTAL', total],
    ] as const) {
      if (n === null)
        issue(
          key,
          text(key) ? 'IMPORTE_INVALIDO' : 'IMPORTE_AUSENTE',
          key === 'PANO' ? 'FINANZAS' : 'AVISO',
          key === 'PANO'
            ? 'P.AÑO ausente o inválido: pago anual pendiente.'
            : 'TOTAL ausente o inválido: no se podrá validar el acumulado histórico.',
          Boolean(text(key)),
        );
      else if (n < 0)
        issue(
          key,
          'IMPORTE_NEGATIVO',
          key === 'PANO' ? 'FINANZAS' : 'AVISO',
          'Importe negativo: requiere revisión.',
          true,
        );
    }
    const free = ['FREE', 'GR'].includes(code);
    if (importeAnual === 0 && !free)
      issue(
        'PANO',
        'CERO_NO_GRATUITO',
        'FINANZAS',
        'Cero no significa Gratis. Revisa importe y método.',
      );
    if (importeAnual !== null && importeAnual > 0 && free)
      issue(
        'PANO',
        'GRATIS_CON_IMPORTE',
        'FINANZAS',
        'Un método gratuito tiene importe positivo. Resuelve la contradicción.',
      );
    if (total !== null && importeAnual !== null && total >= 0 && importeAnual > total)
      issue(
        'TOTAL',
        'TOTAL_INFERIOR',
        'AVISO',
        'El acumulado es inferior a P.AÑO; revisa el histórico.',
      );
    const appClave = sanitizeApp(normalizeComparable(app)) || null;
    const product = extractProduct(appClave);
    if (appClave && !PRODUCT_ALIASES.includes(product ?? ''))
      issue(
        'APP',
        'APP_POR_REVISAR',
        'SUSCRIPCION',
        'Aplicación sin reconocimiento inequívoco; revisa la propuesta.',
      );
    const normalized: NormalizedExcelRow & { email: string | null } = {
      nombre,
      nombreClave: normalizeName(nombre),
      telefono,
      telefonoNormalizado: phone,
      email,
      fecha,
      servidor,
      servidorClave: servidor ? normalizeComparable(servidor) : null,
      app: PRODUCT_ALIASES.includes(product ?? '') ? product : null,
      productoClave: PRODUCT_ALIASES.includes(product ?? '') ? product : null,
      tipoDispositivo: extractDevice(appClave),
      identificadorOperativoHash: extractIdentifierHash(app),
      referencia,
      referenciaClave: referencia ? normalizeComparable(referencia) : null,
      importeAnual,
      total,
      observaciones: text('OBSERV'),
      pago: code === 'PA' ? null : pago,
      pagoClave: code === 'PA' ? null : code || null,
      estadoPago: state === 'PE' ? 'PENDIENTE' : state ? 'DESCONOCIDO' : 'NO_INFORMADO',
    };
    return {
      datosNormalizados: normalized,
      lectura,
      errores: lectura.incidencias.filter((i) => i.ambito === 'CLIENTE').map((i) => i.mensaje),
      advertencias: lectura.incidencias.filter((i) => i.ambito !== 'CLIENTE').map((i) => i.mensaje),
    };
  }
}
