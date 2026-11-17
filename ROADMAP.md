# Roadmap de Desenvolvimento — Auto Visão Financeiro

**Versão:** 1.0 — 17/11/2026. Sem estimativas de prazo ainda; etapas condicionadas a critérios de aceite.

## Etapa 0 — Preparação técnica

- Inicializar repositório Git e definir estrutura de trabalho.
- Selecionar stack e estratégia de execução local (sugestão: React + TypeScript no frontend, FastAPI em Python no backend, PostgreSQL, migrações Alembic, testes automatizados).
- Criar `.env.example`, lint/format, testes, README e ambiente de desenvolvimento.
- Definir entidades essenciais, trilha de auditoria e migração inicial.

**Aceite:** aplicação inicia localmente, executa testes iniciais e banco migra de forma reproduzível.

## Etapa 1 — Cadastros e ingestão (primeiro MVP utilizável)

- CRUD de contas bancárias, classificação, subclasse, centro de custos, cliente/fornecedor.
- Importação Excel de clientes/fornecedores com prévia e deduplicação.
- Upload múltiplo de extratos com seleção de conta e prévia.
- Parser bancário modular, primeiro com CSV e OFX (a confirmar pelos extratos reais).
- Prevenção de duplicidades, armazenamento de arquivo original e log de importação.
- Tela de movimentos com filtro por conta, período, C/D e descrição.

**Aceite:** arquivos de duas contas diferentes são importados em lote e reimportações não geram duplicatas.

## Etapa 2 — Reconhecimento, vínculos e Processos Automáticos

- Associação de descrições bancárias a clientes/fornecedores por busca, clique e arrastar/soltar.
- Classificação e subclassificação inline; observações adicionais.
- Cadastro de regras determinísticas e fila de sugestões.
- Estados reconhecido/sugestão/pendente/Processos Automáticos.
- Regras de aplicações/resgates automáticos e transferências próprias, sem efeito nos relatórios gerenciais.
- Auditoria de confirmações/correções.

**Aceite:** um extrato de teste produz reconhecimento explicado, pendência tratável e neutralização correta de aplicações/resgates.

## Etapa 3 — Rateios inteligentes

- Regras por classificação/subclassificação: linear, por faturamento e percentual personalizado.
- Cadastro e fechamento de base de faturamento por centro de custos.
- Preview de distribuição, ajustes manuais e tratamento de arredondamentos.
- Preservar histórico/snapshot da regra aplicada.

**Aceite:** rateio de R$ 10.000 entre cinco centros fecha R$ 10.000 em todos os métodos sem multiplicar o lançamento bancário.

## Etapa 4 — Fluxo de caixa e projeções

- Fluxo realizado por banco, unidade, centro de custos, grupo e consolidado.
- Saldos bancários conciliáveis e pendências destacadas.
- Motor de recorrência/tendência por grupos de contas; cenários e premissas rastreáveis.
- Gráficos e exportações.

**Aceite:** saldos batem com extratos; projeção está separada do realizado; transferências internas não inflacionam caixa consolidado.

## Etapa 5 — DRE gerencial e controle mensal

- Plano de contas gerencial mapeado para estrutura de DRE.
- DRE em regime de caixa por unidade e consolidado.
- Conciliação mensal, trilhas de aprovação, controle de períodos encerrados.
- Preparação (não implantação automática) de expansão futura para regime de competência.

**Aceite:** DRE gerencial reproduz somatórios reconhecidos e rateados com exclusão de Processos Automáticos.

## Atividades transversais

- Testes de importação, arredondamento, transferências, Processos Automáticos e permissões.
- Segurança dos dados financeiros e pessoais; backups e migrações reversíveis.
- Usabilidade com teclado, mensagens claras, baixa fricção e ações em lote.
- Registro de decisões técnicas em `docs/decisions/`.

## Primeiro comando recomendado ao Codex

> Leia AGENTS.md, PRD.md, REGRAS_NEGOCIO.md, BANCO_DADOS.md e ROADMAP.md. Inicialize a base do projeto (frontend React/TypeScript, API FastAPI, PostgreSQL e migrações), crie cadastros fundamentais e fluxo de importação de extratos com prévia, preservação do bruto e idempotência. Não implemente automações de alto risco nem invente layouts bancários. Crie testes e demonstre um fluxo local funcional com dados sintéticos. Registre escolhas e itens pendentes.
