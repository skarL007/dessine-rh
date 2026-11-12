# Revisão independente — segurança, precisão e concorrência

## Resultado da continuação

- Conta, credencial e evento de criação passaram a compartilhar uma transação. Uma falha simulada de integridade reverteu a operação inteira.
- As mutações revalidam sessão, conta ativa e perfil após adquirir o bloqueio. Os testes PostgreSQL cobriram rebaixamento de perfil, desativação e logout durante a espera.
- A migração v3 numerou os fechamentos por competência, preservou snapshots e liberou a consulta e impressão de versões reabertas. A conferência antes do fechamento compara a prévia com a folha fechada do mês anterior.
- A integração com PostgreSQL real preservou datas civis, centavos acima de 32 bits e a integridade sob concorrência. A agenda passou a respeitar a competência selecionada.
- A autenticação agora acompanha a conexão ativa. Um teste de integração e um ensaio com PostgreSQL remoto confirmaram que reabrir a conexão permite novo login e leitura da folha persistida.
- O navegador confirmou o fluxo com dados fictícios. O teste automatizado de acessibilidade cobriu cinco estados. Não houve ensaio manual com leitor de tela.

Os apontamentos abaixo preservam o diagnóstico de origem. Consulte [VALIDACAO.md](VALIDACAO.md) para a evidência atual. A migração dos dados de negócio, o CI remoto e a verificação do deploy definitivo dependem da conta de destino e da origem autorizada.

## Registro da revisão de origem

Data: 12/11/2026. Aplicação: Dessine RH 1.0.0, código em construção, sem commit final no momento desta revisão. Escopo: `server/**`, `server.ts`, `scripts/seed.ts`, contratos HTTP e chamadas do frontend. Nenhum dado do servidor foi modificado durante a auditoria; nenhum deploy ou teste em produção foi executado.

## Conclusão

Há controles explícitos de autenticação, autorização e fechamento transacional. A revisão encontrou um defeito de integração com PostgreSQL que impediria os cálculos em produção; o parser de datas já foi corrigido no código, mas ainda exige teste com PostgreSQL real. Outros itens concretos abaixo devem ser resolvidos ou aceitos antes de afirmar que a operação em produção foi validada.

## Achados e situação

### P1 — Datas de PostgreSQL chegavam como `Date`, incompatíveis com o domínio

- Arquivo: `server/db.ts`, construção de `Pool`.
- Evidência executada sem conexão com banco: em `pg@8.23.1`, `types.getTypeParser(1082, 'text')('2026-11-01')` retornou objeto `Date`, com ISO `2026-11-01T04:00:00.000Z` no fuso do processo.
- Efeito: `calculatePayroll` exige `AAAA-MM-DD`; o cálculo rejeitaria datas reais vindas do driver de produção. Comparações das datas de faltas e valores de campos `<input type="date">` também seriam inconsistentes.
- Situação na última leitura: **corrigido no código e coberto em teste local** com parser específico de OID 1082 que preserva a string nos dois adapters. A suíte final API do responsável passou 7/7, incluindo contrato de DATE string. Isso não substitui o teste com o driver conectado ao PostgreSQL remoto.
- Teste restante: executar inserção/listagem de colaborador e cálculo/fechamento usando `DATABASE_URL` de um PostgreSQL isolado, incluindo admissão, desligamento, falta e vencimento. PGlite não substitui esse teste.

### P2 — Total de pagamento pode exceder o limite da coluna

