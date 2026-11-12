import { ArrowDown, ChartNoAxesColumnIncreasing } from 'lucide-react';
import { isoDate, monthStart, parseMonth } from '../../shared/date';
import type { Payroll, PayrollItem, PayrollSnapshot } from '../../shared/types';
import { useQuery } from '../api';
import { ErrorState, Loading } from '../components';
import { money, monthLabel } from '../format';

const signedMoney = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', signDisplay: 'exceptZero' });
const totals = [
  { label: 'Total administrativo', field: 'totalCents' },
  { label: 'Salários base', field: 'salaryCents' },
  { label: 'Alimentação', field: 'foodCents' },
  { label: 'Transporte', field: 'transportCents' },
] as const;

function amount(item: PayrollItem | undefined) {
  return item ? item.salaryCents + item.foodCents + item.transportCents : 0;
}

function employeeChanges(current: PayrollSnapshot, previous: PayrollSnapshot) {
  const currentById = new Map(current.items.map(item => [item.employeeId, item]));
  const previousById = new Map(previous.items.map(item => [item.employeeId, item]));
  const changes = [];
  for (const [id, person] of new Map([...previousById, ...currentById])) {
    const after = currentById.get(id);
    const before = previousById.get(id);
    const delta = amount(after) - amount(before);
    if (after && before && delta === 0) continue;
    changes.push({
      id,
      name: person.name,
      delta,
      description: !before ? 'Entrou na folha' : !after ? 'Saiu da folha' : 'Total alterado',
    });
  }
  return changes.sort((left, right) =>
    Math.abs(right.delta) - Math.abs(left.delta) || left.name.localeCompare(right.name, 'pt-BR'),
  );
}

export default function PayrollComparison({ snapshot, closed }: { snapshot: PayrollSnapshot; closed: boolean }) {
  const previousMonth = isoDate(monthStart(parseMonth(snapshot.month), -1)).slice(0, 7);
  const reference = useQuery<{ payroll: Payroll | null }>(`/api/payroll?month=${previousMonth}`);
  const previous = reference.data?.payroll?.status === 'closed' ? reference.data.payroll.snapshot : null;
  const previousLabel = monthLabel(previousMonth);
  const currentLabel = monthLabel(snapshot.month);
  const changes = previous ? employeeChanges(snapshot, previous) : [];

  return <section className="panel payroll-comparison" aria-labelledby="payroll-comparison-heading">
    <div className="panel-heading">
      <div>
        <h2 id="payroll-comparison-heading"><ChartNoAxesColumnIncreasing size={18} aria-hidden="true" />Conferência de fechamento</h2>
        <p>Compare {closed ? 'o fechamento' : 'a prévia'} de {currentLabel} com a folha fechada de {previousLabel}.</p>
      </div>
    </div>
    {reference.loading ? <Loading label="Buscando folha anterior…" /> : null}
    {reference.error ? <ErrorState message={reference.error} retry={reference.reload} /> : null}
    {reference.data && !previous ? <p className="payroll-comparison-empty">A competência de {previousLabel} ainda não tem uma folha fechada para comparação.</p> : null}
    {previous ? <div className="payroll-comparison-grid">
      <div className="table-scroll" role="region" tabIndex={0} aria-label="Comparação dos totais da folha">
        <table className="data-table payroll-comparison-table">
          <thead><tr>
            <th scope="col">Componente</th>
            <th scope="col">Anterior</th>
            <th scope="col">Atual</th>
            <th scope="col">Diferença</th>
          </tr></thead>
          <tbody>{totals.map(({ field, label }) => <tr key={field}>
            <th scope="row">{label}</th>
            <td>{money(previous.totals[field])}</td>
            <td>{money(snapshot.totals[field])}</td>
            <td><strong>{signedMoney.format((snapshot.totals[field] - previous.totals[field]) / 100)}</strong></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="payroll-comparison-people">
        <h3>Maiores diferenças por colaborador</h3>
        {changes.length ? <>
          <p>Até cinco diferenças no total de salário base e benefícios.</p>
          <ul>{changes.slice(0, 5).map(change => <li key={change.id}>
            <span><strong>{change.name}</strong><small>{change.description}</small></span>
            <strong>{signedMoney.format(change.delta / 100)}</strong>
          </li>)}</ul>
        </> : <p>Os totais por colaborador e a lista de pessoas são iguais aos da folha anterior.</p>}
        <button className="text-button" type="button" onClick={() => {
          document.getElementById('payroll-employee-heading')?.focus();
        }}><ArrowDown size={15} aria-hidden="true" />Conferir valores por colaborador</button>
      </div>
    </div> : null}
  </section>;
}
