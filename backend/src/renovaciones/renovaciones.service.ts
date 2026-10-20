import { attribution } from '../estadisticas/attribution';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { lockCatalog } from '../catalogos/catalogos.service';
import {
  annualEnd,
  businessDay,
  datedState,
  DATE_STATES,
  parseDay,
} from '../suscripciones/subscription-dates';
import { subscriptionSelect } from '../suscripciones/subscription.select';
import { SubscriptionActionDto } from '../suscripciones/suscripciones.dto';
import {
  RecordatoriosService,
  audit,
  stateId,
  subscriptionLock,
  warningDays,
} from '../recordatorios/recordatorios.service';
import { renewalSelect } from './renovaciones.select';
import { CollectDto, RenewalDto, RenewalPreferenceDto, RenewalQueryDto } from './renovaciones.dto';
import { buildPaginatedResponse } from '../common/helpers/response.helper';

@Injectable()
export class RenovacionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: RecordatoriosService,
  ) {}
  private version(actual: number, requested: number) {
    if (actual !== requested)
      throw new ConflictException('El registro ha cambiado. Recarga los datos antes de confirmar.');
  }
  private async subscription(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.suscripcion.findFirst({
      where: { id, deletedAt: null },
      select: subscriptionSelect,
    });
    if (!row) throw new NotFoundException('Suscripción no encontrada.');
    return row;
  }
  private async method(tx: Prisma.TransactionClient, id: string) {
    await lockCatalog(tx, 'metodos-pago');
    const method = await tx.metodoPago.findFirst({ where: { id, activo: true, deletedAt: null } });
    if (!method) throw new BadRequestException('Selecciona un método de pago activo.');
    return method;
  }
  async findOne(id: string, tx: Prisma.TransactionClient = this.prisma) {
    const row = await tx.renovacion.findFirst({
      where: { id, deletedAt: null },
      select: renewalSelect,
    });
    if (!row) throw new NotFoundException('Operación no encontrada.');
    return row;
  }
  async list(query: RenewalQueryDto) {
    if (query.desde) parseDay(query.desde);
    if (query.hasta) parseDay(query.hasta);
    if (query.desde && query.hasta && query.desde > query.hasta)
      throw new BadRequestException('Intervalo de fechas inválido.');
    const where: Prisma.RenovacionWhereInput = {
      deletedAt: null,
      ...(query.suscripcionId ? { suscripcionId: query.suscripcionId } : {}),
      suscripcion: {
        ...(query.clienteId ? { clienteId: query.clienteId } : {}),
        ...(query.productoId ? { productoId: query.productoId } : {}),
        ...(query.search
          ? { cliente: { nombre: { contains: query.search.trim(), mode: 'insensitive' } } }
          : {}),
      },
      ...(query.estado ? { estado: { valor: query.estado, tipo: 'renovacion' } } : {}),
      ...(query.cobro === 'GRATIS'
        ? { metodoPago: { esGratuito: true } }
        : query.cobro
          ? { movimientos: { some: { estado: { valor: query.cobro, tipo: 'movimiento_estado' } } } }
          : {}),
      ...(query.desde || query.hasta
        ? {
            fechaOperacion: {
              ...(query.desde ? { gte: parseDay(query.desde) } : {}),
              ...(query.hasta ? { lte: parseDay(query.hasta) } : {}),
            },
          }
        : {}),
    };
    const [rows, count] = await this.prisma.$transaction([
      this.prisma.renovacion.findMany({
        where,
        select: renewalSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.renovacion.count({ where }),
    ]);
    return buildPaginatedResponse(rows, count, query.page, query.limit);
  }
  async queue(query: RenewalQueryDto) {
    const today = parseDay(businessDay());
    const tomorrow = new Date(today.getTime() + 86400000);
    const days = await warningDays(this.prisma);
    const where: Prisma.SuscripcionWhereInput = {
      deletedAt: null,
      cliente: {
        deletedAt: null,
        estado: { valor: 'ACTIVO' },
        ...(query.search ? { nombre: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
      },
      ...(query.clienteId ? { clienteId: query.clienteId } : {}),
      ...(query.productoId ? { productoId: query.productoId } : {}),
      ...(query.suscripcionId ? { id: query.suscripcionId } : {}),
      estado: { tipo: 'suscripcion', valor: { in: [...DATE_STATES] } },
      noRenovar: query.vista === 'no-renovar',
      ...(query.vista === 'hoy'
        ? { fechaFin: today }
        : query.vista === 'manana'
          ? { fechaFin: tomorrow }
          : query.vista === 'proximas'
            ? { fechaFin: { gt: today, lte: new Date(today.getTime() + days * 86400000) } }
            : query.vista === 'vencidas'
              ? { fechaFin: { lt: today } }
              : {}),
    };
    const [rows, count] = await this.prisma.$transaction([
      this.prisma.suscripcion.findMany({
        where,
        select: subscriptionSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ fechaFin: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.suscripcion.count({ where }),
    ]);
    const states = await this.prisma.estado.findMany({
      where: { tipo: 'suscripcion' },
      select: { id: true, valor: true, etiqueta: true },
    });
    return buildPaginatedResponse(
      rows.map((row) => ({
        ...row,
        estado: states.find((s) => s.valor === datedState(row.fechaFin, businessDay(), days))!,
      })),
      count,
      query.page,
      query.limit,
    );
  }
  async create(id: string, dto: RenewalDto, actor: string, initial = false) {
    const normalized = {
      id,
      initial,
      actor,
      version: dto.version,
      importe: new Prisma.Decimal(dto.importe).toFixed(2),
      metodoPagoId: dto.metodoPagoId,
      cobro: dto.cobro,
      fechaCobro: dto.fechaCobro ?? null,
      fechaPrevistaCobro: dto.fechaPrevistaCobro ?? null,
      observaciones: dto.observaciones?.trim() || null,
      motivoImporte: dto.motivoImporte?.trim() || null,
    };
    const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    return this.prisma.$transaction(
      async (tx) => {
        await subscriptionLock(tx);
        const previous = await tx.renovacion.findUnique({
          where: { solicitudId: dto.solicitudId },
        });
        if (previous) {
          if (previous.solicitudHash !== hash)
            throw new ConflictException('La clave de solicitud ya se utilizó con otros datos.');
          return this.findOne(previous.id, tx);
        }
        for (const catalog of ['productos', 'tarifas', 'servidores', 'referencias'] as const)
          await lockCatalog(tx, catalog);
        const method = await this.method(tx, dto.metodoPagoId);
        const before = await this.subscription(tx, id);
        this.version(before.version, dto.version);
        await tx.$queryRawUnsafe(
          'SELECT id FROM clientes WHERE id = $1::uuid FOR UPDATE',
          before.clienteId,
        );
        if (
          !(await tx.cliente.findFirst({
            where: {
              id: before.clienteId,
              deletedAt: null,
              estado: { valor: 'ACTIVO', tipo: 'cliente' },
            },
          }))
        )
          throw new BadRequestException('El cliente debe estar activo.');
        if (
          !(DATE_STATES as readonly string[]).includes(before.estado.valor) ||
          (!initial && before.noRenovar)
        )
          throw new ConflictException(
            'Reactiva el servicio o retira No renovar antes de realizar esta operación. Las canceladas no se pueden renovar.',
          );
        if (
          !before.producto.activo ||
          before.producto.deletedAt ||
          !before.tarifa.activo ||
          !before.servidor.activo ||
          before.servidor.deletedAt
        )
          throw new BadRequestException(
            'Producto, tarifa y servidor deben estar activos para registrar una nueva operación.',
          );
        const tariff = await tx.tarifa.findUniqueOrThrow({ where: { id: before.tarifaId } });
        if (tariff.duracionMeses !== 12 || tariff.productoId !== before.productoId)
          throw new BadRequestException('Selecciona una tarifa anual del producto.');
        if (
          initial &&
          ((await tx.renovacion.count({
            where: {
              suscripcionId: id,
              OR: [{ estadoId: null }, { estado: { valor: { not: 'ANULADA' } } }],
            },
          })) ||
            (await tx.movimientoFinanciero.count({
              where: { suscripcionId: id, estado: { valor: { not: 'ANULADO' } } },
            })))
        )
          throw new ConflictException(
            'Ya hay operaciones para esta suscripción. No se puede volver a registrar su primer pago.',
          );
        const amount = new Prisma.Decimal(dto.importe);
        if (method.esGratuito ? !amount.isZero() || dto.cobro !== 'CONFIRMADO' : amount.lte(0))
          throw new BadRequestException(
            'Gratis requiere importe cero y no admite deuda; un cobro monetario debe ser positivo.',
          );
        if (!method.esGratuito && !amount.eq(tariff.precio) && !normalized.motivoImporte)
          throw new BadRequestException('Indica el motivo del importe distinto de la tarifa.');
        const today = businessDay();
        const operationDay = parseDay(today);
        const start = initial
          ? before.fechaInicio
          : before.fechaFin > operationDay
            ? before.fechaFin
            : operationDay;
        const end = initial ? before.fechaFin : annualEnd(start);
        const due = dto.fechaPrevistaCobro ? parseDay(dto.fechaPrevistaCobro) : null;
        if (dto.cobro === 'PENDIENTE' && (!due || due < operationDay || dto.fechaCobro))
          throw new BadRequestException(
            'Indica una fecha prevista de cobro de hoy o posterior, sin fecha de pago realizado.',
          );
        if (dto.cobro === 'CONFIRMADO' && due)
          throw new BadRequestException('Un pago confirmado no necesita fecha prevista de cobro.');
        const paid =
          dto.cobro === 'CONFIRMADO' && !method.esGratuito
            ? parseDay(dto.fechaCobro ?? today)
            : null;
        if (method.esGratuito && dto.fechaCobro)
          throw new BadRequestException('Una operación gratuita no tiene fecha de cobro.');
        if (paid && (paid > operationDay || paid < (initial ? before.fechaInicio : operationDay)))
          throw new BadRequestException(
            initial
              ? 'La fecha de pago debe estar entre el inicio y hoy.'
              : 'La renovación se registra hoy; los históricos requieren su flujo de importación.',
          );
        const snapshots = {
          ...attribution(before.productoId, before.servidorId, before.referenciaId),
          productoNombreSnapshot: before.producto.nombre,
          tarifaNombreSnapshot: before.tarifa.nombre,
          servidorNombreSnapshot: before.servidor.nombre,
          referenciaNombreSnapshot: before.referencia?.nombre ?? null,
          metodoPagoNombreSnapshot: method.nombre,
        };
        const renewal = await tx.renovacion.create({
          data: {
            suscripcionId: id,
            solicitudId: dto.solicitudId,
            solicitudHash: hash,
            tipoOperacion: initial ? 'ALTA' : 'RENOVACION',
            inicioAnterior: before.fechaInicio,
            finAnterior: before.fechaFin,
            fechaInicio: start,
            fechaFin: end,
            fechaOperacion: operationDay,
            importe: amount,
            metodoPagoId: method.id,
            estadoId: await stateId(tx, 'renovacion', 'COMPLETADA'),
            origen: 'GESTION_WEB',
            ...snapshots,
            observaciones: normalized.observaciones,
          },
        });
        if (!method.esGratuito) {
          const movement = await tx.movimientoFinanciero.create({
            data: {
              operacionClave: renewal.id,
              renovacionId: renewal.id,
              suscripcionId: id,
              tipoId: await stateId(tx, 'movimiento_tipo', 'INGRESO'),
              estadoId: await stateId(tx, 'movimiento_estado', dto.cobro),
              metodoPagoId: method.id,
              importe: amount,
              fecha: paid ?? operationDay,
              fechaCobro: paid,
              fechaPrevistaCobro: due,
              origen: 'GESTION_WEB',
              ...snapshots,
              descripcion:
                (initial ? 'Primer pago' : 'Renovación anual') +
                (normalized.observaciones ? ': ' + normalized.observaciones : ''),
            },
          });
          await audit(tx, actor, 'movimientos_financieros', movement.id, 'CREAR', null, movement);
        }
        const after = await tx.suscripcion.update({
          where: { id },
          data: {
            ...(!initial ? { fechaInicio: start, fechaFin: end } : {}),
            estadoId: await stateId(
              tx,
              'suscripcion',
              datedState(end, today, await warningDays(tx)),
            ),
            version: { increment: 1 },
          },
          select: subscriptionSelect,
        });
        await this.reminders.syncSubscription(tx, id, actor, !initial);
        if (due)
          await this.reminders.ensure(
            tx,
            'C:' + renewal.id,
            before,
            'COBRO',
            due,
            'Cobro pendiente de ' + amount.toFixed(2) + ' €',
            actor,
          );
        const result = await this.findOne(renewal.id, tx);
        await audit(
          tx,
          actor,
          'suscripciones',
          id,
          initial ? 'PRIMER_PAGO' : 'RENOVAR',
          before,
          after,
        );
        await audit(tx, actor, 'renovaciones', renewal.id, 'CREAR', null, {
          ...result,
          motivoImporte: normalized.motivoImporte,
        });
        return result;
      },
      { timeout: 30_000 },
    );
  }
  async collect(id: string, dto: CollectDto, actor: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await subscriptionLock(tx);
        const row = await this.findOne(id, tx);
        const movement = await tx.movimientoFinanciero.findUnique({
          where: { operacionClave: id },
          include: { estado: true },
        });
        if (row.estado?.valor !== 'COMPLETADA' || !movement)
          throw new ConflictException('No existe un cobro pendiente para esta operación.');
        const paid = parseDay(dto.fechaCobro);
        if (
          movement.estado.valor === 'CONFIRMADO' &&
          movement.fechaCobro?.getTime() === paid.getTime() &&
          movement.metodoPagoId === dto.metodoPagoId
        )
          return row;
        this.version(row.version, dto.version);
        if (movement.estado.valor !== 'PENDIENTE')
          throw new ConflictException('El cobro ya se ha gestionado.');
        if (dto.fechaCobro > businessDay() || paid < row.fechaOperacion!)
          throw new BadRequestException('La fecha de cobro debe estar entre la operación y hoy.');
        const method = await this.method(tx, dto.metodoPagoId);
        if (method.esGratuito)
          throw new BadRequestException('No se puede liquidar una deuda con un método gratuito.');
        const after = await tx.movimientoFinanciero.update({
          where: { id: movement.id },
          data: {
            estadoId: await stateId(tx, 'movimiento_estado', 'CONFIRMADO'),
            fecha: paid,
            fechaCobro: paid,
            metodoPagoId: method.id,
            metodoPagoNombreSnapshot: method.nombre,
          },
        });
        await tx.renovacion.update({ where: { id }, data: { version: { increment: 1 } } });
        await this.reminders.close(tx, 'C:' + id, true, actor);
        await audit(tx, actor, 'movimientos_financieros', movement.id, 'COBRAR', movement, after);
        const result = await this.findOne(id, tx);
        await audit(tx, actor, 'renovaciones', id, 'COBRAR', row, result);
        // No tocar la suscripción: cobrar no renueva y no cambia sus fechas.
        return result;
      },
      { timeout: 30_000 },
    );
  }
  async annul(id: string, dto: SubscriptionActionDto, actor: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await subscriptionLock(tx);
        const before = await this.findOne(id, tx);
        if (before.estado?.valor === 'ANULADA' && before.motivoAnulacion === dto.motivo)
          return before;
        this.version(before.version, dto.version);
        const raw = await tx.renovacion.findUniqueOrThrow({ where: { id } });
        const sub = await this.subscription(tx, raw.suscripcionId);
        if (
          before.estado?.valor !== 'COMPLETADA' ||
          raw.origen !== 'GESTION_WEB' ||
          !raw.inicioAnterior ||
          !raw.finAnterior
        )
          throw new ConflictException(
            'Esta operación requiere un proceso de corrección histórica.',
          );
        const newer = await tx.renovacion.count({
          where: {
            suscripcionId: sub.id,
            id: { not: id },
            estado: { valor: 'COMPLETADA' },
            OR: [
              { createdAt: { gt: raw.createdAt } },
              { createdAt: raw.createdAt, fechaFin: { gt: raw.fechaFin } },
            ],
          },
        });
        if (
          newer ||
          sub.estado.valor === 'CANCELADA' ||
          sub.fechaInicio.getTime() !== raw.fechaInicio.getTime() ||
          sub.fechaFin.getTime() !== raw.fechaFin.getTime()
        )
          throw new ConflictException(
            'Hay operaciones posteriores o cambios incompatibles. No se restaurarán fechas automáticamente.',
          );
        const afterSub = await tx.suscripcion.update({
          where: { id: sub.id },
          data: {
            fechaInicio: raw.inicioAnterior,
            fechaFin: raw.finAnterior,
            version: { increment: 1 },
            ...(sub.estado.valor === 'SUSPENDIDA'
              ? {}
              : {
                  estadoId: await stateId(
                    tx,
                    'suscripcion',
                    datedState(raw.finAnterior, businessDay(), await warningDays(tx)),
                  ),
                }),
          },
          select: subscriptionSelect,
        });
        const movement = await tx.movimientoFinanciero.findUnique({
          where: { operacionClave: id },
        });
        if (movement) {
          const after = await tx.movimientoFinanciero.update({
            where: { id: movement.id },
            data: { estadoId: await stateId(tx, 'movimiento_estado', 'ANULADO') },
          });
          await audit(tx, actor, 'movimientos_financieros', movement.id, 'ANULAR', movement, {
            ...after,
            motivo: dto.motivo,
          });
        }
        await tx.renovacion.update({
          where: { id },
          data: {
            estadoId: await stateId(tx, 'renovacion', 'ANULADA'),
            version: { increment: 1 },
            anuladaAt: new Date(),
            motivoAnulacion: dto.motivo,
          },
        });
        await this.reminders.close(tx, 'C:' + id, false, actor);
        await this.reminders.syncSubscription(tx, sub.id, actor);
        const after = await this.findOne(id, tx);
        await audit(tx, actor, 'suscripciones', sub.id, 'ANULAR_OPERACION', sub, {
          ...afterSub,
          motivo: dto.motivo,
        });
        await audit(tx, actor, 'renovaciones', id, 'ANULAR', before, after);
        return after;
      },
      { timeout: 30_000 },
    );
  }
  async preference(id: string, dto: RenewalPreferenceDto, actor: string) {
    return this.prisma.$transaction(async (tx) => {
      await subscriptionLock(tx);
      const before = await this.subscription(tx, id);
      this.version(before.version, dto.version);
      if (['CANCELADA', 'HISTORICA'].includes(before.estado.valor))
        throw new ConflictException('Una suscripción cancelada o histórica es de solo lectura.');
      if (before.noRenovar === dto.noRenovar) return before;
      const after = await tx.suscripcion.update({
        where: { id },
        data: { noRenovar: dto.noRenovar, version: { increment: 1 } },
        select: subscriptionSelect,
      });
      await this.reminders.syncSubscription(tx, id, actor);
      await audit(tx, actor, 'suscripciones', id, 'PREFERENCIA_RENOVACION', before, {
        ...after,
        motivo: dto.motivo,
      });
      return after;
    });
  }
}
