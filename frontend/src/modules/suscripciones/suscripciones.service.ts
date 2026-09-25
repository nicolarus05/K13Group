import { api } from '@/lib/api';
import { catalogosService } from '@/modules/catalogos/services/catalogos.service';
import type { CatalogKind, CatalogRecord } from '@/modules/catalogos/types/catalogos.types';

export const subscriptionStates = [
  'ACTIVA',
  'PROXIMA_A_VENCER',
  'VENCIDA',
  'SUSPENDIDA',
  'CANCELADA',
] as const;
export interface Subscription {
  noRenovar: boolean;
  id: string;
  version: number;
  clienteId: string;
  productoId: string;
  tarifaId: string;
  servidorId: string;
  referenciaId: string | null;
  fechaInicio: string;
  fechaFin: string;
  tipoDispositivo: string | null;
  cliente: { id: string; nombre: string; telefono: string | null; deletedAt: string | null };
  producto: CatalogRecord;
  tarifa: CatalogRecord;
  servidor: CatalogRecord;
  referencia: CatalogRecord | null;
  estado: { id: string; valor: string; etiqueta: string };
}
export interface SubscriptionQuery {
  page?: number;
  limit?: number;
  search?: string;
  clienteId?: string;
  productoId?: string;
  servidorId?: string;
  referenciaId?: string;
  estado?: string;
  sort?: 'fechaFin' | 'createdAt';
  order?: 'asc' | 'desc';
}
export interface SubscriptionInput {
  clienteId: string;
  productoId: string;
  tarifaId: string;
  servidorId: string;
  referenciaId: string | null;
  fechaInicio: string;
  tipoDispositivo: string;
}
export interface Page<T> {
  success: boolean;
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
export interface HistoryEntry {
  id: string;
  accion: string;
  createdAt: string;
  usuario: { nombre: string } | null;
  datosAnteriores: Record<string, unknown> | null;
  datosNuevos: Record<string, unknown> & { motivo?: string; origen?: string };
}
export async function catalogOptions(kind: CatalogKind) {
  const items: CatalogRecord[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await catalogosService.list(kind, { page, limit: 100, estado: 'todos' });
    items.push(...response.data);
    totalPages = response.pagination.totalPages;
    page++;
  } while (page <= totalPages);
  return items;
}
export const subscriptions = {
  list: (params: SubscriptionQuery = {}) =>
    api.get<Page<Subscription>>('/suscripciones', { params }).then((r) => r.data),
  get: (id: string) =>
    api.get<{ data: Subscription }>('/suscripciones/' + id).then((r) => r.data.data),
  history: (id: string, page: number) =>
    api
      .get<Page<HistoryEntry>>('/suscripciones/' + id + '/historial', {
        params: { page, limit: 10 },
      })
      .then((r) => r.data),
  create: (input: SubscriptionInput, solicitudId: string) =>
    api
      .post<{ data: Subscription }>('/suscripciones', { ...input, solicitudId })
      .then((r) => r.data.data),
  update: (
    id: string,
    input: Omit<SubscriptionInput, 'clienteId' | 'productoId'>,
    version: number,
    motivoCorreccion: string,
  ) =>
    api
      .put<{ data: Subscription }>('/suscripciones/' + id, {
        ...input,
        version,
        ...(motivoCorreccion.trim() ? { motivoCorreccion } : {}),
      })
      .then((r) => r.data.data),
  action: (
    id: string,
    action: 'suspender' | 'reactivar' | 'cancelar',
    version: number,
    motivo: string,
  ) =>
    api
      .post<{ data: Subscription }>('/suscripciones/' + id + '/' + action, { version, motivo })
      .then((r) => r.data.data),
};
export function todayMadrid() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC' }).format(new Date(value));
}
export function annualPreview(value: string) {
  const start = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(start.getTime())) return '—';
  const year = start.getUTCFullYear() + 1;
  const month = start.getUTCMonth();
  const day = Math.min(start.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return dateLabel(new Date(Date.UTC(year, month, day)).toISOString());
}
