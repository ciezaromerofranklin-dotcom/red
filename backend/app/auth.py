"""
auth.py
Inicio de sesión, roles y límites de uso.

- Contraseñas: PBKDF2-SHA256 con sal propia (nunca se guardan en claro).
- Sesión: token firmado (JWT HS256) que dura TOKEN_HOURS. Viaja en el encabezado
  "Authorization: Bearer <token>"; en WebSocket y descargas se acepta ?token=<token>.
- Cada petición revisa en la base de datos que la cuenta siga activa, no esté vencida y no
  haya pasado su límite diario, así que desactivar o borrar a alguien surte efecto al instante.
"""

import base64
import datetime as dt
import hashlib
import hmac
import os
import secrets
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, WebSocketException
from sqlalchemy.orm import Session
from starlette.requests import HTTPConnection

from app import models
from app.database import get_db

TOKEN_HOURS = 12
PBKDF2_ITERATIONS = 260_000
UTC_OFFSET_HOURS = float(os.getenv("APP_UTC_OFFSET_HOURS", "-5"))  # Perú: UTC-5 todo el año


def local_now() -> dt.datetime:
    return dt.datetime.utcnow() + dt.timedelta(hours=UTC_OFFSET_HOURS)


def local_today() -> dt.date:
    return local_now().date()


# ---------------------------------------------------------------------------
# Contraseñas
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    b64 = lambda b: base64.b64encode(b).decode()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), int(iters))
        return hmac.compare_digest(digest, base64.b64decode(hash_b64))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Token
# ---------------------------------------------------------------------------
_secret_cache: Optional[str] = None


def get_secret(db: Session) -> str:
    """JWT_SECRET del entorno; si no hay, una clave generada y guardada en la base de datos
    (así es la misma en todos los procesos y no cambia al reiniciar)."""
    global _secret_cache
    env = os.getenv("JWT_SECRET")
    if env:
        return env
    if _secret_cache:
        return _secret_cache
    row = db.query(models.AppSetting).filter_by(key="jwt_secret").first()
    if row is None:
        row = models.AppSetting(key="jwt_secret", value=secrets.token_urlsafe(48))
        db.add(row)
        db.commit()
    _secret_cache = row.value
    return _secret_cache


def create_token(user: models.User, db: Session) -> str:
    exp = dt.datetime.utcnow() + dt.timedelta(hours=TOKEN_HOURS)
    return jwt.encode({"sub": user.id, "exp": exp}, get_secret(db), algorithm="HS256")


# ---------------------------------------------------------------------------
# Uso diario y estado de la cuenta
# ---------------------------------------------------------------------------
def usage_seconds_today(db: Session, user_id: str) -> int:
    row = db.query(models.UsageDay).filter_by(user_id=user_id, dia=local_today()).first()
    return row.segundos if row else 0


def account_problem(user: models.User, db: Session) -> Optional[str]:
    """Mensaje si la cuenta no puede usarse ahora (desactivada, vencida o sin tiempo hoy)."""
    if not user.activo:
        return "Tu cuenta está desactivada. Habla con el administrador."
    if user.rol != "admin":
        if user.expires_at and local_today() > user.expires_at:
            return f"Tu acceso terminó el {user.expires_at.strftime('%d/%m/%Y')}. Habla con el administrador."
        if user.daily_minutes_limit and usage_seconds_today(db, user.id) >= user.daily_minutes_limit * 60:
            return f"Llegaste a tu límite de uso de hoy ({user.daily_minutes_limit} min). Vuelve mañana."
    return None


def _deny(conn: HTTPConnection, status_code: int, message: str):
    if conn.scope["type"] == "websocket":
        raise WebSocketException(code=1008, reason=message[:120])
    raise HTTPException(status_code=status_code, detail=message)


def _extract_token(conn: HTTPConnection) -> Optional[str]:
    auth = conn.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return conn.query_params.get("token")


def current_user(conn: HTTPConnection, db: Session = Depends(get_db)) -> models.User:
    """Dependencia: la persona que hace la petición (HTTP o WebSocket). 401 si no hay sesión válida."""
    token = _extract_token(conn)
    if not token:
        _deny(conn, 401, "Inicia sesión para continuar.")
    try:
        payload = jwt.decode(token, get_secret(db), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        _deny(conn, 401, "Tu sesión venció. Vuelve a iniciar sesión.")
    except jwt.PyJWTError:
        _deny(conn, 401, "Sesión no válida. Vuelve a iniciar sesión.")
    user = db.query(models.User).filter_by(id=payload.get("sub")).first()
    if user is None:
        _deny(conn, 401, "Tu cuenta ya no existe.")
    problem = account_problem(user, db)
    if problem:
        _deny(conn, 401, problem)
    return user


def require_admin(user: models.User = Depends(current_user)) -> models.User:
    if user.rol != "admin":
        raise HTTPException(403, "Solo el administrador puede hacer esto.")
    return user


# ---------------------------------------------------------------------------
# Administrador de arranque
# ---------------------------------------------------------------------------
def ensure_admin(db: Session, log=print) -> None:
    """
    Garantiza que exista un administrador.

    - Si defines ADMIN_USERNAME y ADMIN_PASSWORD en el entorno, esa cuenta se crea (o se
      actualiza) como administrador en cada arranque: con esas credenciales entras directo.
    - Si no las defines y todavía no hay ningún administrador, se crea 'admin' con una clave
      aleatoria que se muestra UNA vez en el registro del servidor.
    """
    username = (os.getenv("ADMIN_USERNAME") or "").strip().lower()
    password = os.getenv("ADMIN_PASSWORD") or ""

    if username and password:
        user = db.query(models.User).filter_by(username=username).first()
        if user is None:
            user = models.User(username=username, nombre="Administrador",
                               password_hash=hash_password(password), rol="admin")
            db.add(user)
            log(f"[auth] Administrador '{username}' creado desde ADMIN_USERNAME / ADMIN_PASSWORD.")
        else:
            user.password_hash = hash_password(password)
            user.rol, user.activo, user.expires_at, user.daily_minutes_limit = "admin", True, None, 0
        db.commit()
        return

    if db.query(models.User).filter_by(rol="admin").first() is None:
        generated = secrets.token_urlsafe(9)
        db.add(models.User(username="admin", nombre="Administrador",
                           password_hash=hash_password(generated), rol="admin"))
        db.commit()
        log("=" * 64)
        log("[auth] No había administrador. Se creó el usuario  admin")
        log(f"[auth] Contraseña inicial (cámbiala al entrar):  {generated}")
        log("[auth] Para fijar tus propias credenciales define ADMIN_USERNAME y ADMIN_PASSWORD.")
        log("=" * 64)
