import hmac
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from time import monotonic

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.main import app as api
from app.main import health, lifespan

SESSION_COOKIE = "__Host-finare_session"
SESSION_DURATION = 8 * 60 * 60
MAX_SESSIONS = 64
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=256)
    password: str = Field(min_length=1, max_length=2048)


@asynccontextmanager
async def hosted_lifespan(app: FastAPI):
    username = os.environ.get("FINARE_ACCESS_USER", "finare")
    password = os.environ.get("FINARE_ACCESS_PASSWORD", "")
    if not username or ":" in username:
        raise RuntimeError("Configure FINARE_ACCESS_USER com um nome sem dois-pontos.")
    if len(password) < 8:
        raise RuntimeError("Configure FINARE_ACCESS_PASSWORD com pelo menos 8 caracteres.")
    app.state.credentials = (username.encode(), password.encode())
    app.state.sessions = {}
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


def has_session(request: Request) -> bool:
    token = request.cookies.get(SESSION_COOKIE, "")
    deadline = request.app.state.sessions.get(token, 0)
    return deadline > monotonic()


@app.middleware("http")
async def protect_application(request: Request, call_next):
    path = request.url.path
    if path == "/api" or path.startswith("/api/"):
        if request.method not in SAFE_METHODS:
            if request.headers.get("sec-fetch-site") in {"cross-site", "same-site"}:
                return JSONResponse({"detail": "Origem da solicitação inválida."}, status_code=403)
            if request.method in {"POST", "PUT", "PATCH"}:
                content_type = request.headers.get("content-type", "").split(";", 1)[0]
                if content_type != "application/json":
                    return JSONResponse({"detail": "Envie os dados em JSON."}, status_code=415)
        public = (request.method, path) in {("GET", "/api/session"), ("POST", "/api/login")}
        if not public and not has_session(request):
            return JSONResponse(
                {"detail": "Entre na Finare para continuar."},
                status_code=401,
                headers={"Cache-Control": "no-store"},
            )

    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/session")
def session(request: Request) -> dict[str, bool]:
    return {"authenticated": has_session(request)}


@app.post("/api/login", status_code=204)
async def login(credentials: Credentials, request: Request, response: Response):
    expected_user, expected_password = request.app.state.credentials
    user_matches = hmac.compare_digest(credentials.username.encode(), expected_user)
    password_matches = hmac.compare_digest(credentials.password.encode(), expected_password)
    if not (user_matches and password_matches):
        raise HTTPException(401, "Usuário ou senha incorretos.")

    sessions = request.app.state.sessions
    now = monotonic()
    for token, deadline in list(sessions.items()):
        if deadline <= now:
            sessions.pop(token, None)
    if len(sessions) >= MAX_SESSIONS:
        sessions.pop(next(iter(sessions)))

    token = secrets.token_urlsafe(32)
    sessions[token] = now + SESSION_DURATION
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DURATION,
        secure=True,
        httponly=True,
        samesite="strict",
    )


@app.delete("/api/session", status_code=204)
async def logout(request: Request, response: Response):
    request.app.state.sessions.pop(request.cookies.get(SESSION_COOKIE, ""), None)
    response.delete_cookie(SESSION_COOKIE, secure=True, httponly=True, samesite="strict")


app.add_api_route("/health", health, include_in_schema=False)
app.mount("/api", api)
app.mount("/", StaticFiles(directory=Path(__file__).resolve().parents[1] / "web", html=True))
