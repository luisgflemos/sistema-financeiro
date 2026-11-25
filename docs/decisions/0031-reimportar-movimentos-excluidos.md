# Reimportação após exclusão

Em 25/11/2026, o usuário solicitou reimportar extratos cujos movimentos foram excluídos. O bloqueio somente por hash do arquivo impedia essa operação.

- O arquivo conserva seu SHA-256 real; cada tentativa efetiva de reimportação ganha uma geração, preservando os originais e a auditoria das exclusões.
- No mesmo arquivo/conta, a posição da linha e a referência canônica anterior permitem restaurar somente os movimentos excluídos. Os ativos permanecem sem duplicação, inclusive ocorrências legitimamente idênticas. Linhas anteriormente ignoradas permanecem ignoradas.
- A reimportação cria movimentos novos, sem copiar identificações, sugestões ou baixas antigas. A política de zero aprovações automáticas continua vigente.
- A prévia informa quantos excluídos serão reimportados e quantos ativos serão mantidos. O token, o bloqueio por organização e a unicidade de geração protegem contra alterações concorrentes e repetição do lote.
- Compartilhar referências entre gerações do mesmo arquivo não impede uma exclusão posterior; referências a outro extrato e histórico de baixas continuam protegidos.
- O downgrade da migração 0014 só é possível antes de existirem múltiplas gerações reais do mesmo arquivo. Havendo reimportações, preservar/exportar os dados e migrar para frente; não apagar trilha financeira para viabilizar downgrade.
