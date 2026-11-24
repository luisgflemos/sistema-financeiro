# Classificações por natureza e Processos Automáticos neutros

Decisão confirmada: movimentos normais de crédito aceitam classificações de Receita; débitos aceitam classificações de Despesa. Transferências entre contas próprias aceitam somente classificações Neutras, quando informadas; a identificação gerencial continua opcional nessa exceção.

Processos Automáticos são neutros pelo próprio tratamento, sem exigir classificação, subclassificação, centro de custos ou cliente/fornecedor. A interface retira esses campos e o servidor limpa dimensões residuais ao salvar esse tratamento. Data, valor, histórico bancário e Descrição Complementar são preservados. Aplicações e resgates automáticos não viram receitas/despesas; rendimentos, tarifas, IOF e IR reais continuam identificados normalmente.

O filtro vale para formulários de identificação e de receitas/despesas previstas. O servidor valida a natureza na identificação direta, no aprendizado por padrões, nas sugestões generativas e na criação/edição/vinculação de previsões. Trocar o tratamento limpa classificação/subclassificação incompatíveis. Não se alteram registros históricos silenciosamente: correções geram novas versões auditadas.

A escolha manual do tratamento é confirmada pelos botões de salvar existentes. Sugestões generativas continuam sujeitas à confirmação; padrões confiáveis já confirmados podem reconhecer Processos Automáticos sem pedir dimensões adicionais. Não se presume que todo crédito de aplicação seja rendimento, nem que todo PIX seja transferência própria.
