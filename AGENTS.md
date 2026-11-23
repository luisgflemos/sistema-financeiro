# Instruções permanentes para o Codex — Auto Visão Financeiro

Você está desenvolvendo o sistema **Auto Visão — Conciliação Bancária e Fluxo de Caixa**. Antes de qualquer alteração de código, leia os arquivos `PRD.md`, `REGRAS_NEGOCIO.md`, `BANCO_DADOS.md` e `ROADMAP.md` localizados na raiz do repositório. Em caso de conflito, solicite validação ou registre uma questão; nunca descarte decisões aprovadas silenciosamente.

## Missão

Criar uma aplicação web simples, rápida, acessível e auditável onde o **extrato bancário é a fonte de verdade para movimentos realizados**. Reduzir trabalho manual por associação inteligente de pagador/recebedor a cliente/fornecedor, classificação, rateio e análise financeira, sem abrir mão da integridade dos saldos.

## Regras inegociáveis

1. Não modificar a transação bancária original ao classificar ou corrigir uma informação gerencial.
2. Um único movimento bancário pode ter várias alocações gerenciais, **sem duplicar valor financeiro**.
3. Não tratar **Processos Automáticos** como receita, despesa, resultado ou fluxo operacional: aplicações e resgates automáticos ficam no extrato para conciliação, mas são excluídos dos agregados gerenciais. Não chamar esse conceito de “Movimentação Técnica Bancária”.
4. Diferenciar **rendimentos**, IOF, IR e tarifas efetivos de Processos Automáticos: fatos financeiros reais podem impactar caixa e DRE.
5. Neutralizar transferências entre contas próprias no consolidado, preservando reflexo individual em cada conta.
6. Vincular descrições de pagadores/recebedores extraídas do banco a clientes/fornecedores mestres; não confundir os dois cadastros.
7. Rateios por classificação/subclassificação devem suportar **linear**, **proporcional ao faturamento** e **percentual personalizado**, com soma exata, snapshot e auditabilidade.
8. Conta bancária e centro de custos são dimensões independentes.
9. Importação repetida não pode gerar duplicidade; tratar conservadoramente operações genuinamente iguais.
10. Diferenciar claramente **reconhecido**, **sugestão**, **pendente** e **Processos Automáticos**.
11. Sugestões de IA/regras precisam apresentar justificativa e confiança; não confirmar automaticamente correspondências ambíguas.
12. A DRE inicialmente é **gerencial em regime de caixa**, não contábil em competência.

## Diretrizes de engenharia

- Prefira código simples e modular, tipagem e migrações versionadas.
- Sugestão de stack inicial: React + TypeScript, Python/FastAPI, PostgreSQL. Pode ajustar com justificativa explícita e aprovação quando houver impacto significativo.
- Escrever testes unitários e de integração para idempotência, classificação, alocação e neutralização.
- Manter valores monetários com `Decimal`/NUMERIC; nunca usar float como fonte de cálculo financeiro.
- Usar transações de banco nas operações de importação e classificação.
- Separar parse de arquivos, reconhecimento, regras, projeção e relatórios.
- Não incluir dados financeiros reais, CPFs/CNPJs reais, credenciais ou extratos nos testes/repositório. Gerar fixtures sintéticas.
- Usar `.env.example` e variáveis de ambiente, sem segredos versionados.
- Manter logs estruturados, auditoria e autenticação adequadas.
- Apresentar diferenças de regras e escolhas de arquitetura em documentação antes de alterar comportamento financeiro.

## Prioridade da UX

- Idioma pt-BR; BRL; datas brasileiras.
- Cadastros rápidos, edição inline, importar clientes/fornecedores por Excel, associação por arrastar/soltar **e** opção por clique/teclado.
- Exibir progresso, erros e critérios de correspondência.
- Limitar operações necessárias do usuário para reconhecer lançamentos repetidos.

## Fluxo de trabalho recomendado

1. Ler especificações e verificar o estado atual do repositório.
2. Resumir plano e arquivos a tocar.
3. Implementar em passos pequenos e testáveis.
4. Executar testes e migrações; relatar o que foi efetivamente validado.
5. Atualizar documentação e registrar questões/hipóteses em aberto.
6. Nunca alegar que uma funcionalidade foi implementada sem código/testes verificáveis.

## Questões ainda abertas

- Banco(s) e formatos reais de extrato disponíveis.
- Política final de aprovação/limiar de confiança do reconhecimento automático.
- Origens e períodos da base de faturamento para rateio.
- Regras de fechamento mensal, permissões e integrações futuras.

**Nota:** estes documentos são especificações iniciais geradas a partir da conversa de definição funcional. Não são prova de execução de código nem de existência prévia de um repositório.

## Seleções da interface

Novas caixas de seleção devem permitir filtrar por trechos do nome ou código, com busca sem distinção de acentos e suporte a teclado. Reutilizar o componente SearchSelect.

Títulos de páginas e menus usam iniciais maiúsculas nas palavras principais. Padrão aprovado: Contas Bancárias, Centro de Custos, Clientes e Fornecedores e Classificações.
