import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { getDb, migrate, closeDb } from '../server/db.js';
import { createAppUser } from '../server/auth.js';
import { calculate, settingsOf } from '../server/service.js';
import { monthNow, shiftMonth } from '../server/validation.js';
import { calculatePayroll, paymentSchedule } from '../shared/payroll.js';
import type { Employee } from '../shared/types.js';

if(process.env.VERCEL || process.env.DATABASE_URL || process.env.APP_ENV!=='local')throw new Error('Seed is restricted to an isolated local database.');
if(!process.env.SEED_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD.length<12)throw new Error('Set SEED_ADMIN_PASSWORD with at least 12 characters for the local validation account.');
try {
  await migrate();const db=await getDb();
  if(!(await db.query('SELECT id FROM "user" WHERE username=$1',['dp'])).length)await createAppUser({username:'dp',name:'Departamento Pessoal',password:process.env.SEED_ADMIN_PASSWORD,role:'dp'});
  if((await db.query('SELECT id FROM employees LIMIT 1')).length){console.log('Local fixtures already exist; no rows changed.');}
  else {
    const fixtures=[
      ['Camila Andrade','Coordenadora de operações','Operações',620000,1400,'2023-02-01'],
      ['Lucas Monteiro','Analista administrativo','Administrativo',380000,1200,'2024-04-15'],
      ['Beatriz Costa','Designer de produto','Criação',540000,1100,'2023-08-07'],
      ['Gabriel Nunes','Assistente de atendimento','Atendimento',280000,1200,'2025-03-10'],
      ['Marina Duarte','Analista financeiro','Financeiro',460000,1400,'2024-09-02'],
      ['Rafael Tavares','Desenvolvedor','Tecnologia',690000,0,'2025-01-13'],
      ['Juliana Reis','Analista de pessoas','Administrativo',420000,1200,'2024-06-03'],
      ['Pedro Martins','Assistente de operações','Operações',310000,1400,'2025-07-14'],
      ['Clara Vasconcelos','Diretora de criação','Criação',780000,0,'2023-01-09'],
      ['André Lima','Analista de suporte','Tecnologia',410000,1100,'2025-10-06'],
      ['Sofia Almeida','Especialista de atendimento','Atendimento',360000,1200,'2026-03-02'],
      ['Bruno Farias','Assistente administrativo','Administrativo',295000,1200,'2026-05-04'],
    ];
    for(const [name,job,department,salary,vt,admission] of fixtures)await db.query('INSERT INTO employees(id,name,"jobTitle",department,"admissionDate","salaryCents","usesTransport","transportDailyCents",status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,\'active\')',[randomUUID(),name,job,department,admission,salary,Number(vt)>0,vt]);
    const employees=await db.query<Employee>('SELECT * FROM employees ORDER BY name');const current=monthNow();
    for(let offset=-6;offset<=0;offset++){
      const month=shiftMonth(current,offset);
      const [year,m]=month.split('-').map(Number);const weekday=new Date(Date.UTC(year,m-1,7));
      while([0,6].includes(weekday.getUTCDay()))weekday.setUTCDate(weekday.getUTCDate()+1);
      for(let j=0;j<(offset%3+3)%3+1;j++)await db.query('INSERT INTO absences(id,"employeeId",date,reason,"discountBenefits","createdBy") VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),employees[j].id,weekday.toISOString().slice(0,10),'Exemplo fictício para validação',j!==2,'Ambiente de validação']);
    }
    const settings=await settingsOf(db);
    for(let offset=-5;offset<=0;offset++){
      const month=shiftMonth(current,offset);const id=randomUUID();
      const draft=await calculate(db,{month});
      const historicalEmployees=employees.map(e=>({...e,salaryCents:Math.round(e.salaryCents*(1+offset*0.025))}));
      const absences=await db.query('SELECT a.*,e.name AS "employeeName" FROM absences a JOIN employees e ON e.id=a."employeeId" WHERE a."voidedAt" IS NULL');
      const snapshot=offset===0?draft:calculatePayroll(historicalEmployees,absences as any,settings,{month});
      await db.query('INSERT INTO payrolls(id,month,status,"closedBy",snapshot) VALUES($1,$2,\'closed\',$3,$4::jsonb)',[id,month,'Ambiente de validação',JSON.stringify(snapshot)]);
      for(const p of paymentSchedule(snapshot)){
        const paid=offset<0 || p.kind==='food';
        await db.query('INSERT INTO payments(id,"payrollId",month,kind,description,"amountCents","dueDate",status,"paidAt","paidBy",note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[randomUUID(),id,month,p.kind,p.description,p.amountCents,p.dueDate,paid?'paid':'pending',paid?new Date().toISOString():null,paid?'Ambiente de validação':null,'Dado fictício. Nenhuma transferência financeira.']);
      }
    }
    for(const [i,summary] of ['Base fictícia de colaboradores criada.','Histórico de benefícios gerado para validação.','Competência atual preparada para conferência.'].entries())await db.query('INSERT INTO audit(id,"actorName","actorId",action,"entityType","entityId",summary) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),'Ambiente de validação','local-fixture',`fixture.${i}`,'system','local-fixture',summary]);
    console.log('Local validation fixture created: 12 fictional employees, six monthly snapshots. No real data imported.');
  }
}catch(error){console.error('Local seed failed.',error instanceof Error?error.name:'Error');process.exitCode=1;}
finally{await closeDb();}
