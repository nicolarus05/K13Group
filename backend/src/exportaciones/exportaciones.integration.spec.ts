import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as ExcelJS from 'exceljs';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { seedBase } from '../../prisma/seed';
import * as renderer from './export-renderer';
import { ExportacionesService } from './exportaciones.service';
import { ClientesService } from '../clientes/clientes.service';
import * as dates from '../suscripciones/subscription-dates';

const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)('Exportaciones 12.5 aisladas', () => {
  let db: PrismaClient, app: INestApplication, cookies: string[], states: Record<string, string>;
  let customerId: string, subscriptionId: string, actor: string;
  const api = () => request(app.getHttpServer());
  const generate = (module: string, formato = 'xlsx', filtros = {}, seccion?: string) =>
    api()
      .post('/api/v1/exportaciones/' + module)
      .set('Cookie', cookies)
      .send({ formato, filtros, ...(seccion ? { seccion } : {}) });
  const workbook = async (buffer: Buffer) => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    return book;
  };
  const binary = (
    response: request.Response,
    callback: (error: Error | null, data: Buffer) => void,
  ) => {
    const res = response as unknown as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
    res.on('error', (error) => callback(error, Buffer.alloc(0)));
  };
  const file = (module: string, format = 'xlsx', filters = {}, section?: string) =>
    generate(module, format, filters, section).buffer(true).parse(binary).expect(200);

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
    actor = (await db.usuario.findUniqueOrThrow({ where: { username: 'admin' } })).id;
    states = Object.fromEntries(
      (await db.estado.findMany()).map((s) => [s.tipo + '.' + s.valor, s.id]),
    );
    await db.cliente.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        nombre: 'Exportar ' + String(i).padStart(3, '0'),
        estadoId: states['cliente.ACTIVO'],
      })),
    });
    const customer = await db.cliente.create({
      data: {
        nombre: '=Ensayo Áéñ',
        telefono: '00123456789',
        observaciones: 'Texto; con \"comillas\"\\ny salto',
        estadoId: states['cliente.ACTIVO'],
      },
    });
    customerId = customer.id;
    const rate = await db.tarifa.findFirstOrThrow();
    const server = await db.servidor.findFirstOrThrow();
    const method = await db.metodoPago.findFirstOrThrow({ where: { esGratuito: false } });
    const sub = await db.suscripcion.create({
      data: {
        clienteId: customerId,
        productoId: rate.productoId,
        tarifaId: rate.id,
        servidorId: server.id,
        estadoId: states['suscripcion.HISTORICA'],
        fechaInicio: new Date('2025-10-01'),
        fechaFin: new Date('2026-10-01'),
        identificadorOperativoCifrado: 'SECRET-MAC-DO-NOT-EXPORT',
      },
    });
    subscriptionId = sub.id;
    const renewal = await db.renovacion.create({
      data: {
        suscripcionId: sub.id,
        fechaInicio: sub.fechaInicio,
        fechaFin: sub.fechaFin,
        fechaOperacion: new Date('2025-10-01'),
        importe: '75.10',
        metodoPagoId: method.id,
        estadoId: states['renovacion.COMPLETADA'],
        productoNombreSnapshot: 'Producto histórico',
        metodoPagoNombreSnapshot: 'Pago histórico',
      },
    });
    for (const [estado, importe] of [
      ['CONFIRMADO', '75.10'],
      ['PENDIENTE', '20'],
      ['ANULADO', '99'],
    ])
      await db.movimientoFinanciero.create({
        data: {
          tipoId: states['movimiento_tipo.INGRESO'],
          estadoId: states['movimiento_estado.' + estado],
          importe,
          fecha: new Date('2026-10-01'),
          descripcion: 'Descripción de un ingreso histórico',
          fechaCobro: estado === 'CONFIRMADO' ? new Date('2026-10-01') : null,
          suscripcionId: sub.id,
          renovacionId: estado === 'CONFIRMADO' ? renewal.id : null,
          metodoPagoNombreSnapshot: 'Método usado al cobrar',
          productoNombreSnapshot: 'Producto histórico',
        },
      });
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  it('protege generación e historial sin sesión y valida formato, módulo y filtros', async () => {
    await api().get('/api/v1/exportaciones').expect(401);
    await api()
      .post('/api/v1/exportaciones/clientes')
      .send({ formato: 'csv', filtros: {} })
      .expect(401);
    for (const [module, format, filters, section] of [
      ['usuarios', 'csv', {}, undefined],
      ['clientes', 'exe', {}, undefined],
      ['clientes', 'csv', { page: 2 }, undefined],
      ['clientes', 'csv', { secreto: true }, undefined],
      ['finanzas', 'csv', { desde: '2026-02-30' }, undefined],
      ['estadisticas', 'csv', {}, 'inexistente'],
      ['clientes', 'csv', {}, 'finanzas'],
      ['renovaciones', 'csv', { cobro: 'PENDIENTE' }, 'seguimiento'],
    ] as const)
      await generate(module, format, filters, section).expect(400);
  });
  it('exporta todas las páginas en orden, sin duplicados, y registra el resultado', async () => {
    const before = await db.cliente.count();
    const result = await file('clientes', 'xlsx', { search: 'Exportar', sort: 'nombre' });
    const sheet = (await workbook(result.body)).getWorksheet('Clientes')!;
    expect(sheet.rowCount).toBe(106);
    expect(sheet.getCell('A2').value).toBe('Exportar 000');
    expect(sheet.getCell('A106').value).toBe('Exportar 104');
    expect(new Set(sheet.getColumn(1).values.slice(2)).size).toBe(105);
    expect(await db.cliente.count()).toBe(before);
    const record = await db.exportacion.findFirstOrThrow({
      where: { estado: 'GENERADA' },
      orderBy: { createdAt: 'desc' },
    });
    expect(record).toMatchObject({
      modulo: 'clientes',
      tipo: 'xlsx',
      registros: 105,
      usuarioId: actor,
    });
    expect(
      await db.actividad.count({
        where: { tabla: 'exportaciones', registroId: record.id, accion: 'EXPORTAR' },
      }),
    ).toBe(1);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['content-disposition']).toMatch(/attachment; filename="k13-clientes-/);
  }, 30000);
  it('preserva teléfonos, texto literal, nulos y caracteres; CSV neutraliza fórmulas', async () => {
    const sheet = (
      await workbook((await file('clientes', 'xlsx', { search: '=Ensayo' })).body)
    ).getWorksheet('Clientes')!;
    expect(sheet.getCell('A2').value).toBe('=Ensayo Áéñ');
    expect(sheet.getCell('B2').value).toBe('00123456789');
    expect(sheet.getCell('C2').value).toBeNull();
    expect(sheet.getCell('E2').value).toBeNull();
    const csv = (await file('clientes', 'csv', { search: '=Ensayo' })).body.toString('utf8');
    expect(csv).toContain('"\'=Ensayo Áéñ"');
    expect(csv).toContain('00123456789');
  }, 30000);
  it('mantiene una instantánea coherente si aparecen clientes entre páginas', async () => {
    const service = app.get(ClientesService);
    const original = service.findAll.bind(service);
    let inserted: string | undefined;
    const spy = jest.spyOn(service, 'findAll').mockImplementation(async (q, tx) => {
      const result = await original(q, tx);
      if (q.page === 1 && q.search === 'Exportar')
        inserted = (
          await db.cliente.create({
            data: {
              nombre: 'Exportar 050 concurrente',
              estadoId: states['cliente.ACTIVO'],
            },
          })
        ).id;
      return result;
    });
    try {
      const sheet = (
        await workbook((await file('clientes', 'xlsx', { search: 'Exportar' })).body)
      ).getWorksheet('Clientes')!;
      expect(sheet.rowCount).toBe(106);
      expect(sheet.getCell('A106').value).toBe('Exportar 104');
      expect(sheet.getColumn(1).values).not.toContain('Exportar 050 concurrente');
    } finally {
      spy.mockRestore();
      if (inserted) await db.cliente.delete({ where: { id: inserted } });
    }
  }, 30000);
  it.each(['clientes', 'suscripciones', 'renovaciones', 'finanzas', 'estadisticas'])(
    '%s genera CSV y PDF reales sin datos operativos restringidos',
    async (module) => {
      for (const format of ['csv', 'pdf']) {
        const response = await file(module, format);
        expect(response.body.length).toBeGreaterThan(20);
        expect(response.body.toString('utf8')).not.toContain('SECRET-MAC-DO-NOT-EXPORT');
        if (format === 'pdf') expect(response.body.subarray(0, 5).toString()).toBe('%PDF-');
      }
    },
    60000,
  );
  it('suscripciones conserva estados históricos, fechas y filtros', async () => {
    const sheet = (
      await workbook(
        (await file('suscripciones', 'xlsx', { clienteId: customerId, estado: 'HISTORICA' })).body,
      )
    ).getWorksheet('Suscripciones')!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell('I2').value).toBe('HISTORICA');
    expect(sheet.getCell('G2').value).toEqual(new Date('2025-10-01'));
    const queue = (
      await workbook(
        (
          await file(
            'renovaciones',
            'xlsx',
            { vista: 'todas', clienteId: customerId },
            'seguimiento',
          )
        ).body,
      )
    ).getWorksheet('Por gestionar')!;
    expect(queue.rowCount).toBe(1);
    expect(
      (await db.suscripcion.findUniqueOrThrow({ where: { id: subscriptionId } })).version,
    ).toBe(1);
  }, 30000);
  it('operaciones usa snapshots históricos; finanzas separa ingresos, deuda y anulados', async () => {
    const operations = (await workbook((await file('renovaciones')).body)).getWorksheet(
      'Operaciones',
    )!;
    expect(operations.getCell('C2').value).toBe('Producto histórico');
    expect(operations.getCell('J2').value).toBe(75.1);
    expect(operations.getCell('L2').value).toBe('Pago histórico');
    expect(operations.getCell('N2').value).toBe('Método usado al cobrar');
    expect(operations.getCell('O2').value).toBe('2026-10-01');
    const book = await workbook(
      (await file('finanzas', 'xlsx', { desde: '2026-10-01', hasta: '2026-10-01' })).body,
    );
    const summary = book.getWorksheet('Balance')!;
    const rows: Record<string, unknown> = {};
    summary.eachRow((r, i) => {
      if (i > 1) rows[String(r.getCell(1).value)] = r.getCell(2).value;
    });
    expect(rows).toMatchObject({ Ingresos: 75.1, 'Pendiente de cobro': 20, Gastos: 0 });
    expect(book.getWorksheet('Movimientos')!.rowCount).toBe(4);
    expect(book.getWorksheet('Movimientos')!.getCell('A2').value).toBe(
      'Descripción de un ingreso histórico',
    );
  }, 30000);
  it.each([
    'resumen',
    'clientes',
    'renovaciones',
    'finanzas',
    'productos',
    'servidores',
    'referencias',
    'metodos-pago',
  ])(
    'exporta el informe estadístico %s',
    async (section) => {
      const result = await file(
        'estadisticas',
        'xlsx',
        { desde: '2026-10-01', hasta: '2026-10-20' },
        section,
      );
      expect((await workbook(result.body)).getWorksheet('Resumen')).toBeDefined();
    },
    30000,
  );
  it('rechaza exceso de registros sin entregar un archivo parcial', async () => {
    await db.cliente.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        nombre: 'Límite PDF ' + i,
        estadoId: states['cliente.ACTIVO'],
      })),
    });
    const response = await generate('clientes', 'pdf', { search: 'Límite PDF' }).expect(400);
    expect(response.body.message).toContain('1000');
    expect(await db.exportacion.count({ where: { estado: 'FALLIDA' } })).toBeGreaterThan(0);
  });
  it.each(['suscripciones', 'renovaciones'])(
    'mantiene la fecha de referencia al cruzar medianoche en %s',
    async (module) => {
      const customer = await db.cliente.create({
        data: { nombre: 'Ensayo medianoche', estadoId: states['cliente.ACTIVO'] },
      });
      const rate = await db.tarifa.findFirstOrThrow();
      const server = await db.servidor.findFirstOrThrow();
      await db.suscripcion.createMany({
        data: Array.from({ length: 101 }, () => ({
          clienteId: customer.id,
          productoId: rate.productoId,
          tarifaId: rate.id,
          servidorId: server.id,
          estadoId: states['suscripcion.ACTIVA'],
          fechaInicio: new Date('2025-10-21'),
          fechaFin: new Date('2026-10-21'),
        })),
      });
      const clock = jest
        .spyOn(dates, 'businessDay')
        .mockReturnValueOnce('2026-10-20')
        .mockReturnValue('2026-10-21');
      try {
        const response =
          module === 'suscripciones'
            ? await file(module, 'xlsx', { clienteId: customer.id, estado: 'PROXIMA_A_VENCER' })
            : await file(
                module,
                'xlsx',
                { clienteId: customer.id, vista: 'manana' },
                'seguimiento',
              );
        const sheet = (await workbook(response.body)).worksheets[1];
        expect(sheet.rowCount).toBe(102);
        for (let row = 2; row <= 102; row++)
          expect(sheet.getCell(row, 9).value).toBe('PROXIMA_A_VENCER');
        expect(response.headers['content-disposition']).toContain('2026-10-20');
      } finally {
        clock.mockRestore();
        await db.suscripcion.deleteMany({ where: { clienteId: customer.id } });
        await db.cliente.delete({ where: { id: customer.id } });
      }
    },
    30000,
  );
  it('un importe cero sin método gratuito ni movimiento no acredita una operación gratis', async () => {
    const method = await db.metodoPago.findFirstOrThrow({ where: { esGratuito: false } });
    const operation = await db.renovacion.create({
      data: {
        suscripcionId: subscriptionId,
        fechaInicio: new Date('2023-10-01'),
        fechaFin: new Date('2024-10-01'),
        fechaOperacion: new Date('2023-10-01'),
        importe: 0,
        metodoPagoId: method.id,
        estadoId: states['renovacion.COMPLETADA'],
      },
    });
    try {
      const sheet = (
        await workbook(
          (await file('renovaciones', 'xlsx', { desde: '2023-10-01', hasta: '2023-10-01' })).body,
        )
      ).getWorksheet('Operaciones')!;
      expect(sheet.rowCount).toBe(2);
      expect(sheet.getCell('M2').value).toBe('SIN_REGISTRO');
      expect(sheet.getCell('J2').value).toBe(0);
    } finally {
      await db.renovacion.delete({ where: { id: operation.id } });
    }
  }, 30000);
  it('fallo de generación queda registrado y no modifica datos de negocio', async () => {
    const before = await db.movimientoFinanciero.count();
    const mock = jest
      .spyOn(renderer, 'renderInWorker')
      .mockRejectedValueOnce(new Error('simulación'));
    try {
      await generate('clientes', 'csv', { search: 'sin coincidencias' }).expect(500);
    } finally {
      mock.mockRestore();
    }
    expect(await db.movimientoFinanciero.count()).toBe(before);
    const record = await db.exportacion.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(record.estado).toBe('FALLIDA');
    expect(record.error).not.toContain('simulación');
  });
  it('historial pagina también los intentos fallidos sin incluir archivos o datos de clientes', async () => {
    await db.exportacion.createMany({
      data: Array.from({ length: 30 }, () => ({
        usuarioId: actor,
        tipo: 'csv',
        modulo: 'clientes',
        estado: 'GENERADA',
        registros: 0,
      })),
    });
    const response = await api()
      .get('/api/v1/exportaciones?page=2')
      .set('Cookie', cookies)
      .expect(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(response.body)).not.toContain('SECRET-MAC');
    await api().get('/api/v1/exportaciones?page=0').set('Cookie', cookies).expect(400);
  });
  it('limita exportaciones simultáneas y libera el cupo tras un fallo', async () => {
    const service = app.get(ExportacionesService);
    const blocked: ((v: Buffer) => void)[] = [];
    const mock = jest
      .spyOn(renderer, 'renderInWorker')
      .mockImplementation(() => new Promise((resolve) => blocked.push(resolve)));
    const body = { formato: 'csv' as const, filtros: { search: 'sin coincidencias' } };
    const first = service.generate('clientes', body, actor);
    const second = service.generate('clientes', body, actor);
    try {
      await expect(service.generate('clientes', body, actor)).rejects.toThrow('dos exportaciones');
      while (blocked.length < 2) await new Promise((resolve) => setTimeout(resolve, 10));
      blocked.forEach((resolve) => resolve(Buffer.from('csv')));
      await Promise.all([first, second]);
    } finally {
      mock.mockRestore();
    }
  });
});
