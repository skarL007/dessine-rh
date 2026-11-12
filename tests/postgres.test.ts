import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import request, { type Test } from 'supertest';

const databaseUrl = process.env.DESSINE_TEST_POSTGRES_URL;
const origin = 'http://localhost:3000';
const password = 'Validation-only-postgresql-password!';
const fixture = {
  name: 'Pessoa de validação PostgreSQL', jobTitle: 'Analista', department: 'Operações',
  admissionDate: '2025-01-01', terminationDate: null, salaryCents: 1_000_000_000,
  usesTransport: true, transportDailyCents: 1200, status: 'active',
};

test('API com PostgreSQL real', { skip: !databaseUrl && 'Defina DESSINE_TEST_POSTGRES_URL para um banco descartável.' }, async t => {
  assert.ok(databaseUrl);
  const connection = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname), 'Use PostgreSQL local ou um túnel local dedicado de teste.');
  assert.match(connection.pathname, /^\/dessine_rh_test(?:_[a-z0-9]+)?$/, 'Use um banco exclusivo e descartável de teste.');
  assert.equal(connection.search, '', 'A suíte configura o isolamento das conexões.');

  const schema = `dessine_${randomBytes(8).toString('hex')}`;
  const control = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let schemaCreated = false;
  let closeAppDb: (() => Promise<void>) | undefined;
  t.after(async () => {
    try {
      await closeAppDb?.();
      if (schemaCreated) await control.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally { await control.end(); }
  });
  await control.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  connection.searchParams.set('options', `-c search_path=${schema} -c timezone=America/Sao_Paulo`);
  connection.searchParams.set('application_name', schema);
  process.env.DATABASE_URL = connection.toString();
  process.env.BETTER_AUTH_URL = origin;
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString('hex');
  process.env.APP_ENV = 'local';
  delete process.env.VERCEL;

  const { getDb, migrate, closeDb } = await import('../server/db.js');
  closeAppDb = closeDb;
  const { default: app } = await import('../server/app.js');
  const { createAppUser } = await import('../server/auth.js');
  await migrate();
  await migrate();
  const db = await getDb();
  assert.equal(db.mode, 'production');
  const [{ server_version }] = await db.query('SHOW server_version');
  t.diagnostic(`Servidor PostgreSQL ${server_version}`);

  await createAppUser({ username: 'dp', name: 'DP PostgreSQL', password, role: 'dp' });
  async function login(username: string) {
    const response = await request(app).post('/api/auth/sign-in/username').set('Origin', origin).send({ username, password });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const cookies = response.headers['set-cookie'];
    assert.ok(cookies);
    return [cookies].flat().map((cookie: string) => cookie.split(';', 1)[0]);
  }
  const admin = await login('dp');
  function api(method: 'get' | 'post' | 'patch' | 'put', path: string, cookie = admin) {
    return request(app)[method](path).set('Cookie', cookie).set('Origin', origin).timeout({ deadline: 15_000 });
  }
  async function preview(month: string) {
    const result = await api('post', '/api/payroll/calculate').send({ month });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return { month, expectedSourceVersion: result.body.sourceVersion };
  }
  async function awaitWaiters(count: number) {
    const timeoutAt = performance.now() + 5000;
    while (performance.now() < timeoutAt) {
      const result = await control.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0 AND query LIKE 'SELECT%settings%FOR UPDATE%'`, [schema]);
      if (result.rows[0].n === count) return;
      await delay(20);
    }
    assert.fail(`PostgreSQL não mostrou ${count} escrita(s) aguardando o bloqueio de configurações.`);
  }
  async function orderedWrites(actions: Array<() => Test>, beforeRelease?: () => Promise<void>) {
    const blocker = await control.connect();
    const responses: Array<Promise<Awaited<Test>>> = [];
    try {
      await blocker.query('BEGIN');
      await blocker.query(`SELECT id FROM ${schema}.settings WHERE id=1 FOR UPDATE`);
      for (const action of actions) {
        const response = Promise.resolve(action());
        responses.push(response);
        void response.catch(() => {});
        await awaitWaiters(responses.length);
      }
      await beforeRelease?.();
    } finally {
      try { await blocker.query('ROLLBACK'); }
      finally { blocker.release(); }
    }
    return Promise.all(responses);
  }

  const employeeIds: string[] = [];
  for (const name of ['Validação A', 'Validação B', 'Validação C']) {
    const created = await api('post', '/api/employees').send({ ...fixture, name });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    employeeIds.push(created.body.id);
    assert.equal(created.body.admissionDate, '2025-01-01');
  }

  await t.test('DATE civil e BIGINT no fechamento simultâneo', async () => {
    const [parser] = await db.query('SELECT $1::date AS date, $2::bigint AS cents, current_setting(\'TimeZone\') AS timezone', ['2026-11-01', 3_000_000_000]);
    assert.deepEqual(parser, { date: '2026-11-01', cents: 3_000_000_000, timezone: 'America/Sao_Paulo' });
    const month = '2026-11';
    const input = await preview(month);
    const [first, second] = await orderedWrites([
      () => api('post', '/api/payroll/close').send(input),
      () => api('post', '/api/payroll/close').send(input),
    ]);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.code, 'PAYROLL_CLOSED');
    assert.equal(first.body.snapshot.totals.salaryCents, 3_000_000_000);
    const payments = await api('get', `/api/payments?month=${month}`);
    assert.equal(payments.body.total, 3);
    const salary = payments.body.items.find((payment: { kind: string }) => payment.kind === 'salary');
    assert.equal(salary.amountCents, 3_000_000_000);
    assert.equal(salary.dueDate, '2026-12-05');
    assert.deepEqual(await db.query('SELECT count(*) AS n FROM payrolls WHERE month=$1', [month]), [{ n: 1 }]);
  });

  await t.test('falta e fechamento concorrentes mantêm a prévia e os lançamentos consistentes nas duas ordens', async () => {
    const absence = (date: string) => api('post', '/api/absences').send({ employeeId: employeeIds[0], date, reason: 'Validação PostgreSQL', discountBenefits: true });
    const previous = await preview('2026-09');
    const [added, stale] = await orderedWrites([
      () => absence('2026-08-10'),
      () => api('post', '/api/payroll/close').send(previous),
    ]);
    assert.equal(added.status, 201);
    assert.equal(added.body.date, '2026-08-10');
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'STALE_PREVIEW');
    assert.deepEqual(await db.query("SELECT count(*) AS n FROM payrolls WHERE month='2026-09'"), [{ n: 0 }]);

    const current = await preview('2026-10');
    const [closed, denied] = await orderedWrites([
      () => api('post', '/api/payroll/close').send(current),
      () => absence('2026-09-10'),
    ]);
    assert.equal(closed.status, 201, JSON.stringify(closed.body));
    assert.equal(denied.status, 409);
    assert.equal(denied.body.code, 'PAYROLL_CLOSED');
    assert.deepEqual(await db.query('SELECT count(*) AS n FROM absences WHERE date=$1', ['2026-09-10']), [{ n: 0 }]);
  });

  await t.test('pagamento e reabertura são mutuamente exclusivos nas duas ordens', async () => {
    for (const [month, paymentFirst] of [['2026-05', true], ['2026-06', false]] as const) {
      const closed = await api('post', '/api/payroll/close').send(await preview(month));
      assert.equal(closed.status, 201, JSON.stringify(closed.body));
      const [payment] = (await api('get', `/api/payments?month=${month}`)).body.items;
      const confirm = () => api('post', `/api/payments/${payment.id}/confirm`).send({ version: payment.version });
      const reopen = () => api('post', `/api/payroll/${closed.body.id}/reopen`).send({ version: closed.body.version, reason: 'Validação de concorrência' });
      const [winner, loser] = await orderedWrites(paymentFirst ? [confirm, reopen] : [reopen, confirm]);
      assert.equal(winner.status, 200, JSON.stringify(winner.body));
      assert.equal(loser.status, 409, JSON.stringify(loser.body));
      assert.equal(loser.body.code, paymentFirst ? 'PAYMENTS_CONFIRMED' : 'VERSION_CONFLICT');
      const [stored] = await db.query('SELECT status FROM payrolls WHERE id=$1', [closed.body.id]);
      assert.equal(stored.status, paymentFirst ? 'closed' : 'reopened');
      const statuses = (await db.query('SELECT status FROM payments WHERE "payrollId"=$1 ORDER BY status', [closed.body.id])).map(row => row.status);
      assert.deepEqual(statuses, paymentFirst ? ['paid', 'pending', 'pending'] : ['void', 'void', 'void']);
    }
  });

  await t.test('dois editores com a mesma versão não sobrescrevem alterações', async () => {
    const url = `/api/employees/${employeeIds[1]}`;
    const [updated, conflict] = await orderedWrites([
      () => api('patch', url).send({ ...fixture, version: 1, name: 'Versão que ganhou' }),
      () => api('patch', url).send({ ...fixture, version: 1, name: 'Versão desatualizada' }),
    ]);
    assert.equal(updated.status, 200);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'VERSION_CONFLICT');
    assert.deepEqual(await db.query('SELECT name,version FROM employees WHERE id=$1', [employeeIds[1]]), [{ name: 'Versão que ganhou', version: 2 }]);
  });

  await t.test('mudança de perfil ou desativação corta escrita já enfileirada', async () => {
    for (const active of [true, false]) {
      const username = active ? 'dprevogavel' : 'dpdesativavel';
      const user = await createAppUser({ username, name: 'DP temporário', password, role: 'dp' });
      const cookie = await login(username);
      const name = `Escrita recusada ${username}`;
      const [updated, rejected] = await orderedWrites([
        () => api('patch', `/api/users/${user.id}`).send({ name: 'Conta de validação', role: 'financeiro', active }),
        () => api('post', '/api/employees', cookie).send({ ...fixture, name }),
      ]);
      assert.equal(updated.status, 200, JSON.stringify(updated.body));
      assert.equal(rejected.status, active ? 403 : 401, JSON.stringify(rejected.body));
      assert.deepEqual(await db.query('SELECT count(*) AS n FROM employees WHERE name=$1', [name]), [{ n: 0 }]);
      assert.equal((await api('get', '/api/bootstrap', cookie)).status, 401);
    }
  });

  await t.test('logout corta escrita já enfileirada da mesma sessão', async () => {
    const cookie = await login('dp');
    const name = 'Escrita recusada após logout';
    const [rejected] = await orderedWrites([
      () => api('post', '/api/employees', cookie).send({ ...fixture, name }),
    ], async () => {
      const logout = await api('post', '/api/auth/sign-out', cookie).send({});
      assert.equal(logout.status, 200, JSON.stringify(logout.body));
    });
    assert.equal(rejected.status, 401, JSON.stringify(rejected.body));
    assert.deepEqual(await db.query('SELECT count(*) AS n FROM employees WHERE name=$1', [name]), [{ n: 0 }]);
  });

  await t.test('versões anteriores mantêm os valores conferidos depois de um novo fechamento', async () => {
    const month = '2026-06';
    const archived = await api('get', `/api/payroll/${month}/versions/1`);
    assert.equal(archived.status, 200);
    assert.equal(archived.body.payroll.status, 'reopened');
    const originalSnapshot = archived.body.payroll.snapshot;
    const configuration = await api('get', '/api/settings');
    const settings = await api('put', '/api/settings').send({ ...configuration.body, foodDailyCents: 3000 });
    assert.equal(settings.status, 200, JSON.stringify(settings.body));
    const closed = await api('post', '/api/payroll/close').send(await preview(month));
    assert.equal(closed.status, 201, JSON.stringify(closed.body));
    const history = await api('get', `/api/payroll/${month}/versions`);
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.versions.map((entry: { revision: number }) => entry.revision), [2, 1]);
    assert.notEqual(closed.body.snapshot.totals.foodCents, originalSnapshot.totals.foodCents);
    const previous = await api('get', `/api/payroll/${month}/versions/1`);
    assert.deepEqual(previous.body.payroll.snapshot, originalSnapshot);
  });

  await t.test('erro ao gravar compromisso reverte fechamento, pagamentos e auditoria', async () => {
    const month = '2026-07';
    const input = await preview(month);
    const constraint = 'validation_reject_transport';
    await db.query(`ALTER TABLE payments ADD CONSTRAINT ${constraint} CHECK (month <> '${month}' OR kind <> 'transport')`);
    try {
      const rejected = await api('post', '/api/payroll/close').send(input);
      assert.equal(rejected.status, 500, JSON.stringify(rejected.body));
      assert.deepEqual(await db.query('SELECT count(*) AS n FROM payrolls WHERE month=$1', [month]), [{ n: 0 }]);
      assert.deepEqual(await db.query('SELECT count(*) AS n FROM payments WHERE month=$1', [month]), [{ n: 0 }]);
      assert.deepEqual(await db.query('SELECT count(*) AS n FROM audit WHERE action=$1 AND summary LIKE $2', ['payroll.closed', `%${month}%`]), [{ n: 0 }]);
    } finally {
      await db.query(`ALTER TABLE payments DROP CONSTRAINT ${constraint}`);
    }
    const retry = await api('post', '/api/payroll/close').send(input);
    assert.equal(retry.status, 201, JSON.stringify(retry.body));
  });

  await t.test('outra instância da API abre uma sessão e lê os valores persistidos', async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import request from 'supertest';
      import app from './server/app.ts';
      import { closeDb } from './server/db.ts';
      try {
        const login = await request(app).post('/api/auth/sign-in/username').set('Origin', process.env.BETTER_AUTH_URL).send({ username: 'dp', password: process.env.DESSINE_PG_FIXTURE_PASSWORD });
        if (login.status !== 200) throw new Error('Falha ao iniciar sessão na nova instância.');
        const cookie = [login.headers['set-cookie']].flat().map(value => value.split(';', 1)[0]);
        const response = await request(app).get('/api/payroll?month=2026-11').set('Cookie', cookie);
        console.log(JSON.stringify([response.status, response.body.payroll?.snapshot.totals.salaryCents]));
      } finally { await closeDb(); }
    `], { env: { ...process.env, DESSINE_PG_FIXTURE_PASSWORD: password }, timeout: 15_000 });
    assert.deepEqual(JSON.parse(stdout.trim()), [200, 3_000_000_000]);
  });
});
