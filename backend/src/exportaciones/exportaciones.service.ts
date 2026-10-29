import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { isUUID, validate } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { ClientesService } from '../clientes/clientes.service';
import { FindClientesDto } from '../clientes/dto/find-clientes.dto';
import { SuscripcionesService } from '../suscripciones/suscripciones.service';
import { SubscriptionQueryDto } from '../suscripciones/suscripciones.dto';
import { RenovacionesService } from '../renovaciones/renovaciones.service';
import { RenewalQueryDto } from '../renovaciones/renovaciones.dto';
import { FinanzasService } from '../finanzas/finanzas.service';
import { FinanceQueryDto } from '../finanzas/finanzas.dto';
import { EstadisticasService } from '../estadisticas/estadisticas.service';
import { SECTIONS, Section, StatsQuery } from '../estadisticas/estadisticas.dto';
import { ExportRequest } from './exportaciones.dto';
import { Cell, ExportDocument, Table } from './export-document';
import { renderInWorker } from './export-renderer';
import { businessDay } from '../suscripciones/subscription-dates';

type Row = Record<string, unknown>;
const json = (value: unknown): Row => JSON.parse(JSON.stringify(value)) as Row;
const value = (row: Row, path: string): Cell => {
  const found = path
    .split('.')
    .reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Row)[k] : null), row);
  return typeof found === 'string' || typeof found === 'number' || typeof found === 'boolean'
    ? found
    : null;
};
const movementValues = (row: Row, key: string, date = false): string | null => {
  if (!Array.isArray(row.movimientos)) return null;
  const values = row.movimientos.map((m) => {
    const v = value(m as Row, key);
    return v === null ? '' : date ? String(v).slice(0, 10) : String(v);
  });
  return values.some(Boolean) ? values.join('\n') : null;
};
type Column = [string, string, ('money' | 'date')?];
const table = (name: string, columns: Column[], rows: Row[]): Table => ({
  name,
  columns: columns.map((c) => c[0]),
  types: columns.map((c) => c[2]),
  rows: rows.map((r) =>
    columns.map(([, path, type]) => {
      const v = value(r, path);
      return v === null
        ? null
        : type === 'money'
          ? Number(v)
          : type === 'date'
            ? String(v).slice(0, 10)
            : v;
    }),
  ),
});
const subscriptionColumns: Column[] = [
  ['Cliente', 'cliente.nombre'],
  ['Teléfono', 'cliente.telefono'],
  ['Producto', 'producto.nombre'],
  ['Tarifa', 'tarifa.nombre'],
  ['Servidor', 'servidor.nombre'],
  ['Referencia', 'referencia.nombre'],
  ['Inicio', 'fechaInicio', 'date'],
  ['Vencimiento', 'fechaFin', 'date'],
  ['Estado', 'estado.valor'],
  ['No renovar', 'noRenovar'],
];
const LABELS: Record<string, string> = {
  ingresos: 'Ingresos',
  gastos: 'Gastos',
  resultado: 'Resultado',
  pendienteCobro: 'Pendiente de cobro',
  numeroIngresos: 'Número de ingresos',
  numeroGastos: 'Número de gastos',
  numeroPendientes: 'Número de pendientes',
  numeroOperaciones: 'Número de operaciones',
  ticketMedio: 'Ticket medio',
  nombre: 'Nombre',
  importe: 'Importe',
  porcentaje: 'Porcentaje',
  operaciones: 'Operaciones',
  renovaciones: 'Renovaciones',
  clientesCobro: 'Clientes con cobro',
  clientesActuales: 'Clientes actuales',
  dia: 'Fecha',
  altas: 'Altas',
  total: 'Total',
  vigentes: 'Vigentes',
  perdidos: 'Perdidos',
  noRenovar: 'No renovar',
  altasAnteriores: 'Altas anteriores',
  variacion: 'Variación',
  realizadas: 'Realizadas',
  anuladas: 'Anuladas',
  gratuitas: 'Gratuitas',
  pendientesCobro: 'Pendientes de cobro',
  clientes: 'Clientes',
  renovados: 'Renovados',
  sinVencimientoAnterior: 'Sin vencimiento anterior',
  porcentajeObservable: 'Porcentaje observable',
  provisional: 'Provisional',
  vencidas: 'Vencidas',
  hoy: 'Hoy',
  proximas: 'Próximas',
  diasAviso: 'Días de aviso',
  totalImporte: 'Importe total',
  dimension: 'Dimensión',
  filasSinConciliar: 'Filas sin conciliar',
  desde: 'Desde',
  hasta: 'Hasta',
  anteriorDesde: 'Desde (anterior)',
  anteriorHasta: 'Hasta (anterior)',
  dias: 'Días',
  agrupacion: 'Agrupación',
  estadoCliente: 'Estado de cliente',
  estadoOperacion: 'Estado de operación',
  search: 'Búsqueda',
  sort: 'Ordenación',
  order: 'Sentido',
  estado: 'Estado',
  cobro: 'Cobro',
  vista: 'Vista',
  tipo: 'Tipo',
  productoId: 'Producto',
  servidorId: 'Servidor',
  referenciaId: 'Referencia',
  metodoPagoId: 'Método de pago',
  categoriaGastoId: 'Categoría de gasto',
  clienteId: 'Cliente',
  suscripcionId: 'Suscripción',
  estadoId: 'Estado',
};
const label = (key: string) => LABELS[key] ?? key;
const numericKeys = new Set([
  'ingresos',
  'gastos',
  'resultado',
  'importe',
  'totalImporte',
  'ticketMedio',
  'porcentaje',
  'porcentajeObservable',
  'variacion',
  'pendienteCobro',
]);
const primitive = (v: unknown, key: string): Cell =>
  v === null || v === undefined
    ? null
    : typeof v === 'boolean' || typeof v === 'number'
      ? v
      : typeof v === 'string'
        ? numericKeys.has(key) && /^-?\d+(\.\d+)?$/.test(v)
          ? Number(v)
          : v
        : null;

