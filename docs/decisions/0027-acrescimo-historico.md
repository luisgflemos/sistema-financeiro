# Acréscimo identificado de novo período

Além da carga inicial, há modo explícito append para acrescentar um arquivo identificado de período novo. A carga inicial conserva a restrição anterior de histórico vazio ou repetição exata. O modo integra o token da prévia.

Cada conta do acréscimo deve ter um período sem qualquer movimento bancário previamente registrado, inclusive excluído logicamente. Sobreposição bloqueia o lote inteiro; a mesma carga financeira reconhecida pelo digest é idempotente. Nenhum cadastro é criado ou alterado e ocorrências legítimas iguais são preservadas.

A confirmação é atômica sob o bloqueio da organização e revalida os vínculos e a sobreposição. A conferência posterior usa os IDs dos arquivos desta carga, sem comparar o novo período com totais históricos acumulados.

Para cargas pontuais autorizadas, preparar arquivo separado somente com as datas autorizadas. Não enviar o consolidado integral quando parte do arquivo foi excluída do escopo pelo usuário. Manter a origem e as linhas de origem na documentação privada da carga, fora do repositório.
