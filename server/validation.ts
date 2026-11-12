import { z } from 'zod';

export class HttpError extends Error { constructor(public status: number, message: string, public code = 'REQUEST_FAILED') { super(message); } }
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value && value >= '1900-01-01' && value <= '2199-12-31';
}, 'Data inválida.');
export const monthSchema = z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/, 'Competência inválida.');
export const versionSchema = z.number().int().positive();
const money = z.number().int().min(0).max(1_000_000_000);
export const employeeSchema = z.object({
  name: z.string().trim().min(2).max(150), jobTitle: z.string().trim().min(2).max(100), department: z.string().trim().min(2).max(100),
  admissionDate: dateSchema, terminationDate: dateSchema.nullable(), salaryCents: money,
  usesTransport: z.boolean(), transportDailyCents: money.max(100_000), status: z.enum(['active','inactive']), version: versionSchema.optional(),
}).strict().refine(v => !v.terminationDate || v.terminationDate >= v.admissionDate, 'Desligamento anterior à admissão.').refine(v => v.status !== 'inactive' || !!v.terminationDate, 'Informe a data de desligamento ao inativar.');
export const absenceSchema = z.object({ employeeId: z.string().min(1).max(100), date: dateSchema, reason: z.string().trim().max(500), discountBenefits: z.boolean() }).strict();
export const reasonSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export const payrollInputSchema = z.object({ month: monthSchema, foodBusinessDays: z.number().int().min(0).max(31).optional(), transportBusinessDays: z.number().int().min(0).max(31).optional(), expectedSourceVersion: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export const settingsSchema = z.object({
  companyName: z.string().trim().min(2).max(100), foodDailyCents: money.max(100_000), foodPaymentMethod: z.string().trim().min(2).max(100),
  salaryPayDay: z.number().int().min(1).max(31), transportPayDay: z.number().int().min(1).max(31), transportStartDay: z.number().int().min(1).max(28),
  absenceClosingDay: z.number().int().min(1).max(31), transportDiscountPercent: z.number().min(0).max(100).refine(n => Math.round(n * 100) / 100 === n, 'Use no máximo duas casas decimais.'),
  holidays: z.array(dateSchema).max(400).refine(v => new Set(v).size === v.length, 'Feriados duplicados.'), version: versionSchema,
}).strict();
export const usernameSchema = z.string().trim().regex(/^[a-zA-Z0-9_.-]{2,50}$/);
export const userSchema = z.object({ username: usernameSchema, name: z.string().trim().min(2).max(100), password: z.string().min(12).max(128), role: z.enum(['dp','financeiro','diretoria']) }).strict();
export const userUpdateSchema = z.object({ name: z.string().trim().min(2).max(100), role: z.enum(['dp','financeiro','diretoria']), active: z.boolean() }).strict();
export function pagination(query: Record<string, unknown>) {
  const page = z.coerce.number().int().min(1).max(1_000_000).default(1).parse(query.page);
  const pageSize = z.coerce.number().int().min(1).max(100).default(20).parse(query.pageSize);
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export function monthNow() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date()).replace('/', '-'); }
export function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function shiftMonth(month: string, offset: number) { const [year, m] = month.split('-').map(Number); return new Date(Date.UTC(year, m - 1 + offset, 1)).toISOString().slice(0, 7); }
export function csvCell(value: unknown) { let str = String(value ?? ''); if (/^[\s\u0000-\u001f]*[=+@-]/.test(str)) str = `'${str}`; return `"${str.replaceAll('"', '""')}"`; }
export function csv(rows: unknown[][]) { return '\ufeff' + rows.map(row => row.map(csvCell).join(';')).join('\r\n'); }
