import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, Inbox, LoaderCircle, X } from 'lucide-react';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue' }) { return <span className={`badge ${tone}`}><span className="badge-dot" />{children}</span>; }
export function Loading({ label = 'Carregando informações…' }: { label?: string }) { return <div className="state loading-state" role="status"><LoaderCircle className="spin" size={24} /><span>{label}</span></div>; }
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) { return <div className="state error-state" role="alert"><AlertCircle size={26} /><strong>Não foi possível carregar</strong><p>{message}</p>{retry ? <button className="button secondary" onClick={retry}>Tentar novamente</button> : null}</div>; }
export function Empty({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="state empty-state"><span className="empty-icon"><Inbox size={28} /></span><strong>{title}</strong><p>{description}</p>{action}</div>; }
export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action ? <div className="heading-actions">{action}</div> : null}</div>; }
export function Pagination({ total, page, pageSize, onChange }: { total: number; page: number; pageSize: number; onChange: (page: number) => void }) { const pages = Math.max(1, Math.ceil(total / pageSize)); return <div className="pagination"><span>{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total} registros` : 'Nenhum registro'}</span><div><button className="icon-button" aria-label="Página anterior" disabled={page <= 1} onClick={() => onChange(page - 1)}><ArrowLeft size={16} /></button><span>Página <b>{page}</b> de {pages}</span><button className="icon-button" aria-label="Próxima página" disabled={page >= pages} onClick={() => onChange(page + 1)}><ArrowRight size={16} /></button></div></div>; }
export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const element = dialog.current; if (element && !element.open) element.showModal(); return () => { element?.close(); previous?.focus(); }; }, []);
  function keepTabInDialog(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')]
      .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey ? active === first : active === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }
  return <dialog className={`modal ${wide ? 'wide' : ''}`} ref={dialog} onKeyDown={keepTabInDialog} onCancel={event => { event.preventDefault(); closeRef.current(); }} onClick={event => { if (event.target === event.currentTarget) closeRef.current(); }} aria-labelledby={headingId}><div className="modal-heading"><div><h2 id={headingId}>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button type="button" className="icon-button" aria-label="Fechar janela" onClick={onClose}><X size={20} /></button></div>{children}</dialog>;
}
export function Field({ label, children, hint, wide = false }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) { return <label className={`field ${wide ? 'full-width' : ''}`}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>; }
export function FormError({ message }: { message: string | null }) { return message ? <div className="form-error" role="alert"><AlertCircle size={17} />{message}</div> : null; }
export function Submit({ busy, children = 'Salvar alterações' }: { busy: boolean; children?: ReactNode }) { return <button className="button primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{busy ? 'Salvando…' : children}</button>; }
export function Confirmation({ title, description, label, reasonRequired = false, hideReason = false, onConfirm, onClose, destructive = false }: { title: string; description: string; label: string; reasonRequired?: boolean; hideReason?: boolean; onConfirm: (reason: string) => Promise<void>; onClose: () => void; destructive?: boolean }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError(null); try { await onConfirm(String(form.get('reason') || '')); onClose(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }
  return <Modal title={title} onClose={() => { if (!busy) onClose(); }}><form onSubmit={submit}><div className="modal-body"><p className="confirm-description">{description}</p>{hideReason ? null : <Field label={reasonRequired ? 'Motivo da alteração' : 'Observação (opcional)'}><textarea name="reason" rows={3} maxLength={500} required={reasonRequired} minLength={reasonRequired ? 5 : undefined} placeholder={reasonRequired ? 'Descreva o motivo para o histórico…' : 'Adicione uma referência para o histórico…'} /></Field>}<FormError message={error} /></div><div className="modal-footer"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className={`button ${destructive ? 'danger' : 'primary'}`} type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}{busy ? 'Processando…' : label}</button></div></form></Modal>;
}
export function Metric({ label, value, detail, icon, tone = 'green' }: { label: string; value: ReactNode; detail: ReactNode; icon: ReactNode; tone?: string }) { return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><strong className="metric-value">{value}</strong><div className="metric-detail">{detail}</div></div>; }
