import os
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL")

# 🚨 Validación obligatoria (evita el error NoneType)
if not DATABASE_URL:
    raise Exception(
        "DATABASE_URL no está configurada "
        "(en Railway/Render defínela en Variables; en local copia .env.example)."
    )

# 🔧 Compatibilidad Railway / Render / otros
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)


def _connect_args(url: str) -> dict:
    """
    SSL: se exige (require) en la nube (Railway/Render), pero NO cuando la BD
    es local o es un servicio de Docker (host "localhost", "127.0.0.1" o un
    nombre sin puntos como "db"), porque el Postgres de docker-compose no
    tiene SSL y la conexión fallaría. Se puede forzar con DB_SSLMODE
    (disable, prefer, require, ...).
    """
    forced = os.getenv("DB_SSLMODE")
    if forced:
        return {"sslmode": forced}

    host = (make_url(url).host or "").lower()
    is_local = host in ("", "localhost", "127.0.0.1", "::1") or "." not in host
    return {} if is_local else {"sslmode": "require"}


engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args=_connect_args(DATABASE_URL),
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
