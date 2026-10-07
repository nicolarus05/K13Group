import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { seedBase } from '../../prisma/seed';
import * as dates from '../suscripciones/subscription-dates';

const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)('Sprint 7: finanzas en PostgreSQL aislado', () => {
  let db: PrismaClient, app: INestApplication, cookie: string, method: string, category: string;
  let clock: jest.SpyInstance;
  let states: Record<string, string>;
  const api = () => request(app.getHttpServer());
  const input = (extra = {}) => ({
    concepto: 'Hosting ficticio',
    importe: '25.10',
    fecha: '2026-09-25',
    categoriaGastoId: category,
    metodoPagoId: method,
    observaciones: 'Prueba aislada',
    ...extra,
  });
  const create = async (extra = {}) =>
    (
      await api()
        .post('/api/v1/finanzas/gasto')
        .set('Cookie', cookie)
        .send({ ...input(extra), solicitudId: randomUUID() })
        .expect(201)
    ).body.data;
  const balance = async (query = {}) =>
    (await api().get('/api/v1/finanzas/balance').set('Cookie', cookie).query(query).expect(200))
      .body.data;
  const income = (amount: string, state = 'CONFIRMADO', fecha = '2026-09-25T00:00:00Z') =>
    db.movimientoFinanciero.create({
      data: {
        tipoId: states.INGRESO,
        estadoId: states[state],
        importe: amount,
        fecha: new Date(fecha),
        origen: 'IMPORTACION_EXCEL',
        descripcion: 'Ingreso histórico de prueba',
      },
    });
  beforeAll(async () => {
    if (
      !isolated ||
      !/^catalogos_test_[a-f0-9]{32}$/.test(new URL(isolated).searchParams.get('schema') ?? '')
    )
      throw new Error('Esquema no aislado');
    db = new PrismaClient({ datasourceUrl: isolated });
    await seedBase(db);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    const user = await db.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
    cookie =
      'access_token=' +
      new JwtService().sign({ sub: user.id, sid: (await db.sesion.create({ data: { usuarioId: user.id, token: 'fixture-access-only', expiresAt: new Date(Date.now() + 3600000) } })).id }, { secret: process.env.JWT_SECRET, expiresIn: '30m' });
    method = (await db.metodoPago.create({ data: { nombre: 'Efectivo finanzas' } })).id;
    category = (await db.categoriaGasto.create({ data: { nombre: 'Hosting finanzas' } })).id;
    states = Object.fromEntries(
      (
        await db.estado.findMany({
          where: { tipo: { in: ['movimiento_tipo', 'movimiento_estado'] } },
        })
      ).map((s) => [s.valor, s.id]),
    );
  }, 30000);
  beforeEach(async () => {
    clock = jest.spyOn(dates, 'businessDay').mockReturnValue('2026-09-25');
    await db.recordatorio.deleteMany();
    await db.movimientoFinanciero.deleteMany();
    await db.renovacion.deleteMany();
    await db.suscripcion.deleteMany();
    await db.actividad.deleteMany();
  });
  afterEach(() => clock.mockRestore());
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  it('exige sesión en consultas y escrituras; no ofrece ingresos manuales', async () => {
    for (const path of ['', '/balance', '/' + randomUUID(), '/' + randomUUID() + '/historial'])
      await api()
        .get('/api/v1/finanzas' + path)
        .expect(401);
    await api().post('/api/v1/finanzas/gasto').send(input()).expect(401);
    await api()
      .put('/api/v1/finanzas/' + randomUUID())
      .send(input())
      .expect(401);
    await api()
      .post('/api/v1/finanzas/' + randomUUID() + '/anular')
      .send({})
      .expect(401);
    await api().post('/api/v1/finanzas/ingreso').set('Cookie', cookie).send(input()).expect(404);
  });
  it('crea gasto confirmado con snapshots, sin suscripción ni comisión, y audita', async () => {
    const row = await create();
    expect(row.estado.valor).toBe('CONFIRMADO');
    expect(row.tipo.valor).toBe('GASTO');
    expect(row.fechaCobro.slice(0, 10)).toBe('2026-09-25');
    expect(row.suscripcionId).toBeNull();
    expect(row.categoriaNombreSnapshot).toBe('Hosting finanzas');
    expect(row.metodoPagoNombreSnapshot).toBe('Efectivo finanzas');
    expect(row).not.toHaveProperty('solicitudHash');
    expect(await db.actividad.count({ where: { registroId: row.id, accion: 'CREAR' } })).toBe(1);
    expect((await balance()).gastos).toBe('25.10');
  });
  it('reintentos y doble clic crean solo un gasto; clave reutilizada con otros datos da 409', async () => {
    const dto = { ...input(), solicitudId: randomUUID() };
    const rows = await Promise.all(
      [1, 2].map(() =>
        api().post('/api/v1/finanzas/gasto').set('Cookie', cookie).send(dto).expect(201),
      ),
    );
    expect(rows[0].body.data.id).toBe(rows[1].body.data.id);
    await api()
      .post('/api/v1/finanzas/gasto')
      .set('Cookie', cookie)
      .send({ ...dto, importe: '1.00' })
      .expect(409);
    expect(await db.movimientoFinanciero.count()).toBe(1);
    expect(await db.actividad.count()).toBe(1);
  });
  it('rechaza ceros, negativos, precisión extra, fechas futuras/imposibles y asignación masiva', async () => {
    for (const invalid of [
      { importe: '0' },
      { importe: '-2' },
      { importe: '1.001' },
      { importe: '1e2' },
      { importe: '100000000' },
      { importe: 25 },
      { concepto: '   ' },
      { fecha: '2026-02-30' },
      { fecha: '2026-09-26' },
      { estadoId: states.PENDIENTE },
      { suscripcionId: randomUUID() },
      { concepto: null },
      { fecha: null },
    ])
      await api()
        .post('/api/v1/finanzas/gasto')
        .set('Cookie', cookie)
        .send({ ...input(invalid), solicitudId: randomUUID() })
        .expect(400);
    expect(await db.movimientoFinanciero.count()).toBe(0);
  });
  it('rechaza categorías/métodos inactivos, gratuitos y desconocidos', async () => {
    const cat = await db.categoriaGasto.create({
      data: { nombre: 'Categoría inactiva', activo: false },
    });
    const inactive = await db.metodoPago.create({
      data: { nombre: 'Método inactivo', activo: false },
    });
    const free = await db.metodoPago.create({
      data: { nombre: 'Gratis finanzas', esGratuito: true },
    });
    for (const invalid of [
      { categoriaGastoId: cat.id },
      { categoriaGastoId: randomUUID() },
      { metodoPagoId: inactive.id },
      { metodoPagoId: free.id },
      { metodoPagoId: randomUUID() },
    ])
      await api()
        .post('/api/v1/finanzas/gasto')
        .set('Cookie', cookie)
        .send({ ...input(invalid), solicitudId: randomUUID() })
        .expect(400);
  });
  it('edita con versión y motivo, manteniendo el histórico de catálogos desactivados', async () => {
    const cat = await db.categoriaGasto.create({ data: { nombre: 'Categoría histórica' } });
    const m = await db.metodoPago.create({ data: { nombre: 'Método histórico' } });
    const row = await create({ categoriaGastoId: cat.id, metodoPagoId: m.id });
    await db.categoriaGasto.update({
      where: { id: cat.id },
      data: { nombre: 'Categoría renombrada', activo: false },
    });
    await db.metodoPago.update({
      where: { id: m.id },
      data: { nombre: 'Método renombrado', activo: false },
    });
    const dto = {
      ...input({ categoriaGastoId: cat.id, metodoPagoId: m.id, importe: '30.20' }),
      version: row.version,
      motivo: 'Corregir importe',
    };
    const response = await api()
      .put('/api/v1/finanzas/' + row.id)
      .set('Cookie', cookie)
      .send(dto)
      .expect(200);
    expect(response.body.data.version).toBe(2);
    expect(response.body.data.categoriaNombreSnapshot).toBe('Categoría histórica');
    expect(response.body.data.metodoPagoNombreSnapshot).toBe('Método histórico');
    await api()
      .put('/api/v1/finanzas/' + row.id)
      .set('Cookie', cookie)
      .send(dto)
      .expect(409);
    const history = await api()
      .get('/api/v1/finanzas/' + row.id + '/historial')
      .set('Cookie', cookie)
      .expect(200);
    expect(history.body.pagination.total).toBe(2);
    expect(history.body.data[0].datosAnteriores.importe).toBe('25.1');
    expect(history.body.data[0].datosNuevos.motivo).toBe('Corregir importe');
  });
  it('dos ediciones simultáneas no se sobrescriben', async () => {
    const row = await create();
    const results = await Promise.all(
      ['10.00', '20.00'].map((importe) =>
        api()
          .put('/api/v1/finanzas/' + row.id)
          .set('Cookie', cookie)
          .send({ ...input({ importe }), version: 1, motivo: 'Edición concurrente' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.actividad.count({ where: { accion: 'EDITAR' } })).toBe(1);
  });
  it('anula sin borrar, excluye del balance y tolera reintentos idénticos', async () => {
    const row = await create();
    const dto = { version: 1, motivo: 'Gasto duplicado' };
    await Promise.all(
      [1, 2].map(() =>
        api()
          .post('/api/v1/finanzas/' + row.id + '/anular')
          .set('Cookie', cookie)
          .send(dto)
          .expect(201),
      ),
    );
    expect((await balance()).gastos).toBe('0.00');
    expect(await db.movimientoFinanciero.count()).toBe(1);
    expect(await db.actividad.count({ where: { accion: 'ANULAR' } })).toBe(1);
    await api()
      .put('/api/v1/finanzas/' + row.id)
      .set('Cookie', cookie)
      .send({ ...input(), version: 2, motivo: 'Intentar reabrir' })
      .expect(409);
  });
  it('no permite editar ni anular ingresos desde gastos', async () => {
    const row = await income('75');
    await api()
      .put('/api/v1/finanzas/' + row.id)
      .set('Cookie', cookie)
      .send({ ...input(), version: 1, motivo: 'No permitido' })
      .expect(409);
    await api()
      .post('/api/v1/finanzas/' + row.id + '/anular')
      .set('Cookie', cookie)
      .send({ version: 1, motivo: 'No permitido' })
      .expect(409);
    expect((await balance()).ingresos).toBe('75.00');
  });
  it('agrega decimales exactos, separa pendientes/anulados y no depende de paginación', async () => {
    await income('0.10');
    await income('0.20');
    await income('75', 'PENDIENTE');
    await income('900', 'ANULADO');
    await create({ importe: '0.05' });
    const value = await balance({ limit: 1, page: 2 });
    expect(value).toMatchObject({
      ingresos: '0.30',
      gastos: '0.05',
      resultado: '0.25',
      pendienteCobro: '75.00',
      numeroIngresos: 2,
      numeroGastos: 1,
      numeroOperaciones: 3,
      ticketMedio: '0.15',
    });
    const list = await api()
      .get('/api/v1/finanzas')
      .set('Cookie', cookie)
      .query({ limit: 1 })
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.pagination.total).toBe(5);
  });
  it('filtra por fecha de cobro y usa fecha histórica si no existe; hasta incluye todo el día', async () => {
    const row = await income('75', 'CONFIRMADO', '2026-08-31T00:00:00Z');
    await db.movimientoFinanciero.update({
      where: { id: row.id },
      data: { fechaCobro: new Date('2026-09-01T00:00:00Z') },
    });
    await income('25', 'CONFIRMADO', '2026-08-31T23:59:59Z');
    expect((await balance({ desde: '2026-08-01', hasta: '2026-08-31' })).ingresos).toBe('25.00');
    expect((await balance({ desde: '2026-09-01', hasta: '2026-09-01' })).ingresos).toBe('75.00');
    expect((await balance({ desde: '2026-02-28', hasta: '2026-03-01' })).ticketMedio).toBe('0.00');
  });
  it('valida consultas, estados vacíos y filtros por categoría, método, estado y concepto', async () => {
    await create();
    const result = await api()
      .get('/api/v1/finanzas')
      .set('Cookie', cookie)
      .query({
        tipo: 'GASTO',
        estado: 'CONFIRMADO',
        categoriaGastoId: category,
        metodoPagoId: method,
        search: 'HOSTING',
      })
      .expect(200);
    expect(result.body.pagination.total).toBe(1);
    expect((await balance({ categoriaGastoId: randomUUID() })).resultado).toBe('0.00');
    for (const query of [
      { desde: '2026-02-30' },
      { desde: '2026-10-01', hasta: '2026-09-01' },
      { limit: 101 },
      { page: 0 },
      { tipo: 'OTRO' },
      { clienteId: 'bad' },
    ])
      await api().get('/api/v1/finanzas').set('Cookie', cookie).query(query).expect(400);
    await api()
      .get('/api/v1/finanzas/' + randomUUID())
      .set('Cookie', cookie)
      .expect(404);
  });
  it('ordena por fecha financiera antes de paginar y desempata por id sin duplicar filas', async () => {
    const oldest = await income('1', 'CONFIRMADO', '2026-08-01T00:00:00Z');
    const latest = await income('2', 'CONFIRMADO', '2026-08-02T00:00:00Z');
    await db.movimientoFinanciero.update({
      where: { id: latest.id },
      data: { fechaCobro: new Date('2026-09-25') },
    });
    const historical = await income('3', 'CONFIRMADO', '2026-09-15T00:00:00Z');
    const tied = await income('4', 'CONFIRMADO', '2026-09-25T00:00:00Z');
    const expected = [latest.id, tied.id].sort().reverse().concat([historical.id, oldest.id]);
    const actual: string[] = [];
    for (let page = 1; page <= 4; page++) {
      const response = await api()
        .get('/api/v1/finanzas')
        .set('Cookie', cookie)
        .query({ page, limit: 1, tipo: 'INGRESO' })
        .expect(200);
      actual.push(response.body.data[0].id);
      expect(response.body.pagination.total).toBe(4);
    }
    expect(actual).toEqual(expected);
    const filtered = await api()
      .get('/api/v1/finanzas')
      .set('Cookie', cookie)
      .query({ desde: '2026-09-01', hasta: '2026-09-25', estado: 'CONFIRMADO' })
      .expect(200);
    expect(filtered.body.data.map((row: { id: string }) => row.id)).toEqual(expected.slice(0, 3));
    expect(
      (await balance({ desde: '2026-09-01', hasta: '2026-09-25', estado: 'CONFIRMADO' })).ingresos,
    ).toBe('9.00');
  });
  it('parametriza búsquedas con comillas y conserva filtros idénticos en libro y balance', async () => {
    await create({ concepto: "Hosting 'especial'", importe: '10.25' });
    await create({ concepto: 'Otro concepto', importe: '5.00' });
    const filter = {
      search: "'especial'",
      categoriaGastoId: category,
      metodoPagoId: method,
      tipo: 'GASTO',
      estado: 'CONFIRMADO',
      desde: '2026-09-25',
      hasta: '2026-09-25',
    };
    const response = await api()
      .get('/api/v1/finanzas')
      .set('Cookie', cookie)
      .query(filter)
      .expect(200);
    expect(response.body.pagination.total).toBe(1);
    expect(response.body.data[0].concepto).toBe("Hosting 'especial'");
    expect((await balance(filter)).gastos).toBe('10.25');
    const injection = { search: "' OR TRUE --" };
    expect(
      (await api().get('/api/v1/finanzas').set('Cookie', cookie).query(injection).expect(200)).body
        .pagination.total,
    ).toBe(0);
    expect((await balance(injection)).gastos).toBe('0.00');
  });
  it('cobrar en sprint 6 mueve el ingreso al periodo real sin duplicarlo ni descontar comisiones', async () => {
    const client = await db.cliente.create({
      data: {
        nombre: 'Finanzas cobro',
        estadoId: (
          await db.estado.findUniqueOrThrow({
            where: { tipo_valor: { tipo: 'cliente', valor: 'ACTIVO' } },
          })
        ).id,
      },
    });
    const tariff = await db.tarifa.findFirstOrThrow({
      where: { activo: true, producto: { activo: true } },
    });
    const server = await db.servidor.findFirstOrThrow({ where: { activo: true } });
    const sub = (
      await api()
        .post('/api/v1/suscripciones')
        .set('Cookie', cookie)
        .send({
          clienteId: client.id,
          productoId: tariff.productoId,
          tarifaId: tariff.id,
          servidorId: server.id,
          fechaInicio: '2025-08-25',
          solicitudId: randomUUID(),
        })
        .expect(201)
    ).body.data;
    const row = (
      await api()
        .post('/api/v1/suscripciones/' + sub.id + '/renovar')
        .set('Cookie', cookie)
        .send({
          solicitudId: randomUUID(),
          version: sub.version,
          importe: '75',
          motivoImporte: 'Importe de prueba',
          metodoPagoId: method,
          cobro: 'PENDIENTE',
          fechaPrevistaCobro: '2026-10-01',
        })
        .expect(201)
    ).body.data;
    expect((await balance({ clienteId: client.id })).pendienteCobro).toBe('75.00');
    clock.mockReturnValue('2026-10-01');
    await api()
      .post('/api/v1/renovaciones/' + row.id + '/cobrar')
      .set('Cookie', cookie)
      .send({ version: 1, metodoPagoId: method, fechaCobro: '2026-10-01' })
      .expect(201);
    expect((await balance({ hasta: '2026-09-30' })).ingresos).toBe('0.00');
    expect(
      (await balance({ desde: '2026-10-01', clienteId: client.id, metodoPagoId: method })).ingresos,
    ).toBe('75.00');
    expect(await db.movimientoFinanciero.count()).toBe(1);
    expect(
      (await db.suscripcion.findUniqueOrThrow({ where: { id: sub.id } })).fechaFin
        .toISOString()
        .slice(0, 10),
    ).toBe('2027-09-25');
    await api()
      .post('/api/v1/renovaciones/' + row.id + '/anular')
      .set('Cookie', cookie)
      .send({ version: 2, motivo: 'Corrección de prueba' })
      .expect(201);
    expect((await balance()).ingresos).toBe('0.00');
    const rawMovement = await db.movimientoFinanciero.findFirstOrThrow({
      where: { renovacionId: row.id },
    });
    // Reproduce ingresos anulados por sprint 6, sin motivo copiado al movimiento.
    expect(rawMovement.motivoAnulacion).toBeNull();
    const auditCount = await db.actividad.count();
    const annulledRenewal = await db.renovacion.findUniqueOrThrow({ where: { id: row.id } });
    const detail = (
      await api()
        .get('/api/v1/finanzas/' + rawMovement.id)
        .set('Cookie', cookie)
        .expect(200)
    ).body.data;
    expect(detail.motivoAnulacion).toBe('Corrección de prueba');
    expect(detail.anuladaAt).toBe(annulledRenewal.anuladaAt!.toISOString());
    expect(detail).not.toHaveProperty('renovacion');
    const listed = (
      await api()
        .get('/api/v1/finanzas')
        .set('Cookie', cookie)
        .query({ estado: 'ANULADO' })
        .expect(200)
    ).body.data;
    expect(listed[0].motivoAnulacion).toBe(detail.motivoAnulacion);
    expect(await db.actividad.count()).toBe(auditCount);
    expect(
      (await db.movimientoFinanciero.findUniqueOrThrow({ where: { id: rawMovement.id } }))
        .motivoAnulacion,
    ).toBeNull();
  });
  it('revierte alta, edición y anulación si falla auditoría', async () => {
    const row = await create();
    await db.$executeRawUnsafe(
      "ALTER TABLE actividad ADD CONSTRAINT sprint7_audit_fail CHECK (tabla <> 'movimientos_financieros') NOT VALID",
    );
    try {
      await api()
        .post('/api/v1/finanzas/gasto')
        .set('Cookie', cookie)
        .send({ ...input(), solicitudId: randomUUID() })
        .expect(500);
      await api()
        .put('/api/v1/finanzas/' + row.id)
        .set('Cookie', cookie)
        .send({ ...input({ importe: '99' }), version: 1, motivo: 'Debe revertir' })
        .expect(500);
      await api()
        .post('/api/v1/finanzas/' + row.id + '/anular')
        .set('Cookie', cookie)
        .send({ version: 1, motivo: 'Debe revertir' })
        .expect(500);
      expect(await db.movimientoFinanciero.count()).toBe(1);
      const current = await db.movimientoFinanciero.findUniqueOrThrow({ where: { id: row.id } });
      expect(current.version).toBe(1);
      expect(current.importe.toFixed(2)).toBe('25.10');
      expect(current.estadoId).toBe(states.CONFIRMADO);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT sprint7_audit_fail');
    }
  });
  it('consulta y agrega 10.000 movimientos sin cargar el histórico completo en la respuesta', async () => {
    await db.movimientoFinanciero.createMany({
      data: Array.from({ length: 10000 }, () => ({
        tipoId: states.INGRESO,
        estadoId: states.CONFIRMADO,
        importe: '0.99',
        fecha: new Date('2026-09-25T00:00:00Z'),
      })),
    });
    const started = Date.now();
    const value = await balance();
    const rows = await api()
      .get('/api/v1/finanzas')
      .set('Cookie', cookie)
      .query({ limit: 25 })
      .expect(200);
    expect(value.ingresos).toBe('9900.00');
    expect(value.numeroIngresos).toBe(10000);
    expect(rows.body.data).toHaveLength(25);
    expect(rows.body.pagination.total).toBe(10000);
    expect(Date.now() - started).toBeLessThan(10000);
    expect(await db.actividad.count()).toBe(0);
  }, 30000);
});
