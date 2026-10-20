const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const origin = process.env.FRONTEND_TEST_URL || 'http://localhost:3000';
let browser;
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox'],
  });
});
after(async () => {
  await browser?.close();
});
async function fixture(t, { fail = false, slow = false, mobile = false, history = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 1000 },
  });
  await context.addCookies([{ name: 'access_token', value: 'fixture', url: origin }]);
  const page = await context.newPage(),
    writes = [],
    errors = [],
    historyPages = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  const paged = (data) => ({
    success: true,
    data,
    pagination: { page: 1, total: data.length, totalPages: 1, limit: 25 },
  });
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace('/api/v1', '');
    const send = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.method() === 'OPTIONS') return send({});
    if (req.method() === 'POST' && path.startsWith('/exportaciones/')) {
      writes.push({ path, body: req.postDataJSON() });
      if (slow) await new Promise((resolve) => setTimeout(resolve, 700));
      if (fail) return send({ message: 'Acota los filtros: demasiados registros.' }, 400);
      return route.fulfill({
        status: 200,
        contentType: 'text/csv',
        headers: {
          'access-control-expose-headers': 'Content-Disposition',
          'content-disposition': 'attachment; filename="ensayo.csv"',
        },
        body: '\uFEFF"Nombre";"Teléfono"\r\n"Áéñ";"00123"\r\n',
      });
    }
    if (path === '/auth/me')
      return send({ success: true, data: { id: 'fixture', nombre: 'Ensayo', username: 'admin' } });
    if (path === '/exportaciones') {
      const p = Number(url.searchParams.get('page') ?? 1);
      historyPages.push(p);
      return send({
        data: [
          {
            id: 'row-' + p,
            tipo: 'csv',
            modulo: 'clientes',
            seccion: null,
            estado: p === 1 ? 'GENERADA' : 'FALLIDA',
            registros: p === 1 ? 0 : null,
            createdAt: '2026-10-20T10:00:00Z',
            usuario: { nombre: 'Ensayo' },
            error: null,
          },
        ],
        pagination: { page: p, total: 26, limit: 25 },
      });
    }
    if (path === '/finanzas/balance')
      return send({
        data: {
          ingresos: '0',
          gastos: '0',
          resultado: '0',
          pendienteCobro: '0',
          ticketMedio: '0',
          numeroOperaciones: 0,
        },
      });
    return send(paged([]));
  });
  await page.goto(origin + (history ? '/exportaciones' : '/clientes'));
  return { page, writes, historyPages };
}
test('descarga todos los resultados filtrados sin enviar paginación y conserva el nombre del archivo', async (t) => {
  const { page, writes } = await fixture(t);
  await page.getByPlaceholder('Buscar por nombre, teléfono o email…').fill('Áéñ');
  await page.getByLabel('Formato de exportación').selectOption('csv');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  assert.equal((await download).suggestedFilename(), 'ensayo.csv');
  assert.deepEqual(writes, [
    { path: '/exportaciones/clientes', body: { formato: 'csv', filtros: { search: 'Áéñ' } } },
  ]);
  await page.getByText('Archivo generado. Descarga iniciada.').waitFor();
});
test('explica errores de descarga recibidos como blob y permite reintentar', async (t) => {
  const { page, writes } = await fixture(t, { fail: true });
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('alert').getByText('Acota los filtros: demasiados registros.').waitFor();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('region', { name: 'Exportación de datos' }).getByRole('alert').waitFor();
  assert.equal(writes.length, 2);
});
test('impide exportaciones repetidas mientras genera y funciona en móvil', async (t) => {
  const { page, writes } = await fixture(t, { slow: true, mobile: true });
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Generando archivo…' }).isDisabled(), true);
  assert.equal(await page.getByLabel('Formato de exportación').isDisabled(), true);
  await page.getByText('Archivo generado. Descarga iniciada.').waitFor();
  assert.equal(writes.length, 1);
});
test('el historial diferencia cero registros de fallo y recupera páginas antiguas', async (t) => {
  const { page, historyPages } = await fixture(t, { history: true });
  await page.getByText('Archivo generado · 0 registros').waitFor();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByText('Generación fallida', { exact: true }).waitFor();
  assert.deepEqual(historyPages, [1, 2]);
});
test('renovaciones exporta los filtros de seguimiento y de historial por separado', async (t) => {
  const { page, writes } = await fixture(t);
  await page.goto(origin + '/renovaciones');
  await page.getByRole('button', { name: 'Vencidas', exact: true }).click();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByText('Archivo generado. Descarga iniciada.').waitFor();
  assert.deepEqual(writes[0].body, {
    formato: 'xlsx',
    seccion: 'seguimiento',
    filtros: { vista: 'vencidas' },
  });
  await page.getByRole('button', { name: 'Historial y cobros', exact: true }).click();
  await page.getByLabel('Filtrar cobro').selectOption('PENDIENTE');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByText('Archivo generado. Descarga iniciada.').waitFor();
  assert.deepEqual(writes[1].body, {
    formato: 'xlsx',
    seccion: 'historial',
    filtros: { cobro: 'PENDIENTE' },
  });
});
