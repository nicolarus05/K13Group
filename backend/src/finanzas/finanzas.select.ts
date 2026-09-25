import { Prisma } from '@prisma/client';
export const financeSelect = {
  id: true,
  version: true,
  tipoId: true,
  estadoId: true,
  importe: true,
  fecha: true,
  fechaCobro: true,
  fechaPrevistaCobro: true,
  origen: true,
  concepto: true,
  descripcion: true,
  observaciones: true,
  categoriaGastoId: true,
  categoriaNombreSnapshot: true,
  metodoPagoId: true,
  metodoPagoNombreSnapshot: true,
  productoNombreSnapshot: true,
  tarifaNombreSnapshot: true,
  servidorNombreSnapshot: true,
  referenciaNombreSnapshot: true,
  suscripcionId: true,
  renovacionId: true,
  motivoAnulacion: true,
  anuladaAt: true,
  createdAt: true,
  updatedAt: true,
  tipo: { select: { valor: true, etiqueta: true } },
  estado: { select: { valor: true, etiqueta: true } },
  categoriaGasto: { select: { id: true, nombre: true, activo: true } },
  metodoPago: { select: { id: true, nombre: true, activo: true, esGratuito: true } },
  suscripcion: { select: { id: true, cliente: { select: { id: true, nombre: true } } } },
} satisfies Prisma.MovimientoFinancieroSelect;

// Las anulaciones de ingresos pertenecen a Renovaciones, también las anteriores
// al sprint 7. Se resuelven al leer, sin reescribir el libro ni su auditoría.
export const financeReadSelect = {
  ...financeSelect,
  renovacion: {
    select: { motivoAnulacion: true, anuladaAt: true, estado: { select: { valor: true } } },
  },
} satisfies Prisma.MovimientoFinancieroSelect;

export function presentMovement(
  row: Prisma.MovimientoFinancieroGetPayload<{ select: typeof financeReadSelect }>,
) {
  const { renovacion, ...movement } = row;
  if (
    movement.tipo.valor === 'INGRESO' &&
    movement.estado.valor === 'ANULADO' &&
    renovacion?.estado?.valor === 'ANULADA'
  ) {
    movement.motivoAnulacion ??= renovacion.motivoAnulacion;
    movement.anuladaAt ??= renovacion.anuladaAt;
  }
  return movement;
}
