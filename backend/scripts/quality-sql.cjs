const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { EstadisticasService } = require('../dist/src/estadisticas/estadisticas.service');
const { StatsQuery } = require('../dist/src/estadisticas/estadisticas.dto');
assert.equal(process.env.QUALITY_ISOLATED, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'quality-db');
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/k13_quality');
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
const queries = [];
let capture = true;
db.$on('query', (event) => {
  if (capture && /^\s*(SELECT|WITH)/i.test(event.query)) queries.push(event);
});
(async () => {
  assert.equal(
    (await db.configuracion.findUnique({ where: { clave: 'quality.fixture.v1' } }))?.valor,
    process.env.QUALITY_SCALE || '1',
  );
  const query = Object.assign(new StatsQuery(), { desde: '2026-01-01', hasta: '2026-10-26' });
  const report = await new EstadisticasService(db).report(
    'resumen',
    query,
    undefined,
    '2026-10-26',
  );
  capture = false;
  delete report.actualizado;
  const plans = [];
  for (const item of queries) {
    const params = JSON.parse(item.params).map((value) =>
      typeof value === 'string' && /^\d{4}-\d\d-\d\d[T ]/.test(value) ? new Date(value) : value,
    );
    const plan = await db.$queryRawUnsafe(
      'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + item.query,
      ...params,
    );
    plans.push({ sql: item.query, durationMs: item.duration, plan });
  }
  console.log(JSON.stringify({ report, plans }, null, 2));
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
