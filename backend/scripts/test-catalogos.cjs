// Crea un esquema temporal exclusivo y lo elimina al terminar; nunca usa public.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');
async function runSuite(spec) {
  const schema = 'catalogos_test_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const db = new PrismaClient();
  try {
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      RECOVERY_DIR: '',
      ASSET_DIR: '/tmp/k13-test-assets',
      DATABASE_URL: url.toString(),
      TEST_DATABASE_URL: url.toString(),
      JWT_SECRET: 'catalogos-test-only',
      JWT_REFRESH_SECRET: 'catalogos-test-refresh-only',
    };
    for (const [bin, args] of [
      ['prisma', ['migrate', 'deploy']],
      ['jest', ['--runInBand', '--runTestsByPath', spec]],
    ]) {
      const result = spawnSync(path.resolve('node_modules/.bin', bin), args, {
        env,
        stdio: 'inherit',
      });
      if (result.status !== 0) throw new Error(`Falló ${bin}; código ${result.status}.`);
    }
  } finally {
    // Identificador generado por este proceso; no acepta nombres del usuario.
    if (!/^catalogos_test_[a-f0-9]{32}$/.test(schema))
      throw new Error('Esquema de prueba inválido');
    await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await db.$disconnect();
  }
}
async function main() {
  // Cada suite posee su esquema: ni el orden de Jest ni los 10.000 fixtures
  // opcionales pueden contaminar las pruebas de otros módulos.
  const load = 'suscripciones/suscripciones-load.integration.spec.ts';
  const suites = readdirSync(path.resolve('src'), { recursive: true })
    .filter((file) => file.endsWith('.integration.spec.ts'))
    .filter((file) => !process.env.INTEGRATION_SUITE || file === process.env.INTEGRATION_SUITE)
    .filter((file) => file !== load || process.env.SUBSCRIPTIONS_LOAD_TEST === '1')
    .sort((a, b) => (a === load ? -1 : b === load ? 1 : a.localeCompare(b)))
    .map((file) => path.join('src', file));
  if (!suites.length) throw new Error('No se ha encontrado la suite solicitada.');
  for (const spec of suites) await runSuite(spec);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
