import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { normalizeComparable } from '../common/helpers/normalization';
import { CatalogQueryDto, CreateCatalogDto, UpdateCatalogDto } from './catalogo.dto';
import {
  catalogRepository,
  CatalogKind,
  CatalogData,
  CatalogRecord,
  CatalogWhere,
} from './catalog.repository';

export async function lockCatalog(tx: Prisma.TransactionClient, kind: CatalogKind) {
  // Serializa las escrituras del catálogo, incluida la creación desde Clientes.
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'catalogo:' + kind}))`;
}
export function catalogName(value: string, maxLength = 100) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > maxLength)
    throw new BadRequestException(`El nombre debe tener entre 1 y ${maxLength} caracteres.`);
  return name;
}
export class CatalogService {
  constructor(
    protected readonly prisma: PrismaService,
    private readonly kind: CatalogKind,
  ) {}
  private get softDelete() {
    return !['tarifas', 'categorias-gasto'].includes(this.kind);
  }

  async findAll(query: CatalogQueryDto) {
    if (query.productoId && this.kind !== 'tarifas')
      throw new BadRequestException('El filtro de producto solo se aplica a tarifas.');
    const where: CatalogWhere = {
      ...(query.search
        ? { nombre: { contains: query.search.trim(), mode: 'insensitive' as const } }
        : {}),
      ...(query.productoId ? { productoId: query.productoId } : {}),
    };
    if (query.estado === 'activo') {
      where.activo = true;
      if (this.softDelete) where.deletedAt = null;
      if (this.kind === 'tarifas') where.producto = { activo: true, deletedAt: null };
    } else if (query.estado === 'inactivo') {
      if (this.softDelete) where.OR = [{ activo: false }, { deletedAt: { not: null } }];
      else where.activo = false;
    }
    const repo = catalogRepository(this.prisma, this.kind);
    const [data, total] = await Promise.all([
      repo.list(where, (query.page - 1) * query.limit, query.limit, { [query.sort]: query.order }),
      repo.count(where),
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

  async findOne(id: string) {
    const item = await catalogRepository(this.prisma, this.kind).get(id);
    if (!item) throw new NotFoundException('Registro de catálogo no encontrado.');
    return item;
  }

  create(dto: CreateCatalogDto, usuarioId: string) {
    return this.write(undefined, dto, usuarioId);
  }
  update(id: string, dto: UpdateCatalogDto, usuarioId: string) {
    return this.write(id, dto, usuarioId);
  }
  remove(id: string, usuarioId: string) {
    return this.update(id, { activo: false }, usuarioId);
  }
  reactivate(id: string, usuarioId: string) {
    return this.update(id, { activo: true }, usuarioId);
  }

  private async write(id: string | undefined, dto: UpdateCatalogDto, usuarioId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Las tarifas comparten el bloqueo de producto para validar su vigencia.
        if (this.kind === 'tarifas') await lockCatalog(tx, 'productos');
        await lockCatalog(tx, this.kind);
        const repo = catalogRepository(tx, this.kind);
        const before = id ? await repo.get(id) : null;
        if (id && !before) throw new NotFoundException('Registro de catálogo no encontrado.');
        const allowed = new Set([
          'nombre',
          'activo',
          ...(this.kind === 'productos' ? ['descripcion'] : []),
          ...(this.kind === 'referencias' ? ['observaciones'] : []),
          ...(this.kind === 'tarifas' ? ['productoId', 'precio', 'duracionMeses'] : []),
          ...(this.kind === 'metodos-pago' ? ['esGratuito'] : []),
        ]);
        for (const [key, value] of Object.entries(dto)) {
          if (!allowed.has(key) || value === null)
            throw new BadRequestException(`Campo no válido: ${key}.`);
        }
        const data: CatalogData = { ...dto };
        if (dto.nombre !== undefined)
          data.nombre = catalogName(dto.nombre, this.kind === 'referencias' ? 150 : 100);
        if (!id && !data.nombre) throw new BadRequestException('El nombre es obligatorio.');
        const name = data.nombre ?? before!.nombre;
        const productId = data.productoId ?? before?.productoId;
        // La clave incluye el producto en tarifas; incluye inactivos para reactivarlos.
        const siblings = await repo.list(
          this.kind === 'tarifas' && productId ? { productoId: productId } : {},
        );
        if (
          siblings.some(
            (item) =>
              item.id !== id && normalizeComparable(item.nombre) === normalizeComparable(name),
          )
        ) {
          throw new ConflictException(
            'Ya existe un registro con ese nombre (puede estar inactivo). Edita o reactiva el existente.',
          );
        }
        if (this.kind === 'tarifas') await this.validateTariff(tx, data, before, productId);
        if (
          this.kind === 'metodos-pago' &&
          before &&
          dto.esGratuito !== undefined &&
          dto.esGratuito !== before.esGratuito
        ) {
          const used =
            (await tx.renovacion.count({ where: { metodoPagoId: id } })) +
            (await tx.movimientoFinanciero.count({ where: { metodoPagoId: id } }));
          if (used)
            throw new ConflictException(
              'Un método utilizado no puede cambiar entre gratuito y monetario. Crea otro método.',
            );
        }
        if (this.softDelete && dto.activo === true) data.deletedAt = null;
        const after = id
          ? await repo.update(id, data)
          : await repo.create({ ...data, nombre: name });
        const accion = !id
          ? 'CREAR'
          : dto.activo === false
            ? 'DESACTIVAR'
            : dto.activo === true
              ? 'REACTIVAR'
              : 'EDITAR';
        await tx.actividad.create({
          data: {
            usuarioId,
            tabla: this.kind.replace(/-/g, '_'),
            registroId: after.id,
            accion,
            datosAnteriores: before
              ? (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            datosNuevos: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue,
          },
        });
        return after;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Ya existe un registro con ese nombre.');
      throw error;
    }
  }

  private async validateTariff(
    tx: Prisma.TransactionClient,
    data: CatalogData,
    before: CatalogRecord | null,
    productId?: string,
  ) {
    if (!productId) throw new BadRequestException('Selecciona un producto.');
    if (before && productId !== before.productoId)
      throw new BadRequestException(
        'El producto de una tarifa no se puede cambiar. Crea otra tarifa.',
      );
    const precio = data.precio ?? (before?.precio ? Number(before.precio) : undefined);
    const duration = data.duracionMeses ?? before?.duracionMeses ?? 12;
    if (
      precio === undefined ||
      !Number.isFinite(precio) ||
      precio < 0.01 ||
      precio > 99999999.99 ||
      Math.abs(precio * 100 - Math.round(precio * 100)) > 1e-6
    ) {
      throw new BadRequestException(
        'El precio debe ser positivo y tener como máximo dos decimales.',
      );
    }
    if (duration !== 12) throw new BadRequestException('Las tarifas deben ser anuales (12 meses).');
    if (!before || data.activo === true || (before.activo && data.activo !== false)) {
      const product = await tx.producto.findFirst({
        where: { id: productId, activo: true, deletedAt: null },
      });
      if (!product) throw new BadRequestException('El producto debe estar activo.');
    }
    if (!before) {
      data.duracionMeses = 12;
      data.precio = precio;
    }
  }
}
