import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { seedBase } from '../../prisma/seed';
import * as dates from '../suscripciones/subscription-dates';
import { RecordatoriosService } from '../recordatorios/recordatorios.service';
import { SuscripcionesService } from '../suscripciones/suscripciones.service';
import { ClientesService } from '../clientes/clientes.service';
import { RenovacionesService } from './renovaciones.service';

const isolated = process.env.TEST_DATABASE_URL;
(isolated ? describe : describe.skip)(
  'Sprint 6: renovaciones, primer pago y cobros aislados',
  () => {
    let app: INestApplication;
    let db: PrismaClient;
    let cookie: string;
    let base: {
      clienteId: string;
      productoId: string;
      tarifaId: string;
      servidorId: string;
      fechaInicio: string;
    };
    let method: string;
    let free: string;
    let clock: jest.SpyInstance;
    const api = () => request(app.getHttpServer());
    const create = async (fechaInicio = '2025-09-15') =>
      (
        await api()
          .post('/api/v1/suscripciones')
          .set('Cookie', cookie)
          .send({ ...base, fechaInicio, solicitudId: randomUUID() })
          .expect(201)
      ).body.data;
    const payment = (row: { version: number }, changes = {}) => ({
      solicitudId: randomUUID(),
      version: row.version,
      importe: '75.00',
      metodoPagoId: method,
      cobro: 'CONFIRMADO',
      ...changes,
    });
    const renew = async (row: { id: string; version: number }, changes = {}, initial = false) =>
      (
        await api()
          .post('/api/v1/suscripciones/' + row.id + (initial ? '/primer-pago' : '/renovar'))
          .set('Cookie', cookie)
          .send(payment(row, changes))
          .expect(201)
      ).body.data;
    const getSub = async (id: string) =>
      (
        await api()
          .get('/api/v1/suscripciones/' + id)
          .set('Cookie', cookie)
          .expect(200)
      ).body.data;
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
        new JwtService().sign(
          { sub: user.id, sid: (await db.sesion.create({ data: { usuarioId: user.id, token: 'fixture-access-only', expiresAt: new Date(Date.now() + 3600000) } })).id },
          { secret: process.env.JWT_SECRET, expiresIn: '30m' },
        );
      const state = await db.estado.findUniqueOrThrow({
        where: { tipo_valor: { tipo: 'cliente', valor: 'ACTIVO' } },
      });
      const client = await db.cliente.create({
        data: { nombre: 'Sprint6 cliente ficticio', estadoId: state.id },
      });
      const product = await db.producto.create({ data: { nombre: 'Sprint6 producto ficticio' } });
      const tariff = await db.tarifa.create({
        data: { nombre: 'Anual sprint6', productoId: product.id, duracionMeses: 12, precio: 75 },
      });
      const server = await db.servidor.create({ data: { nombre: 'Sprint6 servidor ficticio' } });
      method = (await db.metodoPago.create({ data: { nombre: 'Sprint6 efectivo' } })).id;
      free = (
        await db.metodoPago.create({ data: { nombre: 'Sprint6 cortesía', esGratuito: true } })
      ).id;
      base = {
        clienteId: client.id,
        productoId: product.id,
        tarifaId: tariff.id,
        servidorId: server.id,
        fechaInicio: '2025-09-15',
      };
    }, 30000);
    beforeEach(() => {
      clock = jest.spyOn(dates, 'businessDay').mockReturnValue('2026-09-25');
    });
    afterEach(() => clock.mockRestore());
    afterAll(async () => {
      await app?.close();
      await db?.$disconnect();
    });

    it('protege consultas y operaciones sin sesión', async () => {
      for (const path of [
        '/renovaciones',
        '/renovaciones/seguimiento',
        '/renovaciones/' + randomUUID(),
      ])
        await api()
          .get('/api/v1' + path)
          .expect(401);
      for (const suffix of ['renovar', 'primer-pago', 'preferencia-renovacion'])
        await api()
          .post('/api/v1/suscripciones/' + randomUUID() + '/' + suffix)
          .send({})
          .expect(401);
      for (const suffix of ['cobrar', 'cobro-adicional', 'anular'])
        await api()
          .post('/api/v1/renovaciones/' + randomUUID() + '/' + suffix)
          .send({})
          .expect(401);
    });
    it('conserva el cobro original, añade un suplemento una sola vez y no cambia la suscripción', async () => {
      const sub = await create('2026-09-01');
      const row = await renew(sub, { fechaCobro: '2026-09-01' }, true);
      const original = await db.movimientoFinanciero.findUniqueOrThrow({ where: { id: row.movimientos[0].id } });
      const beforeSub = await getSub(sub.id);
      const dto = { version: row.version, solicitudId: randomUUID(), importe: '65.00', metodoPagoId: method, fechaCobro: '2026-09-25', motivo: 'Ampliación del importe del mismo periodo' };
      const send = () => api().post(`/api/v1/renovaciones/${row.id}/cobro-adicional`).set('Cookie', cookie).send(dto);
      const results = await Promise.all([send(), send()]);
      expect(results.map(r => r.status)).toEqual([201, 201]);
      const after = results[0].body.data;
      expect(after.importe).toBe('140');
      expect(after.movimientos).toHaveLength(2);
      expect(after.movimientos.map((m: { importe: string }) => m.importe).sort()).toEqual(['65', '75']);
      expect(await db.movimientoFinanciero.findUnique({ where: { id: original.id } })).toEqual(original);
      expect(await getSub(sub.id)).toEqual(beforeSub);
      await api().post(`/api/v1/renovaciones/${row.id}/cobro-adicional`).set('Cookie', cookie).send({ ...dto, importe: '66' }).expect(409);
      await api().post(`/api/v1/renovaciones/${row.id}/cobro-adicional`).set('Cookie', cookie).send({ ...dto, solicitudId: randomUUID() }).expect(409);
      await api().post(`/api/v1/renovaciones/${row.id}/anular`).set('Cookie', cookie).send({ version: after.version, motivo: 'Anular operación completa con suplemento' }).expect(201);
      const movements = await db.movimientoFinanciero.findMany({ where: { renovacionId: row.id }, include: { estado: true } });
      expect(movements).toHaveLength(2);
      expect(movements.every(m => m.estado.valor === 'ANULADO')).toBe(true);
    });
    it('valida suplementos y no permite añadir cobros a una deuda o gratuidad', async () => {
      const sub = await create('2026-09-01');
      const row = await renew(sub, { fechaCobro: '2026-09-01' }, true);
      const dto = { version: row.version, solicitudId: randomUUID(), importe: '65', metodoPagoId: method, fechaCobro: '2026-09-25', motivo: 'Suplemento revisado' };
      for (const change of [{ importe: '0' }, { importe: '-1' }, { importe: '65.001' }, { fechaCobro: '2026-09-26' }, { fechaCobro: '2026-08-31' }, { metodoPagoId: free }])
        await api().post(`/api/v1/renovaciones/${row.id}/cobro-adicional`).set('Cookie', cookie).send({ ...dto, ...change }).expect(400);
      const pending = await renew(await create('2026-09-01'), { cobro: 'PENDIENTE', fechaPrevistaCobro: '2026-09-30' }, true);
      const gratis = await renew(await create('2026-09-01'), { importe: '0', metodoPagoId: free, motivoImporte: 'Cortesía de prueba' }, true);
      for (const target of [pending, gratis])
        await api().post(`/api/v1/renovaciones/${target.id}/cobro-adicional`).set('Cookie', cookie).send(dto).expect(409);
      expect(await db.movimientoFinanciero.count({ where: { renovacionId: row.id } })).toBe(1);
    });
    it('revierte el suplemento y su total si falla la auditoría', async () => {
      const sub = await create('2026-09-01');
      const row = await renew(sub, { fechaCobro: '2026-09-01' }, true);
      const actor = await db.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
      const invalidActor = randomUUID();
      const dto = { version: row.version, solicitudId: randomUUID(), importe: '65', metodoPagoId: method, fechaCobro: '2026-09-25', motivo: 'Rollback del suplemento' };
      await expect(app.get(RenovacionesService).addCollection(row.id, dto, invalidActor)).rejects.toThrow();
      expect((await app.get(RenovacionesService).findOne(row.id)).importe.toString()).toBe('75');
      expect(await db.movimientoFinanciero.count({ where: { operacionClave: dto.solicitudId } })).toBe(0);
      expect((await app.get(RenovacionesService).addCollection(row.id, dto, actor.id)).importe.toString()).toBe('140');
    });
    it('registra primer pago sin ampliar fechas e impide repetirlo con otra clave', async () => {
      const sub = await create('2026-09-01');
      const row = await renew(sub, { fechaCobro: '2026-09-01' }, true);
      expect(row.tipoOperacion).toBe('ALTA');
      expect(row.fechaInicio).toBe(sub.fechaInicio);
      expect(row.fechaFin).toBe(sub.fechaFin);
      expect(row.movimientos).toHaveLength(1);
      expect(row.movimientos[0].estado.valor).toBe('CONFIRMADO');
      expect(row.movimientos[0].fechaCobro.slice(0, 10)).toBe('2026-09-01');
      const current = await getSub(sub.id);
      expect(current.fechaFin).toBe(sub.fechaFin);
      await api()
        .post('/api/v1/suscripciones/' + sub.id + '/primer-pago')
        .set('Cookie', cookie)
        .send(payment(current))
        .expect(409);
      expect(await db.renovacion.count({ where: { suscripcionId: sub.id } })).toBe(1);
    });
    it('primer pago pendiente se cobra sin modificar periodo ni versión de suscripción', async () => {
      const sub = await create('2026-09-01');
      const row = await renew(sub, { cobro: 'PENDIENTE', fechaPrevistaCobro: '2026-09-30' }, true);
      const before = await getSub(sub.id);
      clock.mockReturnValue('2026-09-30');
      await api()
        .post('/api/v1/renovaciones/' + row.id + '/cobrar')
        .set('Cookie', cookie)
        .send({ version: 1, metodoPagoId: method, fechaCobro: '2026-09-30' })
        .expect(201);
      const after = await getSub(sub.id);
      expect(after.fechaInicio).toBe(before.fechaInicio);
      expect(after.fechaFin).toBe(before.fechaFin);
      expect(after.version).toBe(before.version);
    });
    it('conserva días pagados en una renovación anticipada', async () => {
      const sub = await create('2025-10-15');
      const row = await renew(sub);
      expect(row.fechaInicio.slice(0, 10)).toBe('2026-10-15');
      expect(row.fechaFin.slice(0, 10)).toBe('2027-10-15');
      expect(row.movimientos[0].fechaCobro.slice(0, 10)).toBe('2026-09-25');
      expect((await getSub(sub.id)).estado.valor).toBe('ACTIVA');
    });
    it('edita datos operativos tras renovar anticipadamente sin modificar el periodo', async () => {
      const sub = await create('2025-10-15');
      const row = await renew(sub);
      const current = await getSub(sub.id);
      const response = await api()
        .put('/api/v1/suscripciones/' + sub.id)
        .set('Cookie', cookie)
        .send({
          version: current.version,
          fechaInicio: row.fechaInicio.slice(0, 10),
          tipoDispositivo: 'TV después de renovación anticipada',
        })
        .expect(200);
      expect(response.body.data.tipoDispositivo).toBe('TV después de renovación anticipada');
      expect(response.body.data.fechaInicio).toBe(row.fechaInicio);
      expect(response.body.data.fechaFin).toBe(row.fechaFin);
      await api()
        .put('/api/v1/suscripciones/' + sub.id)
        .set('Cookie', cookie)
        .send({
          version: response.body.data.version,
          fechaInicio: '2026-09-01',
          motivoCorreccion: 'No debe alterar un periodo renovado',
        })
        .expect(409);
      await api()
        .post('/api/v1/suscripciones')
        .set('Cookie', cookie)
        .send({ ...base, fechaInicio: '2026-10-15', solicitudId: randomUUID() })
        .expect(400);
    });
    it('renombra y renueva concurrentemente sin invertir los bloqueos de catálogo y cliente', async () => {
      const sub = await create();
      const user = await db.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
      // Los proxies solo coordinan el intercalado. Servicios, transacciones y
      // bloqueos se ejecutan de verdad contra PostgreSQL, sin sleeps ni mocks de datos.
      const deferred = () => {
        let resolve!: () => void;
        const promise = new Promise<void>((done) => {
          resolve = done;
        });
        return { promise, resolve };
      };
      const renewalHasCatalogs = deferred();
      const clientAttemptedLock = deferred();
      const releaseRenewal = deferred();
      const proxied = (wrap: (tx: Prisma.TransactionClient) => Prisma.TransactionClient) =>
        new Proxy(db, {
          get(target, key) {
            if (key === '$transaction')
              return (
                work: (tx: Prisma.TransactionClient) => Promise<unknown>,
                options?: { timeout?: number },
              ) => target.$transaction((tx) => work(wrap(tx)), options);
            return Reflect.get(target, key);
          },
        }) as PrismaService;
      const renewingDb = proxied(
        (tx) =>
          new Proxy(tx, {
            get(target, key) {
              if (key === '$queryRawUnsafe')
                return async (query: string, ...values: unknown[]) => {
                  if (query.includes('FROM clientes') && query.includes('FOR UPDATE')) {
                    renewalHasCatalogs.resolve();
                    await releaseRenewal.promise;
                  }
                  return target.$queryRawUnsafe(query, ...values);
                };
              return Reflect.get(target, key);
            },
          }),
      );
      const renamingDb = proxied(
        (tx) =>
          new Proxy(tx, {
            get(target, key) {
              if (key === '$queryRaw')
                return (query: TemplateStringsArray, ...values: unknown[]) => {
                  if (values.includes('catalogo:referencias')) clientAttemptedLock.resolve();
                  return target.$queryRaw(query, ...values);
                };
              return Reflect.get(target, key);
            },
          }),
      );
      const renewalService = new RenovacionesService(renewingDb, app.get(RecordatoriosService));
      const clientService = new ClientesService(renamingDb, app.get(SuscripcionesService));
      const renewal = renewalService.create(
        sub.id,
        {
          solicitudId: randomUUID(),
          version: sub.version,
          importe: '75.00',
          metodoPagoId: method,
          cobro: 'CONFIRMADO',
        },
        user.id,
      );
      let rename: ReturnType<ClientesService['update']> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const coordination = (async () => {
          await renewalHasCatalogs.promise;
          rename = clientService.update(
            base.clienteId,
            { nombre: 'Cliente renombrado concurrentemente' },
            user.id,
          );
          // Antes del arreglo el cliente ya retenía su fila al llegar aquí:
          // al soltar la renovación se producía el deadlock real (40P01).
          await clientAttemptedLock.promise;
        })();
        await Promise.race([
          coordination,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('No se alcanzó el intercalado de bloqueos')),
              3000,
            );
          }),
        ]);
        releaseRenewal.resolve();
        const [row, client] = await Promise.all([renewal, rename!]);
        expect(row.suscripcionId).toBe(sub.id);
        expect(client.nombre).toBe('Cliente renombrado concurrentemente');
        expect(await db.referencia.count({ where: { nombre: client.nombre } })).toBe(1);
        expect(await db.renovacion.count({ where: { suscripcionId: sub.id } })).toBe(1);
      } finally {
        clearTimeout(timer);
        releaseRenewal.resolve();
        await Promise.allSettled([renewal, ...(rename ? [rename] : [])]);
      }
    });
    it('renovar el 25 y cobrar el 30 conserva el vencimiento del 25 siguiente y el mismo ingreso', async () => {
      const sub = await create();
      const row = await renew(sub, { cobro: 'PENDIENTE', fechaPrevistaCobro: '2026-09-30' });
      expect(row.estado.valor).toBe('COMPLETADA');
      expect(row.fechaInicio.slice(0, 10)).toBe('2026-09-25');
      expect(row.fechaFin.slice(0, 10)).toBe('2027-09-25');
      expect(row.movimientos[0].estado.valor).toBe('PENDIENTE');
      expect(row.movimientos[0].fechaCobro).toBeNull();
      expect(
        await db.movimientoFinanciero.count({
          where: { renovacionId: row.id, estado: { valor: 'CONFIRMADO' } },
        }),
      ).toBe(0);
      expect(await db.recordatorio.count({ where: { claveAutomatica: 'C:' + row.id } })).toBe(1);
      const other = await db.metodoPago.create({ data: { nombre: 'Sprint6 Bizum real' } });
      clock.mockReturnValue('2026-09-30');
      const dto = { version: 1, metodoPagoId: other.id, fechaCobro: '2026-09-30' };
      const results = await Promise.all(
        [1, 2].map(() =>
          api()
            .post('/api/v1/renovaciones/' + row.id + '/cobrar')
            .set('Cookie', cookie)
            .send(dto)
            .expect(201),
        ),
      );
      expect(results[0].body.data.movimientos[0].id).toBe(row.movimientos[0].id);
      expect(results[0].body.data.movimientos[0].estado.valor).toBe('CONFIRMADO');
      expect((await getSub(sub.id)).fechaFin.slice(0, 10)).toBe('2027-09-25');
      expect(
        await db.actividad.count({
          where: {
            tabla: 'movimientos_financieros',
            registroId: row.movimientos[0].id,
            accion: 'COBRAR',
          },
        }),
      ).toBe(1);
      expect(await db.recordatorio.count({ where: { claveAutomatica: 'C:' + row.id } })).toBe(0);
    });
    it('renueva en el vencimiento y ajusta el año bisiesto', async () => {
      const same = await create('2025-09-25');
      expect((await renew(same)).fechaFin.slice(0, 10)).toBe('2027-09-25');
      clock.mockReturnValue('2028-02-29');
      const leap = await create('2026-02-28');
      expect((await renew(leap)).fechaFin.slice(0, 10)).toBe('2029-02-28');
    });
    it('Gratis no genera ingreso ni deuda y rechaza combinaciones contradictorias', async () => {
      const sub = await create();
      const row = await renew(sub, { metodoPagoId: free, importe: '0' });
      expect(row.movimientos).toHaveLength(0);
      for (const change of [
        { metodoPagoId: free },
        { metodoPagoId: free, importe: '0', cobro: 'PENDIENTE', fechaPrevistaCobro: '2026-09-30' },
        { importe: '0' },
      ]) {
        const next = await create();
        await api()
          .post('/api/v1/suscripciones/' + next.id + '/renovar')
          .set('Cookie', cookie)
          .send(payment(next, change))
          .expect(400);
      }
    });
    it('misma clave concurrente crea exactamente una operación y otra carga con esa clave da conflicto', async () => {
      const sub = await create();
      const dto = payment(sub);
      const results = await Promise.all(
        [1, 2].map(() =>
          api()
            .post('/api/v1/suscripciones/' + sub.id + '/renovar')
            .set('Cookie', cookie)
            .send(dto)
            .expect(201),
        ),
      );
      expect(results[0].body.data.id).toBe(results[1].body.data.id);
      expect(await db.movimientoFinanciero.count({ where: { suscripcionId: sub.id } })).toBe(1);
      await api()
        .post('/api/v1/suscripciones/' + sub.id + '/renovar')
        .set('Cookie', cookie)
        .send({ ...dto, observaciones: 'Otra operación' })
        .expect(409);
    });
    it('dos claves distintas sobre la misma versión no amplían dos años por accidente', async () => {
      const sub = await create();
      const results = await Promise.all(
        [1, 2].map(() =>
          api()
            .post('/api/v1/suscripciones/' + sub.id + '/renovar')
            .set('Cookie', cookie)
            .send(payment(sub)),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await db.renovacion.count({ where: { suscripcionId: sub.id } })).toBe(1);
    });
    it('rechaza versión obsoleta y estados suspendido o cancelado', async () => {
      const sub = await create();
      const suspended = (
        await api()
          .post('/api/v1/suscripciones/' + sub.id + '/suspender')
          .set('Cookie', cookie)
          .send({ version: 1, motivo: 'Prueba de suspensión' })
          .expect(201)
      ).body.data;
      for (const row of [sub, suspended])
        await api()
          .post('/api/v1/suscripciones/' + sub.id + '/renovar')
          .set('Cookie', cookie)
          .send(payment(row))
          .expect(409);
      const cancelled = (
        await api()
          .post('/api/v1/suscripciones/' + sub.id + '/cancelar')
          .set('Cookie', cookie)
          .send({ version: suspended.version, motivo: 'Prueba de cancelación' })
          .expect(201)
      ).body.data;
      await api()
        .post('/api/v1/suscripciones/' + sub.id + '/renovar')
        .set('Cookie', cookie)
        .send(payment(cancelled))
        .expect(409);
    });
    it('No renovar es reversible, conserva fechas, bloquea renovación y cierra avisos', async () => {
      const sub = await create();
      const changed = (
        await api()
          .post('/api/v1/suscripciones/' + sub.id + '/preferencia-renovacion')
          .set('Cookie', cookie)
          .send({ version: sub.version, noRenovar: true, motivo: 'El cliente no quiere renovar' })
          .expect(201)
      ).body.data;
      expect(changed.fechaFin).toBe(sub.fechaFin);
      expect(
        await db.recordatorio.count({
          where: { suscripcionId: sub.id, claveAutomatica: { startsWith: 'R:' } },
        }),
      ).toBe(0);
      await api()
        .post('/api/v1/suscripciones/' + sub.id + '/renovar')
        .set('Cookie', cookie)
        .send(payment(changed))
        .expect(409);
      const allowed = (
        await api()
          .post('/api/v1/suscripciones/' + sub.id + '/preferencia-renovacion')
          .set('Cookie', cookie)
          .send({ version: changed.version, noRenovar: false, motivo: 'El cliente decide renovar' })
          .expect(201)
      ).body.data;
      await renew(allowed);
    });
    it('anula la última renovación, restaura el periodo, anula el ingreso y no borra registros', async () => {
      const sub = await create();
      const row = await renew(sub);
      const dto = { version: 1, motivo: 'Renovación registrada por error' };
      await api()
        .post('/api/v1/renovaciones/' + row.id + '/anular')
        .set('Cookie', cookie)
        .send(dto)
        .expect(201);
      await api()
        .post('/api/v1/renovaciones/' + row.id + '/anular')
        .set('Cookie', cookie)
        .send(dto)
        .expect(201);
      const current = await getSub(sub.id);
      expect(current.fechaInicio).toBe(sub.fechaInicio);
      expect(current.fechaFin).toBe(sub.fechaFin);
      expect(current.estado.valor).toBe('VENCIDA');
      const saved = await db.renovacion.findUniqueOrThrow({
        where: { id: row.id },
        include: { estado: true, movimientos: { include: { estado: true } } },
      });
      expect(saved.estado!.valor).toBe('ANULADA');
      expect(saved.deletedAt).toBeNull();
      expect(saved.movimientos[0].estado.valor).toBe('ANULADO');
      await renew(current);
    });
    it('anula el primer pago sin acortar el servicio y permite corregirlo con un nuevo registro', async () => {
      const sub = await create('2026-09-01');
      const row = await renew(sub, {}, true);
      await api()
        .post('/api/v1/renovaciones/' + row.id + '/anular')
        .set('Cookie', cookie)
        .send({ version: 1, motivo: 'Error en el primer pago' })
        .expect(201);
      const current = await getSub(sub.id);
      expect(current.fechaFin).toBe(sub.fechaFin);
      const corrected = await renew(
        current,
        { importe: '70', motivoImporte: 'Descuento acordado' },
        true,
      );
      expect(corrected.id).not.toBe(row.id);
      expect(corrected.importe).toBe('70');
    });
    it('rechaza anular operaciones antiguas o reabrir una suscripción cancelada', async () => {
      const sub = await create();
      const first = await renew(sub);
      await renew(await getSub(sub.id));
      await api()
        .post('/api/v1/renovaciones/' + first.id + '/anular')
        .set('Cookie', cookie)
        .send({ version: 1, motivo: 'Error en una operación antigua' })
        .expect(409);
      const another = await create();
      const row = await renew(another);
      const current = await getSub(another.id);
      await api()
        .post('/api/v1/suscripciones/' + another.id + '/cancelar')
        .set('Cookie', cookie)
        .send({ version: current.version, motivo: 'Fin del servicio' })
        .expect(201);
      await api()
        .post('/api/v1/renovaciones/' + row.id + '/anular')
        .set('Cookie', cookie)
        .send({ version: 1, motivo: 'No debe reabrir' })
        .expect(409);
    });
    it('la deuda puede cobrarse aunque se cancele el servicio, sin reactivarlo', async () => {
      const sub = await create();
      const row = await renew(sub, { cobro: 'PENDIENTE', fechaPrevistaCobro: '2026-09-30' });
      const current = await getSub(sub.id);
      await api()
        .post('/api/v1/suscripciones/' + sub.id + '/cancelar')
        .set('Cookie', cookie)
        .send({ version: current.version, motivo: 'Cancelación con deuda' })
        .expect(201);
      await api()
        .post('/api/v1/renovaciones/' + row.id + '/cobrar')
        .set('Cookie', cookie)
        .send({ version: 1, metodoPagoId: method, fechaCobro: '2026-09-25' })
        .expect(201);
      expect((await getSub(sub.id)).estado.valor).toBe('CANCELADA');
    });
    it('revierte renovación, ingreso, fechas y avisos si falla la auditoría', async () => {
      const sub = await create();
      const before = await db.recordatorio.findMany({ where: { suscripcionId: sub.id } });
      await db.$executeRawUnsafe(
        "ALTER TABLE actividad ADD CONSTRAINT sprint6_audit_fail CHECK (tabla <> 'renovaciones') NOT VALID",
      );
      try {
        await api()
          .post('/api/v1/suscripciones/' + sub.id + '/renovar')
          .set('Cookie', cookie)
          .send(payment(sub, { cobro: 'PENDIENTE', fechaPrevistaCobro: '2026-09-30' }))
          .expect(500);
      } finally {
        await db.$executeRawUnsafe('ALTER TABLE actividad DROP CONSTRAINT sprint6_audit_fail');
      }
      expect(await db.renovacion.count({ where: { suscripcionId: sub.id } })).toBe(0);
      expect(await db.movimientoFinanciero.count({ where: { suscripcionId: sub.id } })).toBe(0);
      expect((await getSub(sub.id)).fechaFin).toBe(sub.fechaFin);
      expect(await db.recordatorio.findMany({ where: { suscripcionId: sub.id } })).toEqual(before);
    });
    it('valida importes, fechas y campos sin permitir asignación masiva', async () => {
      const sub = await create();
      for (const changes of [
        { importe: '-1' },
        { importe: '75.001' },
        { importe: null },
        { importe: '100000000' },
        { importe: '70' },
        { cobro: 'PENDIENTE' },
        { cobro: 'PENDIENTE', fechaPrevistaCobro: '2026-02-30' },
        { cobro: 'PENDIENTE', fechaPrevistaCobro: '2026-09-24' },
        { fechaCobro: '2026-09-26' },
        { estadoId: randomUUID() },
        { fechaFin: '2030-01-01' },
      ]) {
        await api()
          .post('/api/v1/suscripciones/' + sub.id + '/renovar')
          .set('Cookie', cookie)
          .send(payment(sub, changes))
          .expect(400);
      }
      expect(await db.renovacion.count({ where: { suscripcionId: sub.id } })).toBe(0);
    });
    it('rechaza métodos inactivos y conserva snapshots tras cambios de catálogo', async () => {
      const sub = await create();
      const row = await renew(sub);
      const old = row.tarifaNombreSnapshot;
      await db.tarifa.update({
        where: { id: base.tarifaId },
        data: { nombre: 'Nueva tarifa sprint6', precio: 80 },
      });
      const result = (
        await api()
          .get('/api/v1/renovaciones/' + row.id)
          .set('Cookie', cookie)
          .expect(200)
      ).body.data;
      expect(result.tarifaNombreSnapshot).toBe(old);
      expect(result.importe).toBe('75');
      await db.tarifa.update({ where: { id: base.tarifaId }, data: { precio: 75 } });
      await db.metodoPago.update({ where: { id: method }, data: { activo: false } });
      try {
        const next = await create();
        await api()
          .post('/api/v1/suscripciones/' + next.id + '/renovar')
          .set('Cookie', cookie)
          .send(payment(next))
          .expect(400);
      } finally {
        await db.metodoPago.update({ where: { id: method }, data: { activo: true } });
      }
    });
    it('seguimiento e historial filtran y paginan sin ejecutar el worker ni exponer datos sensibles', async () => {
      const sub = await create('2025-09-25');
      const worker = jest
        .spyOn(app.get(SuscripcionesService), 'syncStates')
        .mockRejectedValue(new Error('Worker no disponible'));
      try {
        const result = (
          await api()
            .get('/api/v1/renovaciones/seguimiento?vista=hoy&suscripcionId=' + sub.id)
            .set('Cookie', cookie)
            .expect(200)
        ).body;
        expect(result.pagination.total).toBe(1);
        expect(result.data[0].estado.valor).toBe('VENCIDA');
        expect(worker).not.toHaveBeenCalled();
      } finally {
        worker.mockRestore();
      }
      const row = await renew(sub, { cobro: 'PENDIENTE', fechaPrevistaCobro: '2026-09-30' });
      const history = (
        await api()
          .get(
            '/api/v1/renovaciones?cobro=PENDIENTE&suscripcionId=' +
              sub.id +
              '&desde=2026-09-25&hasta=2026-09-25',
          )
          .set('Cookie', cookie)
          .expect(200)
      ).body;
      expect(history.pagination.total).toBe(1);
      expect(history.data[0].id).toBe(row.id);
      expect(history.data[0]).not.toHaveProperty('solicitudHash');
      expect(history.data[0].suscripcion).not.toHaveProperty('identificadorOperativoCifrado');
      await api().get('/api/v1/renovaciones?limit=101').set('Cookie', cookie).expect(400);
      await api().get('/api/v1/renovaciones?desde=2026-02-30').set('Cookie', cookie).expect(400);
    });
    it('avisos repetidos/concurrentes no se duplican y cerrar uno no reabre su historial', async () => {
      const sub = await create();
      const reminders = app.get(RecordatoriosService);
      await Promise.all([reminders.sync(), reminders.sync()]);
      expect(
        await db.recordatorio.count({
          where: { suscripcionId: sub.id, claveAutomatica: { startsWith: 'R:' } },
        }),
      ).toBe(1);
      const original = await db.recordatorio.findFirstOrThrow({
        where: { suscripcionId: sub.id, claveAutomatica: { startsWith: 'R:' } },
      });
      const row = await renew(sub);
      expect(
        (
          await db.recordatorio.findUniqueOrThrow({
            where: { id: original.id },
            include: { estado: true },
          })
        ).estado.valor,
      ).toBe('COMPLETADO');
      await api()
        .post('/api/v1/renovaciones/' + row.id + '/anular')
        .set('Cookie', cookie)
        .send({ version: 1, motivo: 'Comprobar aviso nuevo' })
        .expect(201);
      const reopened = await db.recordatorio.findFirstOrThrow({
        where: { suscripcionId: sub.id, claveAutomatica: { startsWith: 'R:' } },
      });
      expect(reopened.id).not.toBe(original.id);
      expect(
        (
          await db.recordatorio.findUniqueOrThrow({
            where: { id: original.id },
            include: { estado: true },
          })
        ).estado.valor,
      ).toBe('COMPLETADO');
    }, 30000);
    it('confirma avisos por lotes, permite leer y retoma el segundo lote tras fallar sin duplicarlos', async () => {
      const reminders = app.get(RecordatoriosService);
      const state = await db.estado.findUniqueOrThrow({
        where: { tipo_valor: { tipo: 'suscripcion', valor: 'VENCIDA' } },
      });
      const ids = Array.from(
        { length: 203 },
        (_, n) => '00000000-0000-4000-8000-' + String(n + 1).padStart(12, '0'),
      );
      await db.suscripcion.createMany({
        data: ids.map((id) => ({
          id,
          clienteId: base.clienteId,
          productoId: base.productoId,
          tarifaId: base.tarifaId,
          servidorId: base.servidorId,
          estadoId: state.id,
          fechaInicio: new Date('2025-09-20'),
          fechaFin: new Date('2026-09-20'),
        })),
      });
      const original = reminders.syncSubscription.bind(reminders);
      let calls = 0;
      const failure = jest
        .spyOn(reminders, 'syncSubscription')
        .mockImplementation(async (...args) => {
          if (++calls === 101) throw new Error('Fallo de segundo lote simulado');
          return original(...args);
        });
      try {
        await expect(reminders.sync()).rejects.toThrow('segundo lote');
      } finally {
        failure.mockRestore();
      }
      expect(
        await db.recordatorio.count({
          where: { suscripcionId: { in: ids }, claveAutomatica: { not: null } },
        }),
      ).toBe(100);
      const work = reminders.sync();
      const read = await api()
        .get('/api/v1/renovaciones/seguimiento?vista=vencidas&limit=10')
        .set('Cookie', cookie)
        .expect(200);
      expect(read.body.data).toHaveLength(10);
      await work;
      await reminders.sync();
      const records = await db.recordatorio.findMany({
        where: { suscripcionId: { in: ids }, claveAutomatica: { not: null } },
      });
      expect(records).toHaveLength(203);
      expect(
        await db.actividad.count({
          where: {
            tabla: 'recordatorios',
            registroId: { in: records.map((row) => row.id) },
            accion: 'CREAR',
          },
        }),
      ).toBe(203);
    }, 30000);
  },
);
