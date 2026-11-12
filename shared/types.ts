export type AppRole = 'dp' | 'financeiro' | 'diretoria';
export type EmployeeStatus = 'active' | 'inactive';
export interface User { id: string; name: string; username: string; role: AppRole; active: boolean; }
export interface Employee {
  id: string; name: string; jobTitle: string; department: string; admissionDate: string;
  terminationDate: string | null; salaryCents: number; usesTransport: boolean;
  transportDailyCents: number; status: EmployeeStatus; version: number; createdAt: string; updatedAt: string;
}
export type EmployeeInput = Omit<Employee, 'id' | 'createdAt' | 'updatedAt' | 'version'> & { version?: number };
export interface Absence { id: string; employeeId: string; employeeName: string; date: string; reason: string; discountBenefits: boolean; createdBy: string; createdAt: string; }
export interface Settings {
  companyName: string; foodDailyCents: number; foodPaymentMethod: string;
  salaryPayDay: number; transportPayDay: number; transportStartDay: number;
  absenceClosingDay: number; transportDiscountPercent: number; holidays: string[]; version: number;
}
export interface DateRange { start: string; end: string; }
export interface PayrollItem {
  employeeId: string; name: string; jobTitle: string; department: string; salaryCents: number;
  absenceCount: number; absenceDates: string[]; foodDays: number; foodCents: number;
  transportDays: number; transportCents: number; discountCents: number; transportPayrollDeductionCents: number;
}
export interface PayrollSnapshot {
  sourceVersion?: string;
  month: string; foodBusinessDays: number; transportBusinessDays: number;
  periods: { food: DateRange; transport: DateRange; absences: DateRange };
  settings: Settings; items: PayrollItem[];
  totals: { salaryCents: number; foodCents: number; transportCents: number; discountCents: number; transportPayrollDeductionCents: number; totalCents: number; employeeCount: number; absenceCount: number; };
  generatedAt: string;
}
export interface Payroll { id: string; month: string; status: 'closed' | 'reopened'; closedAt: string; closedBy: string; version: number; snapshot: PayrollSnapshot; }
export interface PayrollCalculation { month: string; foodBusinessDays?: number; transportBusinessDays?: number; expectedSourceVersion?: string; }
export interface Payment {
  id: string; payrollId: string; month: string; kind: 'salary' | 'food' | 'transport';
  description: string; amountCents: number; dueDate: string; status: 'pending' | 'paid' | 'void';
  paidAt: string | null; paidBy: string | null; note: string; version: number;
}
export interface AuditEvent { id: string; actorName: string; action: string; entityType: string; entityId: string; summary: string; createdAt: string; }
export interface PageResult<T> { items: T[]; total: number; page: number; pageSize: number; }
export interface Overview {
  month: string; activeEmployees: number; inactiveEmployees: number; salaryBaseCents: number;
  foodCents: number; transportCents: number; totalCents: number; pendingCents: number; paidCents: number;
  overdueCents: number; absences: number; payrollStatus: 'open' | 'closed';
  upcomingPayments: Payment[]; recentActivity: AuditEvent[];
  departments: { name: string; count: number }[];
  monthlyHistory: { month: string; salaryCents: number; foodCents: number; transportCents: number; closed: boolean }[];
}
export interface Bootstrap { user: User; settings: Settings; mode: 'local' | 'production'; version: string; }
export interface ApiError { error: string; code?: string; details?: unknown; }
