const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
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
async function fixture(t, options = {}) {
  const context = await browser.newContext({
    viewport: options.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await context.addCookies([{ name: 'access_token', value: 'fixture', url: origin }]);
  const errors = [],
    writes = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  let settings = {
    version: 1,
    valores: {
      'negocio.nombre': 'K13Group',
      'negocio.logo_asset_id': '',
      'interfaz.formato_fecha': 'dd/MM/yyyy',
      'interfaz.resultados_pagina': 25,
      'suscripciones.dias_proxima': 7,
      'sistema.intervalo_comprobacion_minutos': 1,
      'interfaz.refresco_indicadores_segundos': 60,
      'seguridad.access_minutos': 15,
      'seguridad.sesion_dias': 7,
    },
  };
  const copy = {
    id: randomUUID(),
    state: 'COMPLETADA',
    createdAt: '2026-10-08T10:00:00Z',
    size: '1234',
    checksum: 'abc',
    validatedAt: '2026-10-08T11:00:00Z',
  };
  const methods = [
    { id: randomUUID(), nombre: 'Efectivo', activo: true },
    { id: randomUUID(), nombre: 'Transferencia', activo: true },
  ];
  const paths = [];
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace('/api/v1', '');
    paths.push(path + url.search);
    const send = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.method() === 'OPTIONS') return send({});
    if (req.method() !== 'GET') {
      const dto = req.postDataJSON();
      writes.push({ path, dto });
      if (path === '/configuracion') {
        if (options.conflict) {
          settings = { ...settings, version: 2 };
          return send({ message: 'Los ajustes han cambiado. Recarga antes de guardar.' }, 409);
        }
        settings = {
          ...settings,
          version: settings.version + 1,
          valores: { ...settings.valores, ...dto.cambios },
        };
        return send({ data: settings });
      }
      if (path.includes('/copias'))
        return send({ data: { id: randomUUID(), token: 'status-only' } }, 202);
      if (path === '/metodos-pago/orden') return send({ data: { version: 2 } });
      if (path === '/users/me')
        return send({
          data: {
            id: 'admin',
            nombre: dto.nombre,
            username: dto.username,
            updatedAt: '2026-10-08T12:00:00Z',
          },
        });
      return send({ success: true });
    }
    if (path === '/auth/me')
      return send({
        data: {
          id: 'admin',
          nombre: 'Administrador',
          username: 'admin',
          updatedAt: '2026-10-08T10:00:00Z',
        },
      });
    if (path === '/recordatorios/resumen') return send({ data: { atencion: 0 } });
    if (path === '/configuracion') return send({ data: settings });
    if (path === '/configuracion/copias')
      return send({ data: [copy], disponible: true, pagination: { page: 1, totalPages: 1 } });
    if (path.startsWith('/configuracion/trabajos/') && options.statusCode)
      return send({ message: 'Seguimiento caducado' }, options.statusCode);
    if (path.startsWith('/configuracion/trabajos/'))
      return send({
        data: {
          id: path.split('/').pop(),
          state: 'COMPLETADA',
          phase: 'Completada',
          action: options.statusAction || 'validate',
        },
      });
    if (path === '/metodos-pago/orden') return send({ data: { version: 1, data: methods } });
    if (path === '/metodos-pago')
      return send({ data: methods, pagination: { page: 1, totalPages: 1, total: 2 } });
    return send({ data: [], pagination: { page: 1, totalPages: 0, total: 0 } });
  });
  page.on('dialog', (dialog) => dialog.accept());
  return { page, writes, paths, copy, methods };
}
test('guarda ajustes, propaga nombre y conserva el motivo en la petición', async (t) => {
  const { page, writes } = await fixture(t);
  await page.goto(origin + '/configuracion');
  await page.getByLabel('Nombre del negocio').fill('Mi negocio');
  await page.getByLabel('Motivo del cambio').fill('Actualizar identidad');
  await page.getByRole('button', { name: 'Guardar ajustes' }).click();
  await page.getByText('Ajustes guardados.', { exact: true }).waitFor();
  assert.equal(writes[0].dto.version, 1);
  assert.deepEqual(writes[0].dto.cambios, { 'negocio.nombre': 'Mi negocio' });
  assert.equal(await page.getByRole('link', { name: 'Mi negocio · Inicio' }).count(), 1);
});
test('conflicto conserva el borrador y no reenvía automáticamente la escritura', async (t) => {
  const { page, writes } = await fixture(t, { conflict: true });
  await page.goto(origin + '/configuracion');
  await page.getByLabel('Nombre del negocio').fill('Borrador conservado');
  await page.getByLabel('Motivo del cambio').fill('Edición local');
  await page.getByRole('button', { name: 'Guardar ajustes' }).click();
  await page.getByRole('alert').filter({ hasText: 'Los ajustes han cambiado' }).waitFor();
  assert.equal(await page.getByLabel('Nombre del negocio').inputValue(), 'Borrador conservado');
  assert.equal(writes.length, 1);
});
test('navegación directa de catálogos y atrás/adelante conserva la pestaña de URL', async (t) => {
  const { page } = await fixture(t);
  await page.goto(origin + '/configuracion?tab=catalogos');
  await page.getByRole('link', { name: 'Servidores →' }).click();
  await page.getByRole('button', { name: 'Servidores', exact: true, pressed: true }).waitFor();
  await page.getByLabel('Observaciones').fill('Servidor de prueba');
  await page.getByRole('button', { name: 'Referencias', exact: true }).click();
  await page.waitForURL('**/catalogos?tab=referencias');
  await page.goBack();
  await page.getByRole('button', { name: 'Servidores', exact: true, pressed: true }).waitFor();
  await page.goForward();
  await page.getByRole('button', { name: 'Referencias', exact: true, pressed: true }).waitFor();
});
test('orden de pago envía el conjunto completo con versión y motivo', async (t) => {
  const { page, writes, methods } = await fixture(t);
  await page.goto(origin + '/catalogos?tab=metodos-pago');
  await page.getByText('Orden de los métodos de pago en los formularios', { exact: true }).click();
  await page.getByRole('button', { name: 'Bajar Efectivo' }).click();
  await page.getByLabel('Motivo del nuevo orden').fill('Preferencia de cobros');
  await page.getByRole('button', { name: 'Guardar orden', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button[disabled] svg.animate-spin'));
  assert.deepEqual(writes[0].dto.ids, [methods[1].id, methods[0].id]);
  assert.equal(writes[0].dto.version, 1);
});
test('restauración exige identificar la copia y permite consultar el trabajo sin cookies', async (t) => {
  const { page, writes, copy } = await fixture(t);
  await page.goto(origin + '/configuracion?tab=copias');
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Confirmar operación' }).isDisabled(), true);
  await page.getByLabel('Escribe el identificador de la copia').fill(copy.id);
  await page.getByLabel('Contraseña actual para esta operación').fill('Secreto-de-prueba');
  await page.getByRole('button', { name: 'Confirmar operación' }).click();
  await page.getByText('COMPLETADA · Completada', { exact: true }).waitFor();
  assert.equal(writes[0].dto.confirmacion, copy.id);
  assert.match(writes[0].dto.solicitudId, /^[a-f0-9-]{36}$/);
  const saved = await page.evaluate(() => sessionStorage.getItem('k13-recovery-status'));
  assert.ok(saved.includes('status-only'));
  assert.ok(!saved.includes('Secreto-de-prueba'));
});
test('cuenta comprueba confirmación de contraseña y formulario usable en móvil', async (t) => {
  const { page, writes } = await fixture(t, { mobile: true });
  await page.goto(origin + '/configuracion?tab=seguridad');
  await page.getByLabel('Contraseña actual', { exact: true }).fill('Actual-segura');
  await page.getByLabel('Nueva contraseña', { exact: true }).fill('Nueva-segura-2026');
  await page.getByLabel('Confirmar nueva contraseña').fill('Distinta-segura');
  await page.getByRole('button', { name: 'Cambiar contraseña y cerrar sesiones' }).click();
  await page.getByRole('alert').filter({ hasText: 'La confirmación debe coincidir' }).waitFor();
  assert.equal(writes.length, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
});

test('restauración completada limpia el seguimiento al volver a iniciar sesión', async (t) => {
  const { page } = await fixture(t, { statusAction: 'restore' });
  await page.goto(origin + '/configuracion?tab=copias');
  await page.evaluate(() =>
    sessionStorage.setItem(
      'k13-recovery-status',
      JSON.stringify({ id: 'completed-restore', token: 'fixture' }),
    ),
  );
  await page.reload();
  await page.getByText('Datos recuperados.', { exact: false }).waitFor();
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('k13-recovery-status')), null);
  await page.goto(origin + '/configuracion?tab=copias');
  await page.getByRole('button', { name: 'Crear copia de seguridad' }).waitFor();
});
test('seguimiento caducado permite volver a las copias sin reenviar la operación', async (t) => {
  const { page, writes } = await fixture(t, { statusCode: 403 });
  await page.goto(origin + '/configuracion?tab=copias');
  await page.evaluate(() =>
    sessionStorage.setItem(
      'k13-recovery-status',
      JSON.stringify({ id: 'expired-ticket', token: 'fixture' }),
    ),
  );
  await page.reload();
  await page
    .getByRole('button', { name: 'Dejar de seguir esta operación' })
    .click({ timeout: 10000 });
  await page.getByRole('button', { name: 'Crear copia de seguridad' }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('k13-recovery-status')), null);
  assert.equal(writes.length, 0);
});
