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
