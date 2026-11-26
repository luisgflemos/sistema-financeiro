# Filtros de identificação no Histórico

Classificação, Subclassificação, Cliente / Fornecedor e Centro de Custos são filtros pesquisáveis e combináveis com conta, extrato, período, direção e texto. A consulta considera a identificação mais recente de cada movimento, sem modificar transações ou identificações. Contagem, paginação, ordenação e seleção usam as mesmas condições no servidor e preservam o isolamento por organização.

Os seletores incluem cadastros inativos, necessários para consultar o passado. A lista de subclassificações acompanha a classificação escolhida; trocar a classificação limpa o filtro de subclassificação. Sem classificação, as opções de subclassificação mostram o nome da classificação para distinguir nomes repetidos. A interface apresenta uma segunda linha compacta com quatro campos, adaptada a telas menores.

O botão Vincular Clientes e o modal de carga interna deixam de integrar a interface do Histórico. Os vínculos já aprovados são preservados. A validação desse carregador interno permanece nos testes de API; o antigo teste de seu botão deixa de integrar a navegação pública.
