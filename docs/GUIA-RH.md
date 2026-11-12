# Guia de uso — Dessine RH

Versão 1.0.0 • 12/11/2026

## 1. O que o painel organiza

O Dessine RH reúne o cadastro dos colaboradores, faltas, salários base, alimentação, transporte, compromissos administrativos de pagamento e histórico de alterações. A competência é o mês de referência da folha. A data prevista de pagamento pode pertencer a outro mês.

O total administrativo soma salários base e benefícios. Ele não representa salário líquido. Registros de pagamento servem para controle interno e não realizam transferências bancárias.

## 2. Perfis e acesso

| Atividade | Departamento Pessoal | Financeiro | Diretoria |
|---|---|---|---|
| Consultar painel, colaboradores e benefícios | Sim | Sim | Sim |
| Cadastrar e editar colaboradores | Sim | Não | Não |
| Lançar/anular faltas | Sim | Não | Não |
| Calcular uma prévia | Sim | Sim | Sim |
| Fechar e reabrir competência | Sim | Não | Não |
| Registrar/reverter pagamento | Sim | Não | Não |
| Alterar regras e usuários | Sim | Não | Não |
| Exportar relatórios autorizados | Sim | Sim | Sim |

Essa matriz preserva a origem, na qual Financeiro e Diretoria consultam. Se a empresa decidir que Financeiro deve registrar pagamentos, essa alteração deve ser feita tanto na API quanto na interface, com teste específico.

Entre com seu usuário e senha. Use uma conta individual por pessoa para que o histórico identifique o responsável. Ao encerrar o trabalho, selecione Sair. Em ambiente local, o aviso de validação indica dados de teste; ele não comprova conexão com a base real.

## 3. Rotina mensal recomendada

1. Selecione a competência correta.
2. Confira admissão, situação, cargo, salário base e transporte dos colaboradores.
3. Confira faltas do período de apuração e se cada falta desconta benefícios.
4. Revise feriados e regras de benefício aplicáveis.
5. Abra Folha & benefícios e calcule a prévia.
6. Confira dias, valores por pessoa e totais.
7. Se houver admissão/desligamento no mês, confira manualmente o salário com o responsável pela folha. O sistema limita dias de benefícios, mas não presume regra de proporcionalidade salarial.
8. Feche a competência após conferir os valores.
9. Exporte ou imprima o resultado necessário.
10. Registre os pagamentos somente após confirmar a operação no procedimento financeiro da empresa.

## 4. Visão geral

Os cartões mostram colaboradores, salários base, alimentação, transporte, totais e situação da competência a partir da API. O histórico considera folhas existentes; ausência de histórico não é crescimento zero. A agenda usa os pagamentos da competência selecionada e suas respectivas datas previstas.

Confira sempre o mês no topo. Indicadores de pendência e atraso são administrativos: uma data vencida não comprova que a empresa deixou de pagar, apenas que o pagamento ainda não foi registrado como realizado.

## 5. Colaboradores

Use a busca por nome, cargo ou departamento e o filtro de situação. A listagem é paginada. Para criar um cadastro, preencha nome, cargo, departamento, admissão, salário base e opção de transporte. Valores são apresentados em reais e armazenados em centavos.

Se utiliza transporte, informe o valor diário total aplicável. Se não utiliza, desative a opção. Para inativar um colaborador, registre a data de desligamento; não exclua o histórico de folhas.

Ao editar, o sistema utiliza a revisão do cadastro. Se outra pessoa já alterou o mesmo registro, a gravação deve ser recusada e você precisa atualizar a tela antes de tentar de novo. Confira o que mudou para não sobrescrever informação mais recente.

Mudanças cadastrais não reescrevem folhas já fechadas. Para corrigir uma competência fechada, siga o procedimento de reabertura.

## 6. Faltas

Escolha o colaborador, a data e uma observação objetiva. Evite colocar diagnósticos, dados médicos ou informações pessoais desnecessárias em texto livre. A opção de desconto de benefícios determina se a ocorrência reduz alimentação e transporte na janela correspondente.

Uma mesma pessoa não pode ter duas faltas ativas na mesma data. A anulação solicita motivo e preserva evidência no histórico. Uma falta que afeta competência já fechada exige tratar a competência primeiro.

O filtro Mês das faltas consulta o mês da ocorrência. Esse mês pode ser diferente da competência em que o desconto será aplicado.

## 7. Alimentação, transporte e datas

Configuração observada na origem:

| Regra | Valor observado |
|---|---|
| Alimentação diária | R$ 28,00 |
| Meio de alimentação | Cartão Caju |
| Janela de alimentação | Primeiro ao último dia do mês |
| Janela de transporte | Dia 6 ao dia 5 do mês seguinte |
| Pagamento de salário base | Dia 5 do mês seguinte |
| Pagamento de transporte | Dia 5 da competência |
| Pagamento de alimentação | Último dia útil do mês anterior |
| Fechamento de faltas | Dia 31, interpretado como fim do mês |
| Indicador de desconto de transporte | 4% da base, limitado ao benefício concedido |

Esses parâmetros foram observados no aplicativo enviado; não são uma prescrição legal. Feriados precisam ser cadastrados. Não há calendário municipal automaticamente confirmado. Os dias sugeridos contam segunda a sexta e retiram os feriados configurados.

