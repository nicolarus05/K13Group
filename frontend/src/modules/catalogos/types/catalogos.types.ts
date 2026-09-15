export interface ProductoCatalogo { id: string; nombre: string; descripcion: string | null; activo: boolean; }
export interface TarifaCatalogo { id: string; productoId: string; nombre: string; duracionMeses: number; precio: number | string; activo: boolean; producto: ProductoCatalogo; }
export interface ServidorCatalogo { id: string; nombre: string; activo: boolean; }
export interface ReferenciaCatalogo { id: string; nombre: string; activo: boolean; observaciones: string | null; }
