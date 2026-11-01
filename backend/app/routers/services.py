from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/api/services", tags=["services"])


@router.get("", response_model=list[schemas.ServiceOut])
def list_services(db: Session = Depends(get_db)):
    return db.query(models.Service).order_by(models.Service.etiqueta).all()


@router.post("", response_model=schemas.ServiceOut)
def create_service(payload: schemas.ServiceCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Service).filter_by(clave=payload.clave).first()
    if existing:
        raise HTTPException(400, "Ya existe un servicio con esa clave.")
    svc = models.Service(clave=payload.clave, etiqueta=payload.etiqueta, vendor=payload.vendor or "")
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return svc


@router.put("/{clave}", response_model=schemas.ServiceOut)
def update_service(clave: str, payload: schemas.ServiceUpdate, db: Session = Depends(get_db)):
    """Cambia el nombre visible y/o la marca del perfil (la clave no cambia)."""
    svc = db.query(models.Service).filter_by(clave=clave).first()
    if not svc:
        raise HTTPException(404, "Servicio no encontrado.")
    if payload.etiqueta is not None and payload.etiqueta.strip():
        svc.etiqueta = payload.etiqueta.strip()
    if payload.vendor is not None:
        svc.vendor = payload.vendor
    db.commit()
    db.refresh(svc)
    return svc


@router.post("/{clave}/duplicate", response_model=schemas.ServiceOut)
def duplicate_service(clave: str, payload: schemas.ServiceDuplicate, db: Session = Depends(get_db)):
    """Copia un perfil con todos sus ítems de CheckList (para crear una variante propia)."""
    src = db.query(models.Service).filter_by(clave=clave).first()
    if not src:
        raise HTTPException(404, "Servicio no encontrado.")
    new_key = payload.clave.strip()
    if not new_key:
        raise HTTPException(400, "Indica la clave del nuevo perfil.")
    if db.query(models.Service).filter_by(clave=new_key).first():
        raise HTTPException(400, "Ya existe un servicio con esa clave.")
    dst = models.Service(clave=new_key, etiqueta=payload.etiqueta.strip() or new_key, vendor=src.vendor or "")
    db.add(dst)
    for it in db.query(models.ChecklistItem).filter(models.ChecklistItem.servicio == clave).order_by(models.ChecklistItem.orden):
        db.add(models.ChecklistItem(servicio=new_key, seccion=it.seccion, nombre=it.nombre,
                                    orden=it.orden, modo=it.modo, comando=it.comando))
    db.commit()
    db.refresh(dst)
    return dst


@router.delete("/{clave}")
def delete_service(clave: str, db: Session = Depends(get_db)):
    """Elimina un perfil y sus ítems de CheckList."""
    svc = db.query(models.Service).filter_by(clave=clave).first()
    if not svc:
        raise HTTPException(404, "Servicio no encontrado.")
    db.query(models.ChecklistItem).filter(models.ChecklistItem.servicio == clave).delete()
    db.delete(svc)
    db.commit()
    return {"ok": True}
