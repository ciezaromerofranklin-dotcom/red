"""
models.py
Modelos SQLAlchemy - equivalentes en Postgres a los antiguos
templates_store.py / checklist_store.py / photo_items_store.py (JSON).
"""

import uuid
import datetime as dt

from sqlalchemy import Column, String, Integer, Text, DateTime, JSON, LargeBinary
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
