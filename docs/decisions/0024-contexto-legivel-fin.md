# Nomes e evidências explícitas nas respostas do Fin

O chat deixa de delegar ao modelo a tradução de UUIDs das distribuições históricas. Antes da chamada, a aplicação resolve nomes, diferencia classificação/subclassificação e preserva a relação entre ambas. As distribuições seguem com suas contagens completas, incluindo vínculos ausentes. UUIDs desconhecidos são apresentados como cadastro não disponível, sem inventar nomes. Os códigos também são omitidos na resposta e no histórico da conversa enviado ao modelo.

Cadastros inativos são incluídos para permitir explicar decisões antigas, com indicação de atividade. Isso não altera validações nem autoriza novos vínculos a inativos. Toda a consulta continua restrita à organização atual.

Um diagnóstico local informa quando há pelo menos três exemplos relacionados unânimes em subclassificação, mas a sugestão armazenada está incompleta. O Fin deve reconhecer a omissão e orientar Reavaliar sugestão, sem inventar ausência de padrão nem chamar frequência histórica de probabilidade. Mensagens antigas do assistente não prevalecem sobre os fatos atuais. Correspondência por nome permanece contextual, sem retroagir vínculos de cliente.

O chat continua somente de consulta. A mudança não confirma sugestões, não reclassifica movimentos e não modifica cadastros. O modelo configurado é preservado; a correção trata a estrutura dos dados e as instruções de interpretação.
