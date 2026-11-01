"""
clients_service.py
Registro de clientes: un registro por usuario y SOT que se actualiza solo cada vez que ese
usuario genera algo con ese SOT (checklist, reporte fotográfico...).
"""

import logging
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app import models
from app.services.fechas import normalize_sot, parse_fecha

log = logging.getLogger("netops.clients")


def _empty(v: Any) -> bool:
    return v is None or v == "" or v == {} or v == []


def upsert_client(
    db: Session,
    user: models.User,
    sot: str,
    cliente: str = "",
    cid: str = "",
    fecha_texto: str = "",
    modulo: str = "",
    datos: Optional[Dict[str, Any]] = None,
) -> Optional[models.ClientRecord]:
    """Crea o actualiza el cliente (SOT) del usuario. Sin SOT no se guarda nada (devuelve None).
    Solo pisa un dato si llega con contenido: un campo vacío no borra lo ya guardado."""
    key = normalize_sot(sot)
    if not key:
        return None

    rec = db.query(models.ClientRecord).filter_by(user_id=user.id, sot=key).first()
    if rec is None:
        rec = models.ClientRecord(user_id=user.id, sot=key, datos={}, modulos=[])
        db.add(rec)

    if (cliente or "").strip():
        rec.cliente = cliente.strip()
    if (cid or "").strip():
        rec.cid = cid.strip()
    if (fecha_texto or "").strip():
        rec.fecha_texto = fecha_texto.strip()
        parsed = parse_fecha(fecha_texto)
        if parsed is not None or rec.fecha is None:
            rec.fecha = parsed  # si la nueva no se entiende, se conserva la fecha ya entendida

    merged = dict(rec.datos or {})
    for k, v in (datos or {}).items():
        if _empty(v):
            continue
        if isinstance(v, dict) and isinstance(merged.get(k), dict):
            merged[k] = {**merged[k], **{kk: vv for kk, vv in v.items() if not _empty(vv)}}
        else:
            merged[k] = v
    rec.datos = merged

    mods = list(rec.modulos or [])
    if modulo and modulo not in mods:
        mods.append(modulo)
    rec.modulos = mods

    db.commit()
    db.refresh(rec)
    return rec


def safe_upsert(db: Session, user: models.User, **kwargs) -> None:
    """Igual que upsert_client pero sin interrumpir nunca la tarea principal (p. ej. el PDF)."""
    try:
        upsert_client(db, user, **kwargs)
    except Exception:  # pragma: no cover - el registro es secundario
        db.rollback()
        log.exception("No se pudo actualizar el registro de cliente")


def record_to_dict(rec: models.ClientRecord, owner: Optional[models.User] = None) -> Dict[str, Any]:
    d = {
        "id": rec.id, "user_id": rec.user_id, "sot": rec.sot, "cliente": rec.cliente or "", "cid": rec.cid or "",
        "fecha": rec.fecha.isoformat() if rec.fecha else None, "fecha_texto": rec.fecha_texto or "",
        "datos": rec.datos or {}, "modulos": rec.modulos or [],
        "created_at": rec.created_at.isoformat() if rec.created_at else None,
        "updated_at": rec.updated_at.isoformat() if rec.updated_at else None,
    }
    if owner is not None:
        d["usuario"] = owner.nombre or owner.username
        d["username"] = owner.username
    return d
