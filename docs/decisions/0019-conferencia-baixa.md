# Conferência da baixa de lançamentos previstos

O extrato determina o valor recebido ou pago. O operador confirma a vinculação sugerida por cliente, saldo e vencimento, sem aprovação automática. Não substituir valor, conta, data ou descrição bancária.

Classificação, subclassificação, centro de custos e contraparte da baixa são editáveis e validados na organização e natureza corretas; guardar snapshot e auditoria sem atualizar o título original. Centro de custos pode estar indefinido na previsão, mas é obrigatório na baixa normal.

Para valor menor: manter saldo em aberto ou confirmar desconto comercial e quitar. Para valor maior: confirmar acréscimo comercial. Separar dinheiro efetivo, desconto e acréscimo; saldo do principal = original menos (dinheiro + desconto - acréscimo). O realizado é dinheiro efetivo; desconto não é recebimento. Estorno remove efeitos da baixa e dos ajustes, mantendo histórico imutável. Toda gravação verifica versões e é transacional/idempotente.

Esta evolução trata a conferência de um título por vínculo; múltiplos créditos podem baixar parcialmente o mesmo título. Distribuição de um crédito entre diversos títulos e centros de custos exige uma evolução própria de alocações, sem representar vários recebimentos bancários.
