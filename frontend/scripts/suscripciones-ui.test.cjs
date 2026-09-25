// Ejecutar con el frontend arrancado. Todas las respuestas API son ficticias.
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

async function fixture(t, overrides = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addCookies([{ name: 'access_token', value: 'ui-regression-only', url: origin }]);
  await page.clock.install({ time: new Date('2026-09-24T12:00:00Z') });
  const product = { id: randomUUID(), nombre: 'Producto ficticio', activo: true };
  const rate = {
    id: randomUUID(),
    nombre: 'Anual',
    precio: '75',
    activo: true,
    productoId: product.id,
  };
  const server = { id: randomUUID(), nombre: 'Servidor ficticio', activo: true };
  const client = { id: randomUUID(), nombre: 'Cliente ficticio', deletedAt: null };
  const id = randomUUID();
  let record = {
    id,
    version: 1,
    clienteId: client.id,
    productoId: product.id,
    tarifaId: rate.id,
    servidorId: server.id,
    referenciaId: null,
    fechaInicio: '2025-09-30T00:00:00.000Z',
    fechaFin: '2026-09-30T00:00:00.000Z',
    tipoDispositivo: 'TV original',
    cliente: client,
    producto: product,
    tarifa: rate,
    servidor: server,
    referencia: null,
    estado: { valor: 'PROXIMA_A_VENCER', etiqueta: 'Próxima a vencer' },
    ...overrides,
  };
  const catalogs = { productos: [product], tarifas: [rate], servidores: [server], referencias: [] };
  const writes = [];
  let pending;
  t.after(async () => {
    pending?.release();
    await context.close();
    assert.deepEqual(errors, []);
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1/', '');
    let body,
      status = 200;
    if (route.request().method() !== 'GET') {
      writes.push(route.request().postDataJSON());
      // Una versión obsoleta debe llegar al servidor, que informa el conflicto.
      status = 409;
      body = { message: 'La suscripción ha cambiado. Recarga los datos antes de guardar.' };
    } else if (path === 'auth/me') {
      body = { success: true, data: { id: randomUUID(), nombre: 'Prueba', username: 'admin' } };
    } else if (path === 'suscripciones/' + id) {
      body = { success: true, data: structuredClone(record) };
      if (pending && !pending.used) {
        pending.used = true;
        pending.started();
        await pending.gate;
      }
    } else if (path.endsWith('/historial')) {
      body = { data: [], pagination: { total: 0, page: 1, limit: 10, totalPages: 0 } };
    } else {
      body = {
        data: catalogs[path] || [],
        pagination: { total: (catalogs[path] || []).length, page: 1, limit: 100, totalPages: 1 },
      };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(origin + '/suscripciones/' + id);
  await page.getByRole('button', { name: 'Editar', exact: true }).waitFor();
  return {
    page,
    writes,
    async startLateRefresh() {
      record = { ...record, version: 2, tipoDispositivo: 'Cambio remoto' };
      let release, started;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const seen = new Promise((resolve) => {
        started = resolve;
      });
      pending = { release, started, gate, used: false };
      await page.clock.fastForward(61000);
      await seen;
      return async () => {
        const response = page.waitForResponse((response) =>
          response.url().endsWith('/suscripciones/' + id),
        );
        release();
        await response;
        await page.clock.runFor(500);
      };
    },
  };
}

test(
  'permite editar el dispositivo tras una renovación anticipada sin cambiar fechas',
  { timeout: 30000 },
  async (t) => {
    const { page, writes } = await fixture(t, {
      fechaInicio: '2026-10-15T00:00:00.000Z',
      fechaFin: '2027-10-15T00:00:00.000Z',
    });
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    const start = page.getByLabel('Fecha de inicio', { exact: true });
    assert.equal(await start.inputValue(), '2026-10-15');
    assert.equal(await start.evaluate((el) => el.readOnly && el.checkValidity()), true);
    await page.getByLabel('Tipo de dispositivo (opcional)').fill('TV renovada');
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    // El mock devuelve 409: comprobar que la validación nativa permite llegar a la API.
    await page.getByRole('alert').filter({ hasText: 'La suscripción ha cambiado' }).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].fechaInicio, '2026-10-15');
    assert.equal(writes[0].tipoDispositivo, 'TV renovada');
  },
);

test(
  'el código canónico de próximo vencimiento muestra etiqueta y advertencia',
  { timeout: 30000 },
  async (t) => {
    const { page } = await fixture(t);
    const badge = page
      .locator('header')
      .filter({ has: page.getByRole('heading', { level: 1 }) })
      .getByText('Próxima a vencer', { exact: true });
    await badge.waitFor();
    assert.equal(await badge.evaluate((el) => el.className.includes('text-warning')), true);
  },
);

test(
  'Cancelar cierra la edición, descarta cambios y no envía escrituras',
  { timeout: 30000 },
  async (t) => {
    const { page, writes } = await fixture(t);
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.getByLabel('Tipo de dispositivo (opcional)').fill('Cambio descartable');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: 'Editar', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Guardar cambios', exact: true }).count(),
      0,
    );
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    assert.equal(
      await page.getByLabel('Tipo de dispositivo (opcional)').inputValue(),
      'TV original',
    );
    assert.equal(writes.length, 0);
  },
);

test(
  'una respuesta tardía no borra el borrador ni reemplaza su versión original',
  { timeout: 30000 },
  async (t) => {
    const { page, writes, startLateRefresh } = await fixture(t);
    const finish = await startLateRefresh();
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.getByLabel('Tipo de dispositivo (opcional)').fill('Mi edición pendiente');
    await finish();
    assert.equal(
      await page.getByLabel('Tipo de dispositivo (opcional)').inputValue(),
      'Mi edición pendiente',
    );
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'La suscripción ha cambiado' }).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].version, 1);
    assert.equal(writes[0].tipoDispositivo, 'Mi edición pendiente');
    assert.equal(
      await page.getByLabel('Tipo de dispositivo (opcional)').inputValue(),
      'Mi edición pendiente',
    );
  },
);

test(
  'una confirmación pendiente también conserva la versión elegida por el usuario',
  { timeout: 30000 },
  async (t) => {
    const { page, writes, startLateRefresh } = await fixture(t);
    const finish = await startLateRefresh();
    await page.getByRole('button', { name: 'Suspender', exact: true }).click();
    await page.getByLabel('Motivo', { exact: true }).fill('Motivo pendiente');
    await finish();
    await page.getByRole('button', { name: 'Confirmar suspender', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'La suscripción ha cambiado' }).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].version, 1);
    assert.equal(writes[0].motivo, 'Motivo pendiente');
  },
);
