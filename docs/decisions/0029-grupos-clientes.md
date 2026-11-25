# Grupos de Clientes e prioridade de identificação

Cadastro independente simples: nome, estado ativo e clientes cadastrados vinculados. Um cliente pertence a no máximo um grupo; grupos não substituem nem mesclam clientes. Inativação mantém relações e histórico. A gestão não altera valores ou classificações bancárias.

O reconhecimento prioriza cliente específico. Grupo é alternativa apenas para receitas NORMAL quando não é possível resolver o cliente/loja. `party_id` e `customer_group_id` são mutuamente exclusivos em uma identificação; a ligação cliente→grupo no cadastro continua disponível para consulta. Um cliente com pagador próprio, embora pertença a um grupo, continua sendo sugerido individualmente. Conta bancária e centro de custos não são indícios suficientes para escolher filial do cliente.

Uma nova versão de identificação pode gravar somente o grupo, preservando o cliente vazio e as demais dimensões. Sem evidência única de grupo, não atribuir. Sugestões armazenadas antes de uma mudança de vínculo são revalidadas para não escolher arbitrariamente uma filial. O Fin recebe grupos e relações no contexto, mas segue somente consultivo.

Associações históricas em lote aceitam CSV com coluna Cliente ou Grupo. Grupos não substituem clientes específicos já reconhecidos: esses vínculos são preservados se pertencerem ao grupo e conflitos bloqueiam o lote. Quantidades, totais, escopo organizacional, data limite, bloqueio de baixas, token e atomicidade continuam obrigatórios.

Estruturas novas: customer_groups; parties.customer_group_id; transaction_identifications.customer_group_id. Nenhuma linha bancária ou identificação antiga é reescrita. Cadastro de grupo e alterações de membros têm auditoria e isolamento por organização. Mudança de membros não reassocia movimentos históricos silenciosamente.
