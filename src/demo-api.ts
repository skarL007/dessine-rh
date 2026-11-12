import fixtures from './demo-fixtures.json';
import { calculatePayroll } from '../shared/payroll';
import type { Absence, Employee, Payroll, PayrollCalculation, Settings } from '../shared/types';

const employees = fixtures.employees as Employee[];
const absences = fixtures.absences as Absence[];
const payrolls = fixtures.payrolls as (Payroll & { revision: number })[];
const { audit, payments } = fixtures;
const settings = fixtures.settings as Settings;

function paginate<T>(items: T[], query: URLSearchParams) {
  const page = Math.max(1, Number(query.get('page')) || 1);
  const pageSize = Number(query.get('pageSize')) || 10;
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const shift = (month: string, offset: number) => {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
};

export function demoResponse(path: string, options: RequestInit): Response {
  const { pathname, searchParams: query } = new URL(path, location.origin);
  const month = query.get('month') || new Date().toISOString().slice(0, 7);
  const method = options.method ?? 'GET';
  if (pathname === '/api/payroll/calculate' && method === 'POST') {
    try {
      const input = JSON.parse(String(options.body)) as PayrollCalculation;
      return json(calculatePayroll(employees, absences, settings, input));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Prévia indisponível.' }, 422);
    }
  }
  if (method !== 'GET') return json({ error: 'A demonstração é somente para consulta.' }, 403);

  if (pathname === '/api/bootstrap') return json({
    user: { id: 'demo', name: 'Visitante', username: 'demo', role: 'diretoria', active: true },
    settings, mode: 'local', version: 'demo',
  });
  if (pathname === '/api/settings') return json(settings);
  if (pathname === '/api/audit') return json(paginate(audit, query));
  if (pathname === '/api/employees') {
    const term = (query.get('q') || '').toLocaleLowerCase('pt-BR');
    const status = query.get('status');
    return json(paginate(employees.filter(employee =>
      (!status || status === 'all' || employee.status === status) &&
      [employee.name, employee.jobTitle, employee.department].join(' ').toLocaleLowerCase('pt-BR').includes(term)
    ), query));
  }
  if (pathname === '/api/absences') return json(paginate(absences.filter(row => row.date.startsWith(month)), query));
  const monthPayments = payments.filter(row => row.month === month);
  if (pathname === '/api/payments') {
    const status = query.get('status');
    return json(paginate(monthPayments.filter(row => !status || status === 'all' || row.status === status), query));
  }
  const payroll = payrolls.find(row => row.month === month) ?? null;
  if (pathname === '/api/payroll') return json({ payroll });
  const versionPath = /^\/api\/payroll\/(\d{4}-\d{2})\/versions(?:\/(\d+))?$/.exec(pathname);
  if (versionPath) {
    const versions = payrolls.filter(row => row.month === versionPath[1]);
    if (!versionPath[2]) return json({ versions: versions.map(({ snapshot: _snapshot, ...metadata }) => metadata) });
    const version = versions.find(row => row.revision === Number(versionPath[2]));
    return version ? json({ payroll: version }) : json({ error: 'Versão indisponível.' }, 404);
  }
  if (pathname === '/api/overview') {
    const totals = (payroll?.snapshot ?? calculatePayroll(employees, absences, settings, { month })).totals;
    const active = employees.filter(row => row.status === 'active');
    const counts = new Map<string, number>();
    for (const employee of active) counts.set(employee.department, (counts.get(employee.department) ?? 0) + 1);
    const pending = monthPayments.filter(row => row.status === 'pending');
    const sum = (rows: typeof payments) => rows.reduce((total, row) => total + row.amountCents, 0);
    return json({
      month, activeEmployees: active.length, inactiveEmployees: employees.length - active.length,
      salaryBaseCents: totals.salaryCents, foodCents: totals.foodCents, transportCents: totals.transportCents,
      totalCents: totals.totalCents, pendingCents: sum(pending), paidCents: sum(monthPayments.filter(row => row.status === 'paid')),
      overdueCents: sum(pending.filter(row => row.dueDate < new Date().toISOString().slice(0, 10))),
      absences: totals.absenceCount, payrollStatus: payroll ? 'closed' : 'open', upcomingPayments: pending,
      recentActivity: audit,
      departments: Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      monthlyHistory: Array.from({ length: 6 }, (_, i) => shift(month, i - 5)).map(value => {
        const closed = payrolls.find(row => row.month === value);
        const amounts = closed?.snapshot.totals;
        return { month: value, salaryCents: amounts?.salaryCents ?? 0, foodCents: amounts?.foodCents ?? 0, transportCents: amounts?.transportCents ?? 0, closed: Boolean(closed) };
      }),
    });
  }
  return json({ error: 'Recurso indisponível na demonstração.' }, 404);
}
