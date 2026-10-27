const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { PrismaClient } = require('@prisma/client');
const { JwtService } = require('@nestjs/jwt');
const { randomUUID } = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs');
assert.equal(process.env.QUALITY_ISOLATED, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'quality-db');
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/k13_quality');
const db = new PrismaClient();
const jwt = new JwtService();
const paths = [
  '/clientes?limit=25',
  '/suscripciones?limit=25',
  '/finanzas?limit=25',
  '/dashboard',
  '/estadisticas?desde=2026-01-01&hasta=2026-10-26',
  '/auditoria?limit=25',
  '/auditoria/filtros',
];
const quantile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
(async () => {
  const user = await db.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
  const sessions = [];
  // Sesiones sintéticas: la API valida JWT y sesión reales. El login se prueba en Chromium.
  for (let i = 0; i < 10; i++) {
    const id = randomUUID();
    await db.sesion.create({
      data: {
        id,
        usuarioId: user.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    sessions.push(
      jwt.sign({ sub: user.id, sid: id }, { secret: process.env.JWT_SECRET, expiresIn: '1h' }),
    );
  }
  const results = [];
  const request = async (path, token) => {
    const start = performance.now();
    const response = await fetch('http://localhost:3001/api/v1' + path, {
      headers: { Cookie: 'access_token=' + token },
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.text();
    assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
    assert.equal(JSON.parse(body).success, true, path);
    return { ms: performance.now() - start, bytes: Buffer.byteLength(body) };
  };
  const soakSeconds = Number(process.env.QUALITY_SOAK_SECONDS || 0);
  assert.ok(
    soakSeconds === 0 ||
      (Number.isInteger(soakSeconds) && soakSeconds >= 60 && soakSeconds <= 1800),
  );
  if (soakSeconds) {
    const exports = [];
    const exportFile = async (module, format) => {
      const start = performance.now();
      const response = await fetch('http://localhost:3001/api/v1/exportaciones/' + module, {
        method: 'POST',
        headers: {
          Cookie: 'access_token=' + sessions[0],
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ formato: format, filtros: {} }),
        signal: AbortSignal.timeout(120000),
      });
      assert.equal(response.status, 200, `Exportación ${module}: HTTP ${response.status}`);
      assert.ok(response.headers.get('content-disposition').includes('.' + format));
      const buffer = Buffer.from(await response.arrayBuffer());
      assert.ok(buffer.length > 100, 'La exportación debe contener datos');
      if (format === 'xlsx') {
        const book = new (require('exceljs').Workbook)();
        await book.xlsx.load(buffer);
        assert.ok(book.worksheets[0].rowCount > 1, 'XLSX legible y con registros');
      } else assert.ok(buffer.toString('utf8').split('\n').length > 1);
      exports.push({
        module,
        format,
        bytes: buffer.length,
        ms: Math.round(performance.now() - start),
      });
    };
    let exported = false;
    const memory = [],
      latencies = new Map(paths.map((path) => [path, []]));
    const started = performance.now();
    let round = 0,
      sampledAt = -Infinity;
    while (performance.now() - started < soakSeconds * 1000) {
      const concurrentExports = [];
      if (!exported && performance.now() - started >= 45000) {
        exported = true;
        concurrentExports.push(exportFile('clientes', 'xlsx'), exportFile('finanzas', 'csv'));
      }
      await Promise.all([
        ...concurrentExports,
        ...sessions.map(async (token, i) => {
          const path = paths[(round + i) % paths.length];
          const result = await request(path, token);
          latencies.get(path).push(result.ms);
        }),
      ]);
      if (performance.now() - sampledAt >= 30000) {
        const pid = fs
          .readdirSync('/proc')
          .filter((name) => /^\d+$/.test(name))
          .find((name) => {
            try {
              return /(?:^|\/)node\0dist\/src\/main\0/.test(
                fs.readFileSync(`/proc/${name}/cmdline`, 'utf8'),
              );
            } catch {
              return false;
            }
          });
        assert.ok(pid, 'No se encuentra el proceso de API para medir memoria');
        const rss =
          Number(fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]) * 1024;
        const [connections] =
          await db.$queryRaw`SELECT COUNT(*)::int total FROM pg_stat_activity WHERE datname=current_database()`;
        memory.push({
          seconds: Math.round((performance.now() - started) / 1000),
          apiRssBytes: rss,
          connections: connections.total,
        });
        sampledAt = performance.now();
      }
      round++;
      // Máximo cinco peticiones/s, repartidas entre rutas, sin desactivar el límite real.
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    assert.equal(exports.length, 2, 'El ensayo debe completar las dos exportaciones');
    console.log(
      JSON.stringify(
        {
          mode: 'soak',
          seconds: soakSeconds,
          concurrency: 10,
          exports,
          memory,
          results: [...latencies].map(([path, times]) => ({
            path,
            requests: times.length,
            p95Ms: Math.round(quantile(times, 0.95)),
            maxMs: Math.round(Math.max(...times)),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  for (const path of paths) {
    const cold = await request(path, sessions[0]);
    for (const concurrency of [1, 5, 10]) {
      const times = [],
        sizes = [];
      for (let offset = 0; offset < 30; offset += concurrency) {
        const batch = await Promise.all(
          sessions.slice(0, concurrency).map((token) => request(path, token)),
        );
        for (const r of batch) {
          times.push(r.ms);
          sizes.push(r.bytes);
        }
      }
      results.push({
        path,
        concurrency,
        samples: times.length,
        firstRequestMs: Math.round(cold.ms),
        p50Ms: Math.round(quantile(times, 0.5)),
        p95Ms: Math.round(quantile(times, 0.95)),
        maxMs: Math.round(Math.max(...times)),
        maxBytes: Math.max(...sizes),
      });
    }
  }
  const plans = {};
  for (const [name, sql] of Object.entries({
    auditFilters: 'SELECT DISTINCT tabla FROM actividad ORDER BY tabla',
    auditPage: 'SELECT id, created_at FROM actividad ORDER BY created_at DESC, id DESC LIMIT 26',
  }))
    plans[name] = await db.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql);
  console.log(
    JSON.stringify(
      {
        scale: Number(process.env.QUALITY_SCALE || 1),
        node: process.version,
        cpus: os.availableParallelism(),
        memoryBytes: os.totalmem(),
        results,
        plans,
      },
      null,
      2,
    ),
  );
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
