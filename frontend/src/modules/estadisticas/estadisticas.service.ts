import { api } from '@/lib/api';
export const sections = {
  resumen: 'Resumen',
  clientes: 'Clientes',
  renovaciones: 'Renovaciones',
  finanzas: 'Contabilidad',
  productos: 'Productos',
  servidores: 'Servidores',
  referencias: 'Referencias',
  'metodos-pago': 'Métodos de pago',
};
export type Section = keyof typeof sections;
export type Grain = 'dia' | 'mes' | 'ano';
export type Filters = Partial<
  Record<
    | 'productoId'
    | 'servidorId'
    | 'referenciaId'
    | 'metodoPagoId'
    | 'categoriaGastoId'
    | 'estadoCliente'
    | 'estadoOperacion',
    string
  >
>;
export interface StatsReport {
  seccion: Section;
  hoy: string;
  actualizado: string;
  periodo: {
    desde: string;
    hasta: string;
    anteriorDesde: string;
    anteriorHasta: string;
    dias: number;
    agrupacion: Grain;
  };
  calidad: { filasSinConciliar: number };
  finanzas?: {
    ingresos: string | null;
    gastos: string | null;
    resultado: string | null;
    ticketMedio: string | null;
    numeroIngresos: number;
    numeroGastos: number;
    variacion: { ingresos: string | null; gastos: string | null; resultado: string | null };
    serie: {
      dia: string;
      ingresos: string | null;
      gastos: string | null;
      resultado: string | null;
    }[];
  };
  clientes?: {
    actual: { total: number; vigentes: number; perdidos: number; noRenovar: number };
    altas: number;
    altasAnteriores: number;
    variacion: string | null;
    serie: { dia: string; altas: number }[];
    productosActuales: { id: string; nombre: string; clientes: number }[];
  };
  renovaciones?: {
    realizadas: number;
    altas: number;
    anuladas: number;
    gratuitas: number;
    pendientesCobro: number;
    tasa: {
      clientes: number;
      renovados: number;
      porcentaje: string | null;
      porcentajeObservable: string | null;
      sinVencimientoAnterior: number;
      provisional: boolean;
    };
    situacionActual: { hoy: number; vencidas: number; proximas: number; diasAviso: number };
    serie: { dia: string; renovaciones: number }[];
  };
  ranking?: {
    dimension: string;
    totalImporte: string;
    data: {
      clave: string;
      nombre: string;
      importe: string;
      operaciones: number;
      renovaciones: number;
      clientesCobro: number;
      clientesActuales: number;
      porcentaje: string | null;
    }[];
    grafico: { clave: string; nombre: string; importe: string }[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  };
}
export const stats = {
  get: (
    section: Section,
    params: Filters & {
      desde: string;
      hasta: string;
      agrupacion: Grain;
      page: number;
      limit?: number;
    },
  ) =>
    api
      .get<{ data: StatsReport }>('/estadisticas' + (section === 'resumen' ? '' : '/' + section), {
        params,
      })
      .then((r) => r.data.data),
};
