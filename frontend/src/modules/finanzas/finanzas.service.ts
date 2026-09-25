import { api } from '@/lib/api';
import type { Page, HistoryEntry } from '@/modules/suscripciones/suscripciones.service';
export interface Movement {
  id: string;
  version: number;
  importe: string;
  fecha: string;
  fechaCobro: string | null;
  fechaPrevistaCobro: string | null;
  concepto: string | null;
  descripcion: string | null;
  observaciones: string | null;
  origen: string;
  categoriaGastoId: string | null;
  metodoPagoId: string | null;
  categoriaNombreSnapshot: string | null;
  metodoPagoNombreSnapshot: string | null;
  productoNombreSnapshot: string | null;
  tarifaNombreSnapshot: string | null;
  servidorNombreSnapshot: string | null;
  referenciaNombreSnapshot: string | null;
  renovacionId: string | null;
  suscripcionId: string | null;
  motivoAnulacion: string | null;
  tipo: { valor: string; etiqueta: string };
  estado: { valor: string; etiqueta: string };
  categoriaGasto: { id: string; nombre: string } | null;
  metodoPago: { id: string; nombre: string } | null;
  suscripcion: { id: string; cliente: { id: string; nombre: string } } | null;
}
export interface Balance {
  ingresos: string;
  gastos: string;
  resultado: string;
  pendienteCobro: string;
  numeroIngresos: number;
  numeroGastos: number;
  numeroPendientes: number;
  numeroOperaciones: number;
  ticketMedio: string;
}
export interface FinanceQuery {
  page?: number;
  limit?: number;
  tipo?: string;
  estado?: string;
  categoriaGastoId?: string;
  metodoPagoId?: string;
  clienteId?: string;
  search?: string;
  desde?: string;
  hasta?: string;
}
export interface ExpenseInput {
  concepto: string;
  categoriaGastoId: string;
  metodoPagoId: string;
  importe: string;
  fecha: string;
  observaciones: string;
}
export const finances = {
  list: (params: FinanceQuery) =>
    api.get<Page<Movement>>('/finanzas', { params }).then((r) => r.data),
  balance: (params: FinanceQuery) =>
    api.get<{ data: Balance }>('/finanzas/balance', { params }).then((r) => r.data.data),
  get: (id: string) => api.get<{ data: Movement }>('/finanzas/' + id).then((r) => r.data.data),
  history: (id: string, page: number) =>
    api
      .get<Page<HistoryEntry>>('/finanzas/' + id + '/historial', { params: { page, limit: 10 } })
      .then((r) => r.data),
  create: (input: ExpenseInput, solicitudId: string) =>
    api
      .post<{ data: Movement }>('/finanzas/gasto', { ...input, solicitudId })
      .then((r) => r.data.data),
  update: (id: string, input: ExpenseInput, version: number, motivo: string) =>
    api
      .put<{ data: Movement }>('/finanzas/' + id, { ...input, version, motivo })
      .then((r) => r.data.data),
  annul: (id: string, version: number, motivo: string) =>
    api.post('/finanzas/' + id + '/anular', { version, motivo }),
};

export function periodRange(period: string, today: string) {
  if (period === 'todas') return { desde: '', hasta: '' };
  const start = new Date(today + 'T00:00:00Z');
  const end = new Date(start);
  const year = start.getUTCFullYear(),
    month = start.getUTCMonth();
  if (period === 'semana') {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
  } else if (period === 'mes') {
    start.setUTCDate(1);
    end.setUTCMonth(month + 1, 0);
  } else if (period === 'trimestre') {
    start.setUTCMonth(Math.floor(month / 3) * 3, 1);
    end.setUTCFullYear(year, Math.floor(month / 3) * 3 + 3, 0);
  } else if (period === 'ano') {
    start.setUTCMonth(0, 1);
    end.setUTCMonth(11, 31);
  }
  return { desde: start.toISOString().slice(0, 10), hasta: end.toISOString().slice(0, 10) };
}
