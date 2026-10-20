import { acquireOperation } from '../recovery/maintenance';
import { readSettings, warningDays as configuredWarningDays } from '../configuracion/settings';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { lockCatalog } from '../catalogos/catalogos.service';
import { annualEnd, businessDay, datedState, DATE_STATES, parseDay } from './subscription-dates';
import {
  CreateSubscriptionDto,
  SubscriptionActionDto,
  SubscriptionQueryDto,
  UpdateSubscriptionDto,
} from './suscripciones.dto';
import { subscriptionSelect, SubscriptionView } from './subscription.select';
import { RecordatoriosService } from '../recordatorios/recordatorios.service';

export const STATE_SYNC_BATCH_SIZE = 100;
type StateContext = {
  today: string;
  days: number;
  cutoff: Date;
  near: Date;
  states: SubscriptionView['estado'][];
};

@Injectable()
export class SuscripcionesService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private lastRun = 0;
  private stopping = false;
  private readonly logger = new Logger(SuscripcionesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: RecordatoriosService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      let release: (() => Promise<void>) | null = null;
      try {
        release = await acquireOperation();
        if (!release) return;
        const minutes = (await readSettings(this.prisma))['sistema.intervalo_comprobacion_minutos'];
        if (Date.now() - this.lastRun < minutes * 60000) return;
        await this.syncStates();
        this.lastRun = Date.now();
      } catch {
        this.logger.error('No se pudieron actualizar los estados de suscripción; se reintentará.');
      } finally {
        await release?.();
        this.running = false;
      }
    };
    this.timer = setInterval(() => void tick(), 10_000);
    this.timer.unref();
    void tick();
  }
  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }
  private async lock(tx: Prisma.TransactionClient) {
    await tx.$queryRawUnsafe(
      'SELECT 1 FROM pg_advisory_xact_lock(hashtext($1))',
      'suscripciones:gestion',
    );
  }
  private async warningDays(tx: Prisma.TransactionClient) {
    return configuredWarningDays(tx);
  }
  private async stateId(tx: Prisma.TransactionClient, valor: string) {
    return (
      await tx.estado.findUniqueOrThrow({ where: { tipo_valor: { tipo: 'suscripcion', valor } } })
    ).id;
  }
  private async audit(
    tx: Prisma.TransactionClient,
    actor: string | null,
    action: string,
    before: SubscriptionView | null,
    after: SubscriptionView,
    motivo?: string,
  ) {
    const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    await tx.actividad.create({
      data: {
        usuarioId: actor,
        tabla: 'suscripciones',
        registroId: after.id,
        accion: action,
        datosAnteriores: before ? json(before) : Prisma.JsonNull,
        datosNuevos: json({
          ...after,
          motivo: motivo ?? null,
          origen: actor ? 'MANUAL' : 'SISTEMA',
        }),
      },
    });
  }
  private async stateContext(
    tx: Prisma.TransactionClient,
    today = businessDay(),
  ): Promise<StateContext> {
    const days = await this.warningDays(tx);
    const cutoff = parseDay(today);
    const states = await tx.estado.findMany({
      where: { tipo: 'suscripcion', valor: { in: [...DATE_STATES] } },
      select: { id: true, valor: true, etiqueta: true },
    });
    if (states.length !== DATE_STATES.length)
      throw new Error('Falta inicializar el catálogo de estados de suscripción.');
    return { today, days, cutoff, near: new Date(cutoff.getTime() + days * 86400000), states };
  }
  private stateWhere(value: string, context: StateContext): Prisma.SuscripcionWhereInput {
    if (!(DATE_STATES as readonly string[]).includes(value))
      return { estado: { tipo: 'suscripcion', valor: value } };
    return {
      estado: { tipo: 'suscripcion', valor: { in: [...DATE_STATES] } },
      fechaFin:
        value === 'VENCIDA'
          ? { lte: context.cutoff }
          : value === 'PROXIMA_A_VENCER'
            ? { gt: context.cutoff, lte: context.near }
            : { gt: context.near },
    };
  }
  private currentState(row: SubscriptionView, context: StateContext): SubscriptionView {
    if (!(DATE_STATES as readonly string[]).includes(row.estado.valor)) return row;
    const value = datedState(row.fechaFin, context.today, context.days);
    return { ...row, estado: context.states.find((state) => state.valor === value)! };
  }
  // Lecturas puras: el estado visible es correcto aunque el worker tenga trabajo pendiente.
  async currentStates(rows: SubscriptionView[]) {
    if (!rows.length) return rows;
    const context = await this.stateContext(this.prisma);
    return rows.map((row) => this.currentState(row, context));
  }
  private async syncRow(
    tx: Prisma.TransactionClient,
    before: SubscriptionView,
    context: StateContext,
  ) {
    const current = this.currentState(before, context);
    if (current.estado.id === before.estado.id) return before;
    const after = await tx.suscripcion.update({
      where: { id: before.id },
      data: { estadoId: current.estado.id, version: { increment: 1 } },
      select: subscriptionSelect,
    });
    await this.audit(
      tx,
      null,
      'ESTADO_AUTOMATICO',
      before,
      after,
      'Evaluación por fecha ' + context.today,
    );
    return after;
  }
  async syncStates(today = businessDay()) {
    let changed = 0;
    // Confirmar cada lote conserva el progreso y libera el bloqueo entre lotes.
    // Si un lote falla, el siguiente intento retomará solo los registros pendientes.
    while (!this.stopping) {
      const count = await this.prisma.$transaction(
        async (tx) => {
          await this.lock(tx);
          const context = await this.stateContext(tx, today);
          const rows = await tx.suscripcion.findMany({
            where: {
              deletedAt: null,
              OR: context.states.map((state) => ({
                ...this.stateWhere(state.valor, context),
                NOT: { estadoId: state.id },
              })),
            },
            take: STATE_SYNC_BATCH_SIZE,
            orderBy: { id: 'asc' },
            select: subscriptionSelect,
          });
          for (const before of rows) await this.syncRow(tx, before, context);
          return rows.length;
        },
        { timeout: 30_000 },
      );
      changed += count;
      if (count < STATE_SYNC_BATCH_SIZE) break;
      // Ceder entre lotes permite atender lecturas y otras operaciones.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return changed;
  }
  async findAll(query: SubscriptionQueryDto) {
    const context = await this.stateContext(this.prisma);
    const where: Prisma.SuscripcionWhereInput = {
      deletedAt: null,
      ...(query.clienteId ? { clienteId: query.clienteId } : {}),
      ...(query.productoId ? { productoId: query.productoId } : {}),
      ...(query.servidorId ? { servidorId: query.servidorId } : {}),
      ...(query.referenciaId ? { referenciaId: query.referenciaId } : {}),
      ...(query.estado ? this.stateWhere(query.estado, context) : {}),
      ...(query.search
        ? {
            OR: [
              { cliente: { nombre: { contains: query.search.trim(), mode: 'insensitive' } } },
              { cliente: { telefono: { contains: query.search.trim(), mode: 'insensitive' } } },
              { producto: { nombre: { contains: query.search.trim(), mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.suscripcion.findMany({
        where,
        select: subscriptionSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
      }),
      this.prisma.suscripcion.count({ where }),
    ]);
    return {
      success: true,
      data: data.map((row) => this.currentState(row, context)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
  private async get(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.suscripcion.findFirst({
      where: { id, deletedAt: null },
      select: subscriptionSelect,
    });
    if (!row) throw new NotFoundException('Suscripción no encontrada.');
    return row;
  }
  async findOne(id: string) {
    const row = await this.get(this.prisma, id);
    return this.currentState(row, await this.stateContext(this.prisma));
  }
  async history(id: string, query: SubscriptionQueryDto) {
    await this.get(this.prisma, id);
    const where = { tabla: 'suscripciones', registroId: id };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.actividad.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          accion: true,
          createdAt: true,
          datosAnteriores: true,
          datosNuevos: true,
          usuario: { select: { nombre: true } },
        },
      }),
      this.prisma.actividad.count({ where }),
    ]);
    return {
      success: true,
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
  private async validateLinks(
    tx: Prisma.TransactionClient,
    input: {
      productoId: string;
      tarifaId: string;
      servidorId: string;
      referenciaId?: string | null;
    },
    before?: SubscriptionView,
  ) {
    // Mismo orden que Catálogos para evitar carreras con las desactivaciones.
    for (const kind of ['productos', 'tarifas', 'servidores', 'referencias'] as const)
      await lockCatalog(tx, kind);
    if (!before || input.tarifaId !== before.tarifaId) {
      const tariff = await tx.tarifa.findFirst({
        where: {
          id: input.tarifaId,
          productoId: input.productoId,
          activo: true,
          duracionMeses: 12,
          producto: { activo: true, deletedAt: null },
        },
      });
      if (!tariff)
        throw new BadRequestException('Selecciona una tarifa anual activa del producto indicado.');
    }
    if (!before || input.servidorId !== before.servidorId) {
      if (
        !(await tx.servidor.findFirst({
          where: { id: input.servidorId, activo: true, deletedAt: null },
        }))
      )
        throw new BadRequestException('El servidor debe estar activo.');
    }
    if (input.referenciaId && (!before || input.referenciaId !== before.referenciaId)) {
      if (
        !(await tx.referencia.findFirst({
          where: { id: input.referenciaId, activo: true, deletedAt: null },
        }))
      )
        throw new BadRequestException('La referencia debe estar activa.');
    }
  }
  private period(start: string) {
    const fechaInicio = parseDay(start);
    if (start > businessDay())
      throw new BadRequestException('No se permiten altas con fecha futura.');
    return { fechaInicio, fechaFin: annualEnd(fechaInicio) };
  }
  async create(dto: CreateSubscriptionDto, actor: string) {
    const normalized = {
      clienteId: dto.clienteId,
      productoId: dto.productoId,
      tarifaId: dto.tarifaId,
      servidorId: dto.servidorId,
      referenciaId: dto.referenciaId ?? null,
      fechaInicio: dto.fechaInicio,
      tipoDispositivo: dto.tipoDispositivo?.trim() || null,
      actor,
    };
    const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx);
        const previous = await tx.suscripcion.findUnique({
          where: { solicitudId: dto.solicitudId },
        });
        if (previous) {
          if (previous.solicitudHash !== hash || previous.deletedAt)
            throw new ConflictException('La clave de solicitud ya se utilizó con otros datos.');
          return this.currentState(await this.get(tx, previous.id), await this.stateContext(tx));
        }
        const dates = this.period(dto.fechaInicio);
        await validateClient(tx, dto.clienteId);
        await this.validateLinks(tx, dto);
        const state = datedState(dates.fechaFin, businessDay(), await this.warningDays(tx));
        const { actor: _actor, fechaInicio: _start, ...data } = normalized;
        const row = await tx.suscripcion.create({
          data: {
            ...data,
            ...dates,
            estadoId: await this.stateId(tx, state),
            solicitudId: dto.solicitudId,
            solicitudHash: hash,
          },
          select: subscriptionSelect,
        });
        await this.audit(tx, actor, 'CREAR', null, row);
        await this.reminders.syncSubscription(tx, row.id, actor);
        return row;
      },
      { timeout: 30_000 },
    );
  }
  async update(id: string, dto: UpdateSubscriptionDto, actor: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx);
        const stored = await this.get(tx, id);
        this.checkVersion(stored, dto.version);
        const before = await this.syncRow(tx, stored, await this.stateContext(tx));
        if (['CANCELADA', 'HISTORICA'].includes(before.estado.valor))
          throw new ConflictException('Una suscripción cancelada o histórica es de solo lectura.');
        const { version: _version, motivoCorreccion, fechaInicio, ...changes } = dto;
        await this.validateLinks(tx, { ...before, ...changes }, before);
        const dates =
          fechaInicio !== undefined && fechaInicio !== before.fechaInicio.toISOString().slice(0, 10)
            ? this.period(fechaInicio)
            : undefined;
        if (dates) {
          if (!motivoCorreccion?.trim())
            throw new BadRequestException(
              'Indica el motivo de la corrección de fecha; esta operación no es una renovación.',
            );
          if (await tx.renovacion.count({ where: { suscripcionId: id } }))
            throw new ConflictException(
              'Con renovaciones registradas, las fechas deben corregirse mediante el proceso de renovaciones.',
            );
        }
        const state =
          dates && before.estado.valor !== 'SUSPENDIDA'
            ? await this.stateId(
                tx,
                datedState(dates.fechaFin, businessDay(), await this.warningDays(tx)),
              )
            : undefined;
        const after = await tx.suscripcion.update({
          where: { id },
          data: {
            ...changes,
            ...dates,
            ...(state ? { estadoId: state } : {}),
            version: { increment: 1 },
          },
          select: subscriptionSelect,
        });
        await this.audit(
          tx,
          actor,
          dates ? 'CORREGIR_FECHAS' : 'EDITAR',
          before,
          after,
          motivoCorreccion,
        );
        await this.reminders.syncSubscription(tx, id, actor);
        return after;
      },
      { timeout: 30_000 },
    );
  }
  private checkVersion(row: SubscriptionView, version: number) {
    if (row.version !== version)
      throw new ConflictException(
        'La suscripción ha cambiado. Recarga los datos antes de guardar.',
      );
  }
  async transition(
    id: string,
    action: 'suspender' | 'reactivar' | 'cancelar',
    dto: SubscriptionActionDto,
    actor: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      const stored = await this.get(tx, id);
      this.checkVersion(stored, dto.version);
      const before = await this.syncRow(tx, stored, await this.stateContext(tx));
      const state = before.estado.valor;
      const dated = (DATE_STATES as readonly string[]).includes(state);
      if (
        (action === 'reactivar' && state !== 'SUSPENDIDA') ||
        (action === 'suspender' && !dated) ||
        (action === 'cancelar' && !dated && state !== 'SUSPENDIDA')
      )
        throw new ConflictException('Transición de estado no permitida.');
      const next =
        action === 'cancelar'
          ? 'CANCELADA'
          : action === 'suspender'
            ? 'SUSPENDIDA'
            : datedState(before.fechaFin, businessDay(), await this.warningDays(tx));
      const after = await tx.suscripcion.update({
        where: { id },
        data: { estadoId: await this.stateId(tx, next), version: { increment: 1 } },
        select: subscriptionSelect,
      });
      await this.audit(tx, actor, action.toUpperCase(), before, after, dto.motivo);
      await this.reminders.syncSubscription(tx, id, actor);
      return after;
    });
  }
}

async function validateClient(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRawUnsafe('SELECT id FROM clientes WHERE id = $1::uuid FOR UPDATE', id);
  if (
    !(await tx.cliente.findFirst({
      where: { id, deletedAt: null, estado: { tipo: 'cliente', valor: 'ACTIVO' } },
    }))
  )
    throw new BadRequestException('Selecciona un cliente activo.');
}
