import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

const directory=await mkdtemp(join(tmpdir(),'dessine-api-'));
process.env.APP_ENV='local';process.env.PGLITE_DIR=directory;
process.env.BETTER_AUTH_SECRET=randomBytes(48).toString('hex');
process.env.BETTER_AUTH_URL='http://localhost:3000';
delete process.env.DATABASE_URL;delete process.env.VERCEL;
const {default:app}=await import('../server/app.js');
const {migrate,closeDb,getDb}=await import('../server/db.js');
const {createAppUser}=await import('../server/auth.js');
const password='Validation-only-password-2026!';
let adminCookie:string[];let readerCookie:string[];
const origin='http://localhost:3000';
function admin(method:'get'|'post'|'patch'|'delete'|'put',path:string){return request(app)[method](path).set('Cookie',adminCookie).set('Origin',origin);}
const employee={name:'Pessoa Fictícia',jobTitle:'Analista',department:'Operações',admissionDate:'2025-01-01',terminationDate:null,salaryCents:300000,usesTransport:true,transportDailyCents:1200,status:'active'};
let employeeId:string;let payrollId:string;let paymentId:string;let previewHash:string;

before(async()=>{
  await migrate();await createAppUser({username:'dp',name:'DP Validação',password,role:'dp'});await createAppUser({username:'consulta',name:'Consulta',password,role:'financeiro'});
  const login=await request(app).post('/api/auth/sign-in/username').set('Origin',origin).send({username:'dp',password});
  assert.equal(login.status,200,JSON.stringify(login.body));adminCookie=[login.headers['set-cookie']].flat().filter(Boolean);
  const reader=await request(app).post('/api/auth/sign-in/username').set('Origin',origin).send({username:'consulta',password});
  assert.equal(reader.status,200,JSON.stringify(reader.body));readerCookie=[reader.headers['set-cookie']].flat().filter(Boolean);
});
after(async()=>{await closeDb();await rm(directory,{recursive:true,force:true});});

