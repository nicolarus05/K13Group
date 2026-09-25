// Navegador real con API simulada: no escribe en datos de negocio.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const origin = process.env.FRONTEND_TEST_URL || 'http://localhost:3000';
let browser;
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
test(
  'error del resumen permite reintento sin ocultar clientes ni inventar indicadores',
  { timeout: 30000 },
  async (t) => {
    const { page, recover } = await fixture(t, { fail: true });
    await page.getByRole('button', { name: 'Reintentar resumen' }).waitFor();
    assert.equal(await page.locator('.k13-kpi').count(), 0);
    await page.getByRole('row').filter({ hasText: 'Cliente de prueba' }).waitFor();
    recover();
    await page.getByRole('button', { name: 'Reintentar resumen' }).click();
    await page.locator('.k13-kpi').first().waitFor();
    assert.equal(await page.locator('.k13-kpi').count(), 8);
  },
);
async function fixture(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }),
    page = await context.newPage();
  const errors = [],
    queries = [],
    writes = [];
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await context.addCookies([{ name: 'access_token', value: 'dashboard-ui-only', url: origin }]);
  await page.clock.install({ time: new Date(options.time || '2026-09-25T12:00:00Z') });
  const clients = options.empty
    ? []
    : [
        {
          id: 'client-1',
          nombre: 'Cliente de prueba',
          telefono: '600 111 222',
          createdAt: '2026-09-25T12:00:00Z',
          estado: { valor: 'ACTIVO', etiqueta: 'Activo' },
          numeroSuscripciones: 2,
          proximaRenovacion: { id: 'sub-1', fechaFin: '2026-09-30' },
        },
      ];
  if (options.count) {
    const template = clients[0];
    clients.splice(
      0,
      clients.length,
      ...Array.from({ length: options.count }, (_, i) => ({
        ...template,
        id: 'client-' + i,
        nombre: 'Cliente ' + String(i + 1).padStart(2, '0'),
      })),
    );
  }
  const report = {
    hoy: '2026-09-25',
    actualizado: '2026-09-25T12:00:00Z',
    periodo: {
      desde: '2026-09-01',
      hasta: '2026-09-25',
      anteriorDesde: '2026-08-07',
      anteriorHasta: '2026-08-31',
      days: 25,
    },
    indicadores: {
      clientesVigentes: 1,
      suscripcionesVigentes: 2,
      renovaciones: 3,
      nuevosClientes: 1,
      ingresos: '225.00',
      gastos: '25.00',
      resultado: '200.00',
      pendienteCobro: '75.00',
      numeroPendientes: 1,
      totalClientes: 1,
    },
    variacion: {
      renovaciones: '50.0',
      nuevosClientes: null,
      ingresos: '50.0',
      gastos: '25.0',
      resultado: '100.0',
    },
    serie: Array.from({ length: 25 }, (_, i) => ({
      dia: '2026-09-' + String(i + 1).padStart(2, '0'),
      ingresos: [4, 10, 21].includes(i) ? '75.00' : '0.00',
      gastos: i === 14 ? '25.00' : '0.00',
      clientes: i === 24 ? 1 : 0,
      renovaciones: [4, 10, 21].includes(i) ? 1 : 0,
    })),
    trabajo: {
      hoy: 0,
      vencidas: 0,
      proximas: 2,
      diasAviso: 7,
      renovaciones: [],
      cobros: [],
      recordatorios: [],
    },
    actividad: [],
  };
  report.calidadImportacion = {
    ultima: null,
    pendientes: 0,
    bloqueadas: 0,
    pendientesFinancieras: 0,
  };
  let failures = options.fail ? 99 : 0;
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace('/api/v1/', '');
    queries.push({ path, ...Object.fromEntries(url.searchParams) });
    let data = [],
      status = 200,
      body;
    if (req.method() !== 'GET') {
      writes.push({ path, dto: req.postDataJSON() });
      if (options.clientError) {
        status = 409;
        body = { message: 'Cliente duplicado de prueba' };
      } else {
        clients.push({ ...clients[0], id: 'client-2', nombre: req.postDataJSON().nombre });
        report.indicadores.nuevosClientes++;
        data = clients.at(-1);
      }
    } else if (path === 'auth/me')
      data = { id: 'admin-1', nombre: 'Administrador', username: 'admin' };
    else if (path === 'dashboard') {
      if (failures) {
        failures--;
        status = 500;
        body = { message: 'Resumen no disponible' };
      } else
        data = {
          ...report,
          periodo: {
            ...report.periodo,
            desde: url.searchParams.get('desde'),
            hasta: url.searchParams.get('hasta'),
          },
        };
    } else if (path === 'dashboard/clientes') {
      const filtered = clients.filter((c) =>
        c.nombre.toLowerCase().includes((url.searchParams.get('search') || '').toLowerCase()),
      );
      const requestedPage = Number(url.searchParams.get('page') || 1);
      body = {
        success: true,
        data: filtered.slice((requestedPage - 1) * 10, requestedPage * 10),
        pagination: {
          page: requestedPage,
          limit: 10,
          total: filtered.length,
          totalPages: Math.ceil(filtered.length / 10),
        },
      };
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body || { success: true, data }),
    });
  });
  await page.goto(origin + '/dashboard');
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  return {
    page,
    queries,
    writes,
    clients,
    recover: () => {
      failures = 0;
    },
  };
}
for (const scenario of [
  { preset: 'hoy', time: '2026-09-30T21:59:00Z', desde: '2026-10-01', hasta: '2026-10-01' },
  { preset: 'mes', time: '2026-09-30T21:59:00Z', desde: '2026-10-01', hasta: '2026-10-01' },
  { preset: 'semana', time: '2026-09-27T21:59:00Z', desde: '2026-09-28', hasta: '2026-09-28' },
  { preset: 'ano', time: '2026-12-31T22:59:00Z', desde: '2027-01-01', hasta: '2027-01-01' },
  { preset: 'hoy', time: '2026-03-29T21:59:00Z', desde: '2026-03-30', hasta: '2026-03-30' },
  { preset: 'hoy', time: '2026-10-25T22:59:00Z', desde: '2026-10-26', hasta: '2026-10-26' },
]) {
  test(
    'periodo relativo se actualiza al cambiar de día en Madrid: ' +
      scenario.preset +
      ' ' +
      scenario.hasta,
    { timeout: 30000 },
    async (t) => {
      const { page, writes } = await fixture(t, { time: scenario.time });
      await page.locator('.k13-kpi').first().waitFor();
      await page.getByLabel('Periodo', { exact: true }).selectOption(scenario.preset);
      const response = page.waitForResponse((r) => {
        const url = new URL(r.url());
        return (
          url.pathname.endsWith('/dashboard') &&
          url.searchParams.get('desde') === scenario.desde &&
          url.searchParams.get('hasta') === scenario.hasta
        );
      });
      await page.clock.fastForward(125000);
      await response;
      await page.getByLabel('Periodo', { exact: true }).selectOption('personalizado');
      assert.equal(await page.getByLabel('Desde', { exact: true }).inputValue(), scenario.desde);
      assert.equal(await page.getByLabel('Hasta', { exact: true }).inputValue(), scenario.hasta);
      assert.deepEqual(writes, []);
    },
  );
}
for (const event of ['focus', 'visibilitychange']) {
  test(
    'recupera el día correcto tras suspensión de pestaña: ' + event,
    { timeout: 30000 },
    async (t) => {
      const { page } = await fixture(t, { time: '2026-09-30T21:59:00Z' });
      await page.locator('.k13-kpi').first().waitFor();
      await page.clock.pauseAt(new Date('2026-09-30T21:59:10Z'));
      await page.clock.setSystemTime(new Date('2026-10-02T10:00:00Z'));
      const response = page.waitForResponse(
        (r) => r.url().includes('/dashboard?') && r.url().includes('hasta=2026-10-02'),
      );
      await page.evaluate(
        (event) => (event === 'focus' ? window : document).dispatchEvent(new Event(event)),
        event,
      );
      await response;
      await page.getByLabel('Periodo', { exact: true }).selectOption('personalizado');
      assert.equal(await page.getByLabel('Desde', { exact: true }).inputValue(), '2026-10-01');
      assert.equal(await page.getByLabel('Hasta', { exact: true }).inputValue(), '2026-10-02');
    },
  );
}
test(
  'el cambio de día conserva periodo personalizado aplicado y borrador sin aplicar',
  { timeout: 30000 },
  async (t) => {
    const { page, queries } = await fixture(t, { time: '2026-09-30T21:59:00Z' });
    await page.locator('.k13-kpi').first().waitFor();
    await page.getByLabel('Periodo', { exact: true }).selectOption('personalizado');
    await page.getByLabel('Desde', { exact: true }).fill('2026-09-10');
    await page.getByLabel('Hasta', { exact: true }).fill('2026-09-20');
    const applied = page.waitForResponse(
      (r) => r.url().includes('/dashboard?') && r.url().includes('desde=2026-09-10'),
    );
    await page.getByRole('button', { name: 'Aplicar periodo' }).click();
    await applied;
    await page.getByLabel('Desde', { exact: true }).fill('2026-09-12');
    const refreshed = page.waitForResponse(
      (r) => r.url().includes('/dashboard?') && r.url().includes('desde=2026-09-10'),
    );
    await page.clock.fastForward(125000);
    await refreshed;
    assert.equal(await page.getByLabel('Desde', { exact: true }).inputValue(), '2026-09-12');
    assert.equal(await page.getByLabel('Hasta', { exact: true }).inputValue(), '2026-09-20');
    const last = queries.filter((q) => q.path === 'dashboard').at(-1);
    assert.equal(last.desde, '2026-09-10');
    assert.equal(last.hasta, '2026-09-20');
  },
);
test('el cambio de día no borra el formulario de nuevo cliente', { timeout: 30000 }, async (t) => {
  const { page, writes } = await fixture(t, { time: '2026-09-30T21:59:00Z' });
  await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre *', { exact: true }).fill('Borrador de medianoche');
  await page.clock.fastForward(125000);
  assert.equal(
    await dialog.getByLabel('Nombre *', { exact: true }).inputValue(),
    'Borrador de medianoche',
  );
  assert.deepEqual(writes, []);
});
test(
  'reajusta última página si desaparecen clientes y vuelve a página 1 si queda vacío',
  { timeout: 30000 },
  async (t) => {
    const { page, clients, queries, writes } = await fixture(t, { count: 21 });
    await page
      .locator('.k13-pagination')
      .getByText(/21 clientes/)
      .waitFor();
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await page
      .locator('.k13-pagination')
      .getByText(/Página 2 de 3/)
      .waitFor();
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await page
      .locator('.k13-pagination')
      .getByText(/Página 3 de 3/)
      .waitFor();
    clients.pop();
    await page.clock.fastForward(61000);
    await page
      .locator('.k13-pagination')
      .getByText(/20 clientes · Página 2 de 2/)
      .waitFor();
    assert.equal(await page.locator('#listado-clientes tbody tr').count(), 10);
    assert.equal(await page.getByText('No hay clientes para estos filtros.').count(), 0);
    clients.splice(0);
    await page.clock.fastForward(61000);
    await page
      .locator('.k13-pagination')
      .getByText(/0 clientes · Página 1 de 1/)
      .waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Anterior', exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Siguiente', exact: true }).isDisabled(),
      true,
    );
    assert.ok(
      queries.filter((q) => q.path === 'dashboard/clientes').every((q) => Number(q.page) >= 1),
    );
    assert.deepEqual(writes, []);
  },
);
test(
  'ocho indicadores reales, clientes y logo; captura escritorio',
  { timeout: 45000 },
  async (t) => {
    const { page } = await fixture(t);
    await page.locator('.k13-kpi').first().waitFor();
    assert.equal(await page.locator('.k13-kpi').count(), 8);
    await page
      .getByRole('link', { name: /Ingresos brutos/ })
      .getByText(/225,00/)
      .waitFor();
    await page.getByRole('row').filter({ hasText: 'Cliente de prueba' }).waitFor();
    await page.getByText(/Sin base de comparación/).waitFor();
    assert.equal(
      await page
        .locator('.k13-desktop-nav img')
        .evaluate((img) => img.complete && img.naturalWidth > 0),
      true,
    );
    assert.equal(
      await page
        .locator('.k13-kpis')
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
      4,
    );
    await page.screenshot({ path: '/tmp/k13-dashboard-desktop.png' });
    await page.getByRole('button', { name: 'Contraer barra lateral', exact: true }).click();
    await page.getByRole('button', { name: 'Expandir barra lateral', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Clientes', exact: true }).isVisible(), true);
  },
);
test(
  'móvil sin desbordamiento y menú accesible con cierre y foco',
  { timeout: 30000 },
  async (t) => {
    const { page } = await fixture(t);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.k13-kpi').first().waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.equal(
      await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
    );
    await page.screenshot({ path: '/tmp/k13-dashboard-mobile.png' });
    const toggle = page.getByRole('button', { name: 'Abrir o contraer menú' });
    await toggle.click();
    const dialog = page.getByRole('dialog', { name: 'Menú de navegación' });
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await toggle.evaluate((el) => el === document.activeElement), true);
    await toggle.click();
    await dialog.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  },
);
test(
  'periodo personalizado validado, filtros de clientes independientes y estados vacíos',
  { timeout: 30000 },
  async (t) => {
    const { page, queries } = await fixture(t, { empty: true });
    await page.getByText('No hay clientes para estos filtros.').waitFor();
    await page.getByLabel('Periodo', { exact: true }).selectOption('personalizado');
    await page.getByLabel('Desde', { exact: true }).fill('2026-09-25');
    await page.getByLabel('Hasta', { exact: true }).fill('2026-09-24');
    await page.getByRole('button', { name: 'Aplicar periodo' }).click();
    await page
      .getByRole('alert')
      .getByText(/1 y 366/)
      .waitFor();
    await page.getByLabel('Hasta', { exact: true }).fill('2026-09-25');
    const response = page.waitForResponse(
      (r) => r.url().includes('/dashboard?') && r.url().includes('desde=2026-09-25'),
    );
    await page.getByRole('button', { name: 'Aplicar periodo' }).click();
    await response;
    await page.getByLabel('Filtrar estado del cliente').selectOption('INACTIVO');
    await page.getByLabel('Buscar cliente por nombre o teléfono').fill('Ana');
    await page.waitForResponse((r) => r.url().includes('search=Ana'));
    assert.ok(
      queries.some(
        (q) => q.path === 'dashboard/clientes' && q.estado === 'INACTIVO' && q.search === 'Ana',
      ),
    );
    assert.ok(queries.filter((q) => q.path === 'dashboard/clientes').every((q) => !q.desde));
  },
);
test(
  'crear cliente invalida resumen y listado sin recargar página',
  { timeout: 30000 },
  async (t) => {
    const { page, writes, queries } = await fixture(t);
    await page.locator('.k13-kpi').first().waitFor();
    const initial = queries.filter((q) => q.path === 'dashboard').length;
    await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nombre *', { exact: true }).fill('Nuevo cliente UI');
    await dialog.getByRole('button', { name: 'Crear cliente', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('row').filter({ hasText: 'Nuevo cliente UI' }).waitFor();
    assert.equal(writes.length, 1);
    assert.ok(queries.filter((q) => q.path === 'dashboard').length > initial);
  },
);
test(
  'error al guardar permanece visible dentro del formulario con el borrador',
  { timeout: 30000 },
  async (t) => {
    const { page } = await fixture(t, { clientError: true });
    await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nombre *', { exact: true }).fill('Duplicado');
    await dialog.getByRole('button', { name: 'Crear cliente', exact: true }).click();
    await dialog
      .getByRole('alert')
      .getByText(/duplicado/)
      .waitFor();
    assert.equal(await dialog.getByLabel('Nombre *', { exact: true }).inputValue(), 'Duplicado');
  },
);
