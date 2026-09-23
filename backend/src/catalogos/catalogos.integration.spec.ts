import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { seedBase } from '../../prisma/seed';
import { CatalogKind } from './catalog.repository';
import { ClientesService } from '../clientes/clientes.service';
import { ProductosService } from '../productos/productos.service';

const isolated = process.env.TEST_DATABASE_URL;
const suite = isolated ? describe : describe.skip;
suite('Catálogos: API y PostgreSQL aislado', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let cookie: string;
  let productId: string;
  let tariffId: string;
  let userId: string;
  const names: CatalogKind[] = [
    'productos',
    'tarifas',
    'servidores',
    'referencias',
    'metodos-pago',
    'categorias-gasto',
  ];
  beforeAll(async () => {
    if (
      !isolated ||
      !/^catalogos_test_[a-f0-9]{32}$/.test(new URL(isolated).searchParams.get('schema') ?? '')
    )
      throw new Error('Se requiere un esquema aislado generado por test:integration.');
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
    userId = user.id;
    cookie =
      'access_token=' +
      new JwtService().sign({ sub: user.id }, { secret: process.env.JWT_SECRET, expiresIn: '10m' });
    const product = await db.producto.create({
      data: { nombre: 'Producto ficticio para tarifas' },
    });
    productId = product.id;
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });
  const api = () => request(app.getHttpServer());

  it.each(names)('%s exige autenticación para lectura y escritura', async (kind) => {
    await api()
      .get('/api/v1/' + kind)
      .expect(401);
    await api()
      .post('/api/v1/' + kind)
      .send({ nombre: 'Sin sesión' })
      .expect(401);
  });

  it.each(names)('%s permite gestionar registros y audita cada cambio', async (kind) => {
    const path = '/api/v1/' + kind;
    const extra =
      kind === 'tarifas' ? { productoId: productId, precio: 75, duracionMeses: 12 } : {};
    const response = await api()
      .post(path)
      .set('Cookie', cookie)
      .send({ nombre: '  Prúeba   ' + kind, ...extra })
      .expect(201);
    const row = response.body.data;
    expect(row.nombre).toBe('Prúeba ' + kind);
    if (kind === 'tarifas') tariffId = row.id;
    await api()
      .post(path)
      .set('Cookie', cookie)
      .send({ nombre: 'prueba ' + kind, ...extra })
      .expect(409);
    await api()
      .put(path + '/' + row.id)
      .set('Cookie', cookie)
      .send({ nombre: 'Editado ' + kind })
      .expect(200);
    await api()
      .delete(path + '/' + row.id)
      .set('Cookie', cookie)
      .expect(200);
    const active = await api()
      .get(path)
      .query({ search: 'Editado ' + kind })
      .set('Cookie', cookie)
      .expect(200);
    expect(active.body.data).toHaveLength(0);
    const inactive = await api()
      .get(path)
      .query({ estado: 'inactivo', search: 'Editado ' + kind })
      .set('Cookie', cookie)
      .expect(200);
    expect(inactive.body.data.map((item: { id: string }) => item.id)).toContain(row.id);
    await api()
      .get(path + '/' + row.id)
      .set('Cookie', cookie)
      .expect(200);
    await api()
      .post(path + '/' + row.id + '/reactivar')
      .set('Cookie', cookie)
      .expect(201);
    expect(await db.actividad.count({ where: { registroId: row.id, usuarioId: userId } })).toBe(4);
  });

  it('valida filtros, campos, nombres y precios anuales', async () => {
    await api().get('/api/v1/productos?page=0').set('Cookie', cookie).expect(400);
    await api().get('/api/v1/productos?limit=101').set('Cookie', cookie).expect(400);
    await api().get('/api/v1/productos/no-es-uuid').set('Cookie', cookie).expect(400);
    await api().post('/api/v1/productos').set('Cookie', cookie).send({ nombre: '  ' }).expect(400);
    await api().post('/api/v1/clientes').set('Cookie', cookie).send({ nombre: '  ' }).expect(400);
    await api()
      .post('/api/v1/productos')
      .set('Cookie', cookie)
      .send({ nombre: 'No tarifa', precio: 75 })
      .expect(400);
    for (const precio of [0, -1, 1.111, 100000000])
      await api()
        .post('/api/v1/tarifas')
        .set('Cookie', cookie)
        .send({ nombre: 'Inválida', productoId: productId, precio })
        .expect(400);
    await api()
      .post('/api/v1/tarifas')
      .set('Cookie', cookie)
      .send({ nombre: 'Mensual', productoId: productId, precio: 75, duracionMeses: 1 })
      .expect(400);
    const page = await api()
      .get('/api/v1/productos?limit=1&page=2&estado=todos&sort=nombre&order=desc')
      .set('Cookie', cookie)
      .expect(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.pagination.page).toBe(2);
  });

  it('impide duplicados concurrentes y conserva una sola alta', async () => {
    const responses = await Promise.all(
      ['Concurrente', 'CONCURRENTÉ'].map((nombre) =>
        api().post('/api/v1/referencias').set('Cookie', cookie).send({ nombre }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  });

  it('impide cambiar el producto de una tarifa y respeta productos inactivos', async () => {
    const other = await db.producto.create({ data: { nombre: 'Otro ficticio' } });
    await api()
      .put('/api/v1/tarifas/' + tariffId)
      .set('Cookie', cookie)
      .send({ productoId: other.id })
      .expect(400);
    await api()
      .delete('/api/v1/productos/' + productId)
      .set('Cookie', cookie)
      .expect(200);
    await api()
      .post('/api/v1/tarifas')
      .set('Cookie', cookie)
      .send({ productoId: productId, precio: 80, nombre: 'No disponible' })
      .expect(400);
    const list = await api()
      .get('/api/v1/tarifas')
      .query({ productoId: productId })
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.data).toHaveLength(0);
    await api()
      .post('/api/v1/tarifas/' + tariffId + '/reactivar')
      .set('Cookie', cookie)
      .expect(400);
    await api()
      .post('/api/v1/productos/' + productId + '/reactivar')
      .set('Cookie', cookie)
      .expect(201);
  });

  it('crea cliente y referencia atómicamente y respeta referentes inactivos', async () => {
    const name = 'Referente ficticio ' + 'A'.repeat(100);
    const first = await api()
      .post('/api/v1/clientes')
      .set('Cookie', cookie)
      .send({ nombre: '  ' + name + '  ' })
      .expect(201);
    expect(first.body.data.nombre).toBe(name);
    const ref = await db.referencia.findUniqueOrThrow({ where: { nombre: name } });
    await api()
      .delete('/api/v1/referencias/' + ref.id)
      .set('Cookie', cookie)
      .expect(200);
    await api()
      .post('/api/v1/clientes')
      .set('Cookie', cookie)
      .send({ nombre: name.toLowerCase() })
      .expect(201);
    expect(
      await db.referencia.count({ where: { nombre: { equals: name, mode: 'insensitive' } } }),
    ).toBe(1);
    expect((await db.referencia.findUniqueOrThrow({ where: { id: ref.id } })).activo).toBe(false);
    expect(first.body.data.id).not.toBe(ref.id);
  });

  it('revierte cliente, referencia y catálogo si falla su auditoría', async () => {
    const missingUser = '00000000-0000-4000-8000-000000000001';
    const name = 'Alta ficticia que debe revertirse';
    await expect(app.get(ClientesService).create({ nombre: name }, missingUser)).rejects.toThrow();
    expect(await db.cliente.count({ where: { nombre: name } })).toBe(0);
    expect(await db.referencia.count({ where: { nombre: name } })).toBe(0);
    await expect(app.get(ProductosService).create({ nombre: name }, missingUser)).rejects.toThrow();
    expect(await db.producto.count({ where: { nombre: name } })).toBe(0);
  });

  it('la desactivación conserva suscripciones, ingresos y métodos usados', async () => {
    const cliente = await db.cliente.findFirstOrThrow();
    const servidor = await db.servidor.findFirstOrThrow({ where: { activo: true } });
    const estado = await db.estado.findUniqueOrThrow({
      where: { tipo_valor: { tipo: 'suscripcion', valor: 'ACTIVA' } },
    });
    const subscription = await db.suscripcion.create({
      data: {
        clienteId: cliente.id,
        productoId: productId,
        tarifaId: tariffId,
        servidorId: servidor.id,
        estadoId: estado.id,
        fechaInicio: new Date('2026-09-15'),
        fechaFin: new Date('2027-09-15'),
      },
    });
    const category = await db.categoriaGasto.create({ data: { nombre: 'Gasto ficticio' } });
    const method = await db.metodoPago.create({ data: { nombre: 'Pago ficticio' } });
    const tipo = await db.estado.findUniqueOrThrow({
      where: { tipo_valor: { tipo: 'movimiento_tipo', valor: 'INGRESO' } },
    });
    const confirmed = await db.estado.findUniqueOrThrow({
      where: { tipo_valor: { tipo: 'movimiento_estado', valor: 'CONFIRMADO' } },
    });
    const movement = await db.movimientoFinanciero.create({
      data: {
        tipoId: tipo.id,
        estadoId: confirmed.id,
        suscripcionId: subscription.id,
        importe: 75,
        fecha: new Date(),
        categoriaGastoId: category.id,
        metodoPagoId: method.id,
        metodoPagoNombreSnapshot: method.nombre,
      },
    });
    await api()
      .put('/api/v1/metodos-pago/' + method.id)
      .set('Cookie', cookie)
      .send({ esGratuito: true })
      .expect(409);
    await api()
      .delete('/api/v1/categorias-gasto/' + category.id)
      .set('Cookie', cookie)
      .expect(200);
    await api()
      .delete('/api/v1/productos/' + productId)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      (await db.suscripcion.findUniqueOrThrow({ where: { id: subscription.id } })).productoId,
    ).toBe(productId);
    expect(
      (
        await db.movimientoFinanciero.findUniqueOrThrow({ where: { id: movement.id } })
      ).importe.toString(),
    ).toBe('75');
    const free = await db.metodoPago.findFirstOrThrow({ where: { esGratuito: true } });
    await api()
      .put('/api/v1/metodos-pago/' + free.id)
      .set('Cookie', cookie)
      .send({ nombre: 'Cortesía ficticia' })
      .expect(200);
    expect((await db.metodoPago.findUniqueOrThrow({ where: { id: free.id } })).esGratuito).toBe(
      true,
    );
  });

  it('repetir el seed conserva nombres, precios, estados y equivalencias editados', async () => {
    const eq = await db.importacionEquivalencia.findUniqueOrThrow({
      where: { tipo_valorClave: { tipo: 'PRODUCTO', valorClave: 'MAXPLAYER' } },
    });
    await db.producto.update({
      where: { id: eq.entidadId! },
      data: { nombre: 'Producto base renombrado', activo: false },
    });
    const tarifa = await db.tarifa.findFirstOrThrow({ where: { productoId: eq.entidadId! } });
    await db.tarifa.update({
      where: { id: tarifa.id },
      data: { nombre: 'Tarifa base editada', precio: 90, activo: false },
    });
    const total = await db.producto.count();
    await seedBase(db);
    expect(await db.producto.count()).toBe(total);
    expect((await db.producto.findUniqueOrThrow({ where: { id: eq.entidadId! } })).activo).toBe(
      false,
    );
    expect(
      (await db.tarifa.findUniqueOrThrow({ where: { id: tarifa.id } })).precio.toString(),
    ).toBe('90');
    expect(await db.importacion.count()).toBe(0);
    expect(await db.importacionFila.count()).toBe(0);
    expect(
      await db.importacionEquivalencia.count({ where: { tipo: 'PAGO', valorClave: 'PA' } }),
    ).toBe(0);
  });
});
