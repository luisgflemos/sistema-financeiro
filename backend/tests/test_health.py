from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from app import main


def test_health_uses_migrated_database():
    with TestClient(main.app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_reports_missing_schema(monkeypatch):
    monkeypatch.setattr(main, "create_database_engine", lambda: create_engine("sqlite://"))

    with TestClient(main.app) as client:
        response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
