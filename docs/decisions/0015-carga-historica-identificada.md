# Carga inicial do histórico identificado

Autorizada em 24/11/2026: importar a aba LANÇAMENTOS da base validada, com todas as ocorrências iguais preservadas. A exportação diária N-1 fornecida pelo usuário não deve perder linhas por coincidência de data, documento, descrição ou valor.

O importador lê somente a aba LANÇAMENTOS (até 20 MB compactados, 400 MB descompactados, 100 MB de XML da aba e 100.000 registros), ignorando dimensões infladas por formatação. Campos financeiros e vínculos precisam ser valores; fórmulas auxiliares são preservadas como origem, sem execução. Nenhum dado real nem arquivo de produção entra no repositório ou nos testes.

Unidade liga-se à conta por nome normalizado exato e único. Classificação/subclassificação e centro usam somente cadastros ativos existentes; ausência, ambiguidade ou divergência de natureza bloqueiam toda a carga. Não há criação ou edição de cadastro. Cliente/fornecedor permanece opcional e vazio, sem associação incerta pelo texto.

Cada linha vira um movimento bancário original e uma identificação versão 1 OPERATOR, pois a base já foi identificada e validada pelo usuário. Transferência Bancária vira INTERNAL_TRANSFER, com classificação neutra e centro opcional; receitas/despesas mantêm categoria, subcategoria e centro obrigatórios. Data, descrição, sinal, valor, documento, número da linha, L/F/D e todas as colunas de origem são preservados. Saldo ausente permanece nulo; não é inventado nem reconciliado artificialmente. Esta carga não cria previstos nem baixas.

Uma prévia apresenta quantidade, período, créditos, débitos e transferências por conta. Um token inclui bytes da origem, vínculos e estado da carga. O commit revalida sob bloqueio da organização e grava todas as contas em uma transação, usando inserções em lote. São mantidos um arquivo lógico por conta, uma cópia integral do XLSX por arquivo e uma auditoria por lote. O custo de cópias repetidas do arquivo é aceito nesta carga inicial para preservar a recuperação independente por conta; armazenamento compartilhado poderá ser otimizado futuramente sem perder rastreabilidade.

O identificador por conta inclui a sequência de fatos financeiros e linhas, preservando multiplicidade e ignorando alterações somente de metadados do XLSX ou classificação. Reenvio da mesma carga é idempotente, sem atualizar classificações existentes. Cargas diferentes exigem histórico vazio (ou apenas os arquivos idênticos já presentes); qualquer outra movimentação bloqueia sobreposição silenciosa. O hash original dos bytes também é armazenado na origem e auditoria. A carga histórica não muda a deduplicação dos extratos bancários regulares.

Após o commit, a interface consulta quantidade, totais e identificações por conta e compara com a prévia. A regra de reconhecimento passa a consultar toda a base confirmada para padrões; a IA recebe até 150 exemplos relevantes ao lote em análise, e não apenas os últimos 500 registros. Nenhuma chamada à IA ocorre durante a importação.
