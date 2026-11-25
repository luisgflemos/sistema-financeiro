# Contagens históricas são respostas calculadas, não redação livre

A validação real mostrou que, mesmo com nomes resolvidos e instruções explícitas, o modelo podia misturar contagens de centro de custos com vínculos de cliente. Acrescentar instruções não basta para garantir um fato financeiro.

Consultas diretas sobre padrões, subclassificações, prevalência de centro de custos e vínculos usam uma resposta calculada pela aplicação quando há histórico relacionado. Ela resolve nomes e mostra contagens por campo e escopo, ausências e predominância, sem enviar esses fatos para serem reescritos pelo modelo. A consulta de toda a base continua sendo executada e versões substituídas/exclusões continuam respeitadas.

O modelo generativo permanece disponível para orientações e perguntas que não são esse relatório factual. O relatório não realiza gravações e não cria vínculo cadastral por nome. A resposta distingue esta conta de todas as contas e não usa números de um campo para descrever outro. Isso não altera o motor de sugestões nem as confirmações existentes.
