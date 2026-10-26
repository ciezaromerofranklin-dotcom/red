import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import CORS_ORIGINS
from sqlalchemy import inspect, text

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


def _ensure_columns() -> None:
    """
    create_all no modifica tablas que ya existen. Aquí se agregan, sin perder
    datos, las columnas nuevas que las bases de datos ya creadas no tienen.
    """
    insp = inspect(engine)
    if "photo_items" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("photo_items")}
        if "tipo" not in cols:
            with engine.begin() as conn:
                # los ítems que ya existían son de "Fibra convencional"
                conn.execute(text("ALTER TABLE photo_items ADD COLUMN tipo VARCHAR NOT NULL DEFAULT 'fibra'"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_photo_items_tipo ON photo_items (tipo)"))


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    db = SessionLocal()
    try:
        db_seed.seed_if_empty(db)
        db_seed.seed_photo_tipos(db)
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
class SPAStaticFiles(StaticFiles):
    """
    Sirve el frontend compilado y, para las rutas de la aplicación
    (/fotografico, /pruebas, ...), devuelve index.html en vez de un 404.

    Sin esto, al recargar la página (F5) estando en una ruta interna el
    navegador pedía un archivo con ese nombre, el servidor respondía
    {"detail":"Not Found"} y se veía una pantalla en blanco/negra con JSON.
    React Router resuelve la ruta en el navegador una vez cargado index.html.

    NO se hace el reemplazo para:
      - /api/...            (un error de la API debe seguir siendo un 404 real)
      - archivos con extensión (assets/app.js, favicon.ico...): si falta uno,
        devolver HTML con código 200 solo escondería el problema.
    """

    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or not self._is_app_route(path):
                raise
            return await super().get_response("index.html", scope)

        if response.status_code == 404 and self._is_app_route(path):
            return await super().get_response("index.html", scope)
        return response

    @staticmethod
    def _is_app_route(path: str) -> bool:
        path = path.strip("/")
        if path == "api" or path.startswith("api/"):
            return False
        return "." not in path.rsplit("/", 1)[-1]


FRONTEND_DIST = Path(__file__).resolve().parent / "static_frontend"
if FRONTEND_DIST.is_dir():
    app.mount("/", SPAStaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
