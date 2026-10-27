import type { Estado } from '@/types';
import type { Subscription } from '@/modules/suscripciones/suscripciones.service';

export interface Cliente {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  observaciones: string | null;
  estadoId: string;
  estado: Estado;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  suscripciones?: Subscription[];
}

export interface ClientesResponse {
  success: boolean;
  data: Cliente[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ClienteQuery {
  page?: number;
  limit?: number;
  search?: string;
  estadoId?: string;
  sort?: 'nombre' | 'createdAt' | 'updatedAt';
}
