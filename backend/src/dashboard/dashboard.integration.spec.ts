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
(isolated ? describe : describe.skip)('Sprint 8: dashboard aislado', () => {
  let db: PrismaClient, app: INestApplication, cookie: string, clock: jest.SpyInstance;
  let states: Record<string, string>,
    rate: { id: string; productoId: string },
    server: string,
    method: string;
  const api = () => request(app.getHttpServer());
  const get = async (path = '/dashboard', query = {}) =>
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
    method = (await db.metodoPago.findFirstOrThrow()).id;
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
  it('exige sesión, valida fechas y limita paginación', async () => {
    for (const path of ['/dashboard', '/dashboard/clientes'])
      await api()
        .get('/api/v1' + path)
        .expect(401);
    for (const query of [
      { desde: '2026-09-01' },
      { desde: '2026-02-30', hasta: '2026-03-01' },
      { desde: '2025-01-01', hasta: '2026-09-25' },
      { otro: 'x' },
    ])
      await api().get('/api/v1/dashboard').set('Cookie', cookie).query(query).expect(400);
    for (const query of [
      { page: 0 },
      { limit: 101 },
      { estado: 'OTRO' },
      { search: 'x'.repeat(151) },
    ])
      await api().get('/api/v1/dashboard/clientes').set('Cookie', cookie).query(query).expect(400);
  });
  it('devuelve ceros, listas vacías y serie completa sin comparaciones inventadas', async () => {
    const { data: r } = await get();
    expect(r.indicadores.clientesVigentes).toBe(0);
    expect(r.indicadores.ingresos).toBe('0.00');
    expect(r.serie).toHaveLength(25);
    expect(r.variacion.ingresos).toBeNull();
    expect(r.trabajo.renovaciones).toEqual([]);
    expect((await get('/dashboard/clientes')).pagination.total).toBe(0);
  });
  it('cuenta clientes únicos y fechas efectivas sin depender de estados diarios obsoletos', async () => {
    const c = await client();
    await sub(c.id);
    await sub(c.id, { estadoId: states['suscripcion.VENCIDA'] });
    await sub(c.id, { fechaFin: new Date('2026-09-25') });
    await sub(c.id, { fechaFin: new Date('2026-09-24') });
    await sub(c.id, { noRenovar: true });
    for (const state of ['BORRADOR', 'SUSPENDIDA', 'CANCELADA'])
      await sub(c.id, { estadoId: states['suscripcion.' + state] });
    await sub(c.id, { deletedAt: new Date() });
    const inactive = await client({ estadoId: states['cliente.INACTIVO'] });
    await sub(inactive.id);
    const deleted = await client({ deletedAt: new Date() });
    await sub(deleted.id);
    const { data: r } = await get();
    expect(r.indicadores.clientesVigentes).toBe(1);
    expect(r.indicadores.suscripcionesVigentes).toBe(3);
    expect(r.trabajo).toMatchObject({ hoy: 1, vencidas: 1, proximas: 2 });
    const rows = await get('/dashboard/clientes');
    expect(rows.pagination.total).toBe(2);
    expect(
      rows.data.find((x: { id: string }) => x.id === inactive.id).proximaRenovacion,
    ).toBeNull();
  });
  it('cuadra con Finanzas: cobros reales, gastos pagados, anulados fuera, deuda global', async () => {
    await movement('75');
    await movement('25.10', 'GASTO');
    await movement('100', 'INGRESO', 'ANULADO');
    await movement('200', 'GASTO', 'PENDIENTE');
    await movement('15', 'INGRESO', 'PENDIENTE', { fecha: new Date('2020-01-01') });
    await movement('30', 'INGRESO', 'CONFIRMADO', { fecha: new Date('2026-08-10') });
    await movement('45', 'INGRESO', 'CONFIRMADO', {
      fecha: new Date('2026-08-01'),
      fechaCobro: new Date('2026-09-25'),
    });
    const { data: r } = await get();
    const { data: f } = await get('/finanzas/balance', {
      desde: '2026-09-01',
      hasta: '2026-09-25',
    });
    for (const key of ['ingresos', 'gastos', 'resultado']) expect(r.indicadores[key]).toBe(f[key]);
    expect(r.indicadores).toMatchObject({
      ingresos: '120.00',
      gastos: '25.10',
      resultado: '94.90',
      pendienteCobro: '15.00',
      numeroPendientes: 1,
    });
    expect(r.variacion.ingresos).toBe('300.0');
    expect(r.trabajo.cobros).toHaveLength(1);
    expect(
      r.serie
        .reduce(
          (sum: Prisma.Decimal, row: { ingresos: string }) => sum.plus(row.ingresos),
          new Prisma.Decimal(0),
        )
        .toFixed(2),
    ).toBe(f.ingresos);
  });
  it('agrupa altas por día de Madrid y renovaciones sin primeros pagos ni anulaciones', async () => {
    const c = await client({ createdAt: new Date('2026-09-24T22:30:00Z') });
    const s = await sub(c.id);
    const renewal = (extra: Partial<Prisma.RenovacionUncheckedCreateInput> = {}) =>
      db.renovacion.create({
        data: {
          suscripcionId: s.id,
          fechaInicio: new Date('2026-09-25'),
          fechaFin: new Date('2027-09-25'),
          fechaOperacion: new Date('2026-09-25'),
          importe: '75',
          metodoPagoId: method,
          estadoId: states['renovacion.COMPLETADA'],
          ...extra,
        },
      });
    await renewal();
    await renewal({ tipoOperacion: 'ALTA' });
    await renewal({ estadoId: states['renovacion.ANULADA'] });
    await renewal({ deletedAt: new Date() });
    const { data: r } = await get('/dashboard', { desde: '2026-09-25', hasta: '2026-09-25' });
    expect(r.indicadores.nuevosClientes).toBe(1);
    expect(r.indicadores.renovaciones).toBe(1);
    expect(r.serie[0]).toMatchObject({ clientes: 1, renovaciones: 1 });
  });
  it('pagina, busca teléfono normalizado y no expone secretos ni auditoría cruda', async () => {
    const c = await client({
      nombre: 'Ana',
      telefono: '+34 600 111 222',
      telefonoNormalizado: '34600111222',
      observaciones: 'secreto-prueba',
    });
    await client({ nombre: 'Berta' });
    await sub(c.id, { identificadorOperativoCifrado: 'secreto-prueba' });
    await db.actividad.create({
      data: {
        tabla: 'suscripciones',
        accion: 'CREAR',
        datosNuevos: { password: 'secreto-prueba' },
      },
    });
    const page = await get('/dashboard/clientes', { page: 2, limit: 1 });
    expect(page.data[0].nombre).toBe('Berta');
    expect(page.pagination.total).toBe(2);
    const found = await get('/dashboard/clientes', { search: '600111222' });
    expect(found.data).toHaveLength(1);
    expect(JSON.stringify(found)).not.toContain('secreto-prueba');
    expect(JSON.stringify(await get())).not.toContain('secreto-prueba');
  });
  it('GET no cambia estados, avisos, auditoría ni dinero', async () => {
    const c = await client();
    await sub(c.id, { fechaFin: new Date('2026-09-01') });
    const snapshot = async () =>
      JSON.stringify(
        await Promise.all([
          db.suscripcion.findMany(),
          db.actividad.findMany(),
          db.recordatorio.findMany(),
          db.movimientoFinanciero.findMany(),
        ]),
      );
    const before = await snapshot();
    await get();
    await get('/dashboard/clientes');
    expect(await snapshot()).toBe(before);
  });
  it('informa de staging pendiente sin importar archivos ni sumarlo a las finanzas', async () => {
    const user=await db.usuario.findUniqueOrThrow({where:{username:'admin'}});
    const batch=await db.importacion.create({data:{usuarioId:user.id,archivo:'fixture-sintetica',estado:'EN_REVISION'}});
    await db.importacionFila.createMany({data:['ERROR','EN_CONFLICTO','PENDIENTE_FINANCIERA','IMPORTADA','RECHAZADA'].map((estado,i)=>({importacionId:batch.id,hojaOrigen:'TEST',filaOrigen:i+1,hashFila:'fixture-'+i,datosOriginales:{},estado}))});
    const {data:r}=await get();
    expect(r.calidadImportacion).toMatchObject({ultima:{id:batch.id,estado:'EN_REVISION'},pendientes:3,bloqueadas:2,pendientesFinancieras:1});
    expect(r.indicadores.ingresos).toBe('0.00');expect(await db.movimientoFinanciero.count()).toBe(0);
  });
  it('agrega 10.000 movimientos y pagina 1.000 clientes sin devolver el libro completo', async () => {
    await db.movimientoFinanciero.createMany({
      data: Array.from({ length: 10000 }, () => ({
        importe: '1.01',
        fecha: new Date('2026-09-25'),
        tipoId: states['movimiento_tipo.INGRESO'],
        estadoId: states['movimiento_estado.CONFIRMADO'],
      })),
    });
    await db.cliente.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({
        nombre: 'Carga ' + i.toString().padStart(4, '0'),
        estadoId: states['cliente.ACTIVO'],
      })),
    });
    const start = Date.now();
    const { data: r } = await get();
    const page = await get('/dashboard/clientes', { page: 50, limit: 10 });
    expect(r.indicadores.ingresos).toBe('10100.00');
    expect(page.pagination.total).toBe(1000);
    expect(page.data).toHaveLength(10);
    expect(r.serie).toHaveLength(25);
    expect(Date.now() - start).toBeLessThan(10000);
  }, 30000);
});
