// API ficticia; navegador real. Nunca escribe en la base de negocio.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
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
async function fixture(t, config = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [],
    writes = [],
    queries = [];
  const category = { id: randomUUID(), nombre: 'Hosting UI', activo: true };
  const method = { id: randomUUID(), nombre: 'Efectivo UI', activo: true, esGratuito: false };
  const free = { id: randomUUID(), nombre: 'Gratis UI', activo: true, esGratuito: true };
  let row = {
    id: randomUUID(),
    version: 1,
    importe: '25.1',
    fecha: '2026-09-25T00:00:00Z',
    fechaCobro: '2026-09-25T00:00:00Z',
    fechaPrevistaCobro: null,
    concepto: 'Hosting de prueba',
    descripcion: null,
    observaciones: 'Original',
    origen: 'GASTO_MANUAL',
    categoriaGastoId: category.id,
    metodoPagoId: method.id,
    categoriaNombreSnapshot: category.nombre,
    metodoPagoNombreSnapshot: method.nombre,
    suscripcion: null,
    suscripcionId: null,
    renovacionId: null,
    tipo: { valor: 'GASTO', etiqueta: 'Gasto' },
    estado: { valor: 'CONFIRMADO', etiqueta: 'Confirmado' },
    categoriaGasto: category,
    metodoPago: method,
    ...config.row,
  };
  await context.addCookies([{ name: 'access_token', value: 'finance-ui-only', url: origin }]);
  await page.clock.install({ time: new Date('2026-09-25T12:00:00Z') });
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  const paged = (data) => ({
    success: true,
    data,
    pagination: { total: data.length, page: 1, limit: 25, totalPages: data.length ? 1 : 0 },
  });
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace('/api/v1/', '');
    let body,
      status = 200;
    if (req.method() !== 'GET') {
      const dto = req.postDataJSON();
      writes.push({ method: req.method(), path, dto });
      if (config.failFirst && writes.length === 1) {
        status = 500;
        body = { message: 'Fallo simulado' };
      } else if (config.conflict) {
        status = 409;
        body = { message: 'El gasto ha cambiado. Recarga los datos.' };
      } else {
        row = { ...row, ...dto, version: row.version + 1 };
        body = { success: true, data: row };
      }
    } else if (path === 'auth/me')
      body = { success: true, data: { id: randomUUID(), nombre: 'Prueba', username: 'admin' } };
    else if (path === 'finanzas') {
      queries.push(Object.fromEntries(url.searchParams));
      body = paged(config.empty ? [] : [row]);
    } else if (path === 'finanzas/balance')
      body = {
        success: true,
        data: {
          ingresos: '75.00',
          gastos: '25.10',
          resultado: '49.90',
          pendienteCobro: '15.00',
          numeroIngresos: 1,
          numeroGastos: 1,
          numeroPendientes: 1,
          numeroOperaciones: 2,
          ticketMedio: '75.00',
        },
      };
    else if (path === 'finanzas/' + row.id) body = { success: true, data: row };
    else if (path.endsWith('/historial')) body = paged([]);
    else if (path === 'categorias-gasto') body = paged([category]);
    else if (path === 'metodos-pago') body = paged([method, free]);
    else body = paged([]);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(origin + (config.detail ? '/finanzas/' + row.id : '/finanzas'));
  await page
    .getByRole('heading', {
      name: config.detail ? 'Detalle del movimiento' : 'Contabilidad',
      exact: true,
    })
    .waitFor();
  return { page, writes, queries, row, category, method };
}
async function fillExpense(page, category, method) {
  await page.getByRole('button', { name: 'Nuevo gasto', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Concepto', { exact: true }).fill('Hosting nuevo');
  await dialog.getByLabel('Importe (€)', { exact: true }).fill('12,30');
  await dialog.getByLabel('Categoría', { exact: true }).selectOption(category.id);
  await dialog.getByLabel('Método de pago', { exact: true }).selectOption(method.id);
  return dialog;
}
test(
  'muestra balance y vacío; los periodos son fechas de Madrid y semana comienza el lunes',
  { timeout: 30000 },
  async (t) => {
    const { page, queries } = await fixture(t, { empty: true });
    await page.getByText('No hay movimientos para estos filtros.').waitFor();
    assert.equal(queries.at(-1).desde, '2026-09-01');
    await page.getByLabel('Periodo', { exact: true }).selectOption('semana');
    assert.equal(await page.getByLabel('Desde', { exact: true }).inputValue(), '2026-09-21');
    assert.equal(await page.getByLabel('Hasta', { exact: true }).inputValue(), '2026-09-27');
    await page.getByLabel('Periodo', { exact: true }).selectOption('trimestre');
    assert.equal(await page.getByLabel('Desde', { exact: true }).inputValue(), '2026-07-01');
    assert.equal(await page.getByLabel('Hasta', { exact: true }).inputValue(), '2026-09-30');
    await page.getByLabel('Periodo', { exact: true }).selectOption('ano');
    assert.equal(await page.getByLabel('Hasta', { exact: true }).inputValue(), '2026-12-31');
    await page.getByRole('region', { name: 'Balance', exact: true }).waitFor();
  },
);
test(
  'crea gasto pagado, excluye Gratis y reintenta sin perder borrador ni clave',
  { timeout: 30000 },
  async (t) => {
    const { page, writes, category, method } = await fixture(t, { failFirst: true });
    const dialog = await fillExpense(page, category, method);
    assert.equal(await dialog.getByRole('option', { name: 'Gratis UI' }).count(), 0);
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'Fallo simulado' }).waitFor();
    assert.equal(
      await dialog.getByLabel('Concepto', { exact: true }).inputValue(),
      'Hosting nuevo',
    );
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(writes.length, 2);
    assert.equal(writes[0].dto.solicitudId, writes[1].dto.solicitudId);
    assert.equal(writes[0].dto.importe, '12.30');
    assert.equal(writes[0].dto.fecha, '2026-09-25');
    assert.equal(writes[0].dto.estado, undefined);
  },
);
test('impide fecha futura y cancelar descarta sin escribir', { timeout: 30000 }, async (t) => {
  const { page, writes, category, method } = await fixture(t);
  const dialog = await fillExpense(page, category, method);
  await dialog.getByLabel('Fecha de pago', { exact: true }).fill('2026-09-26');
  assert.equal(await dialog.locator('form').evaluate((el) => el.checkValidity()), false);
  await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
  assert.equal(writes.length, 0);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(writes.length, 0);
});
test(
  'editar exige motivo y conserva versión/borrador ante conflicto',
  { timeout: 30000 },
  async (t) => {
    const { page, writes } = await fixture(t, { detail: true, conflict: true });
    await page.getByRole('button', { name: 'Editar gasto', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Importe (€)', { exact: true }).fill('30');
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    assert.equal(writes.length, 0);
    await dialog.getByLabel('Motivo', { exact: true }).fill('Corregir importe');
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'ha cambiado' }).waitFor();
    assert.equal(writes[0].dto.version, 1);
    assert.equal(await dialog.getByLabel('Importe (€)', { exact: true }).inputValue(), '30');
  },
);
test('anulación requiere confirmación y motivo, sin borrado', { timeout: 30000 }, async (t) => {
  const { page, writes } = await fixture(t, { detail: true });
  await page.getByRole('button', { name: 'Anular gasto', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo', { exact: true }).fill('Duplicado comprobado');
  await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'POST');
  assert.ok(writes[0].path.endsWith('/anular'));
  assert.equal(writes[0].dto.version, 1);
});
test(
  'los ingresos son de solo lectura y enlazan al proceso de renovaciones',
  { timeout: 30000 },
  async (t) => {
    const renewal = randomUUID();
    const { page, writes } = await fixture(t, {
      detail: true,
      row: {
        tipo: { valor: 'INGRESO', etiqueta: 'Ingreso' },
        origen: 'GESTION_WEB',
        renovacionId: renewal,
      },
    });
    const link = page.getByRole('link', { name: 'Gestionar cobro o anulación en renovaciones' });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), '/renovaciones/' + renewal);
    assert.equal(await page.getByRole('button', { name: 'Editar gasto', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Anular gasto', exact: true }).count(), 0);
    assert.equal(writes.length, 0);
  },
);
