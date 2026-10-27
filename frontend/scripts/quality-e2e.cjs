const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
assert.equal(process.env.QUALITY_ISOLATED, '1', 'Solo instalación desechable');
let browser;
(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
    args: ['--no-sandbox'],
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const pages = [];
  let checkingNavigation = true;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    if (
      r.status() >= 500 ||
      (checkingNavigation && path.startsWith('/api/v1/') && r.status() >= 400)
    )
      errors.push(`${r.status()} ${r.request().method()} ${path}${new URL(r.url()).search}`);
  });
  page.setDefaultTimeout(30000);
  await page.goto('http://localhost:3000/login');
  await page.getByLabel('Usuario', { exact: true }).fill('admin');
  await page.getByLabel('Contraseña', { exact: true }).fill('admin1234');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/dashboard');
  const api = 'http://localhost:3001/api/v1';
  for (const path of [
    '/dashboard',
    '/clientes',
    '/suscripciones',
    '/renovaciones',
    '/finanzas',
    '/estadisticas',
    '/recordatorios',
    '/calendario',
    '/importaciones',
    '/exportaciones',
    '/auditoria',
    '/configuracion',
  ]) {
    const start = Date.now();
    const response = await page.goto('http://localhost:3000' + path);
    assert.equal(response.status(), 200, path);
    await page.locator('#main-content').waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(new URL(page.url()).pathname, path);
    pages.push({
      path,
      readyWithNetworkIdleMs: Date.now() - start,
      ...(await page.evaluate(() => ({
        domContentLoadedMs: Math.round(
          performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,
        ),
        transferredJavascriptBytes: performance
          .getEntriesByType('resource')
          .filter((r) => r.initiatorType === 'script')
          .reduce((sum, r) => sum + r.transferSize, 0),
        decodedJavascriptBytes: performance
          .getEntriesByType('resource')
          .filter((r) => r.initiatorType === 'script')
          .reduce((sum, r) => sum + r.decodedBodySize, 0),
      }))),
    });
  }
  checkingNavigation = false;
  const me = await page.request.get(api + '/auth/me');
  assert.equal(me.status(), 200);
  assert.equal(me.headers()['x-content-type-options'], 'nosniff');
  const cookies = await context.cookies(api);
  for (const name of ['access_token', 'refresh_token']) {
    const cookie = cookies.find((c) => c.name === name);
    assert.ok(cookie, name);
    assert.ok(cookie.httpOnly);
    assert.ok(cookie.secure);
    assert.equal(cookie.sameSite, 'Lax');
  }
  assert.equal((await page.request.get('http://localhost:3001/api/docs')).status(), 404);
  assert.equal(
    (
      await page.request.post(api + '/clientes', {
        headers: { Origin: 'https://untrusted.invalid' },
        data: { nombre: 'No debe crearse' },
      })
    ).status(),
    403,
  );
  assert.equal((await page.request.get(api + '/auditoria?desde=2026-W43')).status(), 400);
  assert.equal((await page.request.post(api + '/auth/refresh')).status(), 200);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.waitForURL('**/login');
  assert.equal((await page.request.get(api + '/auth/me')).status(), 401);
  // Una pestaña nueva evita competir con router.refresh() del cierre de sesión.
  const loggedOut = await context.newPage();
  await loggedOut.goto('http://localhost:3000/clientes');
  await loggedOut.waitForURL('**/login');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        browser: 'OK',
        production: true,
        navigation: 'Sesión compartida con caché y prefetch; networkidle incluye 500 ms de quietud',
        pages,
        errors: 0,
      },
      null,
      2,
    ),
  );
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => browser?.close());
