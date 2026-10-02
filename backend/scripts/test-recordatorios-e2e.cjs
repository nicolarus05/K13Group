// Navegador + Nest + PostgreSQL aislados. Nunca importa XLSX ni escribe en public.
require('dotenv').config();
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'sprint10-e2e-only';
process.env.JWT_REFRESH_SECRET = 'sprint10-e2e-refresh';
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
const { RecordatoriosService } = require('../src/recordatorios/recordatorios.service');
const { businessDay } = require('../src/suscripciones/subscription-dates');
const { seedBase } = require('../prisma/seed');
async function main() {
  const schema = 'catalogos_test_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const owner = new PrismaClient();
  let db, app, browser;
  try {
    await owner.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
    const migrated = spawnSync(path.resolve('node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'pipe',
    });
    assert.equal(migrated.status, 0, migrated.stderr.toString());
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
      { secret: process.env.JWT_SECRET, expiresIn: '15m' },
    );
    const states = Object.fromEntries(
      (await db.estado.findMany()).map((s) => [s.tipo + '.' + s.valor, s.id]),
    );
    const client = await db.cliente.create({
      data: { nombre: 'Cliente Recordatorios E2E', estadoId: states['cliente.ACTIVO'] },
    });
    const rate = await db.tarifa.findFirstOrThrow({
      where: { activo: true, producto: { activo: true } },
    });
    const server = await db.servidor.findFirstOrThrow({ where: { activo: true } });
    const today = businessDay(),
      date = new Date(today),
      next = new Date(date.getTime() + 2 * 86400000).toISOString().slice(0, 10);
    const sub = await db.suscripcion.create({
      data: {
        clienteId: client.id,
        productoId: rate.productoId,
        tarifaId: rate.id,
        servidorId: server.id,
        estadoId: states['suscripcion.ACTIVA'],
        fechaInicio: new Date(date.getTime() - 365 * 86400000),
        fechaFin: date,
      },
    });
    await app.get(RecordatoriosService).sync();
    const original = await db.recordatorio.findFirstOrThrow();
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox'],
    });
    const origin = process.env.FRONTEND_TEST_URL || 'http://localhost:3000';
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await context.addCookies([{ name: 'access_token', value: token, url: origin }]);
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: apiOrigin + url.pathname + url.search,
        headers: { ...route.request().headers(), cookie: 'access_token=' + token },
      });
      await route.fulfill({ response });
    });
    await page.goto(origin + '/recordatorios');
    await page.getByLabel('1 avisos requieren atención').waitFor();
    await page.getByRole('link', { name: 'Gestionar', exact: true }).click();
    await page.getByLabel('Nueva fecha', { exact: true }).fill(next);
    await page.getByLabel('Motivo', { exact: true }).fill('Contactar dos días después');
    await page.getByRole('button', { name: 'Guardar cambio', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Recordatorio actualizado' }).waitFor();
    await page.getByLabel('0 avisos requieren atención').waitFor();
    let stored = await db.recordatorio.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(stored.fecha.toISOString().slice(0, 10), next);
    assert.equal(stored.fechaOriginal.toISOString().slice(0, 10), today);
    await page.goto(origin + '/calendario');
    await page.getByText('No hay eventos para este día.', { exact: true }).waitFor();
    await page.getByLabel('Ir al día', { exact: true }).fill(next);
    await page.locator('.rem-agenda').filter({ hasText: client.nombre }).waitFor();
    await page.screenshot({ path: '/tmp/k13-recordatorios-calendar-desktop.png', fullPage: true });
    await page.locator('.rem-agenda').getByRole('link', { name: 'Gestionar aviso' }).click();
    await page.getByRole('combobox', { name: 'Acción', exact: true }).selectOption('completar');
    await page.getByLabel('Motivo', { exact: true }).fill('Cliente contactado desde la web');
    await page.getByRole('button', { name: 'Guardar cambio', exact: true }).click();
    await page.getByText('Estado: Completado', { exact: false }).waitFor();
    await app.get(RecordatoriosService).sync();
    assert.equal(await db.recordatorio.count(), 1);
    assert.equal(
      (await db.suscripcion.findUniqueOrThrow({ where: { id: sub.id } })).fechaFin
        .toISOString()
        .slice(0, 10),
      today,
    );
    assert.equal(await db.movimientoFinanciero.count(), 0);
    await page.goto(origin + '/recordatorios');
    await page.getByRole('button', { name: 'Nuevo recordatorio', exact: true }).click();
    await page.getByRole('button', { name: client.nombre, exact: true }).click();
    await page.getByLabel('Descripción', { exact: true }).fill('Nota de seguimiento E2E');
    await page.getByRole('button', { name: 'Crear recordatorio', exact: true }).click();
    await page.getByRole('cell', { name: 'Nota de seguimiento E2E', exact: true }).waitFor();
    assert.equal(await db.recordatorio.count(), 2);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: '/tmp/k13-recordatorios-mobile.png', fullPage: true });
    await page.goto(origin + '/calendario');
    await page.getByRole('heading', { name: 'Calendario', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: '/tmp/k13-recordatorios-calendar-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log(
      'Sprint 10 E2E OK: posponer, calendario, completar, no duplicar, alta manual y móvil.',
    );
  } finally {
    await browser?.close();
    await app?.close();
    await db?.$disconnect();
    if (!/^catalogos_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Esquema no aislado');
    await owner.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
    await owner.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
