import { api, PaginatedResponse } from '@/lib/api';
export interface Reminder {
  id: string;
  version: number;
  origen: string;
  fecha: string;
  fechaOriginal: string | null;
  descripcion: string | null;
  motivo: string | null;
  cerradoAt: string | null;
  cliente: { id: string; nombre: string };
  suscripcionId: string | null;
  movimiento: {
    id: string;
    renovacionId: string | null;
    importe: string;
    estado: { valor: string };
  } | null;
  tipo: { valor: string; etiqueta: string };
  estado: { valor: string; etiqueta: string };
}
export interface AgendaEvent {
  clave: string;
  tipo: string;
  fecha: string;
  fechaOriginal: string;
  clienteId: string;
  cliente: string;
  suscripcionId: string | null;
  renovacionId: string | null;
  recordatorioId: string | null;
  estadoAviso: string | null;
  descripcion: string | null;
}
export interface HistoryRow {
  id: string;
  accion: string;
  createdAt: string;
  usuario: { nombre: string } | null;
  datosNuevos: { fecha?: string; motivo?: string; descripcion?: string } | null;
}
export const reminders = {
  list: async (params: Record<string, unknown>) =>
    (await api.get<PaginatedResponse<Reminder>>('/recordatorios', { params })).data,
  summary: async () =>
    (await api.get<{ data: { atencion: number; hoy: string } }>('/recordatorios/resumen')).data
      .data,
  detail: async (id: string) =>
    (await api.get<{ data: Reminder }>('/recordatorios/' + id)).data.data,
  history: async (id: string, page: number) =>
    (
      await api.get<PaginatedResponse<HistoryRow>>(`/recordatorios/${id}/historial`, {
        params: { page, limit: 10 },
      })
    ).data,
  create: async (data: Record<string, unknown>) =>
    (await api.post<{ data: Reminder }>('/recordatorios', data)).data.data,
  action: async (id: string, action: string, data: Record<string, unknown>) =>
    (await api.post<{ data: Reminder }>(`/recordatorios/${id}/${action}`, data)).data.data,
  calendar: async (params: Record<string, unknown>) =>
    (
      await api.get<{
        data: { fecha: string; total: number; renovaciones: number; cobros: number }[];
      }>('/recordatorios/calendario', { params })
    ).data.data,
  agenda: async (params: Record<string, unknown>) =>
    (await api.get<PaginatedResponse<AgendaEvent>>('/recordatorios/agenda', { params })).data,
};
export function madridToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day'].map((t) => parts.find((p) => p.type === t)!.value).join('-');
}
export const dateLabel = (value: string) =>
  new Date(value.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('es-ES', {
    timeZone: 'Europe/Madrid',
  });
export const kindLabel = (kind: string) =>
  kind === 'TELEGRAM' ? 'Contacto interno' : kind === 'COBRO' ? 'Cobro' : 'Renovación';
