// Navegador real + Nest real + PostgreSQL temporal. Nunca importa el XLSX.
require('dotenv').config();
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'sprint6-e2e-only';
process.env.JWT_REFRESH_SECRET = 'sprint6-e2e-refresh-only';
require('ts-node/register');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const cookieParser = require('cookie-parser');
const { chromium } = require('../../frontend/node_modules/playwright-core');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/database/prisma.service');
const { SuscripcionesService } = require('../src/suscripciones/suscripciones.service');
const { businessDay, parseDay, annualEnd } = require('../src/suscripciones/subscription-dates');
const { seedBase } = require('../prisma/seed');

async function main() {
  const schema = 'catalogos_test_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const owner = new PrismaClient();
  let db, app, browser;
  try {
    await owner.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
    const result = spawnSync(path.resolve('node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'pipe',
    });
    if (result.status !== 0)
      throw new Error('No se pudieron aplicar las migraciones en el esquema temporal.');
    db = new PrismaClient({ datasourceUrl: url.toString() });
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
    await app.listen(0, '127.0.0.1');
    const apiOrigin = 'http://127.0.0.1:' + app.getHttpServer().address().port;
    const user = await db.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
    const token = new JwtService().sign(
      { sub: user.id },
      { secret: process.env.JWT_SECRET, expiresIn: '10m' },
    );
    const state = await db.estado.findUniqueOrThrow({
      where: { tipo_valor: { tipo: 'cliente', valor: 'ACTIVO' } },
    });
    const client = await db.cliente.create({
      data: { nombre: 'Cliente E2E Sprint6', estadoId: state.id },
    });
    const product = await db.producto.create({ data: { nombre: 'Aplicación E2E Sprint6' } });
    const rate = await db.tarifa.create({
      data: { nombre: 'Anual E2E', productoId: product.id, duracionMeses: 12, precio: 75 },
    });
    const server = await db.servidor.create({ data: { nombre: 'Servidor E2E' } });
    const method = await db.metodoPago.create({ data: { nombre: 'Efectivo E2E' } });
    const today = businessDay();
    const old = parseDay(today);
    old.setUTCFullYear(old.getUTCFullYear() - 1);
    old.setUTCDate(old.getUTCDate() - 10);
    const sub = await app.get(SuscripcionesService).create(
      {
        solicitudId: randomUUID(),
        clienteId: client.id,
        productoId: product.id,
        tarifaId: rate.id,
        servidorId: server.id,
        fechaInicio: old.toISOString().slice(0, 10),
      },
      user.id,
    );
    const origin = process.env.FRONTEND_TEST_URL || 'http://localhost:3000';
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox'],
    });
    const context = await browser.newContext();
    await context.addCookies([{ name: 'access_token', value: token, url: origin }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/v1/**', async (route) => {
      const original = new URL(route.request().url());
      const response = await route.fetch({
        url: apiOrigin + original.pathname + original.search,
        headers: { ...route.request().headers(), cookie: 'access_token=' + token },
      });
      await route.fulfill({ response });
    });
    await page.goto(origin + '/suscripciones/' + sub.id);
    await page.getByRole('button', { name: 'Registrar primer pago', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Método de pago').selectOption(method.id);
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      (await db.suscripcion.findUniqueOrThrow({ where: { id: sub.id } })).fechaFin.getTime(),
      sub.fechaFin.getTime(),
    );
    await page.getByRole('button', { name: 'Renovar', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Método de pago').selectOption(method.id);
    await dialog.getByLabel('Dejar cobro pendiente').check();
    const due = parseDay(today);
    due.setUTCDate(due.getUTCDate() + 5);
    await dialog.getByLabel('Fecha prevista de cobro').fill(due.toISOString().slice(0, 10));
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const renewal = await db.renovacion.findFirstOrThrow({
      where: { suscripcionId: sub.id, tipoOperacion: 'RENOVACION' },
      include: { movimientos: { include: { estado: true } } },
    });
    assert.equal(renewal.movimientos[0].estado.valor, 'PENDIENTE');
    assert.equal(renewal.fechaFin.getTime(), annualEnd(parseDay(today)).getTime());
    await page.getByRole('button', { name: 'Registrar cobro', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Método de pago').selectOption(method.id);
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      (await db.suscripcion.findUniqueOrThrow({ where: { id: sub.id } })).fechaFin.getTime(),
      renewal.fechaFin.getTime(),
    );
    assert.equal(
      await db.movimientoFinanciero.count({
        where: { suscripcionId: sub.id, estado: { valor: 'CONFIRMADO' } },
      }),
      2,
    );
    const article = page.locator('article').filter({
      has: page.getByRole('link', { name: 'Renovación · Cliente E2E Sprint6', exact: true }),
    });
    await article.getByRole('button', { name: 'Anular operación', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Motivo', { exact: true }).fill('Corrección controlada de prueba');
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      (await db.suscripcion.findUniqueOrThrow({ where: { id: sub.id } })).fechaFin.getTime(),
      sub.fechaFin.getTime(),
    );
    assert.equal(
      await db.movimientoFinanciero.count({
        where: { suscripcionId: sub.id, estado: { valor: 'ANULADO' } },
      }),
      1,
    );
    await page.goto(origin + '/renovaciones?historial=1&clienteId=' + client.id);
    await page.getByLabel('Filtrar operación').selectOption('ANULADA');
    await page.getByRole('article').getByText('Anulada', { exact: true }).waitFor();
    // Regresión real: una renovación anticipada deja fechaInicio en el futuro.
    const early = await app.get(SuscripcionesService).create(
      {
        solicitudId: randomUUID(),
        clienteId: client.id,
        productoId: product.id,
        tarifaId: rate.id,
        servidorId: server.id,
        fechaInicio: today,
      },
      user.id,
    );
    await page.goto(origin + '/suscripciones/' + early.id);
    await page.getByRole('button', { name: 'Renovar', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Método de pago').selectOption(method.id);
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const renewed = await db.suscripcion.findUniqueOrThrow({ where: { id: early.id } });
    assert.equal(renewed.fechaInicio.getTime(), early.fechaFin.getTime());
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    assert.equal(
      await page.getByLabel('Fecha de inicio', { exact: true }).inputValue(),
      renewed.fechaInicio.toISOString().slice(0, 10),
    );
    await page.getByLabel('Tipo de dispositivo (opcional)').fill('TV renovada E2E');
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/suscripciones/' + early.id) &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    assert.equal((await saved).status(), 200);
    await page.getByRole('button', { name: 'Editar', exact: true }).waitFor();
    const edited = await db.suscripcion.findUniqueOrThrow({ where: { id: early.id } });
    assert.equal(edited.tipoDispositivo, 'TV renovada E2E');
    assert.equal(edited.fechaInicio.getTime(), renewed.fechaInicio.getTime());
    assert.equal(edited.fechaFin.getTime(), renewed.fechaFin.getTime());
    assert.equal(await db.importacion.count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        resultado: 'OK',
        flujo:
          'primer pago → renovación pendiente → cobro → anulación → filtro; renovación anticipada → edición',
        operaciones: await db.renovacion.count(),
        movimientos: await db.movimientoFinanciero.count(),
        importaciones: 0,
        erroresJavascript: errors.length,
      }),
    );
  } finally {
    await browser?.close();
    await app?.close();
    await db?.$disconnect();
    if (!/^catalogos_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Esquema no aislado');
    await owner.$executeRawUnsafe('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await owner.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
