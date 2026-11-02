"""
bootstrap_once.py — ALTA INICIAL DEL ADMINISTRADOR (TEMPORAL: borrar este archivo en el siguiente commit).

Al arrancar, si el usuario "franklinadmin" NO existe, lo crea como administrador. Si ya existe
(porque ya se creó, o porque cambiaste su contraseña) no hace nada: nunca la vuelve a pisar.

La contraseña NO está escrita aquí: solo su versión cifrada (PBKDF2). Aun así, cámbiala apenas
entres («Cambiar contraseña», abajo a la izquierda) y quita este archivo.

Para quitarlo: borrar este archivo y las dos líneas marcadas "bootstrap_once" en app/main.py.
"""

from sqlalchemy.orm import Session

from app import models

USERNAME = "franklinadmin"
PASSWORD_HASH = "pbkdf2_sha256$260000$3Gtwh2ZxSnfbl4ffzqzl+Q==$TNFWegnT4Lv16s8LeXlvKn9/Tx66Oz/trtBXX+VAadI="


def seed_initial_admin(db: Session, log=print) -> None:
    if db.query(models.User).filter_by(username=USERNAME).first() is not None:
        return
    db.add(models.User(username=USERNAME, nombre="Franklin (Administrador)", password_hash=PASSWORD_HASH, rol="admin"))
    db.commit()
    log(f"[bootstrap_once] Administrador inicial '{USERNAME}' creado.")
