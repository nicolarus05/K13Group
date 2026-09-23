export type CatalogKind =
  'productos' | 'tarifas' | 'servidores' | 'referencias' | 'metodos-pago' | 'categorias-gasto';
export interface CatalogRecord {
  id: string;
  nombre: string;
  activo: boolean;
  deletedAt?: string | null;
  descripcion?: string | null;
  observaciones?: string | null;
  productoId?: string;
  producto?: CatalogRecord;
  duracionMeses?: number;
  precio?: string | number;
  esGratuito?: boolean;
}
export interface CatalogQuery {
  page?: number;
  limit?: number;
  search?: string;
  estado?: 'activo' | 'inactivo' | 'todos';
  sort?: 'nombre' | 'createdAt';
  order?: 'asc' | 'desc';
  productoId?: string;
}
export interface CatalogPage {
  success: boolean;
  data: CatalogRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
export interface CatalogPayload {
  nombre: string;
  descripcion?: string;
  observaciones?: string;
  productoId?: string;
  duracionMeses?: number;
  precio?: number;
  esGratuito?: boolean;
}
