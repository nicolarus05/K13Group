import { Prisma } from '@prisma/client';
import { DATE_STATES, parseDay } from '../suscripciones/subscription-dates';

export const reminderSelect = {
  id: true,
  version: true,
  origen: true,
  fecha: true,
  fechaOriginal: true,
  descripcion: true,
  motivo: true,
  cerradoAt: true,
  createdAt: true,
  updatedAt: true,
  cliente: { select: { id: true, nombre: true } },
  suscripcionId: true,
  movimiento: {
    select: { id: true, renovacionId: true, importe: true, estado: { select: { valor: true } } },
  },
  tipo: { select: { valor: true, etiqueta: true } },
  estado: { select: { valor: true, etiqueta: true } },
} satisfies Prisma.RecordatorioSelect;

// También protege las lecturas entre una baja de cliente y el siguiente ciclo del worker.
export function availableReminder(): Prisma.RecordatorioWhereInput {
  return {
    OR: [
      { origen: { not: 'AUTOMATICO' }, cliente: { deletedAt: null } },
      {
        origen: 'AUTOMATICO',
        claveAutomatica: { startsWith: 'R:' },
        suscripcion: {
          deletedAt: null,
          noRenovar: false,
          estado: { valor: { in: [...DATE_STATES] } },
          cliente: { deletedAt: null, estado: { valor: 'ACTIVO' } },
        },
      },
      {
        origen: 'AUTOMATICO',
        claveAutomatica: { startsWith: 'C:' },
        movimiento: { tipo: { valor: 'INGRESO' }, estado: { valor: 'PENDIENTE' } },
      },
    ],
  };
}
export function attentionWhere(today: string, days: number): Prisma.RecordatorioWhereInput {
  const day = parseDay(today),
    end = new Date(day.getTime() + days * 86400000);
  return {
    AND: [
      availableReminder(),
      {
        OR: [
          { estado: { valor: 'POSPUESTO' }, fecha: { lte: day } },
          {
            estado: { valor: 'PENDIENTE' },
            OR: [
              { tipo: { valor: 'RENOVACION' }, fecha: { lte: end } },
              { tipo: { valor: { not: 'RENOVACION' } }, fecha: { lte: day } },
            ],
          },
        ],
      },
    ],
  };
}
