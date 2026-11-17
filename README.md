# Auto Visão Financeiro

Base da Etapa 0 para conciliação bancária e fluxo de caixa. A interface exibe o estado da API e da conexão com o banco. O escopo funcional está no [roadmap](ROADMAP.md).

## Executar localmente

Pré-requisito: Docker com Docker Compose v2. Copie `.env.example` para `.env` (`Copy-Item .env.example .env` no PowerShell ou `cp .env.example .env` em Bash). Os valores do exemplo destinam-se ao ambiente local.

```sh
docker compose up --build
```

Abra [a interface](http://localhost:5173) ou [a documentação da API](http://localhost:8000/docs). O Compose aguarda o PostgreSQL e executa a migração antes de iniciar a API. Os serviços HTTP são publicados na interface de loopback. O banco usa um volume local.

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
