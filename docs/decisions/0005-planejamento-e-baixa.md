# Lançamentos previstos e vinculação ao extrato

Decisão aprovada: Transações reúne Importar Extrato, Histórico e Lançamentos. O extrato permanece a fonte do realizado bancário. Receitas/despesas manuais, inclusive passadas ou futuras, representam compromissos previstos e não criam movimentos bancários nem alteram saldos realizados.

Lançamentos possuem vencimento, valor previsto em BRL, classificação, subclassificação e centro de custos obrigatórios, cliente/fornecedor e conta opcional. Recorrências finitas geram ocorrências independentes, com vencimentos semanais, mensais ou anuais. Datas mensais preservam o dia original, limitado ao último dia do mês. Edições e cancelamentos atingem somente a ocorrência escolhida. Reenvio da criação é idempotente.

Um movimento do extrato pode ser identificado diretamente ou vinculado a um lançamento da mesma organização, moeda e direção. A vinculação copia os vínculos gerenciais e registra uma baixa pelo valor integral do movimento, de forma atômica e auditada. O original bancário nunca é alterado. Nesta entrega, um movimento vincula-se a um lançamento; um lançamento aceita vários movimentos para baixas parciais. Fracionar um mesmo movimento em vários compromissos não faz parte desta entrega.

O total realizado por lançamento é a soma das baixas ativas. O aberto é o previsto menos o realizado, limitado a zero. Pagamentos menores deixam saldo em aberto, salvo encerramento com diferença confirmado pelo usuário. Valores maiores também exigem confirmação explícita. Diferenças permanecem visíveis; previsto e realizado não são sobrescritos. Cancelar encerra somente o aberto e preserva o realizado.

Desvincular cria um evento de reversão imutável, reabre o saldo pertinente e mantém a identificação gerencial já registrada no movimento. O usuário pode então revisá-la ou fazer outro vínculo. Uma vinculação ativa impede identificação direta conflitante. Bloqueio da organização e versão esperada evitam baixa dupla ou gravações concorrentes silenciosas.

Os resumos de Lançamentos mostram previsto, realizado vinculado e aberto; não são saldo bancário nem DRE. Projeções completas e sugestões generativas de novas recorrências baseadas no histórico serão evoluções posteriores. A Fin pode orientar o usuário sobre estes fluxos, mas a conversa não grava compromissos nem baixas.
