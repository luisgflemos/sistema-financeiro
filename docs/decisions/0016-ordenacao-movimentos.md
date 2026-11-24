# Ordenação das colunas de movimentos

Data e Conta são ações independentes no mesmo cabeçalho. Histórico do Banco, Valor e Identificação também alternam entre crescente e decrescente ao clicar, com seta de direção e aria-sort. O padrão continua sendo data decrescente. Mudar a ordenação volta à primeira página, preservando filtros.

A ordenação é aplicada no PostgreSQL antes da paginação de 100 linhas e funciona nas visões Importar Extrato, Histórico e arquivo completo. Valor usa o sinal financeiro: débitos são negativos e créditos positivos. Identificação usa os mesmos textos exibidos nos estados da interface. Empates têm critérios estáveis (data, conta, arquivo, linha e UUID), preservando todas as ocorrências. Parâmetros são enumerações e as expressões SQL vêm de uma lista interna fechada. Não há alteração de registros ou cadastros.
