import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { ZodError, z } from 'zod';
import { fromNodeHeaders } from 'better-auth/node';
import { getDb, SCHEMA_VERSION, type Queryable } from './db.js';
import { getAuth, publicUser, createAppUser } from './auth.js';
import { audit, assertAbsenceOpen, calculate, settingsOf, writeTransaction } from './service.js';
import { HttpError, employeeSchema, absenceSchema, reasonSchema, payrollInputSchema, settingsSchema, userSchema, userUpdateSchema, pagination, monthSchema, versionSchema, monthNow, today, shiftMonth, csv } from './validation.js';
import { paymentSchedule } from '../shared/payroll.js';
import type { User, Employee, Payment, Payroll, PayrollSnapshot, Overview, AuditEvent } from '../shared/types.js';

export const APP_VERSION = '1.0.0';
const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: process.env.VERCEL ? [] : null } }, crossOriginEmbedderPolicy: false }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, private'); res.set('Pragma', 'no-cache');
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const expected = process.env.BETTER_AUTH_URL;
  if (!expected) return next(new HttpError(503, 'Ambiente ainda não configurado.', 'SETUP_REQUIRED'));
  if (req.get('origin') !== new URL(expected).origin || req.get('sec-fetch-site') === 'cross-site') return next(new HttpError(403, 'Origem da solicitação não autorizada.', 'INVALID_ORIGIN'));
  if (!req.is('application/json')) return next(new HttpError(415, 'Envie os dados em JSON.', 'JSON_REQUIRED'));
  if (Number(req.get('content-length') || 0) > 100_000) return next(new HttpError(413, 'Solicitação muito grande.'));
  next();
});

app.get('/api/health', async (_req, res) => {
  try { const db = await getDb(); await getAuth(); await settingsOf(db); const version=await db.query('SELECT max(version)::int AS version FROM schema_migrations'); if(version[0]?.version!==SCHEMA_VERSION)throw new Error('SCHEMA_MIGRATION_REQUIRED'); res.json({ status: 'ok', version: APP_VERSION }); }
  catch { res.status(503).json({ status: 'not_ready', version: APP_VERSION }); }
});

