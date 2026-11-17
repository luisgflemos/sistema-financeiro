# Etapa 0 · Base técnica

A aplicação usa React e TypeScript no navegador, FastAPI e SQLAlchemy na API, PostgreSQL 16 e Alembic para migrações. O Docker Compose executa banco, migração, API e frontend nessa ordem de dependência. A interface e a API são para desenvolvimento local. A tabela de usuários fornece identidade para referências de importação e auditoria. Autenticação, papéis e permissões serão implementados antes de expor operações financeiras.

## Persistência

- A revisão `0001` cria organizações, usuários, contas bancárias, centros de custos, clientes e fornecedores, categorias, subclasses, lotes, arquivos, movimentos e eventos de auditoria.
- Conta bancária e centro de custos são cadastros independentes. Arquivos referenciam lotes e contas da mesma organização. Movimentos referenciam a conta do arquivo de origem e seguem a moeda da conta.
- Arquivos, movimentos e eventos de auditoria aceitam inserções. Gatilhos bloqueiam edição e exclusão de suas linhas. Eventos têm organização, ator quando aplicável, alvo, ação, horário e valores anteriores e posteriores. As operações futuras deverão gravar seus eventos na mesma transação da alteração.
- O valor bancário usa `NUMERIC` com validação de precisão centesimal e direção separada. A unidade inicial é BRL. A ingestão deverá preservar os dados de origem antes de normalizá-los.
- Hash único por conta identifica o arquivo inteiro. A identidade da linha no arquivo e o identificador bancário por conta têm restrições próprias. O fingerprint é indexado e admite repetição. Na Etapa 1 será definida a estratégia para layouts com identificadores ausentes ou pouco confiáveis e períodos sobrepostos, usando amostras validadas e revisão de colisões.
- O estado de reconhecimento fica reservado ao futuro modelo gerencial, para preservar os dados originais. As versões de reconhecimento, vínculos de contrapartes, neutralizações, rateios e projeções terão migrações próprias conforme o roadmap.

## Questões em aberto

Bancos e layouts reais, política de confiança, base de faturamento, permissões, fechamento mensal e mapeamento para DRE seguem em aberto conforme os documentos de produto. As regras aprovadas em `REGRAS_NEGOCIO.md` continuam sendo a referência para as próximas etapas.
