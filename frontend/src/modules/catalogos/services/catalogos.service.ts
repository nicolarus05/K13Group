import { api } from '@/lib/api';
import type { ProductoCatalogo, ReferenciaCatalogo, ServidorCatalogo, TarifaCatalogo } from '../types/catalogos.types';

const data = <T,>(response: { data: { data: T } }) => response.data.data;

export const catalogosService = {
  productos: () => api.get<{ success: boolean; data: ProductoCatalogo[] }>('/productos').then(data),
  crearProducto: (payload: { nombre: string; descripcion?: string }) => api.post<{ success: boolean; data: ProductoCatalogo }>('/productos', payload).then(data),
  tarifas: () => api.get<{ success: boolean; data: TarifaCatalogo[] }>('/tarifas').then(data),
  crearTarifa: (payload: { productoId: string; nombre: string; duracionMeses: number; precio: number }) => api.post<{ success: boolean; data: TarifaCatalogo }>('/tarifas', payload).then(data),
  servidores: () => api.get<{ success: boolean; data: ServidorCatalogo[] }>('/servidores').then(data),
  crearServidor: (payload: { nombre: string }) => api.post<{ success: boolean; data: ServidorCatalogo }>('/servidores', payload).then(data),
  referencias: (search?: string) => api.get<{ success: boolean; data: ReferenciaCatalogo[] }>('/referencias', { params: { search } }).then(data),
  crearReferencia: (payload: { nombre: string; observaciones?: string }) => api.post<{ success: boolean; data: ReferenciaCatalogo }>('/referencias', payload).then(data),
};
