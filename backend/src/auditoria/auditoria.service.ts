import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { AuditoriaQueryDto } from './auditoria.dto';
import { auditChanges, safeAuditData } from './audit-data';

const summary = {
  id: true,
  tabla: true,
  registroId: true,
  accion: true,
  createdAt: true,
  usuario: { select: { id: true, nombre: true } },
} satisfies Prisma.ActividadSelect;

function calendarDate(value: string) {
  const date = new Date(value);
  // ISO también admite semanas/días ordinales que Date no interpreta. PostgreSQL
  // tampoco acepta el año cero ni todo el rango de fechas extendidas de JavaScript.
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  )
    throw new BadRequestException('Fecha de auditoría inválida. Usa una fecha de calendario.');
  return date;
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}
  async list(q: AuditoriaQueryDto) {
    const desde = q.desde ? calendarDate(q.desde) : undefined;
    const hasta = q.hasta ? calendarDate(q.hasta) : undefined;
    if (desde && hasta && desde > hasta)
      throw new BadRequestException('El inicio debe ser anterior al final.');
    if (q.origen === 'sistema' && q.usuarioId)
      throw new BadRequestException('El sistema no tiene usuario asociado.');
    let cursor: { id: string; fecha: string; corte: string } | undefined;
    if (q.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(q.cursor, 'base64url').toString());
        if (
          !cursor ||
          !isUUID(cursor.id) ||
          ![cursor.fecha, cursor.corte].every(
            (v) => typeof v === 'string' && calendarDate(v).toISOString() === v,
          ) ||
          cursor.fecha > cursor.corte
        )
          throw new Error();
      } catch {
        throw new BadRequestException('Cursor de auditoría inválido.');
      }
    }
    const corte = cursor?.corte ?? new Date().toISOString();
    const where: Prisma.ActividadWhereInput = {
      ...(q.tabla ? { tabla: q.tabla } : {}),
      ...(q.accion ? { accion: q.accion } : {}),
      ...(q.registroId ? { registroId: q.registroId } : {}),
      ...(q.usuarioId
        ? { usuarioId: q.usuarioId }
        : q.origen === 'sistema'
          ? { usuarioId: null }
          : q.origen === 'usuario'
            ? { usuarioId: { not: null } }
            : {}),
      AND: [
        { createdAt: { lte: new Date(corte) } },
        ...(desde ? [{ createdAt: { gte: desde } }] : []),
        ...(hasta ? [{ createdAt: { lte: hasta } }] : []),
      ],
    };
    const data = await this.prisma.actividad.findMany({
      where: {
        ...where,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.fecha) } },
                { createdAt: new Date(cursor.fecha), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: summary,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const more = data.length > q.limit;
    const rows = data.slice(0, q.limit),
      last = rows.at(-1);
    return {
      success: true,
      data: rows,
      pagination: {
        limit: q.limit,
        siguiente:
          more && last
            ? Buffer.from(
                JSON.stringify({ id: last.id, fecha: last.createdAt.toISOString(), corte }),
              ).toString('base64url')
            : null,
      },
    };
  }
  async filters() {
    const [tables, actions, usuarios] = await Promise.all([
      this.prisma.actividad.groupBy({
        by: ['tabla'],
        orderBy: { tabla: 'asc' },
      }),
      this.prisma.actividad.groupBy({
        by: ['accion'],
        orderBy: { accion: 'asc' },
      }),
      this.prisma.usuario.findMany({
        select: { id: true, nombre: true },
        orderBy: { nombre: 'asc' },
      }),
    ]);
    return {
      success: true,
      data: {
        tablas: tables.map((r) => r.tabla),
        acciones: actions.map((r) => r.accion),
        usuarios,
      },
    };
  }
  async detail(id: string) {
    const row = await this.prisma.actividad.findUnique({
      where: { id },
      select: { ...summary, datosAnteriores: true, datosNuevos: true },
    });
    if (!row) throw new NotFoundException('Actividad no encontrada.');
    const before = safeAuditData(row.datosAnteriores),
      after = safeAuditData(row.datosNuevos);
    return {
      success: true,
      data: {
        ...row,
        datosAnteriores: before,
        datosNuevos: after,
        cambios: auditChanges(before, after),
      },
    };
  }
}
