# Auto Visão — Conciliação Bancária e Fluxo de Caixa

**Documento:** Requisitos de Produto (PRD)  
**Versão:** 1.0 — 17/11/2026  
**Status:** Concepção funcional aprovada; desenvolvimento ainda não iniciado.  
**Destino:** Codex / repositório `autovisao-financeiro`.

## 1. Visão do produto

Construir uma aplicação web simples, intuitiva e auditável de gestão financeira, na qual **tudo nasce no extrato bancário**. O usuário não precisa redigitar transações que já constam do banco: importa um ou vários extratos, verifica o que foi reconhecido, confirma ou corrige sugestões, e obtém fluxo de caixa realizado, projetado e DRE gerencial. O sistema aprende padrões de decisões confirmadas, sem alterar retroativamente os dados bancários ou classificações fechadas.

### Princípios
1. Extrato bancário é a fonte primária do **realizado bancário**; nenhum lançamento deve ser criado implicitamente só para “fechar” o caixa.
2. Preservar o registro bruto, sua origem, e a normalização de cada item.
3. Separar **movimentação bancária**, **reconhecimento gerencial**, **rateio** e **projeção**.
4. UX de baixa fricção: importação em lote, ações em massa, edição inline, arrastar e soltar, buscas rápidas e explicações claras das sugestões.
5. Reconhecimento automático somente quando regra confiável e não ambígua; sugestões nos demais casos, com confiança e justificativa.
6. Todas as decisões relevantes devem ser auditáveis e reversíveis por usuários autorizados.

## 2. Contexto organizacional

Operação inicial: cinco unidades em Campinas — **Abolição, Amoreiras, Andrade Neves, Domício Pacheco e Imperatriz** — e possibilidade de outras unidades/centros de custos. Os centros de custos não devem ser obrigatoriamente determinados pela conta bancária. A aplicação deve prever múltiplas contas e uma visão consolidada, sem misturar saldos de bancos diferentes.

## 3. Perfis de uso (hipóteses para validar)

- **Administrador:** gerencia cadastros, regras, permissões, encerramento e estornos gerenciais.
- **Operador financeiro:** importa extratos, vincula contraparte, classifica e confirma sugestões.
- **Gestor/consultor:** consulta indicadores, relatórios, DRE e projeções.

Os papéis acima são proposta técnica, não decisão operacional concluída.

## 4. Escopo funcional

### 4.1 Cadastros

- **Conta bancária:** banco, agência, conta, titular, identificador interno, moeda, estado ativo/inativo; eventual vínculo a conta de aplicação associada.
- **Classificação** e **subclassificação:** hierarquia coerente, natureza (receita/despesa/neutra ou ajustes, conforme modelagem), código, nome e vigência.
- **Centro de custos:** unidade ou estrutura organizacional; hierarquia opcional.
- **Clientes e fornecedores:** cadastros simples com nome, documento opcional, contatos opcionais, status; importação em massa via Excel (.xlsx), com prévia de colunas, mapeamento, validação, detecção de duplicatas e relatório de erros.
- **Pagadores/recebedores bancários:** NÃO são cadastro mestre de cliente/fornecedor; são identificadores/descrições extraídos dos extratos e precisam ser ligados aos cadastros de clientes/fornecedores. Um cliente/fornecedor pode ter múltiplas descrições bancárias; uma descrição ambígua exige revisão.
- **Regras:** reconhecimento de contraparte, classificação, subclassificação, centro de custos, rateio e Processos Automáticos.

### 4.2 Importação de extratos

- Receber **um ou vários extratos de uma vez**, associados a conta(s) bancária(s) cadastrada(s).
- Ler, quando presentes: **conta, data, C/D (crédito/débito), valor, pagador/recebedor**, descrição/histórico e identificadores bancários.
- Mostrar prévia antes de confirmar importação, erros por linha, total de entradas/saídas e conta identificada.
- Evitar duplicidades inclusive ao reimportar períodos sobrepostos; distinguir transações idênticas legítimas por identificador bancário ou regras conservadoras de chave/fingerprint e revisão quando ambíguo.
- Manter arquivo de origem e metadados (hash, período, banco, usuário, horário, lote) para auditoria.
- Formatos de entrada iniciais: **CSV e OFX como sugestão para MVP**, com adaptadores específicos para bancos; XLSX pode ser considerado conforme extratos reais. PDF não deve ser prometido no MVP antes da validação de modelos de extrato.
- O sistema deve permitir pré-processamento/mapeamento configurável para diferentes layouts bancários.

### 4.3 Fila de reconhecimento / conciliação

Uma tela central mostrará, por conta e período:
- **Reconhecido automaticamente** (regra comprovada, alta confiança, sem conflito);
- **Sugestão pendente** (aprovação do usuário);
- **Não reconhecido** (requer associação/classificação manual);
- **Processos Automáticos** (categoria operacional distinta, sem efeito gerencial).

Cada movimentação de receita/despesa reconhecida deve ter: **classificação, subclassificação, centro(s) de custos, cliente/fornecedor vinculado ou contraparte adequadamente identificada**, com justificativa de exceção quando não aplicável. Deve permitir **informação adicional/observação por lançamento**.

A UX deve permitir arrastar a descrição do pagador/recebedor para um cliente/fornecedor, ou pesquisar e vincular por clique, além de operações em lote e desfazer alterações.

### 4.4 Aprendizado e sugestões

- Sugerir vínculos bancários a clientes/fornecedores, classificação, subclassificação e centro de custos a partir de histórico confirmado, similaridade de descrição, conta, natureza, recorrência, valores e contexto.
- Explicar **por que** uma sugestão foi feita e exibir nível de confiança.
- Guardar confirmação/correção como evento de aprendizagem; não permitir que a IA sobrescreva silenciosamente regras explícitas ou dados já consolidados.
- Fluxo sugerido: primeiro regras determinísticas e histórico; IA opcional para correspondências complexas, sujeita a validação e governança.