test('authentication, private cache, cookie flags and denied public admin/signup',async()=>{
  assert.equal((await request(app).get('/api/employees')).status,401);
  const bootstrap=await admin('get','/api/bootstrap');assert.equal(bootstrap.status,200);assert.equal(bootstrap.body.user.role,'dp');assert.match(bootstrap.headers['cache-control'],/no-store/);
  assert.ok(adminCookie.some(cookie=>cookie.includes('HttpOnly')));
  for(const path of ['/api/auth/sign-up/email','/api/auth/admin/create-user','/api/auth/is-username-available'])assert.equal((await request(app).post(path).set('Origin',origin).send({})).status,404);
  assert.equal((await request(app).post('/api/employees').set('Cookie',adminCookie).set('Origin','https://attacker.invalid').send(employee)).status,403);
  assert.equal((await request(app).post('/api/employees').set('Cookie',readerCookie).set('Origin',origin).send(employee)).status,403);
});
test('employee input validation, pagination and optimistic locking',async()=>{
  assert.equal((await admin('post','/api/employees').send({...employee,admissionDate:'2025-02-30'})).status,400);
  assert.equal((await admin('post','/api/employees').send({...employee,salaryCents:1.25})).status,400);
  const created=await admin('post','/api/employees').send(employee);assert.equal(created.status,201);employeeId=created.body.id;
  const updated=await admin('patch',`/api/employees/${employeeId}`).send({...employee,version:1,name:'Pessoa Atualizada'});assert.equal(updated.status,200);assert.equal(updated.body.version,2);
  assert.equal((await admin('patch',`/api/employees/${employeeId}`).send({...employee,version:1})).status,409);
  const filtered=await admin('get','/api/employees?q=Atualizada&pageSize=1');assert.equal(filtered.body.total,1);assert.equal(filtered.body.items.length,1);
  assert.equal((await admin('get','/api/employees?pageSize=1000')).status,400);
});
test('absence range, duplicate protection and auditable cancellation',async()=>{
  assert.equal((await admin('post','/api/absences').send({employeeId,date:'2024-01-01',reason:'Teste',discountBenefits:true})).status,422);
  const body={employeeId,date:'2026-10-05',reason:'Registro de validação',discountBenefits:true};
  const created=await admin('post','/api/absences').send(body);assert.equal(created.status,201);
  assert.equal((await admin('post','/api/absences').send(body)).status,409);
  const absent=await admin('get','/api/absences?month=2026-10');assert.equal(absent.body.total,1);
  assert.equal((await admin('delete',`/api/absences/${created.body.id}`).send({reason:'Registro duplicado em validação'})).status,200);
  assert.equal((await admin('post','/api/absences').send(body)).status,201);
});
test('payroll preview, stale-source conflict and authoritative atomic closure',async()=>{
  const preview=await admin('post','/api/payroll/calculate').send({month:'2026-11'});assert.equal(preview.status,200);assert.equal(preview.body.totals.absenceCount,1);assert.equal(preview.body.totals.salaryCents,300000);
  previewHash=preview.body.sourceVersion;assert.match(previewHash,/^[a-f0-9]{64}$/);
  assert.equal((await admin('post','/api/payroll/close').send({month:'2026-11'})).status,400);
  const config=await admin('get','/api/settings');await admin('put','/api/settings').send({...config.body,foodDailyCents:3000});
  assert.equal((await admin('post','/api/payroll/close').send({month:'2026-11',expectedSourceVersion:previewHash})).status,409);
  previewHash=(await admin('post','/api/payroll/calculate').send({month:'2026-11'})).body.sourceVersion;
  const closed=await admin('post','/api/payroll/close').send({month:'2026-11',expectedSourceVersion:previewHash});assert.equal(closed.status,201,JSON.stringify(closed.body));payrollId=closed.body.id;
  assert.equal((await admin('post','/api/payroll/close').send({month:'2026-11',expectedSourceVersion:previewHash})).status,409);
  const payments=await admin('get','/api/payments?month=2026-11');assert.equal(payments.body.total,3);paymentId=payments.body.items[0].id;
  assert.equal((await admin('post','/api/absences').send({employeeId,date:'2026-10-06',reason:'Teste fechado',discountBenefits:true})).status,409);
});
test('immutable snapshots, confirmed-payment gate and administrative reversal',async()=>{
  const before=await admin('get','/api/payroll?month=2026-11');
  const config=await admin('get','/api/settings');await admin('put','/api/settings').send({...config.body,foodDailyCents:4000});
  const after=await admin('get','/api/payroll?month=2026-11');assert.deepEqual(after.body,before.body);
  const confirm=await admin('post',`/api/payments/${paymentId}/confirm`).send({version:1,note:'Confirmação apenas de teste'});assert.equal(confirm.status,200);assert.equal(confirm.body.status,'paid');
  assert.equal((await admin('post',`/api/payments/${paymentId}/confirm`).send({version:1})).status,409);
  assert.equal((await admin('post',`/api/payroll/${payrollId}/reopen`).send({version:1,reason:'Correção de teste'})).status,409);
  const reverse=await admin('post',`/api/payments/${paymentId}/reverse`).send({version:2,reason:'Reversão de validação'});assert.equal(reverse.status,200);assert.equal(reverse.body.status,'pending');
  assert.equal((await admin('post',`/api/payroll/${payrollId}/reopen`).send({version:1,reason:'Correção de teste'})).status,200);
  assert.equal((await admin('get','/api/payments?month=2026-11')).body.total,0);
});
test('payroll revisions retain separate snapshots when a pay period is closed again', async () => {
  const month = '2026-11';
  const historyPath = `/api/payroll/${month}/versions`;
  const first = await admin('get', `${historyPath}/1`);
  assert.equal(first.status, 200);
  assert.equal(first.body.payroll.status, 'reopened');
  assert.equal(first.body.payroll.version, 2);
  assert.equal(first.body.payroll.revision, 1);
  assert.equal(first.body.payroll.snapshot.settings.foodDailyCents, 3000);

  const preview = await admin('post', '/api/payroll/calculate').send({ month });
  const second = await admin('post', '/api/payroll/close').send({ month, expectedSourceVersion: preview.body.sourceVersion });
  assert.equal(second.status, 201);
  assert.equal(second.body.revision, 2);
  assert.equal(second.body.version, 1);
  assert.equal(second.body.snapshot.settings.foodDailyCents, 4000);
  const list = await request(app).get(historyPath).set('Cookie', readerCookie);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.versions.map(({ revision, status }: { revision: number; status: string }) => [revision, status]), [[2, 'closed'], [1, 'reopened']]);
  assert.ok(list.body.versions.every((entry: object) => !('snapshot' in entry)));
  const archived = await request(app).get(`${historyPath}/1`).set('Cookie', readerCookie);
  assert.deepEqual(archived.body.payroll.snapshot, first.body.payroll.snapshot);
  assert.equal((await admin('get', `${historyPath}/3`)).status, 404);
  assert.equal((await admin('get', `${historyPath}/2147483648`)).status, 400);
  assert.equal((await request(app).get(historyPath)).status, 401);
});

