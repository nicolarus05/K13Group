const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

for (const kind of ['cliente', 'producto'])
  test(`editar un ${kind} actualiza sus suscripciones al volver sin recargar`, async (t) => {
    const browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox'],
    });
    t.after(() => browser.close());
    const context = await browser.newContext();
    const origin = process.env.FRONTEND_TEST_URL || 'http://localhost:3000';
    await context.addCookies([{ name: 'access_token', value: 'ui-fixture', url: origin }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const client = { id: 'fixture-client', nombre: 'Nombre anterior', estado: { valor: 'ACTIVO' } };
    const product = { id: 'fixture-product', nombre: 'Producto de prueba', activo: true };
    let subscriptionReads = 0;
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let data = [];
      if (path === '/auth/me') data = { id: 'admin', nombre: 'Prueba', username: 'admin' };
      if (path === '/recordatorios/resumen') data = { atencion: 0 };
      if (path === '/clientes') data = [client];
      if (path === '/productos') data = [product];
      if (path === '/productos/' + product.id && route.request().method() === 'PUT') {
        Object.assign(product, route.request().postDataJSON());
        data = product;
      }
      if (path === '/clientes/' + client.id && route.request().method() === 'PUT') {
        Object.assign(client, route.request().postDataJSON());
        data = client;
      }
      if (path === '/suscripciones') {
        subscriptionReads++;
        data = [
          {
            id: 'fixture-service',
            cliente: client,
            producto: product,
            tarifa: { nombre: 'Anual' },
            servidor: { nombre: 'Servidor de prueba' },
            fechaFin: '2027-10-27T00:00:00.000Z',
            estado: { valor: 'ACTIVA' },
          },
        ];
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data,
          pagination: { page: 1, limit: 25, total: data.length || 0, totalPages: 1 },
        }),
      });
    });
    await page.goto(origin + '/suscripciones');
    await page
      .getByRole('link', { name: 'Nombre anterior · Producto de prueba', exact: true })
      .waitFor();
    await page.evaluate(() => {
      window.clientCacheTest = true;
    });
    const reads = subscriptionReads;
    await page
      .getByRole('link', { name: kind === 'cliente' ? 'Clientes' : 'Catálogos', exact: true })
      .first()
      .click();
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page
      .getByLabel(kind === 'cliente' ? 'Nombre *' : 'Nombre', { exact: true })
      .fill('Nombre corregido');
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await page
      .getByText(kind === 'cliente' ? 'Cliente actualizado correctamente.' : 'Registro guardado.', {
        exact: true,
      })
      .waitFor();
    await page.getByRole('link', { name: 'Suscripciones', exact: true }).first().click();
    await page
      .getByRole('link', {
        name:
          kind === 'cliente'
            ? 'Nombre corregido · Producto de prueba'
            : 'Nombre anterior · Nombre corregido',
        exact: true,
      })
      .waitFor({ timeout: 5000 });
    assert.ok(subscriptionReads > reads);
    assert.equal(await page.evaluate(() => window.clientCacheTest), true);
    assert.deepEqual(errors, []);
  });
