import { api } from '@/lib/api';
import { isAxiosError } from 'axios';
import type {
  CatalogKind,
  CatalogPage,
  CatalogPayload,
  CatalogQuery,
  CatalogRecord,
} from '../types/catalogos.types';

export const catalogosService = {
  list: (kind: CatalogKind, params: CatalogQuery = {}) =>
    api.get<CatalogPage>(`/${kind}`, { params }).then((response) => response.data),
  save: (kind: CatalogKind, payload: CatalogPayload, id?: string) =>
    id ? api.put(`/${kind}/${id}`, payload) : api.post(`/${kind}`, payload),
  setActive: (kind: CatalogKind, id: string, active: boolean) =>
    active ? api.post(`/${kind}/${id}/reactivar`) : api.delete(`/${kind}/${id}`),
  productOptions: async () => {
    const items: CatalogRecord[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const response = await catalogosService.list('productos', {
        page,
        limit: 100,
        estado: 'todos',
      });
      items.push(...response.data);
      totalPages = response.pagination.totalPages;
      page += 1;
    } while (page <= totalPages);
    return items;
  },
};
export function catalogError(error: unknown): string {
  if (isAxiosError<{ message?: string | string[] }>(error)) {
    const message = error.response?.data?.message;
    if (Array.isArray(message)) return message.join(' · ');
    if (message) return message;
  }
  return 'No se pudo completar la operación. Comprueba la conexión e inténtalo de nuevo.';
}
