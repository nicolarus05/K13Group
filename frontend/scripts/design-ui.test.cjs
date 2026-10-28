const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

// Synthetic fixtures: visual checks never write to the main application's data.
test('tema compartido, tabla desplazable y formulario accesible en escritorio y móvil', async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  t.after(() => browser.close());
  const origin = process.env.FRONTEND_TEST_URL || 'http://localhost:3000';
  const context = await browser.newContext();
  await context.addCookies([{ name: 'access_token', value: 'design-fixture', url: origin }]);
  const page = await context.newPage();
  const errors = [];
  let writes = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (route.request().method() !== 'GET') writes++;
    let data = [];
    if (path === '/auth/me') data = { id: 'admin', nombre: 'Prueba', username: 'admin' };
    if (path === '/recordatorios/resumen') data = { atencion: 0 };
    if (path === '/auditoria/filtros') data = { tablas: [], acciones: [], usuarios: [] };
    if (path === '/clientes')
      data = [
        {
          id: 'design-client',
          nombre: 'Cliente de prueba con nombre largo',
          telefono: '600000000',
          email: 'prueba@example.com',
          estado: { valor: 'ACTIVO' },
        },
      ];
    if (path === '/clientes/design-client')
      data = {
        id: 'design-client',
        nombre: 'Nombre'.repeat(20),
        telefono: '600000000',
        email: 'cuenta'.repeat(15) + '@example.com',
        observaciones: 'Referencia'.repeat(25),
        estado: { valor: 'ACTIVO' },
        createdAt: '2026-10-27T10:00:00Z',
        suscripciones: [
          {
            id: 'service',
            producto: { nombre: 'Producto'.repeat(12) },
            tarifa: { nombre: 'Tarifa'.repeat(15) },
            servidor: { nombre: 'Servidor'.repeat(10) },
            estado: { valor: 'ACTIVA' },
          },
        ],
      };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data,
        pagination: { page: 1, limit: 25, total: data.length || 0, totalPages: 1 },
      }),
    });
  });
  await page.goto(origin + '/clientes');
  await page.getByText('Cliente de prueba con nombre largo', { exact: true }).waitFor();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width === 768 ? 360 : 800 });
    assert.equal(
      await page.locator('#main-content').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      true,
      `overflow ${width}`,
    );
    const button = page.getByRole('button', { name: 'Nuevo cliente', exact: true });
    assert.match(
      await button.evaluate((e) => getComputedStyle(e).backgroundImage),
      /linear-gradient/,
    );
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Nuevo cliente', exact: true });
    await dialog.waitFor();
    assert.equal(
      await dialog.evaluate((e) => e.contains(document.activeElement)),
      true,
      'El foco debe entrar en el modal',
    );
    await page.keyboard.press('Shift+Tab');
    assert.equal(
      await dialog.evaluate((e) => e.contains(document.activeElement)),
      true,
      'El foco no debe salir al fondo',
    );
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `dialog ${width}`);
    assert.ok(
      bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize().height,
      'El modal cabe en una pantalla baja',
    );
    await button.evaluate((e) => e.focus());
    assert.equal(
      await dialog.evaluate((e) => e.contains(document.activeElement)),
      true,
      'El fondo es inerte',
    );
    await page.getByLabel('Nombre *', { exact: true }).fill('Prueba');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      await button.evaluate((e) => e === document.activeElement),
      true,
      'Se devuelve el foco al botón',
    );
    await button.click();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
  }
  assert.equal(
    await page.locator('body').evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgb(2, 7, 17)',
  );
  await page.goto(origin + '/clientes/design-client');
  await page.getByRole('heading', { name: 'Nombre'.repeat(20), exact: true }).waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const overflow = await page
      .locator('#main-content')
      .evaluate((main) =>
        [...main.querySelectorAll('*')]
          .filter((e) => e.getBoundingClientRect().right > main.getBoundingClientRect().right + 1)
          .map((e) => ({
            tag: e.tagName,
            cls: e.className,
            width: e.getBoundingClientRect().width,
          })),
      );
    assert.equal(
      await page.locator('#main-content').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      true,
      `ficha con textos largos ${width}: ${JSON.stringify(overflow)}`,
    );
  }
  await page.goto(origin + '/auditoria');
  await page.getByText('No hay actividad con estos filtros.', { exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 700 });
  assert.equal(
    await page.locator('#main-content').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    true,
    'paginación de auditoría en 320px',
  );
  assert.equal(writes, 0);
  assert.deepEqual(errors, []);
});

test('acceso comparte paleta y permite navegar por teclado con tamaño móvil', async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 700 } });
  await page.goto((process.env.FRONTEND_TEST_URL || 'http://localhost:3000') + '/login');
  const user = page.getByLabel('Usuario', { exact: true });
  await user.waitFor();
  assert.equal(await user.evaluate((e) => getComputedStyle(e).fontSize), '16px');
  await user.focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page
      .getByLabel('Contraseña', { exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  assert.equal(
    await page.locator('body').evaluate((e) => e.scrollWidth <= window.innerWidth),
    true,
  );
  assert.match(
    await page
      .getByRole('button', { name: 'Iniciar sesión' })
      .evaluate((e) => getComputedStyle(e).backgroundImage),
    /linear-gradient/,
  );
});
