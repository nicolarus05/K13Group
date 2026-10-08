import { Prisma } from '@prisma/client';
export type CatalogKind =
  'productos' | 'tarifas' | 'servidores' | 'referencias' | 'metodos-pago' | 'categorias-gasto';
export interface CatalogRecord {
  id: string;
  nombre: string;
  activo: boolean;
  createdAt: Date;
  deletedAt?: Date | null;
  descripcion?: string | null;
  observaciones?: string | null;
  productoId?: string;
  duracionMeses?: number;
  precio?: Prisma.Decimal;
  producto?: { id: string; nombre: string; activo: boolean; deletedAt: Date | null };
  orden?: number;
  esGratuito?: boolean;
}
export interface CatalogData {
  nombre?: string;
  activo?: boolean;
  descripcion?: string;
  observaciones?: string;
  productoId?: string;
  duracionMeses?: number;
  precio?: number;
  orden?: number;
  esGratuito?: boolean;
  deletedAt?: Date | null;
}
export interface CatalogWhere {
  id?: string;
  activo?: boolean;
  deletedAt?: null | { not: null };
  nombre?: { contains: string; mode: 'insensitive' };
  productoId?: string;
  producto?: { activo: boolean; deletedAt: null };
  OR?: CatalogWhere[];
}
interface CatalogRepository {
  list(
    where: CatalogWhere,
    skip?: number,
    take?: number,
    orderBy?: { nombre?: 'asc' | 'desc'; createdAt?: 'asc' | 'desc' },
  ): Promise<CatalogRecord[]>;
  count(where: CatalogWhere): Promise<number>;
  get(id: string): Promise<CatalogRecord | null>;
  create(data: CatalogData & { nombre: string }): Promise<CatalogRecord>;
  update(id: string, data: CatalogData): Promise<CatalogRecord>;
}
export function catalogRepository(
  tx: Prisma.TransactionClient,
  kind: CatalogKind,
): CatalogRepository {
  switch (kind) {
    case 'productos':
      return {
        list: (where, skip, take, orderBy) => tx.producto.findMany({ where, skip, take, orderBy }),
        count: (where) => tx.producto.count({ where }),
        get: (id) => tx.producto.findUnique({ where: { id } }),
        create: (data) => tx.producto.create({ data }),
        update: (id, data) => tx.producto.update({ where: { id }, data }),
      };
    case 'tarifas':
      return {
        list: (where, skip, take, orderBy) =>
          tx.tarifa.findMany({ where, skip, take, orderBy, include: { producto: true } }),
        count: (where) => tx.tarifa.count({ where }),
        get: (id) => tx.tarifa.findUnique({ where: { id }, include: { producto: true } }),
        create: (data) =>
          tx.tarifa.create({
            data: {
              ...data,
              productoId: data.productoId!,
              duracionMeses: data.duracionMeses!,
              precio: data.precio!,
            },
            include: { producto: true },
          }),
        update: (id, data) =>
          tx.tarifa.update({ where: { id }, data, include: { producto: true } }),
      };
    case 'servidores':
      return {
        list: (where, skip, take, orderBy) => tx.servidor.findMany({ where, skip, take, orderBy }),
        count: (where) => tx.servidor.count({ where }),
        get: (id) => tx.servidor.findUnique({ where: { id } }),
        create: (data) => tx.servidor.create({ data }),
        update: (id, data) => tx.servidor.update({ where: { id }, data }),
      };
    case 'referencias':
      return {
        list: (where, skip, take, orderBy) =>
          tx.referencia.findMany({ where, skip, take, orderBy }),
        count: (where) => tx.referencia.count({ where }),
        get: (id) => tx.referencia.findUnique({ where: { id } }),
        create: (data) => tx.referencia.create({ data }),
        update: (id, data) => tx.referencia.update({ where: { id }, data }),
      };
    case 'metodos-pago':
      return {
        list: (where, skip, take, _orderBy) =>
          tx.metodoPago.findMany({
            where,
            skip,
            take,
            orderBy: [{ orden: 'asc' }, { nombre: 'asc' }, { id: 'asc' }],
          }),
        count: (where) => tx.metodoPago.count({ where }),
        get: (id) => tx.metodoPago.findUnique({ where: { id } }),
        create: (data) => tx.metodoPago.create({ data }),
        update: (id, data) => tx.metodoPago.update({ where: { id }, data }),
      };
    case 'categorias-gasto':
      return {
        list: (where, skip, take, orderBy) =>
          tx.categoriaGasto.findMany({ where, skip, take, orderBy }),
        count: (where) => tx.categoriaGasto.count({ where }),
        get: (id) => tx.categoriaGasto.findUnique({ where: { id } }),
        create: (data) => tx.categoriaGasto.create({ data }),
        update: (id, data) => tx.categoriaGasto.update({ where: { id }, data }),
      };
  }
}
