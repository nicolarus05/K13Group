// Chrome + Nest + PostgreSQL aislado; ningún XLSX ni datos de negocio.
require('dotenv').config();
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'sprint9-e2e-only';
process.env.JWT_REFRESH_SECRET = 'sprint9-e2e-refresh';
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
const { RenovacionesService } = require('../src/renovaciones/renovaciones.service');
const { DashboardService } = require('../src/dashboard/dashboard.service');
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
    assert.equal(migrated.status, 0, 'Migración temporal');
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
      { sub: user.id, sid: (await db.sesion.create({ data: { usuarioId: user.id, token: 'fixture-access-only', expiresAt: new Date(Date.now() + 3600000) } })).id },
      { secret: process.env.JWT_SECRET, expiresIn: '10m' },
    );
    const state = await db.estado.findUniqueOrThrow({
      where: { tipo_valor: { tipo: 'cliente', valor: 'ACTIVO' } },
    });
    const client = await db.cliente.create({
      data: { nombre: 'Cliente Estadísticas E2E', estadoId: state.id },
    });
    const rate = await db.tarifa.findFirstOrThrow({
      where: { activo: true, producto: { activo: true } },
    });
    const server = await db.servidor.findFirstOrThrow({ where: { activo: true } });
    const method = await db.metodoPago.create({ data: { nombre: 'Efectivo Estadísticas E2E' } });
    const category = await db.categoriaGasto.create({
      data: { nombre: 'Hosting Estadísticas E2E' },
    });
    const today = businessDay();
    const sub = await app.get(SuscripcionesService).create(
      {
        solicitudId: randomUUID(),
        clienteId: client.id,
        productoId: rate.productoId,
        tarifaId: rate.id,
        servidorId: server.id,
        fechaInicio: today,
      },
      user.id,
    );
    await app.get(RenovacionesService).create(
      sub.id,
      {
        solicitudId: randomUUID(),
        version: sub.version,
        importe: '75.00',
        metodoPagoId: method.id,
        cobro: 'PENDIENTE',
        fechaPrevistaCobro: today,
        motivoImporte: 'Prueba E2E',
      },
      user.id,
      true,
    );
    const origin = process.env.FRONTEND_TEST_URL || 'http://localhost:3000';
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox'],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'access_token', value: token, url: origin }]);
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: apiOrigin + url.pathname + url.search,
        headers: { ...route.request().headers(), cookie: 'access_token=' + token },
      });
      await route.fulfill({ response });
    });
    await page.goto(origin + '/dashboard');
    const card = (title) =>
      page
        .locator('.k13-kpi')
        .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await card('Pendiente de cobro').getByText(/75,00/).waitFor();
    await card('Clientes con servicio').getByText('1', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Registrar gasto', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Concepto', { exact: true }).fill('Gasto desde dashboard');
    await dialog.getByLabel('Importe (€)', { exact: true }).fill('25.10');
    await dialog.getByLabel('Categoría', { exact: true }).selectOption(category.id);
    await dialog.getByLabel('Método de pago', { exact: true }).selectOption(method.id);
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await card('Gastos pagados').getByText(/25,10/).waitFor();
    await card('Resultado operativo')
      .getByText(/-25,10/)
      .waitFor();
    await page.locator('#trabajo-pendiente a[href^="/finanzas/"]').click();
    await page.getByRole('link', { name: 'Gestionar cobro o anulación en renovaciones' }).click();
    await page.getByRole('button', { name: 'Registrar cobro', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Método de pago', { exact: true }).selectOption(method.id);
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await card('Ingresos brutos').getByText(/75,00/).waitFor();
    await card('Pendiente de cobro').getByText(/0,00/).waitFor();
    await card('Resultado operativo').getByText(/49,90/).waitFor();
    await page.getByRole('link', { name: 'Estadísticas', exact: true }).click();
    const metric = (label) =>
      page
        .locator('.stats-metric')
        .filter({ has: page.getByRole('heading', { name: label, exact: true }) });
    await metric('Ingresos brutos').getByText(/75,00/).waitFor();
    await metric('Resultado operativo').getByText(/49,90/).waitFor();
    await page.getByRole('button', { name: 'Productos', exact: true }).click();
    await page
      .getByRole('region', { name: 'Desglose estadístico' })
      .getByRole('cell', { name: /75,00/ })
      .waitFor();
    const tabs = page.getByRole('navigation', { name: 'Informes estadísticos' });
    for (const name of [
      'Servidores',
      'Referencias',
      'Métodos de pago',
      'Clientes',
      'Renovaciones',
      'Contabilidad',
    ]) {
      await tabs.getByRole('button', { name, exact: true }).click();
      await page.getByText('Solo datos registrados:', { exact: false }).waitFor();
    }
    await metric('Resultado operativo').getByText(/49,90/).waitFor();
    await page
      .getByRole('combobox', { name: 'Método de pago (ingresos)', exact: true })
      .selectOption(method.id);
    await metric('Resultado operativo').getByText('No aplicable', { exact: true }).waitFor();
    await metric('Ingresos brutos').getByText(/75,00/).waitFor();
    await page.getByRole('button', { name: 'Limpiar filtros del informe' }).click();
    await metric('Resultado operativo').getByText(/49,90/).waitFor();
    await page.screenshot({ path: '/tmp/k13-estadisticas-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Sin desbordamiento móvil',
    );
    await page.screenshot({ path: '/tmp/k13-estadisticas-mobile.png', fullPage: true });
    const r = await app.get(DashboardService).summary({});
    assert.equal(r.indicadores.resultado, '49.90');
    assert.equal(r.indicadores.renovaciones, 0, 'ALTA no es renovación');
    assert.equal(await db.movimientoFinanciero.count(), 2);
    assert.equal(await db.importacion.count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        resultado: 'OK',
        flujo: 'Dashboard → gasto → deuda → cobro → Estadísticas (ocho informes y filtros)',
        ingresos: '75.00',
        gastos: '25.10',
        resultadoOperativo: '49.90',
        importaciones: 0,
        erroresJavascript: 0,
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
