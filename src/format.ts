export const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export const shortMoney = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100);
export const dateLabel = (date: string | null) => date ? new Date(date.length === 10 ? `${date}T12:00:00Z` : date).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
export const dateTimeLabel = (date: string) => new Date(date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
export const monthLabel = (month: string, short = false) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: short ? 'short' : 'long', ...(short ? {} : { year: 'numeric' }), timeZone: 'America/Sao_Paulo' }).replace('.', '');
export function currentMonth() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date()); return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`; }
export function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
export const cents = (value: FormDataEntryValue | null) => Math.round(Number(String(value || '0').replace(',', '.')) * 100);
export const roleLabel = (role: string) => ({ dp: 'Departamento pessoal', financeiro: 'Financeiro', diretoria: 'Diretoria' }[role] || role);
