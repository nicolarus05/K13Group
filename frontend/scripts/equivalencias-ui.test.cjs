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
    writes = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  const summary = {
    importacionId: 'review-fixture',
    archivo: 'equivalencias.xlsx',
    versionMapeo: '12.1.0',
    soloLectura: true,
    estado: 'EN_REVISION',
    filas: 1,
    errores: 0,
    advertencias: 0,
    clientesNuevos: 1,
    posiblesDuplicados: 0,
    filasPendientesReconciliacion: 1,
    movimientosCreados: 0,
    hojas: [],
    bloqueos: {},
  };
  const target = { id: 'product', nombre: 'MAXPLAYER', activo: true };
  const cell = {
    clave: 'a'.repeat(64),
    etiqueta: 'MAXPLAYER',
    estado: 'PENDIENTE',
    original: 'APP protegida',
    efectivo: 'MAXPLAYER',
    corregido: false,
    celda: 'C4',
    ausente: false,
    ignorado: false,
    destino: null,
    sugerencias: [target],
    alcance: null,
    motivo: null,
  };
  const row = {
    id: 'row',
    hoja: 'OCT',
    fila: 4,
    excluida: false,
    identidad: 'PENDIENTE',
    suscripcion: 'PENDIENTE',
    finanzas: 'PENDIENTE_PAGO',
    fechaFin: '2026-10-17',
    fechaInicioPropuesta: '2025-10-17',
    importeAnual: 75,
    totalAcumulado: 500,
    referenciaPropia: null,
    advertencias: [],
    campos: Object.fromEntries(
      ['PRODUCTO', 'TARIFA', 'SERVIDOR', 'REFERENCIA', 'PAGO'].map((t) => [t, { ...cell }]),
    ),
  };
  let version = 0,
    history = [];
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace('/api/v1', '');
    const send = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.method() === 'OPTIONS') return send({});
    if (req.method() !== 'GET') {
      const body = req.postDataJSON();
      writes.push({ path, body, method: req.method() });
      if (path.endsWith('/previsualizar'))
        return send(
          {
            total: 1,
            cambiosEfectivos: 1,
            excepcionesConservadas: 0,
            destino: target,
            filas: [
              {
                id: 'row',
                hoja: 'OCT',
                fila: 4,
                antes: { estado: 'PENDIENTE', destino: null },
                despues: { estado: 'RESUELTA', destino: target },
              },
            ],
            aviso: 'No se crean operaciones.',
          },
          201,
        );
      if (req.method() === 'PATCH') {
        if (conflict) {
          version++;
          return send(
            { message: 'La revisión ha cambiado. Actualiza y vuelve a previsualizar.' },
            409,
          );
        }
        version++;
        row.campos[body.tipo] = {
          ...row.campos[body.tipo],
          estado: 'RESUELTA',
          destino: target,
          alcance: body.alcance,
        };
        history.push({
          id: 'decision',
          version,
          alcance: body.alcance,
          accion: body.accion,
          autor: 'Administrador',
          motivo: body.motivo,
          fecha: '2026-10-17',
          destino: { origen: 'MAXPLAYER', destino: 'MAXPLAYER' },
        });
        return send({ id: 'decision', version });
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
    if (path.endsWith('/equivalencias-revision'))
      return send({
        version,
        huellaRevision: String(version).repeat(64),
        hojas: ['OCT'],
        catalogos: { PRODUCTO: [target], TARIFA: [], SERVIDOR: [], REFERENCIA: [], PAGO: [] },
        inventario: [
          {
            clave: cell.clave,
            etiqueta: 'MAXPLAYER',
            total: 1,
            elegibles: 1,
            estados: { PENDIENTE: 1 },
          },
        ],
        resumen: {
          filas: 1,
          excluidas: 0,
          identidadesResueltas: 0,
          suscripcionesResueltas: 0,
          historicas: 0,
          pendientesPago: 1,
        },
        data: [row],
        pagination: { page: 1, total: 1, totalPages: 1 },
        historial: history,
      });
    return send({ data: [], pagination: { total: 0, totalPages: 0 } });
  });
  const open = async () => {
    await page.getByText('Retomar un análisis guardado', { exact: true }).click();
    await page.getByRole('button', { name: 'Abrir análisis', exact: true }).click();
    await page
      .getByText('12.3 · Revisar equivalencias y operaciones propuestas', { exact: true })
      .click();
  };
  const choose = async () => {
    await page.getByRole('button', { name: 'Revisar OCT 4', exact: true }).click();
    await page.getByLabel('Destino de equivalencia', { exact: true }).selectOption('product');
    await page
      .getByLabel('Motivo de equivalencia', { exact: true })
      .fill('Revisada desde navegador');
  };
  await page.goto(origin + '/importaciones');
  await open();
  return { page, writes, open, choose };
}
test('previsualiza antes de guardar y recupera estado e historial al reabrir', async (t) => {
  const { page, writes, open, choose } = await fixture(t);
  await choose();
  assert.equal(
    await page.getByRole('button', { name: 'Guardar equivalencia', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: 'Previsualizar equivalencia', exact: true }).click();
  await page.getByText(/1 filas en el alcance/).waitFor();
  await page.getByText('Ver filas afectadas', { exact: true }).click();
  await page
    .getByText('OCT 4: Sin destino (PENDIENTE) → MAXPLAYER (RESUELTA)', { exact: true })
    .waitFor();
  assert.equal(writes.length, 1);
  await page.getByRole('button', { name: 'Guardar equivalencia', exact: true }).click();
  await page
    .getByText('Equivalencia guardada. No se han creado operaciones.', { exact: true })
    .waitFor();
  assert.deepEqual(writes[0].body, writes[1].body);
  await page.reload();
  await open();
  await page.getByRole('cell', { name: 'RESUELTA', exact: true }).waitFor();
  await page
    .getByText('Historial de equivalencias de las filas visibles (1)', { exact: true })
    .click();
  await page.getByText(/Versión 1 .*Revisada desde navegador/).waitFor();
});
test('cambiar alcance o motivo invalida la previsualización', async (t) => {
  const { page, writes, choose } = await fixture(t);
  await choose();
  await page.getByRole('button', { name: 'Previsualizar equivalencia', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar equivalencia', exact: true }).waitFor();
  await page.getByLabel('Alcance de equivalencia', { exact: true }).selectOption('FILA');
  assert.equal(
    await page.getByRole('button', { name: 'Guardar equivalencia', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: 'Previsualizar equivalencia', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar equivalencia', exact: true }).waitFor();
  assert.equal(writes[1].body.filaId, 'row');
  await page.getByLabel('Motivo de equivalencia', { exact: true }).fill('Nuevo motivo revisado');
  assert.equal(
    await page.getByRole('button', { name: 'Guardar equivalencia', exact: true }).count(),
    0,
  );
  assert.equal(writes.filter((w) => w.method === 'PATCH').length, 0);
});
test('un conflicto conserva el borrador y exige revisar de nuevo', async (t) => {
  const { page, choose } = await fixture(t, { conflict: true });
  await choose();
  await page.getByRole('button', { name: 'Previsualizar equivalencia', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar equivalencia', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'La revisión ha cambiado' }).waitFor();
  await page
    .getByText(
      'Los datos han cambiado. Selecciona de nuevo la fila para revisar su estado actual.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.getByLabel('Motivo de equivalencia', { exact: true }).inputValue(),
    'Revisada desde navegador',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Guardar equivalencia', exact: true }).isDisabled(),
    true,
  );
});
test('los filtros limpian la selección y no guardan cambios, también en móvil', async (t) => {
  const { page, writes, choose } = await fixture(t, { mobile: true });
  await choose();
  await page.getByLabel('Estado de equivalencia', { exact: true }).selectOption('REVISAR');
  assert.equal(await page.getByLabel('Motivo de equivalencia', { exact: true }).count(), 0);
  assert.equal(writes.length, 0);
  await page.getByRole('button', { name: 'Revisar OCT 4', exact: true }).waitFor();
});
