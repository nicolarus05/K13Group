import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { businessDay, parseDay } from '../suscripciones/subscription-dates';
import { variation } from '../dashboard/dashboard.service';
import { warningDays } from '../recordatorios/recordatorios.service';
import {
  StatsQuery,
  Section,
  statsPeriod,
  validateFilters,
  buckets,
  shift,
} from './estadisticas.dto';

type Tx = Prisma.TransactionClient;
type Period = ReturnType<typeof statsPeriod>;
const money = (n: Prisma.Decimal | number | string | null | undefined) =>
  new Prisma.Decimal(n ?? 0).toFixed(2);
const total = (values: (string | null)[]) =>
  values.reduce<Prisma.Decimal>((s, n) => s.plus(n ?? 0), new Prisma.Decimal(0)).toFixed(2);
const grain = (q: StatsQuery) => ({ dia: 'day', mes: 'month', ano: 'year' })[q.agrupacion];
const range = (expr: Prisma.Sql, from: string, to: string) =>
  Prisma.sql`${expr} >= ${parseDay(from)} AND ${expr} < ${parseDay(shift(to, 1))}`;
const dimensionFilters = (q: StatsQuery, alias: 'm' | 'r' | 's') => {
  const filters: Prisma.Sql[] = [];
  for (const [field, column] of [
    ['productoId', 'producto'],
    ['servidorId', 'servidor'],
    ['referenciaId', 'referencia'],
  ] as const)
    if (q[field])
      filters.push(
        Prisma.sql`${Prisma.raw(alias + '.' + column + (alias === 's' ? '_id' : '_id_snapshot'))}=${q[field]}::uuid`,
      );
  if (filters.length && alias !== 's')
    filters.push(Prisma.sql`${Prisma.raw(alias + '.atribucion_verificada')}=true`);
  return filters.length ? Prisma.sql`AND ${Prisma.join(filters, ' AND ')}` : Prisma.empty;
};
const live = Prisma.sql`s.deleted_at IS NULL AND c.deleted_at IS NULL AND ce.valor='ACTIVO' AND se.valor IN ('ACTIVA','PROXIMA_A_VENCER','VENCIDA')`;

@Injectable()
export class EstadisticasService {
  constructor(private readonly prisma: PrismaService) {}
  async report(
    section: Section,
    q: StatsQuery,
    client?: Prisma.TransactionClient,
    hoy = businessDay(),
  ) {
    validateFilters(section, q);
    const p = statsPeriod(q, hoy);
    const read = async (tx: Prisma.TransactionClient) => {
      const common = {
        seccion: section,
        hoy,
        periodo: p,
        actualizado: new Date().toISOString(),
        calidad: {
          filasSinConciliar: await tx.importacionFila.count({
            where: { estado: { notIn: ['IMPORTADA', 'RECHAZADA'] } },
          }),
        },
      };
      if (['productos', 'servidores', 'referencias', 'metodos-pago'].includes(section))
        return { ...common, ranking: await this.ranking(tx, section as Dimension, q, p, hoy) };
      if (section === 'clientes') return { ...common, clientes: await this.clients(tx, q, p, hoy) };
      if (section === 'renovaciones')
        return { ...common, renovaciones: await this.renewals(tx, q, p, hoy) };
      const actual = await this.finances(tx, q, p.desde, p.hasta),
        anterior = await this.finances(tx, q, p.anteriorDesde, p.anteriorHasta);
      const financiero = {
        ...actual,
        anterior,
        variacion: {
          ingresos:
            actual.ingresos !== null && anterior.ingresos !== null
              ? variation(actual.ingresos, anterior.ingresos)
              : null,
          gastos:
            actual.gastos !== null && anterior.gastos !== null
              ? variation(actual.gastos, anterior.gastos)
              : null,
          resultado:
            actual.resultado !== null && anterior.resultado !== null
              ? variation(actual.resultado, anterior.resultado)
              : null,
        },
      };
      return {
        ...common,
        finanzas: financiero,
        ...(section === 'resumen'
          ? {
              clientes: await this.clients(tx, q, p, hoy),
              renovaciones: await this.renewals(tx, q, p, hoy),
            }
          : {
              ranking: await this.ranking(
                tx,
                q.metodoPagoId ? 'metodos-pago' : 'categorias',
                q,
                p,
                hoy,
              ),
            }),
      };
    };
    return client
      ? read(client)
      : this.prisma.$transaction(read, {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 30000,
        });
  }

