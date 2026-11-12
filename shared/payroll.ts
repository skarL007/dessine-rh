import type { Absence, DateRange, Employee, PayrollCalculation, PayrollSnapshot, Settings } from './types';
import { addDays, businessDays, dayOfMonth, holidaySet, isBusinessDay, isoDate, monthEnd, monthStart, parseDate, parseMonth, PayrollValidationError, range } from './date';

export { PayrollValidationError } from './date';

function integer(value: number, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new PayrollValidationError(`${label} deve ser um número inteiro entre ${minimum} e ${maximum}.`);
  }
  return value;
}

function cents(value: number, label: string): number {
  return integer(value, label);
}

/** Half-up rounding performed with integer arithmetic, including decimal percentages. */
function percentageCents(amount: number, percent: number): number {
  const [coefficient, exponentText = '0'] = String(percent).toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const exponent = Number(exponentText) - fraction.length;
  let numerator = BigInt(whole + fraction);
  let denominator = 100n;
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
  else denominator *= 10n ** BigInt(-exponent);
  return cents(Number((BigInt(amount) * numerator + denominator / 2n) / denominator), 'Desconto em folha');
}

function validateSettings(settings: Settings): Set<string> {
  cents(settings.foodDailyCents, 'Valor diário de alimentação');
  integer(settings.salaryPayDay, 'Dia do pagamento de salário', 1, 31);
  integer(settings.transportPayDay, 'Dia do pagamento de transporte', 1, 31);
  integer(settings.transportStartDay, 'Início do período de transporte', 1, 31);
  integer(settings.absenceClosingDay, 'Dia de fechamento das faltas', 1, 31);
  if (!Number.isFinite(settings.transportDiscountPercent) || settings.transportDiscountPercent < 0 || settings.transportDiscountPercent > 100) {
    throw new PayrollValidationError('Percentual de desconto de transporte deve estar entre 0 e 100.');
  }
  return holidaySet(settings.holidays);
}

function intersects(period: DateRange, admission: string, termination: string | null): boolean {
  return admission <= period.end && (termination === null || termination >= period.start);
}

function eligibleDays(period: DateRange, employee: Employee, holidays: ReadonlySet<string>): number {
  const start = employee.admissionDate > period.start ? employee.admissionDate : period.start;
  const end = employee.terminationDate !== null && employee.terminationDate < period.end ? employee.terminationDate : period.end;
  if (start > end) return 0;
  return businessDays({ start, end }, holidays);
}

function requestedDays(value: number | undefined, calendarDays: number, label: string): number {
  if (value === undefined) return calendarDays;
  integer(value, label, 0, 31);
  if (value > calendarDays) {
    throw new PayrollValidationError(`${label} não pode exceder os ${calendarDays} dias úteis do calendário.`);
  }
  return value;
}

/**
 * Administrative calculation reproducing the agreed source rules, not a legal payroll engine.
 * Salary is the full registered base for employment overlapping the competence: no implicit
 * prorating or tax/INSS/FGTS calculation. Benefit deductions and the transport payroll
 * deduction are separate; neither is subtracted from the salary payment schedule.
 */
