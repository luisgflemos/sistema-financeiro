# Retirada explícita de extratos de teste

Pedido aprovado em 24/11/2026: retirar exclusivamente os movimentos da carga de teste, preservando todos os cadastros e os lançamentos previstos independentes.

A tela Histórico permite selecionar um único arquivo, conferir conta, período e contagens e retirar o lote. A API exige sessão existente no ambiente hospedado e token da prévia recalculado sob bloqueio da organização. Nenhuma ação ocorre durante deploy ou inicialização.

Antes da exclusão, uma cópia integral dos registros, incluindo o arquivo original, é inserida na auditoria imutável na mesma transação. A interface permite restaurar essa cópia; uma reimportação conflitante bloqueia a restauração inteira, sem resultado parcial. As cópias não entram em consultas financeiras, deduplicação ou aprendizado da IA. Dados reais nunca vão ao repositório.

Somente import_files, statement_contents, bank_transactions, statement_rows, transaction_identifications e transaction_suggestions do arquivo são retirados. Cadastros, usuários, organizações, lançamentos previstos, séries e auditoria existente não são excluídos. A exclusão é bloqueada se houver baixas de previstos (inclusive desfeitas) ou referências de outros extratos aos movimentos, exigindo tratamento específico desses vínculos.

Exceção controlada à imutabilidade para descarte de teste: os gatilhos históricos dessas seis tabelas são suspensos apenas dentro da transação com bloqueio exclusivo e reativados antes do commit; qualquer falha desfaz inclusive o DDL. Chaves estrangeiras e auditoria continuam ativas. Não há TRUNCATE, exclusão global, cascata sobre cadastros, alteração de autenticação ou endpoint público de manutenção.
