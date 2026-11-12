import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Calculator, CheckCircle2, Download, FileCheck2, History, Info, LockKeyhole, Printer, RotateCcw, Users } from 'lucide-react';
import type { Payroll as PayrollData, PayrollSnapshot } from '../../shared/types';
import { api, post, useQuery } from '../api';
import { Badge, Confirmation, Empty, ErrorState, FormError, Loading, Metric, PageHeading } from '../components';
import { dateLabel, dateTimeLabel, money, monthLabel } from '../format';
import PayrollComparison from './PayrollComparison';
import type { PageProps } from './types';

type PayrollRevision = PayrollData & { revision: number };
type RevisionSummary = Omit<PayrollRevision, 'snapshot'>;

export default function Payroll(props: PageProps) {
  return <PayrollMonth key={props.month} {...props} />;
}

function PayrollMonth({ month, canEdit, notify }: PageProps) {
  const result = useQuery<{ payroll: PayrollData | null }>(`/api/payroll?month=${month}`);
  const versionsPath = `/api/payroll/${month}/versions`;
  const history = useQuery<{ versions: RevisionSummary[] }>(versionsPath);
  const [selectedRevision, setSelectedRevision] = useState('');
  const archive = useQuery<{ payroll: PayrollRevision }>(selectedRevision ? `${versionsPath}/${selectedRevision}` : null);
  const [preview, setPreview] = useState<PayrollSnapshot | null>(null);
  const [foodDays, setFoodDays] = useState('');
  const [transportDays, setTransportDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'close' | 'reopen' | null>(null);
  const payroll = result.data?.payroll;
  const closed = payroll?.status === 'closed';
  const archived = archive.data?.payroll;
  const currentSnapshot = result.data ? (closed ? payroll.snapshot : preview) : null;
  const snapshot = selectedRevision ? archived?.snapshot : currentSnapshot;
  const dirty = preview !== null && (
    foodDays !== String(preview.foodBusinessDays) || transportDays !== String(preview.transportBusinessDays)
  );

  useEffect(() => {
    setPreview(null);
    setError(null);
    setFoodDays('');
    setTransportDays('');
    setBusy(false);
    if (!result.data || result.data.payroll?.status === 'closed') return;
    const controller = new AbortController();
    setBusy(true);
    api<PayrollSnapshot>('/api/payroll/calculate', {
      method: 'POST',
      body: JSON.stringify({ month }),
      signal: controller.signal,
    }).then(value => {
      if (controller.signal.aborted) return;
      setPreview(value);
      setFoodDays(String(value.foodBusinessDays));
      setTransportDays(String(value.transportBusinessDays));
    }).catch((err: Error) => {
      if (!controller.signal.aborted) setError(err.message);
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [result.data, month]);

  function calculation() {
    return {
      month,
      ...(foodDays === '' ? {} : { foodBusinessDays: Number(foodDays) }),
      ...(transportDays === '' ? {} : { transportBusinessDays: Number(transportDays) }),
    };
  }

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const value = await post<PayrollSnapshot>('/api/payroll/calculate', calculation());
      setPreview(value);
      setFoodDays(String(value.foodBusinessDays));
      setTransportDays(String(value.transportBusinessDays));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function refreshPayroll() {
    result.reload();
    history.reload();
  }

  return <>
    <PageHeading
      eyebrow="COMPETÊNCIA MENSAL"
      title="Folha & benefícios"
      description={`Confira os valores de ${monthLabel(month)}.`}
      action={<>
        <button className="button secondary" onClick={() => window.print()} disabled={!snapshot}><Printer size={16} />Imprimir</button>
        {!selectedRevision && closed ? <a className="button secondary" href={`/api/export/payroll?month=${month}`} download><Download size={16} />Exportar CSV</a> : null}
      </>}
    />
    <section className="panel payroll-history" aria-labelledby="payroll-history-heading">
      <div className="panel-heading">
        <div>
          <h2 id="payroll-history-heading"><History size={18} aria-hidden="true" />Versões da folha</h2>
          {!history.loading && history.data?.versions.length === 0
            ? <p>As versões aparecem aqui após o primeiro fechamento.</p>
            : <p>Consulte os valores e os dias úteis registrados em cada fechamento.</p>}
        </div>
        {history.loading ? <p role="status">Carregando versões…</p> : null}
        {history.data?.versions.length ? <label className="field">
          <span>Versão exibida</span>
          <select value={selectedRevision} onChange={event => {
            setSelectedRevision(event.target.value);
            archive.reload();
          }}>
            <option value="">Competência atual</option>
            {history.data.versions.map(version => <option key={version.revision} value={version.revision}>
              Versão {version.revision} · {version.status === 'closed' ? 'fechada' : 'reaberta'} · {dateTimeLabel(version.closedAt)}
            </option>)}
          </select>
        </label> : null}
      </div>
      {history.error ? <ErrorState message={history.error} retry={history.reload} /> : null}
    </section>
    {selectedRevision ? <>
      {archive.loading ? <Loading label="Carregando versão da folha…" /> : null}
      {archive.error ? <ErrorState message={archive.error} retry={archive.reload} /> : null}
      {archived ? <>
        <div className="payroll-status is-closed">
          <span className="status-icon"><History size={21} aria-hidden="true" /></span>
          <div>
            <strong>Versão {archived.revision} · {monthLabel(month)}</strong>
            <p>Fechada por {archived.closedBy} em {dateTimeLabel(archived.closedAt)}.</p>
          </div>
          <Badge tone={archived.status === 'closed' ? 'green' : 'amber'}>{archived.status === 'closed' ? 'Fechada' : 'Reaberta'}</Badge>
        </div>
        <PayrollStatement snapshot={archived.snapshot} preserved />
      </> : null}
    </> : result.loading ? <Loading /> : result.error ? <ErrorState message={result.error} retry={result.reload} /> : <>
      <div className={`payroll-status ${closed ? 'is-closed' : ''}`}>
        <span className="status-icon">{closed ? <LockKeyhole size={21} /> : <FileCheck2 size={21} />}</span>
        <div>
          <strong>{closed ? 'Competência fechada' : 'Competência em preparação'}</strong>
          <p>{closed
            ? `Fechada por ${payroll.closedBy} em ${dateTimeLabel(payroll.closedAt)}. Os valores estão preservados.`
            : 'Confira os cadastros, as faltas e os dias úteis. O cálculo não registra pagamentos.'}</p>
        </div>
        <Badge tone={closed ? 'green' : 'amber'}>{closed ? 'Fechada' : 'Em aberto'}</Badge>
      </div>
      {!closed ? <section className="panel calculation-panel">
        <form className="calculation-controls" onSubmit={calculate}>
          <label className="field">
            <span>Dias úteis de alimentação</span>
            <input type="number" min={0} max={31} step={1} value={foodDays} onChange={event => setFoodDays(event.target.value)} disabled={busy} />
          </label>
          <label className="field">
            <span>Dias úteis de transporte</span>
            <input type="number" min={0} max={31} step={1} value={transportDays} onChange={event => setTransportDays(event.target.value)} disabled={busy} />
          </label>
          <button className="button secondary" type="submit" disabled={busy}><Calculator size={17} />{busy ? 'Calculando…' : 'Recalcular'}</button>
        </form>
        <div className="info-line"><Info size={16} /><span>Segunda a sexta, com os feriados cadastrados. Ajuste os dias úteis quando necessário.</span></div>
        <FormError message={error} />
      </section> : null}
      {busy && !currentSnapshot ? <Loading label="Calculando salários base e benefícios…" /> : null}
      {currentSnapshot ? <>
        <PayrollStatement snapshot={currentSnapshot} preserved={closed}>
          <PayrollComparison snapshot={currentSnapshot} closed={closed} />
        </PayrollStatement>
        <div className="payroll-bottom">
          <p><CheckCircle2 size={16} />{closed
            ? 'O histórico mantém as regras utilizadas neste fechamento.'
            : 'O fechamento registra a folha e cria os compromissos de pagamento.'}</p>
          {canEdit && closed ? <button className="button secondary" onClick={() => setConfirm('reopen')}><RotateCcw size={16} />Reabrir competência</button> : null}
          {canEdit && !closed ? <button className="button primary" disabled={busy || dirty || !currentSnapshot.items.length} onClick={() => setConfirm('close')}><LockKeyhole size={16} />Fechar competência</button> : null}
        </div>
        {dirty && !closed ? <p className="unsaved-note">Os dias úteis foram alterados. Recalcule para conferir os novos valores antes de fechar.</p> : null}
      </> : null}
    </>}
    {confirm === 'close' && preview ? <Confirmation
      title="Fechar esta competência?"
      description={`A folha de ${monthLabel(month)} será calculada no servidor e preservada no histórico. Serão criados os compromissos administrativos de salário, alimentação e transporte. Nenhuma transferência bancária será feita.`}
      label="Confirmar fechamento"
      hideReason
      onClose={() => setConfirm(null)}
      onConfirm={async () => {
        await post('/api/payroll/close', { ...calculation(), expectedSourceVersion: preview.sourceVersion });
        refreshPayroll();
        notify('Competência fechada e compromissos registrados.');
      }}
    /> : null}
    {confirm === 'reopen' && payroll ? <Confirmation
      title="Reabrir a competência"
      description="A reabertura preserva o histórico e anula os compromissos pendentes desta versão. Se houver pagamentos confirmados, será necessário reverter os registros primeiro."
      reasonRequired
      label="Reabrir competência"
      onClose={() => setConfirm(null)}
      onConfirm={async reason => {
        await post(`/api/payroll/${payroll.id}/reopen`, { reason, version: payroll.version });
        refreshPayroll();
        notify('Competência reaberta. O histórico foi preservado.');
      }}
    /> : null}
  </>;
}

function PayrollStatement({ snapshot, preserved, children }: { snapshot: PayrollSnapshot; preserved: boolean; children?: ReactNode }) {
  return <>
    <div className="metric-grid payroll-metrics">
      <Metric label="Salários base" value={money(snapshot.totals.salaryCents)} detail={`${snapshot.totals.employeeCount} colaboradores considerados`} icon={<Users size={18} />} tone="blue" />
      <Metric label="Vale alimentação" value={money(snapshot.totals.foodCents)} detail={`${snapshot.foodBusinessDays} dias úteis · ${dateLabel(snapshot.periods.food.start)} a ${dateLabel(snapshot.periods.food.end)}`} icon={<FileCheck2 size={18} />} />
      <Metric label="Vale transporte" value={money(snapshot.totals.transportCents)} detail={`${snapshot.transportBusinessDays} dias úteis · ${dateLabel(snapshot.periods.transport.start)} a ${dateLabel(snapshot.periods.transport.end)}`} icon={<FileCheck2 size={18} />} tone="purple" />
      <Metric label="Total da competência" value={money(snapshot.totals.totalCents)} detail="Salários base + benefícios" icon={<Calculator size={18} />} tone="amber" />
    </div>
    {children}
    <section className="panel payroll-table-panel">
      <div className="panel-heading">
        <div>
          <h2 id="payroll-employee-heading" tabIndex={-1}>Conferência por colaborador</h2>
          <p>Faltas de {dateLabel(snapshot.periods.absences.start)} a {dateLabel(snapshot.periods.absences.end)}</p>
        </div>
        <Badge tone={preserved ? 'green' : 'blue'}>{preserved ? 'Valores preservados' : 'Prévia do cálculo'}</Badge>
      </div>
      {snapshot.items.length ? <>
        <p className="payroll-scroll-hint">Deslize a tabela para ver todas as colunas.</p>
        <div className="table-scroll" role="region" tabIndex={0} aria-labelledby="payroll-employee-heading">
        <table className="data-table payroll-table">
          <thead><tr>
            <th scope="col">Colaborador</th>
            <th scope="col">Salário base</th>
            <th scope="col">Faltas</th>
            <th scope="col">Alimentação</th>
            <th scope="col">Transporte</th>
            <th scope="col">Desconto VT*</th>
          </tr></thead>
          <tbody>{snapshot.items.map(item => <tr key={item.employeeId}>
            <td><strong>{item.name}</strong><small className="cell-subtitle">{item.jobTitle}</small></td>
            <td className="money-cell">{money(item.salaryCents)}</td>
            <td>{item.absenceCount ? <details className="absence-detail">
              <summary><Badge tone="amber">{item.absenceCount} falta{item.absenceCount === 1 ? '' : 's'}</Badge></summary>
              <p>{item.absenceDates.map(dateLabel).join(', ')}</p>
              <small>Desconto em benefícios: {money(item.discountCents)}</small>
            </details> : <span className="muted">—</span>}</td>
            <td><strong className="money-cell">{money(item.foodCents)}</strong><small className="cell-subtitle">{item.foodDays} dias</small></td>
            <td><strong className="money-cell">{money(item.transportCents)}</strong><small className="cell-subtitle">{item.transportDays} dias</small></td>
            <td className="money-cell">{money(item.transportPayrollDeductionCents)}</td>
          </tr>)}</tbody>
          <tfoot><tr>
            <td>Total</td>
            <td>{money(snapshot.totals.salaryCents)}</td>
            <td>{snapshot.totals.absenceCount}</td>
            <td>{money(snapshot.totals.foodCents)}</td>
            <td>{money(snapshot.totals.transportCents)}</td>
            <td>{money(snapshot.totals.transportPayrollDeductionCents)}</td>
          </tr></tfoot>
        </table>
        </div>
      </> : <Empty title="Nenhum colaborador para esta competência" description="Confira as admissões e a situação dos cadastros." />}
      <div className="table-note">
        <Info size={16} />
        <p>*Desconto de transporte calculado separadamente com o percentual configurado de {snapshot.settings.transportDiscountPercent}%. Os valores exibidos não incluem INSS, IRRF ou outros componentes de uma folha líquida.</p>
      </div>
    </section>
  </>;
}
