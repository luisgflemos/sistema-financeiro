import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.bank_accounts import router as bank_accounts_router
from app.catalog_import import router as catalog_import_router
from app.catalogs import router as catalogs_router
from app.db import create_database_engine
from app.organizations import router as organizations_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.database = create_database_engine()
    try:
        yield
    finally:
        app.state.database.dispose()


app = FastAPI(title="Finare", lifespan=lifespan)
app.include_router(bank_accounts_router)
app.include_router(catalogs_router)
app.include_router(catalog_import_router)
app.include_router(organizations_router)


@app.get("/health")
def health(request: Request, response: Response) -> dict[str, str]:
    try:
        with request.app.state.database.connect() as connection:
            connection.execute(text("SELECT 1 FROM organizations LIMIT 1"))
    except SQLAlchemyError:
        logger.warning("health_database_unavailable")
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unavailable"}

    return {"status": "ok"}
