"""
schemas.py
Schemas Pydantic para la API (request/response).
"""
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel


class ServiceOut(BaseModel):
    clave: str
    etiqueta: str
    class Config:
        from_attributes = True


class ServiceCreate(BaseModel):
    clave: str
    etiqueta: str


class FragmentBase(BaseModel):
    nombre: str
    marca: str
    modelos_compatibles: str = ""
    servicios: List[str] = []
    orden: int = 50
    texto: str = ""


class FragmentCreate(FragmentBase):
    pass


class FragmentUpdate(FragmentBase):
    pass


class FragmentOut(FragmentBase):
    id: str
    class Config:
        from_attributes = True


class BuildTemplateRequest(BaseModel):
    fragment_ids: List[str]
    variables: Dict[str, str] = {}
    extra_lan_networks: List[Dict[str, str]] = []
    acl_mgmt_ips: List[str] = []


class ApplyTemplateRequest(BuildTemplateRequest):
    marca: str
    connection: Dict[str, Any]


class ChecklistItemBase(BaseModel):
    servicio: str
    seccion: str
    nombre: str
    orden: int = 10
    modo: str = "auto"
    comando: str = ""


class ChecklistItemCreate(ChecklistItemBase):
    pass


class ChecklistItemOut(ChecklistItemBase):
    id: str
    class Config:
        from_attributes = True


class ChecklistRunItem(BaseModel):
    item_id: str
    param: Optional[str] = ""


class ChecklistRunRequest(BaseModel):
    connection: Dict[str, Any]
    items: List[ChecklistRunItem]


class ChecklistPdfItem(BaseModel):
    nombre: str
    seccion: str
    modo: str
    cmd: Optional[str] = ""
    output: Optional[str] = ""
    image_paths: List[str] = []


class ChecklistPdfRequest(BaseModel):
    titulo: str = "CheckList de Claro"
    servicio_label: str = ""
    sot: str = ""
    cid: str = ""
    fecha: str = ""
    device_id: str = ""
    # Logo guardado en la base de datos (tiene prioridad sobre logo_path)
    logo_id: Optional[str] = None
    # Logo subido solo para este reporte (archivo temporal)
    logo_path: Optional[str] = None
    items: List[ChecklistPdfItem]


class PhotoItemBase(BaseModel):
    categoria: str
    nombre: str
    orden: int = 10


class PhotoItemCreate(PhotoItemBase):
    # Si no se envía "orden" al crear, el ítem va al final de su categoría.
    orden: Optional[int] = None


class PhotoItemOut(PhotoItemBase):
    id: str
    class Config:
        from_attributes = True


class PhotoReorderRequest(BaseModel):
    """IDs de una categoría en el nuevo orden deseado."""
    ids: List[str]


class HeaderLogoOut(BaseModel):
    id: str
    posicion: Literal["izq", "der"]
    nombre: str
    url: str


class PhotoReportItem(BaseModel):
    numero: int
    descripcion: str
    image_path: Optional[str] = None
    lado: Literal["site", "pdi", "pop", "cliente"] = "site"


class PhotoReportRequest(BaseModel):
    # gpon_ont / gpon_modulo: todas las fotos van en el lado CLIENTE.
    tipo: Literal["gpon_ont", "gpon_modulo", "fibra"] = "fibra"
    titulo: str = "REPORTE FOTOGRAFICO INSTALACION EN"
    proy: str = ""
    cliente: str = ""
    sot: str = ""
    fecha: str = ""
    cid: str = ""
    contrata: str = ""
    # Logo ya guardado en la base de datos (tiene prioridad sobre *_path)
    logo_izq_id: Optional[str] = None
    logo_der_id: Optional[str] = None
    # Logo subido solo para este reporte (archivo temporal)
    logo_izq_path: Optional[str] = None
    logo_der_path: Optional[str] = None
    items: List[PhotoReportItem]


class RunTestsRequest(BaseModel):
    connection: Dict[str, Any]
    vendor_key: str
    device_type: str
    uplink: str = ""
    ping: str = ""


class TestsPdfRequest(BaseModel):
    device_id: str = ""
    ip: str = ""
    vendor_label: str = ""
    sede: str = ""
    fecha: str = ""
    logo_izq_id: Optional[str] = None
    logo_der_id: Optional[str] = None
    logo_izq_path: Optional[str] = None
    logo_der_path: Optional[str] = None
    config_text: str = ""
    results: List[Dict[str, Any]] = []


class UploadOut(BaseModel):
    path: str
    url: str


# ---------------- Informe de diseño Poder Judicial ----------------

class PJCell(BaseModel):
    caption: str = ""
    images: List[str] = []          # rutas subidas (image_path)


class PJSection(BaseModel):
    title: str = ""
    cells: List[PJCell] = []


class PJChange(BaseModel):
    version: str = ""
    fecha: str = ""
    modificacion: str = ""


class PJReportRequest(BaseModel):
    portada_lineas: List[str] = []
    subtitulo_lineas: List[str] = []
    version: str = "1.0"
    periodo: str = ""
    cambios: List[PJChange] = []
    sede: str = ""
    sot: str = ""
    ubicacion_titulo: str = "Ubicación del Data Center"
    direccion: str = ""
    coordenadas: str = ""
    foto_ubicacion: Optional[str] = None
    sections: List[PJSection] = []
    conclusiones_intro: str = ""
    conclusiones: List[str] = []
    logo_id: Optional[str] = None
    logo_path: Optional[str] = None
