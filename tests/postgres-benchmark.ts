import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import request, { type Test } from 'supertest';

const restoreCheck = process.argv.includes('--check-restore');
const databaseUrl = process.env.DESSINE_TEST_POSTGRES_URL;
assert.ok(databaseUrl, 'Defina DESSINE_TEST_POSTGRES_URL.');
const connection = new URL(databaseUrl);
assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname));
assert.equal(connection.pathname, restoreCheck ? '/dessine_rh_test_restored' : '/dessine_rh_test_benchmark');
assert.equal(connection.search, '');
const appName = 'dessine_benchmark';
connection.searchParams.set('application_name', appName);
const origin = 'http://localhost:3000';
const password = 'Benchmark-only-validation-password!';
const month = '2026-11';
process.env.DATABASE_URL = connection.toString();
process.env.BETTER_AUTH_URL = origin;
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString('hex');
process.env.APP_ENV = 'local';
delete process.env.VERCEL;

const { migrate, closeDb, getDb } = await import('../server/db.js');
const { default: app } = await import('../server/app.js');
const { createAppUser } = await import('../server/auth.js');
const control = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });

function stats(samples: number[]) {
  const ordered = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => Number(ordered[Math.ceil(p * ordered.length) - 1].toFixed(2));
  return { n: ordered.length, p50: percentile(0.50), p95: percentile(0.95), max: percentile(1) };
}

try {
  const db = await getDb();
  const [{ server_version }] = await db.query('SHOW server_version');
  if (!restoreCheck) {
    const [{ count }] = await db.query("SELECT count(*) FROM pg_tables WHERE schemaname='public'");
    assert.equal(count, 0, 'O banco de benchmark precisa estar vazio.');
    await migrate();
    await createAppUser({ username: 'dp', name: 'DP benchmark', role: 'dp', password });
    await db.query(`INSERT INTO employees(id,name,"jobTitle",department,"admissionDate","salaryCents","usesTransport","transportDailyCents",status)
      SELECT 'bench-'||i, 'Pessoa '||i, 'Analista', 'Área '||(i%10), DATE '2025-01-01', 400000, true, 1500, 'active'
      FROM generate_series(1,1000) AS i`);
    await db.query(`INSERT INTO absences(id,"employeeId",date,reason,"discountBenefits","createdBy")
      SELECT 'bench-absence-'||i, 'bench-'||i, DATE '2026-10-01'+(i%31), 'Registro sintético', true, 'DP benchmark'
      FROM generate_series(1,250) AS i`);
    await db.query('ANALYZE employees');
    await db.query('ANALYZE absences');
  }

  const login = await request(app).post('/api/auth/sign-in/username').set('Origin', origin).send({ username: 'dp', password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const cookie = [login.headers['set-cookie']].flat().map((value: string) => value.split(';', 1)[0]);
  const api = (method: 'get' | 'post' | 'patch', path: string) => request(app)[method](path).set('Origin', origin).set('Cookie', cookie).timeout({ deadline: 15_000 });

  if (!restoreCheck) {
    const operations: Record<string, () => Test> = {
      employees: () => api('get', '/api/employees?q=Pessoa&page=2&pageSize=20'),
      overview: () => api('get', `/api/overview?month=${month}`),
      preview: () => api('post', '/api/payroll/calculate').send({ month }),
    };
    const endpointLatencyMs: Record<string, ReturnType<typeof stats>> = {};
    for (const [name, run] of Object.entries(operations)) {
      for (let warmup = 0; warmup < 3; warmup++) assert.equal((await run()).status, 200);
      const samples = [];
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        const response = await run();
        samples.push(performance.now() - start);
        assert.equal(response.status, 200, JSON.stringify(response.body));
      }
      endpointLatencyMs[name] = stats(samples);
    }

    const client = await control.connect();
    const writeLatencyMs: number[] = [];
    const writes: Array<Promise<void>> = [];
    let peakWaiting = 0;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM settings WHERE id=1 FOR UPDATE');
      for (let i = 1; i <= 6; i++) {
        const started = performance.now();
        const write = Promise.resolve(api('patch', `/api/employees/bench-${i}`).send({
          name: `Pessoa ${i} atualizada`, jobTitle: 'Analista', department: `Área ${i}`,
          admissionDate: '2025-01-01', terminationDate: null, salaryCents: 400000,
          usesTransport: true, transportDailyCents: 1500, status: 'active', version: 1,
        })).then(response => {
          writeLatencyMs.push(performance.now() - started);
          assert.equal(response.status, 200, JSON.stringify(response.body));
        });
        writes.push(write);
        void write.catch(() => {});
      }
      const deadline = performance.now() + 3000;
      while (performance.now() < deadline && peakWaiting < writes.length) {
        const { rows } = await control.query<{ waiters: number }>(`SELECT count(*)::int AS waiters FROM pg_stat_activity
          WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0 AND query LIKE 'SELECT%settings%FOR UPDATE%'`, [appName]);
        peakWaiting = Math.max(peakWaiting, rows[0].waiters);
        if (peakWaiting < writes.length) await delay(10);
      }
    } finally {
      try { await client.query('ROLLBACK'); }
      finally { client.release(); }
    }
    await Promise.all(writes);
    assert.equal(peakWaiting, writes.length);
    console.log(JSON.stringify({ postgres: server_version, employees: 1000, absences: 250, warmupPerEndpoint: 3,
      endpointLatencyMs, injectedLock: { peakWaiting, latencyMs: stats(writeLatencyMs) } }, null, 2));

    const preview = await api('post', '/api/payroll/calculate').send({ month });
    assert.equal(preview.status, 200);
    const closed = await api('post', '/api/payroll/close').send({ month, expectedSourceVersion: preview.body.sourceVersion });
    assert.equal(closed.status, 201, JSON.stringify(closed.body));
  }

  const health = await api('get', '/api/health');
  assert.equal(health.status, 200);
  const profile = await api('get', '/api/bootstrap');
  assert.equal(profile.status, 200);
  assert.equal(profile.body.user.role, 'dp');
  const payroll = await api('get', `/api/payroll?month=${month}`);
  const payments = await api('get', `/api/payments?month=${month}`);
  assert.equal(payroll.status, 200);
  assert.equal(payments.status, 200);
  const [{ employees, absences, audit }] = await db.query(`SELECT
    (SELECT count(*) FROM employees) AS employees,
    (SELECT count(*) FROM absences) AS absences,
    (SELECT count(*) FROM audit) AS audit`);
  assert.deepEqual({ employees, absences, audit }, { employees: 1000, absences: 250, audit: 7 });
  assert.equal(payments.body.total, 3);
  const { totals, sourceVersion } = payroll.body.payroll.snapshot;
  assert.equal(totals.employeeCount, 1000);
  assert.equal(totals.salaryCents, 400_000_000);
  assert.equal(totals.absenceCount, 250);
  assert.match(sourceVersion, /^[a-f0-9]{64}$/);
  console.log(JSON.stringify({ restored: restoreCheck, employees, absences, audit, payments: payments.body.total, sourceVersion, totals }));
} finally {
  await closeDb();
  await control.end();
}