- Arquivos: `server/db.ts`, coluna `payments.amountCents`; `server/validation.ts`, limite individual de salário; `server/app.ts`, fechamento.
- Evidência de código: o cadastro aceita até `1_000_000_000` centavos por salário, enquanto a coluna do pagamento agregado usa `integer` de 32 bits. Três cadastros válidos nesse limite somam `3_000_000_000` centavos, acima de `2_147_483_647`.
- Efeito esperado: a prévia é válida no domínio, mas o `INSERT` do pagamento falha no fechamento. A transação deve reverter tudo; o limite de escala fica escondido em um erro interno.
- Situação na leitura final: **corrigido no código e coberto em teste local**. `payments.amountCents` passou para `bigint`; migração v2 converte instalações anteriores. `parseSafeInteger` foi instalado nos dois adapters para OID 20. Verificação isolada confirmou `3_000_000_000` preservado e inteiro acima de `Number.MAX_SAFE_INTEGER` rejeitado. A suíte final API do responsável passou 7/7, incluindo contrato de 3 bilhões de centavos.
- Correção recomendada: coluna agregada `bigint`, migração explícita e conversão para números somente com `Number.isSafeInteger`; alternativamente validar e informar o limite agregado antes do fechamento. Não truncar ou arredondar os centavos.
- Teste restante: fechar competência que ultrapasse o limite de 32 bits, verificar soma exata e confirmar que folha e três pagamentos são criados uma única vez.

### P2 — Readiness retornava sucesso sem configuração inicial

- Arquivo: `server/app.ts`, `GET /api/health`.
- Evidência de código: a consulta `SELECT id FROM settings WHERE id=1` é executada, mas seu resultado não era conferido. Uma tabela existente e vazia passa no healthcheck; `settingsOf` rejeita a mesma situação com 503.
- Situação na leitura final: **corrigido no código e coberto em teste local**. Health exige `settingsOf` e versão máxima de migração igual a 2. O teste de remoção/restauração da configuração em banco exclusivo de testes confirmou 503 sem configuração; a suíte final API do responsável passou 7/7.
- Correção recomendada: exigir a linha de configuração e a versão de migração esperada antes de devolver `status: ok`.
- Reprodução sugerida: em banco exclusivo de teste, executar migração, remover a linha de configuração e confirmar health 503 e bootstrap 503. Não fazer isso no banco de trabalho.

### P3 — Regra de duas casas decimais aceitava precisão extra

- Arquivo: `server/validation.ts`, `settingsSchema.transportDiscountPercent`.
- Evidência executada: `safeParse` aceitou `4.12` e `4.12001`, mas rejeitou `4.123`. O refinamento usava `Number.isInteger(Math.round(n * 10000) / 100)`.
- Efeito: precisão acima da anunciada podia ser salva e alterar resultados em limites de arredondamento.
- Situação na leitura final: **corrigido e verificado isoladamente**. O refinamento passou a usar `Math.round(n * 100) / 100 === n`. Teste pós-patch: 4.12, 0.01 e 99.99 aceitos; 4.12001 rejeitado.
- Correção recomendada: `Math.round(n * 100) / 100 === n`, mantendo os limites de 0 a 100. Testar valores como 4.12, 4.12001, 0.01 e 99.99.

## Pontos de segurança que dependem de teste adicional

Estes pontos foram identificados por leitura; não são apresentados como explorações reproduzidas.

1. **Criação de usuário e auditoria não são atômicas** (`server/app.ts`, `POST /api/users`). `createAppUser` ocorre antes do `audit`, fora de uma transação compartilhada. Se a auditoria falhar, pode haver conta criada com resposta 500 e sem evento de criação. Fazer injeção controlada de falha de auditoria em teste e definir garantia transacional ou reconciliação explícita.
2. **Revogação durante uma requisição já autorizada.** O perfil é lido no middleware antes de aguardar o bloqueio de escrita. Uma mutação já em andamento pode executar com o perfil previamente lido depois de uma revogação concorrente. Definir o critério de revogação desejado e testar em PostgreSQL; se a revogação precisar afetar requisições enfileiradas, reconferir usuário ativo e perfil dentro da transação.
3. **Versões antigas de folhas.** Snapshots reabertos permanecem no banco, mas o endpoint atual de folha retorna uma versão por competência. Preservação de dados existe; consulta de todas as versões anteriores pela interface ainda não foi demonstrada.

## Controles encontrados no código

