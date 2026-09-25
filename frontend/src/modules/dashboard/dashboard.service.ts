import { api } from '@/lib/api';
import type { Page } from '@/modules/suscripciones/suscripciones.service';
export interface DashboardData {
  calidadImportacion: {
    ultima: { id: string; estado: string; createdAt: string } | null;
    pendientes: number;
    bloqueadas: number;
    pendientesFinancieras: number;
  };
  hoy: string;
  actualizado: string;
  periodo: {
    desde: string;
    hasta: string;
    anteriorDesde: string;
    anteriorHasta: string;
    days: number;
  };
  indicadores: {
    clientesVigentes: number;
    suscripcionesVigentes: number;
    renovaciones: number;
    nuevosClientes: number;
    ingresos: string;
    gastos: string;
    resultado: string;
    pendienteCobro: string;
    numeroPendientes: number;
    totalClientes: number;
  };
  variacion: {
    renovaciones: string | null;
    nuevosClientes: string | null;
    ingresos: string | null;
    gastos: string | null;
    resultado: string | null;
  };
  serie: {
    dia: string;
    ingresos: string;
    gastos: string;
    clientes: number;
    renovaciones: number;
  }[];
  trabajo: {
    hoy: number;
    vencidas: number;
    proximas: number;
    diasAviso: number;
    renovaciones: {
      id: string;
      fechaFin: string;
      cliente: { id: string; nombre: string };
      producto: { nombre: string };
    }[];
    cobros: {
      id: string;
      importe: string;
      fechaPrevistaCobro: string | null;
      renovacionId: string | null;
      suscripcion: { cliente: { nombre: string } } | null;
    }[];
    recordatorios: {
      id: string;
      fecha: string;
      suscripcionId: string | null;
      tipo: { valor: string; etiqueta: string };
      cliente: { id: string; nombre: string };
    }[];
  };
  actividad: {
    id: string;
    accion: string;
    tabla: string;
    registroId: string | null;
    createdAt: string;
    usuario: { nombre: string } | null;
  }[];
}
export interface DashboardClient {
  id: string;
  nombre: string;
  telefono: string | null;
  createdAt: string;
  estado: { valor: string; etiqueta: string };
  numeroSuscripciones: number;
  proximaRenovacion: { id: string; fechaFin: string } | null;
}
export const dashboard = {
  get: (params: { desde: string; hasta: string }) =>
    api.get<{ data: DashboardData }>('/dashboard', { params }).then((r) => r.data.data),
  clients: (params: { page: number; search?: string; estado?: string }) =>
    api.get<Page<DashboardClient>>('/dashboard/clientes', { params }).then((r) => r.data),
};
