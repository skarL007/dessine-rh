import type { User } from '../../shared/types';
export type PageId = 'overview' | 'employees' | 'payroll' | 'payments' | 'absences' | 'settings' | 'users' | 'audit';
export interface PageProps { month: string; onMonthChange: (month: string) => void; canEdit: boolean; user: User; notify: (message: string) => void; navigate: (page: PageId) => void; onGlobalRefresh: () => void; }
