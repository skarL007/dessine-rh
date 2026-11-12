# Contrato HTTP v1

Todas as rotas de dados exigem sessão Better Auth (cookie HttpOnly). Respostas JSON sem envelope, erros `{error,code?}`. Mutações JSON same-origin. Valores monetários inteiros em centavos; datas YYYY-MM-DD; mês YYYY-MM. DP altera; financeiro/diretoria consultam. Pagamentos são registros administrativos, sem transferência bancária.

## Autenticação
- POST `/api/auth/sign-in/username` `{username,password}` Better Auth; sessão por cookie.
- POST `/api/auth/sign-out` `{}`.
- POST `/api/auth/change-password` `{currentPassword,newPassword,revokeOtherSessions:true}`.
- GET `/api/bootstrap` → `Bootstrap`; 401 não autenticado, 503 banco/configuração ausente.

## Dados
- GET `/api/overview?month=YYYY-MM` → `Overview`.
- GET `/api/employees?q=&status=all|active|inactive&page=1&pageSize=20` → `PageResult<Employee>`.
- POST `/api/employees` `EmployeeInput` → Employee (201).
- PATCH `/api/employees/:id` `EmployeeInput` com version obrigatória → Employee; 409 concorrência.
- GET `/api/absences?month=YYYY-MM&page=1&pageSize=20` → `PageResult<Absence>`.
- POST `/api/absences` `{employeeId,date,reason,discountBenefits}` → Absence (201); duplicata 409.
- DELETE `/api/absences/:id` `{reason}` → `{ok:true}`; anulação auditada, bloqueada para competência fechada.
- GET `/api/payroll?month=YYYY-MM` → `{payroll:Payroll|null}`.
- GET `/api/payroll/:month/versions` → `{versions: PayrollVersionSummary[]}`, do fechamento mais recente ao mais antigo. Cada item contém `id`, `month`, `status`, `closedAt`, `closedBy`, `version` e `revision`.
- GET `/api/payroll/:month/versions/:revision` → `{payroll: Payroll & {revision: number}}`, incluindo o snapshot do fechamento. Uma versão inexistente retorna 404. `revision` identifica o fechamento na competência. `version` controla edições da mesma folha.
- POST `/api/payroll/calculate` `PayrollCalculation` → `PayrollSnapshot`, somente cálculo.
- POST `/api/payroll/close` `PayrollCalculation` com `expectedSourceVersion` retornado pela prévia → `Payroll` (201); servidor compara a revisão com cálculo atual e rejeita prévia desatualizada (409). Fechamento e pagamentos na mesma transação; duplicata 409.
- POST `/api/payroll/:id/reopen` `{reason,version}` → `{ok:true}`; bloqueado se algum pagamento estiver pago; anula pagamentos pendentes, preserva histórico.
- GET `/api/payments?month=YYYY-MM&status=all|pending|paid&page=1&pageSize=20` → `PageResult<Payment>`.
- POST `/api/payments/:id/confirm` `{version,note?}` → `Payment`; somente DP, registra pagamento já realizado.
- POST `/api/payments/:id/reverse` `{version,reason}` → `Payment`; somente DP.
- GET `/api/settings` → `Settings`.
- PUT `/api/settings` `Settings` → `Settings`; valida version; mudanças não alteram snapshots.
- GET `/api/audit?page=1&pageSize=20` → `PageResult<AuditEvent>`.
- GET `/api/users` → `User[]` (DP).
- POST `/api/users` `{username,name,password,role}` → User (DP). Conta, credencial e evento de auditoria entram na mesma transação.
- PATCH `/api/users/:id` `{name,role,active}` → User (DP); não desativar a si próprio ou remover último DP.
- GET `/api/export/employees` → CSV UTF-8 BOM, células neutralizadas contra fórmulas.
- GET `/api/export/payroll?month=YYYY-MM` → CSV folha fechada, caso contrário 404.
- GET `/api/health` → apenas `{status,version}`, 503 quando não pronto; sem segredos.

Listas limitam pageSize em 100. Busca de funcionários usada nos seletores. UI sempre mostra estados vazio, carregando, falha e repetição manual; não usa fallback fictício após erro de API.

As escritas administrativas verificam sessão, conta ativa e perfil novamente após adquirir o bloqueio. Uma revogação confirmada antes dessa segunda checagem impede a escrita enfileirada.
