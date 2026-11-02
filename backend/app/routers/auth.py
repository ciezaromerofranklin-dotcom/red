"""auth.py — inicio de sesión, perfil propio, latido de uso y cambio de contraseña."""

import datetime as dt
import time
from typing import Dict, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import auth, models
from app.database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Freno básico contra adivinar contraseñas: 5 fallos seguidos -> 1 minuto de espera.
_FAILS: Dict[Tuple[str, str], Tuple[int, float]] = {}
MAX_FAILS, LOCK_SECONDS = 5, 60


class LoginIn(BaseModel):
    username: str
    password: str


class PasswordIn(BaseModel):
    current_password: str
    new_password: str


def user_info(user: models.User, db: Session) -> dict:
    return {
        "id": user.id, "username": user.username, "nombre": user.nombre or user.username, "rol": user.rol,
        "expires_at": user.expires_at.isoformat() if user.expires_at else None,
        "daily_minutes_limit": user.daily_minutes_limit or 0,
        "minutes_today": auth.usage_seconds_today(db, user.id) // 60,
    }


@router.post("/login")
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)):
    username = payload.username.strip().lower()
    key = (username, request.client.host if request.client else "")
    count, first = _FAILS.get(key, (0, 0.0))
    if count >= MAX_FAILS and time.time() - first < LOCK_SECONDS:
        raise HTTPException(429, "Demasiados intentos. Espera un minuto e inténtalo de nuevo.")
    if time.time() - first >= LOCK_SECONDS:
        count = 0

    user = db.query(models.User).filter_by(username=username).first()
    if user is None or not auth.verify_password(payload.password, user.password_hash):
        _FAILS[key] = (count + 1, first if count else time.time())
        raise HTTPException(401, "Usuario o contraseña incorrectos.")
    _FAILS.pop(key, None)

    problem = auth.account_problem(user, db)
    if problem:
        raise HTTPException(401, problem)

    user.last_login_at = user.last_seen_at = dt.datetime.utcnow()
    db.commit()
    return {"token": auth.create_token(user, db), "user": user_info(user, db)}


@router.get("/me")
def me(user: models.User = Depends(auth.current_user), db: Session = Depends(get_db)):
    return user_info(user, db)


@router.post("/heartbeat")
def heartbeat(user: models.User = Depends(auth.current_user), db: Session = Depends(get_db)):
    """La pantalla abierta avisa cada minuto; así se suma el tiempo de uso del día."""
    now = dt.datetime.utcnow()
    gap = (now - user.last_seen_at).total_seconds() if user.last_seen_at else 60
    add = int(min(gap, 90)) if gap <= 180 else 60  # tras una pausa larga solo cuenta este minuto
    user.last_seen_at = now
    row = db.query(models.UsageDay).filter_by(user_id=user.id, dia=auth.local_today()).first()
    if row is None:
        row = models.UsageDay(user_id=user.id, dia=auth.local_today(), segundos=0)
        db.add(row)
    row.segundos = (row.segundos or 0) + max(add, 0)
    db.commit()
    return user_info(user, db)


@router.post("/change-password")
def change_password(payload: PasswordIn, user: models.User = Depends(auth.current_user), db: Session = Depends(get_db)):
    if not auth.verify_password(payload.current_password, user.password_hash):
        raise HTTPException(400, "La contraseña actual no es correcta.")
    if len(payload.new_password) < 6:
        raise HTTPException(400, "La nueva contraseña debe tener al menos 6 caracteres.")
    user.password_hash = auth.hash_password(payload.new_password)
    db.commit()
    return {"ok": True}
