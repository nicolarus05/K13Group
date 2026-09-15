import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExcelParserService } from '../src/importaciones/excel-parser.service';

const prisma = new PrismaClient();

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
  ['PA', 'Obvialo'],
  ['RE', 'Revolut'],
  ['T-MY', 'Transferencia Myinvest'],
  ['T-PR', 'Transferencia Privada'],
  ['T-UN', 'Transferencia Unicaja'],
  ['T-WI', 'Transferencia Wise'],
] as const;

const PRODUCTOS_BASE = ['K13IBO39', 'K13PLAYER', 'K13TIVI', 'KDSPLAYER', 'MAXPLAYER', 'SMARTONE', 'VUPLAYER'] as const;
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

const PRODUCTOS_LEGACY = [
  ['K13IB39', 'K13IBO39'],
  ['K13`PLAYER', 'K13PLAYER'],
  ['K13 PLAYER', 'K13PLAYER'],
  ['K13PLAUER', 'K13PLAYER'],
  ['KSDPLAYER', 'KDSPLAYER'],
  ['VUPLER', 'VUPLAYER'],
  ['0PLAYER', '0 PLAYER'],
  ['ARC PLAYER CJ C1 74 DD F5 7E', 'ARC PLAYER'],
] as const;

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

async function mergeLegacyProducts() {
  for (const [legacyName, canonicalName] of PRODUCTOS_LEGACY) {
    const legacy = await prisma.producto.findUnique({ where: { nombre: legacyName } });
    if (!legacy) continue;
    const canonical = await prisma.producto.upsert({
      where: { nombre: canonicalName },
      update: { activo: true, deletedAt: null },
      create: { nombre: canonicalName, activo: true },
    });
    if (legacy.id === canonical.id) continue;
    await prisma.tarifa.updateMany({ where: { productoId: legacy.id }, data: { productoId: canonical.id } });
    await prisma.suscripcion.updateMany({ where: { productoId: legacy.id }, data: { productoId: canonical.id } });
    await prisma.importacionEquivalencia.updateMany({ where: { tipo: 'PRODUCTO', entidadId: legacy.id }, data: { entidadId: canonical.id, valorCanonico: canonicalName } });
    await prisma.producto.update({ where: { id: legacy.id }, data: { activo: false, deletedAt: new Date() } });
  }
}

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

  const paymentMethods = new Map<string, string>();
  for (const [, name] of METODOS_PAGO) {
    const method = await prisma.metodoPago.upsert({
      where: { nombre: name },
      update: { activo: true, deletedAt: null },
      create: { nombre: name, activo: true },
    });
    paymentMethods.set(name, method.id);
  }
  for (const [code, name] of METODOS_PAGO) {
    await prisma.importacionEquivalencia.upsert({
      where: { tipo_valorClave: { tipo: 'PAGO', valorClave: code } },
      update: { valorOrigen: code, valorCanonico: name, entidadId: paymentMethods.get(name), activo: true },
      create: { tipo: 'PAGO', valorOrigen: code, valorClave: code, valorCanonico: name, entidadId: paymentMethods.get(name) },
    });
  }
  console.log(`✓ ${METODOS_PAGO.length} códigos PAGO mapeados`);

  const products = new Map<string, string>();
  for (const nombre of PRODUCTOS_BASE) {
    const product = await prisma.producto.upsert({ where: { nombre }, update: { activo: true, deletedAt: null }, create: { nombre, activo: true } });
    products.set(nombre, product.id);
    await prisma.importacionEquivalencia.upsert({
      where: { tipo_valorClave: { tipo: 'PRODUCTO', valorClave: nombre } },
      update: { valorOrigen: nombre, valorCanonico: nombre, entidadId: product.id, activo: true },
      create: { tipo: 'PRODUCTO', valorOrigen: nombre, valorClave: nombre, valorCanonico: nombre, entidadId: product.id },
    });
  }
  for (const [nombre, activo] of SERVIDORES_BASE) {
    const server = await prisma.servidor.upsert({ where: { nombre }, update: { activo, deletedAt: null }, create: { nombre, activo } });
    await prisma.importacionEquivalencia.upsert({
      where: { tipo_valorClave: { tipo: 'SERVIDOR', valorClave: nombre } },
      update: { valorOrigen: nombre, valorCanonico: nombre, entidadId: server.id, activo: true },
      create: { tipo: 'SERVIDOR', valorOrigen: nombre, valorClave: nombre, valorCanonico: nombre, entidadId: server.id },
    });
  }
  for (const [productName, price] of TARIFAS_MAS_VENDIDAS) {
    const productId = products.get(productName)!;
    const name = `${productName} - ${price}€/año`;
    const existing = await prisma.tarifa.findFirst({ where: { productoId: productId, nombre: name } });
    const tariff = existing ?? await prisma.tarifa.create({ data: { productoId: productId, nombre: name, duracionMeses: 12, precio: price, activo: true } });
    const key = `${productName}|${price}`;
    await prisma.importacionEquivalencia.upsert({
      where: { tipo_valorClave: { tipo: 'TARIFA', valorClave: key } },
      update: { valorOrigen: `P.AÑO ${price}`, valorCanonico: name, entidadId: tariff.id, activo: true },
      create: { tipo: 'TARIFA', valorOrigen: `P.AÑO ${price}`, valorClave: key, valorCanonico: name, entidadId: tariff.id },
    });
  }
  const workbookPath = resolve(__dirname, '../../Modelos Funcionales/CLIENTES 2026(Actualizado).xlsx');
  if (existsSync(workbookPath)) {
    const parsedRows = new ExcelParserService().parse(readFileSync(workbookPath)).flatMap((sheet) => sheet.filas);
    const discoveredProducts = new Set(parsedRows.map((row) => row.datosNormalizados.productoClave).filter((value): value is string => Boolean(value)));
    for (const nombre of discoveredProducts) {
      const product = await prisma.producto.upsert({ where: { nombre }, update: { activo: true, deletedAt: null }, create: { nombre, activo: true } });
      await prisma.importacionEquivalencia.upsert({
        where: { tipo_valorClave: { tipo: 'PRODUCTO', valorClave: nombre } },
        update: { valorOrigen: nombre, valorCanonico: nombre, entidadId: product.id, activo: true },
        create: { tipo: 'PRODUCTO', valorOrigen: nombre, valorClave: nombre, valorCanonico: nombre, entidadId: product.id },
      });
    }
    console.log(`✓ ${discoveredProducts.size} aplicaciones detectadas como productos`);
  }
  await mergeLegacyProducts();
  console.log(`✓ ${PRODUCTOS_BASE.length} productos y ${TARIFAS_MAS_VENDIDAS.length} tarifas iniciales creados`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
