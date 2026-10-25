const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const origin = process.env.FRONTEND_TEST_URL || 'http://localhost:3000';
let browser;
before(async () => {
  browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox'],
  });
});
after(async () => {
  await browser?.close();
});
async function fixture(t, { mobile = false, failed = false, legacy = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 1000 },
  });
  await context.addCookies([{ name: 'access_token', value: 'fixture', url: origin }]);
  const page = await context.newPage(),
    errors = [],
    queries = [],
    writes = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  let fail = failed;
  const row = {
    id: '10000000-0000-4000-8000-000000000001',
    tabla: 'clientes',
    registroId: '20000000-0000-4000-8000-000000000001',
    accion: 'EDITAR',
    createdAt: '2026-10-24T12:00:00Z',
    usuario: null,
  };
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace('/api/v1', '');
    const send = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.method() === 'OPTIONS') return send({});
    if (req.method() !== 'GET') {
      writes.push(path);
      return send({ success: true });
    }
    if (path === '/auth/me')
      return send({ data: { id: 'fixture', username: 'admin', nombre: 'Ensayo' } });
    if (path === '/auditoria/filtros')
      return send({ data: { tablas: ['clientes'], acciones: ['EDITAR'], usuarios: [] } });
    if (path === '/auditoria') {
      queries.push(Object.fromEntries(url.searchParams));
      if (fail) return send({ message: 'Auditoría temporalmente no disponible.' }, 503);
      return send({
        data: [row],
        pagination: { siguiente: url.searchParams.has('cursor') ? null : 'next-page' },
      });
    }
    if (path === '/auditoria/' + row.id)
      return send({
        data: {
          ...row,
          datosAnteriores: legacy ? null : { nombre: 'Antes' },
          datosNuevos: { nombre: 'Después', password: '[Oculto]' },
          cambios: legacy ? null : [{ campo: 'nombre', anterior: 'Antes', nuevo: 'Después' }],
        },
      });
    return send({ data: [], pagination: { total: 0 } });
  });
  await page.goto(origin + '/auditoria');
  return {
    page,
    queries,
    writes,
    row,
    recover: () => {
      fail = false;
    },
  };
}
test('filtra, pagina y consulta el historial de un registro sin escrituras', async (t) => {
  const f = await fixture(t),
    p = f.page;
  await p.getByRole('button', { name: 'Ver detalle', exact: true }).waitFor();
  await p.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await p.getByText('Página 2', { exact: true }).waitFor();
  await p.getByRole('button', { name: 'Anterior', exact: true }).click();
  await p.getByText('Página 1', { exact: true }).waitFor();
  await p.getByLabel('Módulo', { exact: true }).selectOption('clientes');
  await Promise.all([
    p.waitForResponse((r) => r.url().includes('/auditoria?tabla=clientes')),
    p.getByRole('button', { name: 'Filtrar', exact: true }).click(),
  ]);
  await p.getByRole('button', { name: 'Ver detalle', exact: true }).click();
  await p.getByRole('cell', { name: '"Antes"', exact: true }).waitFor();
  await Promise.all([
    p.waitForResponse((r) => r.url().includes('registroId=')),
    p.getByRole('button', { name: 'Historial del registro', exact: true }).click(),
  ]);
  assert.equal(f.queries.at(-1).registroId, f.row.registroId);
  assert.deepEqual(f.writes, []);
});
test('histórico incompleto y vista móvil sin desbordamiento', async (t) => {
  const { page } = await fixture(t, { mobile: true, legacy: true });
  await page.getByRole('button', { name: 'Ver detalle', exact: true }).click();
  await page
    .getByText('No se registraron ambas instantáneas; no se puede reconstruir la comparación.')
    .waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
test('muestra el fallo de consulta y permite reintentar', async (t) => {
  const f = await fixture(t, { failed: true });
  await f.page.getByText('Auditoría temporalmente no disponible.', { exact: false }).waitFor();
  f.recover();
  await f.page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await f.page.getByRole('button', { name: 'Ver detalle', exact: true }).waitFor();
});

test('Actualizar desde la segunda página consulta de nuevo la primera aunque siga en caché', async (t) => {
  const { page, queries } = await fixture(t);
  await page.getByRole('button', { name: 'Ver detalle', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByText('Página 2', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).isDisabled();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/v1/auditoria' &&
        !new URL(r.url()).searchParams.has('cursor'),
      { timeout: 5000 },
    ),
    page.getByRole('button', { name: 'Actualizar', exact: true }).click(),
  ]);
  await page.getByText('Página 1', { exact: true }).waitFor();
  assert.equal(queries.filter((q) => !q.cursor).length, 2);
});
