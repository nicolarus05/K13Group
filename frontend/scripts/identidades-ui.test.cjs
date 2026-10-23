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
async function fixture(t, { conflict = false, mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 1000 },
  });
  await context.addCookies([{ name: 'access_token', value: 'fixture', url: origin }]);
  const page = await context.newPage(),
    errors = [],
    writes = [],
    paths = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  const summary = {
    importacionId: 'review-fixture',
    archivo: 'identidades.xlsx',
    versionMapeo: '12.1.0',
    soloLectura: true,
    estado: 'EN_REVISION',
    filas: 2,
    errores: 0,
    advertencias: 0,
    clientesNuevos: 2,
    posiblesDuplicados: 2,
    filasPendientesReconciliacion: 2,
    movimientosCreados: 0,
    hojas: [],
    bloqueos: {},
  };
  const datos = { nombre: 'Marta Prueba', telefono: null, email: null, observaciones: null };
  const row = (id, fila) => ({
    id,
    hoja: 'OCT',
    fila,
    datos,
    originales: { NOMBRE: { valor: 'Marta Prueba', celda: 'B' + fila } },
  });
  const group = (id, r) => ({
    id,
    estado: 'PENDIENTE',
    decision: 'PENDIENTE',
    datos,
    filas: [r],
    problemas: [],
    candidatos: [],
    totalCandidatos: 0,
    clientes: [],
    totalClientes: 0,
    clienteDestino: null,
    historial: [],
  });
  let groups = [group('g1', row('r1', 2)), group('g2', row('r2', 3))],
    version = 0;
  const client = {
    id: 'client-fixture',
    nombre: 'Cliente existente',
    telefono: '612345678',
    email: null,
    observaciones: null,
    huella: 'snapshot-fixture',
    eliminado: false,
  };
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace('/api/v1', '');
    paths.push(path + url.search);
    const send = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.method() === 'OPTIONS') return send({});
    if (req.method() !== 'GET') {
      const body = req.method() === 'PATCH' ? req.postDataJSON() : null;
      writes.push({ path, body });
      if (path.endsWith('/preparar')) {
        version = 1;
        return send({ preparado: true }, 201);
      }
      if (path.endsWith('/decidir')) {
        if (conflict) {
          version++;
          return send(
            {
              message: 'La revisión ha cambiado. Recarga las identidades; tu borrador se conserva.',
            },
            409,
          );
        }
        const picked = groups.flatMap((g) => g.filas).filter((r) => body.filas.includes(r.id));
        groups = groups.filter((g) => !g.filas.some((r) => body.filas.includes(r.id)));
        groups.push({
          ...group('saved', picked[0]),
          filas: picked,
          datos: body.datos || datos,
          estado: body.accion === 'VINCULAR' ? 'VINCULADO' : body.accion,
          clienteDestino: body.accion === 'VINCULAR' ? client : null,
          historial: [
            {
              id: 'event',
              accion: body.accion,
              autor: 'Administrador',
              fecha: '2026-10-17',
              motivo: body.motivo,
              filas: body.filas,
              datos: body.datos || datos,
            },
          ],
        });
        version++;
        return send({ id: 'saved', version });
      }
      return send({});
    }
    if (path === '/auth/me')
      return send({ data: { id: 'admin', nombre: 'Administrador', username: 'admin' } });
    if (path === '/configuracion')
      return send({ data: { version: 1, valores: { 'negocio.nombre': 'K13Group' } } });
    if (path === '/recordatorios/resumen') return send({ data: { atencion: 0 } });
    if (path === '/importaciones') return send({ data: [summary], pagination: { totalPages: 1 } });
    if (path === '/importaciones/review-fixture') return send({ data: summary });
    if (path.endsWith('/identidades/clientes'))
      return send({ data: [client], pagination: { totalPages: 1 } });
    if (path.endsWith('/identidades')) {
      const counts = {
        PENDIENTE: 0,
        CONFLICTO: 0,
        REVISAR: 0,
        NUEVO: 0,
        VINCULADO: 0,
        EXCLUIDO: 0,
      };
      groups.forEach((g) => counts[g.estado]++);
      const filtered = groups.filter(
        (g) => !url.searchParams.get('estado') || g.estado === url.searchParams.get('estado'),
      );
      return send({
        preparado: version > 0,
        version,
        resumen: counts,
        filas: 2,
        data: filtered,
        pagination: { total: filtered.length, page: 1, totalPages: 1 },
      });
    }
    if (path.endsWith('/catalogos'))
      return send({
        data: {
          productos: [],
          tarifas: [],
          servidores: [],
          referencias: [],
          metodosPago: [],
          equivalencias: [],
        },
      });
    return send({ data: [], pagination: { total: 0, totalPages: 0 } });
  });
  await page.goto(origin + '/importaciones');
  const open = async () => {
    await page.getByText('Retomar un análisis guardado', { exact: true }).click();
    await page.getByRole('button', { name: 'Abrir análisis', exact: true }).click();
    await page.getByText('12.2 · Revisar identidades y duplicados', { exact: true }).click();
  };
  await open();
  await page.getByRole('button', { name: 'Preparar revisión de identidades', exact: true }).click();
  const review = page.getByRole('region', { name: 'Revisión de identidades' });
  await review
    .getByRole('button', { name: 'Seleccionar 1 filas de esta identidad', exact: true })
    .first()
    .waitFor();
  return { page, review, writes, paths, open };
}
test('agrupa propuestas, conserva opcionales nulos y retoma el historial', async (t) => {
  const { page, review, writes, open } = await fixture(t);
  const buttons = review.getByRole('button', {
    name: 'Seleccionar 1 filas de esta identidad',
    exact: true,
  });
  await buttons.nth(0).click();
  await buttons.nth(1).click();
  await page
    .getByLabel('Motivo de la decisión de identidad', { exact: true })
    .fill('Identidad verificada');
  await page.getByRole('button', { name: 'Guardar decisión de identidad', exact: true }).click();
  await page
    .getByText('Decisión guardada. Las filas originales y sus operaciones se conservan.', {
      exact: true,
    })
    .waitFor();
  assert.deepEqual(writes[1].body.filas, ['r1', 'r2']);
  assert.equal(writes[1].body.datos.telefono, null);
  assert.equal(writes[1].body.accion, 'NUEVO');
  assert.equal(writes.length, 2);
  await page.reload();
  await open();
  await page.getByLabel('Situación de identidad').selectOption('NUEVO');
  await review.getByText('Historial de identidad (1)', { exact: true }).click();
  await review.getByText('Identidad verificada · 2 filas', { exact: true }).waitFor();
});
test('conserva el borrador tras un conflicto y exige revisar la versión actual', async (t) => {
  const { page, review } = await fixture(t, { conflict: true });
  await review
    .getByRole('button', { name: 'Seleccionar 1 filas de esta identidad', exact: true })
    .first()
    .click();
  await page.getByLabel('Identidad: nombre', { exact: true }).fill('Borrador conservado');
  await page
    .getByLabel('Motivo de la decisión de identidad', { exact: true })
    .fill('Revisión concurrente');
  await page.getByRole('button', { name: 'Guardar decisión de identidad', exact: true }).click();
  await page
    .getByText(
      'La revisión ha cambiado. Tu borrador se conserva; descarta la selección y revisa los datos actuales antes de guardar.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.getByLabel('Identidad: nombre', { exact: true }).inputValue(),
    'Borrador conservado',
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Guardar decisión de identidad', exact: true })
      .isDisabled(),
    true,
  );
});
test('elige un cliente existente con su versión sin enviar sobrescrituras', async (t) => {
  const { page, review, writes } = await fixture(t);
  await review
    .getByRole('button', { name: 'Seleccionar 1 filas de esta identidad', exact: true })
    .first()
    .click();
  await page.getByLabel('Decisión de identidad', { exact: true }).selectOption('VINCULAR');
  await page.getByRole('button', { name: 'Elegir cliente Cliente existente', exact: true }).click();
  await page
    .getByLabel('Motivo de la decisión de identidad', { exact: true })
    .fill('Destino comprobado');
  await page.getByRole('button', { name: 'Guardar decisión de identidad', exact: true }).click();
  await page
    .getByText('Decisión guardada. Las filas originales y sus operaciones se conservan.', {
      exact: true,
    })
    .waitFor();
  assert.equal(writes[1].body.huellaCliente, 'snapshot-fixture');
  assert.equal(writes[1].body.clienteDestinoId, 'client-fixture');
  assert.equal(writes[1].body.datos, undefined);
});
test('compara originales y permite seleccionar una fila en móvil', async (t) => {
  const { page, review } = await fixture(t, { mobile: true });
  const article = review.locator('article').first();
  await article.getByText('Comparar filas de origen (1)', { exact: true }).click();
  await article.getByRole('checkbox').check();
  await article.getByText('Valores originales de OCT · fila 2', { exact: true }).click();
  await article.getByText('NOMBRE (B2): Marta Prueba', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: 'Descartar selección y borrador', exact: true }).click();
  assert.equal(await article.getByRole('checkbox').isChecked(), false);
});
test('vaciar la selección descarta el cliente y el motivo de la decisión anterior', async (t) => {
  const { page, review } = await fixture(t);
  const first = review.locator('article').first();
  await first.getByText('Comparar filas de origen (1)', { exact: true }).click();
  await first.getByRole('checkbox').check();
  await page.getByLabel('Decisión de identidad', { exact: true }).selectOption('VINCULAR');
  await page.getByRole('button', { name: 'Elegir cliente Cliente existente', exact: true }).click();
  await page
    .getByLabel('Motivo de la decisión de identidad', { exact: true })
    .fill('Solo para la primera fila');
  await first.getByRole('checkbox').uncheck();
  await review
    .getByRole('button', { name: 'Seleccionar 1 filas de esta identidad', exact: true })
    .nth(1)
    .click();
  assert.equal(
    await page.getByLabel('Motivo de la decisión de identidad', { exact: true }).inputValue(),
    '',
  );
  assert.equal(await page.getByText(/^Cliente seleccionado:/).count(), 0);
  assert.equal(
    await page
      .getByRole('button', { name: 'Guardar decisión de identidad', exact: true })
      .isDisabled(),
    true,
  );
});
