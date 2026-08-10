// Tipos base compartidos en toda la aplicación

export interface Entity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface SoftDeletable extends Entity {
  deletedAt: string | null;
}

export interface Estado {
  id: string;
  tipo: string;
  valor: string;
  etiqueta: string;
  activo: boolean;
  orden: number;
}

export interface QueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
}
