import argparse

from app.db import create_database_engine
from app.organizations import OrganizationInput, insert_organization


def main() -> None:
    parser = argparse.ArgumentParser(description="Cria uma organização no ambiente local.")
    parser.add_argument("name", help="Nome da organização")
    args = parser.parse_args()
    name = args.name.strip()
    if not 1 <= len(name) <= 200:
        parser.error("Informe um nome de organização com até 200 caracteres.")
    payload = OrganizationInput(name=name)

    engine = create_database_engine()
    try:
        with engine.begin() as connection:
            organization = insert_organization(connection, payload.name)
    finally:
        engine.dispose()
    print(organization.id)


if __name__ == "__main__":
    main()
