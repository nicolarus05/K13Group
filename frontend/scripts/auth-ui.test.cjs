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
  const calls = {
    refresh: 0,
    logout: 0,
    unauthorized: 0,
    loaded: 0,
    clientReads: 0,
    login: 0,
    refreshFinished: false,
    loginAfterRefresh: false,
  };
  let renewed = options.valid ?? false;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const send = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (options.cacheSession && path === '/auth/login') {
      calls.login++;
      if (calls.login === 2) calls.loginAfterRefresh = calls.refreshFinished;
      return send({
        success: true,
        data: { id: 'admin', username: 'admin', nombre: 'Administrador' },
      });
    }
    if (options.cacheSession && path === '/dashboard')
      return send({ message: 'Resumen no disponible en este ensayo' }, 503);
    if (path === '/clientes') calls.clientReads++;
    if (options.oldRefresh && path === '/clientes' && calls.clientReads === 1)
      return send({ message: 'Sesión anterior caducada' }, 401);
    if (path === '/auth/refresh') {
      calls.refresh++;
      if (options.oldRefresh) {
        options.oldRefresh.started();
        await options.oldRefresh.gate;
        calls.refreshFinished = true;
        return send({ message: 'Refresh anterior finalizado' }, options.oldRefresh.status);
      }
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

test(
  'un nuevo login descarta los datos en caché de la sesión anterior',
  { timeout: 30000 },
  async (t) => {
    const { page, calls } = await fixture(t, { valid: true, access: true, cacheSession: true });
    const login = async () => {
      await page.getByLabel('Usuario', { exact: true }).fill('admin');
      await page.getByLabel('Contraseña', { exact: true }).fill('test-password');
      await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
      await page.waitForURL('**/dashboard');
    };
    await page.goto(origin + '/login');
    await page.evaluate(() => {
      window.sessionCacheTest = true;
    });
    await login();
    const firstRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/clientes');
    await page.getByRole('link', { name: 'Clientes', exact: true }).first().click();
    await firstRead;
    const before = calls.clientReads;
    await page.goBack();
    await page.waitForURL('**/dashboard');
    await page.goBack();
    await page.waitForURL('**/login');
    assert.equal(
      await page.evaluate(() => window.sessionCacheTest),
      true,
      'El ensayo conserva la misma aplicación, sin recargar',
    );
    await login();
    const nextRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/clientes', {
      timeout: 5000,
    });
    await page.getByRole('link', { name: 'Clientes', exact: true }).first().click();
    await nextRead;
    assert.ok(calls.clientReads > before);
  },
);

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

for (const status of [200, 401])
  test(`un refresh anterior (${status}) termina antes del nuevo login y no lo cierra`, async (t) => {
    let release, started;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const pending = new Promise((resolve) => {
      started = resolve;
    });
    t.after(() => release());
    const { page, calls } = await fixture(t, {
      valid: true,
      access: true,
      cacheSession: true,
      oldRefresh: { gate, started, status },
    });
    const login = async () => {
      await page.getByLabel('Usuario', { exact: true }).fill('admin');
      await page.getByLabel('Contraseña', { exact: true }).fill('test-password');
      await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
      await page.waitForURL('**/dashboard');
    };
    await page.goto(origin + '/login');
    await page.evaluate(() => {
      window.oldRefreshTest = true;
    });
    await login();
    await page.getByRole('link', { name: 'Clientes', exact: true }).first().click();
    await pending;
    await page.goBack();
    await page.waitForURL('**/dashboard');
    await page.goBack();
    await page.waitForURL('**/login');
    await page.getByLabel('Usuario', { exact: true }).fill('admin');
    await page.getByLabel('Contraseña', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    const response = page.waitForResponse((r) => r.url().endsWith('/auth/refresh'));
    release();
    await response;
    await page.waitForURL('**/dashboard');
    await page.waitForLoadState('networkidle');
    assert.equal(calls.logout, 0, 'El refresh de la sesión anterior no debe revocar la nueva');
    assert.equal(calls.clientReads, 1, 'No reintentar la petición anterior con la sesión nueva');
    assert.equal(
      calls.loginAfterRefresh,
      true,
      'El login debe escribir sus cookies después del refresh anterior',
    );
    assert.equal(new URL(page.url()).pathname, '/dashboard');
    assert.equal(await page.evaluate(() => window.oldRefreshTest), true);
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
