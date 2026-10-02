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
async function fixture(t, opts = {}) {
  const context = await browser.newContext({
    viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 950 },
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  await context.addCookies([{ name: 'access_token', value: 'reminder-ui-only', url: origin }]);
  let fail = opts.fail;
  let total = opts.total ?? (opts.empty ? 0 : 1);
  let agendaTotal = opts.agendaTotal ?? 0;
  let releaseDetail,
    holdDetail = false;
  const row = {
    id: 'reminder-1',
    version: 1,
    origen: 'MANUAL',
    fecha: '2026-10-02',
    fechaOriginal: '2026-10-02',
    descripcion: 'Llamar para renovar',
    motivo: null,
    cliente: { id: 'client-1', nombre: 'Cliente avisos' },
    tipo: { valor: 'RENOVACION', etiqueta: 'Renovación' },
    estado: { valor: 'PENDIENTE', etiqueta: 'Pendiente' },
  };
  const paginated = (data, page = 1, limit = 25, total = data.length) => ({
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace('/api/v1', '');
    requests.push({
      path,
      method: request.method(),
      query: Object.fromEntries(url.searchParams),
      body: request.method() === 'POST' ? request.postDataJSON() : undefined,
    });
    const send = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path.startsWith('/auth'))
      return send({ success: true, data: { id: 'admin', username: 'admin', nombre: 'Admin' } });
    if (path === '/recordatorios/resumen')
      return send({ data: { atencion: 1, hoy: '2026-10-02' } });
    if (path === '/recordatorios/calendario') return send({ data: [] });
    if (path === '/recordatorios/agenda') {
      const page = Number(url.searchParams.get('page') || 1),
        limit = Number(url.searchParams.get('limit') || 10);
      const data = Array.from(
        { length: Math.max(0, Math.min(limit, agendaTotal - (page - 1) * limit)) },
        (_, i) => ({
          clave: 'event-' + ((page - 1) * limit + i),
          tipo: 'RENOVACION',
          fecha: '2026-10-02',
          fechaOriginal: '2026-10-02',
          clienteId: 'client-1',
          cliente: 'Cliente agenda',
          descripcion: 'Evento de seguimiento',
        }),
      );
      return send(paginated(data, page, limit, agendaTotal));
    }
    if (path === '/recordatorios/reminder-1/historial') return send(paginated([]));
    if (path === '/recordatorios/reminder-1') {
      const snapshot = structuredClone(row);
      if (holdDetail) {
        holdDetail = false;
        await new Promise((resolve) => {
          releaseDetail = resolve;
        });
      }
      return send({ data: snapshot });
    }
    if (request.method() === 'POST')
      return send({ message: 'El recordatorio ha cambiado. Recarga antes de continuar.' }, 409);
    if (path === '/recordatorios') {
      const page = Number(url.searchParams.get('page') || 1),
        limit = 25;
      const data = Array.from(
        { length: Math.max(0, Math.min(limit, total - (page - 1) * limit)) },
        (_, i) => ({ ...row, id: 'reminder-' + ((page - 1) * limit + i + 1) }),
      );
      return fail
        ? send({ message: 'Error temporal' }, 500)
        : send(paginated(data, page, limit, total));
    }
    if (path === '/clientes') return send(paginated([row.cliente]));
    return send({ success: true, data: [] });
  });
  await page.goto(
    origin +
      (opts.calendar
        ? '/calendario'
        : opts.detail
          ? '/recordatorios/reminder-1'
          : '/recordatorios'),
  );
  return {
    page,
    requests,
    updateReminder: (changes) => Object.assign(row, changes),
    setTotal: (value) => {
      total = value;
    },
    setAgendaTotal: (value) => {
      agendaTotal = value;
    },
    holdNextDetail: () => {
      holdDetail = true;
    },
    releaseDetail: () => releaseDetail?.(),
    recover: () => {
      fail = false;
    },
  };
}
async function refresh(page, path) {
  await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1' + path),
    page.evaluate(() => window.dispatchEvent(new Event('visibilitychange'))),
  ]);
}
for (const action of ['posponer', 'editar']) {
  test(
    'conserva borrador y versión original ante respuesta tardía: ' + action,
    { timeout: 60000 },
    async (t) => {
      const f = await fixture(t, { detail: true }),
        { page } = f;
      await page.getByText('Llamar para renovar', { exact: true }).waitFor();
      f.updateReminder({ version: 2, descripcion: 'Modificado por otro usuario' });
      f.holdNextDetail();
      await Promise.all([
        page.waitForRequest(
          (r) => new URL(r.url()).pathname === '/api/v1/recordatorios/reminder-1',
        ),
        page.evaluate(() => window.dispatchEvent(new Event('visibilitychange'))),
      ]);
      await page.getByRole('combobox', { name: 'Acción', exact: true }).selectOption(action);
      const field =
        action === 'posponer'
          ? page.getByLabel('Nueva fecha', { exact: true })
          : page.getByRole('textbox', { name: 'Descripción', exact: true });
      const value = action === 'posponer' ? '2027-10-03' : 'Mi descripción sin guardar';
      await field.fill(value);
      await page
        .getByRole('textbox', { name: 'Motivo', exact: true })
        .fill('Mi motivo sin guardar');
      f.releaseDetail();
      await page.getByText('Modificado por otro usuario', { exact: true }).waitFor();
      assert.equal(await field.inputValue(), value);
      assert.equal(
        await page.getByRole('textbox', { name: 'Motivo', exact: true }).inputValue(),
        'Mi motivo sin guardar',
      );
      await page.getByRole('button', { name: 'Guardar cambio', exact: true }).click();
      await page.locator('.rem-error').filter({ hasText: 'Recarga antes' }).waitFor();
      assert.equal(f.requests.find((r) => r.method === 'POST').body.version, 1);
      await page.getByRole('button', { name: 'Recargar datos', exact: true }).click();
      assert.equal(await field.inputValue(), value);
      await page
        .getByRole('button', { name: 'Descartar borrador y cargar versión actual', exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector('textarea[name="motivo"]')?.value === '',
      );
      await page.getByRole('combobox', { name: 'Acción', exact: true }).selectOption('completar');
      await page
        .getByRole('textbox', { name: 'Motivo', exact: true })
        .fill('Revisada versión actual');
      await page.getByRole('button', { name: 'Guardar cambio', exact: true }).click();
      await page.locator('.rem-error').filter({ hasText: 'Recarga antes' }).waitFor();
      assert.equal(f.requests.filter((r) => r.method === 'POST').at(-1).body.version, 2);
    },
  );
}
test(
  'cerrar el aviso desde otra sesión conserva el borrador pero impide guardarlo',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { detail: true }),
      { page } = f;
    await page
      .getByRole('textbox', { name: 'Motivo', exact: true })
      .fill('Texto que no debe perderse');
    f.updateReminder({ version: 2, estado: { valor: 'COMPLETADO', etiqueta: 'Completado' } });
    await refresh(page, '/recordatorios/reminder-1');
    await page.getByText('Estado: Completado', { exact: false }).waitFor();
    assert.equal(
      await page.getByRole('textbox', { name: 'Motivo', exact: true }).inputValue(),
      'Texto que no debe perderse',
    );
    assert.equal(
      await page.getByRole('button', { name: 'Guardar cambio', exact: true }).isDisabled(),
      true,
    );
    assert.ok(f.requests.every((r) => r.method === 'GET'));
  },
);
for (const calendar of [false, true]) {
  test(
    'reajusta página al reducir resultados y al quedar vacío: ' + (calendar ? 'agenda' : 'lista'),
    { timeout: 60000 },
    async (t) => {
      const f = await fixture(t, { calendar, total: 26, agendaTotal: 11 }),
        { page } = f;
      const endpoint = calendar ? '/recordatorios/agenda' : '/recordatorios';
      await page.getByText('Página 1 de 2', { exact: true }).waitFor();
      if (!calendar) {
        await page.getByRole('combobox', { name: 'Vista', exact: true }).selectOption('todos');
        await page.getByLabel('Buscar cliente o descripción', { exact: true }).fill('Cliente');
      }
      await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
      await page.getByText('Página 2 de 2', { exact: true }).waitFor();
      calendar ? f.setAgendaTotal(10) : f.setTotal(25);
      await refresh(page, endpoint);
      await page.getByText('Página 1 de 1', { exact: true }).waitFor();
      await page.waitForFunction(
        () =>
          document.querySelectorAll('.rem-agenda').length === 10 ||
          document.querySelectorAll('tbody tr').length === 25,
      );
      if (!calendar) {
        assert.equal(
          await page.getByRole('combobox', { name: 'Vista', exact: true }).inputValue(),
          'todos',
        );
        assert.equal(
          await page.getByLabel('Buscar cliente o descripción', { exact: true }).inputValue(),
          'Cliente',
        );
      }
      calendar ? f.setAgendaTotal(11) : f.setTotal(26);
      await refresh(page, endpoint);
      await page.getByText('Página 1 de 2', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
      await page.getByText('Página 2 de 2', { exact: true }).waitFor();
      calendar ? f.setAgendaTotal(0) : f.setTotal(0);
      await refresh(page, endpoint);
      await page.getByText('Página 1 de 1', { exact: true }).waitFor();
      assert.equal(
        await page.getByRole('button', { name: 'Anterior', exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        await page.getByRole('button', { name: 'Siguiente', exact: true }).isDisabled(),
        true,
      );
      assert.ok(f.requests.every((r) => r.method === 'GET'));
    },
  );
}
test('lista, campana y filtros no escriben en negocio', { timeout: 60000 }, async (t) => {
  const { page, requests } = await fixture(t);
  await page.getByRole('cell', { name: 'Llamar para renovar', exact: true }).waitFor();
  await page.getByLabel('1 avisos requieren atención').waitFor();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('vista=todos') && r.url().includes('estado=COMPLETADO'),
    ),
    page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('COMPLETADO'),
  ]);
  assert.equal(
    await page.getByRole('combobox', { name: 'Vista', exact: true }).inputValue(),
    'todos',
  );
  assert.ok(requests.every((r) => r.method === 'GET'));
});
test('error visible con reintento, no tabla ficticia', { timeout: 60000 }, async (t) => {
  const { page, recover } = await fixture(t, { fail: true });
  await page.locator('.rem-error').waitFor();
  assert.equal(await page.getByRole('table').count(), 0);
  recover();
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await page.getByRole('cell', { name: 'Llamar para renovar', exact: true }).waitFor();
});
test(
  'alta requiere seleccionar cliente y explica ausencia de envíos',
  { timeout: 60000 },
  async (t) => {
    const { page } = await fixture(t, { empty: true });
    await page.getByRole('button', { name: 'Nuevo recordatorio', exact: true }).click();
    assert.equal(
      await page.getByRole('button', { name: 'Crear recordatorio', exact: true }).isDisabled(),
      true,
    );
    await page.getByRole('button', { name: 'Cliente avisos', exact: true }).click();
    assert.equal(
      await page.getByRole('button', { name: 'Crear recordatorio', exact: true }).isEnabled(),
      true,
    );
    await page
      .getByText('Siempre vinculado a un cliente. No envía mensajes ni registra pagos.')
      .waitFor();
  },
);
test('conflicto al posponer mantiene error y ofrece recarga', { timeout: 60000 }, async (t) => {
  const { page } = await fixture(t, { detail: true });
  await page.getByLabel('Nueva fecha', { exact: true }).fill('2027-10-03');
  await page.getByLabel('Motivo', { exact: true }).fill('Llamar más tarde');
  await page.getByRole('button', { name: 'Guardar cambio', exact: true }).click();
  await page.locator('.rem-error').waitFor();
  await page.getByRole('button', { name: 'Recargar datos', exact: true }).waitFor();
});
test(
  'calendario móvil, navegación mensual y agenda sin desbordamiento',
  { timeout: 60000 },
  async (t) => {
    const { page, requests } = await fixture(t, { calendar: true, mobile: true });
    await page.getByText('No hay eventos para este día.').waitFor();
    await page.getByRole('button', { name: 'Mes siguiente', exact: true }).click();
    await page.getByLabel('Ir al día', { exact: true }).fill('2026-11-15');
    await page.getByRole('heading', { name: 'Agenda · 15/11/2026' }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(requests.every((r) => r.method === 'GET'));
  },
);
