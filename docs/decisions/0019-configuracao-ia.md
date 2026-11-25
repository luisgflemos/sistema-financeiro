# Compatibilidade da configuração da IA

A verificação no Railway confirmou que `finare`, ambiente `production`, tinha a variável `OPEN_API_KEY`. Chat, reconhecimento e indicação de disponibilidade procuravam somente `OPENAI_API_KEY`.

O resolvedor compartilhado prioriza `OPENAI_API_KEY` e aceita `OPEN_API_KEY` como nome alternativo, removendo somente espaços externos. A credencial existente permanece no Railway; não é copiada, alterada, registrada nos logs nem devolvida pela API. Endpoints de configuração continuam retornando apenas disponibilidade booleana.

Sem mudanças em modelo, permissões, dados financeiros, histórico, regras de reconhecimento ou modo de consulta do chat. Testes usam chaves sintéticas e simulam o provedor para verificar os dois consumidores e a prioridade do nome canônico.
