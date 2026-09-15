import { api } from '@/lib/api';
import type {
  CatalogoImportacion,
  ImportacionFila,
  ImportacionFilasResponse,
  ImportacionSummary,
  ValorPendiente,
} from '../types/importaciones.types';

export const importacionesService = {
  preview: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api
      .post<{ success: boolean; data: ImportacionSummary }>('/importaciones/clientes/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((response) => response.data.data);
  },

  confirm: (id: string, permitirAdvertencias = false) =>
    api
      .post<{ success: boolean; data: ImportacionSummary }>(
        `/importaciones/${id}/confirmar`,
        { confirmar: true, permitirAdvertencias },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      )
      .then((response) => response.data.data),

  rows: (id: string, params?: { page?: number; limit?: number; estado?: string; hoja?: string; buscar?: string }) =>
    api.get<ImportacionFilasResponse>(`/importaciones/${id}/filas`, { params }),

  catalogs: (id: string) =>
    api.get<{ success: boolean; data: CatalogoImportacion }>(`/importaciones/${id}/catalogos`),

  pendingValues: (id: string) =>
    api.get<{ success: boolean; data: ValorPendiente[] }>(`/importaciones/${id}/valores-pendientes`),

  reviewRow: (id: string, rowId: string, data: Record<string, unknown>) =>
    api.patch<{ success: boolean; data: ImportacionFila }>(`/importaciones/${id}/filas/${rowId}/revisar`, data),

  reconcile: (id: string, confirmarFinanzas: boolean) =>
    api.post<{ success: boolean; data: ImportacionSummary }>(`/importaciones/${id}/reconciliar`, {
      confirmarOperaciones: true,
      confirmarFinanzas,
    }),
};
