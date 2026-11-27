# Extrato Bancário e referências de saldo

Saldo de conta corrente é leitura bancária: incluir todos os movimentos ativos, inclusive os não identificados, transferências próprias e Processos Automáticos. Não misturar projeção, títulos previstos ou aplicações. Cada posição deve informar sua data; não chamar saldos de importações antigas de saldo em tempo real.

O Santander validado é exportado do mais recente ao mais antigo. Dentro de cada arquivo, inverter source_row para apresentar a ordem cronológica. A primeira referência automática usa um dia composto de movimentos de um único arquivo bancário com ao menos um saldo informado: subtrair dessa referência a soma dos movimentos do dia até aquela linha. A ordem bancária permite usar referência parcial sem exigir abertura manual. Linhas históricas não têm ordem bancária garantida e não fornecem âncora. Dados anteriores à referência continuam consultáveis, com saldo calculado indefinido. Não reconstruir dois anos de saldos sem referência como se fossem conferidos.

Arquivos do layout validado podem omitir saldo ou deixá-lo em branco; não converter ausência em zero. Validar o encadeamento sempre que houver duas referências, incluindo os movimentos intermediários sem saldo. Quando faltar a evidência de saldo, a deduplicação de arquivos sobrepostos permanece conservadora e exige revisão em caso de dúvida; reimportação do mesmo arquivo continua idempotente. Movimentos posteriores à última referência bancária têm saldo calculado aguardando conferência.

Para dias com vários arquivos, preservar ordem de cada arquivo e tentar encadear saldos a partir do saldo anterior. Quando a ordem não puder ser determinada de modo único, sinalizar ambiguidade. Não ordenar por valor ou identificador e chamar o resultado de conciliado. Comparar saldo calculado com cada referência importada; sinalizar diferenças e possíveis períodos incompletos, sem gerar ajustes automáticos. Dias sem movimentos não provam lacuna.

Somente na ausência de referência automática suficiente, pedir abertura manual: saldo no início da data escolhida, antes dos movimentos desse dia. Se uma referência suficiente passar a existir, ela prevalece e a tela informa que substituiu a referência manual; registro manual e auditoria são preservados. Ajustes anteriores à referência de abertura não são reaplicados; os posteriores são deltas no fim do dia, separados de créditos/débitos bancários. Ajuste exige motivo e não constitui receita/despesa ou lançamento bancário.

Registros manuais são imutáveis e idempotentes, com ator e horário; correção por estorno auditado. Operações isoladas por organização/conta, Decimal/NUMERIC, sem alteração do extrato original. Visão por conta com abertura do período, entradas, saídas, ajustes, fechamento calculado, saldo informado e divergências. Paginação e ordenação nunca recalculam o saldo sobre apenas a página ou sobre a ordem visual escolhida.


## Total de contas

O cartão Saldo Total soma com Decimal as últimas posições calculadas de todas as contas exibidas, incluindo saldos negativos e contas inativas com posição. Cada moeda tem seu próprio total, sem conversão implícita. Contas sem referência não são presumidas como zero: o cartão informa a cobertura e sinaliza total parcial. Datas distintas são explicitadas como intervalo de posições; valores com necessidade de conferência permanecem sinalizados. O cartão independe da conta selecionada e dos filtros do detalhamento e não altera movimentos.
