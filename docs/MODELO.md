# Modelo de dados

PostgreSQL guarda os dados operacionais. A API serializa valores monetários em centavos inteiros, datas civis em `AAAA-MM-DD` e instantes de auditoria em timestamps com fuso. O motor interpreta a competência e suas janelas no calendário, independentemente do fuso do servidor.

| Entidade | Registro e invariantes |
|---|---|
| `user`, `account`, `session`, `verification`, `rateLimit` | Identidade, credenciais, sessões e limitação de tentativas do Better Auth. `appRole` define DP, Financeiro ou Diretoria. |
| `settings` | Linha única com parâmetros, feriados e versão de edição. O bloqueio dessa linha ordena as escritas de negócio. |
| `employees` | Cadastro e vínculo com admissão, desligamento, salário base, transporte e versão de edição. |
| `absences` | Ocorrência por colaborador e data. Um índice impede duas faltas ativas na mesma data. Anular preserva o registro e o motivo. |
| `payrolls` | Um snapshot por fechamento. Um índice permite uma folha fechada por competência. Reabrir preserva o snapshot e o número do fechamento. |
| `payments` | Compromissos administrativos por folha, tipo, valor e vencimento. Confirmar e reverter atualizam a versão e geram eventos. |
| `audit` | Autor, ação, entidade, horário e resumo. As escritas de negócio persistem seus eventos na mesma transação. |
| `schema_migrations` | Versões aplicadas pelo comando `npm run db:migrate`. |

Uma folha guarda a cópia das regras e dos valores usados no fechamento. O número do fechamento identifica a folha na competência. A versão de edição protege a mudança de estado da própria folha. A revisão da prévia identifica o cálculo conferido antes de fechar. Os três valores têm funções distintas.

O pagamento pertence à folha que o originou. A reabertura exige uma justificativa, depende da ausência de pagamentos confirmados e cancela os compromissos pendentes dessa folha. Um novo fechamento gera seus próprios compromissos. Consulte os formatos de requisição em [API.md](API.md) e as fórmulas em [CALCULOS.md](CALCULOS.md).