Com fechamento no último dia, a folha de novembro considera as faltas de outubro. Com fechamento no dia 25, a folha de novembro considera 26 de setembro a 25 de outubro. O motor evita valores negativos quando o número de faltas supera os dias elegíveis.

O indicador de desconto VT aparece separado. Ele não é subtraído automaticamente da programação do salário base. A definição do valor líquido a transferir continua no processo de folha homologado da empresa.

## 8. Calcular e fechar

Calcular produz uma prévia. Ajustar dias úteis exige recalcular. O fechamento compara a revisão conferida com os dados atuais. Se um cadastro, regra ou falta mudar e alterar o cálculo, a prévia será recusada como desatualizada.

Use **Conferência de fechamento** para comparar o mês atual com a folha fechada do mês imediatamente anterior. Confira as diferenças de salário base, alimentação, transporte e total administrativo, além das cinco maiores variações por pessoa. Entradas e saídas indicam presença em uma das folhas comparadas. Quando falta uma folha anterior fechada, o painel informa que não há base para comparar.

O fechamento válido preserva a fotografia dos parâmetros, pessoas, dias e valores usados e cria os compromissos de salário base, alimentação e transporte na mesma transação. Uma segunda tentativa não deve criar outra folha fechada ou duplicar pagamentos.

## 9. Reabrir e corrigir

1. Identifique a competência e o erro.
2. Confira se há pagamentos registrados como pagos.
3. Se o registro de pagamento estiver incorreto, reverta-o com motivo, conforme procedimento interno. A reversão no painel não estorna dinheiro no banco.
4. Reabra a competência com uma justificativa.
5. Corrija os dados de origem.
6. Calcule, confira e feche novamente.

A reabertura anula os compromissos pendentes daquela versão e mantém a versão anterior. Não deve ser permitida enquanto existirem pagamentos confirmados na versão fechada.

Em **Folha & benefícios**, selecione a competência e abra **Histórico de versões**. Escolha o fechamento para consultar os valores e a situação da versão. Imprimir uma versão usa os valores daquele fechamento.

## 10. Pagamentos

Filtre por competência e situação. Confira descrição, valor e data prevista antes de registrar como pago. O registro não comprova liquidação bancária nem gera um arquivo de remessa.

Para desfazer um registro administrativo incorreto, use Reverter e informe o motivo. A mudança deve entrar no histórico e o compromisso volta a ficar pendente. Se a informação foi alterada por outro operador, atualize a tela antes de repetir.

## 11. Configurações

Altere somente parâmetros aprovados pela empresa. As novas regras valem para os próximos cálculos e não modificam fotografias já fechadas. Documente a data de vigência esperada quando houver alteração.

Para feriados, informe datas válidas, sem duplicatas. Confira separadamente os calendários da alimentação e do transporte porque as janelas são diferentes. A versão inicial não mantém regras salariais completas por sindicato, escala, convenção ou estabelecimento.

## 12. Usuários

O Departamento Pessoal cria contas e escolhe o perfil. Financeiro e Diretoria consultam. A desativação de uma conta deve impedir novos acessos e invalidar sessões conforme implementação testada.

O sistema protege o último DP ativo e impede a autodesativação. Use o menu da conta para trocar a própria senha. Se um DP perder o acesso, o responsável pelo banco pode executar a recuperação descrita em [Operação](OPERACAO.md).

## 13. Histórico, exportação e impressão

O histórico registra autor, ação, entidade, resumo e horário. Use-o para localizar alterações e justificativas. Ele não substitui backup.

Exportar CSV gera um arquivo compatível com planilhas. Valores que poderiam ser interpretados como fórmulas devem ser neutralizados. O arquivo contém dados de RH; compartilhe apenas pelo procedimento autorizado da empresa.

Imprimir deve apresentar a competência e os valores sem a navegação. A validação da impressão no navegador e do uso em celular faz parte do aceite antes da produção.

## 14. Mensagens frequentes

| Mensagem/situação | O que fazer |
|---|---|
| Sessão expirada | Entre novamente; confira se uma gravação anterior foi concluída antes de repetir |
| Sem permissão | Verifique o perfil; ocultar botão não substitui a autorização no servidor |
| Dados alterados por outro usuário | Atualize e compare o registro recente |
| Prévia desatualizada | Recalcule, confira e feche novamente |
| Falta duplicada | Consulte a data já lançada; não crie outro registro |
| Competência fechada | Use a correção com reabertura e motivo |
| Pagamento confirmado impede reabertura | Confira o pagamento; reverta apenas se o registro estiver incorreto |
| Não foi possível carregar | Tente atualizar; se persistir, informe o horário e a operação ao suporte sem enviar senha |
| Base não configurada | O responsável técnico deve concluir banco/ambiente; não utilizar dados locais como base oficial |

## 15. Antes de usar com dados reais

Confirme URL, ambiente, perfis, banco compartilhado, backup, recuperação e migração reconciliada. Faça uma competência de homologação com totais conhecidos e valide o resultado com o responsável pelo DP. A documentação descreve a intenção e o comportamento implementado; o relatório de testes registra o que foi efetivamente verificado.
