"""users.py — administración de usuarios (solo administrador)."""

import datetime as dt
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import auth, models
from app.database import get_db

router = APIRouter(prefix="/api/admin/users", tags=["admin"], dependencies=[Depends(auth.require_admin)])

USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,40}$")


class UserCreate(BaseModel):
    username: str
    nombre: str = ""
    password: str
    rol: str = "user"
    activo: bool = True
    expires_at: Optional[dt.date] = None      # fecha de terminación
    days: Optional[int] = None                # alternativa: "N días desde hoy"
    daily_minutes_limit: int = 0              # 0 = sin límite


class UserUpdate(BaseModel):
    nombre: Optional[str] = None
    password: Optional[str] = None            # restablecer contraseña
    rol: Optional[str] = None
    activo: Optional[bool] = None
    expires_at: Optional[dt.date] = None
    clear_expiry: bool = False                # quitar la fecha de terminación
    extend_days: Optional[int] = None         # alarga el acceso N días (desde hoy o desde su fecha actual)
    daily_minutes_limit: Optional[int] = None


def _out(u: models.User, db: Session, clients: int) -> dict:
    today = auth.local_today()
    return {
        "id": u.id, "username": u.username, "nombre": u.nombre or "", "rol": u.rol, "activo": bool(u.activo),
        "expires_at": u.expires_at.isoformat() if u.expires_at else None,
        "expired": bool(u.rol != "admin" and u.expires_at and today > u.expires_at),
        "daily_minutes_limit": u.daily_minutes_limit or 0,
        "minutes_today": auth.usage_seconds_today(db, u.id) // 60,
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "last_seen_at": u.last_seen_at.isoformat() if u.last_seen_at else None,
        "clients": clients,
    }


def _check_rol(rol: str):
    if rol not in ("admin", "user"):
        raise HTTPException(400, "El rol debe ser 'admin' o 'user'.")


@router.get("")
def list_users(db: Session = Depends(get_db)) -> List[dict]:
    counts = dict(db.query(models.ClientRecord.user_id, func.count(models.ClientRecord.id))
                  .group_by(models.ClientRecord.user_id).all())
    users = db.query(models.User).order_by(models.User.rol, models.User.username).all()
    return [_out(u, db, counts.get(u.id, 0)) for u in users]


@router.post("")
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    username = payload.username.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "El usuario debe tener 3 a 40 caracteres: letras, números, punto, guion o guion bajo.")
    if len(payload.password) < 6:
        raise HTTPException(400, "La contraseña debe tener al menos 6 caracteres.")
    _check_rol(payload.rol)
    if db.query(models.User).filter_by(username=username).first():
        raise HTTPException(400, "Ya existe un usuario con ese nombre.")
    expires = payload.expires_at
    if expires is None and payload.days:
        expires = auth.local_today() + dt.timedelta(days=int(payload.days))
    u = models.User(
        username=username, nombre=payload.nombre.strip(), password_hash=auth.hash_password(payload.password),
        rol=payload.rol, activo=payload.activo, expires_at=expires if payload.rol != "admin" else None,
        daily_minutes_limit=max(0, payload.daily_minutes_limit) if payload.rol != "admin" else 0,
    )
    db.add(u)
    db.commit()
    return _out(u, db, 0)


@router.put("/{user_id}")
def update_user(user_id: str, payload: UserUpdate, me: models.User = Depends(auth.current_user),
                db: Session = Depends(get_db)):
    u = db.query(models.User).filter_by(id=user_id).first()
    if not u:
        raise HTTPException(404, "Usuario no encontrado.")
    if payload.nombre is not None:
        u.nombre = payload.nombre.strip()
    if payload.password:
        if len(payload.password) < 6:
            raise HTTPException(400, "La contraseña debe tener al menos 6 caracteres.")
        u.password_hash = auth.hash_password(payload.password)
    if payload.rol is not None:
        _check_rol(payload.rol)
        if u.id == me.id and payload.rol != "admin":
            raise HTTPException(400, "No puedes quitarte el rol de administrador a ti mismo.")
        u.rol = payload.rol
    if payload.activo is not None:
        if u.id == me.id and not payload.activo:
            raise HTTPException(400, "No puedes desactivar tu propia cuenta.")
        u.activo = payload.activo
    if payload.clear_expiry:
        u.expires_at = None
    elif payload.expires_at is not None:
        u.expires_at = payload.expires_at
    if payload.extend_days:
        base = max(auth.local_today(), u.expires_at) if u.expires_at else auth.local_today()
        u.expires_at = base + dt.timedelta(days=int(payload.extend_days))
    if payload.daily_minutes_limit is not None:
        u.daily_minutes_limit = max(0, payload.daily_minutes_limit)
    if u.rol == "admin":  # el administrador no vence ni tiene límite
        u.expires_at, u.daily_minutes_limit = None, 0
    db.commit()
    n = db.query(func.count(models.ClientRecord.id)).filter_by(user_id=u.id).scalar() or 0
    return _out(u, db, n)


@router.delete("/{user_id}")
def delete_user(user_id: str, me: models.User = Depends(auth.current_user), db: Session = Depends(get_db)):
    u = db.query(models.User).filter_by(id=user_id).first()
    if not u:
        raise HTTPException(404, "Usuario no encontrado.")
    if u.id == me.id:
        raise HTTPException(400, "No puedes borrar tu propia cuenta.")
    if u.rol == "admin" and db.query(models.User).filter_by(rol="admin", activo=True).count() <= 1:
        raise HTTPException(400, "Debe quedar al menos un administrador activo.")
    # Se borran también sus clientes y su registro de uso.
    db.query(models.ClientRecord).filter_by(user_id=u.id).delete()
    db.query(models.UsageDay).filter_by(user_id=u.id).delete()
    db.delete(u)
    db.commit()
    return {"ok": True}
