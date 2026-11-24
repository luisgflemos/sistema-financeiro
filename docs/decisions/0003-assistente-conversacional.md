# Fin — assistente de conversa durante o uso da Finare

A Fin fica disponível em Cadastros e Transações, por botão flutuante com seu nome e o símbolo da Finare, que abre uma janela de conversa minimizável. Também pode ser aberta no detalhe para conversar sobre o movimento selecionado. Permanece acessível no cabeçalho dos pop-ups, sem cobrir suas ações ou apagar os formulários em andamento. Trocar de organização ou sair da sessão limpa a conversa local.

O backend usa a mesma configuração OpenAI Responses da identificação, com store=false, sem ferramentas de escrita. O contexto é consultado pelo servidor, limitado à organização e, quando selecionado, à transação. Inclui cadastros ativos sem documentos/contatos, até vinte exemplos confirmados e a sugestão atual. Não é consulta irrestrita ao histórico: os recortes e suas limitações são informados ao modelo. Documentos presentes nas descrições e perguntas são reduzidos. Não são enviados arquivos ou credenciais bancárias.

A conversa mantém contexto recente apenas na memória da tela. Fechar/minimizar preserva a conversa durante a sessão; Nova conversa limpa as mensagens. Perguntas e respostas não são confirmações gerenciais e não alimentam o aprendizado. Alterações devem continuar pelo formulário validado e auditado. O assistente orienta e explica, mas não executa gravações ou exclusões.

## Testes e início com o histórico validado

O usuário definiu que o primeiro extrato é teste de funcionalidade. Após o encerramento dos testes, a limpeza autorizada em escopo será somente de transações de teste e seus arquivos/registros vinculados, incluindo identificações e sugestões. Todos os cadastros já validados devem ser preservados. A limpeza ainda não foi executada, não é disparada pelo chat e deverá ser preparada separadamente quando o usuário encerrar os testes.

A carga histórica reconhecida será a referência de reconhecimento após essa limpeza. O fluxo de importação dessa carga é uma entrega posterior: o importador atual é de extratos brutos Santander, não de uma planilha histórica já classificada. Nenhuma conversa substitui a validação das dimensões desse histórico.
