# Situações, cancelamento e exclusão de previsões

Decisão aprovada pelo usuário em 25/11/2026:

- Em Aberto: amarelo; Parcialmente Realizado: azul; Realizado: verde; Cancelado: cinza. Os rótulos continuam visíveis, sem depender apenas da cor.
- Cancelar representa uma previsão válida cuja obrigação/recebimento deixou de existir. Mantém registro e baixas, encerra saldo em aberto e permanece consultável. A tela inicia em **Sem cancelados**, com filtros para todas as situações ou somente cancelados.
- Excluir atende a erro/duplicidade de previsão. Exclusão lógica, com `deleted_at`, incremento de versão e evento de auditoria individual; não apaga série, movimento bancário, cadastro ou auditoria.
- Pode excluir uma ocorrência ou esta e as próximas da mesma série, pela ordem de ocorrência. Uma prévia informa quantidade e vencimentos antes da confirmação.
- Qualquer histórico de baixas, inclusive revertidas, impede exclusão. Se uma parcela da seleção estiver protegida, nenhuma parcela é excluída. A seleção inteira é revalidada sob bloqueio da organização, com revisão otimista de IDs/versões para impedir exclusão após mudanças concorrentes.
- Excluídos não entram em listagens, seleção para baixa, filtros de cancelados ou projeções. Não são recriados ao repetir a solicitação original da série. API preserva `state=all` como padrão por compatibilidade; a interface usa `state=active`.

Migração 0011 adiciona somente uma coluna anulável: registros anteriores permanecem inalterados. Testes cobrem filtros, auditoria, seleção de série, isolamento entre organizações, concorrência, bloqueio por baixas e preservação das transações bancárias.
