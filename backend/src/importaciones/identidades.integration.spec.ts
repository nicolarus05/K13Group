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
(isolated ? describe : describe.skip)('Revisión 12.2 aislada', () => {
  let app: INestApplication,
    db: PrismaClient,
    cookies: string[],
    serial = 0;
  const api = () => request(app.getHttpServer());
  const list = async (id: string) =>
    (
      await api()
        .get(`/api/v1/importaciones/${id}/identidades?limit=50`)
        .set('Cookie', cookies)
        .expect(200)
    ).body;
  const prepare = (id: string) =>
    api().post(`/api/v1/importaciones/${id}/identidades/preparar`).set('Cookie', cookies);
  const decide = (id: string, body: object) =>
    api()
      .patch(`/api/v1/importaciones/${id}/identidades/decidir`)
      .set('Cookie', cookies)
      .send(body);
  const upload = (buffer: Buffer) =>
    api()
      .post('/api/v1/importaciones/clientes/preview')
      .set('Cookie', cookies)
      .attach('file', buffer, 'identidades.xlsx');
  const fixture = async (rows?: unknown[][], prepared = true) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['FECHA', 'NOMBRE', 'TELEFONO', 'ESTADO', 'PAGO', 'P.AÑO', 'EMAIL'],
        ...(rows ?? [
          ['2026-10-17', `Cliente ${++serial}`, null, 'PE', 'PA', 75],
          ['2026-11-17', `Cliente ${serial}`, null, 'PE', 'PA', 75],
          ['2026-12-17', null, null, 'PE', 'PA', 75],
        ]),
      ]),
      'OCT',
    );
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const id = (await upload(buffer).expect(201)).body.data.importacionId;
    if (prepared) await prepare(id).expect(201);
    return { id, buffer, result: await list(id) };
  };
  const body = (version: number, filas: string[], accion = 'NUEVO', extra: object = {}) => ({
    version,
    solicitudId: randomUUID(),
    filas,
    accion,
    datos: { nombre: 'Identidad revisada', telefono: null, email: null, observaciones: null },
    motivo: 'Comprobado con el original',
    ...extra,
  });
  beforeAll(async () => {
    if (!/^catalogos_test_[a-f0-9]{32}$/.test(new URL(isolated!).searchParams.get('schema') ?? ''))
      throw new Error('Requiere esquema aislado');
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
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'admin1234' })
      .expect(200);
    cookies = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]);
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  it('exige sesión y valida parámetros y datos de la decisión', async () => {
    await api().get(`/api/v1/importaciones/${randomUUID()}/identidades`).expect(401);
    const { id, result } = await fixture();
    await api()
      .get(`/api/v1/importaciones/${id}/identidades?page=0`)
      .set('Cookie', cookies)
      .expect(400);
    await decide(
      id,
      body(1, [result.data[0].filas[0].id], 'NUEVO', { datos: { nombre: 12 }, motivo: '   ' }),
    ).expect(400);
    await decide(
      id,
      body(1, [result.data[0].filas[0].id], 'NUEVO', {
        datos: { nombre: 12, telefono: null, email: null, observaciones: null },
      }),
    ).expect(400);
  }, 30000);

  it('prepara una identidad por fila, sin fusionar nombres ni perder filas incompletas', async () => {
    const { id } = await fixture(undefined, false);
    const responses = await Promise.all([prepare(id), prepare(id)]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const result = await list(id);
    expect(result).toMatchObject({
      preparado: true,
      version: 1,
      filas: 3,
      resumen: { PENDIENTE: 2, CONFLICTO: 1 },
    });
    expect(result.data).toHaveLength(3);
    expect(result.data.flatMap((g: { filas: unknown[] }) => g.filas)).toHaveLength(3);
    expect((await list(id)).version).toBe(1);
    expect(
      await db.actividad.count({ where: { registroId: id, accion: 'PREPARAR_IDENTIDADES' } }),
    ).toBe(1);
    expect(await db.cliente.count()).toBe(0);
    expect(await db.suscripcion.count()).toBe(0);
    expect(await db.movimientoFinanciero.count()).toBe(0);
  }, 30000);

  it('agrupa, audita, reintenta idempotentemente y separa sin eliminar operaciones de origen', async () => {
    const { id, buffer, result } = await fixture();
    const rows = await db.importacionFila.findMany({
      where: { importacionId: id },
      orderBy: { filaOrigen: 'asc' },
    });
    const ids = rows.slice(0, 2).map((r) => r.id);
    const dto = body(result.version, ids);
    const response = (await decide(id, dto).expect(200)).body;
    expect((await decide(id, dto).expect(200)).body).toEqual(response);
    await decide(id, { ...dto, motivo: 'Otra decisión' }).expect(409);
    expect(
      await db.actividad.count({ where: { registroId: response.id, accion: 'DECIDIR_IDENTIDAD' } }),
    ).toBe(1);
    expect((await list(id)).data.find((g: { id: string }) => g.id === response.id)).toMatchObject({
      estado: 'NUEVO',
      filas: [{ id: ids[0] }, { id: ids[1] }],
    });
    expect((await upload(buffer).expect(201)).body.data.importacionId).toBe(id);
    expect((await list(id)).version).toBe(2);
    await decide(id, body(2, [ids[0]], 'EXCLUIR')).expect(200);
    const after = await list(id);
    expect(after.resumen).toMatchObject({ EXCLUIDO: 1, NUEVO: 0 });
    expect(
      after.data.find((g: { filas: Array<{ id: string }> }) => g.filas.some((r) => r.id === ids[1]))
        .estado,
    ).toBe('PENDIENTE');
    const saved = await db.importacionFila.findMany({
      where: { importacionId: id },
      orderBy: { filaOrigen: 'asc' },
    });
    expect(saved.map((r) => r.datosOriginales)).toEqual(rows.map((r) => r.datosOriginales));
    expect(
      saved.every(
        (r) => r.clienteId === null && r.movimientoId === null && r.suscripcionId === null,
      ),
    ).toBe(true);
  }, 30000);

  it('bloquea propuestas con teléfono ocupado y permite resolver agrupando las filas', async () => {
    const { id, result } = await fixture([
      ['2026-10-17', 'Ana Uno', '612340001'],
      ['2026-10-17', 'Luis Dos', '612340001'],
    ]);
    expect(result.resumen.CONFLICTO).toBe(2);
    const ids = result.data.map((g: { filas: Array<{ id: string }> }) => g.filas[0].id);
    const datos = { nombre: 'Ana Uno', telefono: '612340001', email: null, observaciones: null };
    await decide(id, body(1, [ids[0]], 'NUEVO', { datos })).expect(200);
    await decide(id, body(2, [ids[1]], 'NUEVO', { datos })).expect(409);
    await decide(id, body(2, ids, 'NUEVO', { datos })).expect(200);
    expect((await list(id)).resumen.NUEVO).toBe(1);
    expect(await db.cliente.count()).toBe(0);
  }, 30000);

  it('detecta cambios y eliminación del cliente de destino sin sobrescribirlo', async () => {
    const state = await db.estado.findFirstOrThrow({ where: { tipo: 'cliente', valor: 'ACTIVO' } });
    const client = await db.cliente.create({
      data: {
        nombre: 'Existente',
        telefono: '612340002',
        telefonoNormalizado: '612340002',
        estadoId: state.id,
      },
    });
    const { id, result } = await fixture([['2026-10-17', 'Existente', '612340002']]);
    const row = result.data[0].filas[0].id;
    const search = async () =>
      (
        await api()
          .get(`/api/v1/importaciones/${id}/identidades/clientes?buscar=Existente`)
          .set('Cookie', cookies)
          .expect(200)
      ).body.data[0];
    const original = await search();
    await decide(
      id,
      body(1, [row], 'NUEVO', {
        datos: { nombre: 'Existente', telefono: '612340002', email: null, observaciones: null },
      }),
    ).expect(409);
    await db.cliente.update({
      where: { id: client.id },
      data: { observaciones: 'Dato actualizado' },
    });
    await decide(
      id,
      body(1, [row], 'VINCULAR', { clienteDestinoId: client.id, huellaCliente: original.huella }),
    ).expect(409);
    const current = await search();
    await decide(
      id,
      body(1, [row], 'VINCULAR', { clienteDestinoId: client.id, huellaCliente: current.huella }),
    ).expect(200);
    expect((await list(id)).resumen.VINCULADO).toBe(1);
    expect((await db.cliente.findUniqueOrThrow({ where: { id: client.id } })).observaciones).toBe(
      'Dato actualizado',
    );
    await db.cliente.update({ where: { id: client.id }, data: { nombre: 'Existente cambiado' } });
    expect((await list(id)).resumen.REVISAR).toBe(1);
    await db.cliente.update({ where: { id: client.id }, data: { deletedAt: new Date() } });
    expect((await list(id)).data[0].clienteDestino.eliminado).toBe(true);
  }, 30000);

  it('corregir la identidad invalida decisiones; una fecha de operación no lo hace', async () => {
    const { id, result } = await fixture();
    const row = result.data.find((g: { datos: { nombre: string } }) => g.datos.nombre).filas[0];
    await decide(id, body(1, [row.id])).expect(200);
    const correction = (version: number, cambios: object) =>
      api()
        .patch(`/api/v1/importaciones/${id}/filas/${row.id}/lectura`)
        .set('Cookie', cookies)
        .send({ version, cambios, motivo: 'Corrección posterior' });
    await correction(1, { FECHA: '2026-10-20' }).expect(200);
    expect((await list(id)).resumen.NUEVO).toBe(1);
    expect((await list(id)).version).toBe(2);
    await correction(2, { NOMBRE: 'Nombre corregido' }).expect(200);
    const after = await list(id);
    expect(after.resumen.REVISAR).toBe(1);
    expect(after.version).toBe(3);
    await decide(id, body(2, [row.id])).expect(409);
    const g = after.data.find((g: { filas: Array<{ id: string }> }) =>
      g.filas.some((r) => r.id === row.id),
    );
    expect(g.historial.at(-1).accion).toBe('CORREGIR_LECTURA');
    expect(g.filas[0].datos.nombre).toBe('Nombre corregido');
  }, 30000);

  it('evita sobrescrituras entre dos revisores y filas de otra importación', async () => {
    const a = await fixture(),
      b = await fixture();
    await decide(a.id, body(1, [b.result.data[0].filas[0].id])).expect(400);
    const ids = a.result.data.map((g: { filas: Array<{ id: string }> }) => g.filas[0].id);
    const responses = await Promise.all([
      decide(a.id, body(1, [ids[0]], 'PENDIENTE')),
      decide(a.id, body(1, [ids[1]], 'EXCLUIR')),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  }, 30000);

  it('revierte grupos, asignaciones y versión si falla la auditoría', async () => {
    const { id, result } = await fixture();
    const before = await db.importacionIdentidad.count({ where: { importacionId: id } });
    await db.$executeRawUnsafe(
      "ALTER TABLE actividad ADD CONSTRAINT identidad_audit_fail CHECK (accion <> 'DECIDIR_IDENTIDAD') NOT VALID",
    );
    try {
      await decide(id, body(1, [result.data[0].filas[0].id])).expect(500);
      expect((await list(id)).version).toBe(1);
      expect(await db.importacionIdentidad.count({ where: { importacionId: id } })).toBe(before);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT identidad_audit_fail');
    }
  }, 30000);
  it('no oculta contradicciones al agrupar filas pendientes y muestra emails distintos', async () => {
    const { id, result } = await fixture([
      ['2026-10-17', 'Nombre coincidente', '612340099', null, null, null, 'a@example.test'],
      ['2026-11-17', 'Nombre coincidente', '612340099', null, null, null, 'b@example.test'],
    ]);
    expect(result.resumen.CONFLICTO).toBe(2);
    expect(result.data[0].candidatos[0].motivo).toMatch(/emails distintos/);
    const ids = result.data.flatMap((g: { filas: Array<{ id: string }> }) =>
      g.filas.map((r) => r.id),
    );
    await decide(id, body(1, ids, 'PENDIENTE')).expect(200);
    const after = await list(id);
    expect(after.resumen.CONFLICTO).toBe(1);
    expect(after.data[0].problemas.join(' ')).toMatch(/filas agrupadas/);
  }, 30000);
  it('permite separar una propuesta manteniendo el teléfono y deja el resto pendiente', async () => {
    const { id, result } = await fixture([
      ['2026-10-17', 'Separación', '612349991'],
      ['2026-11-17', 'Separación', '612349991'],
    ]);
    const ids = result.data.flatMap((g: { filas: Array<{ id: string }> }) =>
      g.filas.map((r) => r.id),
    );
    const datos = { nombre: 'Separación', telefono: '612349991', email: null, observaciones: null };
    await decide(id, body(1, ids, 'NUEVO', { datos })).expect(200);
    await decide(id, body(2, [ids[0]], 'NUEVO', { datos })).expect(200);
    const after = await list(id);
    expect(after.resumen).toMatchObject({ NUEVO: 1, PENDIENTE: 1 });
    await decide(id, body(3, [ids[1]], 'NUEVO', { datos })).expect(409);
  }, 30000);

  it('conserva las decisiones y las separaciones al volver a agrupar', async () => {
    const { id, result } = await fixture();
    const ids = result.data
      .filter((g: { datos: { nombre: string } }) => g.datos.nombre)
      .flatMap((g: { filas: Array<{ id: string }> }) => g.filas.map((r) => r.id));
    await decide(id, body(1, ids, 'NUEVO')).expect(200);
    await decide(id, body(2, [ids[0]], 'EXCLUIR')).expect(200);
    await decide(id, body(3, ids, 'PENDIENTE')).expect(200);
    const group = (await list(id)).data.find((g: { filas: unknown[] }) => g.filas.length === 2);
    expect(group.historial.map((e: { accion: string }) => e.accion)).toEqual(
      expect.arrayContaining(['NUEVO', 'EXCLUIR', 'SEPARAR_FILAS', 'PENDIENTE']),
    );
    expect(new Set(group.historial.map((e: { id: string }) => e.id)).size).toBe(
      group.historial.length,
    );
  }, 30000);
});
