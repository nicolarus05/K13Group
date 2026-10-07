import { randomUUID } from 'node:crypto';
import { RenovacionesService } from '../renovaciones/renovaciones.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient, Prisma } from '@prisma/client';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { seedBase } from '../../prisma/seed';
import * as dates from '../suscripciones/subscription-dates';

const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)('Sprint 9: estadísticas aisladas', () => {
  let db: PrismaClient, app: INestApplication, cookie: string, clock: jest.SpyInstance;
  let states: Record<string, string>,
    rate: { id: string; productoId: string },
    server: string,
    method: string;
  const api = () => request(app.getHttpServer());
  const get = async (path = '/estadisticas', query = {}) =>
    (
      await api()
        .get('/api/v1' + path)
        .set('Cookie', cookie)
        .query(query)
        .expect(200)
    ).body;
  const client = (extra: Partial<Prisma.ClienteUncheckedCreateInput> = {}) =>
    db.cliente.create({
      data: {
        nombre: 'Cliente prueba',
        estadoId: states['cliente.ACTIVO'],
        createdAt: new Date('2026-09-25T12:00:00Z'),
        ...extra,
      },
    });
  const sub = (clienteId: string, extra: Partial<Prisma.SuscripcionUncheckedCreateInput> = {}) =>
    db.suscripcion.create({
      data: {
        clienteId,
        productoId: rate.productoId,
        tarifaId: rate.id,
        servidorId: server,
        estadoId: states['suscripcion.ACTIVA'],
        fechaInicio: new Date('2025-09-25'),
        fechaFin: new Date('2026-09-30'),
        ...extra,
      },
    });
  const movement = (
    importe: string,
    tipo = 'INGRESO',
    estado = 'CONFIRMADO',
    extra: Partial<Prisma.MovimientoFinancieroUncheckedCreateInput> = {},
  ) =>
    db.movimientoFinanciero.create({
      data: {
        importe,
        tipoId: states['movimiento_tipo.' + tipo],
        estadoId: states['movimiento_estado.' + estado],
        fecha: new Date('2026-09-25'),
        ...extra,
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

  const renewal = (sid: string, extra: Partial<Prisma.RenovacionUncheckedCreateInput> = {}) =>
    db.renovacion.create({
      data: {
        suscripcionId: sid,
        fechaInicio: new Date('2026-09-25'),
        fechaFin: new Date('2027-09-25'),
        fechaOperacion: new Date('2026-09-25'),
        finAnterior: new Date('2026-09-15'),
        importe: '75',
        estadoId: states['renovacion.COMPLETADA'],
        metodoPagoId: method,
        ...extra,
      },
    });
  it('JWT, fechas y filtros coherentes en los ocho informes', async () => {
    for (const path of [
      '',
      '/clientes',
      '/finanzas',
      '/renovaciones',
      '/productos',
      '/servidores',
      '/referencias',
      '/metodos-pago',
    ]) {
      await api()
        .get('/api/v1/estadisticas' + path)
        .expect(401);
      expect((await get('/estadisticas' + path)).success).toBe(true);
    }
    for (const query of [
      { desde: '2026-09-01' },
      { desde: '2026-02-30', hasta: '2026-03-01' },
      { desde: '2020-01-01', hasta: '2026-09-25' },
      { desde: '2024-01-01', hasta: '2026-09-25', agrupacion: 'dia' },
      { productoId: rate.productoId },
      { limit: 101 },
      { agrupacion: 'SQL' },
    ])
      await api().get('/api/v1/estadisticas').set('Cookie', cookie).query(query).expect(400);
  });
  it('finanzas, series y desgloses concuerdan; pendientes y anulados no suman', async () => {
    await movement('75');
    await movement('25.10', 'GASTO');
    await movement('100', 'INGRESO', 'ANULADO');
    await movement('50', 'INGRESO', 'PENDIENTE');
    await movement('25', 'INGRESO', 'CONFIRMADO', { fecha: new Date('2026-08-12') });
    await movement('30', 'INGRESO', 'CONFIRMADO', {
      fecha: new Date('2026-08-01'),
      fechaCobro: new Date('2026-09-20'),
    });
    const r = (await get()).data,
      f = (await get('/finanzas/balance', { desde: '2026-09-01', hasta: '2026-09-25' })).data;
    expect(r.finanzas).toMatchObject({
      ingresos: f.ingresos,
      gastos: f.gastos,
      resultado: f.resultado,
      ticketMedio: f.ticketMedio,
    });
    expect(r.finanzas.ingresos).toBe('105.00');
    expect(r.finanzas.variacion.ingresos).toBe('320.0');
    expect(r.finanzas.serie[0]).toMatchObject({ ingresos: '105.00', gastos: '25.10' });
    for (const dim of ['productos', 'servidores', 'referencias', 'metodos-pago'])
      expect((await get('/estadisticas/' + dim)).data.ranking.totalImporte).toBe('105.00');
    expect((await get('/estadisticas/finanzas')).data.ranking.totalImporte).toBe('25.10');
  });
  it('tasa por cliente: dos de tres servicios renovados del mismo cliente cuentan una vez', async () => {
    const a = await client(),
      b = await client();
    const subs = await Promise.all([
      sub(a.id),
      sub(a.id),
      sub(a.id),
      sub(b.id, { noRenovar: true, fechaFin: new Date('2026-09-15') }),
    ]);
    await renewal(subs[0].id);
    await renewal(subs[1].id, { importe: 0 });
    await renewal(subs[3].id, { estadoId: states['renovacion.ANULADA'] });
    const r = (await get('/estadisticas/renovaciones')).data.renovaciones;
    expect(r.tasa).toMatchObject({ clientes: 2, renovados: 1, porcentaje: '50.0' });
    expect(r.realizadas).toBe(2);
    expect(r.gratuitas).toBe(1);
  });
  it('renovar fuera del periodo cuenta por el vencimiento original; ALTA no renueva', async () => {
    const a = await client();
    const s = await sub(a.id, { fechaFin: new Date('2027-08-10') });
    await renewal(s.id, {
      fechaOperacion: new Date('2026-08-10'),
      finAnterior: new Date('2026-09-15'),
    });
    await renewal(s.id, { tipoOperacion: 'ALTA', finAnterior: null });
    const r = (await get('/estadisticas/renovaciones')).data.renovaciones;
    expect(r.realizadas).toBe(0);
    expect(r.altas).toBe(1);
    expect(r.tasa).toMatchObject({ clientes: 1, renovados: 1, porcentaje: '100.0' });
  });
  it('no inventa tasa completa con renovaciones sin vencimiento anterior', async () => {
    const c = await client();
    const s = await sub(c.id);
    await renewal(s.id, { finAnterior: null });
    expect((await get('/estadisticas/renovaciones')).data.renovaciones.tasa).toMatchObject({
      porcentaje: null,
      sinVencimientoAnterior: 1,
    });
  });
  it('perdidos a los 30 días exactos, sin confundir nuevos o clientes con otro servicio vigente', async () => {
    const a = await client(),
      b = await client(),
      c = await client();
    await client();
    await sub(a.id, { fechaFin: new Date('2026-08-26') });
    await sub(b.id, { fechaFin: new Date('2026-08-27') });
    await sub(c.id, { fechaFin: new Date('2026-08-01') });
    await sub(c.id);
    expect((await get('/estadisticas/clientes')).data.clientes.actual).toMatchObject({
      total: 4,
      perdidos: 1,
      vigentes: 1,
    });
  });
  it('altas por día de Madrid y filtro de estado solo para situación actual', async () => {
    await client({
      createdAt: new Date('2026-09-24T22:30:00Z'),
      estadoId: states['cliente.INACTIVO'],
    });
    const r = (
      await get('/estadisticas/clientes', {
        desde: '2026-09-25',
        hasta: '2026-09-25',
        agrupacion: 'dia',
        estadoCliente: 'ACTIVO',
      })
    ).data.clientes;
    expect(r.altas).toBe(1);
    expect(r.actual.total).toBe(0);
    expect(r.serie).toEqual([{ dia: '2026-09-25', altas: 1 }]);
  });
  it('no muestra beneficio con ingresos y gastos de bases distintas', async () => {
    const category = await db.categoriaGasto.create({ data: { nombre: 'Categoria Stats' } });
    await movement('50', 'INGRESO', 'CONFIRMADO', { metodoPagoId: method });
    await movement('10', 'GASTO', 'CONFIRMADO', { categoriaGastoId: category.id });
    expect(
      (await get('/estadisticas/finanzas', { metodoPagoId: method })).data.finanzas,
    ).toMatchObject({ ingresos: '50.00', gastos: null, resultado: null });
    expect(
      (await get('/estadisticas/finanzas', { categoriaGastoId: category.id })).data.finanzas,
    ).toMatchObject({ ingresos: null, gastos: '10.00', resultado: null });
    await api()
      .get('/api/v1/estadisticas/finanzas')
      .set('Cookie', cookie)
      .query({ metodoPagoId: method, categoriaGastoId: category.id })
      .expect(400);
  });
  it('congela atribución al registrar; el cobro posterior no usa el servidor actual', async () => {
    const c = await client();
    const s = await sub(c.id);
    const actor = (await db.usuario.findUniqueOrThrow({ where: { username: 'admin' } })).id;
    const svc = app.get(RenovacionesService);
    const r = await svc.create(
      s.id,
      {
        solicitudId: randomUUID(),
        version: s.version,
        importe: '75',
        metodoPagoId: method,
        cobro: 'PENDIENTE',
        fechaPrevistaCobro: '2026-09-25',
        motivoImporte: 'prueba',
      },
      actor,
      true,
    );
    const next = await db.servidor.create({ data: { nombre: 'Otro Stats' } });
    await db.suscripcion.update({ where: { id: s.id }, data: { servidorId: next.id } });
    await svc.collect(
      r.id,
      { version: r.version, metodoPagoId: method, fechaCobro: '2026-09-25' },
      actor,
    );
    const m = await db.movimientoFinanciero.findFirstOrThrow({ where: { renovacionId: r.id } });
    expect(m.atribucionVerificada).toBe(true);
    expect(m.servidorIdSnapshot).toBe(server);
    expect(
      (await get('/estadisticas/servidores', { servidorId: server })).data.ranking.totalImporte,
    ).toBe('75.00');
    expect(
      (await get('/estadisticas/servidores', { servidorId: next.id })).data.ranking.totalImporte,
    ).toBe('0.00');
  });
  it('rankings agrupan por ID y separan desconocidos de sin referente', async () => {
    const c = await client();
    const s = await sub(c.id);
    const frozen = {
      suscripcionId: s.id,
      atribucionVerificada: true,
      productoIdSnapshot: rate.productoId,
      servidorIdSnapshot: server,
      referenciaIdSnapshot: null,
      productoNombreSnapshot: 'Nombre antiguo',
    };
    await movement('30', 'INGRESO', 'CONFIRMADO', frozen);
    await movement('45', 'INGRESO', 'CONFIRMADO', {
      ...frozen,
      productoNombreSnapshot: 'Nombre nuevo',
    });
    await movement('10');
    const r = (await get('/estadisticas/productos')).data.ranking;
    expect(r.data.find((r: { clave: string }) => r.clave === rate.productoId)).toMatchObject({
      importe: '75.00',
      operaciones: 2,
      clientesCobro: 1,
    });
    expect(r.data.find((r: { clave: string }) => r.clave === 'sin-atribucion').importe).toBe(
      '10.00',
    );
    expect(
      (await get('/estadisticas/referencias')).data.ranking.data.find(
        (r: { clave: string }) => r.clave === 'sin-referencia',
      ).importe,
    ).toBe('75.00');
  });
  it('tabla paginada y gráfico top 10 + Otros suman total exacto', async () => {
    const methods = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        db.metodoPago.create({ data: { nombre: 'Ranking Stats ' + i } }),
      ),
    );
    for (const m of methods)
      await movement('1.01', 'INGRESO', 'CONFIRMADO', { metodoPagoId: m.id });
    const r = (await get('/estadisticas/metodos-pago', { page: 2, limit: 5 })).data.ranking;
    expect(r.pagination.total).toBe(12);
    expect(r.data).toHaveLength(5);
    expect(r.grafico).toHaveLength(11);
    expect(r.grafico.at(-1)).toMatchObject({ nombre: 'Otros', importe: '2.02' });
    expect(r.totalImporte).toBe('12.12');
  });
  it('GET no escribe ni expone secretos; carga 10000 movimientos', async () => {
    await db.movimientoFinanciero.createMany({
      data: Array.from({ length: 10000 }, () => ({
        importe: '1.01',
        fecha: new Date('2026-09-25'),
        tipoId: states['movimiento_tipo.INGRESO'],
        estadoId: states['movimiento_estado.CONFIRMADO'],
        descripcion: 'secreto-no-exponer',
      })),
    });
    const before = await db.actividad.count();
    const start = Date.now();
    expect((await get()).data.finanzas.ingresos).toBe('10100.00');
    expect(JSON.stringify(await get('/estadisticas/productos'))).not.toContain(
      'secreto-no-exponer',
    );
    expect(await db.actividad.count()).toBe(before);
    expect(await db.movimientoFinanciero.count()).toBe(10000);
    expect(Date.now() - start).toBeLessThan(10000);
  }, 30000);
});
