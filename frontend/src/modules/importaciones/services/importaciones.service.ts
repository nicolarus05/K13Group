import { api } from '@/lib/api';
import type { ImportacionSummary } from '../types/importaciones.types';

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
};
