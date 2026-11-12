import { useState } from 'react';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, CalendarClock, CheckCircle2,
  ClipboardList, Coffee, FileCheck2, Users, Wallet,
} from 'lucide-react';
import type { Overview as OverviewData } from '../../shared/types';
import { useQuery } from '../api';
import { Badge, Empty, ErrorState } from '../components';
import { dateLabel, dateTimeLabel, money, monthLabel, shortMoney, today } from '../format';
import type { PageProps } from './types';

const costFilters = [
  { id: 'all', label: 'Total' },
  { id: 'salary', label: 'Salários' },
  { id: 'benefits', label: 'Benefícios' },
] as const;
type CostFilter = typeof costFilters[number]['id'];
type HistoryRow = OverviewData['monthlyHistory'][number];
const totalOf = (row: HistoryRow) => row.salaryCents + row.foodCents + row.transportCents;
const signedMoney = (amount: number) => amount === 0 ? money(0) : `${amount > 0 ? '+' : '−'}${money(Math.abs(amount))}`;

export default function Overview(props: PageProps) {
  const { data, loading, error, reload } = useQuery<OverviewData>(`/api/overview?month=${props.month}`);
  if (loading) return <div className="dashboard-skeleton" role="status" aria-label="Carregando visão geral"><span/><span/><span/></div>;
  if (error) return <ErrorState message={error} retry={reload} />;
  if (!data) return <Empty title="Competência indisponível" description="Selecione outro mês para consultar o painel." />;

  const previous = data.monthlyHistory.at(-2);
  const delta = previous?.closed ? data.totalCents - totalOf(previous) : null;
  const benefitTotal = data.foodCents + data.transportCents;

  return <div className="operations-dashboard">
    <section className="operations-hero" aria-labelledby="overview-title">
      <div className="hero-main">
        <span className="hero-period"><span />{monthLabel(props.month)}</span>
        <h1 id="overview-title">Visão geral</h1>
        <p>Acompanhe a folha, os benefícios e o que precisa de atenção nesta competência.</p>
        <button className="hero-action" onClick={() => props.navigate('payroll')}>Conferir folha <ArrowUpRight size={18} /></button>
      </div>
      <div className="hero-total">
        <div className="hero-total-label"><span>Total da competência</span><Badge tone={data.payrollStatus === 'closed' ? 'green' : 'amber'}>{data.payrollStatus === 'closed' ? 'Fechada' : 'Em preparação'}</Badge></div>
        <strong>{money(data.totalCents)}</strong>
        {delta !== null && <div className="hero-variance">
          {delta < 0 ? <ArrowDownRight size={16} /> : delta > 0 ? <ArrowUpRight size={16} /> : <CheckCircle2 size={16} />}
          <span><b>{signedMoney(delta)}</b> em relação a {monthLabel(previous!.month, true)}</span>
        </div>}
        <div className="hero-total-breakdown"><span>Salários <b>{money(data.salaryBaseCents)}</b></span><span>Benefícios <b>{money(benefitTotal)}</b></span></div>
      </div>
    </section>

    <div className="operations-shortcuts" aria-label="Indicadores e atalhos">
      <button onClick={() => props.navigate('employees')}>
        <span className="shortcut-icon"><Users size={20}/></span><span className="shortcut-body"><span>Colaboradores ativos</span><strong>{data.activeEmployees.toLocaleString('pt-BR')}</strong></span><ArrowRight size={17} className="shortcut-arrow"/>
      </button>
      <button onClick={() => props.navigate('payments')}>
        <span className="shortcut-icon"><Wallet size={20}/></span><span className="shortcut-body"><span>Pagamentos pendentes</span><strong>{money(data.pendingCents)}</strong>{data.overdueCents > 0 && <small className="shortcut-alert">{money(data.overdueCents)} em atraso</small>}</span><ArrowRight size={17} className="shortcut-arrow"/>
      </button>
      <button onClick={() => props.navigate('absences')}>
        <span className="shortcut-icon"><ClipboardList size={20}/></span><span className="shortcut-body"><span>Faltas na apuração</span><strong>{data.absences.toLocaleString('pt-BR')}</strong></span><ArrowRight size={17} className="shortcut-arrow"/>
      </button>
    </div>

    <div className="operations-grid">
      <CostHistory key={props.month} rows={data.monthlyHistory} onOpen={month => { props.onMonthChange(month); props.navigate('payroll'); }} />
      <section className="panel cost-composition">
        <div className="panel-heading"><div><h2>Composição da folha</h2><p>Valores de {monthLabel(props.month, true)}</p></div><span className="shortcut-icon"><Wallet size={18}/></span></div>
        <CostComposition salary={data.salaryBaseCents} food={data.foodCents} transport={data.transportCents} />
      </section>
    </div>

    <div className="operations-grid">
      <section className="panel agenda-panel">
        <div className="panel-heading"><div><h2>Agenda de pagamentos</h2><p>Compromissos pendentes da competência</p></div><button className="text-button" onClick={() => props.navigate('payments')}>Ver pagamentos <ArrowRight size={16}/></button></div>
        {data.upcomingPayments.length ? <ul className="agenda-list">
          {data.upcomingPayments.slice(0, 5).map(payment => <li key={payment.id}>
            <span className="shortcut-icon">{payment.kind === 'food' ? <Coffee size={18}/> : <CalendarClock size={18}/>}</span>
            <span className="agenda-item"><strong>{payment.description}</strong><span>Vencimento em {dateLabel(payment.dueDate)}</span></span>
            <span className="agenda-amount"><strong>{money(payment.amountCents)}</strong><Badge tone={payment.dueDate < today() ? 'red' : 'amber'}>{payment.dueDate < today() ? 'Em atraso' : 'Pendente'}</Badge></span>
          </li>)}
        </ul> : <Empty title="Nenhum compromisso pendente" description="Consulte os pagamentos registrados nesta competência." />}
      </section>
      <section className="panel departments-panel">
        <div className="panel-heading"><div><h2>Pessoas por área</h2><p>{data.activeEmployees} pessoas no quadro ativo</p></div><span className="shortcut-icon"><Users size={18}/></span></div>
        {data.departments.length ? <ul className="department-bars">{data.departments.map(department => <li key={department.name}>
          <div><span>{department.name || 'Sem departamento'}</span><b>{department.count}</b></div>
          <div className="department-track"><span style={{ width: `${(department.count / Math.max(1, data.activeEmployees)) * 100}%` }}/></div>
        </li>)}</ul> : <Empty title="Nenhum colaborador ativo" description="A distribuição aparece quando há pessoas no quadro ativo." />}
      </section>
    </div>

    <section className="panel activity-panel">
      <div className="panel-heading"><div><h2>Atividade recente</h2><p>Últimos eventos registrados</p></div><button className="text-button" onClick={() => props.navigate('audit')}>Ver histórico <ArrowRight size={16}/></button></div>
      {data.recentActivity.length ? <ul className="operations-activity">{data.recentActivity.slice(0, 4).map(event => <li key={event.id}><CheckCircle2 size={18}/><div><strong>{event.summary}</strong><span>{event.actorName} · {dateTimeLabel(event.createdAt)}</span></div></li>)}</ul> : <Empty title="Nenhuma atividade registrada" description="Os eventos aparecem conforme a equipe usa o painel." />}
    </section>
  </div>;
}

