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
    importacionId: 'analysis-fixture',
    archivo: 'ensayo.xlsx',
    versionMapeo: '12.1.0',
    soloLectura: true,
    checksum: 'fixture-checksum',
    estado: 'EN_REVISION',
    filas: 1,
    errores: 0,
    advertencias: 2,
    clientesNuevos: 1,
    posiblesDuplicados: 0,
    filasPendientesReconciliacion: 1,
    movimientosCreados: 0,
    bloqueos: { CLIENTE: 0, SUSCRIPCION: 1, FINANZAS: 1, AVISO: 0 },
    hojas: [
      {
        hoja: 'OCT',
        filas: 1,
        cabecera: 3,
        errores: 0,
        advertencias: 2,
        columnasAusentes: ['SERVIDOR'],
        columnasAdicionales: ['J: resumen auxiliar'],
        clasificacion: {
          examinadas: 4,
          previas: 2,
          cabeceras: 1,
          operativas: 1,
          vacias: 0,
          auxiliares: 0,
          sinClasificar: 0,
        },
      },
    ],
  };
  let row = {
    id: 'row-fixture',
    version: 1,
    hojaOrigen: 'OCT',
    filaOrigen: 4,
    datosOriginales: { FECHA: '31/02/2026' },
    datosNormalizados: { nombre: 'Cliente ficticio', fecha: null, estadoPago: 'PENDIENTE' },
    correcciones: {},
    lectura: {
      campos: {
        FECHA: { celda: 'A4', valor: '31/02/2026', estado: 'INVALIDO' },
        NOMBRE: { celda: 'B4', valor: 'Cliente ficticio', estado: 'PRESENTE' },
        ESTADO: { celda: 'E4', valor: 'PE', estado: 'PRESENTE' },
      },
      incidencias: [
        {
          codigo: 'FECHA_INVALIDA',
          campo: 'FECHA',
          celda: 'A4',
          ambito: 'SUSCRIPCION',
          mensaje: 'FECHA ausente o no reconocida.',
        },
        {
          codigo: 'PAGO_PENDIENTE',
          campo: 'ESTADO',
          celda: 'E4',
          ambito: 'FINANZAS',
          mensaje: 'PE: pendiente de pago. No se confirmará ningún cobro.',
        },
      ],
    },
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
      writes.push({
        path,
        method: req.method(),
        body: req.method() === 'PATCH' ? req.postDataJSON() : null,
      });
      if (path.endsWith('/preview')) return send({ data: summary }, 201);
      if (path.endsWith('/lectura')) {
        if (conflict) {
          row = { ...row, version: 2 };
          return send(
            { message: 'La fila ha cambiado. Recarga antes de guardar; tu borrador se conserva.' },
            409,
          );
        }
        const dto = req.postDataJSON();
        row = {
          ...row,
          version: 2,
          correcciones: dto.cambios,
          datosNormalizados: { ...row.datosNormalizados, fecha: dto.cambios.FECHA },
          lectura: {
            ...row.lectura,
            incidencias: row.lectura.incidencias.filter((i) => i.campo !== 'FECHA'),
          },
          historialLectura: [
            {
              version: 2,
              autor: 'Administrador',
              fecha: '2026-10-16',
              motivo: dto.motivo,
              anteriores: { FECHA: '31/02/2026' },
              cambios: dto.cambios,
            },
          ],
        };
        return send({ data: summary });
      }
      return send({});
    }
    if (path === '/auth/me')
      return send({ data: { id: 'admin', nombre: 'Administrador', username: 'admin' } });
    if (path === '/configuracion')
      return send({ data: { version: 1, valores: { 'negocio.nombre': 'K13Group' } } });
    if (path === '/recordatorios/resumen') return send({ data: { atencion: 0 } });
    if (path === '/importaciones') return send({ data: [summary], pagination: { totalPages: 1 } });
    if (path === `/importaciones/${summary.importacionId}`) return send({ data: summary });
    if (path.endsWith('/filas'))
      return send({ data: [row], pagination: { total: 1, totalPages: 1, page: 1, limit: 25 } });
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
  return { page, writes, paths };
}
async function openSaved(page) {
  await page.getByText('Retomar un análisis guardado', { exact: true }).click();
  await page.getByRole('button', { name: 'Abrir análisis', exact: true }).click();
  await page.getByRole('heading', { name: 'Lectura de OCT · fila 4' }).waitFor();
}
test('previsualiza antes de crear clientes, conserva celdas y muestra PE pendiente', async (t) => {
  const { page, writes } = await fixture(t);
  await page
    .getByLabel('Excel de clientes')
    .setInputFiles({
      name: 'ensayo.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('fixture-intercepted'),
    });
  await page.getByRole('button', { name: 'Analizar archivo', exact: true }).click();
  await page.getByRole('heading', { name: 'Lectura de OCT · fila 4' }).waitFor();
  await page
    .getByText('PE: pendiente de pago. No se confirmará ningún cobro.', { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Confirmar staging y guardar clientes' }).count(),
    0,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Crear operaciones financieras' }).count(),
    0,
  );
  assert.deepEqual(
    writes.map((w) => w.path),
    ['/importaciones/clientes/preview'],
  );
  await page.getByText('Origen y clasificación por hoja', { exact: true }).click();
  await page.getByText('Columnas ausentes: SERVIDOR', { exact: true }).waitFor();
});
test('corrige, revalida y conserva el original y su historial', async (t) => {
  const { page, writes } = await fixture(t);
  await openSaved(page);
  await page.getByLabel('Valor corregido', { exact: true }).fill('2026-02-28');
  await page.getByLabel('Motivo de la corrección', { exact: true }).fill('Fecha comprobada');
  await page.getByRole('button', { name: 'Guardar corrección', exact: true }).click();
  await page
    .getByText('Corrección guardada y fila revalidada. El original se conserva.', { exact: true })
    .waitFor();
  assert.deepEqual(writes[0].body, {
    version: 1,
    cambios: { FECHA: '2026-02-28' },
    motivo: 'Fecha comprobada',
  });
  await page.getByText('Historial de correcciones', { exact: true }).click();
  await page.getByText('FECHA: 31/02/2026 → 2026-02-28', { exact: true }).waitFor();
});
test('conserva borrador en conflicto y permite cargar la revisión nueva', async (t) => {
  const { page, writes } = await fixture(t, { conflict: true });
  await openSaved(page);
  await page.getByLabel('Valor corregido', { exact: true }).fill('2026-02-28');
  await page.getByLabel('Motivo de la corrección', { exact: true }).fill('Borrador local');
  await page.getByRole('button', { name: 'Guardar corrección', exact: true }).click();
  await page.getByRole('button', { name: 'Descartar borrador y usar revisión actual' }).waitFor();
  assert.equal(
    await page.getByLabel('Valor corregido', { exact: true }).inputValue(),
    '2026-02-28',
  );
  assert.equal(writes.length, 1);
});
test('retoma al recargar, filtra por hoja e incidencia y cabe en móvil', async (t) => {
  const { page, paths } = await fixture(t, { mobile: true });
  await openSaved(page);
  await page.getByLabel('Hoja de origen').selectOption('OCT');
  await page.getByLabel('Tipo de incidencia').selectOption('FINANZAS');
  await page.waitForResponse((r) => r.url().includes('ambito=FINANZAS'));
  assert.ok(paths.some((p) => p.includes('hoja=OCT') && p.includes('ambito=FINANZAS')));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.reload();
  await openSaved(page);
});