- Better Auth com cadastro público desabilitado; HTTP expõe uma lista restrita de rotas de autenticação. A rota administrativa interna de criação de usuários não é encaminhada diretamente ao navegador.
- Sessões com cookie HttpOnly, SameSite Lax e Secure em HTTPS; cache de sessão desabilitado e consulta do usuário ativo a cada requisição de dados.
- Escritas exigem origem exata e conteúdo JSON. Perfis financeiro/diretoria não podem alterar dados; a exceção é o endpoint de cálculo, que não persiste alterações.
- Comandos SQL usam parâmetros. CSV inclui BOM, aspas escapadas e prefixo de proteção para células iniciadas por fórmula, inclusive após espaços e controles.
- `writeTransaction` bloqueia a linha de configurações com `FOR UPDATE` antes das escritas de negócio. Fechamento, reabertura e confirmação/reversão de pagamento usam essa mesma disciplina.
- Fechamento compara `expectedSourceVersion` da prévia, recalcula no servidor e cria snapshot e pagamentos na mesma transação. Índice parcial impede duas folhas fechadas para a mesma competência.
- Edição de colaborador/configuração e ações de pagamento conferem versão. Reabertura é bloqueada quando há pagamento confirmado e anula os compromissos pendentes da versão reaberta.
- Seed é explicitamente proibido com `VERCEL`, `DATABASE_URL` ou sem `APP_ENV=local`; exige senha recebida por variável de ambiente. Os registros de exemplo são sinalizados como fictícios no código e nos eventos.

Esses controles foram encontrados por inspeção. O relatório do executor dos testes API deve informar quais foram exercitados e seu resultado, sem converter esta revisão em evidência de uso real.

## Verificação já executada nesta linha de trabalho

- Motor de cálculo: Node v24.22.1, `node --import tsx --test tests/payroll.test.ts`, **13 testes aprovados e 0 falhas** após ajustar a configuração observada de VT para 4%.
- Typecheck isolado do domínio e de seus testes: aprovado.
- Reprodução do tipo de DATE do driver pg: executada, defeito confirmado e patch observado posteriormente.
- Reprodução da validação de casas decimais: executada, aceitação indevida confirmada; teste pós-patch confirmou a correção.
- Parser seguro de BIGINT: verificação isolada preservou 3 bilhões de centavos e rejeitou valor acima do limite seguro de JavaScript.
- O responsável pelo backend informou resultado final **7/7 testes API aprovados e typecheck aprovado**, incluindo DATE string, 3 bilhões de centavos e health 503 sem configuração. O teste adicional e os patches foram relidos nesta auditoria. Não reexecutei a suíte API; a execução completa foi do responsável pelo backend em banco PGlite isolado.
- Não executei CI, PostgreSQL remoto, migração em produção, carga, restauração de backup ou teste de navegador nesta auditoria.

## Gate sugerido para o próximo agente

1. Reconciliar os achados com os patches finais do backend e atualizar este documento, mantendo o diagnóstico original e sua correção.
2. Executar typecheck, build e suíte completa; registrar versão e commit exatos.
3. Em PostgreSQL isolado, testar a adaptação DATE e concorrência real: dois fechamentos simultâneos, falta versus fechamento, confirmação versus reabertura e atualização com versão antiga. Critério: uma única transição válida, conflito explícito no concorrente, nenhuma folha ou pagamento parcial.
4. Verificar cadastro público bloqueado, perfil de leitura bloqueado nas mutações, CSRF, revogação e exportação sem acesso em sessão encerrada.
5. Antes de publicação, conferir configuração, segredo, conexão com banco e migração. Testar no deploy de preview e repetir o fluxo essencial na URL publicada. Registrar separadamente teste local, CI, preview e produção.

O salário permanece base integral cadastrada, sem homologação de folha líquida ou rateio salarial. As fórmulas e condições de revisão estão em `docs/CALCULOS.md`. O teste de cálculo não comprova regra trabalhista, conciliação contábil ou transferência bancária.
