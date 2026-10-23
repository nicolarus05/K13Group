// UI real en Chrome, API ficticia: no modifica datos reales.
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
async function fixture(t, options = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.addCookies([{ name: 'access_token', value: 'renewal-ui-test', url: origin }]);
  await page.clock.install({ time: new Date('2026-09-25T12:00:00Z') });
  const product = { id: randomUUID(), nombre: 'Aplicación ficticia', activo: true };
  const tariff = {
    id: randomUUID(),
    nombre: 'Anual',
    precio: '75',
    activo: true,
    productoId: product.id,
  };
  const server = { id: randomUUID(), nombre: 'Servidor ficticio', activo: true };
  const client = { id: randomUUID(), nombre: 'Cliente ficticio', deletedAt: null };
  const method = { id: randomUUID(), nombre: 'Efectivo', activo: true, esGratuito: false };
  const free = { id: randomUUID(), nombre: 'Cortesía', activo: true, esGratuito: true };
  let sub = {
    id: randomUUID(),
    version: 1,
    noRenovar: false,
    clienteId: client.id,
    productoId: product.id,
    tarifaId: tariff.id,
    servidorId: server.id,
    referenciaId: null,
    fechaInicio: '2025-09-15T00:00:00.000Z',
    fechaFin: '2026-09-15T00:00:00.000Z',
    cliente: client,
    producto: product,
    tarifa: tariff,
    servidor: server,
    referencia: null,
    tipoDispositivo: 'TV',
    estado: { valor: 'VENCIDA', etiqueta: 'Vencida' },
  };
  let history = [];
  const renewal = {
    id: randomUUID(),
    version: 1,
    suscripcionId: sub.id,
    tipoOperacion: 'RENOVACION',
    fechaInicio: '2026-09-25T00:00:00.000Z',
    fechaFin: '2027-09-25T00:00:00.000Z',
    fechaOperacion: '2026-09-25T00:00:00.000Z',
    importe: '75',
    origen: 'GESTION_WEB',
    estado: { valor: 'COMPLETADA' },
    metodoPago: method,
    suscripcion: structuredClone(sub),
    movimientos: [
      {
        id: randomUUID(),
        importe: '75',
        estado: { valor: 'PENDIENTE' },
        fechaPrevistaCobro: '2026-09-30',
        fechaCobro: null,
        metodoPagoNombreSnapshot: 'Efectivo',
      },
    ],
  };
  if (options.pending) history = [renewal];
  const writes = [];
  let late;
  t.after(async () => {
    late?.release();
    await context.close();
    assert.deepEqual(errors, []);
  });
  const paged = (data) => ({
    data,
    pagination: { page: 1, limit: 25, total: data.length, totalPages: data.length ? 1 : 0 },
  });
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1/', '');
    let body;
    let status = 200;
    if (req.method() !== 'GET') {
      const dto = req.postDataJSON();
      writes.push({ path, dto });
      if (options.conflict) {
        status = 409;
        body = { message: 'El registro ha cambiado. Recarga los datos antes de confirmar.' };
      } else if (options.failOnce && writes.length === 1) {
        status = 503;
        body = { message: 'Respuesta temporalmente no disponible' };
      } else {
        status = 201;
        if (path.endsWith('/cobrar')) {
          renewal.movimientos[0].estado.valor = 'CONFIRMADO';
          renewal.movimientos[0].fechaCobro = dto.fechaCobro;
        } else if (path.endsWith('/anular')) {
          renewal.estado.valor = 'ANULADA';
          renewal.motivoAnulacion = dto.motivo;
        } else if (path.endsWith('/preferencia-renovacion'))
          sub = { ...sub, noRenovar: dto.noRenovar, version: sub.version + 1 };
        else {
          const row = {
            ...renewal,
            id: randomUUID(),
            tipoOperacion: path.endsWith('/primer-pago') ? 'ALTA' : 'RENOVACION',
            importe: dto.importe,
            movimientos:
              dto.metodoPagoId === free.id
                ? []
                : [{ ...renewal.movimientos[0], estado: { valor: dto.cobro } }],
          };
          history = [row];
          sub = { ...sub, version: sub.version + 1 };
        }
        body = { success: true, data: history[0] ?? sub };
      }
    } else if (path === 'auth/me')
      body = { data: { id: randomUUID(), nombre: 'Prueba', username: 'admin' } };
    else if (path === 'suscripciones/' + sub.id) {
      body = { data: structuredClone(sub) };
      if (late && !late.used) {
        late.used = true;
        late.started();
        await late.gate;
      }
    } else if (path === 'renovaciones/seguimiento') body = paged([sub]);
    else if (path === 'renovaciones') body = paged(history);
    else if (path.startsWith('renovaciones/')) body = { data: renewal };
    else if (path === 'metodos-pago') body = paged([method, free]);
    else body = paged([]);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(origin + '/suscripciones/' + sub.id);
  await page.getByRole('button', { name: 'Renovar', exact: true }).waitFor();
  return {
    page,
    writes,
    method,
    free,
    sub,
    async lateRefresh() {
      sub = { ...sub, version: 2 };
      let release, started;
      const gate = new Promise((r) => {
        release = r;
      });
      const seen = new Promise((r) => {
        started = r;
      });
      late = { release, started, gate, used: false };
      await page.clock.fastForward(61000);
      await seen;
      return async () => {
        const response = page.waitForResponse((r) => r.url().endsWith('/suscripciones/' + sub.id));
        release();
        await response;
        await page.clock.runFor(500);
      };
    },
  };
}
test(
  'renovación pendiente muestra el año desde la activación y envía la fecha prevista',
  { timeout: 30000 },
  async (t) => {
    const { page, writes, method } = await fixture(t);
    await page.getByRole('button', { name: 'Renovar', exact: true }).click();
    const dialog = page.getByRole('dialog');
    assert.match(await dialog.innerText(), /25\/09\/2027/);
    await dialog.getByLabel('Método de pago').selectOption(method.id);
    await dialog.getByLabel('Dejar cobro pendiente').check();
    await dialog.getByLabel('Fecha prevista de cobro').fill('2026-09-30');
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].dto.cobro, 'PENDIENTE');
    assert.equal(writes[0].dto.fechaPrevistaCobro, '2026-09-30');
    assert.equal(writes[0].dto.fechaCobro, undefined);
    assert.equal(writes[0].dto.fechaFin, undefined);
  },
);
test(
  'primer pago usa su endpoint y no anuncia una ampliación de periodo',
  { timeout: 30000 },
  async (t) => {
    const { page, writes, method } = await fixture(t);
    await page.getByRole('button', { name: 'Registrar primer pago', exact: true }).click();
    const dialog = page.getByRole('dialog');
    assert.match(await dialog.innerText(), /El primer pago no amplía/);
    assert.match(await dialog.innerText(), /15\/09\/2026/);
    await dialog.getByLabel('Método de pago').selectOption(method.id);
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.ok(writes[0].path.endsWith('/primer-pago'));
  },
);
test(
  'un error conserva el borrador y reintenta con la misma clave de solicitud',
  { timeout: 30000 },
  async (t) => {
    const { page, writes, method } = await fixture(t, { failOnce: true });
    await page.getByRole('button', { name: 'Renovar', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Método de pago').selectOption(method.id);
    await dialog.getByLabel('Observaciones').fill('Mantener mi borrador');
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByLabel('Observaciones').inputValue(), 'Mantener mi borrador');
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(writes.length, 2);
    assert.equal(writes[0].dto.solicitudId, writes[1].dto.solicitudId);
  },
);
test(
  'una respuesta tardía no reemplaza la versión ni el borrador de renovación',
  { timeout: 30000 },
  async (t) => {
    const { page, writes, method, lateRefresh } = await fixture(t, { conflict: true });
    const finish = await lateRefresh();
    await page.getByRole('button', { name: 'Renovar', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Método de pago').selectOption(method.id);
    await dialog.getByLabel('Observaciones').fill('Borrador original');
    await finish();
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(writes[0].dto.version, 1);
    assert.equal(await dialog.getByLabel('Observaciones').inputValue(), 'Borrador original');
  },
);
test('Gratis fuerza cero y Cancelar no escribe', { timeout: 30000 }, async (t) => {
  const { page, writes, free } = await fixture(t);
  await page.getByRole('button', { name: 'Renovar', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Método de pago').selectOption(free.id);
  assert.equal(await dialog.getByLabel('Importe (€)').inputValue(), '0');
  assert.equal(await dialog.getByLabel('Dejar cobro pendiente').count(), 0);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(writes.length, 0);
  await page.getByRole('button', { name: 'Renovar', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Método de pago').selectOption(free.id);
  await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(writes[0].dto.importe, '0');
  assert.equal(writes[0].dto.fechaCobro, undefined);
});
test(
  'registrar cobro liquida la operación seleccionada sin enviar una renovación',
  { timeout: 30000 },
  async (t) => {
    const { page, writes, method } = await fixture(t, { pending: true });
    await page.getByRole('button', { name: 'Registrar cobro', exact: true }).click();
    const dialog = page.getByRole('dialog');
    assert.match(await dialog.innerText(), /vencimiento no cambia/);
    await dialog.getByLabel('Método de pago').selectOption(method.id);
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(writes.length, 1);
    assert.ok(writes[0].path.endsWith('/cobrar'));
    assert.deepEqual(Object.keys(writes[0].dto).sort(), ['fechaCobro', 'metodoPagoId', 'version']);
  },
);
