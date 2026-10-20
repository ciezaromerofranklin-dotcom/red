"""
db_seed.py
Siembra la base de datos con datos de ejemplo, SOLO si las tablas
relevantes estan vacias (para no duplicar al reiniciar el contenedor).
"""

from sqlalchemy.orm import Session

from app import models, seed_data as sd


def seed_if_empty(db: Session):
    if db.query(models.Service).count() == 0:
        for clave, etiqueta in [
            ("internet", "Internet"), ("rpv", "RPV"), ("ha", "HA"), ("rf", "RF"),
            (sd.DEFAULT_SERVICE, sd.DEFAULT_SERVICE_LABEL),
        ]:
            existing = db.query(models.Service).filter_by(clave=clave).first()
            if not existing:
                db.add(models.Service(clave=clave, etiqueta=etiqueta))
        db.commit()

    if db.query(models.TemplateFragment).count() == 0:
        for frag in sd.SEED_FRAGMENTS:
            db.add(models.TemplateFragment(
                nombre=frag["nombre"], marca=frag["marca"],
                modelos_compatibles=frag.get("modelos_compatibles", ""),
                servicios=frag.get("servicios", []),
                orden=frag.get("orden", 50), texto=frag["texto"],
            ))
        db.commit()

    if db.query(models.ChecklistItem).count() == 0:
        for item in sd.SEED_CHECKLIST_ITEMS:
            db.add(models.ChecklistItem(
                servicio=sd.DEFAULT_SERVICE, seccion=item["seccion"],
                nombre=item["nombre"], orden=item.get("orden", 10),
                modo=item.get("modo", "auto"), comando=item.get("comando", ""),
            ))
        db.commit()

    if db.query(models.PhotoItem).count() == 0:
        for item in sd.SEED_PHOTO_ITEMS:
            db.add(models.PhotoItem(
                categoria=item["categoria"], nombre=item["nombre"],
                orden=item.get("orden", 10),
            ))
        db.commit()


def seed_photo_tipos(db: Session):
    """
    Lista inicial de ítems para GPON con ONT y GPON con módulo. Solo se
    siembra un tipo si todavía no tiene ningún ítem (no pisa lo que el
    usuario haya editado ni se duplica al reiniciar).
    """
    for tipo, rows in sd.SEED_PHOTO_ITEMS_BY_TIPO.items():
        if db.query(models.PhotoItem).filter(models.PhotoItem.tipo == tipo).count() == 0:
            for item in rows:
                db.add(models.PhotoItem(
                    tipo=tipo, categoria=item["categoria"],
                    nombre=item["nombre"], orden=item["orden"],
                ))
    db.commit()
