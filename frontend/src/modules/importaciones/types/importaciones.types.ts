export interface ImportacionHoja {
  hoja: string;
  filas: number;
  errores: number;
  advertencias: number;
}

export interface ImportacionSummary {
  importacionId: string;
  archivo: string;
  checksum: string | null;
  estado: string;
  filas: number;
  clientesNuevos: number;
  posiblesDuplicados: number;
  errores: number;
  advertencias: number;
  filasPendientesReconciliacion: number;
  movimientosCreados: number;
  fechaInicio: string | null;
  fechaFin: string | null;
  hojas: ImportacionHoja[];
}

export interface ImportacionFila {
  id: string;
  hojaOrigen: string;
  filaOrigen: number;
  estado: string;
  decision: 'ACEPTAR' | 'RECHAZAR' | 'PENDIENTE' | null;
  datosNormalizados: Record<string, unknown>;
  datosOriginales: Record<string, unknown>;
  mapeo: Record<string, string> | null;
  errores: string[] | null;
  advertencias: string[] | null;
  clienteId: string | null;
  suscripcionId: string | null;
  renovacionId: string | null;
  movimientoId: string | null;
  observacionRevision: string | null;
  revisadaAt: string | null;
}

export interface ImportacionFilasResponse {
  success: boolean;
  data: ImportacionFila[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface ValorPendiente {
  tipo: 'PRODUCTO' | 'SERVIDOR' | 'REFERENCIA' | 'PAGO' | 'TARIFA';
  valorOrigen: string;
  valorClave: string;
  filas: number;
}

export interface CatalogoImportacion {
  productos: Array<{ id: string; nombre: string }>;
  tarifas: Array<{ id: string; nombre: string; duracionMeses: number; productoId: string; producto: { nombre: string } }>;
  servidores: Array<{ id: string; nombre: string }>;
  referencias: Array<{ id: string; nombre: string }>;
  metodosPago: Array<{ id: string; nombre: string }>;
  equivalencias: Array<{ id: string; tipo: string; valorClave: string; valorCanonico: string; entidadId: string | null }>;
}
