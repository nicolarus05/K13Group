const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
let browser;
const origin = process.env.FRONTEND_TEST_URL || 'http://localhost:3000';
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
});
after(async () => {
  await browser?.close();
});
async function fixture(t, options = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  await context.addCookies([
    { name: options.access ? 'access_token' : 'refresh_token', value: 'auth-fixture', url: origin },
  ]);
  const calls = { refresh: 0, logout: 0, unauthorized: 0, loaded: 0 };
  let renewed = options.valid ?? false;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const send = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/auth/refresh') {
      calls.refresh++;
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (options.refreshStatus) return send({ message: 'Refresh fallido' }, options.refreshStatus);
      renewed = true;
      return send({ success: true });
    }
    if (path === '/auth/logout') {
      calls.logout++;
      if (options.logoutStatus) return send({ message: 'Logout fallido' }, options.logoutStatus);
      await context.clearCookies();
      return send({ success: true });
    }
    if (!renewed || options.rejectRetry) {
      calls.unauthorized++;
      // La respuesta de clientes llega después del refresh que inicia /auth/me.
      if (options.late401 && path === '/clientes')
        await new Promise((resolve) => setTimeout(resolve, 500));
      return send({ message: 'Sesión expirada' }, 401);
    }
    if (path === '/auth/me')
      return send({
        success: true,
        data: { id: 'admin', username: 'admin', nombre: 'Administrador' },
      });
    if (path === '/recordatorios/resumen') return send({ data: { atencion: 0 } });
    calls.loaded++;
    return send({
      success: true,
      data: [],
      pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
    });
  });
  if (options.holdLogin)
    await page.route('**/login', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
  return { page, calls, context };
}

test('recupera la navegación con solo refresh y agrupa los 401 concurrentes', async (t) => {
  const { page, calls } = await fixture(t);
  await page.goto(origin + '/clientes');
  await page.getByLabel('0 avisos requieren atención').waitFor();
  await page.waitForFunction(() => !document.body.textContent.includes('Cargando'));
  assert.equal(calls.refresh, 1);
  assert.ok(calls.unauthorized >= 2);
  assert.ok(calls.loaded >= 1);
  assert.equal(new URL(page.url()).pathname, '/clientes');
});

test('un 401 tardío reutiliza la renovación ya completada', async (t) => {
  const { page, calls } = await fixture(t, { late401: true });
  const loaded = page.waitForResponse(
    (r) => r.url().includes('/api/v1/clientes') && r.status() === 200,
  );
  await page.goto(origin + '/clientes');
  await page.getByLabel('0 avisos requieren atención').waitFor();
  await loaded;
  assert.equal(calls.refresh, 1);
});

test('refresh revocado limpia cookies y lleva al login sin bucle', async (t) => {
  const { page, calls, context } = await fixture(t, { refreshStatus: 401 });
  await page.goto(origin + '/clientes');
  await page.waitForURL('**/login');
  assert.equal(calls.refresh, 1);
  assert.equal(calls.logout, 1);
  assert.equal((await context.cookies()).filter((c) => /_token$/.test(c.name)).length, 0);
});

test('un fallo temporal del refresh no cierra la sesión ni redirige', async (t) => {
  const { page, calls } = await fixture(t, { refreshStatus: 503 });
  const failed = page.waitForResponse(
    (r) => r.url().endsWith('/auth/refresh') && r.status() === 503,
  );
  await page.goto(origin + '/clientes');
  await failed;
  assert.equal(calls.logout, 0);
  assert.equal(new URL(page.url()).pathname, '/clientes');
});

test('el login sigue accesible aunque quede una cookie access inválida', async (t) => {
  const { page } = await fixture(t, { access: true });
  await page.goto(origin + '/login');
  assert.equal(new URL(page.url()).pathname, '/login');
});

test('logout fallido mantiene la página y permite reintentar', async (t) => {
  const { page, calls } = await fixture(t, { valid: true, access: true, logoutStatus: 503 });
  await page.goto(origin + '/clientes');
  await page.getByLabel('0 avisos requieren atención').waitFor();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await page.getByText('No se pudo cerrar la sesión. Inténtalo de nuevo.').waitFor();
  assert.equal(calls.logout, 1);
  assert.equal(new URL(page.url()).pathname, '/clientes');
});

test('un 401 después de renovar termina la sesión sin repetir el refresh', async (t) => {
  const { page, calls } = await fixture(t, { rejectRetry: true });
  await page.goto(origin + '/clientes');
  await page.waitForURL('**/login');
  assert.equal(calls.refresh, 1);
  assert.ok(calls.logout >= 1);
});

test('un 401 tardío durante la limpieza de una sesión revocada no inicia otro refresh', async (t) => {
  const { page, calls } = await fixture(t, { refreshStatus: 401, late401: true, holdLogin: true });
  await page.goto(origin + '/clientes');
  await page.waitForURL('**/login');
  assert.equal(calls.refresh, 1);
  assert.equal(calls.logout, 1);
});