test('account, credentials and audit commit together and permit a retry after rollback', async () => {
  const db = await getDb();
  const input = { username: 'Leitura-Teste', name: 'Leitura Teste', password, role: 'diretoria' };
  const accountCount = async () => (await db.query('SELECT count(*)::int AS total FROM account'))[0].total;
  const accountsBefore = await accountCount();
  await db.query("ALTER TABLE audit ADD CONSTRAINT test_reject_user_creation CHECK (action <> 'user.created')");
  try {
    const failed = await admin('post', '/api/users').send(input);
    assert.equal(failed.status, 500);
    assert.equal((await db.query('SELECT id FROM "user" WHERE username=$1', ['leitura-teste'])).length, 0);
    assert.equal(await accountCount(), accountsBefore);
  } finally {
    await db.query('ALTER TABLE audit DROP CONSTRAINT test_reject_user_creation');
  }
  const created = await admin('post', '/api/users').send(input);
  assert.equal(created.status, 201);
  assert.equal(created.body.username, 'leitura-teste');
  assert.equal(await accountCount(), accountsBefore + 1);
  const events = await db.query("SELECT id FROM audit WHERE action='user.created' AND \"entityId\"=$1", [created.body.id]);
  assert.equal(events.length, 1);
  assert.equal((await admin('post', '/api/users').send(input)).status, 409);

  const login = await request(app).post('/api/auth/sign-in/username').set('Origin', origin).send({ username: 'leitura-teste', password });
  assert.equal(login.status, 200);
  const cookie = [login.headers['set-cookie']].flat();
  await db.query('UPDATE "session" SET "expiresAt"=clock_timestamp() - interval \'1 second\' WHERE "userId"=$1', [created.body.id]);
  assert.equal((await request(app).get('/api/bootstrap').set('Cookie', cookie)).status, 401);
  const secondLogin = await request(app).post('/api/auth/sign-in/username').set('Origin', origin).send({ username: 'leitura-teste', password });
  assert.equal(secondLogin.status, 200);
  const change = await request(app).post('/api/auth/change-password').set('Origin', origin).set('Cookie', [secondLogin.headers['set-cookie']].flat())
    .send({ currentPassword: password, newPassword: password + '2', revokeOtherSessions: true });
  assert.equal(change.status, 200);
  const activeCookie = [change.headers['set-cookie']].flat();
  assert.equal((await request(app).get('/api/bootstrap').set('Cookie', activeCookie)).status, 200);
  const disabled = await admin('patch', `/api/users/${created.body.id}`).send({ name: input.name, role: input.role, active: false });
  assert.equal(disabled.status, 200);
  assert.equal((await db.query('SELECT id FROM "session" WHERE "userId"=$1', [created.body.id])).length, 0);
  assert.equal((await request(app).get('/api/bootstrap').set('Cookie', activeCookie)).status, 401);
  const blockedLogin = await request(app).post('/api/auth/sign-in/username').set('Origin', origin).send({ username: 'leitura-teste', password: password + '2' });
  assert.equal(blockedLogin.status, 403);
});

