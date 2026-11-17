# Auto Visão Financeiro

Aplicação em desenvolvimento para conciliação bancária e fluxo de caixa. A interface permite preencher e consultar os cadastros da Etapa 1. O escopo funcional está no [roadmap](ROADMAP.md).

## Executar localmente

Pré-requisito: Docker com Docker Compose v2. Copie `.env.example` para `.env` (`Copy-Item .env.example .env` no PowerShell ou `cp .env.example .env` em Bash). Os valores do exemplo destinam-se ao ambiente local.

```sh
docker compose up --build
```

Abra [a interface](http://localhost:5173) ou [a documentação da API](http://localhost:8000/docs). O Compose aguarda o PostgreSQL e executa a migração antes de iniciar a API. Os serviços HTTP são publicados na interface de loopback. O banco usa um volume local.

## Cadastros da Etapa 1

Abra [a interface](http://localhost:5173), crie uma organização de teste ou selecione uma existente e escolha um cadastro no menu. Preencha o formulário e selecione **Salvar cadastro**. Para alterar um registro, use **Editar** na listagem. A opção **Cadastro ativo** permite desativar ou reativar o registro.

A [documentação interativa da API](http://localhost:8000/docs) descreve os recursos disponíveis no caminho `/organizations/{organization_id}`:

| Recurso | Caminho | Campos e vínculos |
| --- | --- | --- |
| Contas bancárias | `/bank-accounts` | Código, banco, agência, conta mascarada, titular e moeda |
| Classificações | `/categories` | Código, nome, natureza e vigência opcional |
| Subclasses | `/subcategories` | Classificação da mesma organização, código, nome e vigência opcional |
| Centros de custos | `/cost-centers` | Código, nome e centro superior opcional, independente da conta bancária |
| Clientes e fornecedores | `/parties` | Nome, tipo cliente/fornecedor/ambos, documento e contatos opcionais |

O número da conta deve conter pelo menos dois asteriscos e apenas os últimos quatro dígitos ou menos, por exemplo `**1234`. Códigos de conta, classificação e centro de custos são únicos dentro da organização. O código da subclasse é único dentro da classificação. O `PUT` substitui os campos editáveis. O `DELETE` desativa o cadastro e preserva seu histórico. As listagens aceitam o filtro opcional `active`. Alterações são auditadas na mesma transação.

A interface e os endpoints são destinados ao ambiente local. O UUID delimita os registros consultados e alterados. A identidade do operador e as permissões dependem da futura integração de autenticação. Use dados sintéticos neste ambiente.

## Verificar

Com o ambiente em execução:

```sh
docker compose exec -T api ruff check .
docker compose exec -T api ruff format --check .
docker compose exec -T api pytest
docker compose exec -T web npm run check
docker compose exec -T web npm run build
docker compose exec -T api alembic current
```

Para verificar reversão e reaplicação, use um banco descartável. O downgrade remove as tabelas da revisão.

```sh
docker compose -p autovisao-check run --build --rm migrate
docker compose -p autovisao-check run --rm migrate alembic downgrade base
docker compose -p autovisao-check run --rm migrate alembic upgrade head
```

Leia [as decisões da Etapa 0](docs/decisions/0001-base-tecnica.md) e as [regras aprovadas](REGRAS_NEGOCIO.md). O [guia do pacote de especificações](docs/especificacoes.md) registra a origem dos documentos.
