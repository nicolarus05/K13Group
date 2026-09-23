import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
const METODOS_PAGO = [
  ['EF', 'Efectivo'],
  ['STR', 'Stripe'],
  ['B-RE', 'Bizum Revolut'],
  ['T-IM', 'Transferencia Imagin'],
  ['B-SA', 'Bizum Santander'],
  ['T-SA', 'Transferencia Santander'],
  ['T-RE', 'Transferencia Revolut'],
  ['B-UN', 'Bizum Unicaja'],
  ['B-IM', 'Bizum Imagin'],
  ['B-MY', 'Bizum Myinvest'],
  ['B-PR', 'Bizum Privado'],
  ['FREE', 'Gratis'],
  ['GR', 'Gratis'],
  ['RE', 'Revolut'],
  ['T-MY', 'Transferencia Myinvest'],
  ['T-PR', 'Transferencia Privada'],
  ['T-UN', 'Transferencia Unicaja'],
  ['T-WI', 'Transferencia Wise'],
] as const;

const PRODUCTOS_BASE = [
  'K13IBO39',
  'K13PLAYER',
  'K13TIVI',
  'KDSPLAYER',
  'MAXPLAYER',
  'SMARTONE',
  'VUPLAYER',
] as const;
const SERVIDORES_BASE = [
  ['DEAD', true],
  ['COBRA', false],
  ['PROMAX', false],
] as const;
const TARIFAS_MAS_VENDIDAS = [
  ['MAXPLAYER', 75],
  ['K13PLAYER', 75],
  ['K13TIVI', 75],
  ['KDSPLAYER', 75],
  ['K13IBO39', 75],
  ['MAXPLAYER', 140],
  ['VUPLAYER', 75],
  ['K13TIVI', 150],
  ['KDSPLAYER', 150],
  ['SMARTONE', 75],
] as const;

const ESTADOS = [
  // Clientes
  { tipo: 'cliente', valor: 'ACTIVO', etiqueta: 'Activo', orden: 1 },
  { tipo: 'cliente', valor: 'INACTIVO', etiqueta: 'Inactivo', orden: 2 },
  // Suscripciones
  { tipo: 'suscripcion', valor: 'BORRADOR', etiqueta: 'Borrador', orden: 1 },
  { tipo: 'suscripcion', valor: 'ACTIVA', etiqueta: 'Activa', orden: 2 },
  { tipo: 'suscripcion', valor: 'PROXIMA_A_VENCER', etiqueta: 'Próxima a vencer', orden: 3 },
  { tipo: 'suscripcion', valor: 'VENCIDA', etiqueta: 'Vencida', orden: 4 },
  { tipo: 'suscripcion', valor: 'SUSPENDIDA', etiqueta: 'Suspendida', orden: 5 },
  { tipo: 'suscripcion', valor: 'CANCELADA', etiqueta: 'Cancelada', orden: 6 },
  // Renovaciones
  { tipo: 'renovacion', valor: 'PENDIENTE', etiqueta: 'Pendiente', orden: 1 },
  { tipo: 'renovacion', valor: 'COMPLETADA', etiqueta: 'Completada', orden: 2 },
  { tipo: 'renovacion', valor: 'ANULADA', etiqueta: 'Anulada', orden: 3 },
  // Movimientos - tipo
  { tipo: 'movimiento_tipo', valor: 'INGRESO', etiqueta: 'Ingreso', orden: 1 },
  { tipo: 'movimiento_tipo', valor: 'GASTO', etiqueta: 'Gasto', orden: 2 },
  // Movimientos - estado
  { tipo: 'movimiento_estado', valor: 'PENDIENTE', etiqueta: 'Pendiente', orden: 1 },
  { tipo: 'movimiento_estado', valor: 'CONFIRMADO', etiqueta: 'Confirmado', orden: 2 },
  { tipo: 'movimiento_estado', valor: 'ANULADO', etiqueta: 'Anulado', orden: 3 },
  // Recordatorios - tipo
  { tipo: 'recordatorio_tipo', valor: 'RENOVACION', etiqueta: 'Renovación', orden: 1 },
  { tipo: 'recordatorio_tipo', valor: 'COBRO', etiqueta: 'Cobro', orden: 2 },
  { tipo: 'recordatorio_tipo', valor: 'TELEGRAM', etiqueta: 'Telegram', orden: 3 },
  // Recordatorios - estado
  { tipo: 'recordatorio_estado', valor: 'PENDIENTE', etiqueta: 'Pendiente', orden: 1 },
  { tipo: 'recordatorio_estado', valor: 'POSPUESTO', etiqueta: 'Pospuesto', orden: 2 },
  { tipo: 'recordatorio_estado', valor: 'COMPLETADO', etiqueta: 'Completado', orden: 3 },
  { tipo: 'recordatorio_estado', valor: 'CANCELADO', etiqueta: 'Cancelado', orden: 4 },
  // Copias de seguridad
  { tipo: 'copia_seguridad', valor: 'GENERANDO', etiqueta: 'Generando', orden: 1 },
  { tipo: 'copia_seguridad', valor: 'COMPLETADA', etiqueta: 'Completada', orden: 2 },
  { tipo: 'copia_seguridad', valor: 'FALLIDA', etiqueta: 'Fallida', orden: 3 },
  { tipo: 'copia_seguridad', valor: 'RESTAURADA', etiqueta: 'Restaurada', orden: 4 },
];

