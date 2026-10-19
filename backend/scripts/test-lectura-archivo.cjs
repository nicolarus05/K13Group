// Ensayo del archivo completo por stdin, siempre en un esquema temporal.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { seedBase } = require('../dist/prisma/seed');
const { ExcelParserService } = require('../dist/src/importaciones/excel-parser.service');
const { ImportacionesService } = require('../dist/src/importaciones/importaciones.service');
const { IdentidadesService } = require('../dist/src/importaciones/identidades.service');
const { EquivalenciasRevisionService } = require('../dist/src/importaciones/equivalencias-revision.service');
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
    const identities = new IdentidadesService(db);
    await identities.prepare(summary.importacionId, actor.id);
    const review = await identities.list(summary.importacionId, {page:1,limit:25});
    assert.equal(review.version, 1);
    assert.equal(Object.values(review.resumen).reduce((n,v)=>n+v,0), summary.filas);
    assert.equal(await db.importacionFila.count({where:{importacionId:summary.importacionId,identidadId:null}}), 0);
    await identities.prepare(summary.importacionId, actor.id);
    assert.equal(await db.importacionIdentidad.count({where:{importacionId:summary.importacionId}}), summary.filas);
    const equivalences = new EquivalenciasRevisionService(db, identities);
    const inventory = {};
    for(const tipo of ['PRODUCTO','TARIFA','SERVIDOR','REFERENCIA','PAGO']) {
      const result = await equivalences.list(summary.importacionId, {tipo,page:1,limit:25});
      assert.equal(result.resumen.filas, summary.filas);
      assert.equal(result.inventario.reduce((n,g)=>n+g.total,0),summary.filas);
      inventory[tipo] = {grupos:result.inventario.length, filas:result.pagination.total};
    }
    const payments = await equivalences.list(summary.importacionId, {tipo:'PAGO',page:1,limit:25});
    const candidate = payments.data.find(r=>!r.campos.PAGO.ignorado&&!r.campos.PAGO.ausente&&r.campos.PAGO.sugerencias.length===1);
    assert.ok(candidate, 'Hay al menos un método con sugerencia para ensayar');
    const dto={huellaRevision:payments.huellaRevision,solicitudId:randomUUID(),tipo:'PAGO',alcance:'VALOR',clave:candidate.campos.PAGO.clave,accion:'ASIGNAR',entidadId:candidate.campos.PAGO.sugerencias[0].id,historico:false,motivo:'Ensayo aislado de equivalencia'};
    const before=await equivalences.preview(summary.importacionId,dto);
    assert.ok(before.total>0);
    const decision=await equivalences.decide(summary.importacionId,actor.id,dto);
    assert.deepEqual(await equivalences.decide(summary.importacionId,actor.id,dto),decision);
    const resumed=await equivalences.list(summary.importacionId,{tipo:'PAGO',page:1,limit:25});
    assert.equal(resumed.version,1);
    assert.equal(resumed.resumen.pendientesPago,payments.resumen.pendientesPago);
    for (const entity of ['cliente', 'suscripcion', 'renovacion', 'movimientoFinanciero']) assert.equal(await db[entity].count(), 0, entity);
    const withoutName = parsed.flatMap(s => s.filas).filter(r => !r.datosNormalizados.nombre).length;
    console.log(JSON.stringify({ resultado: 'OK', hojas: parsed.length, filas: summary.filas, filasSinNombre: withoutName, bloqueos: summary.bloqueos, identidades:review.resumen, equivalencias:inventory, filasEnsayadas:before.total, milisegundos: Date.now() - started, datosOperativosCreados: 0 }));
  } finally {
    await db.$disconnect();
    assert.match(schema, /^catalogos_test_[a-f0-9]{32}$/);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch(() => { console.error('Falló el ensayo aislado de lectura. No se publican datos del archivo.'); process.exitCode = 1; });
