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
async function fixture(
  t,
  { blocked = false, conflict = false, mobile = false, older = false } = {},
) {
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
    archivo: 'ensayo.xlsx',
    versionMapeo: '12.1.0',
    soloLectura: true,
    estado: 'EN_REVISION',
    filas: 2,
    errores: 0,
    advertencias: 0,
    clientesNuevos: 1,
    posiblesDuplicados: 0,
    filasPendientesReconciliacion: 2,
    movimientosCreados: 0,
    hojas: [],
    bloqueos: {},
  };
  let version = 0,
    batches = [];
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace('/api/v1', '');
    const send = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.method() === 'OPTIONS') return send({});
    if (req.method() !== 'GET') {
      const body = req.postDataJSON();
      writes.push({ path, body });
      if (path.endsWith('/lotes')) {
        const finance = body.filas.some((r) => r.finanzas !== 'NINGUNA'),
          service = body.filas.some((r) => r.servicio !== 'NINGUNO');
        const b = {
          id: 'batch-fixture',
          estado: 'PREPARADO',
          motivo: body.motivo,
          fecha: '2026-10-19',
          propuesta: {
            resumen: {
              filas: body.filas.length,
              clientesNuevos: 1,
              clientesExistentes: 0,
              referenciasNuevas: 1,
              suscripcionesNuevas: service ? 1 : 0,
              operaciones: finance ? 1 : 0,
              ingresos: 0,
              deuda: finance ? 75 : 0,
              gratuitas: 0,
            },
            clientes: [
              {
                identidadId: 'identity',
                nombre: 'Cliente ficticio',
                referencia: 'Cliente ficticio',
                referenciaId: null,
                crear: true,
              },
            ],
            bloqueos: blocked
              ? [{ filaId: 'row', hoja: 'OCT', fila: 4, motivos: ['Equivalencias pendientes'] }]
              : [],
            filas: [
              {
                filaId: 'row',
                hoja: 'OCT',
                fila: 4,
                nombre: 'Cliente ficticio',
                servicio: service ? 'NUEVO' : 'NINGUNO',
                finanzas: finance ? 'DEUDA' : 'NINGUNA',
                tipoOperacion: finance ? 'ALTA' : null,
                destino: 'nuevo:row',
                producto: 'MAXPLAYER',
                tarifa: 'Anual',
                servidor: 'COBRA',
                referencia: null,
                metodoPago: 'Stripe',
                fechaInicio: '2025-10-17',
                fechaFin: '2026-10-17',
                importe: 75,
                historica: true,
              },
            ],
          },
          resultado: null,
        };
        batches = [b];
        return send(b, 201);
      }
      if (path.endsWith('/confirmar')) {
        if (conflict) {
          version++;
          return send(
            { message: 'Han cambiado los datos. Actualiza y prepara una nueva propuesta.' },
            409,
          );
        }
        const b = batches[0];
        b.estado = 'APLICADO';
        b.resultado = {
          clientesNuevos: 1,
          suscripcionesNuevas: b.propuesta.resumen.suscripcionesNuevas,
          operaciones: b.propuesta.resumen.operaciones,
          movimientos: b.propuesta.resumen.operaciones,
          filas: [
            {
              filaId: 'row',
              clienteId: 'client',
              suscripcionId: 'sub',
              renovacionId: 'renewal',
              movimientoId: 'movement',
            },
          ],
        };
        summary.movimientosCreados = b.resultado.movimientos;
        summary.filasPendientesReconciliacion = 1;
        version++;
        return send(b, 201);
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
          clientes: [],
          equivalencias: [],
        },
      });
    if (path.endsWith('/aplicacion')) {
      const second = url.searchParams.get('page') === '2';
      return send({
        huellaRevision: String(version).repeat(64),
        hojas: ['OCT'],
        pagination: { total: 2, totalPages: 2 },
        lotes:
          older && batches.length && url.searchParams.get('lotesPage') !== '2'
            ? Array.from({ length: 50 }, (_, i) => ({ ...batches[0], id: `recent-${i}` }))
            : batches,
        lotesPagination: {
          page: Number(url.searchParams.get('lotesPage') || 1),
          total: older && batches.length ? 51 : batches.length,
          totalPages: older && batches.length ? 2 : 1,
        },
        data: [
          {
            id: second ? 'row2' : 'row',
            hoja: 'OCT',
            fila: second ? 5 : 4,
            nombre: 'Cliente ficticio',
            identidad: 'NUEVO',
            suscripcion: 'HISTORICA',
            finanzas: 'PENDIENTE_PAGO',
            excluida: false,
            clienteId: null,
            suscripcionId: null,
            renovacionId: null,
            importeAnual: 75,
            fechaInicioPropuesta: '2025-10-17',
            fechaFin: '2026-10-17',
            candidatos: [],
          },
        ],
      });
    }
    return send({ data: [], pagination: { total: 0, totalPages: 0 } });
  });
  const open = async () => {
    await page.getByText('Retomar un análisis guardado', { exact: true }).click();
    await page.getByRole('button', { name: 'Abrir análisis', exact: true }).click();
    await page.getByText('12.4 · Confirmar e importar datos revisados', { exact: true }).click();
  };
  const choose = async (finance = true) => {
    await page.getByLabel('Seleccionar OCT 4', { exact: true }).check();
    if (finance) {
      await page.getByLabel('Servicio OCT 4', { exact: true }).selectOption('NUEVO');
      await page.getByLabel('Finanzas OCT 4', { exact: true }).selectOption('DEUDA');
      await page.getByLabel('Operación OCT 4', { exact: true }).selectOption('ALTA');
    }
    await page.getByLabel('Motivo del lote', { exact: true }).fill('Ensayo revisado');
  };
  const preview = async () => {
    await page.getByRole('button', { name: 'Previsualizar lote', exact: true }).click();
    await page.getByRole('region', { name: 'Propuesta de importación' }).waitFor();
  };
  const confirm = async () => {
    await page
      .getByLabel('He revisado los clientes, servicios, agrupaciones y fechas del lote.')
      .check();
    await page
      .getByLabel(
        'Confirmo expresamente los importes, tipos de operación, cobros y deudas indicados.',
      )
      .check();
    await page.getByRole('button', { name: 'Confirmar importación del lote', exact: true }).click();
  };
  await page.goto(origin + '/importaciones');
  await open();
  return { page, writes, open, choose, preview, confirm };
}
test('exige previsualización, tipo de operación y doble confirmación financiera; PE no ofrece cobro', async (t) => {
  const { page, writes, choose, preview, confirm } = await fixture(t);
  await choose();
  assert.equal(
    await page
      .getByLabel('Finanzas OCT 4', { exact: true })
      .locator('option[value="COBRADO"]')
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Confirmar importación del lote', exact: true }).count(),
    0,
  );
  await page.getByLabel('Operación OCT 4', { exact: true }).selectOption('');
  assert.equal(
    await page.getByRole('button', { name: 'Previsualizar lote', exact: true }).isDisabled(),
    true,
  );
  await page.getByLabel('Operación OCT 4', { exact: true }).selectOption('ALTA');
  await preview();
  const button = page.getByRole('button', { name: 'Confirmar importación del lote', exact: true });
  assert.equal(await button.isDisabled(), true);
  await page
    .getByLabel('He revisado los clientes, servicios, agrupaciones y fechas del lote.')
    .check();
  assert.equal(await button.isDisabled(), true);
  await confirm();
  await page.getByText(/Importación completada:/).waitFor();
  assert.equal(writes[1].body.confirmarFinanzas, true);
});
test('importa solo clientes con finanzas pendientes sin solicitar confirmación financiera', async (t) => {
  const { page, writes, choose, preview } = await fixture(t);
  await choose(false);
  await preview();
  assert.equal(
    await page
      .getByLabel(
        'Confirmo expresamente los importes, tipos de operación, cobros y deudas indicados.',
      )
      .count(),
    0,
  );
  assert.equal(writes[0].body.filas[0].finanzas, 'NINGUNA');
  assert.equal(writes[0].body.filas[0].servicio, 'NINGUNO');
});
test('un bloqueo impide confirmar y cambiar el motivo invalida la propuesta', async (t) => {
  const { page, choose, preview } = await fixture(t, { blocked: true });
  await choose();
  await preview();
  await page.getByText('OCT 4: Equivalencias pendientes', { exact: true }).waitFor();
  await page
    .getByLabel('He revisado los clientes, servicios, agrupaciones y fechas del lote.')
    .check();
  await page
    .getByLabel(
      'Confirmo expresamente los importes, tipos de operación, cobros y deudas indicados.',
    )
    .check();
  assert.equal(
    await page
      .getByRole('button', { name: 'Confirmar importación del lote', exact: true })
      .isDisabled(),
    true,
  );
  await page.getByLabel('Motivo del lote', { exact: true }).fill('Otro motivo');
  assert.equal(await page.getByRole('region', { name: 'Propuesta de importación' }).count(), 0);
});
test('conserva borrador ante conflicto y exige actualizar la selección', async (t) => {
  const { page, choose, preview, confirm } = await fixture(t, { conflict: true });
  await choose();
  await preview();
  await confirm();
  await page
    .getByText('Los datos han cambiado. Actualiza la selección y revisa de nuevo las filas.', {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByLabel('Motivo del lote', { exact: true }).inputValue(),
    'Ensayo revisado',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Previsualizar lote', exact: true }).isDisabled(),
    true,
  );
});
test('recupera un lote aplicado tras recargar sin volver a ofrecer confirmación', async (t) => {
  const { page, writes, choose, preview, confirm, open } = await fixture(t);
  await choose();
  await preview();
  await confirm();
  await page.getByText(/Importación completada:/).waitFor();
  await page.reload();
  await open();
  await page.getByText('Lotes guardados (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Abrir lote batch-fixture', exact: true }).click();
  await page.getByText(/Importación completada:/).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Confirmar importación del lote', exact: true }).count(),
    0,
  );
  assert.equal(writes.length, 2);
});
test('conserva selección entre páginas y agrupa periodos explícitamente también en móvil', async (t) => {
  const { page, writes, choose, preview } = await fixture(t, { mobile: true });
  await choose();
  await page.getByRole('button', { name: 'Página siguiente de importación', exact: true }).click();
  await page.getByLabel('Seleccionar OCT 5', { exact: true }).check();
  await page.getByLabel('Servicio OCT 5', { exact: true }).selectOption('NUEVO');
  await page
    .getByRole('button', {
      name: 'Agrupar seleccionadas como periodos del mismo servicio',
      exact: true,
    })
    .click();
  await preview();
  assert.equal(writes[0].body.filas.length, 2);
  assert.ok(writes[0].body.filas[0].grupoId);
  assert.equal(writes[0].body.filas[0].grupoId, writes[0].body.filas[1].grupoId);
});