function CostHistory({ rows, onOpen }: { rows: HistoryRow[]; onOpen: (month: string) => void }) {
  const [filter, setFilter] = useState<CostFilter>('all');
  const [activeMonth, setActiveMonth] = useState(rows.at(-1)?.month);
  const selected = rows.find(row => row.month === activeMonth);
  const value = (row: HistoryRow) => filter === 'all' ? totalOf(row) : filter === 'salary' ? row.salaryCents : row.foodCents + row.transportCents;
  const max = Math.max(1, ...rows.map(value));
  const ceiling = max === 1 ? 1 : Math.ceil(max / 1_000_000) * 1_000_000;

  return <section className="panel cost-history">
    <div className="panel-heading"><div><h2>Evolução dos custos</h2><p>Últimas seis competências</p></div>
      <div className="cost-filter" role="group" aria-label="Filtrar gráfico de custos">
        {costFilters.map(option => <button key={option.id} type="button" aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>{option.label}</button>)}
      </div>
    </div>
    {rows.some(row => totalOf(row) > 0) ? <>
      <div className="cost-chart-layout">
        <div className="cost-scale" aria-hidden="true">{[1, .75, .5, .25, 0].map(fraction => <span key={fraction}>{shortMoney(ceiling * fraction)}</span>)}</div>
        <div className="cost-bars" role="group" aria-label="Selecionar mês no gráfico">
          {rows.map(row => <button type="button" key={row.month} className="cost-bar" aria-pressed={row.month === activeMonth} aria-label={`${monthLabel(row.month)}, ${money(value(row))}`} onClick={() => setActiveMonth(row.month)}>
            <span className="cost-column"><span style={{ height: `${value(row) / ceiling * 100}%` }}/></span>
            <span className="cost-month">{monthLabel(row.month, true)}</span>
          </button>)}
        </div>
      </div>
      {selected && <div className="cost-selection" aria-live="polite">
        <span><b>{monthLabel(selected.month)}</b><small>{costFilters.find(option => option.id === filter)?.label}</small></span>
        <strong>{money(value(selected))}</strong>
        <button type="button" className="text-button" onClick={() => onOpen(selected.month)}>Abrir folha <FileCheck2 size={16}/></button>
      </div>}
    </> : <Empty title="Sem valores no período" description="Selecione outra competência para consultar os fechamentos anteriores." />}
  </section>;
}

function CostComposition({ salary, food, transport }: { salary: number; food: number; transport: number }) {
  const slices = [
    { name: 'Salários base', amount: salary, color: 'salary' },
    { name: 'Alimentação', amount: food, color: 'food' },
    { name: 'Transporte', amount: transport, color: 'transport' },
  ];
  const total = salary + food + transport;
  let position = 0;
  return <>
    <div className="composition-visual">
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <circle className="composition-track" cx="80" cy="80" r="61" fill="none" strokeWidth="15"/>
        {slices.map(slice => {
          const percent = total ? slice.amount / total * 100 : 0;
          const offset = position;
          position += percent;
          return percent > 0 && <circle key={slice.color} className={`composition-${slice.color}`} cx="80" cy="80" r="61" pathLength="100" fill="none" strokeWidth="15" strokeDasharray={`${Math.max(0, percent - 1.1)} 100`} strokeDashoffset={-offset} transform="rotate(-90 80 80)"/>;
        })}
      </svg>
      <div><span>Total da folha</span><strong>{money(total)}</strong></div>
    </div>
    <ul className="composition-legend">{slices.map(slice => <li key={slice.color}><i className={`composition-${slice.color}`}/><span>{slice.name}</span><b>{money(slice.amount)}</b></li>)}</ul>
  </>;
}
