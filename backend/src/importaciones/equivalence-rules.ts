import { ImportacionFila } from '@prisma/client';
import { normalizeComparable } from '../common/helpers/normalization';
import { Field, RowReading, excelDate } from './excel-validation';
import { identityHash } from './identity-matching';
import { EquivalenceType } from './dto/equivalencias-revision.dto';

export type ReadingRow = Pick<ImportacionFila, 'lectura' | 'correcciones' | 'datosNormalizados'> &
  Partial<Pick<ImportacionFila, 'historialLectura'>>;
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function sourceValue(row: ReadingRow, field: Field): unknown {
  const corrections = record(row.correcciones);
  return Object.prototype.hasOwnProperty.call(corrections, field)
    ? corrections[field]
    : ((row.lectura as unknown as RowReading)?.campos?.[field]?.valor ?? null);
}
export function annualStart(expiry: unknown): string | null {
  if (typeof expiry !== 'string' || !excelDate(expiry, false)) return null;
  const date = new Date(`${expiry}T00:00:00Z`);
  const year = date.getUTCFullYear() - 1,
    month = date.getUTCMonth();
  if (year < 1900) return null;
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}
export function equivalenceSource(
  row: ReadingRow,
  tipo: EquivalenceType,
  product?: { id: string; huella: string; nombre?: string },
) {
  const data = record(row.datosNormalizados);
  const field: Field = (
    {
      PRODUCTO: 'APP',
      TARIFA: 'PANO',
      SERVIDOR: 'SERVIDOR',
      REFERENCIA: 'REFERENCIA',
      PAGO: 'PAGO',
    } as const
  )[tipo];
  const raw = sourceValue(row, field);
  const normalized = normalizeComparable(raw);
  const absent = raw === null || raw === undefined || normalized === '';
  const ignored = tipo === 'PAGO' && normalized === 'PA';
  const canonical = tipo === 'PRODUCTO' ? String(data.productoClave ?? '') : normalized;
  const keyData =
    tipo === 'TARIFA'
      ? [
          tipo,
          product?.id ?? null,
          data.importeAnual ?? null,
          12,
          data.importeAnual == null ? normalized : null,
        ]
      : [tipo, canonical || normalized];
  const label =
    tipo === 'PRODUCTO'
      ? canonical ||
        (absent ? 'Sin APP' : `APP no reconocida · ${identityHash(normalized).slice(0, 8)}`)
      : tipo === 'TARIFA'
        ? `${data.importeAnual ?? 'Sin importe'} · 12 meses · ${product ? (product.nombre ?? 'producto revisado') : 'producto pendiente'}`
        : absent
          ? 'Sin dato'
          : normalized;
  const original = (row.lectura as unknown as RowReading)?.campos?.[field];
  // Conserva la invalidación aunque el usuario restaure después el valor anterior.
  // Las correcciones de otros campos no afectan a esta equivalencia.
  const revisions = (Array.isArray(row.historialLectura) ? row.historialLectura : [])
    .map(record)
    .filter((event) => Object.prototype.hasOwnProperty.call(record(event.cambios), field))
    .map((event) => event.version);
  // Los identificadores de APP nunca salen de staging ni se incluyen en el historial público.
  return {
    clave: identityHash(keyData),
    etiqueta: label,
    ausente: absent,
    ignorado: ignored,
    campo: field,
    celda: original?.celda ?? null,
    original:
      tipo === 'PRODUCTO' ? (original?.valor ? 'APP protegida' : null) : (original?.valor ?? null),
    corregido: Object.prototype.hasOwnProperty.call(record(row.correcciones), field),
    efectivo: tipo === 'PRODUCTO' ? label : raw,
    dependencia: identityHash([
      keyData,
      raw,
      tipo === 'TARIFA' ? (product?.huella ?? null) : null,
      revisions,
    ]),
  };
}
