import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const ESTADOS = [
  // Clientes
  { tipo: 'cliente', valor: 'ACTIVO',    etiqueta: 'Activo',    orden: 1 },
  { tipo: 'cliente', valor: 'INACTIVO',  etiqueta: 'Inactivo',  orden: 2 },
  // Suscripciones
  { tipo: 'suscripcion', valor: 'BORRADOR',          etiqueta: 'Borrador',          orden: 1 },
  { tipo: 'suscripcion', valor: 'ACTIVA',             etiqueta: 'Activa',            orden: 2 },
  { tipo: 'suscripcion', valor: 'PROXIMA_A_VENCER',   etiqueta: 'Próxima a vencer',  orden: 3 },
  { tipo: 'suscripcion', valor: 'VENCIDA',            etiqueta: 'Vencida',           orden: 4 },
  { tipo: 'suscripcion', valor: 'SUSPENDIDA',         etiqueta: 'Suspendida',        orden: 5 },
  { tipo: 'suscripcion', valor: 'CANCELADA',          etiqueta: 'Cancelada',         orden: 6 },
  // Renovaciones
  { tipo: 'renovacion', valor: 'PENDIENTE',   etiqueta: 'Pendiente',   orden: 1 },
  { tipo: 'renovacion', valor: 'COMPLETADA',  etiqueta: 'Completada',  orden: 2 },
  { tipo: 'renovacion', valor: 'ANULADA',     etiqueta: 'Anulada',     orden: 3 },
  // Movimientos - tipo
  { tipo: 'movimiento_tipo', valor: 'INGRESO', etiqueta: 'Ingreso', orden: 1 },
  { tipo: 'movimiento_tipo', valor: 'GASTO',   etiqueta: 'Gasto',   orden: 2 },
  // Movimientos - estado
  { tipo: 'movimiento_estado', valor: 'PENDIENTE',   etiqueta: 'Pendiente',   orden: 1 },
  { tipo: 'movimiento_estado', valor: 'CONFIRMADO',  etiqueta: 'Confirmado',  orden: 2 },
  { tipo: 'movimiento_estado', valor: 'ANULADO',     etiqueta: 'Anulado',     orden: 3 },
  // Recordatorios - tipo
  { tipo: 'recordatorio_tipo', valor: 'RENOVACION', etiqueta: 'Renovación', orden: 1 },
  { tipo: 'recordatorio_tipo', valor: 'COBRO',      etiqueta: 'Cobro',      orden: 2 },
  { tipo: 'recordatorio_tipo', valor: 'TELEGRAM',   etiqueta: 'Telegram',   orden: 3 },
  // Recordatorios - estado
  { tipo: 'recordatorio_estado', valor: 'PENDIENTE',   etiqueta: 'Pendiente',   orden: 1 },
  { tipo: 'recordatorio_estado', valor: 'POSPUESTO',   etiqueta: 'Pospuesto',   orden: 2 },
  { tipo: 'recordatorio_estado', valor: 'COMPLETADO',  etiqueta: 'Completado',  orden: 3 },
  { tipo: 'recordatorio_estado', valor: 'CANCELADO',   etiqueta: 'Cancelado',   orden: 4 },
  // Copias de seguridad
  { tipo: 'copia_seguridad', valor: 'GENERANDO',   etiqueta: 'Generando',   orden: 1 },
  { tipo: 'copia_seguridad', valor: 'COMPLETADA',  etiqueta: 'Completada',  orden: 2 },
  { tipo: 'copia_seguridad', valor: 'FALLIDA',     etiqueta: 'Fallida',     orden: 3 },
  { tipo: 'copia_seguridad', valor: 'RESTAURADA',  etiqueta: 'Restaurada',  orden: 4 },
];

async function main() {
  // Estados del sistema
  for (const e of ESTADOS) {
    await prisma.estado.upsert({
      where: { tipo_valor: { tipo: e.tipo, valor: e.valor } },
      update: { etiqueta: e.etiqueta, orden: e.orden },
      create: { ...e, activo: true },
    });
  }
  console.log(`✓ ${ESTADOS.length} estados creados`);

  // Usuario admin
  const hash = await bcrypt.hash('admin1234', 10);
  const admin = await prisma.usuario.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      nombre: 'Administrador',
      passwordHash: hash,
      activo: true,
    },
  });

  console.log(`✓ Usuario creado: ${admin.username}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
