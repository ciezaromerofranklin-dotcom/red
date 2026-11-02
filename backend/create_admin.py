"""
create_admin.py — crea (o actualiza) una cuenta de ADMINISTRADOR directamente en la base de datos.

Uso (desde la carpeta backend, con DATABASE_URL apuntando a tu base de datos):

    python create_admin.py <usuario> "<contraseña>"

Si el usuario ya existe, le cambia la contraseña y lo deja como administrador activo.
La contraseña se guarda cifrada (PBKDF2); no queda escrita en ningún archivo del proyecto.
El nombre de usuario no distingue mayúsculas; la contraseña sí.
"""

import sys

from app import auth, models
from app.database import Base, SessionLocal, engine


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 1
    username, password = sys.argv[1].strip().lower(), sys.argv[2]
    if len(username) < 3 or len(password) < 6:
        print("El usuario necesita 3 o más caracteres y la contraseña 6 o más.")
        return 1

    Base.metadata.create_all(bind=engine)  # por si las tablas nuevas aún no existen
    db = SessionLocal()
    try:
        user = db.query(models.User).filter_by(username=username).first()
        if user is None:
            user = models.User(username=username, nombre="Administrador", password_hash=auth.hash_password(password), rol="admin")
            db.add(user)
            print(f"Administrador '{username}' creado.")
        else:
            user.password_hash = auth.hash_password(password)
            user.rol, user.activo, user.expires_at, user.daily_minutes_limit = "admin", True, None, 0
            print(f"El usuario '{username}' ya existía: ahora es administrador y tiene la contraseña nueva.")
        db.commit()
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
