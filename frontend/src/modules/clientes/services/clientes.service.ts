import { api } from '@/lib/api';
import type { Cliente, ClienteQuery, ClientesResponse } from '../types/clientes.types';
import type { ClienteFormData } from '../schemas/cliente.schema';

export const clientesService = {
  findAll: (params?: ClienteQuery) =>
    api.get<ClientesResponse>('/clientes', { params }),

  findOne: (id: string) =>
    api.get<{ success: boolean; data: Cliente }>(`/clientes/${id}`),

  create: (data: ClienteFormData) =>
    api.post<{ success: boolean; data: Cliente }>('/clientes', data),

  update: (id: string, data: Partial<ClienteFormData>) =>
    api.put<{ success: boolean; data: Cliente }>(`/clientes/${id}`, data),

  remove: (id: string) =>
    api.delete(`/clientes/${id}`),
};
