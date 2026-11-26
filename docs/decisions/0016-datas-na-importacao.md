# Datas antes da verificação de duplicidades

A leitura inicial `/statements/inspect` apresenta conta e datas disponíveis por arquivo, com contagens e totais. Não consulta movimentos anteriores nem executa deduplicação. O operador confirma quais datas deseja importar antes da chamada de prévia com deduplicação, inclusive quando o arquivo contém somente um dia.

`selected_dates` é uma seleção por arquivo, validada contra as datas presentes. Datas não selecionadas não entram na comparação de duplicidades, na gravação ou no reconhecimento. A API anterior continua aceitando ausência de seleção como todas as datas. Seleção vazia não permite gravar.

A prévia e seu token incluem as datas e totais selecionados. O commit refaz a conferência sob bloqueio por organização; mudanças exigem nova prévia. O arquivo original é preservado integralmente; linhas bancárias são gravadas apenas para os dias escolhidos. As assinaturas de contexto preservam a sequência original do extrato.

Um mesmo arquivo pode ser importado parcialmente em momentos diferentes. A rastreabilidade por conta, hash e linha consulta todas as gerações: dias anteriores são reconhecidos sem duplicar e dias deixados de fora continuam disponíveis. Exclusões só são restauradas quando suas datas forem selecionadas. A auditoria registra o conjunto de datas por arquivo. Nenhuma sugestão é aprovada automaticamente.
