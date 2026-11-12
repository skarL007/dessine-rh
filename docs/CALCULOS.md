# Cálculos administrativos — versão 1

Decisão de implementação em 12/11/2026: preservar as janelas informadas do painel de origem v16, com calendário validado, valores inteiros em centavos e datas calculadas em UTC. O teste de regressão usa três registros anônimos com salários de R$ 2.000, R$ 3.000 e R$ 5.000, VT diário de R$ 11, R$ 24 e R$ 12 e alimentação diária de R$ 28. Em novembro/2026, sem feriados cadastrados, 21 dias úteis e uma falta da primeira pessoa resultam em R$ 1.736 de alimentação e R$ 976 de transporte. O percentual de VT observado nas configurações da origem é 4%; nesse caso, o indicador separado de desconto em folha soma R$ 400. Esse percentual é uma configuração da empresa, não uma norma presumida pelo sistema.

## Janelas e critérios

- Alimentação: primeiro ao último dia da competência. Transporte: dia configurado de início até a véspera do mesmo dia no mês seguinte (padrão: 6 a 5).
- Dias elegíveis: segunda a sexta, exceto feriados cadastrados, limitados pelas datas de admissão e desligamento, ambas inclusivas.
- O sistema não presume feriados nacionais, estaduais, municipais ou convenções. Cadastre o calendário aplicável antes de fechar a competência.
- Faltas: dia seguinte ao fechamento de dois meses antes até o fechamento do mês anterior. Novembro com fechamento 31 usa 01/10–31/10; com fechamento 25 usa 26/09–25/10. Dias 29–31 são limitados ao último dia existente no mês.
- Cada combinação colaborador/data conta uma vez. Somente faltas marcadas para descontar benefícios, na janela e durante o vínculo, são descontadas. A marcação explícita também vale para faltas de fim de semana; não se presume escala de trabalho a partir da data.
- A falta reduz os dias de ambos os benefícios. O resultado não fica negativo. `discountCents` representa apenas o valor efetivamente retirado dos benefícios por faltas.
- Overrides de dias úteis aceitam inteiros entre 0 e 31, até o total efetivo do calendário. Admissões e desligamentos continuam limitando o direito individual; um override não amplia o vínculo.
- Colaborador inativo com data de desligamento participa se houve vínculo na janela calculada. Inativo sem data é excluído. Quem foi admitido no mês seguinte, mas dentro da janela do VT, pode receber apenas esse benefício na competência anterior.

## Salário e desconto de VT

O salário é a **base integral cadastrada** quando há vínculo na competência. Não há rateio implícito por admissão/desligamento, cálculo de INSS, IRRF, FGTS, férias, rescisão ou interpretação de convenção coletiva. A linha de salário não deve ser apresentada como salário líquido homologado.

`transportPayrollDeductionCents` é o menor entre o VT concedido e o percentual configurado sobre a base salarial da competência. O cálculo arredonda meio centavo para cima com aritmética inteira. Esse valor aparece separadamente e **não é subtraído automaticamente da programação administrativa de salários**.

`totalCents` = salário base + alimentação após faltas + transporte após faltas. `discountCents` e `transportPayrollDeductionCents` são indicadores separados e não voltam a ser subtraídos do total.

## Programação

Salário: dia configurado no mês seguinte (padrão 5). Alimentação: último dia útil do mês anterior, considerando os feriados cadastrados. Transporte: dia configurado na própria competência (padrão 5). Os pagamentos de salário e transporte mantêm o dia do calendário mesmo em fim de semana; qualquer ajuste por regra trabalhista, bancária ou convenção exige regra validada antes de ser implementado.

Os valores são registros administrativos; não executam transferências. Configurações posteriores não modificam snapshots fechados. `foodDays` e `transportDays` de cada pessoa representam dias líquidos após faltas; os campos globais `foodBusinessDays` e `transportBusinessDays` representam os dias escolhidos antes de limitar o vínculo e descontar faltas.

## Condição de revisão

Revisar as fórmulas se o responsável de DP fornecer regra diferente de rateio salarial, calendário, escala, período de faltas ou desconto. Evidências pendentes: homologação do responsável com uma competência real, calendário da empresa e enquadramento aplicável. Os testes automatizados confirmam os contratos descritos, não homologação legal nem operação bancária.
