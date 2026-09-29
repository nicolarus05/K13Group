// Chrome con API simulada. No se modifican datos de negocio.
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
const names = [
  'Resumen',
  'Clientes',
  'Renovaciones',
  'Finanzas',
  'Productos',
  'Servidores',
  'Referencias',
  'Métodos de pago',
];
const catalogScenarios = [
  { kind: 'productos', tab: 'Productos', report: 'Productos', label: 'Producto' },
  { kind: 'servidores', tab: 'Servidores', report: 'Servidores', label: 'Servidor' },
  { kind: 'referencias', tab: 'Referencias', report: 'Referencias', label: 'Referencia' },
  {
    kind: 'metodos-pago',
    tab: 'Métodos de pago',
    report: 'Finanzas',
    label: 'Método de pago (ingresos)',
  },
  {
    kind: 'categorias-gasto',
    tab: 'Categorías de gasto',
    report: 'Finanzas',
    label: 'Categoría de gasto',
  },
];
async function fixture(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(),
    queries = [],
    errors = [],
    state = { fail: false, count: 12, ...options };
  if (options.catalogEditing)
    state.catalogs = Object.fromEntries(
      catalogScenarios.map(({ kind }) => [
        kind,
        [{ id: 'option-1', nombre: 'Opción histórica', activo: true }],
      ]),
    );
  await context.addCookies([{ name: 'access_token', value: 'stats-test', url: origin }]);
  await page.clock.install({ time: new Date('2026-09-28T12:00:00Z') });
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace('/api/v1/', ''),
      q = Object.fromEntries(url.searchParams);
    const method = route.request().method();
    const [kind, id, action] = path.split('/');
    if (method !== 'GET') {
      assert.ok(state.catalogs?.[kind], 'Solo mutaciones simuladas de catálogo');
      const records = state.catalogs[kind];
      let data;
      if (method === 'POST' && !id) {
        data = { id: 'option-new', activo: true, ...route.request().postDataJSON() };
        records.push(data);
      } else {
        data = records.find((r) => r.id === id);
        assert.ok(data);
        if (method === 'PUT') Object.assign(data, route.request().postDataJSON());
        else if (method === 'DELETE') data.activo = false;
        else {
          assert.equal(method, 'POST');
          assert.equal(action, 'reactivar');
          data.activo = true;
        }
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data }),
      });
      return;
    }
    queries.push({ path, ...q });
    let data = [],
      pagination,
      status = 200;
    if (path === 'auth/me') data = { id: 'admin', nombre: 'Administrador', username: 'admin' };
    else if (path.startsWith('estadisticas')) {
      const section = path.split('/')[1] || 'resumen';
      data = {
        seccion: section,
        hoy: '2026-09-28',
        actualizado: '2026-09-28T12:00:00Z',
        calidad: { filasSinConciliar: 3 },
        periodo: {
          desde: q.desde,
          hasta: q.hasta,
          anteriorDesde: '2026-08-04',
          anteriorHasta: '2026-08-31',
          dias: 28,
          agrupacion: q.agrupacion,
        },
      };
      if (['resumen', 'finanzas'].includes(section))
        data.finanzas = {
          ingresos: q.categoriaGastoId ? null : '225.00',
          gastos: q.metodoPagoId ? null : '25.00',
          resultado: q.metodoPagoId || q.categoriaGastoId ? null : '200.00',
          ticketMedio: q.categoriaGastoId ? null : '75.00',
          numeroIngresos: q.categoriaGastoId ? 0 : 3,
          numeroGastos: q.metodoPagoId ? 0 : 1,
          variacion: { ingresos: null, gastos: '25.0', resultado: null },
          serie: [{ dia: q.desde, ingresos: '225.00', gastos: '25.00', resultado: '200.00' }],
        };
      if (['resumen', 'clientes'].includes(section))
        data.clientes = {
          altas: 10,
          altasAnteriores: 5,
          variacion: '100.0',
          actual: { total: 20, vigentes: 15, perdidos: 2, noRenovar: 1 },
          serie: [{ dia: q.desde, altas: 10 }],
          productosActuales: [{ id: 'p', nombre: 'App A', clientes: 15 }],
        };
      if (['resumen', 'renovaciones'].includes(section))
        data.renovaciones = {
          realizadas: 12,
          altas: 1,
          anuladas: 2,
          gratuitas: 1,
          pendientesCobro: 1,
          tasa: {
            clientes: 10,
            renovados: 8,
            porcentaje: state.incomplete ? null : '80.0',
            porcentajeObservable: '80.0',
            sinVencimientoAnterior: state.incomplete ? 2 : 0,
            provisional: true,
          },
          situacionActual: { vencidas: 2, hoy: 1, proximas: 3, diasAviso: 7 },
          serie: [{ dia: q.desde, renovaciones: 12 }],
        };
      if (
        ['productos', 'servidores', 'referencias', 'metodos-pago', 'finanzas'].includes(section)
      ) {
        const rows = Array.from({ length: state.count }, (_, i) => ({
          clave: 'g' + i,
          nombre: 'Grupo ' + (i + 1),
          importe: '10.00',
          operaciones: 1,
          renovaciones: 1,
          clientesCobro: 1,
          clientesActuales: 1,
          porcentaje: '8.3',
        }));
        const number = Number(q.page || 1);
        data.ranking = {
          dimension: section === 'finanzas' ? 'categorias' : section,
          totalImporte: String(state.count * 10),
          data: rows.slice((number - 1) * 10, number * 10),
          grafico: [
            ...rows.slice(0, 10),
            ...(state.count > 10
              ? [{ clave: 'otros', nombre: 'Otros', importe: String((state.count - 10) * 10) }]
              : []),
          ],
          pagination: {
            page: number,
            limit: 10,
            total: state.count,
            totalPages: Math.ceil(state.count / 10),
          },
        };
      }
      if (state.fail) status = 500;
    } else if (
      ['productos', 'servidores', 'referencias', 'metodos-pago', 'categorias-gasto'].includes(path)
    ) {
      const records = state.catalogs?.[path] ?? [
        { id: 'option-1', nombre: 'Opción histórica', activo: false },
      ];
      const filtered = records.filter(
        (r) =>
          (!q.search || r.nombre.toLowerCase().includes(q.search.toLowerCase())) &&
          (q.estado === 'activo' ? r.activo : q.estado === 'inactivo' ? !r.activo : true),
      );
      const page = Number(q.page || 1),
        limit = Number(q.limit || 25);
      data = filtered.slice((page - 1) * limit, page * limit);
      pagination = {
        page,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / limit),
        limit,
      };
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(
        status === 500 ? { message: 'Informe no disponible' } : { success: true, data, pagination },
      ),
    });
  });
  await page.goto(origin + '/estadisticas');
  const tab = (name) =>
    page
      .getByRole('navigation', { name: 'Informes estadísticos' })
      .getByRole('button', { name, exact: true });
  const metric = (label) =>
    page
      .locator('.stats-metric')
      .filter({ has: page.getByRole('heading', { name: label, exact: true }) });
  if (!state.fail) await metric('Ingresos brutos').waitFor();
  return { page, queries, state, tab, metric };
}
for (const scenario of catalogScenarios) {
  test(
    `catálogo ${scenario.kind}: altas, nombres y estados se actualizan al volver a estadísticas`,
    { timeout: 60000 },
    async (t) => {
      const { page, tab } = await fixture(t, { catalogEditing: true });
      // Congelar el tiempo: la prueba debe pasar por invalidación, no por caducidad.
      await page.clock.setFixedTime(new Date('2026-09-28T12:00:00Z'));
      await tab(scenario.report).click();
      const select = page.getByRole('combobox', { name: scenario.label, exact: true });
      await select.selectOption('option-1');
      const openCatalog = async () => {
        await page.getByRole('link', { name: 'Catálogos', exact: true }).click();
        await page
          .getByRole('navigation', { name: 'Tipos de catálogo' })
          .getByRole('button', { name: scenario.tab, exact: true })
          .click();
      };
      const back = async () => {
        await page.getByRole('link', { name: 'Estadísticas', exact: true }).click();
        await select.waitFor();
      };
      await openCatalog();
      await page.getByLabel('Nombre', { exact: true }).fill('Nueva opción');
      await page.getByRole('button', { name: 'Crear', exact: true }).click();
      await page.getByText('Registro guardado.', { exact: true }).waitFor();
      await back();
      await select
        .getByRole('option', { name: 'Nueva opción', exact: true })
        .waitFor({ state: 'attached', timeout: 10000 });
      assert.equal(
        await select.inputValue(),
        'option-1',
        'La creación no cambia el filtro elegido',
      );
      await select.selectOption('option-new');
      await openCatalog();
      await page
        .locator('article')
        .filter({ hasText: 'Nueva opción' })
        .getByRole('button', { name: 'Editar', exact: true })
        .click();
      await page.getByLabel('Nombre', { exact: true }).fill('Opción renombrada');
      await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
      await page.getByText('Registro guardado.', { exact: true }).waitFor();
      await back();
      await select
        .getByRole('option', { name: 'Opción renombrada', exact: true })
        .waitFor({ state: 'attached' });
      assert.equal(await select.inputValue(), 'option-new');
      await openCatalog();
      await page
        .locator('article')
        .filter({ hasText: 'Opción renombrada' })
        .getByRole('button', { name: 'Desactivar', exact: true })
        .click();
      await page
        .getByText('Estado actualizado. El historial se conserva.', { exact: true })
        .waitFor();
      await back();
      await select
        .getByRole('option', { name: 'Opción renombrada (inactivo)', exact: true })
        .waitFor({ state: 'attached' });
      assert.equal(
        await select.inputValue(),
        'option-new',
        'El histórico inactivo sigue seleccionado',
      );
      await openCatalog();
      await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('todos');
      await page
        .locator('article')
        .filter({ hasText: 'Opción renombrada' })
        .getByRole('button', { name: 'Reactivar', exact: true })
        .click();
      await page
        .getByText('Estado actualizado. El historial se conserva.', { exact: true })
        .waitFor();
      await back();
      await select
        .getByRole('option', { name: 'Opción renombrada', exact: true })
        .waitFor({ state: 'attached' });
      assert.equal(await select.inputValue(), 'option-new');
    },
  );
}
test(
  'Actualizar renueva también las opciones sin perder búsqueda, página ni selección',
  { timeout: 30000 },
  async (t) => {
    const { page, tab, state, queries } = await fixture(t, { catalogEditing: true });
    state.catalogs.productos = Array.from({ length: 30 }, (_, i) => ({
      id: 'p-' + i,
      nombre: 'App ' + i,
      activo: true,
    }));
    await tab('Productos').click();
    const search = page.getByRole('textbox', { name: 'Buscar opciones de Producto', exact: true });
    await search.fill('App');
    await page.getByRole('button', { name: 'Más opciones de Producto', exact: true }).click();
    const select = page.getByRole('combobox', { name: 'Producto', exact: true });
    await select.selectOption('p-29');
    state.catalogs.productos[29].nombre = 'App nombre actualizado';
    const refreshed = page.waitForResponse(
      (r) => r.url().includes('/productos?') && r.url().includes('page=2'),
    );
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await refreshed;
    await select
      .getByRole('option', { name: 'App nombre actualizado', exact: true })
      .waitFor({ state: 'attached' });
    assert.equal(await select.inputValue(), 'p-29');
    assert.equal(await search.inputValue(), 'App');
    assert.equal(queries.filter((q) => q.path === 'productos').at(-1).page, '2');
  },
);
test(
  'ocho informes, tasa por cliente y diseños escritorio/móvil sin desbordamientos',
  { timeout: 60000 },
  async (t) => {
    const { page, tab } = await fixture(t);
    for (const name of names) {
      await tab(name).click();
      await page.getByText('Solo datos registrados:', { exact: false }).waitFor();
      assert.equal(await tab(name).getAttribute('aria-pressed'), 'true');
    }
    await tab('Renovaciones').click();
    await page.getByText('80.0 %', { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await tab('Productos').click();
    await page.getByRole('region', { name: 'Desglose estadístico' }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  },
);
test(
  'fechas excesivas se rechazan; fechas en borrador no cambian el informe',
  { timeout: 30000 },
  async (t) => {
    const { page, queries } = await fixture(t);
    await page.getByLabel('Periodo', { exact: true }).selectOption('personalizado');
    await page.getByLabel('Desde', { exact: true }).fill('2020-01-01');
    await page.getByRole('button', { name: 'Aplicar fechas' }).click();
    await page.getByRole('alert').filter({ hasText: 'cinco años' }).waitFor();
    assert.equal(
      queries.some((q) => q.desde === '2020-01-01'),
      false,
    );
    await page.getByLabel('Desde', { exact: true }).fill('2025-01-01');
    await page.getByLabel('Agrupación').selectOption('dia');
    await page.getByRole('button', { name: 'Aplicar fechas' }).click();
    await page.getByRole('alert').filter({ hasText: '366 días' }).waitFor();
    await page.getByLabel('Agrupación').selectOption('mes');
    const applied = page.waitForResponse((r) => r.url().includes('desde=2025-01-01'));
    await page.getByRole('button', { name: 'Aplicar fechas' }).click();
    await applied;
  },
);
test(
  'finanzas no calcula beneficio al filtrar un solo lado del balance',
  { timeout: 30000 },
  async (t) => {
    const { page, tab, metric, queries } = await fixture(t);
    await tab('Finanzas').click();
    const method = page.getByRole('combobox', { name: 'Método de pago (ingresos)', exact: true });
    await method.selectOption('option-1');
    await metric('Resultado operativo').getByText('No aplicable', { exact: true }).waitFor();
    await metric('Ingresos brutos')
      .getByText(/225,00/)
      .waitFor();
    await page
      .getByRole('combobox', { name: 'Categoría de gasto', exact: true })
      .selectOption('option-1');
    await metric('Ingresos brutos').getByText('No aplicable', { exact: true }).waitFor();
    assert.equal(await method.inputValue(), '');
    assert.equal(
      queries.some((q) => q.categoriaGastoId && q.metodoPagoId),
      false,
    );
  },
);
test(
  'filtros independientes por sección y persistencia de sesión',
  { timeout: 30000 },
  async (t) => {
    const { page, tab, queries } = await fixture(t);
    await tab('Clientes').click();
    await page.getByLabel('Estado actual del cliente').selectOption('INACTIVO');
    await tab('Productos').click();
    await page.getByRole('combobox', { name: 'Producto', exact: true }).selectOption('option-1');
    await page.getByRole('region', { name: 'Desglose estadístico' }).waitFor();
    await page.reload();
    await page.getByRole('combobox', { name: 'Producto', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('combobox', { name: 'Producto', exact: true }).inputValue(),
      'option-1',
    );
    await tab('Clientes').click();
    assert.equal(await page.getByLabel('Estado actual del cliente').inputValue(), 'INACTIVO');
    assert.equal(
      queries.some((q) => q.path === 'estadisticas/productos' && q.estadoCliente),
      false,
    );
  },
);
test(
  'disminución de resultados reajusta página; Otros mantiene el desglose visible',
  { timeout: 30000 },
  async (t) => {
    const { page, tab, state } = await fixture(t);
    await tab('Productos').click();
    await page.getByText('Otros', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await page.getByRole('cell', { name: 'Grupo 11', exact: true }).waitFor();
    state.count = 3;
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await page.getByText('3 grupos · Página 1 de 1', { exact: true }).waitFor();
    state.count = 0;
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await page.getByText('No hay datos para estos filtros.', { exact: true }).waitFor();
  },
);
test('el error permite reintentar y no presenta ceros falsos', { timeout: 30000 }, async (t) => {
  const { page, state, metric } = await fixture(t, { fail: true });
  await page.getByRole('button', { name: 'Reintentar informe' }).waitFor();
  assert.equal(await page.locator('.stats-metric').count(), 0);
  state.fail = false;
  await page.getByRole('button', { name: 'Reintentar informe' }).click();
  await metric('Ingresos brutos')
    .getByText(/225,00/)
    .waitFor();
});
test(
  'la cobertura incompleta no se presenta como tasa definitiva',
  { timeout: 30000 },
  async (t) => {
    const { page, tab } = await fixture(t, { incomplete: true });
    await tab('Renovaciones').click();
    await page.getByRole('status').filter({ hasText: 'Cobertura incompleta' }).waitFor();
    assert.equal(await page.getByText('80.0 %', { exact: true }).count(), 0);
  },
);
test(
  'el rango relativo avanza al recuperar foco sin pisar el borrador personalizado',
  { timeout: 30000 },
  async (t) => {
    const { page, queries } = await fixture(t);
    await page.getByLabel('Periodo', { exact: true }).selectOption('hoy');
    await page.clock.setSystemTime(new Date('2026-09-28T22:01:00Z'));
    const refresh = page.waitForResponse((r) => r.url().includes('desde=2026-09-29'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await refresh;
    await page.getByLabel('Periodo', { exact: true }).selectOption('personalizado');
    await page.getByLabel('Desde', { exact: true }).fill('2026-08-01');
    await page.clock.setSystemTime(new Date('2026-09-29T22:01:00Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.getByLabel('Desde', { exact: true }).inputValue(), '2026-08-01');
    assert.equal(
      queries.some((q) => q.hasta === '2026-09-30'),
      false,
    );
  },
);
