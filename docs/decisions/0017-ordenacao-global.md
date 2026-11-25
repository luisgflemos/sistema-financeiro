# Ordenação como padrão dos menus

Contas Bancárias, Classificações/Subclassificações, Centro de Custos, Clientes e Fornecedores e Lançamentos passam a usar cabeçalhos reutilizáveis, com alternância crescente/decrescente, indicação visual e aria-sort. Transações mantém o padrão já publicado. Botões de ação não são dados ordenáveis.

Cadastros carregam a coleção completa e ordenam os valores exibidos usando colação pt-BR, sem diferenciar acentos/maiúsculas, com comparação natural de códigos e números. Valores ausentes ficam no final. Situação, natureza, tipo, banco e centro superior usam seus rótulos, não IDs ou booleanos. A árvore ordena os pais e os filhos dentro do próprio pai, preservando expansão, pesquisa e hierarquia.

Lançamentos ordena todos os registros filtrados antes da paginação, usando Decimal para valores, datas reais e os rótulos de situação da interface. Trocar a ordem retorna à primeira página e não muda totais, filtros, cadastros ou movimentos.
