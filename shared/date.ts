import type { DateRange } from './types';

/** Calendar arithmetic deliberately uses UTC, never the server's local timezone. */
export class PayrollValidationError extends Error {
  readonly status = 400;
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'PayrollValidationError';
  }
}

const DAY_MS = 86_400_000;

export function utcDate(year: number, monthIndex: number, day: number): Date {
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(year, monthIndex, day);
  if (!Number.isFinite(result.getTime()) || result.getUTCFullYear() < 1 || result.getUTCFullYear() > 9999) {
    throw new PayrollValidationError('Data fora do calendário suportado.');
  }
  return result;
}

export function isoDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new PayrollValidationError('Data inválida.');
  return date.toISOString().slice(0, 10);
}

export function parseDate(value: string, label = 'Data'): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PayrollValidationError(`${label} deve usar o formato AAAA-MM-DD.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = utcDate(year, month - 1, day);
  if (isoDate(parsed) !== value) throw new PayrollValidationError(`${label} não existe no calendário.`);
  return parsed;
}

export function parseMonth(value: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new PayrollValidationError('Competência deve usar o formato AAAA-MM.');
  }
  return parseDate(`${value}-01`, 'Competência');
}

export function monthStart(month: Date, offset = 0): Date {
  return utcDate(month.getUTCFullYear(), month.getUTCMonth() + offset, 1);
}

export function monthEnd(month: Date, offset = 0): Date {
  return utcDate(month.getUTCFullYear(), month.getUTCMonth() + offset + 1, 0);
}

export function dayOfMonth(month: Date, day: number, offset = 0): Date {
  return utcDate(month.getUTCFullYear(), month.getUTCMonth() + offset, Math.min(day, monthEnd(month, offset).getUTCDate()));
}

export function addDays(date: Date, amount: number): Date {
  const result = new Date(date.getTime() + amount * DAY_MS);
  if (result.getUTCFullYear() < 1 || result.getUTCFullYear() > 9999) {
    throw new PayrollValidationError('Data fora do calendário suportado.');
  }
  return result;
}

export function range(start: Date, end: Date): DateRange {
  return { start: isoDate(start), end: isoDate(end) };
}

export function holidaySet(values: string[]): Set<string> {
  if (!Array.isArray(values)) throw new PayrollValidationError('Feriados devem ser uma lista de datas.');
  for (const value of values) parseDate(value, 'Feriado');
  return new Set(values);
}

export function isBusinessDay(date: Date, holidays: ReadonlySet<string>): boolean {
  const weekDay = date.getUTCDay();
  return weekDay !== 0 && weekDay !== 6 && !holidays.has(isoDate(date));
}

export function businessDays(period: DateRange, holidays: ReadonlySet<string>): number {
  const start = parseDate(period.start);
  const end = parseDate(period.end);
  let count = 0;
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    if (isBusinessDay(cursor, holidays)) count++;
  }
  return count;
}
