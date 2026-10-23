import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { seedBase } from '../../prisma/seed';
import { ConfiguracionService } from './configuracion.service';
import { RecoveryService } from '../recovery/recovery.service';
import { UsersService } from '../users/users.service';
import { defaults } from './settings';
const sharp: typeof import('sharp').default = require('sharp');
const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)(
  'Sprint 11: configuración, cuenta, catálogos y cola de recuperación',
  () => {
    let app: INestApplication, db: PrismaClient, jar: string[], userId: string, root: string;
    const password = 'Cuenta-prueba-2026';
    const api = () => request(app.getHttpServer());
    const cookies = (r: request.Response) =>
      (r.headers['set-cookie'] as unknown as string[]).map((v) => v.split(';')[0]);
    const login = async (p = password) =>
      cookies(
        await api().post('/api/v1/auth/login').send({ username: 'admin', password: p }).expect(200),
      );
    const settings = async () =>
      (await api().get('/api/v1/configuracion').set('Cookie', jar).expect(200)).body.data;
    const patch = async (cambios: Record<string, unknown>, version?: number, secret?: string) =>
      api()
        .patch('/api/v1/configuracion')
        .set('Cookie', jar)
        .send({
          version: version ?? (await settings()).version,
          motivo: 'Prueba de ajustes',
          cambios,
          password: secret,
        });
    beforeAll(async () => {
      if (
        !/^catalogos_test_[a-f0-9]{32}$/.test(new URL(isolated!).searchParams.get('schema') ?? '')
      )
        throw new Error('Se requiere esquema aislado');
      db = new PrismaClient({ datasourceUrl: isolated });
      root = await mkdtemp(join(tmpdir(), 'k13-settings-'));
    });
    beforeEach(async () => {
      process.env.RECOVERY_DIR = root;
      process.env.RECOVERY_SECRET = 'settings-tests-only';
      process.env.ASSET_DIR = join(root, 'assets');
      await rm(root, { recursive: true, force: true });
      await mkdir(root, { recursive: true });
      await db.sesion.deleteMany();
      await seedBase(db);
      const user = await db.usuario.update({
        where: { username: 'admin' },
        data: { nombre: 'Administrador', passwordHash: await bcrypt.hash(password, 4) },
      });
      userId = user.id;
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
      jar = await login();
    });
    afterEach(async () => {
      await app.close();
      process.env.RECOVERY_DIR = '';
    });
    afterAll(async () => {
      await db.$disconnect();
      await rm(root, { recursive: true, force: true });
    });
    it('requiere sesión, limita claves/tipos/rangos y conserva valores en seed repetido', async () => {
      await api().get('/api/v1/configuracion').expect(401);
      for (const cambios of [
        { 'seed.catalogos.v1': 'x' },
        { 'suscripciones.dias_proxima': 0 },
        { 'suscripciones.dias_proxima': 366 },
        { 'interfaz.resultados_pagina': 20 },
        { 'negocio.logo_asset_id': randomUUID() },
        { 'interfaz.formato_fecha': 'texto' },
        { 'negocio.nombre': ' ' },
      ])
        expect((await patch(cambios)).status).toBe(400);
      expect(
        (await patch({ 'negocio.nombre': 'Negocio conservado', 'suscripciones.dias_proxima': 365 }))
          .status,
      ).toBe(200);
      await seedBase(db);
      expect((await settings()).valores['negocio.nombre']).toBe('Negocio conservado');
      expect(Object.keys((await settings()).valores).sort()).toEqual(Object.keys(defaults).sort());
    });
    it('solo un editor guarda y el fallo de auditoría revierte ajuste y revisión', async () => {
      const before = await settings();
      const responses = await Promise.all([
        patch({ 'negocio.nombre': 'Editor uno' }, before.version),
        patch({ 'negocio.nombre': 'Editor dos' }, before.version),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      const saved = await settings();
      await db.$executeRawUnsafe(
        `ALTER TABLE actividad ADD CONSTRAINT reject_settings_audit CHECK (tabla <> 'configuracion') NOT VALID`,
      );
      try {
        await expect(
          app.get(ConfiguracionService).update(
            {
              version: saved.version,
              cambios: { 'negocio.nombre': 'No debe guardar' },
              motivo: 'Prueba rollback',
            },
            userId,
          ),
        ).rejects.toThrow();
        expect(await settings()).toEqual(saved);
      } finally {
        await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT reject_settings_audit');
      }
    });
    it('protege parámetros, nuevas emisiones usan ajustes y no prolongan sesiones anteriores', async () => {
      expect((await patch({ 'seguridad.access_minutos': 5 }, undefined, 'incorrecta')).status).toBe(
        403,
      );
      const before = await db.sesion.findMany({ where: { usuarioId: userId } });
      expect(
        (
          await patch(
            { 'seguridad.access_minutos': 5, 'seguridad.sesion_dias': 1 },
            undefined,
            password,
          )
        ).status,
      ).toBe(200);
      const renewed = await api().post('/api/v1/auth/refresh').set('Cookie', jar).expect(200);
      const token = new JwtService().decode(cookies(renewed)[0].split('=')[1]);
      expect(token.exp - token.iat).toBe(300);
      expect(
        (await db.sesion.findUniqueOrThrow({ where: { id: before[0].id } })).expiresAt,
      ).toEqual(before[0].expiresAt);
      const second = await login();
      const refresh = new JwtService().decode(second[1].split('=')[1]);
      expect(refresh.exp - refresh.iat).toBe(86400);
      await db.sesion.update({
        where: { id: token.sid },
        data: { expiresAt: new Date(Date.now() + 30000) },
      });
      const capped = await api().post('/api/v1/auth/refresh').set('Cookie', jar).expect(200);
      expect(
        new JwtService().decode(cookies(capped)[0].split('=')[1]).exp - token.iat,
      ).toBeLessThanOrEqual(31);
    });
    it('valida bytes y MIME de logo; conflicto no deja assets huérfanos', async () => {
      const version = (await settings()).version;
      const image = await sharp({
        create: { width: 2, height: 2, channels: 3, background: '#123456' },
      })
        .png()
        .toBuffer();
      const upload = (v: number, mime: string, buffer = image) =>
        api()
          .post('/api/v1/configuracion/logo')
          .set('Cookie', jar)
          .field('version', v)
          .field('motivo', 'Nuevo logo')
          .attach('file', buffer, { filename: 'logo.png', contentType: mime });
      await upload(version, 'image/png', Buffer.from('<svg/>')).expect(400);
      await upload(version, 'image/jpeg').expect(400);
      const result = await upload(version, 'image/png').expect(201);
      const id = result.body.data.valores['negocio.logo_asset_id'];
      await api()
        .get('/api/v1/configuracion/logo/' + id)
        .expect(401);
      await api()
        .get('/api/v1/configuracion/logo/' + id)
        .set('Cookie', jar)
        .expect('Content-Type', /image\/webp/)
        .expect(200);
      await upload(version, 'image/png').expect(409);
      expect(await readdir(join(root, 'assets'))).toEqual([id + '.webp']);
    });
    it('permite observaciones de servidor y orden completo, atómico y versionado de pagos', async () => {
      const server = await api()
        .post('/api/v1/servidores')
        .set('Cookie', jar)
        .send({ nombre: 'Servidor ' + randomUUID(), observaciones: 'Observación conservada' })
        .expect(201);
      expect(server.body.data.observaciones).toBe('Observación conservada');
      const before = (await api().get('/api/v1/metodos-pago/orden').set('Cookie', jar).expect(200))
        .body.data;
      const ids = before.data.map((r: { id: string }) => r.id).reverse();
      const payload = { version: before.version, ids, motivo: 'Orden personalizado' };
      await api()
        .put('/api/v1/metodos-pago/orden')
        .set('Cookie', jar)
        .send({ ...payload, ids: ids.slice(1) })
        .expect(400);
      await api().put('/api/v1/metodos-pago/orden').set('Cookie', jar).send(payload).expect(200);
      await api().put('/api/v1/metodos-pago/orden').set('Cookie', jar).send(payload).expect(409);
      const rows = (
        await api()
          .get('/api/v1/metodos-pago?estado=todos&limit=100')
          .set('Cookie', jar)
          .expect(200)
      ).body.data;
      expect(rows.map((r: { id: string }) => r.id)).toEqual(ids);
    });
    it('cambio de perfil valida contraseña, versión y username único sin revelar hash', async () => {
      const profile = (await api().get('/api/v1/auth/me').set('Cookie', jar).expect(200)).body.data;
      await db.usuario.upsert({
        where: { username: 'ocupado' },
        create: { username: 'ocupado', nombre: 'Otro', passwordHash: 'irrelevante' },
        update: {},
      });
      const payload = {
        version: profile.updatedAt,
        nombre: 'Nuevo nombre',
        username: 'admin',
        password,
      };
      await api()
        .patch('/api/v1/users/me')
        .set('Cookie', jar)
        .send({ ...payload, password: 'incorrecta' })
        .expect(403);
      await api()
        .patch('/api/v1/users/me')
        .set('Cookie', jar)
        .send({ ...payload, username: 'ocupado' })
        .expect(409);
      const result = await api()
        .patch('/api/v1/users/me')
        .set('Cookie', jar)
        .send(payload)
        .expect(200);
      expect(result.body.data).not.toHaveProperty('passwordHash');
      await api().patch('/api/v1/users/me').set('Cookie', jar).send(payload).expect(409);
    });
    it('contraseña nueva revoca ambas sesiones, rechaza bytes excesivos y no audita secretos', async () => {
      const second = await login();
      const next = 'Nueva-segura-2026';
      const change = (n: string, p = password) =>
        api()
          .post('/api/v1/users/me/password')
          .set('Cookie', jar)
          .send({ password: p, nueva: n, confirmacion: n });
      await change('x'.repeat(11)).expect(400);
      await change('é'.repeat(37)).expect(400);
      await change(next, 'incorrecta').expect(403);
      await change(next).expect(201);
      for (const c of [jar, second]) {
        await api().get('/api/v1/auth/me').set('Cookie', c).expect(401);
        await api().post('/api/v1/auth/refresh').set('Cookie', c).expect(401);
      }
      await api().post('/api/v1/auth/login').send({ username: 'admin', password }).expect(401);
      await login(next);
      const audit = JSON.stringify(await db.actividad.findMany({ where: { tabla: 'cuenta' } }));
      expect(audit).not.toContain(next);
      expect(audit).not.toContain(password);
      expect(audit).not.toContain('passwordHash');
    });
    it('cierre global y cambio de contraseña revierten si falla su auditoría', async () => {
      await login();
      const before = await db.usuario.findUniqueOrThrow({ where: { id: userId } });
      const sessions = await db.sesion.count({ where: { usuarioId: userId } });
      await db.$executeRawUnsafe(
        `ALTER TABLE actividad ADD CONSTRAINT reject_account_audit CHECK (tabla <> 'cuenta') NOT VALID`,
      );
      try {
        await expect(
          app.get(UsersService).password(userId, {
            password,
            nueva: 'Clave-nueva-2026',
            confirmacion: 'Clave-nueva-2026',
          }),
        ).rejects.toThrow();
        expect((await db.usuario.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toBe(
          before.passwordHash,
        );
        expect(await db.sesion.count({ where: { usuarioId: userId } })).toBe(sessions);
      } finally {
        await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT reject_account_audit');
      }
      await api().post('/api/v1/auth/logout-all').set('Cookie', jar).send({ password }).expect(201);
      expect(await db.sesion.count({ where: { usuarioId: userId } })).toBe(0);
    });
    it('cola firmada sin contraseña, idempotencia, exclusión y estado independiente de mantenimiento', async () => {
      await writeFile(join(root, 'heartbeat'), '');
      const solicitudId = randomUUID();
      const response = await api()
        .post('/api/v1/configuracion/copias')
        .set('Cookie', jar)
        .send({ solicitudId, password })
        .expect(202);
      const same = await api()
        .post('/api/v1/configuracion/copias')
        .set('Cookie', jar)
        .send({ solicitudId, password })
        .expect(202);
      expect(same.body.data.id).toBe(solicitudId);
      await api()
        .post('/api/v1/configuracion/copias')
        .set('Cookie', jar)
        .send({ solicitudId: randomUUID(), password })
        .expect(409);
      expect(await readFile(join(root, 'jobs', solicitudId + '.request'), 'utf8')).not.toContain(
        password,
      );
      await writeFile(join(root, 'maintenance'), JSON.stringify({ job: solicitudId }));
      await api().get('/api/v1/configuracion').set('Cookie', jar).expect(503);
      await api()
        .get('/api/v1/configuracion/trabajos/' + solicitudId)
        .set('Authorization', 'Bearer ' + response.body.data.token)
        .expect(200);
      await api()
        .get('/api/v1/configuracion/trabajos/' + randomUUID())
        .set('Authorization', 'Bearer ' + response.body.data.token)
        .expect(403);
      await api()
        .get('/api/v1/configuracion/trabajos/' + solicitudId)
        .expect(403);
    });
    it('restauración requiere confirmación y contraseña; rechaza IDs y archivos ausentes', async () => {
      await writeFile(join(root, 'heartbeat'), '');
      await mkdir(join(root, 'copies'));
      const id = randomUUID();
      await writeFile(
        join(root, 'copies', id + '.json'),
        JSON.stringify({
          id,
          state: 'COMPLETADA',
          size: '100',
          createdAt: new Date().toISOString(),
          checksum: 'test',
        }),
      );
      await api()
        .post(`/api/v1/configuracion/copias/${id}/restaurar`)
        .set('Cookie', jar)
        .send({ solicitudId: randomUUID(), password, confirmacion: 'incorrecta' })
        .expect(403);
      await api()
        .post(`/api/v1/configuracion/copias/${id}/descargar`)
        .set('Cookie', jar)
        .send({ password })
        .expect(404);
      await api()
        .post('/api/v1/configuracion/copias/no-valido/restaurar')
        .set('Cookie', jar)
        .send({ solicitudId: randomUUID(), password })
        .expect(400);
    });
    it('un login que leyó la contraseña antigua no crea sesión después de cambiarla', async () => {
      const users = app.get(UsersService);
      const original = await users.findByUsername('admin');
      let resume!: () => void, started!: () => void;
      const waiting = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const spy = jest.spyOn(users, 'findByUsername').mockImplementationOnce(async () => {
        started();
        await waiting;
        return original;
      });
      const concurrent = api()
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password })
        .then((r) => r);
      await entered;
      try {
        await users.password(userId, {
          password,
          nueva: 'Cambio-concurrente-2026',
          confirmacion: 'Cambio-concurrente-2026',
        });
      } finally {
        resume();
      }
      expect((await concurrent).status).toBe(401);
      expect(await db.sesion.count({ where: { usuarioId: userId } })).toBe(0);
      spy.mockRestore();
    });
    it('limita intentos de reautenticación en el servidor', async () => {
      for (let i = 0; i < 5; i++)
        await api()
          .post('/api/v1/auth/logout-all')
          .set('Cookie', jar)
          .send({ password: 'incorrecta' })
          .expect(403);
      await api()
        .post('/api/v1/auth/logout-all')
        .set('Cookie', jar)
        .send({ password: 'incorrecta' })
        .expect(429);
    });

    it('el seed conserva un username cambiado sin recrear la cuenta admin', async () => {
      const before = await db.usuario.findUniqueOrThrow({ where: { id: userId } });
      await db.usuario.update({ where: { id: userId }, data: { username: 'operador-renombrado' } });
      try {
        await seedBase(db);
        expect(await db.usuario.findUnique({ where: { username: 'admin' } })).toBeNull();
        expect((await db.usuario.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toBe(
          before.passwordHash,
        );
      } finally {
        await db.usuario.deleteMany({ where: { username: 'admin', id: { not: userId } } });
        await db.usuario.update({ where: { id: userId }, data: { username: 'admin' } });
      }
    });
    it('reintentar un borrado ya completado devuelve el trabajo incluso sin trabajador disponible', async () => {
      await mkdir(join(root, 'copies'));
      await writeFile(join(root, 'heartbeat'), '');
      const id = randomUUID(),
        solicitudId = randomUUID();
      const copy = {
        id,
        state: 'COMPLETADA',
        size: '8',
        createdAt: new Date().toISOString(),
        checksum: 'test',
      };
      await writeFile(join(root, 'copies', id + '.json'), JSON.stringify(copy));
      const result = await api()
        .post(`/api/v1/configuracion/copias/${id}/eliminar`)
        .set('Cookie', jar)
        .send({ solicitudId, password })
        .expect(202);
      const job = JSON.parse(await readFile(join(root, 'jobs', solicitudId + '.json'), 'utf8'));
      await writeFile(
        join(root, 'jobs', solicitudId + '.json'),
        JSON.stringify({ ...job, state: 'COMPLETADA' }),
      );
      await writeFile(
        join(root, 'copies', id + '.json'),
        JSON.stringify({ ...copy, state: 'ELIMINADA' }),
      );
      await rm(join(root, 'heartbeat'));
      const retried = await api()
        .post(`/api/v1/configuracion/copias/${id}/eliminar`)
        .set('Cookie', jar)
        .send({ solicitudId, password })
        .expect(202);
      expect(retried.body.data.id).toBe(result.body.data.id);
    });
    it('una descarga abierta termina aunque se elimine la copia al mismo tiempo', async () => {
      await mkdir(join(root, 'copies'));
      const id = randomUUID(),
        content = Buffer.from('copia-ficticia');
      await writeFile(
        join(root, 'copies', id + '.json'),
        JSON.stringify({ id, state: 'COMPLETADA' }),
      );
      await writeFile(join(root, 'copies', id + '.tar'), content);
      const stream = await app.get(RecoveryService).download(id, password, userId);
      await rm(join(root, 'copies', id + '.tar'));
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(content);
    });
    it('serializa ajustes generales y protegidos simultáneos sin interbloqueos', async () => {
      const service = app.get(ConfiguracionService);
      for (let attempt = 0; attempt < 4; attempt++) {
        const { version } = await service.get();
        const results = await Promise.allSettled([
          service.update(
            {
              version,
              motivo: 'Cambio general concurrente',
              cambios: { 'negocio.nombre': 'Concurrente ' + attempt },
            },
            userId,
          ),
          service.update(
            {
              version,
              motivo: 'Cambio técnico concurrente',
              cambios: { 'seguridad.access_minutos': 15 },
              password,
            },
            userId,
          ),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason.getStatus?.()).toBe(409);
      }
    });
    it('usa los mismos valores seguros al mostrar ajustes y emitir tokens con datos legacy inválidos', async () => {
      const keys = ['seguridad.sesion_dias', 'seguridad.access_minutos'];
      const previous = await db.configuracion.findMany({ where: { clave: { in: keys } } });
      try {
        await db.configuracion.update({ where: { clave: keys[0] }, data: { valor: 'inválido' } });
        await db.configuracion.update({ where: { clave: keys[1] }, data: { valor: '-5' } });
        const values = (await settings()).valores;
        const fresh = await login();
        const jwt = app.get(JwtService);
        for (const [cookie, key, multiplier] of [
          ['refresh_token', keys[0], 86400],
          ['access_token', keys[1], 60],
        ] as const) {
          const payload = jwt.decode<{ iat: number; exp: number }>(
            fresh.find((c) => c.startsWith(cookie + '='))!.slice(cookie.length + 1),
          );
          expect(payload.exp - payload.iat).toBe(values[key] * multiplier);
        }
      } finally {
        for (const row of previous)
          await db.configuracion.update({
            where: { clave: row.clave },
            data: { valor: row.valor },
          });
      }
    });
  },
);
