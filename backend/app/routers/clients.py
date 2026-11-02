"""
clients.py — clientes registrados (por SOT).

  /api/clients        cada usuario ve y edita SOLO los suyos.
  /api/admin/clients  el administrador ve los de todos (filtra por usuario, año o texto).
"""

import datetime as dt
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import extract, func, or_
from sqlalchemy.orm import Session

from app import auth, models
from app.database import get_db
from app.services.clients_service import record_to_dict, upsert_client
from app.services.fechas import normalize_sot

router = APIRouter(prefix="/api/clients", tags=["clients"], dependencies=[Depends(auth.current_user)])
admin_router = APIRouter(prefix="/api/admin/clients", tags=["admin"], dependencies=[Depends(auth.require_admin)])


class UpsertIn(BaseModel):
    sot: str
    cliente: str = ""
    cid: str = ""
    fecha: str = ""
    modulo: str = ""
    datos: Dict[str, Any] = {}


class EditIn(BaseModel):
    sot: Optional[str] = None
    cliente: Optional[str] = None
    cid: Optional[str] = None
    fecha: Optional[str] = None


def _query(db: Session, user_id: Optional[str], year: Optional[int], q: str):
    qs = db.query(models.ClientRecord)
    if user_id:
        qs = qs.filter(models.ClientRecord.user_id == user_id)
    if year == 0:       # 0 = clientes sin fecha entendible
        qs = qs.filter(models.ClientRecord.fecha.is_(None))
    elif year:
        qs = qs.filter(extract("year", models.ClientRecord.fecha) == year)
    if q.strip():
        like = f"%{q.strip()}%"
        qs = qs.filter(or_(models.ClientRecord.sot.ilike(f"%{normalize_sot(q) or q.strip()}%"),
                           models.ClientRecord.cliente.ilike(like), models.ClientRecord.cid.ilike(like)))
    return qs


def _years(db: Session, user_id: Optional[str]) -> List[dict]:
    qs = db.query(models.ClientRecord.fecha, func.count(models.ClientRecord.id))
    if user_id:
        qs = qs.filter(models.ClientRecord.user_id == user_id)
    counts: Dict[int, int] = {}
    for fecha, n in qs.group_by(models.ClientRecord.fecha).all():
        y = fecha.year if fecha else 0
        counts[y] = counts.get(y, 0) + n
    return [{"year": y, "count": counts[y]} for y in sorted(counts, reverse=True)]


def _order(qs):
    return qs.order_by(models.ClientRecord.fecha.desc(), models.ClientRecord.updated_at.desc())


# ----------------------------- el propio usuario -----------------------------
@router.get("/years")
def my_years(me: models.User = Depends(auth.current_user), db: Session = Depends(get_db)):
    return _years(db, me.id)


@router.get("")
def my_clients(year: Optional[int] = None, q: str = "", me: models.User = Depends(auth.current_user),
               db: Session = Depends(get_db)):
    return [record_to_dict(r) for r in _order(_query(db, me.id, year, q)).limit(5000).all()]


@router.post("/upsert")
def upsert(payload: UpsertIn, me: models.User = Depends(auth.current_user), db: Session = Depends(get_db)):
    """Guarda (o actualiza) un cliente por su SOT. Lo usan los botones «Guardar cliente»."""
    rec = upsert_client(db, me, sot=payload.sot, cliente=payload.cliente, cid=payload.cid,
                        fecha_texto=payload.fecha, modulo=payload.modulo, datos=payload.datos)
    if rec is None:
        raise HTTPException(400, "Escribe el SOT para guardar el cliente.")
    return record_to_dict(rec)


def _mine_or_admin(db: Session, me: models.User, rec_id: str) -> models.ClientRecord:
    rec = db.query(models.ClientRecord).filter_by(id=rec_id).first()
    if rec is None or (rec.user_id != me.id and me.rol != "admin"):
        raise HTTPException(404, "Cliente no encontrado.")
    return rec


@router.put("/{rec_id}")
def edit(rec_id: str, payload: EditIn, me: models.User = Depends(auth.current_user), db: Session = Depends(get_db)):
    rec = _mine_or_admin(db, me, rec_id)
    if payload.sot is not None:
        new_sot = normalize_sot(payload.sot)
        if not new_sot:
            raise HTTPException(400, "El SOT no puede quedar vacío.")
        clash = db.query(models.ClientRecord).filter(models.ClientRecord.user_id == rec.user_id,
                                                     models.ClientRecord.sot == new_sot,
                                                     models.ClientRecord.id != rec.id).first()
        if clash:
            raise HTTPException(400, "Ya tienes otro cliente con ese SOT.")
        rec.sot = new_sot
    if payload.cliente is not None:
        rec.cliente = payload.cliente.strip()
    if payload.cid is not None:
        rec.cid = payload.cid.strip()
    if payload.fecha is not None:
        from app.services.fechas import parse_fecha
        rec.fecha_texto = payload.fecha.strip()
        rec.fecha = parse_fecha(payload.fecha)
    db.commit()
    db.refresh(rec)
    return record_to_dict(rec)


@router.delete("/{rec_id}")
def remove(rec_id: str, me: models.User = Depends(auth.current_user), db: Session = Depends(get_db)):
    rec = _mine_or_admin(db, me, rec_id)
    db.delete(rec)
    db.commit()
    return {"ok": True}


# -------------------------------- administrador ------------------------------
@admin_router.get("/years")
def all_years(user_id: Optional[str] = None, db: Session = Depends(get_db)):
    return _years(db, user_id)


@admin_router.get("")
def all_clients(year: Optional[int] = None, user_id: Optional[str] = None, q: str = "",
                db: Session = Depends(get_db)):
    owners = {u.id: u for u in db.query(models.User).all()}
    rows = _order(_query(db, user_id, year, q)).limit(10000).all()
    return [record_to_dict(r, owners.get(r.user_id)) for r in rows]
