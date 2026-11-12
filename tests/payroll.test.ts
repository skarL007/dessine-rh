import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePayroll, paymentSchedule, PayrollValidationError } from '../shared/payroll';
import type { Absence, Employee, Settings } from '../shared/types';

const FIXED_NOW = new Date('2026-11-12T18:00:00.000Z');

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    companyName: 'Empresa de teste', foodDailyCents: 2_800, foodPaymentMethod: 'Cartão',
    salaryPayDay: 5, transportPayDay: 5, transportStartDay: 6, absenceClosingDay: 31,
    transportDiscountPercent: 4, holidays: [], version: 1, ...overrides,
  };
}

function employee(id = 'a', overrides: Partial<Employee> = {}): Employee {
  return {
    id, name: `Pessoa ${id}`, jobTitle: 'Analista', department: 'Operações',
    admissionDate: '2020-01-01', terminationDate: null, salaryCents: 200_000,
    usesTransport: true, transportDailyCents: 1_100, status: 'active', version: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

function absence(date: string, employeeId = 'a', overrides: Partial<Absence> = {}): Absence {
  return {
    id: `absence-${employeeId}-${date}`, employeeId, employeeName: `Pessoa ${employeeId}`,
    date, reason: 'Registro de teste', discountBenefits: true, createdBy: 'teste',
    createdAt: FIXED_NOW.toISOString(), ...overrides,
  };
}

test('caso de regressão anonimizado: três pessoas, 21 dias, uma falta, VA 1.736 e VT 976 reais', () => {
  const result = calculatePayroll([
    employee('a'),
    employee('b', { salaryCents: 300_000, transportDailyCents: 2_400 }),
    employee('c', { salaryCents: 500_000, transportDailyCents: 1_200 }),
  ], [absence('2026-10-15')], settings(), { month: '2026-11' }, FIXED_NOW);

  assert.equal(result.foodBusinessDays, 21);
  assert.equal(result.transportBusinessDays, 21);
  assert.deepEqual(result.periods, {
    food: { start: '2026-11-01', end: '2026-11-30' },
    transport: { start: '2026-11-06', end: '2026-12-05' },
    absences: { start: '2026-10-01', end: '2026-10-31' },
  });
  assert.deepEqual(result.totals, {
    salaryCents: 1_000_000, foodCents: 173_600, transportCents: 97_600,
    discountCents: 3_900, transportPayrollDeductionCents: 40_000,
    totalCents: 1_271_200, employeeCount: 3, absenceCount: 1,
  });
  assert.deepEqual(result.items[0], {
    employeeId: 'a', name: 'Pessoa a', jobTitle: 'Analista', department: 'Operações',
    salaryCents: 200_000, absenceCount: 1, absenceDates: ['2026-10-15'],
    foodDays: 20, foodCents: 56_000, transportDays: 20, transportCents: 22_000,
    discountCents: 3_900, transportPayrollDeductionCents: 8_000,
  });
  assert.equal(result.generatedAt, FIXED_NOW.toISOString());
  assert.deepEqual(paymentSchedule(result).map(({ kind, dueDate, amountCents }) => ({ kind, dueDate, amountCents })), [
    { kind: 'salary', dueDate: '2026-12-05', amountCents: 1_000_000 },
    { kind: 'food', dueDate: '2026-10-30', amountCents: 173_600 },
    { kind: 'transport', dueDate: '2026-11-05', amountCents: 97_600 },
  ]);
});

test('ano bissexto, transição anual e cálculo independente do fuso local', () => {
  const february = calculatePayroll([employee()], [], settings(), { month: '2024-02' }, FIXED_NOW);
  assert.equal(february.periods.food.end, '2024-02-29');
  assert.equal(february.foodBusinessDays, 21);
  assert.equal(february.transportBusinessDays, 21);
  const march = calculatePayroll([employee()], [], settings(), { month: '2024-03' }, FIXED_NOW);
  assert.deepEqual(march.periods.absences, { start: '2024-02-01', end: '2024-02-29' });
  const january = calculatePayroll([employee()], [], settings(), { month: '2027-01' }, FIXED_NOW);
  assert.deepEqual(january.periods.absences, { start: '2026-12-01', end: '2026-12-31' });
  assert.equal(paymentSchedule(january)[1].dueDate, '2026-12-31');
});

test('fechamento 25 usa 26/setembro–25/outubro na competência novembro', () => {
  const result = calculatePayroll([employee()], [
    absence('2026-09-25'), absence('2026-09-26'), absence('2026-10-25'), absence('2026-10-26'),
  ], settings({ absenceClosingDay: 25 }), { month: '2026-11' });
  assert.deepEqual(result.periods.absences, { start: '2026-09-26', end: '2026-10-25' });
  assert.deepEqual(result.items[0].absenceDates, ['2026-09-26', '2026-10-25']);
  assert.equal(result.items[0].foodDays, 19);
});

test('feriados reduzem apenas as janelas correspondentes e antecipam VA para o último útil anterior', () => {
  const result = calculatePayroll([employee()], [], settings({
    holidays: ['2026-11-02', '2026-11-15', '2026-11-20', '2026-10-30', '2026-11-20'],
  }), { month: '2026-11' });
  assert.equal(result.foodBusinessDays, 19); // 2 and 20 are weekdays; 15 is Sunday; duplicates count once.
  assert.equal(result.transportBusinessDays, 20); // The transport window starts on November 6.
  assert.equal(paymentSchedule(result)[1].dueDate, '2026-10-29');
});

test('faltas duplicadas contam uma vez, somente quando marcadas e dentro da janela e do vínculo', () => {
  const result = calculatePayroll([employee('a', { admissionDate: '2026-10-10' })], [
    absence('2026-10-01'),
    absence('2026-10-15'), absence('2026-10-15', 'a', { id: 'duplicate' }),
    absence('2026-10-16', 'a', { discountBenefits: false }),
    absence('2026-11-03'), absence('2026-10-19', 'unknown'),
  ], settings(), { month: '2026-11' });
  assert.equal(result.items[0].absenceCount, 1);
  assert.deepEqual(result.items[0].absenceDates, ['2026-10-15']);
  assert.equal(result.items[0].foodCents, 56_000);
});

test('nenhum benefício, desconto ou transferência fica negativo com dias zerados ou faltas excedentes', () => {
  const days = Array.from({ length: 31 }, (_, index) => absence(`2026-10-${String(index + 1).padStart(2, '0')}`));
  const result = calculatePayroll([employee()], days, settings(), { month: '2026-11' });
  assert.equal(result.items[0].foodDays, 0);
  assert.equal(result.items[0].transportDays, 0);
  assert.equal(result.items[0].discountCents, 81_900); // Only the 21 eligible days can be deducted.
  assert.equal(result.items[0].transportPayrollDeductionCents, 0);
  assert.equal(result.totals.totalCents, 200_000);
  const zero = calculatePayroll([employee()], [absence('2026-10-15')], settings(), {
    month: '2026-11', foodBusinessDays: 0, transportBusinessDays: 0,
  });
  assert.equal(zero.totals.discountCents, 0);
  assert.equal(zero.totals.foodCents, 0);
  assert.equal(zero.totals.transportCents, 0);
  assert.equal(zero.totals.salaryCents, 200_000);
});

test('admissão limita dias elegíveis, mesmo com override, sem ratear silenciosamente o salário base', () => {
  const result = calculatePayroll([employee('a', { admissionDate: '2026-11-30' })], [], settings(), {
    month: '2026-11', foodBusinessDays: 21, transportBusinessDays: 21,
  });
  assert.equal(result.items[0].foodDays, 1);
  assert.equal(result.items[0].transportDays, 5);
  assert.equal(result.items[0].salaryCents, 200_000);
  const future = calculatePayroll([employee('a', { admissionDate: '2026-12-02' })], [], settings(), { month: '2026-11' });
  assert.equal(future.items[0].salaryCents, 0);
  assert.equal(future.items[0].foodDays, 0);
  assert.equal(future.items[0].transportDays, 3);
});

test('desligado com vínculo na competência participa; sem data ou encerrado antes fica fora', () => {
  const result = calculatePayroll([
    employee('a', { status: 'inactive', terminationDate: '2026-11-10' }),
    employee('b', { status: 'inactive', terminationDate: '2026-12-31' }),
    employee('c', { status: 'inactive', terminationDate: '2026-10-31' }),
    employee('d', { status: 'inactive', terminationDate: null }),
  ], [], settings(), { month: '2026-11' });
  assert.deepEqual(result.items.map(item => item.employeeId), ['a', 'b']);
  assert.equal(result.items[0].foodDays, 7);
  assert.equal(result.items[0].transportDays, 3);
  assert.equal(result.items[0].salaryCents, 200_000);
  assert.equal(result.items[1].foodDays, 21);
});

test('vale-transporte desabilitado é zero e percentual é limitado ao benefício concedido', () => {
  const result = calculatePayroll([
    employee('a', { usesTransport: false, transportDailyCents: 9_999 }),
    employee('b', { salaryCents: 1_000_000, transportDailyCents: 100 }),
  ], [], settings(), { month: '2026-11' });
  assert.equal(result.items[0].transportDays, 0);
  assert.equal(result.items[0].transportCents, 0);
  assert.equal(result.items[0].transportPayrollDeductionCents, 0);
  assert.equal(result.items[1].transportPayrollDeductionCents, 2_100);
  assert.equal(paymentSchedule(result)[0].amountCents, 1_200_000);
});

test('centavos decimais permanecem inteiros e percentual usa arredondamento monetário determinístico', () => {
  const result = calculatePayroll([
    employee('a', { salaryCents: 123_450, transportDailyCents: 1_123 }),
  ], [], settings({ foodDailyCents: 2_899, transportDiscountPercent: 1 }), { month: '2026-11' });
  assert.equal(result.items[0].foodCents, 60_879);
  assert.equal(result.items[0].transportCents, 23_583);
  assert.equal(result.items[0].transportPayrollDeductionCents, 1_235); // 1,234.5 cents -> 1,235.
  assert.equal(result.totals.totalCents, 207_912);
  const fractional = calculatePayroll([employee('a', { salaryCents: 100_005 })], [], settings({ transportDiscountPercent: 4.125 }), { month: '2026-11' });
  assert.equal(fractional.items[0].transportPayrollDeductionCents, 4_125);
});

test('snapshot não compartilha referências mutáveis com configurações ou fontes', () => {
  const config = settings({ holidays: ['2026-11-20'] });
  const person = employee();
  const sourceAbsence = absence('2026-10-15');
  const result = calculatePayroll([person], [sourceAbsence], config, { month: '2026-11' });
  config.holidays.push('2026-11-02');
  config.foodDailyCents = 9_999;
  person.name = 'Alterado depois';
  sourceAbsence.date = '2026-10-16';
  assert.deepEqual(result.settings.holidays, ['2026-11-20']);
  assert.equal(result.settings.foodDailyCents, 2_800);
  assert.equal(result.items[0].name, 'Pessoa a');
  assert.deepEqual(result.items[0].absenceDates, ['2026-10-15']);
});

test('calendário inválido, dias acima do calendário, centavos fracionários e identificadores duplicados falham explicitamente', () => {
  const run = (options: { config?: Partial<Settings>; month?: string; employee?: Partial<Employee>; days?: number } = {}) =>
    calculatePayroll([employee('a', options.employee)], [], settings(options.config), { month: options.month ?? '2026-11', foodBusinessDays: options.days });
  for (const month of ['2026-13', '2026-00', '2026-2', '2026-02-01']) {
    assert.throws(() => run({ month }), PayrollValidationError);
  }
  assert.throws(() => run({ config: { holidays: ['2025-02-29'] } }), /não existe/);
  assert.throws(() => run({ employee: { admissionDate: '2026-02-30' } }), /não existe/);
  assert.throws(() => run({ days: 22 }), /não pode exceder/);
  assert.throws(() => run({ days: -1 }), PayrollValidationError);
  assert.throws(() => run({ days: 1.5 }), PayrollValidationError);
  assert.throws(() => run({ employee: { salaryCents: 123.45 } }), PayrollValidationError);
  assert.throws(() => run({ config: { transportDiscountPercent: Number.NaN } }), PayrollValidationError);
  assert.throws(() => run({ employee: { admissionDate: '2026-10-15', terminationDate: '2026-10-14' } }), /anteceder/);
  assert.throws(() => calculatePayroll([employee(), employee()], [], settings(), { month: '2026-11' }), /duplicado/);
  assert.throws(() => run({ config: { foodDailyCents: Number.MAX_SAFE_INTEGER } }), PayrollValidationError);
});

test('empresa sem colaboradores retorna totais zero sem inventar dados e agenda valida impossibilidade de dia útil', () => {
  const result = calculatePayroll([], [], settings(), { month: '2026-11' });
  assert.equal(result.totals.employeeCount, 0);
  assert.equal(result.totals.totalCents, 0);
  assert.deepEqual(result.items, []);
  const noBusinessDay = calculatePayroll([], [], settings({
    holidays: Array.from({ length: 31 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`),
  }), { month: '2026-11' });
  assert.throws(() => paymentSchedule(noBusinessDay), /Não há dia útil/);
});