  private async finances(tx: Tx, q: StatsQuery, desde: string, hasta: string) {
    const filter = q.metodoPagoId
      ? Prisma.sql`AND t.valor='INGRESO' AND COALESCE(m.metodo_pago_id,r.metodo_pago_id)=${q.metodoPagoId}::uuid`
      : q.categoriaGastoId
        ? Prisma.sql`AND t.valor='GASTO' AND m.categoria_gasto_id=${q.categoriaGastoId}::uuid`
        : Prisma.empty;
    const rows = await tx.$queryRaw<
      { dia: string; tipo: string; importe: Prisma.Decimal; cantidad: number }[]
    >(Prisma.sql`
      SELECT date_trunc(${grain(q)},COALESCE(m.fecha_cobro,m.fecha))::date::text dia,t.valor tipo,SUM(m.importe) importe,COUNT(*)::int cantidad
      FROM movimientos_financieros m JOIN estados t ON t.id=m.tipo_id JOIN estados e ON e.id=m.estado_id LEFT JOIN renovaciones r ON r.id=m.renovacion_id
      WHERE e.valor='CONFIRMADO' AND ${range(Prisma.sql`COALESCE(m.fecha_cobro,m.fecha)`, desde, hasta)} ${filter}
      GROUP BY dia,t.valor`);
    const series = buckets(desde, hasta, q.agrupacion).map((dia) => ({
      dia,
      ingresos: q.categoriaGastoId
        ? null
        : money(rows.find((r) => r.dia === dia && r.tipo === 'INGRESO')?.importe),
      gastos: q.metodoPagoId
        ? null
        : money(rows.find((r) => r.dia === dia && r.tipo === 'GASTO')?.importe),
    }));
    const ingresos = q.categoriaGastoId ? null : total(series.map((r) => r.ingresos)),
      gastos = q.metodoPagoId ? null : total(series.map((r) => r.gastos));
    const numeroIngresos = rows
        .filter((r) => r.tipo === 'INGRESO')
        .reduce((n, r) => n + r.cantidad, 0),
      numeroGastos = rows.filter((r) => r.tipo === 'GASTO').reduce((n, r) => n + r.cantidad, 0);
    return {
      ingresos,
      gastos,
      resultado:
        ingresos !== null && gastos !== null
          ? money(new Prisma.Decimal(ingresos).minus(gastos))
          : null,
      numeroIngresos,
      numeroGastos,
      ticketMedio:
        ingresos === null
          ? null
          : money(numeroIngresos ? new Prisma.Decimal(ingresos).div(numeroIngresos) : 0),
      serie: series.map((r) => ({
        ...r,
        resultado:
          r.ingresos !== null && r.gastos !== null
            ? money(new Prisma.Decimal(r.ingresos).minus(r.gastos))
            : null,
      })),
    };
  }

