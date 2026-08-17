import type { Estado } from '@/types';

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
}

export interface ClientesResponse {
  success: boolean;
  data: Cliente[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ClienteQuery {
  page?: number;
  limit?: number;
  search?: string;
  estadoId?: string;
  sort?: string;
}