export function calculatePayroll(
  employees: Employee[],
  absences: Absence[],
  settings: Settings,
  input: PayrollCalculation,
  now = new Date(),
): PayrollSnapshot {
  const month = parseMonth(input.month);
  if (!Number.isFinite(now.getTime())) throw new PayrollValidationError('Horário de cálculo inválido.');
  if (!Array.isArray(employees) || !Array.isArray(absences)) throw new PayrollValidationError('Colaboradores e faltas devem ser listas.');
  const holidays = validateSettings(settings);
  const periods = {
    food: range(monthStart(month), monthEnd(month)),
    transport: range(dayOfMonth(month, settings.transportStartDay), addDays(dayOfMonth(month, settings.transportStartDay, 1), -1)),
    absences: range(addDays(dayOfMonth(month, settings.absenceClosingDay, -2), 1), dayOfMonth(month, settings.absenceClosingDay, -1)),
  };
  const foodBusinessDays = requestedDays(input.foodBusinessDays, businessDays(periods.food, holidays), 'Dias de alimentação');
  const transportBusinessDays = requestedDays(input.transportBusinessDays, businessDays(periods.transport, holidays), 'Dias de transporte');

  const absentDates = new Map<string, Set<string>>();
  for (const absence of absences) {
    parseDate(absence.date, 'Data da falta');
    if (typeof absence.discountBenefits !== 'boolean') throw new PayrollValidationError('Opção de desconto da falta inválida.');
    if (!absence.discountBenefits || absence.date < periods.absences.start || absence.date > periods.absences.end) continue;
    const dates = absentDates.get(absence.employeeId) ?? new Set<string>();
    dates.add(absence.date);
    absentDates.set(absence.employeeId, dates);
  }

  const ids = new Set<string>();
  const items: PayrollSnapshot['items'] = [];
  for (const employee of employees) {
    if (typeof employee.id !== 'string' || !employee.id || ids.has(employee.id)) {
      throw new PayrollValidationError('Colaborador sem identificador ou com identificador duplicado.');
    }
    ids.add(employee.id);
    parseDate(employee.admissionDate, 'Data de admissão');
    if (employee.terminationDate !== null) {
      parseDate(employee.terminationDate, 'Data de desligamento');
      if (employee.terminationDate < employee.admissionDate) throw new PayrollValidationError('Desligamento não pode anteceder a admissão.');
    }
    if (employee.status !== 'active' && employee.status !== 'inactive') throw new PayrollValidationError('Situação do colaborador inválida.');
    cents(employee.salaryCents, 'Salário base');
    cents(employee.transportDailyCents, 'Valor diário de transporte');
    if (typeof employee.usesTransport !== 'boolean') throw new PayrollValidationError('Opção de vale-transporte inválida.');
    if (employee.status === 'inactive' && employee.terminationDate === null) continue;

    const hasSalary = intersects(periods.food, employee.admissionDate, employee.terminationDate);
    const hasTransportPeriod = employee.usesTransport && intersects(periods.transport, employee.admissionDate, employee.terminationDate);
    if (!hasSalary && !hasTransportPeriod) continue;

    const absenceDates = [...(absentDates.get(employee.id) ?? [])].filter(date =>
      date >= employee.admissionDate && (employee.terminationDate === null || date <= employee.terminationDate),
    ).sort();
    const absenceCount = absenceDates.length;
    const foodEligible = Math.min(foodBusinessDays, eligibleDays(periods.food, employee, holidays));
    const transportEligible = employee.usesTransport ? Math.min(transportBusinessDays, eligibleDays(periods.transport, employee, holidays)) : 0;
    const foodDays = Math.max(0, foodEligible - absenceCount);
    const transportDays = Math.max(0, transportEligible - absenceCount);
    const foodCents = cents(foodDays * settings.foodDailyCents, 'Total de alimentação');
    const transportCents = cents(transportDays * employee.transportDailyCents, 'Total de transporte');
    const salaryCents = hasSalary ? employee.salaryCents : 0;
    const discountCents = cents(
      (foodEligible - foodDays) * settings.foodDailyCents + (transportEligible - transportDays) * employee.transportDailyCents,
      'Desconto de benefícios por faltas',
    );
    const transportPayrollDeductionCents = Math.min(transportCents, percentageCents(salaryCents, settings.transportDiscountPercent));
    items.push({
      employeeId: employee.id, name: employee.name, jobTitle: employee.jobTitle, department: employee.department,
      salaryCents, absenceCount, absenceDates, foodDays, foodCents, transportDays, transportCents,
      discountCents, transportPayrollDeductionCents,
    });
  }

  const totals = items.reduce<PayrollSnapshot['totals']>((total, item) => ({
    salaryCents: cents(total.salaryCents + item.salaryCents, 'Total dos salários'),
    foodCents: cents(total.foodCents + item.foodCents, 'Total de alimentação'),
    transportCents: cents(total.transportCents + item.transportCents, 'Total de transporte'),
    discountCents: cents(total.discountCents + item.discountCents, 'Total de descontos de benefícios'),
    transportPayrollDeductionCents: cents(total.transportPayrollDeductionCents + item.transportPayrollDeductionCents, 'Total de desconto VT em folha'),
    totalCents: cents(total.totalCents + item.salaryCents + item.foodCents + item.transportCents, 'Total programado'),
    employeeCount: total.employeeCount + 1,
    absenceCount: total.absenceCount + item.absenceCount,
  }), { salaryCents: 0, foodCents: 0, transportCents: 0, discountCents: 0, transportPayrollDeductionCents: 0, totalCents: 0, employeeCount: 0, absenceCount: 0 });

  return {
    month: input.month, foodBusinessDays, transportBusinessDays, periods,
    settings: { ...settings, holidays: [...settings.holidays] }, items, totals,
    generatedAt: now.toISOString(),
  };
}

/** Produces administrative schedules, not bank transfers or a claim of net salary. */
export function paymentSchedule(snapshot: PayrollSnapshot): Array<{
  kind: 'salary' | 'food' | 'transport'; dueDate: string; description: string; amountCents: number;
}> {
  const month = parseMonth(snapshot.month);
  const holidays = validateSettings(snapshot.settings);
  const previousMonthStart = monthStart(month, -1);
  let foodDate = monthEnd(month, -1);
  while (!isBusinessDay(foodDate, holidays)) {
    foodDate = addDays(foodDate, -1);
    if (foodDate < previousMonthStart) throw new PayrollValidationError('Não há dia útil no mês anterior para programar a alimentação.');
  }
  const monthLabel = `${snapshot.month.slice(5)}/${snapshot.month.slice(0, 4)}`;
  return [
    { kind: 'salary', dueDate: isoDate(dayOfMonth(month, snapshot.settings.salaryPayDay, 1)), description: `Salários — base cadastrada ${monthLabel}`, amountCents: cents(snapshot.totals.salaryCents, 'Total dos salários') },
    { kind: 'food', dueDate: isoDate(foodDate), description: `Vale-alimentação ${monthLabel}`, amountCents: cents(snapshot.totals.foodCents, 'Total de alimentação') },
    { kind: 'transport', dueDate: isoDate(dayOfMonth(month, snapshot.settings.transportPayDay)), description: `Vale-transporte ${monthLabel}`, amountCents: cents(snapshot.totals.transportCents, 'Total de transporte') },
  ];
}
