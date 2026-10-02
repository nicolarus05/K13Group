import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { businessDay, parseDay, DATE_STATES } from '../suscripciones/subscription-dates';

export async function subscriptionLock(tx: Prisma.TransactionClient) {
  await tx.$queryRawUnsafe(
    'SELECT 1 FROM pg_advisory_xact_lock(hashtext($1))',
    'suscripciones:gestion',
  );
}
export async function stateId(tx: Prisma.TransactionClient, tipo: string, valor: string) {
  return (await tx.estado.findUniqueOrThrow({ where: { tipo_valor: { tipo, valor } } })).id;
}
export async function warningDays(tx: Prisma.TransactionClient) {
  const config = await tx.configuracion.findUnique({
    where: { clave: 'suscripciones.dias_proxima' },
  });
  const days = config ? Number(config.valor) : 7;
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : 7;
}
export async function audit(
  tx: Prisma.TransactionClient,
  actor: string | null,
  tabla: string,
  id: string,
  accion: string,
  before: unknown,
  after: unknown,
) {
  const json = (v: unknown) => (v == null ? Prisma.JsonNull : JSON.parse(JSON.stringify(v)));
  await tx.actividad.create({
    data: {
      usuarioId: actor,
      tabla,
      registroId: id,
      accion,
      datosAnteriores: json(before),
      datosNuevos: json(after),
    },
  });
}
@Injectable()
export class RecordatoriosService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  private readonly logger = new Logger(RecordatoriosService.name);
  constructor(private readonly prisma: PrismaService) {}
  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.sync();
      } catch {
        this.logger.error('No se pudieron actualizar los avisos internos; se reintentará.');
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => void tick(), 60_000);
    this.timer.unref();
    void tick();
  }
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
  async close(tx: Prisma.TransactionClient, key: string, completed: boolean, actor: string | null) {
    const before = await tx.recordatorio.findUnique({
      where: { claveAutomatica: key },
      include: { estado: true },
    });
    if (!before) return;
    const terminal = ['COMPLETADO', 'CANCELADO'].includes(before.estado.valor);
    const after = await tx.recordatorio.update({
      where: { id: before.id },
      data: {
        claveAutomatica: null,
        version: { increment: 1 },
        ...(terminal
          ? {}
          : {
              cerradoAt: new Date(),
              estadoId: await stateId(
                tx,
                'recordatorio_estado',
                completed ? 'COMPLETADO' : 'CANCELADO',
              ),
            }),
      },
    });
    await audit(
      tx,
      actor,
      'recordatorios',
      after.id,
      terminal ? 'LIBERAR_ORIGEN' : completed ? 'COMPLETAR' : 'CANCELAR',
      before,
      after,
    );
  }
  async ensure(
    tx: Prisma.TransactionClient,
    key: string,
    subscription: { id: string; clienteId: string },
    kind: string,
    fecha: Date,
    descripcion: string,
    actor: string | null,
  ) {
    if (await tx.recordatorio.findUnique({ where: { claveAutomatica: key } })) return;
    const after = await tx.recordatorio.create({
      data: {
        claveAutomatica: key,
        origen: 'AUTOMATICO',
        fechaOriginal: fecha,
        movimientoId:
          kind === 'COBRO'
            ? (
                await tx.movimientoFinanciero.findFirst({
                  where: { renovacionId: key.slice(2), suscripcionId: subscription.id },
                  select: { id: true },
                })
              )?.id
            : undefined,
        suscripcionId: subscription.id,
        clienteId: subscription.clienteId,
        tipoId: await stateId(tx, 'recordatorio_tipo', kind),
        estadoId: await stateId(tx, 'recordatorio_estado', 'PENDIENTE'),
        fecha,
        descripcion,
      },
    });
    await audit(tx, actor, 'recordatorios', after.id, 'CREAR', null, after);
  }
  async syncSubscription(
    tx: Prisma.TransactionClient,
    id: string,
    actor: string | null = null,
    completed = false,
  ) {
    const row = await tx.suscripcion.findUniqueOrThrow({
      where: { id },
      include: { estado: true, cliente: { include: { estado: true } } },
    });
    const cutoff = new Date(parseDay(businessDay()).getTime() + (await warningDays(tx)) * 86400000);
    const eligible =
      !row.deletedAt &&
      !row.cliente.deletedAt &&
      row.cliente.estado.valor === 'ACTIVO' &&
      !row.noRenovar &&
      (DATE_STATES as readonly string[]).includes(row.estado.valor) &&
      row.fechaFin <= cutoff;
    const key = 'R:' + row.id + ':' + row.fechaFin.toISOString().slice(0, 10);
    const old = await tx.recordatorio.findMany({
      where: { suscripcionId: id, claveAutomatica: { startsWith: 'R:' } },
    });
    for (const item of old)
      if (!eligible || item.claveAutomatica !== key)
        await this.close(tx, item.claveAutomatica!, completed, actor);
    if (eligible)
      await this.ensure(
        tx,
        key,
        row,
        'RENOVACION',
        row.fechaFin,
        'Renovación del periodo que vence el ' + row.fechaFin.toISOString().slice(0, 10),
        actor,
      );
  }
  async sync() {
    let cursor: string | undefined;
    while (!this.stopped) {
      const ids = await this.prisma.$transaction(
        async (tx) => {
          await subscriptionLock(tx);
          const cutoff = new Date(
            parseDay(businessDay()).getTime() + (await warningDays(tx)) * 86400000,
          );
          const rows = await tx.suscripcion.findMany({
            where: {
              ...(cursor ? { id: { gt: cursor } } : {}),
              OR: [
                {
                  deletedAt: null,
                  noRenovar: false,
                  fechaFin: { lte: cutoff },
                  estado: { valor: { in: [...DATE_STATES] } },
                  cliente: { deletedAt: null, estado: { valor: 'ACTIVO' } },
                },
                { recordatorios: { some: { claveAutomatica: { startsWith: 'R:' } } } },
              ],
            },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: 100,
          });
          for (const row of rows) await this.syncSubscription(tx, row.id);
          return rows;
        },
        { timeout: 30_000 },
      );
      if (ids.length < 100) break;
      cursor = ids[ids.length - 1].id;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}
