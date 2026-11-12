# Registro de decisões

Projeto: Dessine RH • Data: 12/11/2026

| Decisão | Motivo e fonte | Condição de revisão | Evidência pendente |
|---|---|---|---|
| Escopo RH do link, sem estoque | Confirmação explícita do usuário nesta sessão | Novo mandato explícito | Nenhuma sobre o escopo |
| Preservar colaboradores, faltas, benefícios, pagamentos e três perfis | Interface autenticada DP Dessine v16 | Código/planilha revelar regra adicional | Acesso à origem completa |
| React/Vite + Express + PostgreSQL | Backoffice autenticado; interface estática e domínio transacional; docs oficiais Vercel/Better Auth | Padrão da equipe, volume ou integração justificar alternativa | Benchmark e banco remoto |
| Autenticação Better Auth e autorização na API | Evitar segredo no cliente e manter perfis consistentes | Provedor institucional de identidade exigido | Teste remoto e recuperação de acesso |
| PGlite restrito ao ambiente local | Validação SQL reproduzível sem usar dados reais | Nunca tornar persistência serverless local oficial | PostgreSQL remoto, restart/instância |
| Centavos inteiros e datas de calendário em string | Evitar erros monetários e deslocamentos de data | Mudança de moedas ou regra explicitamente aprovada | Integração pg DATE em ambiente real |
| Fechamento transacional e comparação da revisão da prévia | Impedir folha duplicada e fechamento de valores diferentes dos conferidos | Fluxo de aprovação mais complexo | Concorrência com múltiplas conexões Postgres |
| Salário base separado de líquido e desconto VT informativo | Origem não forneceu regras completas de folha fiscal | Responsável fornecer especificação/homologação | Rateio, encargos e regras adicionais |
| Seed exclusivamente fictício/local | Desenvolver sem publicar registros da origem | Não usar em produção | Migração reconciliada |
| Escritas de DP revalidam sessão e perfil após o bloqueio | Um pedido pendente pode atravessar uma revogação de acesso | Mudar a granularidade do bloqueio ou da sessão | Homologação da equipe de DP |
| Número de fechamento separado da revisão de edição | Identificar e consultar snapshots reabertos sem mudar a proteção contra edições concorrentes | Mudar o modelo de aprovação da folha | Homologação da equipe de DP |
| PostgreSQL distinto em homologação e produção | Isolar dados, credenciais e testes de implantação | Alterar o plano de operação aprovado pela empresa | Provisionamento remoto e conciliação da origem |

Correções desta sessão: o fixture inicial de teste foi ajustado para o percentual observado de 4%; nenhuma norma de 6% foi presumida. A auditoria também apontou diferença do parser DATE de pg em relação ao banco local, registrada no relatório independente. Não há credenciais nem dados pessoais reais neste registro.
