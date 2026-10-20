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
import { audit, stateId } from '../recordatorios/recordatorios.service';
import { businessDay, parseDay } from '../suscripciones/subscription-dates';
import { buildPaginatedResponse } from '../common/helpers/response.helper';
import {
  AnnulExpenseDto,
  CreateExpenseDto,
  ExpenseFieldsDto,
  FinanceQueryDto,
  UpdateExpenseDto,
} from './finanzas.dto';
import { financeReadSelect, financeSelect, presentMovement } from './finanzas.select';

@Injectable()
export class FinanzasService {
  constructor(private readonly prisma: PrismaService) {}

  private where(q: FinanceQueryDto): Prisma.Sql {
    if (q.desde) parseDay(q.desde);
    if (q.hasta) parseDay(q.hasta);
    if (q.desde && q.hasta && q.desde > q.hasta)
      throw new BadRequestException('Intervalo de fechas inválido.');
    const end = q.hasta ? parseDay(q.hasta) : undefined;
    if (end) end.setUTCDate(end.getUTCDate() + 1);
    // Un único filtro parametrizado para listado, recuento y balance. Ordenar
    // por COALESCE en PostgreSQL evita cargar todo el libro para paginar en JS.
    const filters: Prisma.Sql[] = [];
    if (q.tipo)
      filters.push(
        Prisma.sql`m.tipo_id IN (SELECT id FROM estados WHERE tipo = 'movimiento_tipo' AND valor = ${q.tipo})`,
      );
    if (q.estado)
      filters.push(
        Prisma.sql`m.estado_id IN (SELECT id FROM estados WHERE tipo = 'movimiento_estado' AND valor = ${q.estado})`,
      );
    if (q.categoriaGastoId)
      filters.push(Prisma.sql`m.categoria_gasto_id = ${q.categoriaGastoId}::uuid`);
    if (q.metodoPagoId)
      filters.push(
        Prisma.sql`(m.metodo_pago_id = ${q.metodoPagoId}::uuid OR (m.metodo_pago_id IS NULL AND m.renovacion_id IN (SELECT id FROM renovaciones WHERE metodo_pago_id = ${q.metodoPagoId}::uuid)))`,
      );
    if (q.clienteId)
      filters.push(
        Prisma.sql`m.suscripcion_id IN (SELECT id FROM suscripciones WHERE cliente_id = ${q.clienteId}::uuid)`,
      );
    if (q.desde) filters.push(Prisma.sql`COALESCE(m.fecha_cobro, m.fecha) >= ${parseDay(q.desde)}`);
    if (end) filters.push(Prisma.sql`COALESCE(m.fecha_cobro, m.fecha) < ${end}`);
    if (q.search?.trim()) {
      const pattern = '%' + q.search.trim() + '%';
      filters.push(
        Prisma.sql`(m.concepto ILIKE ${pattern} OR m.descripcion ILIKE ${pattern} OR m.observaciones ILIKE ${pattern})`,
      );
    }
    return filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;
  }
  async list(q: FinanceQueryDto, client?: Prisma.TransactionClient) {
    const where = this.where(q);
    const read = async (tx: Prisma.TransactionClient) => {
      const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT m.id FROM movimientos_financieros m ${where}
          ORDER BY COALESCE(m.fecha_cobro, m.fecha) DESC, m.id DESC
          LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`);
      const data = ids.length
        ? await tx.movimientoFinanciero.findMany({
            where: { id: { in: ids.map((row) => row.id) } },
            select: financeReadSelect,
          })
        : [];
      const byId = new Map(data.map((row) => [row.id, presentMovement(row)]));
      const [count] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`
          SELECT COUNT(*)::int AS total FROM movimientos_financieros m ${where}`);
      return buildPaginatedResponse(
        ids.map((row) => byId.get(row.id)!),
        count.total,
        q.page,
        q.limit,
      );
    };
    return client
      ? read(client)
      : this.prisma.$transaction(read, {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 30000,
        });
  }

  async findOne(id: string, tx: Prisma.TransactionClient = this.prisma) {
    const row = await tx.movimientoFinanciero.findUnique({
      where: { id },
      select: financeReadSelect,
    });
    if (!row) throw new NotFoundException('Movimiento no encontrado.');
    return presentMovement(row);
  }
  async history(id: string, q: FinanceQueryDto) {
    await this.findOne(id);
    const where = { tabla: 'movimientos_financieros', registroId: id };
    return this.prisma.$transaction(
      async (tx) =>
        buildPaginatedResponse(
          await tx.actividad.findMany({
            where,
            skip: (q.page - 1) * q.limit,
            take: q.limit,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
              accion: true,
              createdAt: true,
              datosAnteriores: true,
              datosNuevos: true,
              usuario: { select: { nombre: true } },
            },
          }),
          await tx.actividad.count({ where }),
          q.page,
          q.limit,
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async balance(q: FinanceQueryDto, client?: Prisma.TransactionClient) {
    const where = this.where(q);
    const read = async (tx: Prisma.TransactionClient) => {
      const groups = await tx.$queryRaw<
        { tipoId: string; estadoId: string; importe: Prisma.Decimal; total: number }[]
      >(Prisma.sql`
          SELECT m.tipo_id AS "tipoId", m.estado_id AS "estadoId",
            SUM(m.importe) AS importe, COUNT(*)::int AS total
          FROM movimientos_financieros m ${where} GROUP BY m.tipo_id, m.estado_id`);
      const states = await tx.estado.findMany({
        where: { tipo: { in: ['movimiento_tipo', 'movimiento_estado'] } },
      });
      const code = (id: string) => states.find((s) => s.id === id)?.valor;
      let income = new Prisma.Decimal(0),
        expenses = new Prisma.Decimal(0),
        pending = new Prisma.Decimal(0);
      let incomeCount = 0,
        expenseCount = 0,
        pendingCount = 0;
      for (const group of groups) {
        const amount = group.importe;
        if (code(group.tipoId) === 'INGRESO' && code(group.estadoId) === 'CONFIRMADO') {
          income = income.plus(amount);
          incomeCount += group.total;
        }
        if (code(group.tipoId) === 'GASTO' && code(group.estadoId) === 'CONFIRMADO') {
          expenses = expenses.plus(amount);
          expenseCount += group.total;
        }
        if (code(group.tipoId) === 'INGRESO' && code(group.estadoId) === 'PENDIENTE') {
          pending = pending.plus(amount);
          pendingCount += group.total;
        }
      }
      return {
        ingresos: income.toFixed(2),
        gastos: expenses.toFixed(2),
        resultado: income.minus(expenses).toFixed(2),
        pendienteCobro: pending.toFixed(2),
        numeroIngresos: incomeCount,
        numeroGastos: expenseCount,
        numeroPendientes: pendingCount,
        numeroOperaciones: incomeCount + expenseCount,
        ticketMedio: (incomeCount ? income.div(incomeCount) : new Prisma.Decimal(0)).toFixed(2),
      };
    };
    return client
      ? read(client)
      : this.prisma.$transaction(read, {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        });
  }
  private normalize(dto: ExpenseFieldsDto) {
    const fecha = parseDay(dto.fecha);
    if (dto.fecha > businessDay())
      throw new BadRequestException(
        'Solo se registran gastos ya pagados; la fecha no puede ser futura.',
      );
    const importe = new Prisma.Decimal(dto.importe);
    if (importe.lte(0)) throw new BadRequestException('El importe debe ser mayor que cero.');
    return {
      concepto: dto.concepto.trim(),
      categoriaGastoId: dto.categoriaGastoId,
      metodoPagoId: dto.metodoPagoId,
      importe: importe.toFixed(2),
      fecha,
      observaciones: dto.observaciones?.trim() || null,
    };
  }
  private async lock(tx: Prisma.TransactionClient) {
    // Ningún otro flujo toma este bloqueo; orden único: gastos → categoría → método.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'finanzas:gastos'}))`;
  }
  private async catalogs(
    tx: Prisma.TransactionClient,
    dto: ExpenseFieldsDto,
    before?: Awaited<ReturnType<FinanzasService['findOne']>>,
  ) {
    await lockCatalog(tx, 'categorias-gasto');
    await lockCatalog(tx, 'metodos-pago');
    const category = await tx.categoriaGasto.findUnique({ where: { id: dto.categoriaGastoId } });
    const method = await tx.metodoPago.findUnique({ where: { id: dto.metodoPagoId } });
    if (!category || (!category.activo && before?.categoriaGastoId !== category.id))
      throw new BadRequestException('Selecciona una categoría activa.');
    if (
      !method ||
      method.esGratuito ||
      ((!method.activo || method.deletedAt) && before?.metodoPagoId !== method.id)
    )
      throw new BadRequestException('Selecciona un método monetario activo.');
    return {
      categoriaNombreSnapshot:
        before?.categoriaGastoId === category.id
          ? (before.categoriaNombreSnapshot ?? category.nombre)
          : category.nombre,
      metodoPagoNombreSnapshot:
        before?.metodoPagoId === method.id
          ? (before.metodoPagoNombreSnapshot ?? method.nombre)
          : method.nombre,
    };
  }
  private editable(row: Awaited<ReturnType<FinanzasService['findOne']>>) {
    if (
      row.tipo.valor !== 'GASTO' ||
      row.origen !== 'GASTO_MANUAL' ||
      row.renovacionId ||
      row.suscripcionId
    )
      throw new ConflictException(
        'Solo se gestionan gastos manuales aquí. Los ingresos se gestionan desde su renovación.',
      );
  }
  async create(dto: CreateExpenseDto, actor: string) {
    const normalized = this.normalize(dto);
    const hash = createHash('sha256')
      .update(JSON.stringify({ actor, ...normalized }))
      .digest('hex');
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx);
        const previous = await tx.movimientoFinanciero.findUnique({
          where: { operacionClave: dto.solicitudId },
        });
        if (previous) {
          if (previous.solicitudHash !== hash)
            throw new ConflictException('La clave de solicitud ya se usó con otros datos.');
          return this.findOne(previous.id, tx);
        }
        const snapshots = await this.catalogs(tx, dto);
        const row = await tx.movimientoFinanciero.create({
          data: {
            ...normalized,
            ...snapshots,
            fechaCobro: normalized.fecha,
            operacionClave: dto.solicitudId,
            solicitudHash: hash,
            tipoId: await stateId(tx, 'movimiento_tipo', 'GASTO'),
            estadoId: await stateId(tx, 'movimiento_estado', 'CONFIRMADO'),
            origen: 'GASTO_MANUAL',
          },
          select: financeSelect,
        });
        await audit(tx, actor, 'movimientos_financieros', row.id, 'CREAR', null, row);
        return row;
      },
      { timeout: 30000 },
    );
  }
  async update(id: string, dto: UpdateExpenseDto, actor: string) {
    const normalized = this.normalize(dto);
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx);
        const before = await this.findOne(id, tx);
        this.editable(before);
        if (before.version !== dto.version || before.estado.valor !== 'CONFIRMADO')
          throw new ConflictException('El gasto ha cambiado o está anulado. Recarga los datos.');
        const snapshots = await this.catalogs(tx, dto, before);
        const after = await tx.movimientoFinanciero.update({
          where: { id },
          data: {
            ...normalized,
            ...snapshots,
            fechaCobro: normalized.fecha,
            version: { increment: 1 },
          },
          select: financeSelect,
        });
        await audit(tx, actor, 'movimientos_financieros', id, 'EDITAR', before, {
          ...after,
          motivo: dto.motivo,
        });
        return after;
      },
      { timeout: 30000 },
    );
  }
  async annul(id: string, dto: AnnulExpenseDto, actor: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx);
        const before = await this.findOne(id, tx);
        this.editable(before);
        if (
          before.estado.valor === 'ANULADO' &&
          before.motivoAnulacion === dto.motivo &&
          before.version === dto.version + 1
        )
          return before;
        if (before.version !== dto.version || before.estado.valor !== 'CONFIRMADO')
          throw new ConflictException('El gasto ha cambiado o está anulado. Recarga los datos.');
        const after = await tx.movimientoFinanciero.update({
          where: { id },
          data: {
            estadoId: await stateId(tx, 'movimiento_estado', 'ANULADO'),
            anuladaAt: new Date(),
            motivoAnulacion: dto.motivo,
            version: { increment: 1 },
          },
          select: financeSelect,
        });
        await audit(tx, actor, 'movimientos_financieros', id, 'ANULAR', before, after);
        return after;
      },
      { timeout: 30000 },
    );
  }
}
