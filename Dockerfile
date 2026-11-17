FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package.json .
RUN npm install --no-audit --no-fund
COPY frontend/ .
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app/ ./app/
COPY backend/migrations/ ./migrations/
COPY backend/alembic.ini .
COPY --from=frontend /build/dist ./web/
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.hosted:app --host 0.0.0.0 --port \"${PORT:-8000}\""]
