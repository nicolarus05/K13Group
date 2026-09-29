import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { businessDay, parseDay } from '../suscripciones/subscription-dates';
export const SECTIONS = [
  'resumen',
  'clientes',
  'renovaciones',
  'finanzas',
  'productos',
  'servidores',
  'referencias',
  'metodos-pago',
] as const;
export type Section = (typeof SECTIONS)[number];
export class StatsQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) desde?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) hasta?: string;
  @IsIn(['dia', 'mes', 'ano']) agrupacion: 'dia' | 'mes' | 'ano' = 'mes';
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
  @IsOptional() @IsUUID() productoId?: string;
  @IsOptional() @IsUUID() servidorId?: string;
  @IsOptional() @IsUUID() referenciaId?: string;
  @IsOptional() @IsUUID() metodoPagoId?: string;
  @IsOptional() @IsUUID() categoriaGastoId?: string;
  @IsOptional() @IsString() @IsIn(['ACTIVO', 'INACTIVO']) estadoCliente?: string;
  @IsOptional() @IsString() @IsIn(['COMPLETADA', 'ANULADA']) estadoOperacion?: string;
}
export const day = (d: Date) => d.toISOString().slice(0, 10);
export const shift = (d: string, days: number) =>
  day(new Date(parseDay(d).getTime() + days * 86400000));
export function statsPeriod(q: StatsQuery, today = businessDay()) {
  if (Boolean(q.desde) !== Boolean(q.hasta))
    throw new BadRequestException('Indica las dos fechas.');
  const desde = q.desde ?? today.slice(0, 7) + '-01',
    hasta = q.hasta ?? today;
  const length = (parseDay(hasta).getTime() - parseDay(desde).getTime()) / 86400000 + 1;
  const max = new Date(parseDay(desde));
  max.setUTCFullYear(max.getUTCFullYear() + 5);
  if (length < 1 || parseDay(hasta) >= max || (q.agrupacion === 'dia' && length > 366))
    throw new BadRequestException('Máximo cinco años; el detalle diario admite hasta 366 días.');
  const anteriorDesde = shift(desde, -length);
  parseDay(anteriorDesde);
  return {
    desde,
    hasta,
    anteriorDesde,
    anteriorHasta: shift(desde, -1),
    dias: length,
    agrupacion: q.agrupacion,
  };
}
export function validateFilters(section: Section, q: StatsQuery) {
  const allowed: Partial<Record<Section, string[]>> = {
    clientes: ['estadoCliente'],
    renovaciones: ['estadoOperacion'],
    finanzas: ['metodoPagoId', 'categoriaGastoId'],
    productos: ['productoId', 'servidorId', 'referenciaId'],
    servidores: ['productoId', 'servidorId', 'referenciaId'],
    referencias: ['productoId', 'servidorId', 'referenciaId'],
    'metodos-pago': ['metodoPagoId'],
  };
  for (const key of [
    'productoId',
    'servidorId',
    'referenciaId',
    'metodoPagoId',
    'categoriaGastoId',
    'estadoCliente',
    'estadoOperacion',
  ] as const)
    if (q[key] && !allowed[section]?.includes(key))
      throw new BadRequestException('Filtro no aplicable a este informe: ' + key);
  if (q.categoriaGastoId && q.metodoPagoId)
    throw new BadRequestException(
      'Consulta gastos por categoría o ingresos por método, sin mezclar bases.',
    );
}
export function buckets(from: string, to: string, grain: StatsQuery['agrupacion']) {
  const date = parseDay(from),
    end = parseDay(to);
  const result: string[] = [];
  if (grain !== 'dia') date.setUTCDate(1);
  if (grain === 'ano') date.setUTCMonth(0);
  while (date <= end) {
    result.push(day(date));
    if (grain === 'dia') date.setUTCDate(date.getUTCDate() + 1);
    else if (grain === 'mes') date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCFullYear(date.getUTCFullYear() + 1);
  }
  return result;
}
