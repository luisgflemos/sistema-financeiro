# Vínculos de clientes nos PIX Faturados históricos

Associações aprovadas pelo usuário podem preencher somente `party_id` de receitas históricas já confirmadas como PIX Faturado. O extrato e as demais dimensões não são alterados. A operação não adiciona opção de exclusão ao Histórico.

O CSV de associações traz Pagador, Cliente, Quantidade e Total, além de uma data limite escolhida na tela. A comparação do pagador remove somente prefixos bancários conhecidos, data de sufixo, acentos, caixa e pontuação. Não faz correspondência aproximada nem reúne nomes abreviados diferentes. O destino deve ser um único cliente ativo da organização (CUSTOMER/BOTH).

Prévia e confirmação recalculam a base ativa integral da organização, restrita a créditos NORMAL, classe REVENUE, subclasse PIX Faturado, métodos OPERATOR/AI_CONFIRMED e data limite. Quantidade e soma Decimal devem conferir com o manifesto. Vínculos existentes iguais são idempotentes; diferentes bloqueiam o lote. Histórico de baixa bloqueia novos vínculos. Exclusões lógicas não voltam à base.

O token vincula organização, data, destinatários e snapshots completos das identificações. A gravação usa bloqueio da organização e uma transação única; qualquer divergência ou validação impede gravação parcial. Cada alteração acrescenta uma identificação OPERATOR, preservando versões anteriores, dimensões e observações. Um evento de auditoria reúne os grupos e o token; uma conferência final verifica todos os vínculos antes do commit.

Esta ação exige associações explícitas, não é uma execução autônoma pelo Fin nem uma regra que altera lançamentos futuros. O Fin passa a ter esses exemplos confirmados na sua leitura normal do histórico.