  private async clients(tx: Tx, q: StatsQuery, p: Period, hoy: string) {
    const currentFilter = q.estadoCliente
      ? Prisma.sql`AND ce.valor=${q.estadoCliente}`
      : Prisma.empty;
    const [now] = await tx.$queryRaw<
      { total: number; vigentes: number; perdidos: number; noRenovar: number }[]
    >(Prisma.sql`
      SELECT COUNT(*)::int total,
      COUNT(*) FILTER(WHERE ce.valor='ACTIVO' AND EXISTS(SELECT 1 FROM suscripciones s JOIN estados se ON se.id=s.estado_id WHERE s.cliente_id=c.id AND s.deleted_at IS NULL AND se.valor IN ('ACTIVA','PROXIMA_A_VENCER','VENCIDA') AND s.fecha_fin>${parseDay(hoy)}))::int vigentes,
      COUNT(*) FILTER(WHERE (SELECT MAX(s.fecha_fin) FROM suscripciones s JOIN estados se ON se.id=s.estado_id WHERE s.cliente_id=c.id AND s.deleted_at IS NULL AND se.valor<>'BORRADOR') <= ${parseDay(shift(hoy, -30))})::int perdidos,
      COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM suscripciones s WHERE s.cliente_id=c.id AND s.deleted_at IS NULL AND s.no_renovar))::int "noRenovar"
      FROM clientes c JOIN estados ce ON ce.id=c.estado_id WHERE c.deleted_at IS NULL ${currentFilter}`);
    const rows = await tx.$queryRaw<{ dia: string; total: number }[]>(Prisma.sql`
      SELECT date_trunc(${grain(q)},((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Madrid'))::date::text dia,COUNT(*)::int total
      FROM clientes c WHERE c.deleted_at IS NULL AND ${range(Prisma.sql`((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Madrid')`, p.desde, p.hasta)} GROUP BY dia`);
    const [previous] = await tx.$queryRaw<{ total: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int total FROM clientes c WHERE c.deleted_at IS NULL AND ${range(Prisma.sql`((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Madrid')`, p.anteriorDesde, p.anteriorHasta)}`,
    );
    const altas = rows.reduce((n, r) => n + r.total, 0);
    const products = await tx.$queryRaw<
      { id: string; nombre: string; clientes: number }[]
    >(Prisma.sql`
      SELECT p.id,p.nombre,COUNT(DISTINCT c.id)::int clientes FROM suscripciones s JOIN clientes c ON c.id=s.cliente_id JOIN estados ce ON ce.id=c.estado_id JOIN estados se ON se.id=s.estado_id JOIN productos p ON p.id=s.producto_id WHERE ${live} AND s.fecha_fin>${parseDay(hoy)} ${currentFilter} GROUP BY p.id,p.nombre ORDER BY clientes DESC,p.id LIMIT 10`);
    return {
      actual: now,
      altas,
      altasAnteriores: previous.total,
      variacion: variation(altas, previous.total),
      serie: buckets(p.desde, p.hasta, q.agrupacion).map((dia) => ({
        dia,
        altas: rows.find((r) => r.dia === dia)?.total ?? 0,
      })),
      productosActuales: products,
    };
  }

  private async renewals(tx: Tx, q: StatsQuery, p: Period, hoy: string) {
    const diasAviso = await warningDays(tx);
    const operationFilter = q.estadoOperacion
      ? Prisma.sql`AND e.valor=${q.estadoOperacion}`
      : Prisma.empty;
    const [counts] = await tx.$queryRaw<
      {
        realizadas: number;
        altas: number;
        anuladas: number;
        gratuitas: number;
        pendientesCobro: number;
      }[]
    >(Prisma.sql`
      SELECT COUNT(*) FILTER(WHERE r.tipo_operacion='RENOVACION' AND e.valor='COMPLETADA')::int realizadas,
       COUNT(*) FILTER(WHERE r.tipo_operacion='ALTA' AND e.valor='COMPLETADA')::int altas,
       COUNT(*) FILTER(WHERE e.valor='ANULADA')::int anuladas,
       COUNT(*) FILTER(WHERE e.valor='COMPLETADA' AND r.importe=0)::int gratuitas,
       COUNT(*) FILTER(WHERE e.valor='COMPLETADA' AND EXISTS(SELECT 1 FROM movimientos_financieros m JOIN estados me ON me.id=m.estado_id WHERE m.renovacion_id=r.id AND me.valor='PENDIENTE'))::int "pendientesCobro"
      FROM renovaciones r JOIN estados e ON e.id=r.estado_id WHERE r.deleted_at IS NULL AND ${range(Prisma.sql`COALESCE(r.fecha_operacion,r.fecha_inicio)`, p.desde, p.hasta)} ${operationFilter}`);
    const series = await tx.$queryRaw<{ dia: string; total: number }[]>(
      Prisma.sql`SELECT date_trunc(${grain(q)},COALESCE(r.fecha_operacion,r.fecha_inicio))::date::text dia,COUNT(*)::int total FROM renovaciones r JOIN estados e ON e.id=r.estado_id WHERE r.deleted_at IS NULL AND r.tipo_operacion='RENOVACION' AND e.valor='COMPLETADA' AND ${range(Prisma.sql`COALESCE(r.fecha_operacion,r.fecha_inicio)`, p.desde, p.hasta)} ${operationFilter} GROUP BY dia`,
    );
    const [cohort] = await tx.$queryRaw<
      { clientes: number; renovados: number; sinVencimientoAnterior: number }[]
    >(Prisma.sql`
      WITH valid AS (SELECT r.* FROM renovaciones r JOIN estados e ON e.id=r.estado_id WHERE r.deleted_at IS NULL AND e.valor='COMPLETADA'),
      periods AS (
        SELECT s.id,s.cliente_id,s.fecha_fin vencimiento FROM suscripciones s JOIN estados e ON e.id=s.estado_id WHERE s.deleted_at IS NULL AND e.valor<>'BORRADOR'
        UNION SELECT s.id,s.cliente_id,r.fecha_fin FROM valid r JOIN suscripciones s ON s.id=r.suscripcion_id
        UNION SELECT s.id,s.cliente_id,r.fin_anterior FROM valid r JOIN suscripciones s ON s.id=r.suscripcion_id WHERE r.tipo_operacion='RENOVACION' AND r.fin_anterior IS NOT NULL),
      customers AS (SELECT p.cliente_id,BOOL_OR(EXISTS(SELECT 1 FROM valid r WHERE r.suscripcion_id=p.id AND r.tipo_operacion='RENOVACION' AND r.fin_anterior=p.vencimiento)) renovado FROM periods p WHERE ${range(Prisma.sql`p.vencimiento`, p.desde, p.hasta)} GROUP BY p.cliente_id)
      SELECT COUNT(*)::int clientes,COUNT(*) FILTER(WHERE renovado)::int renovados,
        (SELECT COUNT(*)::int FROM valid WHERE tipo_operacion='RENOVACION' AND fin_anterior IS NULL) "sinVencimientoAnterior" FROM customers`);
    const porcentaje = cohort.clientes
      ? new Prisma.Decimal(cohort.renovados).div(cohort.clientes).mul(100).toFixed(1)
      : null;
    const [work] = await tx.$queryRaw<{ vencidas: number; hoy: number; proximas: number }[]>(
      Prisma.sql`SELECT COUNT(*) FILTER(WHERE s.fecha_fin<${parseDay(hoy)})::int vencidas,COUNT(*) FILTER(WHERE s.fecha_fin=${parseDay(hoy)})::int hoy,COUNT(*) FILTER(WHERE s.fecha_fin>${parseDay(hoy)})::int proximas FROM suscripciones s JOIN clientes c ON c.id=s.cliente_id JOIN estados ce ON ce.id=c.estado_id JOIN estados se ON se.id=s.estado_id WHERE ${live} AND NOT s.no_renovar AND s.fecha_fin<=${parseDay(shift(hoy, diasAviso))}`,
    );
    return {
      ...counts,
      tasa: {
        ...cohort,
        porcentaje: cohort.sinVencimientoAnterior ? null : porcentaje,
        porcentajeObservable: porcentaje,
        provisional: p.hasta >= hoy,
      },
      situacionActual: { ...work, diasAviso },
      serie: buckets(p.desde, p.hasta, q.agrupacion).map((dia) => ({
        dia,
        renovaciones: series.find((r) => r.dia === dia)?.total ?? 0,
      })),
    };
  }

  private async ranking(tx: Tx, dim: Dimension, q: StatsQuery, p: Period, hoy: string) {
    const definitions = {
      productos: { col: 'producto', table: 'productos' },
      servidores: { col: 'servidor', table: 'servidores' },
      referencias: { col: 'referencia', table: 'referencias' },
      'metodos-pago': { col: 'metodo_pago', table: 'metodos_pago' },
      categorias: { col: 'categoria_gasto', table: 'categorias_gasto' },
    };
    const { col, table } = definitions[dim],
      historic = ['productos', 'servidores', 'referencias'].includes(dim);
    const key = (a: 'm' | 'r' | 's') =>
      historic && a !== 's'
        ? Prisma.raw(
            `CASE WHEN NOT ${a}.atribucion_verificada THEN 'sin-atribucion' ELSE COALESCE(${a}.${col}_id_snapshot::text,'${dim === 'referencias' ? 'sin-referencia' : 'sin-atribucion'}') END`,
          )
        : a === 'm' && dim === 'metodos-pago'
          ? Prisma.sql`COALESCE(m.metodo_pago_id,r.metodo_pago_id)::text`
          : Prisma.raw(`${a}.${col}_id::text`);
    const name = (a: 'm' | 'r') =>
      Prisma.raw(`${a}.${col === 'categoria_gasto' ? 'categoria' : col}_nombre_snapshot`);
    const pay = q.metodoPagoId
      ? Prisma.sql`AND COALESCE(m.metodo_pago_id,r.metodo_pago_id)=${q.metodoPagoId}::uuid`
      : Prisma.empty;
    const cat = q.categoriaGastoId
      ? Prisma.sql`AND m.categoria_gasto_id=${q.categoriaGastoId}::uuid`
      : Prisma.empty;
    const renewalPart = historic
      ? Prisma.sql`UNION ALL SELECT ${key('r')} clave,MAX(${name('r')}) nombre,0::numeric importe,0::int cobros,COUNT(*)::int renovaciones,0::int clientes_cobro,0::int clientes_actuales FROM renovaciones r JOIN estados e ON e.id=r.estado_id WHERE e.valor='COMPLETADA' AND r.deleted_at IS NULL AND r.tipo_operacion='RENOVACION' AND ${range(Prisma.sql`COALESCE(r.fecha_operacion,r.fecha_inicio)`, p.desde, p.hasta)} ${dimensionFilters(q, 'r')} GROUP BY clave`
      : Prisma.empty;
    const currentPart = historic
      ? Prisma.sql`UNION ALL SELECT COALESCE(${key('s')},'sin-referencia') clave,MAX(d.nombre) nombre,0::numeric importe,0::int cobros,0::int renovaciones,0::int clientes_cobro,COUNT(DISTINCT c.id)::int clientes_actuales FROM suscripciones s JOIN clientes c ON c.id=s.cliente_id JOIN estados ce ON ce.id=c.estado_id JOIN estados se ON se.id=s.estado_id LEFT JOIN ${Prisma.raw(table)} d ON d.id=${Prisma.raw('s.' + col + '_id')} WHERE ${live} AND s.fecha_fin>${parseDay(hoy)} ${dimensionFilters(q, 's')} GROUP BY clave`
      : Prisma.empty;
    const cte = Prisma.sql`WITH source AS (
      SELECT COALESCE(${key('m')},'sin-atribucion') clave,MAX(${name('m')}) nombre,SUM(m.importe) importe,COUNT(*)::int cobros,0::int renovaciones,COUNT(DISTINCT s.cliente_id)::int clientes_cobro,0::int clientes_actuales
      FROM movimientos_financieros m JOIN estados e ON e.id=m.estado_id JOIN estados t ON t.id=m.tipo_id LEFT JOIN renovaciones r ON r.id=m.renovacion_id LEFT JOIN suscripciones s ON s.id=m.suscripcion_id
      WHERE e.valor='CONFIRMADO' AND t.valor=${dim === 'categorias' ? 'GASTO' : 'INGRESO'} AND ${range(Prisma.sql`COALESCE(m.fecha_cobro,m.fecha)`, p.desde, p.hasta)} ${dimensionFilters(q, 'm')} ${pay} ${cat} GROUP BY clave
      ${renewalPart} ${currentPart}), grouped AS (
      SELECT clave,CASE WHEN clave='sin-atribucion' THEN 'Sin atribución verificable' WHEN clave='sin-referencia' THEN 'Sin referencia' ELSE COALESCE(MAX(d.nombre),MAX(source.nombre),'Sin nombre') END nombre,
      SUM(importe) importe,SUM(cobros)::int operaciones,SUM(renovaciones)::int renovaciones,SUM(clientes_cobro)::int "clientesCobro",SUM(clientes_actuales)::int "clientesActuales"
      FROM source LEFT JOIN ${Prisma.raw(table)} d ON d.id::text=source.clave GROUP BY clave)`;
    type Row = {
      clave: string;
      nombre: string;
      importe: Prisma.Decimal;
      operaciones: number;
      renovaciones: number;
      clientesCobro: number;
      clientesActuales: number;
    };
    const [totals] = await tx.$queryRaw<{ total: number; importe: Prisma.Decimal }[]>(
      Prisma.sql`${cte} SELECT COUNT(*)::int total,COALESCE(SUM(importe),0) importe FROM grouped`,
    );
    const rows = await tx.$queryRaw<Row[]>(
      Prisma.sql`${cte} SELECT * FROM grouped ORDER BY importe DESC,clave LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    );
    const top = await tx.$queryRaw<Row[]>(
      Prisma.sql`${cte} SELECT * FROM grouped WHERE importe>0 ORDER BY importe DESC,clave LIMIT 10`,
    );
    const chart = top.map((r) => ({ clave: r.clave, nombre: r.nombre, importe: money(r.importe) }));
    const rest = new Prisma.Decimal(totals.importe).minus(total(chart.map((r) => r.importe)));
    if (rest.gt(0)) chart.push({ clave: 'otros', nombre: 'Otros', importe: money(rest) });
    return {
      dimension: dim,
      totalImporte: money(totals.importe),
      data: rows.map((r) => ({
        ...r,
        importe: money(r.importe),
        porcentaje: new Prisma.Decimal(totals.importe).isZero()
          ? null
          : r.importe.div(totals.importe).mul(100).toFixed(1),
      })),
      grafico: chart,
      pagination: {
        page: q.page,
        limit: q.limit,
        total: totals.total,
        totalPages: Math.ceil(totals.total / q.limit),
      },
    };
  }
}
type Dimension = 'productos' | 'servidores' | 'referencias' | 'metodos-pago' | 'categorias';
