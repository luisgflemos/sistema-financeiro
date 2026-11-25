# Exclusão de movimentos importados

Seleção individual, da página ou de todos os resultados do filtro. Selecionar todos consulta o conjunto completo no servidor antes da paginação; mudar filtros ou organização limpa a seleção. A prévia congela os IDs e mostra período, contas, totais e quantidade identificada. Confirmar exige um token do estado conferido; qualquer mudança exige nova prévia. A operação é atômica.

Exclusão lógica registrada separadamente do movimento bancário imutável, com autor, lote e auditoria. A visão active_bank_transactions é usada nas listagens, identificação e análise histórica/IA. Linhas originais de extrato permanecem guardadas, mas movimentos excluídos não reaparecem na consulta do arquivo. Cadastros, previsões, versões e sugestões originais são preservados.

Qualquer histórico de baixa, inclusive revertida, ou referência em outro extrato bloqueia a seleção inteira. O operador deve revisar a seleção; não apagar baixas, estornos ou vínculos implicitamente. A antiga rotina de retirada de lote de teste não remove arquivos que contenham exclusões auditadas.

A deduplicação continua consultando o original: reimportação não recria nem ressuscita movimentos excluídos. A confirmação informa isso explicitamente. Não há restauração automática por reimportação.

Pendente usa vermelho claro com texto vermelho escuro, separado do amarelo das transferências próprias. Não altera o tratamento financeiro.
