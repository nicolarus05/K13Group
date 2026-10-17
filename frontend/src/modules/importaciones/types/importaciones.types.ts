export interface ImportacionHoja {
  hoja: string;
  filas: number;
  errores: number;
  advertencias: number;
  detalleErrores?: string[];
  cabecera?: number | null;
  columnasAusentes?: string[];
  columnasAdicionales?: string[];
  clasificacion?: Record<string, number>;
}

export interface ImportacionSummary {
  versionMapeo?: string;
  soloLectura?: boolean;
  bloqueos?: Record<string, number>;
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
  version: number;
  historialLectura?: Array<{
    version: number;
    autor: string;
    fecha: string;
    motivo: string;
    anteriores: Record<string, unknown>;
    cambios: Record<string, unknown>;
  }>;
  correcciones?: Record<string, string | null>;
  lectura?: {
    campos: Record<
      string,
      { celda: string | null; encabezado: string; valor: unknown; estado: string; formula?: string }
    >;
    incidencias: Array<{
      codigo: string;
      campo: string;
      celda: string | null;
      ambito: string;
      mensaje: string;
    }>;
  } | null;
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
  tarifas: Array<{
    id: string;
    nombre: string;
    duracionMeses: number;
    productoId: string;
    producto: { nombre: string };
  }>;
  servidores: Array<{ id: string; nombre: string }>;
  referencias: Array<{ id: string; nombre: string }>;
  metodosPago: Array<{ id: string; nombre: string }>;
  equivalencias: Array<{
    id: string;
    tipo: string;
    valorClave: string;
    valorCanonico: string;
    entidadId: string | null;
  }>;
}
