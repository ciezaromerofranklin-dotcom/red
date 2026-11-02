"""
models.py
Modelos SQLAlchemy - equivalentes en Postgres a los antiguos
templates_store.py / checklist_store.py / photo_items_store.py (JSON).
"""

import uuid
import datetime as dt

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, JSON, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY

from app.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class Service(Base):
    """Servicio (ej. 'internet_cpe_cisco', 'rpv') - usado tanto por
    plantillas como por el checklist."""
    __tablename__ = "services"

    id = Column(String, primary_key=True, default=gen_uuid)
    clave = Column(String, unique=True, nullable=False)
    etiqueta = Column(String, nullable=False)
    # Marca del equipo del perfil de CheckList: "cisco_ios" | "huawei" | "fortinet" | "" (sin definir).
    # Define cómo se desactiva el paginado y cómo se lee el prompt al ejecutar.
    vendor = Column(String, nullable=False, default="", server_default="")
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class TemplateFragment(Base):
    """Fragmento reutilizable de plantilla (ej. 'MRA', 'TACACS', 'BGP+RPV')."""
    __tablename__ = "template_fragments"

    id = Column(String, primary_key=True, default=gen_uuid)
    nombre = Column(String, nullable=False)
    marca = Column(String, nullable=False, index=True)
    modelos_compatibles = Column(String, default="")
    servicios = Column(ARRAY(String), default=list)
    orden = Column(Integer, default=50)
    texto = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)


class ChecklistItem(Base):
    """Item de un checklist (ej. 'SHOW RUNNING', seccion '1A: ...')."""
    __tablename__ = "checklist_items"

    id = Column(String, primary_key=True, default=gen_uuid)
    servicio = Column(String, nullable=False, index=True)
    seccion = Column(String, nullable=False)
    nombre = Column(String, nullable=False)
    orden = Column(Integer, default=10)
    modo = Column(String, default="auto")
    comando = Column(String, default="")
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class PhotoItem(Base):
    """Descripcion de item del reporte fotografico (ej. 'Transceiver instalado')."""
    __tablename__ = "photo_items"

    id = Column(String, primary_key=True, default=gen_uuid)
    categoria = Column(String, nullable=False, index=True)
    nombre = Column(String, nullable=False)
    orden = Column(Integer, default=10)
    # Tipo de reporte al que pertenece: fibra | gpon_ont | gpon_modulo
    tipo = Column(String, nullable=False, default="fibra", server_default="fibra", index=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class HeaderLogo(Base):
    """Logo reutilizable para la cabecera de los PDF.

    El binario se guarda en la base de datos (no en disco) para que no se
    pierda cuando el servidor se reinicia o se vuelve a desplegar.
    posicion: 'izq' (empresa) o 'der' (Claro).
    """
    __tablename__ = "header_logos"

    id = Column(String, primary_key=True, default=gen_uuid)
    posicion = Column(String, nullable=False, default="izq", index=True)
    nombre = Column(String, nullable=False)
    content_type = Column(String, nullable=False, default="image/png")
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class GeneratedDocument(Base):
    """Historial de PDFs generados (para poder listarlos/descargarlos despues)."""
    __tablename__ = "generated_documents"

    id = Column(String, primary_key=True, default=gen_uuid)
    tipo = Column(String, nullable=False)
    nombre_archivo = Column(String, nullable=False)
    meta = Column(JSON, default=dict)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


# ---------------------------------------------------------------------------
# Usuarios, límites de uso y registro de clientes
# ---------------------------------------------------------------------------
class User(Base):
    """Cuenta de acceso. rol 'admin' puede todo; rol 'user' solo ve y trabaja con lo suyo."""
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_uuid)
    username = Column(String, unique=True, nullable=False, index=True)   # siempre en minúsculas
    nombre = Column(String, nullable=False, default="")
    password_hash = Column(String, nullable=False)
    rol = Column(String, nullable=False, default="user")                 # 'admin' | 'user'
    activo = Column(Boolean, nullable=False, default=True)
    # Fecha de terminación (el último día que puede entrar). None = sin vencimiento.
    expires_at = Column(Date, nullable=True)
    # Límite de uso por día en minutos (0 = sin límite).
    daily_minutes_limit = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True)


class UsageDay(Base):
    """Segundos de uso de un usuario en un día (lo suma el 'latido' de la pantalla abierta)."""
    __tablename__ = "usage_days"
    __table_args__ = (UniqueConstraint("user_id", "dia", name="uq_usage_user_dia"),)

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    dia = Column(Date, nullable=False)
    segundos = Column(Integer, nullable=False, default=0)


class ClientRecord(Base):
    """
    Cliente (SOT) de un usuario. Hay uno por usuario y SOT: cada vez que ese usuario genera
    algo con el mismo SOT, el registro se actualiza (no se duplica).

    fecha = la fecha que el usuario escribió en el campo FECHA (no la de creación).
    datos = el resto de lo que se sabe del cliente (cpe, ancho de banda, IPs...), junto de
            todas las pantallas; se usa para volver a cargarlo en cualquier ventana.
    """
    __tablename__ = "client_records"
    __table_args__ = (UniqueConstraint("user_id", "sot", name="uq_client_user_sot"),)

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    sot = Column(String, nullable=False, index=True)          # normalizado (sin el prefijo "SOT")
    cliente = Column(String, nullable=False, default="")
    cid = Column(String, nullable=False, default="")
    fecha = Column(Date, nullable=True, index=True)           # fecha escrita por el usuario (ya interpretada)
    fecha_texto = Column(String, nullable=False, default="")  # tal como la escribió
    datos = Column(JSON, nullable=False, default=dict)
    modulos = Column(JSON, nullable=False, default=list)      # pantallas donde se usó: ["checklist", ...]
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)


class AppSetting(Base):
    """Valores internos (p. ej. la clave con la que se firman los tokens de sesión)."""
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=False, default="")
