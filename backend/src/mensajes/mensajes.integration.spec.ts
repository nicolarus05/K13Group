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
import { MensajesService } from './mensajes.service';

const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)('Plantillas y contexto de mensajes, base aislada', () => {
  let db: PrismaClient, app: INestApplication, cookie: string, actor: string;
  const api = () => request(app.getHttpServer());
  const get = (path: string) =>
    api()
      .get('/api/v1/mensajes/' + path)
      .set('Cookie', cookie);
  const put = (texto: string, version = 0, extra = {}) =>
    api()
      .put('/api/v1/mensajes/plantillas/CLIENTE_CREADO')
      .set('Cookie', cookie)
      .send({ texto, version, ...extra });
  const state = async (tipo: string, valor: string) =>
    (await db.estado.findUniqueOrThrow({ where: { tipo_valor: { tipo, valor } } })).id;
  async function fixture() {
    const client = await db.cliente.create({
      data: { nombre: 'Cliente ' + randomUUID(), estadoId: await state('cliente', 'ACTIVO') },
    });
    const product = await db.producto.create({ data: { nombre: 'Producto ' + randomUUID() } });
    const rate = await db.tarifa.create({
      data: { nombre: 'Anual', productoId: product.id, duracionMeses: 12, precio: 75 },
    });
    const server = await db.servidor.create({ data: { nombre: 'Servidor ' + randomUUID() } });
    const sub = await db.suscripcion.create({
      data: {
        clienteId: client.id,
        productoId: product.id,
        tarifaId: rate.id,
        servidorId: server.id,
        fechaInicio: new Date('2026-10-01'),
        fechaFin: new Date('2027-10-01'),
        estadoId: await state('suscripcion', 'ACTIVA'),
        identificadorOperativoCifrado: 'NO-EXPOSURE-SECRET',
      },
    });
    const method = await db.metodoPago.create({ data: { nombre: 'Método ' + randomUUID() } });
    const period = await db.renovacion.create({
      data: {
        suscripcionId: sub.id,
        fechaInicio: sub.fechaInicio,
        fechaFin: sub.fechaFin,
        fechaOperacion: sub.fechaInicio,
        importe: 140,
        metodoPagoId: method.id,
        estadoId: await state('renovacion', 'COMPLETADA'),
        tipoOperacion: 'ALTA',
        origen: 'IMPORTACION_EXCEL',
        productoNombreSnapshot: 'Aplicación histórica',
      },
    });
    async function movement(amount: number, status: string, kind = 'INGRESO') {
      return db.movimientoFinanciero.create({
        data: {
          importe: amount,
          fecha: sub.fechaInicio,
          tipoId: await state('movimiento_tipo', kind),
          estadoId: await state('movimiento_estado', status),
          renovacionId: period.id,
          suscripcionId: sub.id,
        },
      });
    }
    return { client, sub, period, method, movement };
  }
  beforeAll(async () => {
    if (
      !isolated ||
      !/^catalogos_test_[a-f0-9]{32}$/.test(new URL(isolated).searchParams.get('schema') ?? '')
    )
      throw new Error('Base no aislada');
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
    actor = (await db.usuario.findUniqueOrThrow({ where: { username: 'admin' } })).id;
    const session = await db.sesion.create({
      data: { usuarioId: actor, token: 'test-only', expiresAt: new Date(Date.now() + 3600000) },
    });
    cookie =
      'access_token=' +
      new JwtService().sign(
        { sub: actor, sid: session.id },
        { secret: process.env.JWT_SECRET, expiresIn: '30m' },
      );
  }, 30000);
  beforeEach(async () => {
    await db.configuracion.deleteMany({ where: { clave: { startsWith: 'mensajes.plantilla.' } } });
  });
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });
  it('exige autenticación y valida cliente, tipo y campos ajenos', async () => {
    await api().get('/api/v1/mensajes/plantillas').expect(401);
    await api()
      .get('/api/v1/mensajes/clientes/' + randomUUID())
      .expect(401);
    await api()
      .put('/api/v1/mensajes/plantillas/CLIENTE_CREADO')
      .send({ texto: 'Hola', version: 0 })
      .expect(401);
    await get('clientes/no-es-uuid').expect(400);
    await get('clientes/' + randomUUID()).expect(404);
    await api()
      .put('/api/v1/mensajes/plantillas/INVENTADA')
      .set('Cookie', cookie)
      .send({ texto: 'Hola', version: 0 })
      .expect(400);
    await put('Hola', 0, { contrasena: 'no-debe-guardarse' }).expect(400);
    expect(
      await db.configuracion.count({ where: { clave: { startsWith: 'mensajes.plantilla.' } } }),
    ).toBe(0);
  });
  it('devuelve cinco textos iniciales sin escribir y conserva las personalizaciones', async () => {
    const before = await db.actividad.count();
    const list = (await get('plantillas').expect(200)).body;
    expect(list.plantillas).toHaveLength(5);
    expect(list.variables).toContain('importe_pagado');
    expect(list.plantillas.every((p: { version: number }) => p.version === 0)).toBe(true);
    expect(
      await db.configuracion.count({ where: { clave: { startsWith: 'mensajes.plantilla.' } } }),
    ).toBe(0);
    expect(await db.actividad.count()).toBe(before);
    const text = 'Hola {{nombre_cliente}}! 👋\n\n{{usuario}} / {{contrasena}}';
    const result = await put(text).expect(200);
    expect(result.body.version).toBe(1);
    expect((await get('plantillas')).body.plantillas[0].texto).toBe(text);
    const event = await db.actividad.findFirstOrThrow({
      where: {
        tabla: 'plantillas_mensajes',
        registroId: (
          await db.configuracion.findUniqueOrThrow({
            where: { clave: 'mensajes.plantilla.CLIENTE_CREADO' },
          })
        ).id,
      },
    });
    expect(JSON.stringify(event)).not.toContain(text);
    expect(event.datosNuevos).toEqual({ tipo: 'CLIENTE_CREADO', version: 1 });
    const restored = await put(result.body.textoInicial, 1).expect(200);
    expect(restored.body.version).toBe(2);
  });
  it('rechaza variables desconocidas, sintaxis incompleta, texto vacío y exceso de longitud', async () => {
    for (const text of [
      ' ',
      '{{desconocida}}',
      '{{nombre_cliente}',
      '{{usuario()}}',
      '{{USUARIO}}',
      'x'.repeat(10001),
    ])
      await put(text).expect(400);
    await put('Hola', -1).expect(400);
    expect(
      await db.configuracion.count({ where: { clave: { startsWith: 'mensajes.plantilla.' } } }),
    ).toBe(0);
  });
  it('serializa dos ediciones concurrentes y protege la versión guardada', async () => {
    const results = await Promise.all([put('Primera'), put('Segunda')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!.body;
    await put('Borrador antiguo', 0).expect(409);
    expect((await get('plantillas')).body.plantillas[0].texto).toBe(winner.texto);
  });
  it('revierte también el texto si falla la auditoría', async () => {
    await expect(
      app
        .get(MensajesService)
        .save('CLIENTE_CREADO', { texto: 'No persistir', version: 0 }, randomUUID()),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(
      await db.configuracion.findUnique({ where: { clave: 'mensajes.plantilla.CLIENTE_CREADO' } }),
    ).toBeNull();
  });
  it('suma 75 + 65 en el mismo periodo y no cuenta anulaciones, gastos ni otros clientes', async () => {
    const f = await fixture();
    await f.movement(75, 'CONFIRMADO');
    await f.movement(65, 'CONFIRMADO');
    await f.movement(900, 'ANULADO');
    await f.movement(50, 'CONFIRMADO', 'GASTO');
    const other = await fixture();
    await other.movement(500, 'CONFIRMADO');
    const previousPeriod = await db.renovacion.create({
      data: {
        suscripcionId: f.sub.id,
        fechaInicio: new Date('2025-10-01'),
        fechaFin: new Date('2026-10-01'),
        importe: 30,
        metodoPagoId: f.method.id,
        estadoId: await state('renovacion', 'COMPLETADA'),
      },
    });
    await db.movimientoFinanciero.create({
      data: {
        importe: 30,
        fecha: new Date('2025-10-01'),
        tipoId: await state('movimiento_tipo', 'INGRESO'),
        estadoId: await state('movimiento_estado', 'CONFIRMADO'),
        renovacionId: previousPeriod.id,
        suscripcionId: f.sub.id,
      },
    });
    const before = await Promise.all([
      db.cliente.count(),
      db.suscripcion.count(),
      db.renovacion.count(),
      db.movimientoFinanciero.count(),
      db.actividad.count(),
    ]);
    const result = await get('clientes/' + f.client.id).expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.suscripciones).toHaveLength(1);
    expect(result.body.suscripciones[0].periodos[0]).toMatchObject({
      pagado: '140.00',
      pendiente: '0.00',
      estadoPago: 'Pagado',
      aplicacion: 'Aplicación histórica',
    });
    expect(result.body.suscripciones[0].periodos).toHaveLength(2);
    expect(result.body.suscripciones[0].periodos[1]).toMatchObject({
      id: previousPeriod.id,
      pagado: '30.00',
      vencimiento: '2026-10-01',
    });
    expect(JSON.stringify(result.body)).not.toContain('NO-EXPOSURE-SECRET');
    expect(JSON.stringify(result.body)).not.toContain(other.client.nombre);
    expect(
      await Promise.all([
        db.cliente.count(),
        db.suscripcion.count(),
        db.renovacion.count(),
        db.movimientoFinanciero.count(),
        db.actividad.count(),
      ]),
    ).toEqual(before);
  });
  it('distingue deuda, pago parcial y falta de registro sin utilizar la tarifa', async () => {
    const f = await fixture();
    const read = async () =>
      (await get('clientes/' + f.client.id)).body.suscripciones[0].periodos[0];
    expect(await read()).toMatchObject({
      pagado: null,
      pendiente: null,
      estadoPago: 'Sin registro de cobro',
    });
    await f.movement(75, 'PENDIENTE');
    expect(await read()).toMatchObject({
      pagado: '0.00',
      pendiente: '75.00',
      estadoPago: 'Pendiente',
    });
    await f.movement(65, 'CONFIRMADO');
    expect(await read()).toMatchObject({
      pagado: '65.00',
      pendiente: '75.00',
      estadoPago: 'Pago parcial',
    });
  });
  it('conserva gratuidad sin movimiento y separa periodos; excluye operaciones anuladas', async () => {
    const f = await fixture();
    await db.metodoPago.update({ where: { id: f.method.id }, data: { esGratuito: true } });
    await db.renovacion.update({ where: { id: f.period.id }, data: { importe: 0 } });
    const old = await db.renovacion.create({
      data: {
        suscripcionId: f.sub.id,
        fechaInicio: new Date('2025-10-01'),
        fechaFin: new Date('2026-10-01'),
        importe: 75,
        metodoPagoId: f.method.id,
        estadoId: await state('renovacion', 'ANULADA'),
      },
    });
    const result = (await get('clientes/' + f.client.id)).body;
    expect(result.suscripciones[0].periodos).toHaveLength(1);
    expect(result.suscripciones[0].periodos[0]).toMatchObject({
      pagado: '0.00',
      pendiente: '0.00',
      estadoPago: 'Gratuito',
    });
    expect(JSON.stringify(result)).not.toContain(old.id);
  });
  it('permite clientes sin servicios y no devuelve clientes o servicios eliminados', async () => {
    const f = await fixture();
    await db.suscripcion.update({ where: { id: f.sub.id }, data: { deletedAt: new Date() } });
    expect((await get('clientes/' + f.client.id)).body.suscripciones).toEqual([]);
    await db.cliente.update({ where: { id: f.client.id }, data: { deletedAt: new Date() } });
    await get('clientes/' + f.client.id).expect(404);
  });
});
