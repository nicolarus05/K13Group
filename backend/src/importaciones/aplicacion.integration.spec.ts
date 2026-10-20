import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as XLSX from 'xlsx';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { seedBase } from '../../prisma/seed';

const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)('Confirmación 12.4 aislada', () => {
  let app: INestApplication,
    db: PrismaClient,
    cookies: string[],
    serial = 0;
  const api = () => request(app.getHttpServer());
  const root = (id: string) => `/api/v1/importaciones/${id}`;
  const get = async (path: string) =>
    (await api().get(path).set('Cookie', cookies).expect(200)).body;
  const post = (path: string, body: object) => api().post(path).set('Cookie', cookies).send(body);
  const patch = (path: string, body: object) => api().patch(path).set('Cookie', cookies).send(body);
  const counts = async () =>
    Promise.all([
      db.cliente.count(),
      db.referencia.count(),
      db.suscripcion.count(),
      db.renovacion.count(),
      db.movimientoFinanciero.count(),
    ]);
  const fixture = async ({
    payment = 'STR',
    amount = 75,
    status = '',
    historical = false,
    periods = ['2026-10-17'],
    ready = true,
    group = true,
    name = `Ensayo confirmación ${++serial}`,
  } = {}) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['FECHA', 'NOMBRE', 'APP', 'SERVIDOR', 'PAGO', 'P.AÑO', 'ESTADO', 'TOTAL'],
        ...periods.map((date) => [
          date,
          name,
          'MAXPLAYER',
          historical ? 'COBRA' : 'DEAD',
          payment,
          amount,
          status,
          9999,
        ]),
      ]),
      'OCT',
    );
    const id = (
      await api()
        .post('/api/v1/importaciones/clientes/preview')
        .set('Cookie', cookies)
        .attach(
          'file',
          XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
          `lote-${++serial}.xlsx`,
        )
        .expect(201)
    ).body.data.importacionId as string;
    await post(root(id) + '/identidades/preparar', {}).expect(201);
    const raw = await db.importacionFila.findMany({
      where: { importacionId: id },
      orderBy: { filaOrigen: 'asc' },
    });
    const sets = group ? [raw] : raw.map((row) => [row]);
    for (const rows of sets) {
      const identities = await get(root(id) + '/identidades');
      await patch(root(id) + '/identidades/decidir', {
        version: identities.version,
        solicitudId: randomUUID(),
        filas: rows.map((r) => r.id),
        accion: 'NUEVO',
        datos: { nombre: name, telefono: null, email: null, observaciones: null },
        motivo: 'Identidad comprobada',
      }).expect(200);
    }
    if (ready)
      for (const tipo of ['PRODUCTO', 'TARIFA', 'SERVIDOR', 'PAGO']) {
        const review = await get(root(id) + '/equivalencias-revision');
        if (tipo === 'PAGO' && payment === 'PA') continue;
        const target = review.catalogos[tipo].find(
          (c: { nombre: string; precio: number; productoId: string }) =>
            tipo === 'TARIFA'
              ? c.productoId === review.data[0].campos.PRODUCTO.destino.id && c.precio === 75
              : c.nombre ===
                (
                  {
                    PRODUCTO: 'MAXPLAYER',
                    SERVIDOR: historical ? 'COBRA' : 'DEAD',
                    PAGO: payment === 'Gratis' ? 'Gratis' : 'Stripe',
                  } as Record<string, string>
                )[tipo],
        );
        await patch(root(id) + '/equivalencias-revision', {
          huellaRevision: review.huellaRevision,
          solicitudId: randomUUID(),
          tipo,
          alcance: 'VALOR',
          clave: review.data[0].campos[tipo].clave,
          accion: 'ASIGNAR',
          entidadId: target.id,
          historico: tipo === 'SERVIDOR' && historical,
          motivo: 'Equivalencia comprobada',
        }).expect(200);
      }
    return { id, rows: raw };
  };
  const propose = async (id: string, filas: object[]) => {
    const r = await get(root(id) + '/aplicacion');
    return (
      await post(root(id) + '/lotes', {
        huellaRevision: r.huellaRevision,
        solicitudId: randomUUID(),
        filas,
        motivo: 'Lote comprobado',
      }).expect(201)
    ).body;
  };
  const confirm = (id: string, batch: string, finances = true) =>
    post(root(id) + `/lotes/${batch}/confirmar`, { confirmar: true, confirmarFinanzas: finances });
  const choice = (filaId: string, finanzas = 'NINGUNA', extra: object = {}) => ({
    filaId,
    servicio: 'NUEVO',
    finanzas,
    ...(finanzas === 'NINGUNA' ? {} : { tipoOperacion: 'ALTA' }),
    ...extra,
  });
  beforeAll(async () => {
    if (!/^catalogos_test_[a-f0-9]{32}$/.test(new URL(isolated!).searchParams.get('schema') ?? ''))
      throw Error('Requiere esquema aislado');
    db = new PrismaClient({ datasourceUrl: isolated });
    await seedBase(db);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    cookies = (
      (
        await api()
          .post('/api/v1/auth/login')
          .send({ username: 'admin', password: 'admin1234' })
          .expect(200)
      ).headers['set-cookie'] as unknown as string[]
    ).map((c) => c.split(';')[0]);
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });
  it('exige autenticación y valida selección única, límites y confirmación expresa', async () => {
    await api()
      .get(root(randomUUID()) + '/aplicacion')
      .expect(401);
    const f = await fixture({ ready: false }),
      r = await get(root(f.id) + '/aplicacion');
    const body = {
      huellaRevision: r.huellaRevision,
      solicitudId: randomUUID(),
      motivo: 'Prueba',
      filas: [choice(f.rows[0].id), choice(f.rows[0].id)],
    };
    await post(root(f.id) + '/lotes', body).expect(400);
    await post(root(f.id) + '/lotes', { ...body, filas: [] }).expect(400);
    await post(root(f.id) + '/lotes', {
      ...body,
      filas: Array.from({ length: 501 }, () => choice(randomUUID())),
    }).expect(400);
    await post(root(f.id) + `/lotes/${randomUUID()}/confirmar`, {
      confirmar: false,
      confirmarFinanzas: false,
    }).expect(400);
  });
  it('importa solo el cliente con opcionales vacíos y referencia propia; protege identidad y conserva pendientes', async () => {
    const f = await fixture({ ready: false }),
      before = await counts();
    const batch = await propose(f.id, [choice(f.rows[0].id, 'NINGUNA', { servicio: 'NINGUNO' })]);
    expect(batch.propuesta.bloqueos).toEqual([]);
    expect(await counts()).toEqual(before);
    const applied = (await confirm(f.id, batch.id, false).expect(201)).body;
    const client = await db.cliente.findUniqueOrThrow({
      where: { id: applied.resultado.filas[0].clienteId },
      include: { estado: true },
    });
    expect(client).toMatchObject({
      telefono: null,
      email: null,
      observaciones: null,
      estado: { valor: 'ACTIVO' },
    });
    expect(applied.resultado).toMatchObject({
      clientesNuevos: 1,
      referenciasNuevas: 1,
      suscripcionesNuevas: 0,
      operaciones: 0,
      movimientos: 0,
    });
    expect((await get(root(f.id) + '/aplicacion')).data[0].identidad).toBe('VINCULADO');
    const identities = await get(root(f.id) + '/identidades');
    await patch(root(f.id) + '/identidades/decidir', {
      version: identities.version,
      solicitudId: randomUUID(),
      filas: [f.rows[0].id],
      accion: 'EXCLUIR',
      motivo: 'No debe poder cambiar',
    }).expect(409);
    await patch(root(f.id) + `/filas/${f.rows[0].id}/lectura`, {
      version: 2,
      cambios: { NOMBRE: 'Otro cliente' },
      motivo: 'No debe poder cambiar',
    }).expect(409);
    await patch(root(f.id) + `/filas/${f.rows[0].id}/lectura`, {
      version: 2,
      cambios: { PANO: '80' },
      motivo: 'Importe todavía pendiente',
    }).expect(200);
  });
  it('confirma cobro por P.AÑO y no por TOTAL, con historial y reintentos concurrentes sin duplicados', async () => {
    const f = await fixture(),
      batch = await propose(f.id, [choice(f.rows[0].id, 'COBRADO')]);
    expect(batch.propuesta.bloqueos).toEqual([]);
    expect(batch.propuesta.resumen.ingresos).toBe(75);
    await confirm(f.id, batch.id, false).expect(400);
    const responses = await Promise.all([
      confirm(f.id, batch.id).expect(201),
      confirm(f.id, batch.id).expect(201),
    ]);
    expect(responses[0].body).toEqual(responses[1].body);
    const result = responses[0].body.resultado;
    expect(result).toMatchObject({
      clientesNuevos: 1,
      referenciasNuevas: 1,
      suscripcionesNuevas: 1,
      operaciones: 1,
      movimientos: 1,
    });
    const movement = await db.movimientoFinanciero.findUniqueOrThrow({
      where: { id: result.filas[0].movimientoId },
      include: { estado: true },
    });
    expect(Number(movement.importe)).toBe(75);
    expect(movement.estado.valor).toBe('CONFIRMADO');
    expect(movement.fechaCobro?.toISOString().slice(0, 10)).toBe('2025-10-17');
    expect(await db.actividad.count({ where: { registroId: f.id, accion: 'APLICAR_LOTE' } })).toBe(
      1,
    );
    const summary = (await get(root(f.id))).data;
    expect(summary).toMatchObject({ movimientosCreados: 1, filasPendientesReconciliacion: 0 });
    const listing = await get('/api/v1/importaciones');
    expect(
      listing.data.find((r: { importacionId: string }) => r.importacionId === f.id),
    ).toMatchObject({ movimientosCreados: 1, filasPendientesReconciliacion: 0 });

    const before = await counts();
    await confirm(f.id, batch.id).expect(201);
    expect(await counts()).toEqual(before);
    expect((await get(root(f.id) + '/aplicacion')).lotes[0].resultado).toEqual(result);
  });
  it('PE nunca permite cobro; deuda histórica no reactiva COBRA ni permite renovar o editar el servicio', async () => {
    const f = await fixture({ status: 'PE', historical: true });
    const wrong = await propose(f.id, [choice(f.rows[0].id, 'COBRADO')]);
    expect(wrong.propuesta.bloqueos.length).toBeGreaterThan(0);
    await confirm(f.id, wrong.id).expect(409);
    const batch = await propose(f.id, [choice(f.rows[0].id, 'DEUDA')]);
    expect(batch.propuesta.bloqueos).toEqual([]);
    const result = (await confirm(f.id, batch.id).expect(201)).body.resultado;
    const row = result.filas[0],
      sub = await db.suscripcion.findUniqueOrThrow({
        where: { id: row.suscripcionId },
        include: { estado: true, servidor: true },
      });
    expect(sub.estado.valor).toBe('HISTORICA');
    expect(sub.servidor.activo).toBe(false);
    const movement = await db.movimientoFinanciero.findUniqueOrThrow({
      where: { id: row.movimientoId },
      include: { estado: true },
    });
    expect(movement.estado.valor).toBe('PENDIENTE');
    expect(movement.fechaCobro).toBeNull();
    await api()
      .put(`/api/v1/suscripciones/${sub.id}`)
      .set('Cookie', cookies)
      .send({
        version: sub.version,
        tipoDispositivo: 'Intento de cambio',
      })
      .expect(409);
    expect(await db.recordatorio.count({ where: { suscripcionId: sub.id } })).toBe(0);
    await post(`/api/v1/suscripciones/${sub.id}/renovar`, {
      version: sub.version,
      solicitudId: randomUUID(),
      importe: '75',
      metodoPagoId: movement.metodoPagoId,
      cobro: 'PENDIENTE',
    }).expect(409);
    await post(`/api/v1/renovaciones/${row.renovacionId}/cobrar`, {
      version: 1,
      metodoPagoId: movement.metodoPagoId,
      fechaCobro: '2026-10-17',
    }).expect(201);
    const collected = await db.movimientoFinanciero.findUniqueOrThrow({
      where: { id: row.movimientoId },
      include: { estado: true },
    });
    expect(collected.estado.valor).toBe('CONFIRMADO');
    expect((await db.suscripcion.findUniqueOrThrow({ where: { id: sub.id } })).fechaFin).toEqual(
      sub.fechaFin,
    );
  });
  it('Gratis crea una operación de importe cero sin movimiento y PA se queda pendiente', async () => {
    const f = await fixture({ payment: 'Gratis', amount: 0 });
    const b = await propose(f.id, [choice(f.rows[0].id, 'GRATIS')]);
    expect(b.propuesta.bloqueos).toEqual([]);
    const result = (await confirm(f.id, b.id).expect(201)).body.resultado;
    expect(result).toMatchObject({ operaciones: 1, movimientos: 0 });
    const pa = await fixture({ payment: 'PA' }),
      pending = await propose(pa.id, [choice(pa.rows[0].id, 'COBRADO')]);
    expect(pending.propuesta.bloqueos.length).toBeGreaterThan(0);
    const service = await propose(pa.id, [choice(pa.rows[0].id)]);
    expect(service.propuesta.bloqueos).toEqual([]);
    expect((await confirm(pa.id, service.id).expect(201)).body.resultado.movimientos).toBe(0);
  });
  it('separa servicio y finanzas, conserva referencia propia personalizada y bloquea modificaciones ya aplicadas', async () => {
    const f = await fixture();
    const b = await propose(f.id, [
      choice(f.rows[0].id, 'NINGUNA', { referenciaPropia: `Referencia propia ${serial}` }),
    ]);
    const first = (await confirm(f.id, b.id).expect(201)).body.resultado;
    await patch(root(f.id) + `/filas/${f.rows[0].id}/lectura`, {
      version: 2,
      cambios: { FECHA: '2026-01-01' },
      motivo: 'No debe cambiar el periodo',
    }).expect(409);
    const eq = await get(root(f.id) + '/equivalencias-revision');
    await patch(root(f.id) + '/equivalencias-revision', {
      huellaRevision: eq.huellaRevision,
      solicitudId: randomUUID(),
      tipo: 'PRODUCTO',
      alcance: 'VALOR',
      clave: eq.data[0].campos.PRODUCTO.clave,
      accion: 'PENDIENTE',
      motivo: 'No debe cambiar el producto',
    }).expect(409);
    const finance = await propose(f.id, [
      choice(f.rows[0].id, 'COBRADO', { servicio: 'CONSERVAR' }),
    ]);
    expect(finance.propuesta.bloqueos).toEqual([]);
    const result = (await confirm(f.id, finance.id).expect(201)).body.resultado;
    expect(result).toMatchObject({
      clientesNuevos: 0,
      referenciasNuevas: 0,
      suscripcionesNuevas: 0,
      operaciones: 1,
      movimientos: 1,
    });
    expect(result.filas[0].suscripcionId).toBe(first.filas[0].suscripcionId);
    await patch(root(f.id) + `/filas/${f.rows[0].id}/lectura`, {
      version: 3,
      cambios: { PANO: '100' },
      motivo: 'No debe cambiar cobro',
    }).expect(409);
    const duplicate = await propose(f.id, [
      choice(f.rows[0].id, 'COBRADO', { servicio: 'CONSERVAR' }),
    ]);
    expect(duplicate.propuesta.bloqueos.length).toBeGreaterThan(0);
  });
  it('agrupa explícitamente periodos consecutivos con un cliente y un servicio; rechaza solapes y altas posteriores', async () => {
    const f = await fixture({ periods: ['2025-10-17', '2026-10-17'] }),
      group = randomUUID();
    const invalid = await propose(
      f.id,
      f.rows.map((r) => choice(r.id, 'COBRADO', { grupoId: group })),
    );
    expect(invalid.propuesta.bloqueos.length).toBeGreaterThan(0);
    const b = await propose(
      f.id,
      f.rows.map((r, i) =>
        choice(r.id, 'COBRADO', { grupoId: group, tipoOperacion: i ? 'RENOVACION' : 'ALTA' }),
      ),
    );
    expect(b.propuesta.bloqueos).toEqual([]);
    const result = (await confirm(f.id, b.id).expect(201)).body.resultado;
    expect(result).toMatchObject({
      clientesNuevos: 1,
      suscripcionesNuevas: 1,
      operaciones: 2,
      movimientos: 2,
    });
    expect(new Set(result.filas.map((r: { suscripcionId: string }) => r.suscripcionId)).size).toBe(
      1,
    );
    const overlap = await fixture({ periods: ['2026-10-17', '2026-11-17'] }),
      g = randomUUID();
    const bad = await propose(
      overlap.id,
      overlap.rows.map((r) => choice(r.id, 'NINGUNA', { grupoId: g })),
    );
    expect(bad.propuesta.bloqueos.length).toBeGreaterThan(0);
  });
  it('rechaza propuesta desactualizada sin escrituras de negocio y exige una propuesta nueva', async () => {
    const f = await fixture(),
      b = await propose(f.id, [choice(f.rows[0].id)]),
      before = await counts();
    await patch(root(f.id) + `/filas/${f.rows[0].id}/lectura`, {
      version: 1,
      cambios: { PANO: '80' },
      motivo: 'Cambio posterior a propuesta',
    }).expect(200);
    await confirm(f.id, b.id).expect(409);
    expect(await counts()).toEqual(before);
    expect((await db.importacionLote.findUniqueOrThrow({ where: { id: b.id } })).estado).toBe(
      'FALLIDO',
    );
  });
  it('revierte todo el lote si falla la auditoría final y permite reintentar sin duplicados', async () => {
    const f = await fixture(),
      b = await propose(f.id, [choice(f.rows[0].id, 'COBRADO')]),
      before = await counts();
    await db.$executeRawUnsafe(
      "ALTER TABLE actividad ADD CONSTRAINT ensayo_aplicacion CHECK (accion <> 'APLICAR_LOTE') NOT VALID",
    );
    try {
      await confirm(f.id, b.id).expect(500);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT ensayo_aplicacion');
    }
    expect(await counts()).toEqual(before);
    expect(
      (await db.importacionFila.findUniqueOrThrow({ where: { id: f.rows[0].id } })).clienteId,
    ).toBeNull();
    expect((await confirm(f.id, b.id).expect(201)).body.resultado.clientesNuevos).toBe(1);
  });
  it('no mezcla identidades por nombre y exige resolver referencias propias coincidentes', async () => {
    const f = await fixture({ periods: ['2025-10-17', '2026-10-17'], group: false });
    const b = await propose(
      f.id,
      f.rows.map((r) => choice(r.id, 'NINGUNA', { servicio: 'NINGUNO' })),
    );
    expect(b.propuesta.bloqueos.length).toBeGreaterThan(0);
    const fixed = await propose(
      f.id,
      f.rows.map((r, i) =>
        choice(r.id, 'NINGUNA', {
          servicio: 'NINGUNO',
          referenciaPropia: `Referencia ${serial} ${i}`,
        }),
      ),
    );
    expect(fixed.propuesta.bloqueos).toEqual([]);
    expect((await confirm(f.id, fixed.id).expect(201)).body.resultado.clientesNuevos).toBe(2);
  });
  it('reanuda finanzas tras revisar un cliente editado sin permitir cambiar su identidad', async () => {
    const f = await fixture(),
      b = await propose(f.id, [choice(f.rows[0].id)]);
    const result = (await confirm(f.id, b.id).expect(201)).body.resultado;
    const clientId = result.filas[0].clienteId;
    await db.cliente.update({
      where: { id: clientId },
      data: { observaciones: 'Dato actualizado' },
    });
    expect((await get(root(f.id) + '/aplicacion')).data[0].identidad).toBe('REVISAR');
    const identities = await get(root(f.id) + '/identidades'),
      target = identities.data[0].clienteDestino;
    await patch(root(f.id) + '/identidades/decidir', {
      version: identities.version,
      solicitudId: randomUUID(),
      filas: [f.rows[0].id],
      accion: 'VINCULAR',
      clienteDestinoId: target.id,
      huellaCliente: target.huella,
      motivo: 'Mismo cliente revisado',
    }).expect(200);
    const next = await propose(f.id, [choice(f.rows[0].id, 'COBRADO', { servicio: 'CONSERVAR' })]);
    expect(next.propuesta.bloqueos).toEqual([]);
    expect((await confirm(f.id, next.id).expect(201)).body.resultado.clientesNuevos).toBe(0);
  });
  it('bloquea periodos ya importados desde otro análisis y vincula periodos nuevos sin duplicar el cliente', async () => {
    const first = await fixture(),
      b = await propose(first.id, [choice(first.rows[0].id)]);
    const saved = (await confirm(first.id, b.id).expect(201)).body.resultado.filas[0];
    const f = await fixture({ periods: ['2026-10-17', '2025-10-17'], group: false });
    for (const row of f.rows) {
      const ids = await get(root(f.id) + '/identidades');
      const clients = await get(root(f.id) + '/identidades/clientes?limit=50');
      const target = clients.data.find((c: { id: string }) => c.id === saved.clienteId);
      await patch(root(f.id) + '/identidades/decidir', {
        version: ids.version,
        solicitudId: randomUUID(),
        filas: [row.id],
        accion: 'VINCULAR',
        clienteDestinoId: target.id,
        huellaCliente: target.huella,
        motivo: 'Cliente existente revisado',
      }).expect(200);
    }
    const duplicate = await propose(f.id, [
      choice(f.rows[0].id, 'NINGUNA', { servicio: 'VINCULAR', suscripcionId: saved.suscripcionId }),
    ]);
    expect(duplicate.propuesta.bloqueos.length).toBeGreaterThan(0);
    const accidental = await propose(f.id, [choice(f.rows[0].id)]);
    expect(accidental.propuesta.bloqueos.length).toBeGreaterThan(0);
    const valid = await propose(f.id, [
      choice(f.rows[1].id, 'COBRADO', { servicio: 'VINCULAR', suscripcionId: saved.suscripcionId }),
    ]);
    expect(valid.propuesta.bloqueos).toEqual([]);
    const applied = (await confirm(f.id, valid.id).expect(201)).body.resultado;
    expect(applied).toMatchObject({ clientesNuevos: 0, suscripcionesNuevas: 0, operaciones: 1 });
    expect(applied.filas[0].suscripcionId).toBe(saved.suscripcionId);
  });
  it('materializa todas las identidades vinculadas al mismo cliente sin duplicar su referencia', async () => {
    const base = await fixture({ ready: false });
    const initial = await propose(base.id, [
      choice(base.rows[0].id, 'NINGUNA', {
        servicio: 'NINGUNO',
        referenciaPropia: `Propia personalizada ${serial}`,
      }),
    ]);
    const targetId = (await confirm(base.id, initial.id).expect(201)).body.resultado.filas[0]
      .clienteId;
    const f = await fixture({ periods: ['2025-10-17', '2026-10-17'], group: false });
    for (const row of f.rows) {
      const ids = await get(root(f.id) + '/identidades'),
        clients = await get(root(f.id) + '/identidades/clientes?limit=50');
      const target = clients.data.find((c: { id: string }) => c.id === targetId);
      await patch(root(f.id) + '/identidades/decidir', {
        version: ids.version,
        solicitudId: randomUUID(),
        filas: [row.id],
        accion: 'VINCULAR',
        clienteDestinoId: target.id,
        huellaCliente: target.huella,
        motivo: 'Cliente compartido revisado',
      }).expect(200);
    }
    const groupId = randomUUID(),
      batch = await propose(
        f.id,
        f.rows.map((r) => choice(r.id, 'NINGUNA', { grupoId: groupId })),
      );
    expect(batch.propuesta.bloqueos).toEqual([]);
    expect((await confirm(f.id, batch.id).expect(201)).body.resultado).toMatchObject({
      clientesNuevos: 0,
      referenciasNuevas: 0,
      suscripcionesNuevas: 1,
    });
    expect(
      await db.importacionIdentidad.count({ where: { importacionId: f.id, materializada: true } }),
    ).toBe(2);
  });
  it('regresión: solo cliente no representa un servicio duplicado dentro del lote', async () => {
    const f = await fixture({ periods: ['2026-10-17', '2026-10-17'] });
    const batch = await propose(f.id, [
      choice(f.rows[0].id, 'NINGUNA', { servicio: 'NINGUNO' }),
      choice(f.rows[1].id),
    ]);
    expect(batch.propuesta.bloqueos).toEqual([]);
    expect((await confirm(f.id, batch.id).expect(201)).body.resultado).toMatchObject({
      clientesNuevos: 1,
      suscripcionesNuevas: 1,
      operaciones: 0,
    });
  });
  it('regresión: completar finanzas conserva fechas y versión del servicio corregido posteriormente', async () => {
    const f = await fixture(),
      batch = await propose(f.id, [choice(f.rows[0].id)]);
    const subId = (await confirm(f.id, batch.id).expect(201)).body.resultado.filas[0].suscripcionId;
    const sub = await db.suscripcion.findUniqueOrThrow({ where: { id: subId } });
    await api()
      .put(`/api/v1/suscripciones/${subId}`)
      .set('Cookie', cookies)
      .send({
        version: sub.version,
        fechaInicio: '2024-10-17',
        motivoCorreccion: 'Corrección posterior revisada',
      })
      .expect(200);
    const corrected = await db.suscripcion.findUniqueOrThrow({ where: { id: subId } });
    const finance = await propose(f.id, [
      choice(f.rows[0].id, 'COBRADO', { servicio: 'CONSERVAR', tipoOperacion: 'RENOVACION' }),
    ]);
    expect(finance.propuesta.bloqueos).toEqual([]);
    await confirm(f.id, finance.id).expect(201);
    expect(await db.suscripcion.findUniqueOrThrow({ where: { id: subId } })).toEqual(corrected);
  });
  it.each(['suspender', 'cancelar'])(
    'regresión: completar contabilidad tras %s conserva el servicio',
    async (action) => {
      const f = await fixture(),
        batch = await propose(f.id, [choice(f.rows[0].id)]);
      const subId = (await confirm(f.id, batch.id).expect(201)).body.resultado.filas[0]
        .suscripcionId;
      const sub = await db.suscripcion.findUniqueOrThrow({ where: { id: subId } });
      await post(`/api/v1/suscripciones/${subId}/${action}`, {
        version: sub.version,
        motivo: 'Suspensión revisada',
      }).expect(201);
      const suspended = await db.suscripcion.findUniqueOrThrow({ where: { id: subId } });
      const finance = await propose(f.id, [
        choice(f.rows[0].id, 'DEUDA', { servicio: 'CONSERVAR' }),
      ]);
      // El origen no es PE: se conserva el bloqueo financiero, sin exigir reactivación.
      expect(
        finance.propuesta.bloqueos.flatMap((b: { motivos: string[] }) => b.motivos),
      ).not.toContain('El estado del destino requiere revisión desde Suscripciones.');
      const paid = await propose(f.id, [
        choice(f.rows[0].id, 'COBRADO', { servicio: 'CONSERVAR' }),
      ]);
      expect(paid.propuesta.bloqueos).toEqual([]);
      await confirm(f.id, paid.id).expect(201);
      expect(await db.suscripcion.findUniqueOrThrow({ where: { id: subId } })).toEqual(suspended);
    },
  );
  it('regresión: la propuesta financiera conserva el método de pago revisado', async () => {
    const f = await fixture(),
      batch = await propose(f.id, [choice(f.rows[0].id, 'COBRADO')]);
    expect(batch.propuesta.filas[0].metodoPago).toBe('Stripe');
  });
  it('regresión: una fila nula es una petición inválida, no un error interno', async () => {
    const f = await fixture({ ready: false }),
      r = await get(root(f.id) + '/aplicacion');
    await post(root(f.id) + '/lotes', {
      huellaRevision: r.huellaRevision,
      solicitudId: randomUUID(),
      filas: [null],
      motivo: 'Entrada inválida',
    }).expect(400);
  });
  it('regresión: un periodo posterior no puede ser alta si ya se importó un periodo anterior sin finanzas', async () => {
    const f = await fixture({ periods: ['2025-10-17', '2026-10-17'] }),
      batch = await propose(f.id, [choice(f.rows[0].id)]);
    const subId = (await confirm(f.id, batch.id).expect(201)).body.resultado.filas[0].suscripcionId;
    const later = await propose(f.id, [
      choice(f.rows[1].id, 'COBRADO', { servicio: 'VINCULAR', suscripcionId: subId }),
    ]);
    expect(later.propuesta.bloqueos.length).toBeGreaterThan(0);
    const renewal = await propose(f.id, [
      choice(f.rows[1].id, 'COBRADO', {
        servicio: 'VINCULAR',
        suscripcionId: subId,
        tipoOperacion: 'RENOVACION',
      }),
    ]);
    expect(renewal.propuesta.bloqueos).toEqual([]);
    await confirm(f.id, renewal.id).expect(201);
  });
  it('regresión: completar finanzas de un cliente inactivo no reactiva ni modifica su servicio', async () => {
    const f = await fixture(),
      batch = await propose(f.id, [choice(f.rows[0].id)]);
    const link = (await confirm(f.id, batch.id).expect(201)).body.resultado.filas[0];
    const inactive = await db.estado.findFirstOrThrow({
      where: { tipo: 'cliente', valor: 'INACTIVO' },
    });
    await db.cliente.update({ where: { id: link.clienteId }, data: { estadoId: inactive.id } });
    const review = await get(root(f.id) + '/identidades'),
      target = review.data[0].clienteDestino;
    await patch(root(f.id) + '/identidades/decidir', {
      version: review.version,
      solicitudId: randomUUID(),
      filas: [f.rows[0].id],
      accion: 'VINCULAR',
      clienteDestinoId: target.id,
      huellaCliente: target.huella,
      motivo: 'Cliente inactivo revisado',
    }).expect(200);
    const before = await db.suscripcion.findUniqueOrThrow({ where: { id: link.suscripcionId } });
    const paid = await propose(f.id, [choice(f.rows[0].id, 'COBRADO', { servicio: 'CONSERVAR' })]);
    expect(paid.propuesta.bloqueos).toEqual([]);
    await confirm(f.id, paid.id).expect(201);
    expect(await db.suscripcion.findUniqueOrThrow({ where: { id: link.suscripcionId } })).toEqual(
      before,
    );
    expect((await db.cliente.findUniqueOrThrow({ where: { id: link.clienteId } })).estadoId).toBe(
      inactive.id,
    );
  });
  it('regresión: permite recuperar lotes anteriores a los últimos cincuenta', async () => {
    const f = await fixture({ ready: false }),
      actor = await db.usuario.findFirstOrThrow();
    const ids = Array.from({ length: 51 }, () => randomUUID());
    await db.importacionLote.createMany({
      data: ids.map((id, i) => ({
        id,
        importacionId: f.id,
        autor: actor.id,
        solicitudId: randomUUID(),
        solicitudHash: 'a'.repeat(64),
        huella: 'b'.repeat(64),
        seleccion: {},
        propuesta: {},
        motivo: 'Ensayo aislado de paginación',
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
      })),
    });
    const first = await get(root(f.id) + '/aplicacion'),
      second = await get(root(f.id) + '/aplicacion?lotesPage=2');
    expect(first.lotes).toHaveLength(50);
    expect(second.lotes).toHaveLength(1);
    expect(second.lotes[0].id).toBe(ids[0]);
    expect(second.lotesPagination).toEqual({ page: 2, total: 51, totalPages: 2 });
    await api()
      .get(root(f.id) + '/aplicacion?lotesPage=0')
      .set('Cookie', cookies)
      .expect(400);
  });
});
