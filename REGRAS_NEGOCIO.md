# Regras de Negócio — Auto Visão Financeiro

**Versão:** 1.0 — 17/11/2026. `APROVADA` = decisão desta conversa; `PROPOSTA` = detalhe sugerido para validação.

| ID | Status | Regra |
|---|---|---|
| RN-001 | APROVADA | A movimentação realizada nasce no extrato bancário importado; não exigir redigitação do lançamento bancário. |
| RN-002 | APROVADA | Um ou vários extratos podem ser recebidos por lote, sempre vinculados a contas bancárias cadastradas. |
| RN-003 | APROVADA | Ler conta, data, crédito/débito, valor e pagador/recebedor; manter histórico original quando fornecido. |
| RN-004 | APROVADA | Toda receita/despesa deve ser identificada com classificação, subclassificação e centro de custos. Cliente/fornecedor é opcional. Data, valor e descrição da operação são obrigatórios e vêm do extrato; Descrição Complementar é opcional e não altera o original. Preservar as exceções aprovadas para transferências próprias e Processos Automáticos. |
| RN-005 | APROVADA | Pagadores/recebedores são descrições/identificadores do banco; o vínculo a cliente/fornecedor é explícito e pode reunir múltiplas descrições por entidade. |
| RN-006 | APROVADA | Importação de clientes/fornecedores por Excel e associação intuitiva de contrapartes, inclusive por arrastar/soltar. |
| RN-007 | APROVADA | Reconhecer padrões conhecidos e sugerir vínculos, classificações e subclasses segundo o histórico de decisões. |
| RN-008 | APROVADA | Permitir informação adicional em receitas e despesas no momento do reconhecimento. |
| RN-009 | APROVADA | Extratos podem ser reimportados sem duplicação de movimentos. |
| RN-010 | APROVADA | Transferências entre contas próprias não são receitas/despesas e não aumentam caixa consolidado. |
| RN-011 | APROVADA | Rateios dividem distribuição gerencial; o registro do banco permanece único. |
| RN-012 | APROVADA | Modalidades de rateio: linear, proporcional ao faturamento e percentuais personalizados por centro de custos. |
| RN-013 | APROVADA | A regra pode ser associada a classificação/subclassificação; percentuais específicos por conta do plano gerencial. |
| RN-014 | APROVADA | Processos Automáticos incluem aplicações e resgates automáticos, são rastreados mas não afetam receitas/despesas, caixa gerencial ou DRE. |
| RN-015 | APROVADA | Rendimentos reais de aplicações e tributos/tarifas associados são fatos financeiros distintos dos Processos Automáticos e devem ser classificados normalmente. |
| RN-016 | APROVADA | Projeções de caixa usam tendências dos grupos de contas; DRE gerencial deve ser gerada a partir da classificação. |
| RN-017 | APROVADA | Conta bancária e centro de custos são dimensões independentes; permitir visão por unidade e consolidada. |
| RN-018 | PROPOSTA | Padrões de alta confiança, sem conflito, podem ser reconhecidos automaticamente; demais padrões geram sugestões com confirmação. A política exata de confiança ainda precisa ser aprovada. |
| RN-019 | PROPOSTA | Regras automáticas recebem versão, vigência, prioridade e trilha de confirmação/edição. |
| RN-020 | PROPOSTA | Em rateio por faturamento, usar último mês fechado se o atual estiver aberto, sinalizando a origem dos valores. |
| RN-021 | PROPOSTA | Ajustes de rateio exigem soma exata de 100% ou valor total do lançamento, com ajuste de arredondamento na última parcela. |
| RN-022 | PROPOSTA | Movimentos sem classificação entram no saldo bancário, mas são segregados em relatórios gerenciais e alertados como pendência. |
| RN-023 | PROPOSTA | Estornos guardam referência à transação original, sem exclusão física. |
| RN-024 | PROPOSTA | Um fechamento mensal congela regras/valores reconhecidos; mudanças posteriores exigem reabertura ou ajuste documentado. |
| RN-025 | PROPOSTA | O sistema preserva o valor e sinal original do extrato, sem recálculo gerencial sobre o movimento bruto. |

## Ordem de processamento sugerida

1. Preservar e validar linha original, conta, natureza e identificador.
2. Detectar duplicidades e estabelecer identidade da movimentação.
3. Detectar Processos Automáticos e transferências internas; se confirmados, **neutralizar apenas na visão gerencial**, nunca apagar a linha bancária.
4. Resolver pagador/recebedor para cliente ou fornecedor.
5. Sugerir/aplicar classificação, subclassificação e centro(s) de custos.
6. Aplicar rateio adequado e registrar a base dos percentuais.
7. Atualizar saldos bancários, totais gerenciais, indicadores e visões derivadas.

## Reconhecimento de contrapartes

- Extrato: `PIX REC JOAO S`, por exemplo, é uma **descrição observada**.
- Cadastro mestre: `João Silva Ltda.` ou outra entidade validada.
- O vínculo é uma associação controlada; não substituir a descrição original nem criar entidade mestre apenas por similaridade incerta.
- Regra repetida e confirmada pode dispensar futuras ações, respeitando a política de confiança.

## Rateio — exemplos e invariantes

Para uma despesa de R$ 10.000 entre cinco unidades:

- Linear: 20% para cada unidade = R$ 2.000 cada.
- Por faturamento: faturamentos proporcionais a 30/25/20/15/10 => R$ 3.000/2.500/2.000/1.500/1.000.
- Personalizado: percentuais definidos manualmente, soma obrigatória 100%.

**Invariantes:** soma dos valores rateados = valor reconhecido; sem duplicidade em caixa; porcentagens/faturamento-base são fotografados no instante da aplicação; mudança de regra futura não altera rateios passados automaticamente.

## Processos Automáticos — exemplo contábil-gerencial

| Linha do extrato | Valor em CC | Caixa gerencial | DRE gerencial |
|---|---:|---:|---:|
| Recebimento de cliente | +10.000 | +10.000 | Receita +10.000 |
| Aplicação automática | -8.000 | 0 | 0 |
| Resgate automático | +3.000 | 0 | 0 |
| Pagamento de fornecedor | -2.000 | -2.000 | Despesa -2.000 |
| **Total** | **+3.000** | **+8.000** | **+8.000 antes de outros ajustes** |

A diferença de R$ 5.000 corresponde à movimentação líquida entre conta corrente e aplicação. Para reconciliar patrimônio financeiro consolidado, usar contas de aplicação e não somar aplicação/resgate como resultado operacional. Rendimentos e impostos são tratados em linhas próprias quando de fato identificados.

## Regras de transparência

- Movimentos normais de crédito aceitam classificações de Receita; débitos, de Despesa. A mesma validação vale para lançamentos previstos e sugestões de reconhecimento.
- Transferências entre contas próprias aceitam somente classificações Neutras quando informadas, sem obrigatoriedade de centro de custos ou outros vínculos gerenciais.
- Processos Automáticos são neutros pelo próprio tratamento e dispensam classificação, subclassificação, centro de custos e cliente/fornecedor. Dimensões residuais são limpas ao salvar; informações originais do banco são preservadas. Sugestão generativa continua exigindo confirmação; padrões confiáveis já confirmados podem reconhecer automaticamente.

- Sugerir não é confirmar; indicar o estado visual com clareza.
- Exibir motivo da associação e da classificação quando automática.
- No reconhecimento de ambiguidade, exigir ação humana.
- Informações adicionais são vinculadas à transação reconhecida, não alteram a descrição original do banco.

