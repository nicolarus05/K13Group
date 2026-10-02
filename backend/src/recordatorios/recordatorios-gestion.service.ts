import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { buildPaginatedResponse } from '../common/helpers/response.helper';
import { businessDay, parseDay } from '../suscripciones/subscription-dates';
import { audit, stateId, subscriptionLock, warningDays } from './recordatorios.service';
import { CreateReminderDto, ReminderActionDto, ReminderQueryDto } from './recordatorios.dto';
import { attentionWhere, availableReminder, reminderSelect } from './recordatorios-query';

@Injectable()
export class RecordatoriosGestionService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    return this.prisma.$transaction(
      async (tx) => ({
        hoy: businessDay(),
        atencion: await tx.recordatorio.count({
          where: attentionWhere(businessDay(), await warningDays(tx)),
        }),
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async list(q: ReminderQueryDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const today = businessDay(),
          day = parseDay(today);
        const filters: Prisma.RecordatorioWhereInput[] = [];
        if (q.vista === 'atencion') filters.push(attentionWhere(today, await warningDays(tx)));
        else if (q.vista !== 'todos') {
          filters.push(availableReminder(), {
            estado: { valor: { in: ['PENDIENTE', 'POSPUESTO'] } },
            fecha: q.vista === 'hoy' ? day : q.vista === 'atrasados' ? { lt: day } : { gt: day },
          });
        } else
          filters.push({
            OR: [{ estado: { valor: { in: ['COMPLETADO', 'CANCELADO'] } } }, availableReminder()],
          });
        if (q.desde && q.hasta && q.desde > q.hasta)
          throw new BadRequestException('Rango de fechas invertido.');
        if (q.desde || q.hasta)
          filters.push({
            fecha: {
              ...(q.desde ? { gte: parseDay(q.desde) } : {}),
              ...(q.hasta ? { lte: parseDay(q.hasta) } : {}),
            },
          });
        if (q.clienteId) filters.push({ clienteId: q.clienteId });
        if (q.tipo) filters.push({ tipo: { valor: q.tipo } });
        if (q.estado) filters.push({ estado: { valor: q.estado } });
        if (q.search?.trim())
          filters.push({
            OR: [
              { descripcion: { contains: q.search.trim(), mode: 'insensitive' } },
              { cliente: { nombre: { contains: q.search.trim(), mode: 'insensitive' } } },
            ],
          });
        const where: Prisma.RecordatorioWhereInput = { AND: filters };
        const [rows, total] = await Promise.all([
          tx.recordatorio.findMany({
            where,
            select: reminderSelect,
            orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
          }),
          tx.recordatorio.count({ where }),
        ]);
        return buildPaginatedResponse(rows, total, q.page, q.limit);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async detail(id: string) {
    const row = await this.prisma.recordatorio.findUnique({
      where: { id },
      select: reminderSelect,
    });
    if (!row) throw new NotFoundException('Recordatorio no encontrado.');
    return row;
  }
  async history(id: string, q: ReminderQueryDto) {
    await this.detail(id);
    const where = { tabla: 'recordatorios', registroId: id };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.actividad.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit,
        skip: (q.page - 1) * q.limit,
        select: {
          id: true,
          accion: true,
          createdAt: true,
          usuario: { select: { nombre: true } },
          datosAnteriores: true,
          datosNuevos: true,
        },
      }),
      this.prisma.actividad.count({ where }),
    ]);
    const safe = (v: Prisma.JsonValue) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      return Object.fromEntries(
        ['fecha', 'fechaOriginal', 'descripcion', 'motivo', 'cerradoAt', 'version'].map((k) => [
          k,
          v[k] ?? null,
        ]),
      );
    };
    return buildPaginatedResponse(
      rows.map((r) => ({
        ...r,
        datosAnteriores: safe(r.datosAnteriores),
        datosNuevos: safe(r.datosNuevos),
      })),
      total,
      q.page,
      q.limit,
    );
  }
  async create(dto: CreateReminderDto, actor: string) {
    const fecha = parseDay(dto.fecha);
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          actor,
          dto.clienteId,
          dto.suscripcionId ?? null,
          dto.tipo,
          dto.fecha,
          dto.descripcion,
        ]),
      )
      .digest('hex');
    return this.prisma.$transaction(async (tx) => {
      await subscriptionLock(tx);
      const prior = await tx.recordatorio.findUnique({ where: { solicitudId: dto.solicitudId } });
      if (prior) {
        if (prior.solicitudHash !== hash)
          throw new ConflictException('La solicitud ya se utilizó con otros datos.');
        return tx.recordatorio.findUniqueOrThrow({
          where: { id: prior.id },
          select: reminderSelect,
        });
      }
      await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${dto.clienteId}::uuid FOR UPDATE`;
      const client = await tx.cliente.findFirst({ where: { id: dto.clienteId, deletedAt: null } });
      if (!client) throw new BadRequestException('Selecciona un cliente existente.');
      if (
        dto.suscripcionId &&
        !(await tx.suscripcion.findFirst({
          where: { id: dto.suscripcionId, clienteId: dto.clienteId, deletedAt: null },
        }))
      )
        throw new BadRequestException('La suscripción no pertenece al cliente.');
      const row = await tx.recordatorio.create({
        data: {
          solicitudId: dto.solicitudId,
          solicitudHash: hash,
          origen: 'MANUAL',
          clienteId: dto.clienteId,
          suscripcionId: dto.suscripcionId,
          tipoId: await stateId(tx, 'recordatorio_tipo', dto.tipo),
          estadoId: await stateId(tx, 'recordatorio_estado', 'PENDIENTE'),
          fecha,
          fechaOriginal: fecha,
          descripcion: dto.descripcion,
        },
      });
      await audit(tx, actor, 'recordatorios', row.id, 'CREAR', null, row);
      return tx.recordatorio.findUniqueOrThrow({ where: { id: row.id }, select: reminderSelect });
    });
  }
  async action(
    id: string,
    action: 'editar' | 'posponer' | 'completar' | 'cancelar',
    dto: ReminderActionDto,
    actor: string,
  ) {
    if (
      (action !== 'posponer' && dto.fecha !== undefined) ||
      (action !== 'editar' && dto.descripcion !== undefined)
    )
      throw new BadRequestException('Campos no aplicables a esta acción.');
    return this.prisma.$transaction(async (tx) => {
      await subscriptionLock(tx);
      const before = await tx.recordatorio.findUnique({ where: { id }, include: { estado: true } });
      if (!before) throw new NotFoundException('Recordatorio no encontrado.');
      const next =
        action === 'completar'
          ? 'COMPLETADO'
          : action === 'cancelar'
            ? 'CANCELADO'
            : action === 'posponer'
              ? 'POSPUESTO'
              : before.estado.valor;
      const replay =
        action === 'posponer'
          ? before.fecha.toISOString().slice(0, 10) === dto.fecha
          : action === 'editar'
            ? before.origen === 'MANUAL' &&
              ['PENDIENTE', 'POSPUESTO'].includes(before.estado.valor) &&
              before.descripcion === dto.descripcion
            : true;
      if (
        replay &&
        before.estado.valor === next &&
        before.motivo === dto.motivo &&
        before.version === dto.version + 1
      )
        return tx.recordatorio.findUniqueOrThrow({ where: { id }, select: reminderSelect });
      if (before.version !== dto.version)
        throw new ConflictException('El recordatorio ha cambiado. Recarga antes de continuar.');
      if (['COMPLETADO', 'CANCELADO'].includes(before.estado.valor))
        throw new ConflictException('El recordatorio ya está cerrado.');
      if (!(await tx.recordatorio.findFirst({ where: { AND: [{ id }, availableReminder()] } })))
        throw new ConflictException('Este aviso ya no es aplicable. Recarga la lista.');
      const data: Prisma.RecordatorioUpdateInput = {
        version: { increment: 1 },
        motivo: dto.motivo,
      };
      if (action === 'editar') {
        if (before.origen !== 'MANUAL' || !dto.descripcion)
          throw new BadRequestException('Solo se puede editar la descripción de un aviso manual.');
        data.descripcion = dto.descripcion;
      } else {
        data.estado = { connect: { id: await stateId(tx, 'recordatorio_estado', next) } };
        if (action === 'posponer') {
          if (!dto.fecha) throw new BadRequestException('Indica la nueva fecha.');
          const day = parseDay(dto.fecha);
          if (day <= before.fecha || dto.fecha < businessDay())
            throw new BadRequestException(
              'La nueva fecha debe ser posterior a la actual y no estar en el pasado.',
            );
          data.fecha = day;
        } else data.cerradoAt = new Date();
      }
      // La clave automática permanece reservada: cerrar manualmente no genera otro aviso.
      const after = await tx.recordatorio.update({ where: { id }, data });
      await audit(tx, actor, 'recordatorios', id, action.toUpperCase(), before, after);
      return tx.recordatorio.findUniqueOrThrow({ where: { id }, select: reminderSelect });
    });
  }
}
