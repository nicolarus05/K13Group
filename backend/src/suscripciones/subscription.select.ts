import { Prisma } from '@prisma/client';

// Lista explícita: nunca devolver identificadores operativos, hashes ni claves de solicitud.
export const subscriptionSelect = {
  id: true,
  version: true,
  clienteId: true,
  productoId: true,
  tarifaId: true,
  servidorId: true,
  referenciaId: true,
  fechaInicio: true,
  fechaFin: true,
  tipoDispositivo: true,
  createdAt: true,
  updatedAt: true,
  cliente: { select: { id: true, nombre: true, telefono: true, deletedAt: true } },
  producto: { select: { id: true, nombre: true, activo: true, deletedAt: true } },
  tarifa: { select: { id: true, nombre: true, precio: true, activo: true } },
  servidor: { select: { id: true, nombre: true, activo: true, deletedAt: true } },
  referencia: { select: { id: true, nombre: true, activo: true, deletedAt: true } },
  estado: { select: { id: true, valor: true, etiqueta: true } },
} satisfies Prisma.SuscripcionSelect;
export type SubscriptionView = Prisma.SuscripcionGetPayload<{ select: typeof subscriptionSelect }>;
