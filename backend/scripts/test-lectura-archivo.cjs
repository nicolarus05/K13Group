// Ensayo del archivo completo por stdin, siempre en un esquema temporal.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { seedBase } = require('../dist/prisma/seed');
const { ExcelParserService } = require('../dist/src/importaciones/excel-parser.service');
const { ImportacionesService } = require('../dist/src/importaciones/importaciones.service');
const { ImportacionFilasDto } = require('../dist/src/importaciones/dto/importacion-filas.dto');
async function main() {
  const buffer = readFileSync(0);
  const schema = 'catalogos_test_' + randomUUID().replaceAll('-', '');
  const admin = new PrismaClient();
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('schema', schema);
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  const started = Date.now();
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const migrate = spawnSync('node_modules/.bin/prisma', ['migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
    assert.equal(migrate.status, 0, 'Migración aislada');
    await seedBase(db);
    const actor = await db.usuario.findFirstOrThrow();
    const parser = new ExcelParserService();
    const parsed = parser.parse(buffer);
    for (const sheet of parsed) {
      const { examinadas, ...counts } = sheet.clasificacion;
      assert.equal(Object.values(counts).reduce((n, v) => n + v, 0), examinadas, 'Clasificación completa por hoja');
    }
    const service = new ImportacionesService(db, parser);
    const file = { buffer, size: buffer.length, originalname: 'ensayo-archivo-completo.xlsx' };
    const summary = await service.preview(file, actor.id);
    assert.equal(summary.filas, parsed.reduce((n, s) => n + s.filas.length, 0));
    assert.equal((await service.preview(file, actor.id)).importacionId, summary.importacionId);
    assert.equal(await db.importacion.count(), 1);
    const page = await service.getFilas(summary.importacionId, Object.assign(new ImportacionFilasDto(), { limit: 100 }));
    const row = page.data[0];
    const original = await db.importacionFila.findUniqueOrThrow({ where: { id: row.id } });
    await service.correctReading(summary.importacionId, row.id, actor.id, { version: row.version, cambios: { EMAIL: null }, motivo: 'Ensayo aislado de datos opcionales' });
    const after = await db.importacionFila.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual(after.datosOriginales, original.datosOriginales);
    assert.equal(after.version, 2);
    assert.equal(after.historialLectura.length, 1);
    for (const entity of ['cliente', 'suscripcion', 'renovacion', 'movimientoFinanciero']) assert.equal(await db[entity].count(), 0, entity);
    const withoutName = parsed.flatMap(s => s.filas).filter(r => !r.datosNormalizados.nombre).length;
    console.log(JSON.stringify({ resultado: 'OK', hojas: parsed.length, filas: summary.filas, filasSinNombre: withoutName, bloqueos: summary.bloqueos, milisegundos: Date.now() - started, datosOperativosCreados: 0 }));
  } finally {
    await db.$disconnect();
    assert.match(schema, /^catalogos_test_[a-f0-9]{32}$/);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch(() => { console.error('Falló el ensayo aislado de lectura. No se publican datos del archivo.'); process.exitCode = 1; });
