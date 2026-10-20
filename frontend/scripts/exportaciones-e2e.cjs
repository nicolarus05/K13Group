const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright-core');
async function main() {
  assert.equal(process.env.SPRINT12_ISOLATED, '1', 'Requiere entorno aislado');
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (response) => {
      if (response.url().includes('/api/v1/exportaciones/') && !response.ok())
        console.error('Respuesta de exportación:', response.status());
    });
    await page.goto('http://localhost:3000/login');
    await page.getByLabel('Usuario', { exact: true }).fill('admin');
    await page.getByLabel('Contraseña', { exact: true }).fill('admin1234');
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL('**/dashboard');
    const read = async (path) => {
      const r = await context.request.get('http://localhost:3001/api/v1' + path);
      assert.equal(r.status(), 200);
      return r.json();
    };
    const counts = async () => {
      const result = {};
      for (const module of ['clientes', 'suscripciones', 'renovaciones', 'finanzas']) {
        result[module] = (await read('/' + module)).pagination.total;
      }
      return result;
    };
    const before = await counts();
    assert.ok(before.clientes > 0, 'Requiere el ensayo de importación previo');
    let downloads = 0;
    for (const module of [
      'clientes',
      'suscripciones',
      'renovaciones',
      'finanzas',
      'estadisticas',
    ]) {
      await page.goto('http://localhost:3000/' + module);
      await page
        .getByRole('heading', {
          name:
            module === 'estadisticas' ? 'Estadísticas' : module[0].toUpperCase() + module.slice(1),
          exact: true,
        })
        .waitFor();
      if (module === 'renovaciones')
        await page.getByRole('button', { name: 'Historial y cobros', exact: true }).click();
      if (module === 'finanzas')
        await page.getByLabel('Periodo', { exact: true }).selectOption('todas');
      for (const format of ['xlsx', 'csv', 'pdf']) {
        await page.getByLabel('Formato de exportación').selectOption(format);
        console.log('Descarga de ensayo:', module, format);
        const downloaded = page.waitForEvent('download', { timeout: 65000 });
        await page.getByRole('button', { name: 'Exportar', exact: true }).click();
        const file = await downloaded.catch(async (error) => {
          console.error('Error visible:', await page.getByRole('alert').allTextContents());
          throw error;
        });
        assert.equal(await file.failure(), null);
        assert.ok(file.suggestedFilename().endsWith('.' + format));
        const buffer = await fs.readFile(await file.path());
        assert.ok(buffer.length > 20);
        if (format === 'xlsx') assert.equal(buffer.subarray(0, 2).toString(), 'PK');
        if (format === 'pdf') assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
        if (format === 'csv') assert.equal(buffer.subarray(0, 3).toString('hex'), 'efbbbf');
        if (format === 'pdf' && module === 'renovaciones')
          await file.saveAs('/tmp/k13-exportacion-ensayo.pdf');
        downloads++;
      }
    }
    const after = await counts();
    assert.deepEqual(after, before);
    const history = await read('/exportaciones');
    assert.equal(history.pagination.total, downloads);
    assert.ok(history.data.every((r) => r.estado === 'GENERADA'));
    await page.goto('http://localhost:3000/exportaciones');
    await page.getByRole('heading', { name: 'Historial de exportaciones', exact: true }).waitFor();
    await page.waitForFunction(
      (count) => document.querySelectorAll('article').length === count,
      downloads,
    );
    assert.equal(await page.locator('article').count(), downloads);
    assert.deepEqual(errors, []);
    console.log(
      `E2E 12.5 OK: ${downloads} descargas reales, historial correcto y datos de negocio sin cambios.`,
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
