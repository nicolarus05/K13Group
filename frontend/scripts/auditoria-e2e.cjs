// Solo para recovery/compose.test.yml: datos ficticios, navegador/API/worker reales.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright-core');
const { readFile, writeFile } = require('node:fs/promises');
const api = 'http://localhost:3001/api/v1',
  origin = 'http://localhost:3000';
async function main() {
  assert.equal(process.env.SPRINT13_ISOLATED, '1', 'Requiere instalación ficticia');
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const context = await browser.newContext(),
      page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 500) errors.push('HTTP ' + r.status());
    });
    const get = async (path) => {
      const r = await context.request.get(api + path);
      assert.equal(r.status(), 200, path);
      return r.json();
    };
    await page.goto(origin + '/login');
    await page.getByLabel('Usuario', { exact: true }).fill('admin');
    await page.getByLabel('Contraseña', { exact: true }).fill('admin1234');
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL('**/dashboard');
    if (process.argv[2] === 'persistence') {
      const id = await readFile('/tmp/k13-sprint13-copy.txt', 'utf8');
      const copies = (await get('/configuracion/copias')).data.filter(
        (r) => r.scheduled && r.state === 'COMPLETADA',
      );
      assert.equal(copies.length, 1);
      assert.equal(copies[0].id, id);
      assert.equal((await get('/configuracion/copias/programacion')).data.activa, true);
      await page.goto(origin + '/auditoria');
      await page.getByRole('button', { name: 'Ver detalle', exact: true }).first().waitFor();
      console.log(
        'Persistencia tras reiniciar API y worker: una copia programada, sin duplicación.',
      );
    } else {
      await page.goto(origin + '/clientes');
      await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
      await page.getByLabel('Nombre *', { exact: true }).fill('Cliente ensayo auditoría');
      await page.getByRole('button', { name: 'Crear cliente', exact: true }).click();
      await page
        .getByRole('button', { name: 'Crear cliente', exact: true })
        .waitFor({ state: 'hidden' });
      const client = (await get('/clientes?search=Cliente%20ensayo%20auditor%C3%ADa')).data[0];
      assert.ok(client?.id);
      assert.equal(
        (
          await context.request.put(api + '/clientes/' + client.id, {
            data: { observaciones: 'Edición comprobada' },
          })
        ).status(),
        200,
      );
      assert.ok((await context.request.delete(api + '/clientes/' + client.id)).ok());
      await page.goto(origin + '/auditoria');
      await page.getByLabel('Módulo', { exact: true }).selectOption('clientes');
      await page.getByLabel('Identificador del registro', { exact: true }).fill(client.id);
      await page.getByRole('button', { name: 'Filtrar', exact: true }).click();
      await page.getByText('clientes · ELIMINAR', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Ver detalle', exact: true }).first().click();
      await page.getByRole('columnheader', { name: 'Anterior', exact: true }).waitFor();
      assert.equal((await context.request.get(api + '/clientes/' + client.id)).status(), 404);
      await page.goto(origin + '/configuracion?tab=copias');
      await page.getByLabel('Activar copias automáticas', { exact: true }).check();
      await page.getByLabel('Intervalo en horas', { exact: true }).fill('24');
      await page.getByLabel('Copias programadas que conservar', { exact: true }).fill('2');
      await page
        .getByLabel('Motivo de la programación', { exact: true })
        .fill('Ensayo aislado del sprint 13');
      await page.getByLabel('Contraseña para programar', { exact: true }).fill('admin1234');
      await page.getByRole('button', { name: 'Guardar programación', exact: true }).click();
      await page.getByText('Programación guardada.', { exact: true }).waitFor();
      let copy;
      for (let i = 0; i < 45; i++) {
        const status = (await get('/configuracion/copias/programacion')).data;
        assert.equal(status.error, null);
        copy = (await get('/configuracion/copias')).data.find(
          (r) => r.scheduled && r.state === 'COMPLETADA',
        );
        if (copy && status.estado === 'COMPLETADA') break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      assert.ok(copy?.id, 'El worker debe crear la copia programada');
      const r = await context.request.post(
        api + '/configuracion/copias/' + copy.id + '/validar-restauracion',
        { data: { password: 'admin1234', solicitudId: randomUUID() } },
      );
      assert.equal(r.status(), 202);
      const ticket = (await r.json()).data;
      let done = false;
      for (let i = 0; i < 45; i++) {
        const r = await context.request.get(api + '/configuracion/trabajos/' + ticket.id, {
          headers: { Authorization: 'Bearer ' + ticket.token },
        });
        assert.equal(r.status(), 200);
        const job = (await r.json()).data;
        assert.notEqual(job.state, 'FALLIDA');
        if (job.state === 'COMPLETADA') {
          done = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      assert.equal(done, true, 'Validación por restauración aislada de la copia programada');
      await writeFile('/tmp/k13-sprint13-copy.txt', copy.id);
      console.log(
        'Alta, edición, retirada y auditoría; programación desde la web y restauración de prueba: OK.',
      );
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