test('CSV formula neutralization, audit and no public access after logout',async()=>{
  await admin('post','/api/employees').send({...employee,name:'=HYPERLINK("example")'});
  const exported=await admin('get','/api/export/employees');assert.equal(exported.status,200);assert.match(exported.text,/"'=HYPERLINK/);
  const audit=await admin('get','/api/audit');assert.equal(audit.status,200);assert.ok(audit.body.total>=10);
  const logout=await admin('post','/api/auth/sign-out').send({});assert.equal(logout.status,200);
  assert.equal((await admin('get','/api/bootstrap')).status,401);
  assert.equal((await admin('get','/api/export/employees')).status,401);
});
test('database adapters preserve calendar dates, safe large totals and readiness',async()=>{
  const db=await getDb();const rows=await db.query('SELECT $1::date AS date,$2::bigint AS cents',['2026-11-01',3000000000]);
  assert.equal(rows[0].date,'2026-11-01');assert.equal(rows[0].cents,3000000000);
  const {settingsSchema}=await import('../server/validation.js');const config=(await db.query('SELECT data FROM settings WHERE id=1'))[0].data;
  assert.equal(settingsSchema.safeParse({...config,transportDiscountPercent:4.12001}).success,false);
  assert.equal((await request(app).get('/api/health')).status,200);
  await db.query('DELETE FROM settings WHERE id=1');
  try { assert.equal((await request(app).get('/api/health')).status,503); }
  finally { await db.query('INSERT INTO settings(id,data,version) VALUES(1,$1::jsonb,$2)',[JSON.stringify(config),config.version]); }
});

test('schema v3 preserves closed and reopened payrolls when upgrading an existing v2 database', async () => {
  const db = await getDb();
  const revisions = () => db.query("SELECT id,status,revision,snapshot FROM payrolls WHERE month='2026-11' ORDER BY revision");
  const before = await revisions();
  assert.equal(before.length, 2);
  await db.transaction(async tx => {
    await tx.query('ALTER TABLE payrolls DROP COLUMN revision');
    await tx.query('DELETE FROM schema_migrations WHERE version=3');
  });
  assert.equal((await request(app).get('/api/health')).status, 503);
  await migrate();
  await migrate();
  assert.deepEqual(await revisions(), before);
  assert.equal((await request(app).get('/api/health')).status, 200);
});

test('incorrect credentials are rejected and the database rate limit persists across requests', async () => {
  const db = await getDb();
  await db.query('DELETE FROM "rateLimit"');
  for (let attempt = 0; attempt < 8; attempt++) {
    const invalid = await request(app).post('/api/auth/sign-in/username').set('Origin', origin)
      .send({ username: 'dp', password: 'wrong-password' });
    assert.equal(invalid.status, 401);
  }
  const blocked = await request(app).post('/api/auth/sign-in/username').set('Origin', origin).send({ username: 'dp', password });
  assert.equal(blocked.status, 429);
  const limit = await db.query('SELECT count FROM "rateLimit"');
  assert.ok(limit.some(row => row.count >= 8));
});

test('authentication and persisted payroll remain available after reopening the database', async () => {
  await (await getDb()).query('DELETE FROM "rateLimit"');
  await closeDb();

  const login = await request(app).post('/api/auth/sign-in/username').set('Origin', origin)
    .send({ username: 'dp', password });
  assert.equal(login.status, 200);
  const cookies = [login.headers['set-cookie']].flat().filter(Boolean);
  const payroll = await request(app).get('/api/payroll?month=2026-11').set('Cookie', cookies);
  assert.equal(payroll.status, 200);
  assert.ok(payroll.body.payroll?.snapshot);
});