export async function seedBase(prisma: PrismaClient) {
  for (const estado of ESTADOS) {
    await prisma.estado.upsert({
      where: { tipo_valor: { tipo: estado.tipo, valor: estado.valor } },
      update: {},
      create: { ...estado, activo: true },
    });
  }
  const admin = await prisma.usuario.findUnique({ where: { username: 'admin' } });
  if (!admin)
    await prisma.usuario.create({
      data: {
        username: 'admin',
        nombre: 'Administrador',
        passwordHash: await bcrypt.hash('admin1234', 10),
        activo: true,
      },
    });
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('seed:catalogos:v1'))`;
      // El marcador evita recrear registros renombrados en ejecuciones posteriores.
      if (await tx.configuracion.findUnique({ where: { clave: 'seed.catalogos.v1' } })) return;
      for (const [code, name] of METODOS_PAGO) {
        const existing = await tx.importacionEquivalencia.findUnique({
          where: { tipo_valorClave: { tipo: 'PAGO', valorClave: code } },
        });
        if (existing) continue;
        const method = await tx.metodoPago.upsert({
          where: { nombre: name },
          update: {},
          create: { nombre: name, esGratuito: name === 'Gratis' },
        });
        await tx.importacionEquivalencia.create({
          data: {
            tipo: 'PAGO',
            valorOrigen: code,
            valorClave: code,
            valorCanonico: method.nombre,
            entidadId: method.id,
          },
        });
      }
      const products = new Map<string, string>();
      for (const nombre of PRODUCTOS_BASE) {
        const eq = await tx.importacionEquivalencia.findUnique({
          where: { tipo_valorClave: { tipo: 'PRODUCTO', valorClave: nombre } },
        });
        const product = eq?.entidadId
          ? await tx.producto.findUnique({ where: { id: eq.entidadId } })
          : await tx.producto.upsert({ where: { nombre }, update: {}, create: { nombre } });
        if (product) products.set(nombre, product.id);
        if (!eq && product)
          await tx.importacionEquivalencia.create({
            data: {
              tipo: 'PRODUCTO',
              valorOrigen: nombre,
              valorClave: nombre,
              valorCanonico: product.nombre,
              entidadId: product.id,
            },
          });
      }
      for (const [nombre, activo] of SERVIDORES_BASE) {
        const eq = await tx.importacionEquivalencia.findUnique({
          where: { tipo_valorClave: { tipo: 'SERVIDOR', valorClave: nombre } },
        });
        if (eq) continue;
        const server = await tx.servidor.upsert({
          where: { nombre },
          update: {},
          create: { nombre, activo },
        });
        await tx.importacionEquivalencia.create({
          data: {
            tipo: 'SERVIDOR',
            valorOrigen: nombre,
            valorClave: nombre,
            valorCanonico: server.nombre,
            entidadId: server.id,
          },
        });
      }
      for (const [nombre, precio] of TARIFAS_MAS_VENDIDAS) {
        const key = `${nombre}|${precio}`;
        if (
          await tx.importacionEquivalencia.findUnique({
            where: { tipo_valorClave: { tipo: 'TARIFA', valorClave: key } },
          })
        )
          continue;
        const productoId = products.get(nombre);
        if (!productoId) continue;
        const name = `${nombre} - ${precio}€/año`;
        const existing = await tx.tarifa.findFirst({ where: { productoId, nombre: name } });
        const tariff =
          existing ??
          (await tx.tarifa.create({
            data: { productoId, nombre: name, precio, duracionMeses: 12 },
          }));
        await tx.importacionEquivalencia.create({
          data: {
            tipo: 'TARIFA',
            valorOrigen: `P.AÑO ${precio}`,
            valorClave: key,
            valorCanonico: tariff.nombre,
            entidadId: tariff.id,
          },
        });
      }
      await tx.configuracion.create({
        data: {
          clave: 'seed.catalogos.v1',
          valor: 'completado',
          descripcion: 'Catálogos base inicializados; preservar ediciones manuales.',
        },
      });
    },
    { timeout: 30000 },
  );
}
if (require.main === module) {
  const prisma = new PrismaClient();
  seedBase(prisma)
    .then(() => console.log('Inicialización básica completada.'))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
