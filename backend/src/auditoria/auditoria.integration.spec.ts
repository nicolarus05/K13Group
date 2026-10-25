import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { seedBase } from '../../prisma/seed';
import { ClientesService } from '../clientes/clientes.service';
import { ImportacionesService } from '../importaciones/importaciones.service';

const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)('Sprint 13: auditoría y protección de escrituras', () => {
  let app: INestApplication, db: PrismaClient, jar: string[], userId: string;
  const password = 'Auditoria-prueba-2026';
  const api = () => request(app.getHttpServer());
  const get = (path = '') =>
    api()
      .get('/api/v1/auditoria' + path)
      .set('Cookie', jar);
  beforeAll(async () => {
    if (!/^catalogos_test_[a-f0-9]{32}$/.test(new URL(isolated!).searchParams.get('schema') ?? ''))
      throw new Error('Se requiere esquema aislado');
    db = new PrismaClient({ datasourceUrl: isolated });
    await seedBase(db);
    userId = (
      await db.usuario.update({
        where: { username: 'admin' },
        data: { passwordHash: await bcrypt.hash(password, 4) },
      })
    ).id;
  });
  beforeEach(async () => {
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
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password })
      .expect(200);
    jar = (res.headers['set-cookie'] as unknown as string[]).map((v) => v.split(';')[0]);
    await db.actividad.deleteMany();
  });
  afterEach(async () => {
    await app.close();
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  const event = (data: Record<string, unknown> = {}) =>
    db.actividad.create({
      data: {
        tabla: 'clientes',
        accion: 'EDITAR',
        registroId: randomUUID(),
        usuarioId: userId,
        ...data,
      },
    });

  it('exige sesión para lista, filtros y detalle; no permite modificar ni borrar el historial', async () => {
    const row = await event();
    for (const path of ['', '/filtros', '/' + row.id])
      await api()
        .get('/api/v1/auditoria' + path)
        .expect(401);
    await get().expect(200);
    await get('/filtros').expect(200);
    await get('/' + row.id).expect(200);
    await api()
      .delete('/api/v1/auditoria/' + row.id)
      .set('Cookie', jar)
      .expect(404);
    await api()
      .patch('/api/v1/auditoria/' + row.id)
      .set('Cookie', jar)
      .send({ accion: 'X' })
      .expect(404);
    expect(await db.actividad.count()).toBe(1);
  });
  it('filtra módulo, acción, usuario, sistema, registro e intervalo y valida entradas', async () => {
    const row = await event({ createdAt: new Date('2026-01-02T12:00:00Z') });
    await event({ tabla: 'recordatorios', accion: 'CREAR', usuarioId: null });
    const r = await get()
      .query({
        tabla: 'clientes',
        accion: 'EDITAR',
        usuarioId: userId,
        registroId: row.registroId,
        desde: '2026-01-01T00:00:00Z',
        hasta: '2026-01-03T00:00:00Z',
      })
      .expect(200);
    expect(r.body.data.map((v: { id: string }) => v.id)).toEqual([row.id]);
    expect((await get().query({ origen: 'sistema' })).body.data[0].usuario).toBeNull();
    for (const query of [
      { limit: 101 },
      { limit: 0 },
      { registroId: 'invalid' },
      { cursor: 'e30' },
      { desde: '2026-02-30' },
      { desde: '2026-W43' },
      { desde: '2026-297' },
      { desde: '0000-01-01' },
      {
        cursor: Buffer.from(
          JSON.stringify({
            id: randomUUID(),
            fecha: '-271821-04-20T00:00:00.000Z',
            corte: '2026-10-24T00:00:00.000Z',
          }),
        ).toString('base64url'),
      },
      { desde: '2027-01-01', hasta: '2026-01-01' },
      { usuarioId: userId, origen: 'sistema' },
      { extra: 'x' },
    ])
      await get().query(query).expect(400);
    await get('/' + randomUUID()).expect(404);
  });
  it('pagina sin duplicar empates ni incorporar altas posteriores al corte', async () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const rows = await Promise.all(Array.from({ length: 5 }, () => event({ createdAt: date })));
    const first = await get().query({ limit: 2 }).expect(200);
    await event({ createdAt: new Date(Date.now() + 60000) });
    const second = await get()
      .query({ limit: 2, cursor: first.body.pagination.siguiente })
      .expect(200);
    const third = await get()
      .query({ limit: 2, cursor: second.body.pagination.siguiente })
      .expect(200);
    expect(
      [...first.body.data, ...second.body.data, ...third.body.data]
        .map((r: { id: string }) => r.id)
        .sort(),
    ).toEqual(rows.map((r) => r.id).sort());
    expect(third.body.pagination.siguiente).toBeNull();
  });
  it('oculta secretos históricos anidados, conserva los originales y compara campos visibles', async () => {
    const row = await event({
      datosAnteriores: { nombre: 'Antes', passwordHash: 'secret-old' },
      datosNuevos: {
        nombre: 'Después',
        passwordHash: 'secret-new',
        lista: [{ access_token: 'token-secret', identificadorOperativoCifrado: 'cipher-secret' }],
      },
    });
    const list = await get().expect(200);
    expect(JSON.stringify(list.body)).not.toContain('datosNuevos');
    const res = await get('/' + row.id).expect(200),
      body = JSON.stringify(res.body);
    for (const s of ['secret-old', 'secret-new', 'token-secret', 'cipher-secret'])
      expect(body).not.toContain(s);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.cambios).toContainEqual({
      campo: 'nombre',
      anterior: 'Antes',
      nuevo: 'Después',
    });
    expect(res.body.data.cambios.some((c: { campo: string }) => c.campo === 'passwordHash')).toBe(
      false,
    );
    expect((await db.actividad.findUniqueOrThrow({ where: { id: row.id } })).datosNuevos).toEqual(
      row.datosNuevos,
    );
    const legacy = await event();
    expect((await get('/' + legacy.id)).body.data.cambios).toBeNull();
  });
  it('guarda el antes/después real en ediciones concurrentes y permite consultar un cliente retirado', async () => {
    const service = app.get(ClientesService);
    const client = await service.create({ nombre: 'Cliente auditoría' }, userId);
    await Promise.all([
      service.update(client.id, { observaciones: 'Uno' }, userId),
      service.update(client.id, { observaciones: 'Dos' }, userId),
    ]);
    const edits = await db.actividad.findMany({
      where: { registroId: client.id, accion: 'EDITAR' },
    });
    expect(edits).toHaveLength(2);
    const before = edits.map(
      (r) => (r.datosAnteriores as { observaciones: string | null }).observaciones,
    );
    expect(before.filter((v) => v === null)).toHaveLength(1);
    expect(before.filter((v) => v === 'Uno' || v === 'Dos')).toHaveLength(1);
    await service.remove(client.id, userId);
    await api()
      .get('/api/v1/clientes/' + client.id)
      .set('Cookie', jar)
      .expect(404);
    expect((await get().query({ registroId: client.id })).body.data).toHaveLength(4);
  });
  it('revierte la edición del cliente si falla la auditoría', async () => {
    const service = app.get(ClientesService),
      client = await service.create({ nombre: 'Rollback auditoría' }, userId);
    await db.$executeRawUnsafe(
      "ALTER TABLE actividad ADD CONSTRAINT reject_client_audit CHECK (tabla <> 'clientes') NOT VALID",
    );
    try {
      await expect(
        service.update(client.id, { observaciones: 'No persistir' }, userId),
      ).rejects.toThrow();
      expect(
        (await db.cliente.findUniqueOrThrow({ where: { id: client.id } })).observaciones,
      ).toBeNull();
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT reject_client_audit');
    }
  });
  it('bloquea escrituras de otro origen incluso con cookies válidas y conserva clientes CLI', async () => {
    for (const origin of ['https://evil.example', 'null', 'http://localhost:3000.evil.example']) {
      await api().post('/api/v1/auth/logout').set('Origin', origin).set('Cookie', jar).expect(403);
      await api()
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ username: 'admin', password })
        .expect(403);
    }
    await api()
      .post('/api/v1/auth/logout')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Cookie', jar)
      .expect(403);
    await get().expect(200);
    await api()
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', jar)
      .expect(200);
    await get().expect(401);
    const audit = await db.actividad.findMany({ where: { accion: 'CERRAR_SESION' } });
    expect(audit).toHaveLength(1);
    expect(audit[0].datosNuevos).toBeNull();
  });
  it('protege la programación con contraseña, rangos y auditoría', async () => {
    const state = (await api().get('/api/v1/configuracion').set('Cookie', jar)).body.data;
    for (const cambios of [
      { 'copias.conservar': 0 },
      { 'copias.intervalo_horas': 169 },
      { 'copias.automaticas_activas': 2 },
    ])
      await api()
        .patch('/api/v1/configuracion')
        .set('Cookie', jar)
        .send({ version: state.version, motivo: 'Validar programación', password, cambios })
        .expect(400);
    await api()
      .patch('/api/v1/configuracion')
      .set('Cookie', jar)
      .send({
        version: state.version,
        motivo: 'Activar programación',
        cambios: { 'copias.automaticas_activas': 1 },
      })
      .expect(403);
    await api()
      .patch('/api/v1/configuracion')
      .set('Cookie', jar)
      .send({
        version: state.version,
        motivo: 'Activar programación',
        password,
        cambios: { 'copias.automaticas_activas': 1 },
      })
      .expect(200);
    expect(await db.actividad.count({ where: { tabla: 'configuracion' } })).toBe(1);
  });
  it('un fallo de auditoría revierte tanto el alta como la revocación de sesión', async () => {
    const count = await db.sesion.count({ where: { usuarioId: userId } });
    await db.$executeRawUnsafe(
      "ALTER TABLE actividad ADD CONSTRAINT reject_session_audit CHECK (tabla <> 'cuenta') NOT VALID",
    );
    try {
      const login = await api()
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password })
        .expect(500);
      expect(login.headers['set-cookie']).toBeUndefined();
      expect(login.body.message).toBe('Error interno del servidor');
      expect(await db.sesion.count({ where: { usuarioId: userId } })).toBe(count);
      await api().post('/api/v1/auth/logout').set('Cookie', jar).expect(500);
      expect(await db.sesion.count({ where: { usuarioId: userId } })).toBe(count);
      await get().expect(200);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT reject_session_audit');
    }
    await api().post('/api/v1/auth/logout').set('Cookie', jar).expect(200);
    await get().expect(401);
    expect(await db.sesion.count({ where: { usuarioId: userId } })).toBe(count - 1);
  });
  it('las revisiones antiguas de filas y equivalencias también revierten si falla el historial', async () => {
    const service = app.get(ImportacionesService);
    const analysis = await db.importacion.create({
      data: { archivo: 'ficticio.xlsx', usuarioId: userId, versionMapeo: '1.1' },
    });
    const row = await db.importacionFila.create({
      data: {
        importacionId: analysis.id,
        hojaOrigen: 'ENE',
        filaOrigen: 2,
        hashFila: 'a'.repeat(64),
        datosOriginales: {},
        datosNormalizados: { app: null, productoClave: null },
      },
    });
    const product = await db.producto.findFirstOrThrow({ where: { activo: true } });
    await db.$executeRawUnsafe(
      "ALTER TABLE actividad ADD CONSTRAINT reject_legacy_audit CHECK (tabla NOT IN ('importacion_filas','importacion_equivalencias')) NOT VALID",
    );
    try {
      await expect(
        service.reviewRow(analysis.id, row.id, userId, { decision: 'RECHAZAR' }),
      ).rejects.toThrow();
      expect(
        (await db.importacionFila.findUniqueOrThrow({ where: { id: row.id } })).decision,
      ).toBeNull();
      await expect(
        service.saveEquivalence(analysis.id, userId, {
          tipo: 'PRODUCTO',
          valorClave: 'Audit-fixture',
          valorOrigen: 'Audit-fixture',
          valorCanonico: product.nombre,
          entidadId: product.id,
        }),
      ).rejects.toThrow();
      expect(
        await db.importacionEquivalencia.count({ where: { valorOrigen: 'Audit-fixture' } }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT reject_legacy_audit');
    }
    await service.reviewRow(analysis.id, row.id, userId, { decision: 'RECHAZAR' });
    const event = await db.actividad.findFirstOrThrow({ where: { registroId: row.id } });
    expect(event.datosAnteriores).toMatchObject({ decision: null });
    expect(event.datosNuevos).toMatchObject({ decision: 'RECHAZAR' });
    const dto = {
      tipo: 'PRODUCTO' as const,
      valorClave: 'Audit-fixture',
      valorOrigen: 'Audit-fixture',
      valorCanonico: product.nombre,
      entidadId: product.id,
    };
    const equivalence = await service.saveEquivalence(analysis.id, userId, dto);
    await service.saveEquivalence(analysis.id, userId, { ...dto, valorOrigen: 'Audit-cambiado' });
    const updates = await db.actividad.findMany({
      where: { registroId: equivalence.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(updates).toHaveLength(2);
    expect(updates[0].datosAnteriores).toBeNull();
    expect(updates[1].datosAnteriores).toMatchObject({ valorOrigen: 'Audit-fixture' });
    expect(updates[1].datosNuevos).toMatchObject({ valorOrigen: 'Audit-cambiado' });
  });
});
