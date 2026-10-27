// Solo datos sintéticos, en la instalación desechable de quality/compose.yml.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { seedBase } = require('../dist/prisma/seed');
const { datedState, businessDay } = require('../dist/src/suscripciones/subscription-dates');
const { createHash } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL);
assert.equal(process.env.QUALITY_ISOLATED, '1');
assert.equal(url.hostname, 'quality-db');
assert.equal(url.pathname, '/k13_quality');
const scale = Number(process.env.QUALITY_SCALE || 1);
assert.ok([1, 10].includes(scale));
const db = new PrismaClient();
const id = (kind, i) => {
  const hex = createHash('sha256').update(`quality:${kind}:${i}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
async function batch(model, data) {
  for (let i = 0; i < data.length; i += 500)
    await db[model].createMany({ data: data.slice(i, i + 500) });
}
(async () => {
  const marker = await db.configuracion.findUnique({ where: { clave: 'quality.fixture.v1' } });
  if (marker) {
    assert.equal(
      marker.valor,
      String(scale),
      'No se puede cambiar la escala de un fixture existente',
    );
    console.log('Fixture sintético existente; se conservan sus datos.');
    return;
  }
  assert.equal(await db.cliente.count(), 0, 'El fixture requiere una base vacía; no elimina datos');
  await seedBase(db);
  const states = Object.fromEntries(
    (await db.estado.findMany()).map((r) => [r.tipo + ':' + r.valor, r.id]),
  );
  const rates = await db.tarifa.findMany({ orderBy: { nombre: 'asc' } });
  const server = await db.servidor.findUniqueOrThrow({ where: { nombre: 'DEAD' } });
  const method = await db.metodoPago.findUniqueOrThrow({ where: { nombre: 'Efectivo' } });
  const free = await db.metodoPago.findUniqueOrThrow({ where: { nombre: 'Gratis' } });
  const n = 2664 * scale,
    total = 2672 * scale;
  const clients = Array.from({ length: n }, (_, i) => ({
    id: id('client', i),
    nombre: `Cliente ficticio ${String(i).padStart(6, '0')}`,
    estadoId: states['cliente:ACTIVO'],
    createdAt: new Date('2026-01-01'),
    ...(i % 20 === 0 ? { deletedAt: new Date('2026-02-01') } : {}),
  }));
  await batch('cliente', clients);
  await batch(
    'referencia',
    Array.from({ length: 200 }, (_, i) => ({
      id: id('ref', i),
      nombre: `Referencia ficticia ${i}`,
    })),
  );
  const subscriptions = Array.from({ length: total }, (_, i) => {
    const rate = rates[i % rates.length];
    const end = new Date(Date.UTC(2025 + (i % 3), i % 12, 1 + (i % 27)));
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    return {
      id: id('sub', i),
      clienteId: id('client', i % n),
      productoId: rate.productoId,
      tarifaId: rate.id,
      servidorId: server.id,
      referenciaId: id('ref', i % 200),
      fechaInicio: start,
      fechaFin: end,
      estadoId: states['suscripcion:' + datedState(end, businessDay())],
    };
  });
  await batch('suscripcion', subscriptions);
  await batch(
    'renovacion',
    subscriptions.map((s, i) => ({
      id: id('op', i),
      suscripcionId: s.id,
      tipoOperacion: 'ALTA',
      fechaInicio: s.fechaInicio,
      fechaFin: s.fechaFin,
      fechaOperacion: s.fechaInicio,
      importe: i % 400 === 0 ? 0 : rates[i % rates.length].precio,
      metodoPagoId: i % 400 === 0 ? free.id : method.id,
      estadoId: states['renovacion:COMPLETADA'],
      atribucionVerificada: true,
      productoIdSnapshot: s.productoId,
      servidorIdSnapshot: s.servidorId,
      referenciaIdSnapshot: s.referenciaId,
    })),
  );
  await batch(
    'movimientoFinanciero',
    subscriptions.flatMap((s, i) =>
      i % 400 === 0
        ? []
        : [
            {
              id: id('money', i),
              suscripcionId: s.id,
              renovacionId: id('op', i),
              tipoId: states['movimiento_tipo:INGRESO'],
              estadoId: states['movimiento_estado:' + (i % 100 === 0 ? 'PENDIENTE' : 'CONFIRMADO')],
              metodoPagoId: method.id,
              importe: rates[i % rates.length].precio,
              fecha: s.fechaInicio,
              fechaCobro: i % 100 === 0 ? null : s.fechaInicio,
            },
          ],
    ),
  );
  await batch(
    'actividad',
    Array.from({ length: total * 8 }, (_, i) => ({
      id: id('audit', i),
      tabla: ['clientes', 'suscripciones', 'renovaciones', 'finanzas'][i % 4],
      accion: ['CREAR', 'EDITAR', 'ESTADO_AUTOMATICO'][i % 3],
      registroId: [
        id('client', i % n),
        id('sub', i % total),
        id('op', i % total),
        id('money', i % total),
      ][i % 4],
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
      datosNuevos: { origen: 'FIXTURE', version: i % 8 },
    })),
  );
  await batch(
    'recordatorio',
    Array.from({ length: 300 * scale }, (_, i) => ({
      id: id('reminder', i),
      clienteId: id('client', i % n),
      tipoId: states['recordatorio_tipo:TELEGRAM'],
      estadoId: states['recordatorio_estado:PENDIENTE'],
      origen: 'MANUAL',
      fecha: new Date(Date.UTC(2026, i % 12, 1 + (i % 27))),
      descripcion: 'Aviso ficticio de rendimiento',
    })),
  );
  await db.configuracion.create({ data: { clave: 'quality.fixture.v1', valor: String(scale) } });
  await db.$executeRawUnsafe('ANALYZE');
  console.log(
    JSON.stringify({
      fixture: 'sintético',
      scale,
      clientes: n,
      servicios: total,
      actividad: total * 8,
    }),
  );
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
