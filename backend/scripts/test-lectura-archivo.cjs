// Ensayo del archivo completo por stdin, siempre en un esquema temporal.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { seedBase } = require('../dist/prisma/seed');
const { ExcelParserService } = require('../dist/src/importaciones/excel-parser.service');
const { ImportacionesService } = require('../dist/src/importaciones/importaciones.service');
const { IdentidadesService } = require('../dist/src/importaciones/identidades.service');
const { EquivalenciasRevisionService } = require('../dist/src/importaciones/equivalencias-revision.service');
const { AplicacionService } = require('../dist/src/importaciones/aplicacion.service');
const { identityData } = require('../dist/src/importaciones/identity-matching');
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
    const application = new AplicacionService(db,equivalences);
    const current=await equivalences.context(db,summary.importacionId);
    const eligible=current.rows.find(r=>r.fechaInicioPropuesta && r.importeAnual>0 && r.campos.PRODUCTO.sugerencias.length===1 && r.campos.SERVIDOR.sugerencias.length===1 && !r.campos.PAGO.ignorado && r.campos.PAGO.sugerencias.length===1 && (r.campos.REFERENCIA.ausente||String(r.campos.REFERENCIA.efectivo).trim().length<=150) && current.lecturas.some(x=>x.id===r.id&&identityData(x.datosNormalizados).nombre.length>=2));
    assert.ok(eligible,'Existe una fila revisable para el ensayo aislado completo');
    const source=current.lecturas.find(r=>r.id===eligible.id);
    const idReview=await identities.list(summary.importacionId,{page:1,limit:25});
    await identities.decide(summary.importacionId,actor.id,{version:idReview.version,solicitudId:randomUUID(),filas:[source.id],accion:'NUEVO',datos:identityData(source.datosNormalizados),motivo:'Ensayo aislado; no es una carga definitiva'});
    for(const tipo of ['PRODUCTO','TARIFA','SERVIDOR','REFERENCIA','PAGO']) {
      let context=await equivalences.context(db,summary.importacionId), row=context.rows.find(r=>r.id===source.id), cell=row.campos[tipo];
      if(tipo==='REFERENCIA'&&!cell.ausente&&!cell.sugerencias.length) {
        await db.referencia.create({data:{nombre:String(cell.efectivo).trim()}});
        context=await equivalences.context(db,summary.importacionId);row=context.rows.find(r=>r.id===source.id);cell=row.campos[tipo];
      }
      if(tipo==='REFERENCIA'&&cell.ausente)continue;
      const target=tipo==='TARIFA'?context.catalogs.TARIFA.find(t=>t.productoId===row.campos.PRODUCTO.destino.id&&t.duracionMeses===12):cell.sugerencias[0];
      assert.ok(target,'Destino de ensayo disponible');
      await equivalences.decide(summary.importacionId,actor.id,{huellaRevision:context.huellaRevision,solicitudId:randomUUID(),tipo,alcance:'FILA',filaId:source.id,clave:cell.clave,accion:'ASIGNAR',entidadId:target.id,historico:tipo==='SERVIDOR'&&!target.activo,motivo:'Equivalencia del ensayo aislado'});
    }
    const ready=await application.list(summary.importacionId,{page:1,limit:25});
    const updated=(await equivalences.context(db,summary.importacionId)).rows.find(r=>r.id===source.id);
    const batch=await application.propose(summary.importacionId,actor.id,{solicitudId:randomUUID(),huellaRevision:ready.huellaRevision,filas:[{filaId:source.id,servicio:'NUEVO',finanzas:updated.finanzas==='PENDIENTE_PAGO'?'DEUDA':'COBRADO',tipoOperacion:'ALTA',servicioDistinto:false}],motivo:'Confirmación de ensayo aislado'});
    assert.equal(batch.propuesta.bloqueos.length,0,'Propuesta sin bloqueos');
    const applied=await application.confirm(summary.importacionId,batch.id,actor.id,{confirmar:true,confirmarFinanzas:true});
    assert.deepEqual(await application.confirm(summary.importacionId,batch.id,actor.id,{confirmar:true,confirmarFinanzas:true}),applied);
    for(const entity of ['cliente','suscripcion','renovacion','movimientoFinanciero'])assert.equal(await db[entity].count(),1,entity);
    assert.equal(await db.importacionFila.count({where:{clienteId:null}}),summary.filas-1);
    const finalReview=await application.list(summary.importacionId,{page:1,limit:25});
    assert.deepEqual(finalReview.resumen,{
      filas:summary.filas,clientesVinculados:1,serviciosVinculados:1,
      operacionesCreadas:1,excluidas:0,
    },'Los contadores de la interfaz coinciden con las filas materializadas');
    assert.equal(applied.estado,'APLICADO');
    assert.equal(finalReview.lotesPagination.total,1,'El reintento no duplica el lote');
    const linked=await db.importacionFila.findUniqueOrThrow({where:{id:source.id}});
    const renewal=await db.renovacion.findUniqueOrThrow({where:{id:linked.renovacionId}});
    const movement=await db.movimientoFinanciero.findUniqueOrThrow({where:{id:linked.movimientoId},include:{estado:true}});
    const proposed=batch.propuesta.filas[0];
    const paid=proposed.finanzas==='COBRADO';
    assert.equal(renewal.suscripcionId,linked.suscripcionId);
    assert.equal(movement.suscripcionId,linked.suscripcionId);
    assert.equal(movement.renovacionId,renewal.id);
    assert.equal(Number(renewal.importe),proposed.importe);
    assert.equal(Number(movement.importe),proposed.importe);
    assert.equal(movement.estado.valor,paid?'CONFIRMADO':'PENDIENTE');
    assert.equal(movement.fechaCobro?.toISOString().slice(0,10)??null,paid?proposed.fechaInicio:null);
    assert.equal(movement.fechaPrevistaCobro?.toISOString().slice(0,10)??null,paid?null:proposed.fechaInicio);
    const totals=await db.movimientoFinanciero.groupBy({by:['estadoId'],_sum:{importe:true}});
    const states=await db.estado.findMany({where:{tipo:'movimiento_estado'}});
    const totalFor=(value)=>Number(totals.find(t=>t.estadoId===states.find(s=>s.valor===value)?.id)?._sum.importe??0);
    assert.equal(totalFor('CONFIRMADO'),batch.propuesta.resumen.ingresos);
    assert.equal(totalFor('PENDIENTE'),batch.propuesta.resumen.deuda);
    const reconciliation={filasImportadas:1,filasPendientes:summary.filas-1,filasExcluidas:0,ingresos:totalFor('CONFIRMADO'),deuda:totalFor('PENDIENTE')};
    const withoutName = parsed.flatMap(s => s.filas).filter(r => !r.datosNormalizados.nombre).length;
    console.log(JSON.stringify({ resultado: 'OK', archivoSha256:createHash('sha256').update(buffer).digest('hex'), hojas: parsed.length, filas: summary.filas, filasSinNombre: withoutName, bloqueos: summary.bloqueos, identidades:review.resumen, equivalencias:inventory, filasConEquivalenciaPagoEnsayada:before.total, conciliacion:reconciliation, milisegundos: Date.now() - started, datosOperativosCreados: {clientes:1,suscripciones:1,operaciones:1,movimientos:1}, soloEnEsquemaTemporal:true }));
  } finally {
    await db.$disconnect();
    assert.match(schema, /^catalogos_test_[a-f0-9]{32}$/);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch(error => { console.error(JSON.stringify({resultado:'FALLO',tipo:error.name,codigo:error.code,ubicacion:error.stack?.split('\n').find(line=>/^\s+at main \(/.test(line))?.trim()})); process.exitCode = 1; });
