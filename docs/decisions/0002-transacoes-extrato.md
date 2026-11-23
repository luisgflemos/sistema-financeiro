# Transações originadas no extrato

## Escopo desta entrega

A origem do realizado é exclusivamente o arquivo bancário. O primeiro adaptador aceita o layout Santander XLSX/CSV com agência e conta no cabeçalho, seguido por Data, Histórico, Documento, Valor (R$) e Saldo (R$). O layout foi validado localmente com o exemplo fornecido pelo usuário. O arquivo real e seus dados não são fixtures e não entram no repositório.

OFX e outros layouts precisam de adaptador e validação próprios. Não se presume compatibilidade apenas pela extensão. A prévia não grava transações.

O usuário seleciona/arrasta até dez arquivos, confere as contas e importa o lote. Contas são sugeridas por banco, agência e número com dígito. O arquivo sempre precisa corresponder a uma conta ativa da organização. Não se importa por nome de arquivo. O lote é atômico, limitado a 20 MB e 10.000 movimentos.

## Preservação e conferência

Datas, histórico, valor, documento, saldo, número da linha, hash e bytes originais são preservados. Dinheiro usa Decimal e NUMERIC. A sequência dos saldos do layout validado, em ordem decrescente, é conferida antes da gravação.

Documento não é identificador bancário único neste layout. Ocorrências legítimas iguais dentro do mesmo arquivo são mantidas. Mesmo arquivo/conta não é duplicado. Em arquivos diferentes, colisões por data, descrição, documento e valor exigem decisão explícita: ignorar a repetição ou manter como outro movimento. O sistema revalida a prévia sob bloqueio da organização antes do commit.

## Operação

A fila inicia em pendentes e permite buscar, filtrar por conta, extrato, data, crédito/débito e estado. O detalhe mantém acesso à visão geral. A identificação normal exige cliente/fornecedor, classificação, subclassificação e centro de custos; observação é opcional. Salvar e próximo avança sem retornar à listagem.

Identificações são versões imutáveis, com operador, método e horário. Uma edição concorrente não sobrescreve silenciosamente a anterior. Cadastros de outra organização ou subclasses de outra classificação são rejeitados.

Processos Automáticos e transferências próprias recebem tratamento gerencial separado. Esta entrega não implementa DRE, rateios, projeções nem conciliação automática de pares de transferência. Nenhum total apresentado é receita/despesa gerencial: os valores da prévia são créditos e débitos brutos do extrato.

## IA generativa e aprendizado

Integração de servidor com OpenAI Responses API, saída em JSON Schema, IDs validados e store=false. OPENAI_API_KEY é segredo do Railway. OPENAI_MODEL é configurável; o padrão inicial é gpt-4.1-mini. A chamada não usa ferramentas nem executa ações do texto bancário. Não são enviados bytes do arquivo, senhas ou contatos dos cadastros. O contexto inclui descrições limitadas, catálogos ativos e exemplos de identificações já confirmadas; sequências documentais no histórico são reduzidas antes do envio.

A IA gera sugestões com justificativa e confiança. Elas aguardam confirmação. A confirmação ou correção alimenta os exemplos consultados nas próximas análises; não há fine-tuning silencioso.

Para reconhecimento automático, a implementação inicial exige ao menos três movimentos distintos, identificados por operador ou com sugestão confirmada, com mesma conta, direção e descrição normalizada e todos os vínculos concordantes. Registros automáticos não alimentam esse contador. Se houver conflito, o movimento permanece sujeito à revisão. Essa escolha é conservadora e não altera os valores bancários.

Por solicitação, até vinte pendências são analisadas por chamada. A interface pode processar até dez grupos seguidos, interrompendo quando não houver avanço. O operador pode continuar a fila enquanto a análise ocorre. Falhas do provedor não impedem identificar manualmente. Os testes substituem o provedor por respostas sintéticas e não consomem a API.

