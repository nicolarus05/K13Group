// Solo para recovery/compose.test.yml: navegador/API/BD reales, sin mocks.
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { chromium } = require('playwright-core');
const origin = 'http://localhost:3000',
  api = 'http://localhost:3001/api/v1';
const phase = process.argv[2] || 'flow';
const stateFile = '/tmp/k13-e2e-result.json';
async function main() {
  assert.equal(
    process.env.SPRINT11_ISOLATED,
    '1',
    'Usa ./dev test-e2e-configuracion; requiere instalación ficticia',
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await mkdir('/tmp/k13-sprint11-evidence', { recursive: true });
  async function get(path) {
    const response = await context.request.get(api + path);
    assert.equal(response.status(), 200, path);
    return response.json();
  }
  async function post(path, body) {
    const response = await context.request.post(api + path, { data: body });
    assert.ok(response.ok(), `${path}: HTTP ${response.status()} ${await response.text()}`);
    return response.json();
  }
  async function login(password = 'admin1234', username = 'admin') {
    await page.goto(origin + '/login');
    await page.getByLabel('Usuario', { exact: true }).fill(username);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL('**/dashboard');
  }
  async function name(value) {
    await page.goto(origin + '/configuracion');
    await page.getByLabel('Nombre del negocio').fill(value);
    await page.getByLabel('Motivo del cambio').fill('Ensayo real aislado');
    await page.getByRole('button', { name: 'Guardar ajustes', exact: true }).click();
    await page.getByText('Ajustes guardados.', { exact: true }).waitFor();
  }
  async function waitJob() {
    const ticket = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('k13-recovery-status')),
    );
    assert.ok(ticket?.id);
    for (let i = 0; i < 120; i++) {
      const response = await context.request.get(api + '/configuracion/trabajos/' + ticket.id, {
        headers: { Authorization: 'Bearer ' + ticket.token },
      });
      assert.equal(response.status(), 200, 'Estado disponible durante mantenimiento');
      const job = (await response.json()).data;
      if (job.state === 'FALLIDA') throw new Error('Trabajo fallido: ' + job.error);
      if (job.state === 'COMPLETADA') {
        await page.getByText('COMPLETADA · Completada', { exact: true }).waitFor();
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Trabajo no finalizó a tiempo');
  }
  async function confirm() {
    await page.getByLabel('Contraseña actual para esta operación').fill('admin1234');
    await page.getByRole('button', { name: 'Confirmar operación', exact: true }).click();
    await page.getByRole('heading', { name: /Operación / }).waitFor();
  }
  try {
    if (phase === 'persistence') {
      const state = JSON.parse(await readFile(stateFile, 'utf8'));
      await login(state.password, state.username);
      assert.equal((await get('/auth/me')).data.username, state.username);
      assert.equal(
        (
          await context.request.post(api + '/auth/login', {
            data: { username: 'admin', password: 'admin1234' },
          })
        ).status(),
        401,
      );
      const prefs = (await get('/configuracion')).data;
      assert.equal(prefs.valores['negocio.nombre'], 'Negocio de ensayo');
      assert.equal(prefs.valores['negocio.logo_asset_id'], state.logo);
      assert.equal(
        (await context.request.get(api + '/configuracion/logo/' + state.logo)).status(),
        200,
      );
      const copies = (await get('/configuracion/copias?limit=100')).data;
      assert.ok(copies.some((c) => c.id === state.copy && c.state === 'COMPLETADA'));
      await page.goto(origin + '/configuracion?tab=copias');
      await page.getByText(state.copy, { exact: true }).waitFor();
      await page.screenshot({
        path: '/tmp/k13-sprint11-evidence/persistencia.png',
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      console.log(
        'E2E persistencia: ajustes, logo y copias sobreviven a recrear API y trabajador.',
      );
      return;
    }
    await login();
    console.log('E2E: login real correcto.');
    // Datos de negocio reales y ficticios para comprobar fechas, dinero y relaciones.
    const client = (
      await post('/clientes', { nombre: 'Cliente ficticio Sprint 11', telefono: '600123411' })
    ).data;
    const tariff = (await get('/tarifas?estado=activo&limit=100')).data[0];
    const server = (await get('/servidores?estado=activo')).data[0];
    const method = (await get('/metodos-pago?estado=activo&limit=100')).data.find(
      (m) => !m.esGratuito,
    );
    const subscription = (
      await post('/suscripciones', {
        solicitudId: randomUUID(),
        clienteId: client.id,
        productoId: tariff.productoId,
        tarifaId: tariff.id,
        servidorId: server.id,
        fechaInicio: '2026-01-15',
      })
    ).data;
    const payment = (
      await post(`/suscripciones/${subscription.id}/primer-pago`, {
        solicitudId: randomUUID(),
        version: subscription.version,
        importe: String(tariff.precio),
        metodoPagoId: method.id,
        cobro: 'CONFIRMADO',
        fechaCobro: '2026-01-15',
      })
    ).data;
    await name('Negocio de ensayo');
    await page.getByLabel('Formato de fecha').selectOption('yyyy-MM-dd');
    await page.getByLabel('Resultados por página').selectOption('10');
    await page.getByLabel('Motivo del cambio').fill('Preferencias del ensayo');
    await page.getByRole('button', { name: 'Guardar ajustes', exact: true }).click();
    await page.getByText('Ajustes guardados.', { exact: true }).waitFor();
    await page.getByLabel('Motivo del cambio').fill('Logo del ensayo');
    await page.getByLabel('Logo del negocio').setInputFiles('/app/public/LogoK13GROUP.jpg');
    await page.getByRole('button', { name: 'Guardar logo', exact: true }).click();
    await page.getByText('Logo guardado.', { exact: true }).waitFor();
    const prefs = (await get('/configuracion')).data;
    const logo = prefs.valores['negocio.logo_asset_id'];
    assert.match(logo, /^[a-f0-9-]{36}$/);
    await page.screenshot({ path: '/tmp/k13-sprint11-evidence/general.png', fullPage: true });
    await page.goto(origin + '/suscripciones/' + subscription.id);
    await page.getByText('2026-01-15', { exact: true }).first().waitFor();
    const filtered = await get('/suscripciones?limit=10');
    assert.equal(filtered.pagination.limit, 10);
    await page.goto(origin + '/catalogos?tab=servidores');
    await page.getByLabel('Nombre', { exact: true }).fill('Servidor de ensayo');
    await page.getByLabel('Observaciones').fill('Observaciones conservadas');
    await page.getByRole('button', { name: 'Crear', exact: true }).click();
    await page.getByText('Registro guardado.', { exact: true }).waitFor();
    await page.goto(origin + '/catalogos?tab=metodos-pago');
    await page
      .getByText('Orden de los métodos de pago en los formularios', { exact: true })
      .click();
    const order = (await get('/metodos-pago/orden')).data;
    await page.getByRole('button', { name: 'Bajar ' + order.data[0].nombre, exact: true }).click();
    await page.getByLabel('Motivo del nuevo orden').fill('Orden del ensayo');
    await page.getByRole('button', { name: 'Guardar orden', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar orden', exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelector('input[id="motivo-del-nuevo-orden"]')?.value === '',
    );
    assert.equal((await get('/metodos-pago/orden')).data.data[0].id, order.data[1].id);
    console.log('E2E: preferencias, logo, fechas, observaciones y orden de pago correctos.');
    await page.goto(origin + '/configuracion?tab=copias');
    await page.getByRole('button', { name: 'Crear copia de seguridad' }).click();
    await confirm();
    const backup = await waitJob();
    assert.ok(backup.copyId);
    await page.getByRole('button', { name: 'Volver a las copias' }).click();
    const copy = (await get('/configuracion/copias?limit=100')).data.find(
      (c) => c.id === backup.copyId,
    );
    assert.ok(copy);
    let card = page.getByRole('listitem').filter({ hasText: backup.copyId });
    await card.getByRole('button', { name: 'Descargar', exact: true }).click();
    await page.getByLabel('Contraseña actual para esta operación').fill('admin1234');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Confirmar operación' }).click();
    const download = await downloadPromise;
    const bytes = await readFile(await download.path());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), copy.checksum);
    await card.getByRole('button', { name: 'Validar restauración', exact: true }).click();
    await confirm();
    await waitJob();
    await page.getByRole('button', { name: 'Volver a las copias' }).click();
    console.log(
      'E2E: copia creada desde web, descarga con checksum correcto y validación temporal completada.',
    );
    await name('Cambio posterior que debe desaparecer');
    const extra = (await post('/clientes', { nombre: 'Registro posterior a la copia' })).data;
    const oldCookies = await context.cookies();
    await page.goto(origin + '/configuracion?tab=copias');
    card = page.getByRole('listitem').filter({ hasText: backup.copyId });
    await card.getByRole('button', { name: 'Restaurar', exact: true }).click();
    await page.getByLabel('Escribe el identificador de la copia').fill(backup.copyId);
    await confirm();
    await waitJob();
    await page.screenshot({ path: '/tmp/k13-sprint11-evidence/restauracion.png', fullPage: true });
    const revoked = await context.request.get(api + '/auth/me');
    assert.equal(revoked.status(), 401);
    await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('k13-recovery-status')), null);
    await login();
    await page.goto(origin + '/configuracion?tab=copias');
    await page.getByRole('button', { name: 'Crear copia de seguridad' }).waitFor();
    assert.equal((await get('/configuracion')).data.valores['negocio.nombre'], 'Negocio de ensayo');
    assert.equal((await context.request.get(api + '/clientes/' + extra.id)).status(), 404);
    const restored = (await get('/suscripciones/' + subscription.id)).data;
    assert.equal(restored.fechaInicio, subscription.fechaInicio);
    assert.equal(restored.fechaFin, subscription.fechaFin);
    const restoredPayment = (await get('/renovaciones/' + payment.id)).data;
    assert.equal(restoredPayment.importe, payment.importe);
    assert.equal(restoredPayment.fechaFin, payment.fechaFin);
    assert.equal((await context.request.get(api + '/configuracion/logo/' + logo)).status(), 200);
    const copied = await browser.newContext();
    await copied.addCookies(oldCookies);
    assert.equal((await copied.request.get(api + '/auth/me')).status(), 401);
    await copied.close();
    console.log(
      'E2E: restauración web conserva dinero, fechas, relaciones y logo; elimina cambios posteriores y revoca sesiones copiadas.',
    );
    // Dos sesiones reales y cambio de contraseña desde la interfaz.
    const second = await browser.newContext();
    assert.equal(
      (
        await second.request.post(api + '/auth/login', {
          data: { username: 'admin', password: 'admin1234' },
        })
      ).status(),
      200,
    );
    await page.goto(origin + '/configuracion?tab=seguridad');
    await page.getByLabel('Contraseña actual', { exact: true }).fill('admin1234');
    await page.getByLabel('Nombre', { exact: true }).fill('Administrador de ensayo');
    const username = 'operador-e2e';
    await page.getByLabel('Usuario', { exact: true }).fill(username);
    await page.getByRole('button', { name: 'Guardar perfil' }).click();
    await page.getByText('Perfil actualizado.', { exact: true }).waitFor();
    const password = 'Nueva-clave-E2E-2026';
    await page.getByLabel('Contraseña actual', { exact: true }).fill('admin1234');
    await page.getByLabel('Nueva contraseña', { exact: true }).fill(password);
    await page.getByLabel('Confirmar nueva contraseña').fill(password);
    await page.getByRole('button', { name: 'Cambiar contraseña y cerrar sesiones' }).click();
    await page.waitForURL('**/login');
    assert.equal((await second.request.get(api + '/auth/me')).status(), 401);
    assert.equal(
      (
        await second.request.post(api + '/auth/login', {
          data: { username, password: 'admin1234' },
        })
      ).status(),
      401,
    );
    await second.close();
    await login(password, username);
    await writeFile(stateFile, JSON.stringify({ password, username, logo, copy: backup.copyId }));
    assert.deepEqual(errors, []);
    console.log(
      'E2E: perfil y contraseña desde web; ambas sesiones revocadas y login con clave nueva correcto.',
    );
  } catch (error) {
    await page
      .screenshot({ path: '/tmp/k13-sprint11-evidence/fallo.png', fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
