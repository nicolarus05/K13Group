import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { seedBase } from '../../prisma/seed';
import { STATE_SYNC_BATCH_SIZE, SuscripcionesService } from './suscripciones.service';
import { businessDay, parseDay } from './subscription-dates';
import { CreateSubscriptionDto } from './suscripciones.dto';

const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)('Suscripciones: API y PostgreSQL aislado', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let cookie: string;
  let base: Omit<CreateSubscriptionDto, 'solicitudId'>;
  let service: SuscripcionesService;
  const url = '/api/v1/suscripciones';
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
    service = app.get(SuscripcionesService);
    const user = await db.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
    cookie =
      'access_token=' +
      new JwtService().sign({ sub: user.id }, { secret: process.env.JWT_SECRET, expiresIn: '10m' });
    const estado = await db.estado.findUniqueOrThrow({
      where: { tipo_valor: { tipo: 'cliente', valor: 'ACTIVO' } },
    });
    const client = await db.cliente.create({
      data: { nombre: 'Suscripciones cliente ficticio', estadoId: estado.id },
    });
    const product = await db.producto.create({
      data: { nombre: 'Suscripciones producto ficticio' },
    });
    const rate = await db.tarifa.create({
      data: { nombre: 'Anual de pruebas', productoId: product.id, duracionMeses: 12, precio: 75 },
    });
    const server = await db.servidor.create({
      data: { nombre: 'Suscripciones servidor ficticio' },
    });
    base = {
      clienteId: client.id,
      productoId: product.id,
      tarifaId: rate.id,
      servidorId: server.id,
      fechaInicio: businessDay(),
    };
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });
  const api = () => request(app.getHttpServer());
  const create = async (overrides = {}) =>
    (
      await api()
        .post(url)
        .set('Cookie', cookie)
        .send({ ...base, solicitudId: randomUUID(), ...overrides })
        .expect(201)
    ).body.data;

  it('protege lectura, escritura e historial sin sesión', async () => {
    await api().get(url).expect(401);
    await api().post(url).send({}).expect(401);
    await api()
      .get(url + '/' + randomUUID() + '/historial')
      .expect(401);
    await api()
      .post(url + '/' + randomUUID() + '/cancelar')
      .send({})
      .expect(401);
  });
  it('crea el periodo anual, audita y no genera operaciones financieras', async () => {
    const before = await db.movimientoFinanciero.count();
    const row = await create();
    expect(row.estado.valor).toBe('ACTIVA');
    expect(row.version).toBe(1);
    expect(row.fechaFin.slice(0, 4)).toBe(String(Number(base.fechaInicio.slice(0, 4)) + 1));
    expect(await db.renovacion.count({ where: { suscripcionId: row.id } })).toBe(0);
    expect(await db.movimientoFinanciero.count()).toBe(before);
    const history = await api()
      .get(url + '/' + row.id + '/historial')
      .set('Cookie', cookie)
      .expect(200);
    expect(history.body.data[0].accion).toBe('CREAR');
    expect(row).not.toHaveProperty('solicitudHash');
  });
  it('una misma solicitud concurrente crea una sola alta; claves diferentes permiten varias suscripciones', async () => {
    const dto = { ...base, solicitudId: randomUUID() };
    const responses = await Promise.all(
      [1, 2].map(() => api().post(url).set('Cookie', cookie).send(dto).expect(201)),
    );
    expect(responses[0].body.data.id).toBe(responses[1].body.data.id);
    expect(
      await db.actividad.count({
        where: { tabla: 'suscripciones', registroId: responses[0].body.data.id },
      }),
    ).toBe(1);
    await api()
      .post(url)
      .set('Cookie', cookie)
      .send({ ...dto, tipoDispositivo: 'TV' })
      .expect(409);
    expect((await create()).id).not.toBe(responses[0].body.data.id);
  });
  it('rechaza fechas imposibles/futuras, campos inmutables y tarifas incompatibles', async () => {
    for (const fields of [
      { fechaInicio: '2026-02-30' },
      { fechaInicio: '9998-01-01' },
      { productoId: randomUUID() },
      { tarifaId: randomUUID() },
      { estadoId: randomUUID() },
    ]) {
      await api()
        .post(url)
        .set('Cookie', cookie)
        .send({ ...base, solicitudId: randomUUID(), ...fields })
        .expect(400);
    }
    const row = await create();
    await api()
      .put(url + '/' + row.id)
      .set('Cookie', cookie)
      .send({ version: 1, clienteId: base.clienteId })
      .expect(400);
    await api()
      .put(url + '/' + row.id)
      .set('Cookie', cookie)
      .send({ version: 1, servidorId: null })
      .expect(400);
    await api()
      .get(url + '?limit=101')
      .set('Cookie', cookie)
      .expect(400);
    await api()
      .get(url + '/no-uuid')
      .set('Cookie', cookie)
      .expect(400);
  });
  it('rechaza altas con cliente o catálogos inactivos y mantiene referencias antiguas', async () => {
    const row = await create();
    await db.servidor.update({ where: { id: base.servidorId }, data: { activo: false } });
    await api()
      .post(url)
      .set('Cookie', cookie)
      .send({ ...base, solicitudId: randomUUID() })
      .expect(400);
    await api()
      .put(url + '/' + row.id)
      .set('Cookie', cookie)
      .send({ version: 1, tipoDispositivo: 'TV' })
      .expect(200);
    await db.servidor.update({ where: { id: base.servidorId }, data: { activo: true } });
    const inactive = await db.referencia.create({
      data: { nombre: 'Referencia inactiva sprint5', activo: false },
    });
    await api()
      .post(url)
      .set('Cookie', cookie)
      .send({ ...base, solicitudId: randomUUID(), referenciaId: inactive.id })
      .expect(400);
    await db.cliente.update({ where: { id: base.clienteId }, data: { deletedAt: new Date() } });
    await api()
      .post(url)
      .set('Cookie', cookie)
      .send({ ...base, solicitudId: randomUUID() })
      .expect(400);
    await db.cliente.update({ where: { id: base.clienteId }, data: { deletedAt: null } });
  });
  it('detecta conflictos de versión entre ediciones concurrentes', async () => {
    const row = await create();
    const responses = await Promise.all(
      ['TV', 'Móvil'].map((tipoDispositivo) =>
        api()
          .put(url + '/' + row.id)
          .set('Cookie', cookie)
          .send({ version: 1, tipoDispositivo }),
      ),
    );
    expect(responses.map((result) => result.status).sort()).toEqual([200, 409]);
  });
  it('suspende, reactiva sin ampliar fechas y cancela definitivamente con motivo', async () => {
    let row = await create({ fechaInicio: '2020-01-01' });
    expect(row.estado.valor).toBe('VENCIDA');
    const end = row.fechaFin;
    row = (
      await api()
        .post(url + '/' + row.id + '/suspender')
        .set('Cookie', cookie)
        .send({ version: row.version, motivo: 'Incidencia de prueba' })
        .expect(201)
    ).body.data;
    await service.syncStates();
    expect((await service.findOne(row.id)).estado.valor).toBe('SUSPENDIDA');
    row = (
      await api()
        .post(url + '/' + row.id + '/reactivar')
        .set('Cookie', cookie)
        .send({ version: row.version, motivo: 'Incidencia resuelta' })
        .expect(201)
    ).body.data;
    expect(row.estado.valor).toBe('VENCIDA');
    expect(row.fechaFin).toBe(end);
    await api()
      .post(url + '/' + row.id + '/cancelar')
      .set('Cookie', cookie)
      .send({ version: row.version, motivo: ' ' })
      .expect(400);
    row = (
      await api()
        .post(url + '/' + row.id + '/cancelar')
        .set('Cookie', cookie)
        .send({ version: row.version, motivo: 'Baja definitiva' })
        .expect(201)
    ).body.data;
    await api()
      .post(url + '/' + row.id + '/reactivar')
      .set('Cookie', cookie)
      .send({ version: row.version, motivo: 'Intento inválido' })
      .expect(409);
    await api()
      .put(url + '/' + row.id)
      .set('Cookie', cookie)
      .send({ version: row.version, tipoDispositivo: 'TV' })
      .expect(409);
  });
  it('actualiza y audita estados automáticamente una sola vez, también al filtrar', async () => {
    const row = await create();
    await db.suscripcion.update({
      where: { id: row.id },
      data: { fechaFin: parseDay(businessDay()) },
    });
    const result = await api()
      .get(url)
      .query({ clienteId: base.clienteId, estado: 'VENCIDA', limit: 100 })
      .set('Cookie', cookie)
      .expect(200);
    expect(result.body.data.some((item: { id: string }) => item.id === row.id)).toBe(true);
    await service.syncStates();
    const audit = await db.actividad.findMany({
      where: { registroId: row.id, accion: 'ESTADO_AUTOMATICO' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].usuarioId).toBeNull();
  });
  it('corrige fechas anuales solo con motivo, conservando el historial anterior', async () => {
    const row = await create();
    await api()
      .put(url + '/' + row.id)
      .set('Cookie', cookie)
      .send({ version: 1, fechaInicio: '2024-02-29' })
      .expect(400);
    const result = await api()
      .put(url + '/' + row.id)
      .set('Cookie', cookie)
      .send({ version: 1, fechaInicio: '2024-02-29', motivoCorreccion: 'Error de captura inicial' })
      .expect(200);
    expect(result.body.data.fechaFin.slice(0, 10)).toBe('2025-02-28');
    const audit = await db.actividad.findFirstOrThrow({
      where: { registroId: row.id, accion: 'CORREGIR_FECHAS' },
    });
    expect(audit.datosAnteriores).toHaveProperty('fechaInicio', row.fechaInicio);
  });
  it('respeta el umbral configurable y no altera fechas al recalcular estados', async () => {
    const row = await create();
    const end = new Date(parseDay(businessDay()).getTime() + 8 * 86400000);
    await db.suscripcion.update({ where: { id: row.id }, data: { fechaFin: end } });
    await db.configuracion.upsert({
      where: { clave: 'suscripciones.dias_proxima' },
      create: { clave: 'suscripciones.dias_proxima', valor: '10' },
      update: { valor: '10' },
    });
    try {
      expect((await service.findOne(row.id)).estado.valor).toBe('PROXIMA_A_VENCER');
    } finally {
      await db.configuracion.update({
        where: { clave: 'suscripciones.dias_proxima' },
        data: { valor: '7' },
      });
    }
    const after = await service.findOne(row.id);
    expect(after.estado.valor).toBe('ACTIVA');
    expect(after.fechaFin).toEqual(end);
  });
  it('conserva renovaciones y snapshots al cambiar servidor y referencia; bloquea corregir sus fechas', async () => {
    const row = await create();
    const method = await db.metodoPago.findFirstOrThrow({ where: { esGratuito: false } });
    const renewal = await db.renovacion.create({
      data: {
        suscripcionId: row.id,
        fechaInicio: new Date(row.fechaInicio),
        fechaFin: new Date(row.fechaFin),
        importe: 75,
        metodoPagoId: method.id,
        servidorNombreSnapshot: row.servidor.nombre,
        referenciaNombreSnapshot: 'Referente histórico',
      },
    });
    const server = await db.servidor.create({
      data: { nombre: 'Nuevo servidor ficticio sprint5' },
    });
    const reference = await db.referencia.create({
      data: { nombre: 'Nuevo referente ficticio sprint5' },
    });
    const updated = await api()
      .put(url + '/' + row.id)
      .set('Cookie', cookie)
      .send({ version: 1, servidorId: server.id, referenciaId: reference.id })
      .expect(200);
    await api()
      .put(url + '/' + row.id)
      .set('Cookie', cookie)
      .send({
        version: updated.body.data.version,
        fechaInicio: '2024-02-29',
        motivoCorreccion: 'No debe alterar operaciones',
      })
      .expect(409);
    expect(await db.renovacion.findUniqueOrThrow({ where: { id: renewal.id } })).toEqual(renewal);
    const cleared = await api()
      .put(url + '/' + row.id)
      .set('Cookie', cookie)
      .send({ version: updated.body.data.version, referenciaId: null })
      .expect(200);
    expect(cleared.body.data.referenciaId).toBeNull();
  });
  it('pagina listados e historial y devuelve vacío sin coincidencias', async () => {
    const result = await api()
      .get(url)
      .query({
        clienteId: base.clienteId,
        productoId: base.productoId,
        servidorId: base.servidorId,
        limit: 1,
        page: 2,
        sort: 'createdAt',
        order: 'desc',
      })
      .set('Cookie', cookie)
      .expect(200);
    expect(result.body.data).toHaveLength(1);
    expect(result.body.pagination.page).toBe(2);
    const row = await create();
    await api()
      .put(url + '/' + row.id)
      .set('Cookie', cookie)
      .send({ version: 1, tipoDispositivo: 'TV' })
      .expect(200);
    const history = await api()
      .get(url + '/' + row.id + '/historial?limit=1&page=2')
      .set('Cookie', cookie)
      .expect(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.pagination.total).toBe(2);
    expect(
      (
        await api()
          .get(url + '?search=SinNingunaCoincidencia')
          .set('Cookie', cookie)
          .expect(200)
      ).body.data,
    ).toEqual([]);
  });
  it('revierte edición y transición si falla su auditoría', async () => {
    const row = await create();
    await expect(
      service.update(row.id, { version: 1, tipoDispositivo: 'No debe guardarse' }, randomUUID()),
    ).rejects.toThrow();
    await expect(
      service.transition(
        row.id,
        'cancelar',
        { version: 1, motivo: 'No debe guardarse' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const after = await service.findOne(row.id);
    expect(after.version).toBe(1);
    expect(after.estado.valor).toBe('ACTIVA');
    expect(after.tipoDispositivo).toBeNull();
  });
  it('revierte alta y clave idempotente si falla la auditoría', async () => {
    const dto = { ...base, solicitudId: randomUUID() };
    await expect(service.create(dto, randomUUID())).rejects.toThrow();
    expect(await db.suscripcion.count({ where: { solicitudId: dto.solicitudId } })).toBe(0);
  });
  async function pendingRows(count: number) {
    const state = await db.estado.findUniqueOrThrow({
      where: { tipo_valor: { tipo: 'suscripcion', valor: 'ACTIVA' } },
    });
    const parent = await db.cliente.findUniqueOrThrow({ where: { id: base.clienteId } });
    const client = await db.cliente.create({
      data: { nombre: 'Lote ficticio ' + randomUUID(), estadoId: parent.estadoId },
    });
    const ids = Array.from({ length: count }, () => randomUUID()).sort();
    await db.suscripcion.createMany({
      data: ids.map((id) => ({
        id,
        clienteId: client.id,
        productoId: base.productoId,
        tarifaId: base.tarifaId,
        servidorId: base.servidorId,
        estadoId: state.id,
        fechaInicio: new Date('2020-01-01'),
        fechaFin: new Date('2021-01-01'),
      })),
    });
    return { client, ids, state };
  }

  it('consulta y filtra estados actuales sin recálculo global ni escrituras', async () => {
    const { client, ids, state } = await pendingRows(STATE_SYNC_BATCH_SIZE + 3);
    const sync = jest
      .spyOn(service, 'syncStates')
      .mockRejectedValue(new Error('El worker no está disponible'));
    try {
      const page = await api()
        .get(url)
        .query({ clienteId: client.id, estado: 'VENCIDA', page: 2, limit: 25 })
        .set('Cookie', cookie)
        .expect(200);
      expect(page.body.pagination.total).toBe(ids.length);
      expect(page.body.data).toHaveLength(25);
      expect(
        page.body.data.every(
          (row: { estado: { valor: string } }) => row.estado.valor === 'VENCIDA',
        ),
      ).toBe(true);
      expect(
        (
          await api()
            .get(url + '/' + ids[0])
            .set('Cookie', cookie)
            .expect(200)
        ).body.data.estado.valor,
      ).toBe('VENCIDA');
      const detail = await api()
        .get('/api/v1/clientes/' + client.id)
        .set('Cookie', cookie)
        .expect(200);
      expect(
        detail.body.data.suscripciones.every(
          (row: { estado: { valor: string } }) => row.estado.valor === 'VENCIDA',
        ),
      ).toBe(true);
      await api()
        .get(url + '/' + ids[0] + '/historial')
        .set('Cookie', cookie)
        .expect(200);
      expect(sync).not.toHaveBeenCalled();
      expect(
        await db.suscripcion.count({
          where: { clienteId: client.id, estadoId: state.id, version: 1 },
        }),
      ).toBe(ids.length);
      expect(await db.actividad.count({ where: { registroId: { in: ids } } })).toBe(0);
    } finally {
      sync.mockRestore();
    }
  });

  it('conserva lotes confirmados si falla uno posterior y reanuda sin duplicar auditoría', async () => {
    await service.syncStates();
    const { client, ids, state } = await pendingRows(STATE_SYNC_BATCH_SIZE * 2 + 3);
    // Fallo controlado en el segundo lote; solo afecta al esquema temporal validado.
    const poisonId = ids[STATE_SYNC_BATCH_SIZE];
    await db.$executeRawUnsafe(
      'ALTER TABLE "actividad" ADD CONSTRAINT "test_fallo_lote" CHECK (registro_id IS DISTINCT FROM \'' +
        poisonId +
        "'::uuid)",
    );
    try {
      await expect(service.syncStates()).rejects.toThrow();
      expect(
        await db.actividad.count({
          where: { registroId: { in: ids }, accion: 'ESTADO_AUTOMATICO' },
        }),
      ).toBe(STATE_SYNC_BATCH_SIZE);
      expect(
        await db.suscripcion.count({ where: { clienteId: client.id, estadoId: state.id } }),
      ).toBe(ids.length - STATE_SYNC_BATCH_SIZE);
      // La ficha sigue disponible incluso con el worker fallando.
      await api()
        .get('/api/v1/clientes/' + client.id)
        .set('Cookie', cookie)
        .expect(200);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "actividad" DROP CONSTRAINT "test_fallo_lote"');
    }
    expect(await service.syncStates()).toBe(ids.length - STATE_SYNC_BATCH_SIZE);
    expect(await service.syncStates()).toBe(0);
    expect(
      await db.actividad.count({ where: { registroId: { in: ids }, accion: 'ESTADO_AUTOMATICO' } }),
    ).toBe(ids.length);
  }, 30000);

  it('coordina dos workers sin duplicar estados ni auditoría entre lotes', async () => {
    await service.syncStates();
    const { ids } = await pendingRows(STATE_SYNC_BATCH_SIZE * 2 + 5);
    const result = await Promise.all([service.syncStates(), service.syncStates()]);
    expect(result.reduce((sum, changed) => sum + changed, 0)).toBe(ids.length);
    expect(
      await db.suscripcion.count({
        where: { id: { in: ids }, version: 2, estado: { valor: 'VENCIDA' } },
      }),
    ).toBe(ids.length);
    expect(
      await db.actividad.count({ where: { registroId: { in: ids }, accion: 'ESTADO_AUTOMATICO' } }),
    ).toBe(ids.length);
  }, 30000);

  it('una acción sincroniza solo su registro pendiente, sin depender del worker global', async () => {
    const { ids, state } = await pendingRows(3);
    const sync = jest
      .spyOn(service, 'syncStates')
      .mockRejectedValue(new Error('Worker fuera de servicio'));
    try {
      const response = await api()
        .post(url + '/' + ids[0] + '/suspender')
        .set('Cookie', cookie)
        .send({ version: 1, motivo: 'Pausa solicitada' })
        .expect(201);
      expect(response.body.data.estado.valor).toBe('SUSPENDIDA');
      expect(response.body.data.version).toBe(3);
      expect(sync).not.toHaveBeenCalled();
      expect(
        await db.suscripcion.count({
          where: { id: { in: ids.slice(1) }, estadoId: state.id, version: 1 },
        }),
      ).toBe(2);
      expect(await db.actividad.count({ where: { registroId: ids[0] } })).toBe(2);
      await api()
        .put(url + '/' + ids[0])
        .set('Cookie', cookie)
        .send({ version: 1, tipoDispositivo: 'TV' })
        .expect(409);
    } finally {
      sync.mockRestore();
    }
  });

  it('no expone identificadores operativos ni en detalle ni en la ficha del cliente', async () => {
    const row = await create();
    await db.suscripcion.update({
      where: { id: row.id },
      data: {
        identificadorOperativoCifrado: 'dato-privado-de-prueba',
        identificadorOperativoHash: 'hash-privado',
      },
    });
    const detail = await api()
      .get(url + '/' + row.id)
      .set('Cookie', cookie)
      .expect(200);
    const client = await api()
      .get('/api/v1/clientes/' + base.clienteId)
      .set('Cookie', cookie)
      .expect(200);
    expect(JSON.stringify(detail.body)).not.toContain('privado');
    expect(JSON.stringify(client.body)).not.toContain('privado');
  });
});
