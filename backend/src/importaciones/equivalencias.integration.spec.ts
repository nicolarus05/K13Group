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
import { normalizeComparable } from '../common/helpers/normalization';

const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)('Equivalencias 12.3 aisladas', () => {
  let app: INestApplication,
    db: PrismaClient,
    cookies: string[],
    serial = 0;
  const api = () => request(app.getHttpServer());
  const root = (id: string) => `/api/v1/importaciones/${id}/equivalencias-revision`;
  const list = async (id: string, query = '') =>
    (
      await api()
        .get(root(id) + query)
        .set('Cookie', cookies)
        .expect(200)
    ).body;
  const save = (id: string, body: object) =>
    api().patch(root(id)).set('Cookie', cookies).send(body);
  const preview = (id: string, body: object) =>
    api()
      .post(root(id) + '/previsualizar')
      .set('Cookie', cookies)
      .send(body);
  const fixture = async (custom?: unknown[][], duplicateSheet = false) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['FECHA', 'NOMBRE', 'APP', 'SERVIDOR', 'PAGO', 'P.AÑO', 'ESTADO', 'REFERENCIA', 'TOTAL'],
        ...(custom ?? [
          ['2026-10-17', `Ensayo ${++serial}`, 'MAXPLAYER', 'DEAD', 'STR', 75, 'PE', null, 500],
          ['2026-11-17', `Ensayo ${serial}`, 'MAXPLAYER', 'DEAD', 'STR', 75, null, null, 500],
          ['2026-12-17', null, 'APP secreta AA:BB:CC:DD:EE:FF', null, 'PA', 0],
        ]),
      ]),
      'OCT',
    );
    if (duplicateSheet) XLSX.utils.book_append_sheet(book, book.Sheets.OCT, 'NOV');
    const file = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const id = (
      await api()
        .post('/api/v1/importaciones/clientes/preview')
        .set('Cookie', cookies)
        .attach('file', file, `equivalencias-${++serial}.xlsx`)
        .expect(201)
    ).body.data.importacionId;
    return { id, result: await list(id) };
  };
  const body = (r: Awaited<ReturnType<typeof list>>, tipo = 'PRODUCTO', extra: object = {}) => ({
    huellaRevision: r.huellaRevision,
    solicitudId: randomUUID(),
    tipo,
    alcance: 'VALOR',
    clave: r.data[0].campos[tipo].clave,
    accion: 'ASIGNAR',
    entidadId: r.catalogos[tipo].find(
      (c: { nombre: string }) =>
        c.nombre ===
        ({ PRODUCTO: 'MAXPLAYER', SERVIDOR: 'DEAD', PAGO: 'Stripe' } as Record<string, string>)[
          tipo
        ],
    )?.id,
    motivo: 'Equivalencia comprobada',
    ...extra,
  });
  const correct = (id: string, row: string, version: number, cambios: object) =>
    api()
      .patch(`/api/v1/importaciones/${id}/filas/${row}/lectura`)
      .set('Cookie', cookies)
      .send({ version, cambios, motivo: 'Corrección comprobada' });
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
  it('exige autenticación, limita consultas e inventaría APP desconocida sin divulgarla', async () => {
    await api().get(root(randomUUID())).expect(401);
    const { id, result } = await fixture();
    expect(result.inventario.reduce((n: number, g: { total: number }) => n + g.total, 0)).toBe(3);
    expect(
      result.inventario.some((g: { etiqueta: string }) =>
        g.etiqueta.startsWith('APP no reconocida'),
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/AA:BB|APP secreta/);
    await api()
      .get(root(id) + '?limit=1000')
      .set('Cookie', cookies)
      .expect(400);
    await api()
      .get(root(id) + '?tipo=OTRO')
      .set('Cookie', cookies)
      .expect(400);
  });
  it('previsualiza y guarda solo en un análisis; reintentos y auditoría son idempotentes', async () => {
    const a = await fixture(),
      b = await fixture();
    const dto = body(a.result);
    expect((await preview(a.id, dto).expect(201)).body).toMatchObject({
      total: 2,
      cambiosEfectivos: 2,
    });
    expect(await db.importacionEquivalenciaRevision.count({ where: { importacionId: a.id } })).toBe(
      0,
    );
    const response = (await save(a.id, dto).expect(200)).body;
    expect((await save(a.id, dto).expect(200)).body).toEqual(response);
    await save(a.id, { ...dto, motivo: 'Otro motivo' }).expect(409);
    expect((await list(a.id)).data[0].campos.PRODUCTO.estado).toBe('RESUELTA');
    expect((await list(b.id)).data[0].campos.PRODUCTO.estado).toBe('PENDIENTE');
    expect(
      await db.actividad.count({ where: { registroId: a.id, accion: 'REVISAR_EQUIVALENCIA' } }),
    ).toBe(1);
  });
  it('bloquea la ruta antigua global para análisis actuales sin alterar equivalencias existentes', async () => {
    const { id, result } = await fixture();
    const before = await db.importacionEquivalencia.findMany({ orderBy: { id: 'asc' } });
    await api()
      .post(`/api/v1/importaciones/${id}/equivalencias`)
      .set('Cookie', cookies)
      .send({
        tipo: 'PRODUCTO',
        valorOrigen: 'MAXPLAYER',
        valorClave: 'MAXPLAYER',
        valorCanonico: 'Otro producto',
        entidadId: body(result).entidadId,
      })
      .expect(409);
    expect(await db.importacionEquivalencia.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect((await list(id)).version).toBe(0);
  });
  it('previsualiza todas las hojas aunque la consulta esté filtrada y paginada', async () => {
    const { id } = await fixture(undefined, true);
    const filtered = await list(id, '?hoja=OCT&limit=1&estado=PENDIENTE');
    expect(filtered.data).toHaveLength(1);
    const dto = body(filtered);
    const p = (await preview(id, dto).expect(201)).body;
    expect(p.total).toBe(4);
    expect(new Set(p.filas.map((r: { hoja: string }) => r.hoja))).toEqual(new Set(['OCT', 'NOV']));
    await save(id, dto).expect(200);
    expect((await list(id, '?hoja=NOV&estado=RESUELTA')).pagination.total).toBe(2);
  });
  it('restaurar APP o volver a asignar el producto no recupera automáticamente decisiones anteriores', async () => {
    const { id, result } = await fixture();
    await save(id, body(result)).expect(200);
    let r = await list(id);
    const productId = r.data[0].campos.PRODUCTO.destino.id;
    const tariffId = r.catalogos.TARIFA.find(
      (t: { productoId: string; precio: number }) => t.productoId === productId && t.precio === 75,
    ).id;
    await save(id, body(r, 'TARIFA', { entidadId: tariffId })).expect(200);
    r = await list(id);
    const row = r.data[0].id;
    await correct(id, row, 1, { APP: 'K13PLAYER' }).expect(200);
    await correct(id, row, 2, { APP: 'MAXPLAYER' }).expect(200);
    r = await list(id);
    expect(r.data[0].campos.PRODUCTO.estado).toBe('REVISAR');
    expect(r.data[0].campos.TARIFA.estado).toBe('REVISAR');
    expect(r.data[1].campos.TARIFA.estado).toBe('RESUELTA');
    await save(
      id,
      body(r, 'PRODUCTO', { alcance: 'FILA', filaId: row, entidadId: productId }),
    ).expect(200);
    r = await list(id);
    expect(r.data[0].campos.PRODUCTO.estado).toBe('RESUELTA');
    expect(r.data[0].campos.TARIFA.estado).toBe('REVISAR');
    await save(id, body(r, 'TARIFA', { alcance: 'FILA', filaId: row, entidadId: tariffId })).expect(
      200,
    );
    r = await list(id);
    await save(
      id,
      body(r, 'PRODUCTO', {
        alcance: 'FILA',
        filaId: row,
        entidadId: r.catalogos.PRODUCTO.find((p: { nombre: string }) => p.nombre === 'K13PLAYER')
          .id,
      }),
    ).expect(200);
    r = await list(id);
    await save(
      id,
      body(r, 'PRODUCTO', { alcance: 'FILA', filaId: row, entidadId: productId }),
    ).expect(200);
    expect((await list(id)).data[0].campos.TARIFA.estado).toBe('REVISAR');
  }, 30000);
  it('la excepción de fila prevalece y se puede retirar explícitamente', async () => {
    const { id, result } = await fixture();
    await save(id, body(result)).expect(200);
    let r = await list(id);
    await save(
      id,
      body(r, 'PRODUCTO', {
        alcance: 'FILA',
        filaId: r.data[0].id,
        accion: 'PENDIENTE',
        entidadId: undefined,
      }),
    ).expect(200);
    r = await list(id);
    const dto = body(r);
    expect((await preview(id, dto).expect(201)).body).toMatchObject({
      total: 2,
      cambiosEfectivos: 1,
      excepcionesConservadas: 1,
      filas: [
        { despues: { estado: 'PENDIENTE', destino: null } },
        { despues: { estado: 'RESUELTA', destino: { nombre: 'MAXPLAYER' } } },
      ],
    });
    await save(id, dto).expect(200);
    r = await list(id);
    expect(r.data[0].campos.PRODUCTO.estado).toBe('PENDIENTE');
    expect(r.data[1].campos.PRODUCTO.estado).toBe('RESUELTA');
    const inherit = body(r, 'PRODUCTO', {
      alcance: 'FILA',
      filaId: r.data[0].id,
      accion: 'HEREDAR',
      entidadId: undefined,
    });
    const inheritedPreview = (await preview(id, inherit).expect(201)).body;
    expect(inheritedPreview).toMatchObject({
      destino: { nombre: 'MAXPLAYER' },
      filas: [
        {
          antes: { estado: 'PENDIENTE' },
          despues: { estado: 'RESUELTA', destino: { nombre: 'MAXPLAYER' } },
        },
      ],
    });
    expect((await list(id)).data[0].campos.PRODUCTO.estado).toBe('PENDIENTE');
    await save(id, inherit).expect(200);
    expect((await list(id)).data[0].campos.PRODUCTO.estado).toBe('RESUELTA');
  });
  it('PA no se asigna y PE no se transforma en cobro', async () => {
    const { id, result } = await fixture();
    await save(id, body(result, 'PAGO', { clave: result.data[2].campos.PAGO.clave })).expect(400);
    await save(id, body(result, 'PAGO')).expect(200);
    const r = await list(id, '?tipo=PAGO');
    expect(r.data[0].campos.PAGO.estado).toBe('RESUELTA');
    expect(r.data[0].finanzas).toBe('PENDIENTE_PAGO');
    expect(r.data[1].finanzas).toBe('PENDIENTE_CONFIRMACION');
    expect(r.data[0].importeAnual).toBe(75);
    expect(r.data[0].totalAcumulado).toBe(500);
    expect(r.data[2].campos.PAGO.estado).toBe('IGNORADO');
  });
  it('no aplica DEAD por defecto a ausencias; permite una decisión individual trazable', async () => {
    const { id, result } = await fixture();
    const missing = result.data[2];
    await save(id, body(result, 'SERVIDOR', { clave: missing.campos.SERVIDOR.clave })).expect(400);
    expect(missing.campos.SERVIDOR.destino).toBeNull();
    await save(
      id,
      body(result, 'SERVIDOR', {
        clave: missing.campos.SERVIDOR.clave,
        alcance: 'FILA',
        filaId: missing.id,
      }),
    ).expect(200);
    expect((await list(id)).data[2].campos.SERVIDOR.estado).toBe('RESUELTA');
  });
  it('solo permite servidores inactivos históricos confirmados sin reactivarlos', async () => {
    const { id, result } = await fixture();
    const cobra = result.catalogos.SERVIDOR.find((c: { nombre: string }) => c.nombre === 'COBRA');
    const dto = body(result, 'SERVIDOR', { entidadId: cobra.id });
    await save(id, dto).expect(400);
    await save(id, { ...dto, historico: true }).expect(200);
    expect((await list(id)).data[0].campos.SERVIDOR.estado).toBe('HISTORICA');
    expect((await db.servidor.findUniqueOrThrow({ where: { id: cobra.id } })).activo).toBe(false);
  });
  it('valida producto y duración de tarifa, conserva importe y avisa de precios distintos', async () => {
    const { id, result } = await fixture();
    const product = result.catalogos.PRODUCTO.find(
      (p: { nombre: string }) => p.nombre === 'MAXPLAYER',
    );
    const annual = result.catalogos.TARIFA.find(
      (t: { productoId: string; precio: number }) => t.productoId === product.id && t.precio === 75,
    );
    await save(id, body(result, 'TARIFA', { entidadId: annual.id })).expect(400);
    await save(id, body(result)).expect(200);
    let r = await list(id);
    const wrong = r.catalogos.TARIFA.find(
      (t: { productoId: string }) => t.productoId !== product.id,
    );
    await save(id, body(r, 'TARIFA', { entidadId: wrong.id })).expect(400);
    const monthly = await db.tarifa.create({
      data: { productoId: product.id, nombre: 'Mensual de prueba', duracionMeses: 1, precio: 75 },
    });
    r = await list(id);
    await save(id, body(r, 'TARIFA', { entidadId: monthly.id })).expect(400);
    await save(id, body(r, 'TARIFA', { entidadId: annual.id })).expect(200);
    r = await list(id);
    await save(id, body(r, 'SERVIDOR')).expect(200);
    r = await list(id);
    expect(r.data[0].suscripcion).toBe('RESUELTA');
    expect(r.data[0].identidad).toBe('PENDIENTE');
    expect(r.data[0].fechaInicioPropuesta).toBe('2025-10-17');
    await db.tarifa.update({ where: { id: annual.id }, data: { precio: 80 } });
    r = await list(id);
    expect(r.data[0].campos.TARIFA.estado).toBe('REVISAR');
    await save(id, body(r, 'TARIFA', { entidadId: annual.id })).expect(200);
    r = await list(id);
    expect(r.data[0].advertencias.join(' ')).toMatch(/difiere/);
    expect(r.data[0].importeAnual).toBe(75);
    await db.tarifa.update({ where: { id: annual.id }, data: { precio: 75 } });
  });
  it('conserva sugerencias ambiguas, orden y deduplicación al indexar los catálogos', async () => {
    const refName = `Referencia índice ${++serial}`;
    const first = await db.referencia.create({ data: { nombre: refName } });
    const second = await db.referencia.create({ data: { nombre: refName.toUpperCase() } });
    const { id, result } = await fixture([
      ['2026-10-17', 'Cliente índices', 'MAXPLAYER', 'DEAD', 'STR', 75, null, refName, 75],
    ]);
    await db.importacionEquivalencia.create({
      data: {
        tipo: 'REFERENCIA',
        valorOrigen: refName,
        valorClave: normalizeComparable(refName),
        valorCanonico: first.nombre,
        entidadId: first.id,
      },
    });
    // La normalización del catálogo conserva ambos candidatos; el histórico
    // no debe duplicar el candidato que también coincide por nombre.
    let r = await list(id);
    expect(r.data[0].campos.REFERENCIA.sugerencias.map((v: { id: string }) => v.id)).toEqual(
      r.catalogos.REFERENCIA.filter((v: { id: string }) =>
        [first.id, second.id].includes(v.id),
      ).map((v: { id: string }) => v.id),
    );
    await save(id, body(r)).expect(200);
    const product = result.catalogos.PRODUCTO.find(
      (p: { nombre: string }) => p.nombre === 'MAXPLAYER',
    );
    const duplicatePrice = await db.tarifa.create({
      data: {
        nombre: 'Otro precio equivalente',
        productoId: product.id,
        duracionMeses: 12,
        precio: 75,
      },
    });
    r = await list(id);
    expect(r.data[0].campos.TARIFA.sugerencias).toEqual(
      r.catalogos.TARIFA.filter(
        (t: { productoId: string; precio: number }) =>
          t.productoId === product.id && t.precio === 75,
      ),
    );
    expect(r.data[0].campos.TARIFA.sugerencias.length).toBeGreaterThan(1);
    await db.tarifa.delete({ where: { id: duplicatePrice.id } });
  });
  it('invalida solo dependencias, conserva historial tras corregir y rechaza revisiones obsoletas', async () => {
    const { id, result } = await fixture();
    await save(id, body(result)).expect(200);
    let r = await list(id);
    await save(id, body(r, 'SERVIDOR')).expect(200);
    r = await list(id);
    const stale = body(r, 'PAGO');
    await correct(id, r.data[0].id, 1, { FECHA: '2026-10-20' }).expect(200);
    await save(id, stale).expect(409);
    r = await list(id);
    expect(r.data[0].campos.PRODUCTO.estado).toBe('RESUELTA');
    expect(r.data[0].campos.SERVIDOR.estado).toBe('RESUELTA');
    await correct(id, r.data[0].id, 2, { APP: 'K13PLAYER' }).expect(200);
    r = await list(id);
    expect(r.data[0].campos.PRODUCTO.estado).toBe('REVISAR');
    expect(r.data[0].campos.SERVIDOR.estado).toBe('RESUELTA');
    expect(r.historial.length).toBeGreaterThan(0);
    expect(r.data[1].campos.PRODUCTO.estado).toBe('RESUELTA');
  });
  it('detecta catálogos modificados o borrados y bloquea escrituras simultáneas', async () => {
    const { id, result } = await fixture();
    const responses = await Promise.all([save(id, body(result)), save(id, body(result, 'PAGO'))]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    let r = await list(id);
    await save(id, body(r)).expect(200);
    r = await list(id);
    const product = r.data[0].campos.PRODUCTO.destino;
    await db.producto.update({
      where: { id: product.id },
      data: { descripcion: 'Cambio de catálogo' },
    });
    expect((await list(id)).data[0].campos.PRODUCTO.estado).toBe('REVISAR');
    await save(id, body(r)).expect(409);
    await db.producto.update({ where: { id: product.id }, data: { deletedAt: new Date() } });
    r = await list(id);
    expect(r.data[0].campos.PRODUCTO.estado).toBe('REVISAR');
    expect(r.catalogos.PRODUCTO.some((p: { id: string }) => p.id === product.id)).toBe(false);
    await db.producto.update({
      where: { id: product.id },
      data: { deletedAt: null, descripcion: null },
    });
  });
  it('excluye identidades descartadas, conserva propuestas por identidad y rechaza filas ajenas', async () => {
    const { id, result } = await fixture();
    const other = await fixture();
    await save(
      id,
      body(result, 'PRODUCTO', { alcance: 'FILA', filaId: other.result.data[0].id }),
    ).expect(400);
    await api()
      .post(`/api/v1/importaciones/${id}/identidades/preparar`)
      .set('Cookie', cookies)
      .expect(201);
    await api()
      .patch(`/api/v1/importaciones/${id}/identidades/decidir`)
      .set('Cookie', cookies)
      .send({
        version: 1,
        solicitudId: randomUUID(),
        filas: [result.data[0].id],
        accion: 'EXCLUIR',
        motivo: 'Excluida en ensayo',
      })
      .expect(200);
    let r = await list(id);
    expect(r.data[0].excluida).toBe(true);
    expect((await preview(id, body(r)).expect(201)).body.total).toBe(1);
    await api()
      .patch(`/api/v1/importaciones/${id}/identidades/decidir`)
      .set('Cookie', cookies)
      .send({
        version: 2,
        solicitudId: randomUUID(),
        filas: [result.data[1].id],
        accion: 'NUEVO',
        datos: { nombre: 'Identidad confirmada', telefono: null, email: null, observaciones: null },
        motivo: 'Identidad revisada',
      })
      .expect(200);
    r = await list(id);
    expect(r.data[1].referenciaPropia.nombre).toBe('Identidad confirmada');
    expect(r.data[1].campos.REFERENCIA.estado).toBe('SIN_DATO');
  });
  it('revierte toda la decisión si falla la auditoría', async () => {
    const { id, result } = await fixture();
    await db.$executeRawUnsafe(
      "ALTER TABLE actividad ADD CONSTRAINT equivalencia_audit_fail CHECK (accion <> 'REVISAR_EQUIVALENCIA') NOT VALID",
    );
    try {
      await save(id, body(result)).expect(500);
      expect((await list(id)).version).toBe(0);
      expect(await db.importacionEquivalenciaRevision.count({ where: { importacionId: id } })).toBe(
        0,
      );
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT equivalencia_audit_fail');
    }
  });
  it('mantiene anomalías de fecha pendientes y nunca crea operaciones', async () => {
    const { id } = await fixture([
      ['2006-10-17', 'Fecha antigua', 'MAXPLAYER', 'DEAD', 'GR', 75, null, null, 1000],
    ]);
    const r = await list(id);
    expect(r.data[0].fechaInicioPropuesta).toBeNull();
    expect(r.data[0].suscripcion).toBe('PENDIENTE');
    const free = r.catalogos.PAGO.find((c: { nombre: string }) => c.nombre === 'Gratis');
    await save(id, body(r, 'PAGO', { entidadId: free.id })).expect(200);
    expect((await list(id)).data[0].finanzas).toBe('PENDIENTE');
    for (const n of [
      await db.cliente.count(),
      await db.suscripcion.count(),
      await db.renovacion.count(),
      await db.movimientoFinanciero.count(),
    ])
      expect(n).toBe(0);
    await api()
      .post(`/api/v1/importaciones/${id}/confirmar`)
      .set('Cookie', cookies)
      .send({})
      .expect(400);
  });
});
