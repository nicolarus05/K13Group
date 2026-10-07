// Chrome + Nest + PostgreSQL real en esquema temporal; no importa XLSX.
require('dotenv').config();
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'sprint7-e2e-only';
process.env.JWT_REFRESH_SECRET = 'sprint7-e2e-refresh-only';
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
const { FinanzasService } = require('../src/finanzas/finanzas.service');
const { FinanceQueryDto } = require('../src/finanzas/finanzas.dto');
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
    const migration = spawnSync(path.resolve('node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'pipe',
    });
    assert.equal(migration.status, 0, 'Migración temporal');
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
      data: { nombre: 'Cliente E2E Finanzas', estadoId: state.id },
    });
    const rate = await db.tarifa.findFirstOrThrow({
      where: { activo: true, producto: { activo: true } },
    });
    const server = await db.servidor.findFirstOrThrow({ where: { activo: true } });
    const method = await db.metodoPago.create({ data: { nombre: 'Efectivo E2E Finanzas' } });
    const category = await db.categoriaGasto.create({ data: { nombre: 'Hosting E2E Finanzas' } });
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
    const renewal = await app.get(RenovacionesService).create(
      sub.id,
      {
        solicitudId: randomUUID(),
        version: sub.version,
        importe: '75.00',
        metodoPagoId: method.id,
        cobro: 'PENDIENTE',
        fechaPrevistaCobro: today,
        motivoImporte: 'Importe E2E',
      },
      user.id,
      true,
    );
    const financial = app.get(FinanzasService);
    const balance = () => financial.balance(new FinanceQueryDto());
    assert.equal((await balance()).pendienteCobro, '75.00');
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
    await page.goto(origin + '/finanzas');
    await page.getByRole('link', { name: 'Ver movimiento', exact: true }).click();
    await page.getByRole('link', { name: 'Gestionar cobro o anulación en renovaciones' }).click();
    await page.getByRole('button', { name: 'Registrar cobro', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Método de pago', { exact: true }).selectOption(method.id);
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal((await balance()).ingresos, '75.00');
    assert.equal((await balance()).pendienteCobro, '0.00');
    assert.equal(await db.movimientoFinanciero.count(), 1);
    await page.getByRole('link', { name: 'Finanzas', exact: true }).click();
    const resultCard = page
      .getByRole('region', { name: 'Balance', exact: true })
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Resultado', exact: true }) });
    await resultCard.getByText(/75,00/).waitFor();
    await page.getByRole('button', { name: 'Nuevo gasto', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Concepto', { exact: true }).fill('Hosting real E2E');
    await dialog.getByLabel('Importe (€)', { exact: true }).fill('25.10');
    await dialog.getByLabel('Categoría', { exact: true }).selectOption(category.id);
    await dialog.getByLabel('Método de pago', { exact: true }).selectOption(method.id);
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await resultCard.getByText(/49,90/).waitFor();
    const expense = await db.movimientoFinanciero.findFirstOrThrow({
      where: { concepto: 'Hosting real E2E' },
    });
    await page
      .getByRole('row')
      .filter({ hasText: 'Hosting real E2E' })
      .getByRole('link', { name: 'Ver movimiento' })
      .click();
    await page.getByRole('button', { name: 'Editar gasto', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Importe (€)', { exact: true }).fill('20.00');
    await dialog.getByLabel('Motivo', { exact: true }).fill('Corregir importe de factura');
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal((await balance()).resultado, '55.00');
    await page.getByRole('button', { name: 'Anular gasto', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Motivo', { exact: true }).fill('Registro duplicado comprobado');
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal((await balance()).resultado, '75.00');
    assert.equal(
      await db.actividad.count({
        where: { tabla: 'movimientos_financieros', registroId: expense.id },
      }),
      3,
    );
    assert.equal(await db.movimientoFinanciero.count(), 2);
    assert.equal(
      (await db.renovacion.findUniqueOrThrow({ where: { id: renewal.id } })).fechaFin.getTime(),
      sub.fechaFin.getTime(),
    );
    await page.getByRole('link', { name: 'Volver a Finanzas' }).click();
    await page.getByLabel('Estado', { exact: true }).selectOption('ANULADO');
    await page.getByRole('row').filter({ hasText: 'Hosting real E2E' }).waitFor();
    await resultCard.getByText(/0,00/).waitFor();
    // El motivo se conserva en Renovaciones; Finanzas también lo muestra al leer
    // movimientos antiguos que no tienen motivoAnulacion propio.
    await page.goto(origin + '/renovaciones/' + renewal.id);
    await page.getByRole('button', { name: 'Anular operación', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Motivo', { exact: true }).fill('Ingreso duplicado revisado E2E');
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const income = await db.movimientoFinanciero.findFirstOrThrow({
      where: { renovacionId: renewal.id },
    });
    assert.equal(income.motivoAnulacion, null);
    await page.goto(origin + '/finanzas/' + income.id);
    await page
      .locator('dl > div')
      .filter({ has: page.locator('dt', { hasText: 'Motivo de anulación' }) })
      .getByText('Ingreso duplicado revisado E2E', { exact: true })
      .waitFor();
    assert.equal((await balance()).ingresos, '0.00');
    assert.equal(await db.importacion.count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        resultado: 'OK',
        flujo:
          'Finanzas → cobro → gasto → edición → anulación → filtro → motivo de ingreso anulado',
        ingresoBruto: '75.00',
        ingresosTrasAnular: '0.00',
        gastosActivos: '0.00',
        movimientosConservados: 2,
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
