# Lançamentos recorrentes e formulário compacto

- Recorrência e quantidade ficam sempre visíveis na criação. Selecionar uma periodicidade inicia com duas ocorrências, editáveis até o limite existente de 120; lançamento único mantém uma. A quantidade inclui o primeiro vencimento.
- A prévia e o botão indicam quantos lançamentos serão criados. O resultado exibido vem da resposta do servidor, em vez de repetir a quantidade do formulário.
- Enter em campos de entrada não envia o formulário durante o preenchimento; continua selecionando opções das listas pesquisáveis. O envio ocorre pela ação de salvar, acessível também pelo teclado.
- Valores usam vírgula, agrupamento brasileiro e dois centavos durante digitação, colagem e edição. São enviados como strings decimais, sem cálculos monetários com ponto flutuante.
- Criação e edição usam modal mais largo, com campos lado a lado no desktop e reorganização responsiva em telas menores. A rolagem continua disponível quando necessária.
- A edição continua restrita à ocorrência escolhida. Não gera outras parcelas nem reescreve séries existentes. Não foram alteradas regras de baixa, histórico bancário, cadastros ou lançamentos existentes.

## Validação

Teste de navegador cria uma despesa mensal de quatro ocorrências, confere payload, quatro vencimentos consecutivos atravessando o ano, valores, total de R$ 2.000,00, retorno da API e ausência de movimentos bancários. Também cobre envio acidental por Enter, máscara por digitação e colagem, edição de uma única ocorrência, desktop e celular. O teste anterior de recorrência passou a conferir quantidade e vencimentos efetivamente gravados.

O caminho exato que produziu o lançamento único relatado não foi comprovado. A API já criava séries completas nos testes de integração; a interface agora evita envio prematuro, torna a recorrência explícita e recebe cobertura ponta a ponta que faltava.
