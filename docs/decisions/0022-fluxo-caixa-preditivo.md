# Fluxo de Caixa Preditivo — Gerencial

O módulo Gerencial reúne Fluxo de Caixa, Acompanhamento Financeiro e DRE. Esta entrega constrói Fluxo de Caixa; os demais módulos permanecem no roadmap.

O extrato e as baixas confirmadas são realizados. Previsto cadastrado usa somente saldo em aberto, sem cancelados/excluídos. Estimativas são uma camada distinta: não criam obrigações. Base integral da organização é lida; somente reconhecimentos confirmados NORMAL treinam projeções. Grupos são conta, direção, classificação, subclassificação e centro de custos; cliente não é imposto nem inferido para previsão agregada. Conta não determina centro de custos.

Projeção mensal usa até seis meses completos recentes, incluindo meses sem movimento como zero dentro da cobertura da conta. Exige presença em três meses e ocorrência nos últimos 90 dias. Tendência compara blocos recentes; sazonalidade só é aplicada com duas observações anteriores do mês do ano. Limites e fatores são explícitos. Despesas esparsas são alocadas no dia mediano; receitas/despesas frequentes seguem a distribuição histórica por dia da semana. Centavos são distribuídos exatamente.

Para cada grupo e mês, o valor realizado no mês e o valor em aberto cadastrado cobrem o orçamento estimado antes de gerar o residual. Títulos com centro/conta em branco reduzem a projeção no escopo compatível, sinalizando a cobertura sem atribuir dimensões silenciosamente. Não há matching automático de baixas por mera similaridade. Atrasados ficam fora do saldo projetado, com data de entrada/saída a definir; não presumir recebimento amanhã. Processos Automáticos e transferências não treinam projeções e não compõem realizados gerenciais. O saldo bancário inclui todos os movimentos e ajustes, sem chamar neutros de receita/despesa.

Saldo de partida vem da última posição por conta até a data-base, com cobertura e datas explícitas. Contas sem abertura não viram zero; filtragens gerenciais não têm saldo bancário próprio. Datas-base futuras são proibidas; horizonte limitado a 12 meses. Histórico incompleto, valores não identificados e posições defasadas geram alertas. Confiança alta significa estabilidade observada, não garantia.

O operador pode ajustar ou desconsiderar o orçamento estimado de um grupo/mês com justificativa; decisões são auditadas e não alteram banco nem contas a pagar/receber. A revisão otimista impede salvar sobre cálculo desatualizado. Converter uma estimativa em compromisso exige confirmação, usa o cadastro de Lançamentos e reduz o residual na próxima leitura. O Fin recebe agregados calculados e premissas para conversar sobre o fluxo, sem inventar valores nem gravar pelo chat.


## Cenários e movimentos neutros

Por orientação do usuário, movimentos neutros são integralmente desconsiderados nas entradas, saídas, composição e projeções deste módulo, inclusive na visão por conta. Permanecem no Extrato Bancário. O saldo da data-base é importado do acompanhamento bancário; a curva gerencial não reconstrói saldos passados com os neutros omitidos. Meses anteriores mostram realizados sem presumir saldo gerencial.

Cenários Base, Conservador e Otimista variam somente a camada estimada. Compromissos e realizados não mudam. A faixa usa desvio histórico médio absoluto, com premissa mínima de 5% e máxima de 30%; não é intervalo estatístico de confiança nem promessa. Conservador reduz receitas e aumenta despesas; Otimista faz o inverso. Revisões são isoladas por cenário e auditadas. Sugestões recorrentes podem virar lançamentos mensais de até 12 ocorrências, somente por confirmação do operador.
