import os

from sqlalchemy import URL, create_engine


def database_url() -> URL:
    return URL.create(
        "postgresql+psycopg",
        username=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        database=os.environ["POSTGRES_DB"],
    )


def create_database_engine():
    return create_engine(database_url(), pool_pre_ping=True)