### 4.5 Rateios

Configurar regras por **classificação/subclassificação** (a expressão “conta” aqui se refere à conta do plano de classificação, não necessariamente à conta bancária):
1. **Linear:** proporção igual entre centros de custos selecionados.
2. **Proporcional ao faturamento:** participação de cada centro no faturamento do período-base.
3. **Percentual personalizado:** percentuais fixados pelo usuário, totalizando 100%.

Aplicar automaticamente ao lançamento elegível; permitir ajuste manual autorizado, inclusive rateio por valores quando necessário; guardar snapshot da regra, critérios, percentuais, período-base e valores arredondados. Lançamento do banco continua único; apenas distribuições gerenciais são múltiplas.

**Ponto proposto para validação:** caso o faturamento do mês corrente não esteja fechado, usar último mês consolidado e informar a base utilizada.

### 4.6 Processos Automáticos

**Nome aprovado:** `Processos Automáticos` (não usar “Movimentação Técnica Bancária” na interface/negócio).

- Identificar aplicações automáticas, resgates automáticos e outros procedimentos bancários neutros configurados.
- Guardar movimentos originais para conciliação do extrato e reconciliação de saldos.
- **Não gerar receita, despesa, entrada/saída operacional, projeção operacional ou DRE** por causa desses movimentos.
- Não alterar o saldo bancário bruto: separar saldo em conta corrente, aplicações e, quando possível, **disponibilidade consolidada**.
- Rendimentos, IOF, IR e tarifas efetivos são **fatos econômicos distintos** e devem ser classificados normalmente, quando identificados.
- Transferências entre contas próprias também devem ser neutralizadas na consolidação para impedir dupla contagem, com rastreio da origem e destino.

### 4.7 Fluxo de caixa

- Realizado por período, conta bancária, centro de custos, classificação/subclassificação, unidade e consolidado.
- Saldos inicial/final reconciliáveis com banco; exibir separadamente transações ainda não reconhecidas e Processos Automáticos.
- Projeções por tendências históricas de grupos de contas, periodicidade, sazonalidade e cenários; separar projeção de valores efetivamente registrados.
- Evitar somar transferência entre contas próprias como entrada/saída consolidada.

### 4.8 DRE

- DRE gerencial inicialmente **em regime de caixa**, baseada em classificações dos movimentos realizados, rateios e exclusões de Processos Automáticos.
- Preparar extensão futura para competência (contas a receber/pagar, provisões, depreciação, ajuste de competência); não chamar a DRE de competência sem esses dados.
- Relatórios por unidade, centro de custos e consolidado; linhas mapeáveis por classificação/subclassificação.

## 5. Requisitos de usabilidade

- Interface em português do Brasil, formato de datas `dd/mm/aaaa`, moeda BRL e leitura acessível.
- Tela inicial com KPIs de reconhecimento e pendências, filtros rápidos e ações por seleção múltipla.
- Cadastro de contraparte diretamente a partir de uma transação quando não encontrado.
- Arrastar e soltar **com alternativa acessível por clique**, suporte a teclado e indicação visual de alvo.
- Importação de Excel com modelo pronto, pré-visualização e resultado detalhado.
- Preferência por clareza, rapidez e pouca navegação; não mascarar ambiguidade em automação.

## 6. Segurança e qualidade

- Autenticação e autorização por função; permissões para alterar regras, reabrir fechamentos e marcar movimentos neutros.
- Trilha de auditoria de importações, associações, sugestões, confirmações, rateios e retificações.
- Backup, migrações versionadas e rastreabilidade do arquivo de origem.
- Minimização de dados pessoais, proteção de documentos de clientes e fornecedores e controles de acesso compatíveis com LGPD.
- Idempotência de importação, validação de valores e testes automatizados de conciliação.

## 7. Critérios de aceite do MVP

1. Cadastrar duas contas bancárias e importar arquivos para cada uma em um mesmo lote.
2. Demonstrar importação sem duplicação ao repetir o arquivo e ao importar período sobreposto.
3. Visualizar data, C/D, valor, descrição e contraparte original em cada movimento.
4. Importar clientes/fornecedores via Excel, com validação e relatório de falhas.
5. Vincular descrição de pagador/recebedor a cliente/fornecedor com clique e arrastar/soltar.
6. Classificar lançamento com classificação, subclassificação e centro de custos; guardar observação.
7. Aplicar regra conhecida automaticamente e enviar casos ambíguos para sugestão/revisão.
8. Identificar um par de aplicação/resgate automático como Processos Automáticos sem inflar caixa gerencial ou DRE e preservando reconciliação do extrato.
9. Fazer rateio linear, proporcional ao faturamento e percentual fixo; valores rateados somam exatamente o valor original.
10. Exibir fluxo realizado de conta e consolidado e uma DRE gerencial de caixa simples.

## 8. Fora do MVP / decisões pendentes

- Integração bancária por API/Open Finance, boleto, cartões e ERP; definir após validação das primeiras importações.
- Arquivos e layouts reais dos bancos; formatos prioritários a confirmar.
- Regras definitivas de reconhecimento automático (limiar de confiança, hierarquia e aprovações).
- Base de faturamento por unidade (origem, regime, mês de referência e fechamento).
- Granularidade de permissões e fechamento mensal.
- Conjunto inicial do plano de contas e mapeamento para DRE.

Ver `REGRAS_NEGOCIO.md`, `BANCO_DADOS.md`, `ROADMAP.md` e `AGENTS.md`.
