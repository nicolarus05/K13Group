import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { seedBase } from '../../prisma/seed';
import { corsOptions } from '../common/cors-options';

const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)('Sesiones, límites, CORS e integridad de clientes', () => {
  let db: PrismaClient;
  let app: INestApplication;
  let userId: string;
  const password = 'Security-test-only-2026';
  const api = () => request(app.getHttpServer());
  const cookies = (response: request.Response): string[] =>
    (response.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split(';')[0]);
  const login = async () =>
    cookies(
      await api().post('/api/v1/auth/login').send({ username: 'admin', password }).expect(200),
    );
  const token = (jar: string[], name: string) =>
    jar.find((c) => c.startsWith(name + '='))!.slice(name.length + 1);
  beforeAll(async () => {
    if (
      !isolated ||
      !/^catalogos_test_[a-f0-9]{32}$/.test(new URL(isolated).searchParams.get('schema') ?? '')
    )
      throw new Error('Se requiere un esquema temporal aislado');
    db = new PrismaClient({ datasourceUrl: isolated });
    await seedBase(db);
    const user = await db.usuario.update({
      where: { username: 'admin' },
      data: { passwordHash: await bcrypt.hash(password, 4) },
    });
    userId = user.id;
  });
  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.enableCors(corsOptions('http://localhost:3000'));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  it('persiste solo el hash del refresh y alinea cookies con la duración configurada', async () => {
    // Sin ajuste persistido se mantiene el valor inicial del entorno.
    await db.configuracion.deleteMany({ where: { clave: 'seguridad.access_minutos' } });
    app.get(ConfigService).set('JWT_EXPIRES_IN', '2m');
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password })
      .expect(200);
    const jar = cookies(response);
    const refresh = token(jar, 'refresh_token');
    const access = new JwtService().decode(token(jar, 'access_token'));
    const session = await db.sesion.findUniqueOrThrow({ where: { id: access.sid } });
    expect(session.token).toMatch(/^[a-f0-9]{64}$/);
    expect(session.token).not.toBe(refresh);
    const cookie = (response.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(new Date(cookie.match(/Expires=([^;]+)/)![1]).getTime()).toBe(access.exp * 1000);
    expect(access.exp - access.iat).toBe(120);
    expect(response.body.data).not.toHaveProperty('passwordHash');
    await api().get('/api/v1/auth/me').set('Cookie', jar).expect(200);
  });

  it('renueva con solo refresh, admite refresh simultáneos y conserva el vencimiento absoluto', async () => {
    const jar = await login();
    const refreshCookie = jar.filter((c) => c.startsWith('refresh_token='));
    const payload = new JwtService().decode(token(jar, 'refresh_token'));
    const before = await db.sesion.findUniqueOrThrow({ where: { id: payload.sid } });
    const expired = new JwtService().sign(
      { sub: userId, sid: payload.sid },
      { secret: process.env.JWT_SECRET, expiresIn: -1 },
    );
    await api()
      .get('/api/v1/auth/me')
      .set('Cookie', [...refreshCookie, 'access_token=' + expired])
      .expect(401);
    const results = await Promise.all(
      [1, 2].map(() => api().post('/api/v1/auth/refresh').set('Cookie', refreshCookie).expect(200)),
    );
    for (const response of results)
      await api().get('/api/v1/auth/me').set('Cookie', cookies(response)).expect(200);
    expect((await db.sesion.findUniqueOrThrow({ where: { id: payload.sid } })).expiresAt).toEqual(
      before.expiresAt,
    );
  });

  it('logout sin access revoca refresh y access copiados, manteniendo otra sesión', async () => {
    const first = await login(),
      second = await login();
    const response = await api()
      .post('/api/v1/auth/logout')
      .set(
        'Cookie',
        first.filter((c) => c.startsWith('refresh_token=')),
      )
      .expect(200);
    expect(cookies(response)).toEqual(['access_token=', 'refresh_token=']);
    await api().post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
    await api().get('/api/v1/auth/me').set('Cookie', first).expect(401);
    await api().get('/api/v1/auth/me').set('Cookie', second).expect(200);
    await api().post('/api/v1/auth/logout').expect(200);
  });

  it('logout acepta un access expirado y limpia cookies inválidas', async () => {
    const jar = await login();
    const payload = new JwtService().decode(token(jar, 'access_token'));
    const expired = new JwtService().sign(
      { sub: userId, sid: payload.sid },
      { secret: process.env.JWT_SECRET, expiresIn: -1 },
    );
    await api()
      .post('/api/v1/auth/logout')
      .set('Cookie', ['access_token=' + expired])
      .expect(200);
    await api().post('/api/v1/auth/refresh').set('Cookie', jar).expect(401);
    const response = await api()
      .post('/api/v1/auth/logout')
      .set('Cookie', ['access_token=invalid', 'refresh_token=invalid'])
      .expect(200);
    expect(cookies(response)).toEqual(['access_token=', 'refresh_token=']);
  });

  it('rechaza JWT antiguos sin sesión, sesiones caducadas y refresh cuyo hash no coincide', async () => {
    const legacy = new JwtService().sign({ sub: userId }, { secret: process.env.JWT_SECRET });
    await api()
      .get('/api/v1/auth/me')
      .set('Cookie', 'access_token=' + legacy)
      .expect(401);
    const malformed = new JwtService().sign(
      { sub: 'invalid', sid: 'invalid' },
      { secret: process.env.JWT_SECRET },
    );
    await api()
      .get('/api/v1/auth/me')
      .set('Cookie', 'access_token=' + malformed)
      .expect(401);
    const jar = await login();
    const payload = new JwtService().decode(token(jar, 'refresh_token'));
    await db.sesion.update({ where: { id: payload.sid }, data: { token: 'revoked' } });
    await api().post('/api/v1/auth/refresh').set('Cookie', jar).expect(401);
    await db.sesion.update({ where: { id: payload.sid }, data: { expiresAt: new Date(0) } });
    await api().get('/api/v1/auth/me').set('Cookie', jar).expect(401);
  });

  it('desactivar un usuario bloquea access y refresh', async () => {
    const jar = await login();
    await db.usuario.update({ where: { id: userId }, data: { activo: false } });
    try {
      await api().get('/api/v1/auth/me').set('Cookie', jar).expect(401);
      await api().post('/api/v1/auth/refresh').set('Cookie', jar).expect(401);
    } finally {
      await db.usuario.update({ where: { id: userId }, data: { activo: true } });
    }
  });

  it('limita el login a 10 peticiones por minuto sin confiar en X-Forwarded-For', async () => {
    for (let i = 0; i < 10; i++)
      await api()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '198.51.100.' + i)
        .send({ username: 'missing', password })
        .expect(401);
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ username: 'missing', password })
      .expect(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('aplica el límite general de 100 peticiones también fuera de autenticación', async () => {
    for (let i = 0; i < 100; i++) await api().get('/api/v1/clientes').expect(401);
    await api().get('/api/v1/clientes').expect(429);
    await api().get('/api/v1/productos').expect(401);
  });

  it('acepta el preflight de confirmación con Idempotency-Key desde la web', async () => {
    const response = await api()
      .options('/api/v1/importaciones/' + randomUUID() + '/confirmar')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,idempotency-key')
      .expect(204);
    expect(response.headers['access-control-allow-headers'].toLowerCase()).toContain(
      'idempotency-key',
    );
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('dos clientes distintos pueden darse de alta con un teléfono compartido normalizado', async () => {
    const jar = await login();
    const results = await Promise.all(
      ['0034 612 345 678', '+34-612-345-678'].map((telefono, i) =>
        api()
          .post('/api/v1/clientes')
          .set('Cookie', jar)
          .send({ nombre: 'Concurrente ' + i, telefono }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(2);
    expect(
      await db.cliente.count({ where: { telefonoNormalizado: '34612345678', deletedAt: null } }),
    ).toBe(2);
    const found = await api()
      .get('/api/v1/clientes?search=34612345678')
      .set('Cookie', jar)
      .expect(200);
    expect(found.body.pagination.total).toBe(2);
  });

  it('editar un teléfono compartido conserva las dos fichas independientes', async () => {
    const jar = await login();
    const rows = await Promise.all(
      ['Edición A', 'Edición B'].map(
        async (nombre) =>
          (await api().post('/api/v1/clientes').set('Cookie', jar).send({ nombre }).expect(201))
            .body.data,
      ),
    );
    const results = await Promise.all(
      rows.map((row) =>
        api()
          .put('/api/v1/clientes/' + row.id)
          .set('Cookie', jar)
          .send({ telefono: '677889900' }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(
      await db.cliente.count({
        where: { id: { in: rows.map((r) => r.id) }, telefonoNormalizado: '677889900' },
      }),
    ).toBe(2);
  });

  it('audita un único borrado y permite reutilizar su teléfono sin perder el histórico', async () => {
    const jar = await login();
    const row = (
      await api()
        .post('/api/v1/clientes')
        .set('Cookie', jar)
        .send({ nombre: 'Borrado auditable', telefono: '688990011' })
        .expect(201)
    ).body.data;
    const results = await Promise.all(
      [1, 2].map(() =>
        api()
          .delete('/api/v1/clientes/' + row.id)
          .set('Cookie', jar),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
    expect(
      await db.actividad.count({
        where: { registroId: row.id, accion: 'ELIMINAR', usuarioId: userId },
      }),
    ).toBe(1);
    expect(
      (await db.cliente.findUniqueOrThrow({ where: { id: row.id } })).deletedAt,
    ).not.toBeNull();
    await api()
      .post('/api/v1/clientes')
      .set('Cookie', jar)
      .send({ nombre: 'Reutilización', telefono: '688 990 011' })
      .expect(201);
    await api()
      .put('/api/v1/clientes/' + row.id)
      .set('Cookie', jar)
      .send({ nombre: 'No resucitar' })
      .expect(404);
  });

  it('revierte el borrado si falla la escritura de auditoría', async () => {
    const jar = await login();
    const row = (
      await api()
        .post('/api/v1/clientes')
        .set('Cookie', jar)
        .send({ nombre: 'Rollback borrado' })
        .expect(201)
    ).body.data;
    await db.$executeRawUnsafe(
      `ALTER TABLE actividad ADD CONSTRAINT security_audit_fail CHECK (accion <> 'ELIMINAR') NOT VALID`,
    );
    try {
      await api()
        .delete('/api/v1/clientes/' + row.id)
        .set('Cookie', jar)
        .expect(500);
      expect((await db.cliente.findUniqueOrThrow({ where: { id: row.id } })).deletedAt).toBeNull();
      expect(await db.actividad.count({ where: { registroId: row.id, accion: 'ELIMINAR' } })).toBe(
        0,
      );
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT security_audit_fail');
    }
  });
});
