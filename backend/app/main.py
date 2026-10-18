import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import CORS_ORIGINS
from app.database import Base, engine, SessionLocal
from app import db_seed
from app.routers import services, vendors, templates, checklist, photos, tests, files, serial_ports, tools, logos

app = FastAPI(title="NetOps Suite API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(services.router)
app.include_router(vendors.router)
app.include_router(templates.router)
app.include_router(checklist.router)
app.include_router(photos.router)
app.include_router(logos.router)
app.include_router(tests.router)
app.include_router(files.router)
app.include_router(serial_ports.router)
app.include_router(tools.router)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db_seed.seed_if_empty(db)
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------
# En producción (Docker), el frontend compilado (Vite build) se copia a
# esta carpeta y FastAPI lo sirve directamente -> UNA SOLA imagen/proceso
# atiende tanto la API como la interfaz web.
# ---------------------------------------------------------------
FRONTEND_DIST = Path(__file__).resolve().parent / "static_frontend"
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
