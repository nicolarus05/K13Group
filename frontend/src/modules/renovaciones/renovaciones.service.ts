import { api } from '@/lib/api';
import type { Page, Subscription } from '@/modules/suscripciones/suscripciones.service';
export interface Renewal {
  id: string;
  version: number;
  suscripcionId: string;
  tipoOperacion: 'ALTA' | 'RENOVACION';
  fechaInicio: string;
  fechaFin: string;
  fechaOperacion: string | null;
  importe: string;
  origen: string;
  observaciones: string | null;
  motivoAnulacion: string | null;
  anuladaAt: string | null;
  productoNombreSnapshot: string | null;
  tarifaNombreSnapshot: string | null;
  servidorNombreSnapshot: string | null;
  referenciaNombreSnapshot: string | null;
  metodoPagoNombreSnapshot: string | null;
  estado: { valor: string; etiqueta: string } | null;
  metodoPago: { id: string; nombre: string; esGratuito: boolean };
  suscripcion: Subscription;
  movimientos: {
    id: string;
    importe: string;
    fecha: string;
    fechaCobro: string | null;
    fechaPrevistaCobro: string | null;
    metodoPagoNombreSnapshot: string | null;
    estado: { valor: string; etiqueta: string };
  }[];
}
export interface RenewalInput {
  version: number;
  solicitudId: string;
  importe: string;
  metodoPagoId: string;
  cobro: 'PENDIENTE' | 'CONFIRMADO';
  fechaCobro?: string;
  fechaPrevistaCobro?: string;
  observaciones?: string;
  motivoImporte?: string;
}
export type RenewalQuery = {
  page?: number;
  limit?: number;
  search?: string;
  vista?: string;
  estado?: string;
  cobro?: string;
  suscripcionId?: string;
  clienteId?: string;
  productoId?: string;
  desde?: string;
  hasta?: string;
};
export const renewals = {
  queue: (params: RenewalQuery) =>
    api.get<Page<Subscription>>('/renovaciones/seguimiento', { params }).then((r) => r.data),
  list: (params: RenewalQuery) =>
    api.get<Page<Renewal>>('/renovaciones', { params }).then((r) => r.data),
  get: (id: string) => api.get<{ data: Renewal }>('/renovaciones/' + id).then((r) => r.data.data),
  create: (id: string, initial: boolean, dto: RenewalInput) =>
    api
      .post<{ data: Renewal }>(
        '/suscripciones/' + id + (initial ? '/primer-pago' : '/renovar'),
        dto,
      )
      .then((r) => r.data.data),
  collect: (id: string, dto: { version: number; metodoPagoId: string; fechaCobro: string }) =>
    api.post('/renovaciones/' + id + '/cobrar', dto),
  annul: (id: string, version: number, motivo: string) =>
    api.post('/renovaciones/' + id + '/anular', { version, motivo }),
  preference: (row: Subscription, motivo: string) =>
    api.post('/suscripciones/' + row.id + '/preferencia-renovacion', {
      version: row.version,
      noRenovar: !row.noRenovar,
      motivo,
    }),
};
export const money = (value: string | number) =>
  Number(value).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
