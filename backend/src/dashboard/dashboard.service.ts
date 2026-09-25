import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { FinanzasService } from '../finanzas/finanzas.service';
import { FinanceQueryDto } from '../finanzas/finanzas.dto';
import { businessDay, parseDay, DATE_STATES } from '../suscripciones/subscription-dates';
import { warningDays } from '../recordatorios/recordatorios.service';
import { buildPaginatedResponse } from '../common/helpers/response.helper';
import { normalizePhone } from '../common/helpers/normalization';
import { DashboardClientsDto, DashboardQueryDto } from './dashboard.dto';

const dayString = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);
const DAY = 86400000;
const ongoing: Prisma.SuscripcionWhereInput = {
  deletedAt: null,
  estado: { tipo: 'suscripcion', valor: { in: [...DATE_STATES] } },
  cliente: { deletedAt: null, estado: { tipo: 'cliente', valor: 'ACTIVO' } },
};
export function dashboardPeriod(q: DashboardQueryDto, today = businessDay()) {
  if (Boolean(q.desde) !== Boolean(q.hasta))
    throw new BadRequestException('Indica inicio y fin del periodo.');
  const from = parseDay(q.desde ?? today.slice(0, 7) + '-01');
  const to = parseDay(q.hasta ?? today);
  const days = (to.getTime() - from.getTime()) / DAY + 1;
  if (days < 1 || days > 366)
    throw new BadRequestException('El periodo debe tener entre 1 y 366 días.');
  const previousFrom = addDays(from, -days);
  if (previousFrom.getUTCFullYear() < 1000)
    throw new BadRequestException('El periodo anterior queda fuera del rango válido.');
  return {
    desde: dayString(from),
    hasta: dayString(to),
    anteriorDesde: dayString(previousFrom),
    anteriorHasta: dayString(addDays(from, -1)),
    days,
  };
}
export function variation(current: number | string, previous: number | string) {
  const a = new Prisma.Decimal(current),
    b = new Prisma.Decimal(previous);
  return b.isZero() ? null : a.minus(b).div(b.abs()).mul(100).toFixed(1);
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finances: FinanzasService,
  ) {}

  async clients(q: DashboardClientsDto) {
    const where: Prisma.ClienteWhereInput = {
      deletedAt: null,
      ...(q.estado ? { estado: { valor: q.estado, tipo: 'cliente' } } : {}),
      ...(q.search?.trim()
        ? {
            OR: [
              { nombre: { contains: q.search.trim(), mode: 'insensitive' } },
              { telefono: { contains: q.search.trim() } },
              { telefonoNormalizado: { contains: normalizePhone(q.search) ?? q.search.trim() } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.cliente.findMany({
          where,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            nombre: true,
            telefono: true,
            createdAt: true,
            estado: { select: { valor: true, etiqueta: true } },
            _count: { select: { suscripciones: { where: { deletedAt: null } } } },
            suscripciones: {
              where: {
                deletedAt: null,
                noRenovar: false,
                estado: { valor: { in: [...DATE_STATES] } },
              },
              orderBy: [{ fechaFin: 'asc' }, { id: 'asc' }],
              take: 1,
              select: { id: true, fechaFin: true },
            },
          },
        });
        return buildPaginatedResponse(
          rows.map(({ _count, suscripciones, ...row }) => ({
            ...row,
            numeroSuscripciones: _count.suscripciones,
            proximaRenovacion: row.estado.valor === 'ACTIVO' ? (suscripciones[0] ?? null) : null,
          })),
          await tx.cliente.count({ where }),
          q.page,
          q.limit,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async summary(q: DashboardQueryDto) {
    const today = businessDay(),
      now = parseDay(today),
      period = dashboardPeriod(q, today);
    return this.prisma.$transaction(
      async (tx) => {
        const finance = (desde?: string, hasta?: string) =>
          this.finances.balance(Object.assign(new FinanceQueryDto(), { desde, hasta }), tx);
        const current = await finance(period.desde, period.hasta);
        const previous = await finance(period.anteriorDesde, period.anteriorHasta);
        const all = await finance();
        const days = await warningDays(tx),
          end = addDays(now, days);
        const eligible = { ...ongoing, noRenovar: false };
        const clients = await tx.cliente.count({
          where: {
            deletedAt: null,
            estado: { valor: 'ACTIVO', tipo: 'cliente' },
            suscripciones: {
              some: {
                deletedAt: null,
                estado: { valor: { in: [...DATE_STATES] } },
                fechaFin: { gt: now },
              },
            },
          },
        });
        const subscriptions = await tx.suscripcion.count({
          where: { ...ongoing, fechaFin: { gt: now } },
        });
        const [due, expired, upcoming] = await Promise.all([
          tx.suscripcion.count({ where: { ...eligible, fechaFin: now } }),
          tx.suscripcion.count({ where: { ...eligible, fechaFin: { lt: now } } }),
          tx.suscripcion.count({ where: { ...eligible, fechaFin: { gt: now, lte: end } } }),
        ]);
        // Fechas de alta son instantes UTC: agrupar por día civil de Madrid.
        const newClients = await tx.$queryRaw<{ dia: string; total: number }[]>(Prisma.sql`
        SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Madrid')::date::text AS dia, COUNT(*)::int AS total
        FROM clientes WHERE deleted_at IS NULL
          AND ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Madrid')::date BETWEEN ${period.anteriorDesde}::date AND ${period.hasta}::date
        GROUP BY dia`);
        const renewals = await tx.$queryRaw<{ dia: string; total: number }[]>(Prisma.sql`
        SELECT COALESCE(r.fecha_operacion, r.fecha_inicio)::date::text AS dia, COUNT(*)::int AS total
        FROM renovaciones r JOIN estados e ON e.id = r.estado_id
        WHERE r.deleted_at IS NULL AND r.tipo_operacion = 'RENOVACION' AND e.valor = 'COMPLETADA'
          AND COALESCE(r.fecha_operacion, r.fecha_inicio)::date BETWEEN ${period.anteriorDesde}::date AND ${period.hasta}::date
        GROUP BY dia`);
        const totals = (rows: { dia: string; total: number }[], from: string, to: string) =>
          rows
            .filter((row) => row.dia >= from && row.dia <= to)
            .reduce((sum, row) => sum + row.total, 0);
        const n = totals(newClients, period.desde, period.hasta),
          p = totals(newClients, period.anteriorDesde, period.anteriorHasta);
        const r = totals(renewals, period.desde, period.hasta),
          rp = totals(renewals, period.anteriorDesde, period.anteriorHasta);
        const moneySeries = await tx.$queryRaw<
          { dia: string; tipo: string; importe: Prisma.Decimal }[]
        >(Prisma.sql`
        SELECT COALESCE(m.fecha_cobro, m.fecha)::date::text AS dia, t.valor AS tipo, SUM(m.importe) AS importe
        FROM movimientos_financieros m JOIN estados t ON t.id = m.tipo_id JOIN estados e ON e.id = m.estado_id
        WHERE e.valor = 'CONFIRMADO' AND COALESCE(m.fecha_cobro,m.fecha) >= ${parseDay(period.desde)}
          AND COALESCE(m.fecha_cobro,m.fecha) < ${addDays(parseDay(period.hasta), 1)}
        GROUP BY dia, t.valor`);
        const series = Array.from({ length: period.days }, (_, i) => {
          const dia = dayString(addDays(parseDay(period.desde), i));
          return {
            dia,
            ingresos:
              moneySeries.find((x) => x.dia === dia && x.tipo === 'INGRESO')?.importe.toFixed(2) ??
              '0.00',
            gastos:
              moneySeries.find((x) => x.dia === dia && x.tipo === 'GASTO')?.importe.toFixed(2) ??
              '0.00',
            clientes: newClients.find((x) => x.dia === dia)?.total ?? 0,
            renovaciones: renewals.find((x) => x.dia === dia)?.total ?? 0,
          };
        });
        const renewalRows = await tx.suscripcion.findMany({
          where: { ...eligible, fechaFin: { lte: end } },
          take: 5,
          orderBy: [{ fechaFin: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            fechaFin: true,
            cliente: { select: { id: true, nombre: true } },
            producto: { select: { nombre: true } },
          },
        });
        const debts = await tx.movimientoFinanciero.findMany({
          where: { tipo: { valor: 'INGRESO' }, estado: { valor: 'PENDIENTE' } },
          take: 5,
          orderBy: [{ fechaPrevistaCobro: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            importe: true,
            fechaPrevistaCobro: true,
            renovacionId: true,
            suscripcion: { select: { cliente: { select: { nombre: true } } } },
          },
        });
        const reminders = await tx.recordatorio.findMany({
          where: { estado: { valor: 'PENDIENTE' }, fecha: { lte: end } },
          take: 5,
          orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            fecha: true,
            suscripcionId: true,
            tipo: { select: { valor: true, etiqueta: true } },
            cliente: { select: { id: true, nombre: true } },
          },
        });
        const activity = await tx.actividad.findMany({
          take: 8,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            accion: true,
            tabla: true,
            registroId: true,
            createdAt: true,
            usuario: { select: { nombre: true } },
          },
        });
        const importStates = await tx.importacionFila.groupBy({ by: ['estado'], _count: true });
        const countRows = (states: string[]) =>
          importStates
            .filter((row) => states.includes(row.estado))
            .reduce((sum, row) => sum + row._count, 0);
        const importQuality = {
          ultima: await tx.importacion.findFirst({
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { id: true, estado: true, createdAt: true },
          }),
          pendientes: importStates
            .filter((row) => !['IMPORTADA', 'RECHAZADA'].includes(row.estado))
            .reduce((sum, row) => sum + row._count, 0),
          bloqueadas: countRows(['ERROR', 'EN_CONFLICTO']),
          pendientesFinancieras: countRows(['PENDIENTE_FINANCIERA']),
        };
        return {
          calidadImportacion: importQuality,
          hoy: today,
          periodo: period,
          actualizado: new Date().toISOString(),
          indicadores: {
            clientesVigentes: clients,
            suscripcionesVigentes: subscriptions,
            renovaciones: r,
            nuevosClientes: n,
            ingresos: current.ingresos,
            gastos: current.gastos,
            resultado: current.resultado,
            pendienteCobro: all.pendienteCobro,
            numeroPendientes: all.numeroPendientes,
            totalClientes: await tx.cliente.count({ where: { deletedAt: null } }),
          },
          variacion: {
            renovaciones: variation(r, rp),
            nuevosClientes: variation(n, p),
            ingresos: variation(current.ingresos, previous.ingresos),
            gastos: variation(current.gastos, previous.gastos),
            resultado: variation(current.resultado, previous.resultado),
          },
          serie: series,
          trabajo: {
            hoy: due,
            vencidas: expired,
            proximas: upcoming,
            diasAviso: days,
            renovaciones: renewalRows,
            cobros: debts,
            recordatorios: reminders,
          },
          actividad: activity,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }
}
