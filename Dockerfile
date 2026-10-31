# ============================================================
# Dockerfile - UNA SOLA imagen para toda la aplicacion (frontend + backend).
#
# Etapa 1: compila el frontend (React + TypeScript + Vite) -> estaticos.
# Etapa 2: backend Python (FastAPI) que SIRVE esos archivos estaticos
#          ademas de la API. Un solo proceso, un solo puerto (8000).
#
# La base de datos (Postgres) NO va dentro de esta imagen - se conecta por
# la variable de entorno DATABASE_URL. Ver docker-compose.yml para
# levantar app + Postgres juntos con un solo comando.
# ============================================================

# ---------- Etapa 1: build del frontend ----------
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---------- Etapa 2: backend + frontend compilado ----------
FROM python:3.12-slim AS backend

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m playwright install --with-deps chromium

COPY backend/app ./app

COPY --from=frontend-build /frontend/dist ./app/static_frontend

RUN mkdir -p /app/app/storage/uploads /app/app/storage/outputs

ENV UPLOADS_DIR=/app/app/storage/uploads \
    OUTPUTS_DIR=/app/app/storage/outputs \
    PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
