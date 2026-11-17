from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from app import main
from app.db import create_database_engine


@pytest.fixture
def catalog_client(monkeypatch):
    engine = create_database_engine()
    try:
        with engine.connect() as connection, connection.begin():

            class TransactionalDatabase:
                @contextmanager
                def begin(self):
                    with connection.begin_nested():
                        yield connection

                @contextmanager
                def connect(self):
                    yield connection

                def dispose(self):
                    pass

            monkeypatch.setattr(main, "create_database_engine", TransactionalDatabase)
            with TestClient(main.app) as client:
                try:
                    yield client, connection
                finally:
                    connection.rollback()
    finally:
        engine.dispose()
