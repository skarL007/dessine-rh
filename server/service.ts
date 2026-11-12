import { randomUUID, createHash } from 'node:crypto';
import { getDb, type Queryable } from './db.js';
import { HttpError } from './validation.js';
import { calculatePayroll } from '../shared/payroll.js';
import { PayrollValidationError } from '../shared/date.js';
import type { Employee, Absence, Settings, PayrollCalculation, User, PayrollSnapshot } from '../shared/types.js';

export async function settingsOf(db: Queryable): Promise<Settings> {
  const rows = await db.query('SELECT data,version FROM settings WHERE id=1');
  if (!rows[0]) throw new HttpError(503, 'A configuração inicial ainda não foi concluída.', 'SETUP_REQUIRED');
  return { ...rows[0].data, version: rows[0].version };
}
export async function audit(db: Queryable, user: User, action: string, entityType: string, entityId: string, summary: string) {
  await db.query('INSERT INTO audit(id,"actorName","actorId",action,"entityType","entityId",summary) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), user.name, user.id, action, entityType, entityId, summary]);
}
export async function writeTransaction<T>(fn: (db: Queryable) => Promise<T>) {
  return (await getDb()).transaction(async db => {
    // The settings row serializes business writes against payroll closure. Reads remain concurrent.
    const [settings] = await db.query('SELECT id FROM settings WHERE id=1 FOR UPDATE');
    if (!settings) throw new HttpError(503, 'A configuração inicial ainda não foi concluída.', 'SETUP_REQUIRED');
    return fn(db);
  });
}
export async function calculate(db: Queryable, input: PayrollCalculation): Promise<PayrollSnapshot> {
  const settings = await settingsOf(db);
  try {
    const draft = calculatePayroll([], [], settings, input);
    const { start, end } = draft.periods.absences;
    const employees = await db.query<Employee>('SELECT * FROM employees ORDER BY lower(name),id');
    const absences = await db.query<Absence>('SELECT a.*,e.name AS "employeeName" FROM absences a JOIN employees e ON e.id=a."employeeId" WHERE a."voidedAt" IS NULL AND a.date BETWEEN $1 AND $2', [start,end]);
    const snapshot = calculatePayroll(employees, absences, settings, input);
    const { generatedAt: _time, sourceVersion: _version, ...canonical } = snapshot;
    return { ...snapshot, sourceVersion: createHash('sha256').update(JSON.stringify(canonical)).digest('hex') };
  } catch (error) {
    if (error instanceof PayrollValidationError) throw new HttpError(422,error.message,'CALCULATION_INVALID');
    throw error;
  }
}
export async function assertAbsenceOpen(db: Queryable, date: string) {
  const locked = await db.query(`SELECT id FROM payrolls WHERE status='closed' AND (snapshot->'periods'->'absences'->>'start')::date <= $1::date AND (snapshot->'periods'->'absences'->>'end')::date >= $1::date LIMIT 1`, [date]);
  if (locked.length) throw new HttpError(409, 'A falta pertence a uma folha fechada. Reabra a competência antes de alterar.', 'PAYROLL_CLOSED');
}
