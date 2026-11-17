import argparse

from sqlalchemy import text

from app.db import create_database_engine


def main() -> None:
    parser = argparse.ArgumentParser(description="Cria uma organização no ambiente local.")
    parser.add_argument("name", help="Nome da organização")
    args = parser.parse_args()
    name = args.name.strip()
    if not name:
        parser.error("Informe o nome da organização.")

    engine = create_database_engine()
    try:
        with engine.begin() as connection:
            organization_id = connection.execute(
                text("INSERT INTO organizations (name) VALUES (:name) RETURNING id"),
                {"name": name},
            ).scalar_one()
    finally:
        engine.dispose()
    print(organization_id)


if __name__ == "__main__":
    main()