// Statistics only contains the public report contract. Exclude identifiers,
// pagination and duplicate chart projections; preserve every scalar and series.
function reportTables(report: Row): Table[] {
  const tables: Table[] = [],
    summary: Table = { name: 'Resumen', columns: ['Indicador', 'Valor'], rows: [] };
  const names: Record<string, string> = {
    periodo: 'Periodo',
    calidad: 'Calidad',
    finanzas: 'Contabilidad',
    anterior: 'Anterior',
    variacion: 'Variación',
    clientes: 'Clientes',
    actual: 'Actual',
    renovaciones: 'Renovaciones',
    tasa: 'Tasa',
    situacionActual: 'Situación actual',
    ranking: 'Clasificación',
    data: 'Detalle',
    serie: 'Serie',
    productosActuales: 'Productos actuales',
  };
  const walk = (obj: Row, path: string) => {
    for (const [key, v] of Object.entries(obj)) {
      if (['pagination', 'grafico', 'id', 'clave', 'actualizado', 'seccion'].includes(key))
        continue;
      const name = [path, names[key] ?? label(key)].filter(Boolean).join(' · ');
      if (Array.isArray(v)) {
        const keys = [...new Set(v.flatMap((r) => Object.keys(r as Row)))].filter(
          (k) => !['id', 'clave'].includes(k),
        );
        if (keys.length)
          tables.push({
            name: `Detalle ${tables.length + 1}`,
            columns: ['Informe', ...keys.map(label)],
            rows: v.map((r) => [name, ...keys.map((k) => primitive((r as Row)[k], k))]),
          });
      } else if (v && typeof v === 'object') walk(v as Row, name);
      else summary.rows.push([name, primitive(v, key)]);
    }
  };
  walk(report, '');
  return [summary, ...tables];
}

