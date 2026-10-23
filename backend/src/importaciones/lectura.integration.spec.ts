import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { seedBase } from '../../prisma/seed';
import { PARSER_VERSION } from './excel-validation';

const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)('Lectura 12.1 aislada: previsualización y corrección', () => {
  let app: INestApplication, db: PrismaClient, cookies: string[];
  const api = () => request(app.getHttpServer());
  const file = (
    name = 'Cliente ficticio',
    state = 'PE',
    appValue = 'MAXPLAYER 00:11:22:33:44:55',
  ) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['Título'],
        [],
        ['FECHA', 'NOMBRE', 'P.AÑO', 'PAGO', 'ESTADO', 'APP'],
        ['31/02/2026', name, '75,50', 'STR', state, appValue],
        [],
        ['2026-10-16', null, 0, 'PA', null, null],
      ]),
      'OCT',
    );
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };
  const upload = (buffer = file()) =>
    api()
      .post('/api/v1/importaciones/clientes/preview')
      .set('Cookie', cookies)
      .attach('file', buffer, 'ensayo.xlsx');
  const rows = async (id: string) =>
    (await api().get(`/api/v1/importaciones/${id}/filas`).set('Cookie', cookies).expect(200)).body
      .data;
  beforeAll(async () => {
    if (!/^catalogos_test_[a-f0-9]{32}$/.test(new URL(isolated!).searchParams.get('schema') ?? ''))
      throw new Error('Solo esquema temporal');
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
  it('exige autenticación y rechaza contenido que solo simula la extensión Excel', async () => {
    await api()
      .post('/api/v1/importaciones/clientes/preview')
      .attach('file', file(), 'ensayo.xlsx')
      .expect(401);
    await upload(Buffer.from('FECHA,NOMBRE\n2026,cliente')).expect(400);
    expect(await db.importacion.count()).toBe(0);
  });
  it('guarda coordenadas y diagnóstico sin crear clientes, suscripciones ni movimientos', async () => {
    const result = (await upload().expect(201)).body.data;
    expect(result).toMatchObject({
      soloLectura: true,
      versionMapeo: PARSER_VERSION,
      filas: 2,
      errores: 1,
      movimientosCreados: 0,
      clientesNuevos: 1,
    });
    expect(result.hojas[0]).toMatchObject({
      cabecera: 3,
      clasificacion: { operativas: 2, vacias: 1 },
    });
    const saved = await rows(result.importacionId);
    expect(saved.map((r: { filaOrigen: number }) => r.filaOrigen)).toEqual([4, 6]);
    expect(saved[0].lectura.campos.FECHA.celda).toBe('A4');
    expect(saved[0].datosNormalizados.estadoPago).toBe('PENDIENTE');
    expect(JSON.stringify(saved)).not.toContain('00:11:22:33:44:55');
    expect(
      (await db.importacionFila.findUniqueOrThrow({ where: { id: saved[0].id } })).datosOriginales,
    ).toMatchObject({ APP: 'MAXPLAYER 00:11:22:33:44:55' });
    expect(await db.cliente.count()).toBe(0);
    expect(await db.suscripcion.count()).toBe(0);
    expect(await db.movimientoFinanciero.count()).toBe(0);
    await api()
      .post(`/api/v1/importaciones/${result.importacionId}/confirmar`)
      .set('Cookie', cookies)
      .set('Idempotency-Key', 'fixture')
      .send({ confirmar: true, permitirAdvertencias: true })
      .expect(409);
    await api()
      .post(`/api/v1/importaciones/${result.importacionId}/reconciliar`)
      .set('Cookie', cookies)
      .send({ confirmarOperaciones: true, confirmarFinanzas: true })
      .expect(409);
  }, 30000);
  it('reanálisis concurrente es idempotente y conserva las correcciones del original', async () => {
    const before = await db.importacion.count();
    const buffer = file('Otra identidad');
    const responses = await Promise.all([upload(buffer), upload(buffer)]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const id = responses[0].body.data.importacionId;
    expect(responses[1].body.data.importacionId).toBe(id);
    expect(await db.importacion.count()).toBe(before + 1);
    const [row] = await rows(id);
    await api()
      .patch(`/api/v1/importaciones/${id}/filas/${row.id}/lectura`)
      .set('Cookie', cookies)
      .send({ version: 1, cambios: { FECHA: '28/02/2026' }, motivo: 'Revisado con el original' })
      .expect(200);
    expect((await upload(buffer).expect(201)).body.data.importacionId).toBe(id);
    const [updated] = await rows(id);
    expect(updated.datosNormalizados.fecha).toBe('2026-02-28');
    expect(updated.datosOriginales.FECHA).toBe('31/02/2026');
    expect(updated.version).toBe(2);
    expect(
      await db.actividad.count({ where: { registroId: row.id, accion: 'CORREGIR_LECTURA' } }),
    ).toBe(1);
  }, 60000);
  it('revalida contadores, filtra incidencias y no confunde vacío con cero', async () => {
    const id = (await upload().expect(201)).body.data.importacionId;
    const saved = await rows(id);
    const row = saved[1];
    const response = await api()
      .patch(`/api/v1/importaciones/${id}/filas/${row.id}/lectura`)
      .set('Cookie', cookies)
      .send({
        version: row.version,
        cambios: { NOMBRE: 'Nombre revisado', PAGO: 'GR', PANO: '0' },
        motivo: 'Revisión explícita de gratuidad',
      })
      .expect(200);
    expect(response.body.data.errores).toBe(0);
    const filtered = await api()
      .get(`/api/v1/importaciones/${id}/filas?ambito=FINANZAS`)
      .set('Cookie', cookies)
      .expect(200);
    expect(filtered.body.data.map((r: { id: string }) => r.id)).toEqual([saved[0].id]);
    expect(
      (
        await api()
          .get(`/api/v1/importaciones/${id}/filas?buscar=nombre%20revisado`)
          .set('Cookie', cookies)
          .expect(200)
      ).body.pagination.total,
    ).toBe(1);
  }, 30000);
  it('dos editores no se sobrescriben; valida campos, versión e identificadores', async () => {
    const parent = await db.importacion.findFirstOrThrow();
    const [row] = await rows(parent.id);
    const body = {
      version: row.version,
      cambios: { OBSERV: 'Ensayo' },
      motivo: 'Edición concurrente',
    };
    const responses = await Promise.all(
      [1, 2].map(() =>
        api()
          .patch(`/api/v1/importaciones/${parent.id}/filas/${row.id}/lectura`)
          .set('Cookie', cookies)
          .send(body),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    await api()
      .patch(`/api/v1/importaciones/${parent.id}/filas/${row.id}/lectura`)
      .set('Cookie', cookies)
      .send({ ...body, cambios: { usuarioId: 'intrusión' } })
      .expect(400);
    await api()
      .patch(`/api/v1/importaciones/no-uuid/filas/${row.id}/lectura`)
      .set('Cookie', cookies)
      .send(body)
      .expect(400);
  });
  it('revierte corrección y contadores si falla la auditoría', async () => {
    const parent = await db.importacion.findFirstOrThrow();
    const [row] = await rows(parent.id);
    await db.$executeRawUnsafe(
      "ALTER TABLE actividad ADD CONSTRAINT lectura_audit_fail CHECK (accion <> 'CORREGIR_LECTURA') NOT VALID",
    );
    try {
      await api()
        .patch(`/api/v1/importaciones/${parent.id}/filas/${row.id}/lectura`)
        .set('Cookie', cookies)
        .send({
          version: row.version,
          cambios: { NOMBRE: 'No persistir' },
          motivo: 'Fallo controlado',
        })
        .expect(500);
      expect((await db.importacionFila.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(
        row.version,
      );
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT lectura_audit_fail');
    }
  });
  it('una revisión antigua del mismo archivo no impide analizar la nueva versión del parser', async () => {
    const buffer = file();
    const parent = await db.importacion.findUniqueOrThrow({
      where: {
        checksum_versionMapeo: {
          checksum: createHash('sha256').update(buffer).digest('hex'),
          versionMapeo: PARSER_VERSION,
        },
      },
    });
    await db.importacion.update({ where: { id: parent.id }, data: { versionMapeo: '1.1' } });
    const before = await db.cliente.count();
    const legacy = await api()
      .post(`/api/v1/importaciones/${parent.id}/confirmar`)
      .set('Cookie', cookies)
      .set('Idempotency-Key', 'legacy-phone-review')
      .send({ confirmar: true, permitirAdvertencias: true })
      .expect(409);
    expect(legacy.body.message).toContain('contactos compartidos');
    expect(await db.cliente.count()).toBe(before);
    const matching = (await upload(buffer).expect(201)).body.data;
    expect(matching.importacionId).not.toBe(parent.id);
    expect(matching.versionMapeo).toBe(PARSER_VERSION);
    expect(
      (await db.importacion.findUniqueOrThrow({ where: { id: parent.id } })).versionMapeo,
    ).toBe('1.1');
  }, 30000);

  it('protege claves operativas cortas en lectura, correcciones e historial', async () => {
    const id = (await upload(file('Protección APP', 'PE', 'MAXPLAYER PIN=ab123')).expect(201)).body
      .data.importacionId;
    const [row] = await rows(id);
    expect(JSON.stringify(row)).not.toContain('ab123');
    expect(row.datosNormalizados.app).toBe('MAXPLAYER');
    await api()
      .patch(`/api/v1/importaciones/${id}/filas/${row.id}/lectura`)
      .set('Cookie', cookies)
      .send({
        version: row.version,
        cambios: { APP: 'DESCONOCIDA clave=cd456' },
        motivo: 'Revisión operativa',
      })
      .expect(200);
    const [corrected] = await rows(id);
    expect(JSON.stringify(corrected)).not.toMatch(/ab123|cd456/);
    expect(corrected.datosNormalizados.productoClave).toBeNull();
    expect(corrected.historialLectura).toHaveLength(1);
    const pending = await api()
      .get(`/api/v1/importaciones/${id}/valores-pendientes`)
      .set('Cookie', cookies)
      .expect(200);
    expect(JSON.stringify(pending.body)).not.toMatch(/ab123|cd456/);
  }, 30000);

  it('rechaza páginas y límites no positivos del historial sin producir errores internos', async () => {
    for (const query of ['page=0', 'page=-1', 'limit=0', 'limit=-1'])
      await api().get(`/api/v1/importaciones?${query}`).set('Cookie', cookies).expect(400);
  });
});
