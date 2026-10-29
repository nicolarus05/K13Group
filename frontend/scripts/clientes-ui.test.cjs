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

async function clientListFixture(
  t,
  { failure = false, total = 26, holdCreate = false, holdDelete = false } = {},
) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const origin = process.env.FRONTEND_TEST_URL || 'http://localhost:3000';
  await context.addCookies([{ name: 'access_token', value: 'client-list-fixture', url: origin }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  let releaseCreate;
  const createGate = new Promise((resolve) => {
    releaseCreate = resolve;
  });
  t.after(() => releaseCreate());
  let releaseDelete;
  const deleteGate = new Promise((resolve) => {
    releaseDelete = resolve;
  });
  t.after(() => releaseDelete());
  let fail = failure;
  const requests = [];
  const client = {
    id: 'last-client',
    nombre: 'Cliente visible',
    estado: { valor: 'ACTIVO' },
    createdAt: '2026-10-27T10:00:00Z',
  };
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const method = route.request().method();
    requests.push({ path, method, page: Number(url.searchParams.get('page') || 1) });
    const send = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/auth/me')
      return send({ data: { id: 'admin', nombre: 'Prueba', username: 'admin' } });
    if (path === '/recordatorios/resumen') return send({ data: { atencion: 0 } });
    if (path.startsWith('/clientes') && method === 'GET' && fail)
      return send({ message: 'Servicio temporalmente no disponible' }, 503);
    if (path === '/clientes' && method === 'POST') {
      if (holdCreate) await createGate;
      return send({ data: client });
    }
    if (path === '/clientes/last-client' && method === 'DELETE') {
      if (holdDelete) await deleteGate;
      total--;
      return send({ success: true });
    }
    if (path === '/clientes/last-client') return send({ data: client });
    if (path === '/clientes') {
      const page = Number(url.searchParams.get('page') || 1);
      const limit = Number(url.searchParams.get('limit') || 25);
      const data = page > Math.ceil(total / limit) ? [] : [client];
      return send({
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    }
    return send({ data: [] });
  });
  return {
    page,
    origin,
    requests,
    releaseCreate: () => releaseCreate(),
    releaseDelete: () => releaseDelete(),
    recover: () => {
      fail = false;
    },
  };
}

test('clientes muestra un error recuperable sin fingir un listado vacío', async (t) => {
  const f = await clientListFixture(t, { failure: true });
  await f.page.goto(f.origin + '/clientes');
  await f.page
    .getByRole('button', { name: 'Reintentar clientes', exact: true })
    .waitFor({ timeout: 10000 });
  assert.equal(await f.page.getByText('No hay clientes', { exact: true }).count(), 0);
  f.recover();
  await f.page.getByRole('button', { name: 'Reintentar clientes', exact: true }).click();
  await f.page.getByText('Cliente visible', { exact: true }).waitFor();
});

test('eliminar el último cliente de una página vuelve a la última página válida', async (t) => {
  const f = await clientListFixture(t);
  await f.page.goto(f.origin + '/clientes');
  await f.page.getByRole('button', { name: '→', exact: true }).click();
  await f.page.getByText('26–26 de 26', { exact: true }).waitFor();
  await f.page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await f.page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await f.page.getByRole('dialog').waitFor({ state: 'hidden' });
  await f.page.getByText('Cliente visible', { exact: true }).waitFor({ timeout: 10000 });
  assert.ok(f.requests.filter((r) => r.path === '/clientes' && r.page === 1).length >= 2);
});

test('un fallo al abrir la ficha de cliente no deja la pantalla en blanco', async (t) => {
  const f = await clientListFixture(t, { failure: true });
  await f.page.goto(f.origin + '/clientes/last-client');
  await f.page
    .getByRole('button', { name: 'Reintentar cliente', exact: true })
    .waitFor({ timeout: 10000 });
  f.recover();
  await f.page.getByRole('button', { name: 'Reintentar cliente', exact: true }).click();
  await f.page.getByRole('heading', { name: 'Cliente visible', exact: true }).waitFor();
});

test('el formulario de cliente no se cierra con Escape ni con la X mientras guarda', async (t) => {
  const f = await clientListFixture(t, { holdCreate: true });
  await f.page.goto(f.origin + '/clientes');
  await f.page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
  const dialog = f.page.getByRole('dialog', { name: 'Nuevo cliente', exact: true });
  await dialog.getByLabel('Nombre *', { exact: true }).fill('Cliente en proceso');
  const requested = f.page.waitForRequest(
    (r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/clientes'),
  );
  await dialog.getByRole('button', { name: 'Crear cliente', exact: true }).click();
  await requested;
  await f.page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true);
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  assert.equal(await dialog.isVisible(), true);
  await dialog.locator('form').evaluate((form) => form.requestSubmit());
  f.releaseCreate();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(f.requests.filter((r) => r.path === '/clientes' && r.method === 'POST').length, 1);
});

test('la confirmación de borrado bloquea el cierre y los envíos repetidos mientras procesa', async (t) => {
  const f = await clientListFixture(t, { holdDelete: true, total: 1 });
  await f.page.goto(f.origin + '/clientes');
  await f.page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  const dialog = f.page.getByRole('dialog', { name: '¿Eliminar cliente?', exact: true });
  const requested = f.page.waitForRequest(
    (r) => r.method() === 'DELETE' && new URL(r.url()).pathname.endsWith('/clientes/last-client'),
  );
  await dialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await requested;
  await f.page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true);
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  assert.equal(await dialog.isVisible(), true);
  const cancel = dialog.getByRole('button', { name: 'Cancelar', exact: true });
  assert.equal(await cancel.isDisabled(), true);
  await cancel.evaluate((button) => button.click());
  assert.equal(await dialog.isVisible(), true);
  const confirm = dialog.getByRole('button', { name: 'Procesando…', exact: true });
  assert.equal(await confirm.isDisabled(), true);
  await confirm.evaluate((button) => button.click());
  f.releaseDelete();
  await dialog.waitFor({ state: 'hidden' });
  await f.page.getByText('No hay clientes', { exact: true }).waitFor();
  assert.equal(
    f.requests.filter((r) => r.path === '/clientes/last-client' && r.method === 'DELETE').length,
    1,
  );
});