@Injectable()
export class ExportacionesService {
  private active = 0;
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientesService,
    private readonly subscriptions: SuscripcionesService,
    private readonly renewals: RenovacionesService,
    private readonly finances: FinanzasService,
    private readonly statistics: EstadisticasService,
  ) {}

  async history(page: number) {
    return this.prisma.$transaction(
      async (tx) => ({
        success: true,
        data: await tx.exportacion.findMany({
          skip: (page - 1) * 25,
          take: 25,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            tipo: true,
            modulo: true,
            seccion: true,
            estado: true,
            registros: true,
            bytes: true,
            error: true,
            createdAt: true,
            usuario: { select: { nombre: true } },
          },
        }),
        pagination: { page, total: await tx.exportacion.count(), limit: 25 },
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private async query<T extends object>(ctor: new () => T, filters: Row): Promise<T> {
    if ('page' in filters || 'limit' in filters)
      throw new BadRequestException(
        'La exportación incluye todas las páginas; no admite page ni limit.',
      );
    if (Object.values(filters).some((v) => typeof v !== 'string' || v.length > 200))
      throw new BadRequestException('Los filtros deben ser textos de hasta 200 caracteres.');
    if (Object.entries(filters).some(([k, v]) => k.endsWith('Id') && !isUUID(String(v))))
      throw new BadRequestException('Identificador de filtro inválido.');
    const q = plainToInstance(ctor, filters);
    const errors = await validate(q, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length)
      throw new BadRequestException(
        'Filtros de exportación inválidos: ' + errors.map((e) => e.property).join(', '),
      );
    return q;
  }
  async generate(module: string, request: ExportRequest, actor: string) {
    const generated = new Date();
    const day = businessDay(generated);
    if (!['clientes', 'suscripciones', 'renovaciones', 'finanzas', 'estadisticas'].includes(module))
      throw new BadRequestException('Módulo de exportación desconocido.');
    if (
      request.seccion &&
      module !== 'estadisticas' &&
      !(module === 'renovaciones' && ['historial', 'seguimiento'].includes(request.seccion))
    )
      throw new BadRequestException('Sección de exportación inválida.');
    const section =
      request.seccion ??
      (module === 'estadisticas' ? 'resumen' : module === 'renovaciones' ? 'historial' : undefined);
    if (module === 'estadisticas' && !SECTIONS.includes(section as Section))
      throw new BadRequestException('Informe desconocido.');
    const filters = request.filtros ?? {};
    // Validate even when the result is empty. No arbitrary fields or SQL reach readers.
    const q =
      module === 'clientes'
        ? await this.query(FindClientesDto, filters)
        : module === 'suscripciones'
          ? await this.query(SubscriptionQueryDto, filters)
          : module === 'renovaciones'
            ? await this.query(RenewalQueryDto, filters)
            : module === 'finanzas'
              ? await this.query(FinanceQueryDto, filters)
              : await this.query(StatsQuery, filters);
    if (module === 'renovaciones') {
      const prohibited =
        section === 'seguimiento' ? ['desde', 'hasta', 'estado', 'cobro'] : ['vista'];
      if (prohibited.some((k) => k in filters))
        throw new BadRequestException('Filtro no aplicable a esta vista de renovaciones.');
    }
    if (this.active >= 2)
      throw new ServiceUnavailableException(
        'Hay dos exportaciones en curso. Reintenta en unos segundos.',
      );
    this.active++;
    let recordId: string | undefined;
    try {
      const record = await this.prisma.exportacion.create({
        data: {
          tipo: request.formato,
          modulo: module,
          seccion: section,
          usuarioId: actor,
          estado: 'GENERANDO',
        },
      });
      recordId = record.id;
      const max = request.formato === 'pdf' ? 1000 : 10000;
      const tables = await this.prisma.$transaction(
        async (tx) => {
          if (module === 'estadisticas') {
            const report = json(
              await this.statistics.report(
                section as Section,
                { ...(q as StatsQuery), page: 1, limit: max + 1 },
                tx,
                day,
              ),
            );
            const ranking = report.ranking as { pagination?: { total: number } } | undefined;
            if ((ranking?.pagination?.total ?? 0) > max) this.tooLarge(max);
            return reportTables(report);
          }
          const rows: Row[] = [];
          for (let page = 1; ; page++) {
            const query = { ...q, page, limit: 100 };
            const result =
              module === 'clientes'
                ? await this.clients.findAll(query as FindClientesDto, tx)
                : module === 'suscripciones'
                  ? await this.subscriptions.findAll(query as SubscriptionQueryDto, tx, day)
                  : module === 'renovaciones'
                    ? section === 'seguimiento'
                      ? await this.renewals.queue(query as RenewalQueryDto, tx, day)
                      : await this.renewals.list(query as RenewalQueryDto, tx)
                    : await this.finances.list(query as FinanceQueryDto, tx);
            if (result.pagination.total > max) this.tooLarge(max);
            rows.push(...result.data.map(json));
            if (Buffer.byteLength(JSON.stringify(rows)) > 8 * 1024 * 1024) this.tooLarge(max);
            if (rows.length >= result.pagination.total) break;
            if (!result.data.length)
              throw new BadRequestException('No se pudo completar la lectura.');
          }
          if (module === 'clientes') {
            // Only an explicit materialization is an ownership link. A matching
            // name in the reference catalog alone must not invent ownership.
            const identities = await tx.importacionIdentidad.findMany({
              where: {
                materializada: true,
                clienteDestinoId: { in: rows.map((r) => String(r.id)) },
              },
              select: { clienteDestinoId: true, historial: true },
            });
            const links = new Map<string, Set<string>>();
            for (const identity of identities) {
              if (!identity.clienteDestinoId || !Array.isArray(identity.historial)) continue;
              for (const event of identity.historial) {
                if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
                if (event.accion !== 'MATERIALIZAR' || typeof event.referenciaId !== 'string')
                  continue;
                const ids = links.get(identity.clienteDestinoId) ?? new Set<string>();
                ids.add(event.referenciaId);
                links.set(identity.clienteDestinoId, ids);
              }
            }
            const references = await tx.referencia.findMany({
              where: { id: { in: [...links.values()].flatMap((ids) => [...ids]) } },
              select: { id: true, nombre: true },
            });
            const names = new Map(references.map((r) => [r.id, r.nombre]));
            return [
              table(
                'Clientes',
                [
                  ['Nombre', 'nombre'],
                  ['Teléfono', 'telefono'],
                  ['Email', 'email'],
                  ['Estado', 'estado.valor'],
                  ['Referencia propia verificada', 'referenciaPropia'],
                  ['Observaciones', 'observaciones'],
                ],
                rows.map((r) => ({
                  ...r,
                  referenciaPropia:
                    [...(links.get(String(r.id)) ?? [])]
                      .map((id) => names.get(id))
                      .filter(Boolean)
                      .join(', ') || null,
                })),
              ),
            ];
          }
          if (module === 'suscripciones' || section === 'seguimiento')
            return [
              table(
                section === 'seguimiento' ? 'Por gestionar' : 'Suscripciones',
                subscriptionColumns,
                rows,
              ),
            ];
          if (module === 'renovaciones')
            return [
              table(
                'Operaciones',
                [
                  ['Cliente', 'suscripcion.cliente.nombre'],
                  ['Operación', 'tipoOperacion'],
                  ['Producto histórico', 'productoNombreSnapshot'],
                  ['Tarifa histórica', 'tarifaNombreSnapshot'],
                  ['Servidor histórico', 'servidorNombreSnapshot'],
                  ['Referencia histórica', 'referenciaNombreSnapshot'],
                  ['Fecha de operación', 'fechaOperacion', 'date'],
                  ['Inicio', 'fechaInicio', 'date'],
                  ['Vencimiento', 'fechaFin', 'date'],
                  ['Importe', 'importe', 'money'],
                  ['Estado', 'estado.valor'],
                  ['Método de pago histórico', 'metodoPagoNombreSnapshot'],
                  ['Cobro', 'cobroExport'],
                  ['Método del cobro', 'metodoCobroExport'],
                  ['Fecha de cobro', 'fechaCobroExport'],
                  ['Cobro previsto', 'cobroPrevistoExport'],
                ],
                rows.map((r) => ({
                  ...r,
                  cobroExport:
                    Array.isArray(r.movimientos) && r.movimientos.length
                      ? r.movimientos.map((m) => value(m as Row, 'estado.valor')).join(', ')
                      : value(r, 'metodoPago.esGratuito') === true
                        ? 'GRATIS'
                        : 'SIN_REGISTRO',
                  metodoCobroExport: movementValues(r, 'metodoPagoNombreSnapshot'),
                  fechaCobroExport: movementValues(r, 'fechaCobro', true),
                  cobroPrevistoExport: movementValues(r, 'fechaPrevistaCobro', true),
                })),
              ),
            ];
          const balance = json(await this.finances.balance(q as FinanceQueryDto, tx));
          return [
            table(
              'Movimientos',
              [
                ['Concepto / descripción', 'conceptoExport'],
                ['Cliente', 'suscripcion.cliente.nombre'],
                ['Tipo', 'tipo.valor'],
                ['Estado', 'estado.valor'],
                ['Importe', 'importe', 'money'],
                ['Fecha', 'fecha', 'date'],
                ['Fecha de cobro', 'fechaCobro', 'date'],
                ['Cobro previsto', 'fechaPrevistaCobro', 'date'],
                ['Método de pago histórico', 'metodoPagoNombreSnapshot'],
                ['Categoría histórica', 'categoriaNombreSnapshot'],
                ['Producto histórico', 'productoNombreSnapshot'],
                ['Servidor histórico', 'servidorNombreSnapshot'],
                ['Referencia histórica', 'referenciaNombreSnapshot'],
              ],
              rows.map((r) => ({ ...r, conceptoExport: r.concepto ?? r.descripcion })),
            ),
            {
              name: 'Balance',
              columns: ['Indicador', 'Valor'],
              rows: Object.entries(balance).map(([k, v]) => [label(k), primitive(v, k)]),
            } satisfies Table,
          ];
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
      );
      const data: ExportDocument = {
        title: `K13Group · ${module === 'finanzas' ? 'Contabilidad' : module}${section ? ' · ' + (section === 'finanzas' ? 'Contabilidad' : section) : ''}`,
        generated: generated.toISOString(),
        filters:
          Object.entries(filters)
            .map(([k, v]) => `${label(k)}: ${String(v)}`)
            .join(' · ') || 'Sin filtros adicionales',
        tables,
      };
      const count =
        module === 'estadisticas'
          ? tables.reduce((sum, t) => sum + t.rows.length, 0)
          : tables[0].rows.length;
      if (count > max || Buffer.byteLength(JSON.stringify(data)) > 8 * 1024 * 1024)
        this.tooLarge(max);
      if (
        tables.some((t) =>
          t.rows.some((r) => r.some((c) => typeof c === 'string' && c.length > 32767)),
        )
      )
        throw new BadRequestException(
          'Hay un campo que supera 32.767 caracteres. Acota los filtros o revisa el dato antes de exportar.',
        );
      const buffer = await renderInWorker(data, request.formato);
      await this.prisma.$transaction(async (tx) => {
        await tx.exportacion.update({
          where: { id: record.id },
          data: { estado: 'GENERADA', registros: count, bytes: buffer.length },
        });
        await tx.actividad.create({
          data: {
            usuarioId: actor,
            tabla: 'exportaciones',
            registroId: record.id,
            accion: 'EXPORTAR',
            datosNuevos: { modulo: module, formato: request.formato, registros: count },
          },
        });
      });
      return {
        buffer,
        filename: `k13-${module}-${day}.${request.formato}`,
        contentType: {
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          csv: 'text/csv; charset=utf-8',
          pdf: 'application/pdf',
        }[request.formato],
      };
    } catch (error) {
      if (recordId)
        await this.prisma.exportacion.update({
          where: { id: recordId },
          data: {
            estado: 'FALLIDA',
            error: 'No se generó el archivo. Revisa los filtros y los límites antes de reintentar.',
          },
        });
      throw error;
    } finally {
      this.active--;
    }
  }
  private tooLarge(max: number): never {
    throw new BadRequestException(
      `La exportación supera el límite de ${max} registros o 8 MB de datos. Acota los filtros.`,
    );
  }
}
