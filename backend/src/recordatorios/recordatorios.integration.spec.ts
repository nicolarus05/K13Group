import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { seedBase } from '../../prisma/seed';
import * as dates from '../suscripciones/subscription-dates';
import { RecordatoriosService } from './recordatorios.service';
import { RenovacionesService } from '../renovaciones/renovaciones.service';

const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)('Sprint 10: avisos internos y calendario', () => {
  let db: PrismaClient,
    app: INestApplication,
    cookie: string,
    actor: string,
    clock: jest.SpyInstance;
  let states: Record<string, string>,
    rate: { id: string; productoId: string },
    server: string,
    method: string;
  const api = () => request(app.getHttpServer());
  const get = async (path = '', query = {}) =>
    (
      await api()
        .get('/api/v1/recordatorios' + path)
        .set('Cookie', cookie)
        .query(query)
        .expect(200)
    ).body;
  const post = (path: string, body: object) =>
    api()
      .post('/api/v1/recordatorios' + path)
      .set('Cookie', cookie)
      .send(body);
  const client = () =>
    db.cliente.create({ data: { nombre: 'Cliente avisos', estadoId: states['cliente.ACTIVO'] } });
  const sub = (clienteId: string, end = '2026-09-30') =>
    db.suscripcion.create({
      data: {
        clienteId,
        productoId: rate.productoId,
        tarifaId: rate.id,
        servidorId: server,
        estadoId: states['suscripcion.ACTIVA'],
        fechaInicio: new Date('2025-09-30'),
        fechaFin: new Date(end),
      },
    });
  const manual = (clienteId: string, extra = {}) => ({
    solicitudId: randomUUID(),
    clienteId,
    tipo: 'RENOVACION',
    fecha: '2026-09-30',
    descripcion: 'Llamar al cliente',
    ...extra,
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
    actor = (await db.usuario.findUniqueOrThrow({ where: { username: 'admin' } })).id;
    cookie =
      'access_token=' +
      new JwtService().sign({ sub: actor, sid: (await db.sesion.create({ data: { usuarioId: actor, token: 'fixture-access-only', expiresAt: new Date(Date.now() + 3600000) } })).id }, { secret: process.env.JWT_SECRET, expiresIn: '30m' });
    states = Object.fromEntries(
      (await db.estado.findMany()).map((s) => [s.tipo + '.' + s.valor, s.id]),
    );
    rate = await db.tarifa.findFirstOrThrow();
    server = (await db.servidor.findFirstOrThrow({ where: { activo: true } })).id;
    method = (await db.metodoPago.findFirstOrThrow({ where: { esGratuito: false } })).id;
  }, 30000);
  beforeEach(async () => {
    clock = jest.spyOn(dates, 'businessDay').mockReturnValue('2026-09-25');
    await db.importacionFila.deleteMany();
    await db.importacion.deleteMany();
    await db.recordatorio.deleteMany();
    await db.movimientoFinanciero.deleteMany();
    await db.renovacion.deleteMany();
    await db.suscripcion.deleteMany();
    await db.cliente.deleteMany();
    await db.actividad.deleteMany();
  });
  afterEach(() => clock.mockRestore());
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });
  it('JWT, cliente obligatorio, fechas reales y paginación acotada', async () => {
    for (const path of ['', '/resumen', '/calendario', '/agenda'])
      await api()
        .get('/api/v1/recordatorios' + path)
        .expect(401);
    const c = await client();
    const dto = manual(c.id);
    await post('', { ...dto, clienteId: undefined }).expect(400);
    await post('', { ...dto, fecha: '2026-02-30' }).expect(400);
    await post('', { ...dto, clienteId: randomUUID() }).expect(400);
    await post('', { ...dto, descripcion: '  ' }).expect(400);
    await api()
      .get('/api/v1/recordatorios')
      .set('Cookie', cookie)
      .query({ limit: 101 })
      .expect(400);
    await api()
      .get('/api/v1/recordatorios/calendario')
      .set('Cookie', cookie)
      .query({ desde: '2026-01-01', hasta: '2026-09-25' })
      .expect(400);
    const other = await client(),
      s = await sub(other.id);
    await post('', { ...dto, suscripcionId: s.id }).expect(400);
    expect(await db.recordatorio.count()).toBe(0);
  });
  it('crear concurrentemente y reintentar no duplica; UUID no reutilizable con otro contenido', async () => {
    const c = await client(),
      dto = manual(c.id);
    const rows = await Promise.all([post('', dto).expect(201), post('', dto).expect(201)]);
    expect(rows[0].body.data.id).toBe(rows[1].body.data.id);
    expect(await db.recordatorio.count()).toBe(1);
    expect(await db.actividad.count()).toBe(1);
    await post('', { ...dto, descripcion: 'Otro contenido' }).expect(409);
  });
  it('posponer conserva vencimiento, sale de atención y vuelve al llegar el día sin recrearse', async () => {
    const c = await client();
    await sub(c.id);
    const worker = app.get(RecordatoriosService);
    await Promise.all([worker.sync(), worker.sync()]);
    const r = (await get()).data[0];
    expect(r).toBeDefined();
    const payload = { version: r.version, fecha: '2026-10-03', motivo: 'Contactar más tarde' };
    await post('/' + r.id + '/posponer', payload).expect(201);
    await post('/' + r.id + '/posponer', payload).expect(201);
    await worker.sync();
    expect(await db.recordatorio.count()).toBe(1);
    expect((await get('/resumen')).data.atencion).toBe(0);
    expect((await get('/' + r.id)).data.fechaOriginal.slice(0, 10)).toBe('2026-09-30');
    expect((await get('/calendario', { desde: '2026-09-25', hasta: '2026-10-03' })).data).toEqual([
      { fecha: '2026-10-03', total: 1, renovaciones: 1, cobros: 0 },
    ]);
    clock.mockReturnValue('2026-10-03');
    expect((await get('/resumen')).data.atencion).toBe(1);
  });
  it('cierre manual reserva la clave y no cambia servicio ni dinero; historial paginado y seguro', async () => {
    const c = await client(),
      s = await sub(c.id);
    const worker = app.get(RecordatoriosService);
    await worker.sync();
    const r = (await get()).data[0],
      payload = { version: r.version, motivo: 'Cliente contactado' };
    await post('/' + r.id + '/completar', payload).expect(201);
    await post('/' + r.id + '/completar', payload).expect(201);
    await worker.sync();
    await worker.sync();
    expect(await db.recordatorio.count()).toBe(1);
    expect((await get()).data).toHaveLength(0);
    expect((await db.suscripcion.findUniqueOrThrow({ where: { id: s.id } })).fechaFin).toEqual(
      s.fechaFin,
    );
    expect(await db.movimientoFinanciero.count()).toBe(0);
    const h = await get('/' + r.id + '/historial', { limit: 1 });
    expect(h.pagination.total).toBe(2);
    expect(JSON.stringify(h)).not.toMatch(/solicitudHash|claveAutomatica|password/);
    expect((await get('/agenda', { desde: '2026-09-30' })).data[0].estadoAviso).toBe('COMPLETADO');
    await post('/' + r.id + '/posponer', {
      version: 2,
      motivo: 'Nuevo intento',
      fecha: '2026-10-04',
    }).expect(409);
  });
  it('versiones concurrentes: una sola acción; editar automático y fechas inválidas se rechazan', async () => {
    const c = await client(),
      r = (await post('', manual(c.id)).expect(201)).body.data;
    const outcomes = await Promise.all([
      post('/' + r.id + '/cancelar', { version: 1, motivo: 'No procede' }),
      post('/' + r.id + '/completar', { version: 1, motivo: 'Ya contactado' }),
    ]);
    expect(outcomes.map((x) => x.status).sort()).toEqual([201, 409]);
    await sub(c.id);
    await app.get(RecordatoriosService).sync();
    const auto = (await get()).data[0];
    await post('/' + auto.id + '/editar', {
      version: 1,
      motivo: 'Cambiar texto',
      descripcion: 'Otra descripción',
    }).expect(400);
    await post('/' + auto.id + '/posponer', {
      version: 1,
      motivo: 'Fecha anterior',
      fecha: '2026-09-29',
    }).expect(400);
    await post('/' + auto.id + '/completar', {
      version: 1,
      motivo: 'Campo extra',
      fecha: '2026-10-03',
    }).expect(400);
  });
  it('renovar cierra aviso, cobrar cierra deuda y anular restaura periodo con nuevo aviso', async () => {
    const c = await client(),
      s = await sub(c.id);
    await app.get(RecordatoriosService).sync();
    const old = (await get()).data[0];
    const service = app.get(RenovacionesService);
    const renewal = await service.create(
      s.id,
      {
        solicitudId: randomUUID(),
        version: s.version,
        importe: '75',
        metodoPagoId: method,
        cobro: 'PENDIENTE',
        fechaPrevistaCobro: '2026-09-25',
        motivoImporte: 'Prueba',
      },
      actor,
    );
    expect((await get('/' + old.id)).data.estado.valor).toBe('COMPLETADO');
    const debt = (await get()).data[0];
    expect(debt.movimiento.renovacionId).toBe(renewal.id);
    await service.collect(
      renewal.id,
      { version: renewal.version, metodoPagoId: method, fechaCobro: '2026-09-25' },
      actor,
    );
    expect((await get('/' + debt.id)).data.estado.valor).toBe('COMPLETADO');
    const current = await db.renovacion.findUniqueOrThrow({ where: { id: renewal.id } });
    await service.annul(renewal.id, { version: current.version, motivo: 'Revertir prueba' }, actor);
    const next = (await get()).data[0];
    expect(next.id).not.toBe(old.id);
    expect(next.tipo.valor).toBe('RENOVACION');
  });
  it('no renovar e inactivar ocultan avisos de renovación pero no deudas pendientes', async () => {
    const c = await client(),
      s = await sub(c.id);
    const service = app.get(RenovacionesService);
    await service.create(
      s.id,
      {
        solicitudId: randomUUID(),
        version: s.version,
        importe: '75',
        metodoPagoId: method,
        cobro: 'PENDIENTE',
        fechaPrevistaCobro: '2026-09-25',
        motivoImporte: 'Prueba',
      },
      actor,
      true,
    );
    await db.cliente.update({
      where: { id: c.id },
      data: { estadoId: states['cliente.INACTIVO'] },
    });
    expect((await get()).data.map((r: { tipo: { valor: string } }) => r.tipo.valor)).toEqual([
      'COBRO',
    ]);
    expect((await get('/agenda', { desde: '2026-09-25' })).data).toHaveLength(1);
  });
  it('calendario sin ventana de aviso, paginación, filtros, cero escrituras GET y sin secretos', async () => {
    const c = await client();
    for (let i = 0; i < 12; i++) await sub(c.id, '2026-10-15');
    const before = await db.actividad.count();
    expect(
      (await get('/calendario', { desde: '2026-10-01', hasta: '2026-10-31' })).data[0].total,
    ).toBe(12);
    const rows = await get('/agenda', { desde: '2026-10-15', page: 2, limit: 5 });
    expect(rows.data).toHaveLength(5);
    expect(rows.pagination.total).toBe(12);
    expect((await get('/agenda', { desde: '2026-10-15', tipo: 'COBRO' })).data).toHaveLength(0);
    expect(JSON.stringify(rows)).not.toMatch(/password|credencial|solicitudHash/);
    expect(await db.actividad.count()).toBe(before);
    expect(await db.recordatorio.count()).toBe(0);
  });
  it('fallo de auditoría revierte la creación y el reintento se recupera', async () => {
    const c = await client(),
      dto = manual(c.id);
    await db.$executeRawUnsafe(
      "ALTER TABLE actividad ADD CONSTRAINT sprint10_audit_fail CHECK (tabla <> 'recordatorios') NOT VALID",
    );
    try {
      await post('', dto).expect(500);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT sprint10_audit_fail');
    }
    expect(await db.recordatorio.count()).toBe(0);
    await post('', dto).expect(201);
    expect(await db.recordatorio.count()).toBe(1);
  });
});