const authPaths = new Set(['/sign-in/username','/sign-out','/get-session','/change-password','/ok']);
app.all('/api/auth/*splat', express.raw({ type: 'application/json', limit: '100kb' }), async (req, res, next) => {
  try {
    const path = req.path.replace('/api/auth','').replace(/\/$/, '');
    if (!authPaths.has(path) || (['/get-session','/ok'].includes(path) ? req.method !== 'GET' : req.method !== 'POST')) return res.status(404).json({ error: 'Rota não encontrada.' });
    const auth = await getAuth();
    const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
    const url = new URL(`/api/auth${path}`, origin);
    url.search = new URL(req.originalUrl, origin).search;
    const headers = fromNodeHeaders(req.headers);
    const clientIp = process.env.VERCEL ? req.get('x-vercel-forwarded-for') : req.socket.remoteAddress;
    headers.set('x-dessine-client-ip', clientIp ?? '');
    const body = req.method === 'POST' && Buffer.isBuffer(req.body) ? Uint8Array.from(req.body) : undefined;
    const response = await auth.handler(new Request(url, { method: req.method, headers, body }));
    for (const [name,value] of response.headers) {
      if (name !== 'set-cookie' && name !== 'cache-control') res.set(name,value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.set('Set-Cookie',cookies);
    return res.status(response.status).send(await response.text());
  } catch(error) { next(error); }
});
app.use(express.json({ limit: '100kb' }));
app.use('/api', async (req, res, next) => {
  try {
    const auth = await getAuth(); const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new HttpError(401, 'Entre na sua conta para continuar.', 'UNAUTHENTICATED');
    const rows = await (await getDb()).query('SELECT * FROM "user" WHERE id=$1', [session.user.id]);
    const user = rows[0];
    if (!user || user.banned) throw new HttpError(401, 'Seu acesso foi desativado.', 'ACCOUNT_DISABLED');
    res.locals.user = publicUser(user);
    res.locals.sessionId = session.session.id;
    if (!['GET','HEAD'].includes(req.method) && req.path !== '/payroll/calculate' && user.appRole !== 'dp') throw new HttpError(403, 'Seu perfil permite apenas consulta.', 'READ_ONLY');
    next();
  } catch(error) { next(error); }
});

const actor = (res: Response): User => res.locals.user;
const onlyDp = (res: Response) => { if (actor(res).role !== 'dp') throw new HttpError(403, 'Acesso restrito ao Departamento Pessoal.', 'FORBIDDEN'); };
const idOf = (req: Request): string => z.string().min(1).max(100).parse(req.params.id);
const route = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => { try { await fn(req,res); } catch(error) { next(error); } };

function authorizedWrite<T>(res: Response, fn: (db: Queryable, currentActor: User) => Promise<T>) {
  const userId = actor(res).id;
  const sessionId: string = res.locals.sessionId;
  return writeTransaction(async db => {
    // Read permissions after waiting for the same lock used by account changes.
    const [user] = await db.query('SELECT id,name,username,"appRole",banned FROM "user" WHERE id=$1', [userId]);
    if (!user || user.banned) throw new HttpError(401, 'Seu acesso foi desativado.', 'ACCOUNT_DISABLED');
    if (user.appRole !== 'dp') throw new HttpError(403, 'Seu perfil permite apenas consulta.', 'READ_ONLY');
    const [session] = await db.query(
      'SELECT id FROM "session" WHERE id=$1 AND "userId"=$2 AND "expiresAt">clock_timestamp() FOR KEY SHARE',
      [sessionId,userId],
    );
    if (!session) throw new HttpError(401, 'Entre na sua conta para continuar.', 'UNAUTHENTICATED');
    return fn(db,publicUser(user));
  });
}

app.get('/api/bootstrap', route(async (_req,res) => { const db = await getDb(); res.json({ user: actor(res), settings: await settingsOf(db), mode: db.mode, version: APP_VERSION }); }));
app.get('/api/settings', route(async (_req,res) => { res.json(await settingsOf(await getDb())); }));
app.put('/api/settings', route(async (req,res) => {
  const input = settingsSchema.parse(req.body);
  const result = await authorizedWrite(res, async (db,currentActor) => {
    const value = { ...input, version: input.version+1 };
    const rows = await db.query('UPDATE settings SET data=$1::jsonb,version=version+1 WHERE id=1 AND version=$2 RETURNING data', [JSON.stringify(value),input.version]);
    if (!rows.length) throw new HttpError(409, 'As configurações foram alteradas em outro acesso. Atualize a página.', 'VERSION_CONFLICT');
    await audit(db,currentActor,'settings.updated','settings','1','Regras de benefícios atualizadas; folhas fechadas preservadas.');
    return value;
  }); res.json(result);
}));

app.get('/api/employees', route(async(req,res) => {
  const page = pagination(req.query); const q = z.string().max(100).default('').parse(req.query.q).trim();
  const status = z.enum(['all','active','inactive']).default('all').parse(req.query.status);
  const pattern = `%${q.replace(/[\\%_]/g,'\\$&')}%`;
  const db = await getDb();
  const condition = `($1='all' OR status=$1) AND (name ILIKE $2 OR "jobTitle" ILIKE $2 OR department ILIKE $2)`;
  const [items,total] = await Promise.all([db.query<Employee>(`SELECT * FROM employees WHERE ${condition} ORDER BY lower(name),id LIMIT $3 OFFSET $4`, [status,pattern,page.pageSize,page.offset]), db.query(`SELECT count(*)::int AS total FROM employees WHERE ${condition}`, [status,pattern])]);
  res.json({ items,total:total[0].total,page:page.page,pageSize:page.pageSize });
}));
app.post('/api/employees', route(async(req,res) => {
  const input=employeeSchema.parse(req.body); const id=randomUUID();
  const result=await authorizedWrite(res, async (db,currentActor) => {
    const rows=await db.query<Employee>('INSERT INTO employees(id,name,"jobTitle",department,"admissionDate","terminationDate","salaryCents","usesTransport","transportDailyCents",status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [id,input.name,input.jobTitle,input.department,input.admissionDate,input.terminationDate,input.salaryCents,input.usesTransport,input.transportDailyCents,input.status]);
    await audit(db,currentActor,'employee.created','employee',id,'Colaborador cadastrado.'); return rows[0];
  }); res.status(201).json(result);
}));
app.patch('/api/employees/:id', route(async(req,res) => {
  const input=employeeSchema.parse(req.body); const version=versionSchema.parse(input.version); const id=idOf(req);
  const result=await authorizedWrite(res, async (db,currentActor) => {
    const rows=await db.query<Employee>('UPDATE employees SET name=$1,"jobTitle"=$2,department=$3,"admissionDate"=$4,"terminationDate"=$5,"salaryCents"=$6,"usesTransport"=$7,"transportDailyCents"=$8,status=$9,version=version+1,"updatedAt"=now() WHERE id=$10 AND version=$11 RETURNING *', [input.name,input.jobTitle,input.department,input.admissionDate,input.terminationDate,input.salaryCents,input.usesTransport,input.transportDailyCents,input.status,id,version]);
    if (!rows.length) throw new HttpError(409,'O cadastro foi alterado em outro acesso. Atualize antes de salvar.','VERSION_CONFLICT');
    await audit(db,currentActor,'employee.updated','employee',id,'Cadastro do colaborador atualizado.'); return rows[0];
  }); res.json(result);
}));

app.get('/api/absences', route(async(req,res) => {
  const month=monthSchema.parse(req.query.month||monthNow()); const p=pagination(req.query); const db=await getDb();
  const start=`${month}-01`, end=`${shiftMonth(month,1)}-01`;
  const [items,total]=await Promise.all([db.query('SELECT a.id,a."employeeId",e.name AS "employeeName",a.date,a.reason,a."discountBenefits",a."createdBy",a."createdAt" FROM absences a JOIN employees e ON e.id=a."employeeId" WHERE a."voidedAt" IS NULL AND a.date >= $1 AND a.date < $2 ORDER BY a.date DESC,a.id LIMIT $3 OFFSET $4',[start,end,p.pageSize,p.offset]),db.query('SELECT count(*)::int AS total FROM absences WHERE "voidedAt" IS NULL AND date >= $1 AND date < $2',[start,end])]);
  res.json({items,total:total[0].total,page:p.page,pageSize:p.pageSize});
}));
app.post('/api/absences', route(async(req,res) => {
  const input=absenceSchema.parse(req.body); const id=randomUUID();
  const result=await authorizedWrite(res, async (db,currentActor) => {
    await assertAbsenceOpen(db,input.date);
    const employee=(await db.query<Employee>('SELECT * FROM employees WHERE id=$1',[input.employeeId]))[0];
    if (!employee) throw new HttpError(404,'Colaborador não encontrado.');
    if (input.date<employee.admissionDate || (employee.terminationDate && input.date>employee.terminationDate)) throw new HttpError(422,'A data está fora do período de vínculo do colaborador.');
    const rows=await db.query('INSERT INTO absences(id,"employeeId",date,reason,"discountBenefits","createdBy") VALUES($1,$2,$3,$4,$5,$6) RETURNING id,"employeeId",date,reason,"discountBenefits","createdBy","createdAt"',[id,input.employeeId,input.date,input.reason,input.discountBenefits,currentActor.name]);
    await audit(db,currentActor,'absence.created','absence',id,'Falta registrada.'); return {...rows[0],employeeName:employee.name};
  });res.status(201).json(result);
}));
app.delete('/api/absences/:id',route(async(req,res) => {
  const {reason}=reasonSchema.parse(req.body);const id=idOf(req);
  await authorizedWrite(res, async (db,currentActor)=>{
    const record=(await db.query('SELECT date FROM absences WHERE id=$1 AND "voidedAt" IS NULL',[id]))[0];
    if(!record)throw new HttpError(404,'Falta não encontrada.');await assertAbsenceOpen(db,record.date);
    await db.query('UPDATE absences SET "voidedAt"=now(),"voidReason"=$1 WHERE id=$2',[reason,id]);
    await audit(db,currentActor,'absence.voided','absence',id,`Lançamento de falta anulado: ${reason}`);
  });res.json({ok:true});
}));

app.get('/api/payroll',route(async(req,res)=>{
  const month=monthSchema.parse(req.query.month||monthNow());
  const rows=await(await getDb()).query<Payroll>("SELECT * FROM payrolls WHERE month=$1 ORDER BY (status='closed') DESC, revision DESC LIMIT 1",[month]);res.json({payroll:rows[0]||null});
}));
type PayrollRevision = Payroll & { revision: number };
app.get('/api/payroll/:month/versions',route(async(req,res)=>{
  const month=monthSchema.parse(req.params.month);
  const versions=await (await getDb()).query<Omit<PayrollRevision,'snapshot'>>(
    'SELECT id,month,status,"closedAt","closedBy",version,revision FROM payrolls WHERE month=$1 ORDER BY revision DESC',
    [month],
  );
  res.json({versions});
}));
app.get('/api/payroll/:month/versions/:revision',route(async(req,res)=>{
  const month=monthSchema.parse(req.params.month);
  const revision=z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(2_147_483_647)).parse(req.params.revision);
  const [payroll]=await (await getDb()).query<PayrollRevision>('SELECT * FROM payrolls WHERE month=$1 AND revision=$2',[month,revision]);
  if (!payroll) throw new HttpError(404,'Versão da folha não encontrada.');
  res.json({payroll});
}));
app.post('/api/payroll/calculate',route(async(req,res)=>{const input=payrollInputSchema.parse(req.body);res.json(await calculate(await getDb(),input));}));
app.post('/api/payroll/close',route(async(req,res)=>{
  const input=payrollInputSchema.parse(req.body);const id=randomUUID();
  if(!input.expectedSourceVersion)throw new HttpError(400,'Calcule e confira a folha antes de fechar.','PREVIEW_REQUIRED');
  const result=await authorizedWrite(res, async (db,currentActor)=>{
    if((await db.query("SELECT id FROM payrolls WHERE month=$1 AND status='closed'",[input.month])).length)throw new HttpError(409,'Esta competência já está fechada.','PAYROLL_CLOSED');
    const snapshot=await calculate(db,input);
    if(snapshot.sourceVersion!==input.expectedSourceVersion)throw new HttpError(409,'Os dados mudaram após a conferência. Recalcule a folha antes de fechar.','STALE_PREVIEW');
    if(snapshot.items.length===0)throw new HttpError(422,'Cadastre pelo menos um colaborador elegível antes de fechar a folha.');
    const rows=await db.query<PayrollRevision>(`INSERT INTO payrolls(id,month,status,"closedBy",snapshot,revision)
      VALUES($1,$2,'closed',$3,$4::jsonb,(SELECT coalesce(max(revision),0)+1 FROM payrolls WHERE month=$2)) RETURNING *`,
      [id,input.month,currentActor.name,JSON.stringify(snapshot)]);
    for(const payment of paymentSchedule(snapshot))await db.query('INSERT INTO payments(id,"payrollId",month,kind,description,"amountCents","dueDate") VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),id,input.month,payment.kind,payment.description,payment.amountCents,payment.dueDate]);
    await audit(db,currentActor,'payroll.closed','payroll',id,`Competência ${input.month} fechada e pagamentos programados.`);return rows[0];
  });res.status(201).json(result);
}));
app.post('/api/payroll/:id/reopen',route(async(req,res)=>{
  const {reason,version}=z.object({reason:z.string().trim().min(5).max(500),version:versionSchema}).strict().parse(req.body);const id=idOf(req);
  await authorizedWrite(res, async (db,currentActor)=>{
    const payroll=(await db.query<Payroll>('SELECT * FROM payrolls WHERE id=$1',[id]))[0];
    if(!payroll)throw new HttpError(404,'Folha não encontrada.');
    if(payroll.status!=='closed'||payroll.version!==version)throw new HttpError(409,'Esta folha já foi alterada. Atualize a página.','VERSION_CONFLICT');
    if((await db.query("SELECT id FROM payments WHERE \"payrollId\"=$1 AND status='paid' LIMIT 1",[id])).length)throw new HttpError(409,'Há pagamentos confirmados. Reverta os registros antes de reabrir.','PAYMENTS_CONFIRMED');
    await db.query("UPDATE payrolls SET status='reopened',version=version+1 WHERE id=$1",[id]);
    await db.query("UPDATE payments SET status='void',version=version+1,note=$2 WHERE \"payrollId\"=$1 AND status='pending'",[id,reason]);
    await audit(db,currentActor,'payroll.reopened','payroll',id,`Competência ${payroll.month} reaberta: ${reason}`);
  });res.json({ok:true});
}));

app.get('/api/payments',route(async(req,res)=>{
  const month=monthSchema.parse(req.query.month||monthNow());const status=z.enum(['all','pending','paid']).default('all').parse(req.query.status);const p=pagination(req.query);const db=await getDb();
  const condition="month=$1 AND status<>'void' AND ($2='all' OR status=$2)";
  const [items,total]=await Promise.all([db.query<Payment>(`SELECT * FROM payments WHERE ${condition} ORDER BY "dueDate",id LIMIT $3 OFFSET $4`,[month,status,p.pageSize,p.offset]),db.query(`SELECT count(*)::int AS total FROM payments WHERE ${condition}`,[month,status])]);res.json({items,total:total[0].total,page:p.page,pageSize:p.pageSize});
}));
app.post('/api/payments/:id/confirm',route(async(req,res)=>{
  const {version,note}=z.object({version:versionSchema,note:z.string().trim().max(500).default('')}).strict().parse(req.body);const id=idOf(req);
  const result=await authorizedWrite(res, async (db,currentActor)=>{
    const rows=await db.query<Payment>("UPDATE payments SET status='paid',\"paidAt\"=now(),\"paidBy\"=$1,note=$2,version=version+1 WHERE id=$3 AND version=$4 AND status='pending' RETURNING *",[currentActor.name,note,id,version]);
    if(!rows.length)throw new HttpError(409,'O pagamento já foi alterado. Atualize a lista.','VERSION_CONFLICT');
    await audit(db,currentActor,'payment.confirmed','payment',id,'Pagamento realizado registrado administrativamente.');return rows[0];
  });res.json(result);
}));
app.post('/api/payments/:id/reverse',route(async(req,res)=>{
  const {version,reason}=z.object({version:versionSchema,reason:z.string().trim().min(5).max(500)}).strict().parse(req.body);const id=idOf(req);
  const result=await authorizedWrite(res, async (db,currentActor)=>{
    const rows=await db.query<Payment>("UPDATE payments SET status='pending',\"paidAt\"=NULL,\"paidBy\"=NULL,note=$1,version=version+1 WHERE id=$2 AND version=$3 AND status='paid' RETURNING *",[reason,id,version]);
    if(!rows.length)throw new HttpError(409,'O pagamento já foi alterado. Atualize a lista.','VERSION_CONFLICT');
    await audit(db,currentActor,'payment.reversed','payment',id,`Confirmação administrativa revertida: ${reason}`);return rows[0];
  });res.json(result);
}));

app.get('/api/audit',route(async(req,res)=>{
  const p=pagination(req.query);const db=await getDb();const [items,total]=await Promise.all([db.query<AuditEvent>('SELECT id,"actorName",action,"entityType","entityId",summary,"createdAt" FROM audit ORDER BY "createdAt" DESC,id DESC LIMIT $1 OFFSET $2',[p.pageSize,p.offset]),db.query('SELECT count(*)::int AS total FROM audit')]);res.json({items,total:total[0].total,page:p.page,pageSize:p.pageSize});
}));
app.get('/api/users',route(async(_req,res)=>{onlyDp(res);const rows=await(await getDb()).query('SELECT * FROM "user" ORDER BY lower(name),id');res.json(rows.map(publicUser));}));
app.post('/api/users',route(async(req,res)=>{
  const input=userSchema.parse(req.body);
  const user=await authorizedWrite(res, async (db,currentActor)=>{
    const created=await createAppUser(input,db);
    await audit(db,currentActor,'user.created','user',created.id,'Conta de acesso criada.');
    return created;
  });
  res.status(201).json(user);
}));
app.patch('/api/users/:id',route(async(req,res)=>{
  const input=userUpdateSchema.parse(req.body);const id=idOf(req);
  const user=await authorizedWrite(res, async (db,currentActor)=>{
    const current=(await db.query('SELECT * FROM "user" WHERE id=$1',[id]))[0];if(!current)throw new HttpError(404,'Usuário não encontrado.');
    if(id===currentActor.id&&(!input.active||input.role!=='dp'))throw new HttpError(409,'Você não pode remover seu próprio acesso ao Departamento Pessoal.');
    if(current.appRole==='dp'&&!current.banned&&(!input.active||input.role!=='dp')){
      const count=await db.query('SELECT count(*)::int AS total FROM "user" WHERE "appRole"=\'dp\' AND banned=false');if(count[0].total<=1)throw new HttpError(409,'Mantenha ao menos um usuário ativo do Departamento Pessoal.');
    }
    const rows=await db.query('UPDATE "user" SET name=$1,"appRole"=$2,role=$3,banned=$4,"updatedAt"=now() WHERE id=$5 RETURNING *',[input.name,input.role,input.role==='dp'?'admin':'user',!input.active,id]);
    await db.query('DELETE FROM "session" WHERE "userId"=$1',[id]);
    await audit(db,currentActor,'user.updated','user',id,'Perfil de acesso atualizado; sessões anteriores revogadas.');return publicUser(rows[0]);
  });res.json(user);
}));

app.get('/api/overview',route(async(req,res)=>{
  const month=monthSchema.parse(req.query.month||monthNow());const db=await getDb();
  const [closed,counts,balances,upcoming,recent,departments,history]=await Promise.all([
    db.query<Payroll>("SELECT * FROM payrolls WHERE month=$1 AND status='closed'",[month]),
    db.query("SELECT count(*) FILTER (WHERE status='active')::int AS active,count(*) FILTER (WHERE status='inactive')::int AS inactive FROM employees"),
    db.query("SELECT coalesce(sum(\"amountCents\") FILTER (WHERE status='pending'),0)::bigint AS pending,coalesce(sum(\"amountCents\") FILTER (WHERE status='paid'),0)::bigint AS paid,coalesce(sum(\"amountCents\") FILTER (WHERE status='pending' AND \"dueDate\"<$2::date),0)::bigint AS overdue FROM payments WHERE month=$1 AND status<>'void'",[month,today()]),
    db.query<Payment>("SELECT * FROM payments WHERE month=$1 AND status='pending' ORDER BY \"dueDate\",id LIMIT 5",[month]),
    db.query<AuditEvent>('SELECT id,"actorName",action,"entityType","entityId",summary,"createdAt" FROM audit ORDER BY "createdAt" DESC,id DESC LIMIT 5'),
    db.query<{name:string;count:number}>("SELECT department AS name,count(*)::int AS count FROM employees WHERE status='active' GROUP BY department ORDER BY count(*) DESC,department"),
    db.query<{month: string; totals: PayrollSnapshot['totals']}>("SELECT month, snapshot->'totals' AS totals FROM payrolls WHERE status='closed' AND month BETWEEN $1 AND $2 ORDER BY month",[shiftMonth(month,-5),month]),
  ]);
  const snapshot=closed[0]?.snapshot||await calculate(db,{month});
  const result:Overview={month,activeEmployees:counts[0].active,inactiveEmployees:counts[0].inactive,salaryBaseCents:snapshot.totals.salaryCents,foodCents:snapshot.totals.foodCents,transportCents:snapshot.totals.transportCents,totalCents:snapshot.totals.totalCents,pendingCents:Number(balances[0].pending),paidCents:Number(balances[0].paid),overdueCents:Number(balances[0].overdue),absences:snapshot.totals.absenceCount,payrollStatus:closed.length?'closed':'open',upcomingPayments:upcoming,recentActivity:recent,departments,monthlyHistory:Array.from({length:6},(_,i)=>{const key=shiftMonth(month,i-5);const found=history.find(h=>h.month===key);return {month:key,salaryCents:found?.totals.salaryCents||0,foodCents:found?.totals.foodCents||0,transportCents:found?.totals.transportCents||0,closed:!!found};})};res.json(result);
}));

app.get('/api/export/employees',route(async(_req,res)=>{
  const rows=await(await getDb()).query<Employee>('SELECT * FROM employees ORDER BY lower(name),id');
  res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="colaboradores.csv"'}).send(csv([['Nome','Cargo','Departamento','Admissão','Desligamento','Salário base (R$)','VT diário (R$)','Situação'],...rows.map(e=>[e.name,e.jobTitle,e.department,e.admissionDate,e.terminationDate,(e.salaryCents/100).toFixed(2).replace('.',','),(e.transportDailyCents/100).toFixed(2).replace('.',','),e.status==='active'?'Ativo':'Inativo'])]));
}));
app.get('/api/export/payroll',route(async(req,res)=>{
  const month=monthSchema.parse(req.query.month);const payroll=(await(await getDb()).query<Payroll>("SELECT * FROM payrolls WHERE month=$1 AND status='closed'",[month]))[0];
  if(!payroll)throw new HttpError(404,'Feche a competência antes de exportar o histórico oficial.');
  const money=(n:number)=>(n/100).toFixed(2).replace('.',',');
  res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="folha-${month}.csv"`}).send(csv([['Competência','Nome','Cargo','Salário base (R$)','Faltas','Dias VA','VA (R$)','Dias VT','VT (R$)','Desconto benefícios (R$)','Desconto VT em folha (R$)'],...payroll.snapshot.items.map(e=>[month,e.name,e.jobTitle,money(e.salaryCents),e.absenceCount,e.foodDays,money(e.foodCents),e.transportDays,money(e.transportCents),money(e.discountCents),money(e.transportPayrollDeductionCents)])]));
}));

app.use('/api',(_req,res)=>res.status(404).json({error:'Rota não encontrada.'}));
app.use((error:any,_req:Request,res:Response,_next:NextFunction)=>{
  if(error instanceof ZodError)return res.status(400).json({error:'Confira os campos informados.',code:'VALIDATION_ERROR',details:error.issues.map(i=>({field:i.path.join('.'),message:i.message}))});
  if(error instanceof HttpError)return res.status(error.status).json({error:error.message,code:error.code});
  if(error?.code==='23505')return res.status(409).json({error:'Este registro já existe. Atualize a página para conferir.',code:'DUPLICATE_RECORD'});
  if(error?.type==='entity.too.large')return res.status(413).json({error:'Solicitação muito grande.'});
  if(error instanceof SyntaxError)return res.status(400).json({error:'JSON inválido.'});
  if(['DATABASE_CONFIGURATION_REQUIRED','AUTH_CONFIGURATION_REQUIRED','HTTPS_REQUIRED'].includes(error?.message))return res.status(503).json({error:'Ambiente ainda não configurado. Contate o responsável pela implantação.',code:'SETUP_REQUIRED'});
  if(error?.statusCode&&error.statusCode>=400&&error.statusCode<500)return res.status(error.statusCode).json({error:'Não foi possível concluir a operação de acesso. Confira os dados.',code:'AUTH_ERROR'});
  console.error('request_failed', {type:error?.name||'Error',code:error?.code||'unknown'});
  return res.status(500).json({error:'Não foi possível concluir a operação. Tente novamente.',code:'INTERNAL_ERROR'});
});
export default app;
