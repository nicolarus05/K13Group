// Crea un esquema temporal exclusivo y lo elimina al terminar; nunca usa public.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
async function main() {
  const schema = 'catalogos_test_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const db = new PrismaClient();
  try {
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const env = {
      ...process.env,
      DATABASE_URL: url.toString(),
      TEST_DATABASE_URL: url.toString(),
      JWT_SECRET: 'catalogos-test-only',
      JWT_REFRESH_SECRET: 'catalogos-test-refresh-only',
    };
    for (const [bin, args] of [
      ['prisma', ['migrate', 'deploy']],
      ['jest', ['--runInBand', '--testPathPattern=\\.integration\\.spec\\.ts$']],
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
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
