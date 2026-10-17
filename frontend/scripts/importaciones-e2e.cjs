const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
async function main() {
  assert.equal(process.env.SPRINT12_ISOLATED, '1', 'Requiere el entorno de ensayo aislado');
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:3000/login');
    await page.getByLabel('Usuario', { exact: true }).fill('admin');
    await page.getByLabel('Contraseña', { exact: true }).fill('admin1234');
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL('**/dashboard');
    await page.goto('http://localhost:3000/importaciones');
    await page.getByLabel('Excel de clientes').setInputFiles('/tmp/lectura-fixture.xlsx');
    await page.getByRole('button', { name: 'Analizar archivo', exact: true }).click();
    await page.getByRole('heading', { name: 'Lectura de OCT · fila 4' }).waitFor();
    await page
      .getByText('PE: pendiente de pago. No se confirmará ningún cobro.', { exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Confirmar staging y guardar clientes' }).count(),
      0,
    );
    await page.getByLabel('Valor corregido', { exact: true }).fill('2026-02-28');
    await page
      .getByLabel('Motivo de la corrección', { exact: true })
      .fill('Fecha revisada en ensayo web');
    await page.getByRole('button', { name: 'Guardar corrección', exact: true }).click();
    await page
      .getByText('Corrección guardada y fila revalidada. El original se conserva.', { exact: true })
      .waitFor();
    await page.reload();
    await page.getByText('Retomar un análisis guardado', { exact: true }).click();
    await page.getByRole('button', { name: 'Abrir análisis', exact: true }).click();
    await page.getByText('Historial de correcciones', { exact: true }).click();
    await page.getByText('FECHA: 31/02/2026 → 2026-02-28', { exact: true }).waitFor();
    await page.getByLabel('Tipo de incidencia').selectOption('CLIENTE');
    await page.getByRole('heading', { name: 'Lectura de OCT · fila 6' }).waitFor();
    await page.getByText('12.2 · Revisar identidades y duplicados', { exact: true }).click();
    await page
      .getByRole('button', { name: 'Preparar revisión de identidades', exact: true })
      .click();
    const review = page.getByRole('region', { name: 'Revisión de identidades' });
    const identity = review
      .locator('article')
      .filter({ has: page.getByText('Cliente ficticio de lectura', { exact: true }) });
    await identity
      .getByRole('button', { name: 'Seleccionar 1 filas de esta identidad', exact: true })
      .click();
    await page
      .getByLabel('Motivo de la decisión de identidad', { exact: true })
      .fill('Identidad revisada en ensayo web');
    await page.getByRole('button', { name: 'Guardar decisión de identidad', exact: true }).click();
    await page
      .getByText('Decisión guardada. Las filas originales y sus operaciones se conservan.', {
        exact: true,
      })
      .waitFor();
    await page.reload();
    await page.getByText('Retomar un análisis guardado', { exact: true }).click();
    await page.getByRole('button', { name: 'Abrir análisis', exact: true }).click();
    await page.getByText('12.2 · Revisar identidades y duplicados', { exact: true }).click();
    await page.getByLabel('Situación de identidad').selectOption('NUEVO');
    await review.getByText('Cliente ficticio de lectura', { exact: true }).first().waitFor();
    await review.getByText('Historial de identidad (1)', { exact: true }).click();
    await review.getByText('Identidad revisada en ensayo web · 1 filas', { exact: true }).waitFor();
    for (const entity of ['clientes', 'suscripciones', 'finanzas']) {
      const response = await context.request.get('http://localhost:3001/api/v1/' + entity);
      assert.equal(response.status(), 200);
      assert.equal((await response.json()).pagination.total, 0);
    }
    assert.deepEqual(errors, []);
    console.log(
      'E2E lectura e identidades: archivo, PE, corrección, propuesta de identidad, historial, filtros y reanudación correctos; sin clientes, suscripciones ni movimientos creados.',
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