test('muestra el método de pago dentro del detalle que se confirma', async (t) => {
  const { page, choose, preview } = await fixture(t);
  await choose();
  await preview();
  await page.getByText('Revisar todas las filas del lote', { exact: true }).click();
  await page.getByText(/Método de pago: Stripe/).waitFor();
});

test('recupera el resultado aplicado que ya no está entre los últimos cincuenta lotes', async (t) => {
  const { page, choose, preview, confirm, open } = await fixture(t, { older: true });
  await choose();
  await preview();
  await confirm();
  await page.getByText(/Importación completada:/).waitFor();
  await page.reload();
  await open();
  await page.getByText('Lotes guardados (51)', { exact: true }).click();
  await page.getByRole('button', { name: 'Lotes siguientes', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir lote batch-fixture', exact: true }).click();
  await page.getByText(/Importación completada:/).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Confirmar importación del lote', exact: true }).count(),
    0,
  );
});

test('actualiza el resumen general después de aplicar el lote', async (t) => {
  const { page, choose, preview, confirm } = await fixture(t);
  await choose();
  await preview();
  await confirm();
  await page.getByText(/Importación completada:/).waitFor();
  const metric = page.getByText('Movimientos creados', { exact: true }).locator('..');
  await metric.getByText('1', { exact: true }).waitFor();
});
