import base64
import binascii
import hmac
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.main import app as api
from app.main import health, lifespan


@asynccontextmanager
async def hosted_lifespan(app: FastAPI):
    username = os.environ.get("FINARE_ACCESS_USER", "finare")
    password = os.environ.get("FINARE_ACCESS_PASSWORD", "")
    if not username or ":" in username or len(password) < 16:
        raise RuntimeError("Configure FINARE_ACCESS_USER e FINARE_ACCESS_PASSWORD no serviço.")
    app.state.credentials = (username.encode(), password.encode())
    async with lifespan(api):
        app.state.database = api.state.database
        yield


app = FastAPI(
    title="Finare",
    lifespan=hosted_lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


def authorized(request: Request) -> bool:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "basic":
        return False
    try:
        username, separator, password = base64.b64decode(token, validate=True).partition(b":")
    except (ValueError, binascii.Error):
        return False
    expected_username, expected_password = request.app.state.credentials
    user_matches = hmac.compare_digest(username, expected_username)
    password_matches = hmac.compare_digest(password, expected_password)
    return bool(separator) and user_matches and password_matches


@app.middleware("http")
async def protect_application(request: Request, call_next):
    if request.method == "GET" and request.url.path == "/health":
        return await call_next(request)
    if not authorized(request):
        return PlainTextResponse(
            "Entre com suas credenciais da Finare.",
            status_code=401,
            headers={
                "WWW-Authenticate": 'Basic realm="Finare", charset="UTF-8"',
                "Cache-Control": "no-store",
            },
        )
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


app.add_api_route("/health", health, include_in_schema=False)
app.mount("/api", api)
app.mount("/", StaticFiles(directory=Path(__file__).resolve().parents[1] / "web", html=True))
