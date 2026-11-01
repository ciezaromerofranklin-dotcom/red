"""
checklist_profiles.py
Perfiles de CheckList listos para usar, armados a partir de los ejemplos reales:

  Internet - Huawei / Huawei con MRA / Cisco / Cisco con MRA / Fortinet
  RPV      - Huawei / Huawei con MRA / Huawei con HA
             Cisco  / Cisco con MRA  / Cisco con HA

Regla que se siguió: lo que existe en el ejemplo de una marca y no en la otra
se completó con el comando equivalente (ver EQUIVALENCIAS al final), y los perfiles
"sin MRA" son los "con MRA" sin los ítems de MRA.

Los comandos usan variables con llaves, p. ej. {WAN_NH}. En la pantalla del CheckList
se piden una sola vez arriba y se reemplazan en todos los ítems. Un ítem cuyo comando
no tiene comando (modo "manual") es de captura/foto.

Se siembran SOLO si el perfil no existe (no pisa lo que el usuario editó). Con
restore_profile() se puede volver a dejar un perfil como el original.
"""

from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app import models

HUAWEI, CISCO, FORTI = "huawei", "cisco_ios", "fortinet"

# ---------------------------------------------------------------------------
# Catálogo de perfiles
# ---------------------------------------------------------------------------
PROFILES: List[dict] = [
    {"clave": "internet_cisco",        "etiqueta": "Internet - Cisco",            "vendor": CISCO,  "kind": "internet", "mra": False, "ha": False},
    {"clave": "internet_cisco_mra",    "etiqueta": "Internet - Cisco con MRA",    "vendor": CISCO,  "kind": "internet", "mra": True,  "ha": False},
    {"clave": "internet_huawei",       "etiqueta": "Internet - Huawei",           "vendor": HUAWEI, "kind": "internet", "mra": False, "ha": False},
    {"clave": "internet_huawei_mra",   "etiqueta": "Internet - Huawei con MRA",   "vendor": HUAWEI, "kind": "internet", "mra": True,  "ha": False},
    {"clave": "internet_fortinet",     "etiqueta": "Internet - Fortinet",         "vendor": FORTI,  "kind": "internet", "mra": False, "ha": False},
    {"clave": "rpv_cisco",             "etiqueta": "RPV - Cisco",                 "vendor": CISCO,  "kind": "rpv",      "mra": False, "ha": False},
    {"clave": "rpv_cisco_mra",         "etiqueta": "RPV - Cisco con MRA",         "vendor": CISCO,  "kind": "rpv",      "mra": True,  "ha": False},
    {"clave": "rpv_cisco_ha",          "etiqueta": "RPV - Cisco con HA",          "vendor": CISCO,  "kind": "rpv",      "mra": False, "ha": True},
    {"clave": "rpv_huawei",            "etiqueta": "RPV - Huawei",                "vendor": HUAWEI, "kind": "rpv",      "mra": False, "ha": False},
    {"clave": "rpv_huawei_mra",        "etiqueta": "RPV - Huawei con MRA",        "vendor": HUAWEI, "kind": "rpv",      "mra": True,  "ha": False},
    {"clave": "rpv_huawei_ha",         "etiqueta": "RPV - Huawei con HA",         "vendor": HUAWEI, "kind": "rpv",      "mra": False, "ha": True},
]

# Orden de aparición recomendado en las listas desplegables
PROFILE_ORDER = [p["clave"] for p in PROFILES]

SEC_A = "A: VALIDACION DE LA CONFIGURACION"
SEC_B = "B: VERIFICACION DE CONECTIVIDAD"
SEC_C = "C: PRUEBAS DE SATURACION"
SEC_D = "D: PRUEBAS ADICIONALES"
SEC_E = "E: ALTA DISPONIBILIDAD (HA)"


def _it(seccion: str, nombre: str, comando: str = "") -> dict:
    """Ítem: con comando es automático; sin comando es manual (foto/captura)."""
    return {"seccion": seccion, "nombre": nombre, "modo": "auto" if comando else "manual", "comando": comando}


# ---------------------------------------------------------------------------
# HUAWEI (VRP)
# ---------------------------------------------------------------------------
def _huawei(kind: str, mra: bool, ha: bool) -> List[dict]:
    rpv, net = kind == "rpv", kind == "internet"
    r: List[dict] = []
    r += [
        _it(SEC_A, "DISPLAY CURRENT-CONFIGURATION (Configuración actual)", "display current-configuration"),
        _it(SEC_A, "DISPLAY SAVED-CONFIGURATION (Configuración guardada)", "display saved-configuration"),
        _it(SEC_A, "DISPLAY VERSION (Versión del VRP)", "display version"),
        _it(SEC_A, "DISPLAY STARTUP", "display startup"),
        _it(SEC_A, "DIR (Archivos en flash)", "dir"),
    ]
    if rpv:
        r.append(_it(SEC_A, "DISPLAY PATCH-INFORMATION", "display patch-information"))
    r += [
        _it(SEC_A, "DISPLAY DEVICE", "display device"),
        _it(SEC_A, "DISPLAY ELABEL", "display elabel"),
    ]
    r += [
        _it(SEC_B, "DISPLAY IP ROUTING-TABLE (Tabla de enrutamiento)", "display ip routing-table"),
        _it(SEC_B, "PING TO WAN (Ping hacia la IP del siguiente salto)", "ping -c 30 -s 1500 {WAN_NH}"),
        _it(SEC_B, "PING LAN TO LAN (Ping hacia una IP remota)"),
    ]
    r += [
        _it(SEC_C, "DISPLAY ACL ALL", "display acl all"),
        _it(SEC_C, "DISPLAY INTERFACE [WAN Interface] (Estadísticas de la interface WAN)", "display interface {WAN_IF}"),
        _it(SEC_C, "CAPTURA SOFTWARE PARA SATURAR (OSTINATO)"),
        _it(SEC_C, "CAPTURA DE SATURACIÓN DESDE EQUIPO DE ACCESO (SUP)"),
        _it(SEC_C, "DISPLAY INTERFACE [LAN Interface] (Estadísticas de la interface LAN)", "display interface {LAN_IF}"),
    ]
    if rpv:
        r += [
            _it(SEC_C, "COS2 WAN", "display traffic policy statistics interface {WAN_SUBIF} outbound verbose classifier-base"),
            _it(SEC_C, "COS2 LAN", "display traffic policy statistics interface {LAN_VLANIF} inbound verbose classifier-base"),
        ]
    if net:
        r += [
            _it(SEC_D, "TRACERT (Tracert hacia una IP remota)"),
            _it(SEC_D, "SPEED TEST"),
        ]
    r += [
        _it(SEC_D, "DISPLAY ARP (Tabla ARP)", "display arp"),
        _it(SEC_D, "DISPLAY IP INTERFACE BRIEF (Estado de las interfaces)", "display ip interface brief"),
        _it(SEC_D, "DISPLAY BGP PEER", "display bgp peer"),
        _it(SEC_D, "DIS BGP ROUTING-TABLE PEER NEXT-HOP RECEIVED-ROUTES", "display bgp routing-table peer {BGP_PEER} received-routes"),
        _it(SEC_D, "DIS BGP ROUTING-TABLE PEER NEXT-HOP ADVERTISED-ROUTES", "display bgp routing-table peer {BGP_PEER} advertised-routes"),
        _it(SEC_D, "DISPLAY LLDP NEIGHBOR (Vecinos)", "display lldp neighbor brief"),
        _it(SEC_D, "DISPLAY MAC-ADDRESS (Tabla MAC)", "display mac-address"),
        _it(SEC_D, "DISPLAY TRANSCEIVER VERBOSE", "display transceiver verbose"),
        _it(SEC_D, "DISPLAY USERS", "display users"),
    ]
    if mra:
        if rpv:
            r.append(_it(SEC_D, "PING HACIA SERVIDOR MRA", "ping -a {LOOPBACK_IP} {MRA_IP}"))
        else:
            r.append(_it(SEC_D, "PING HACIA SERVIDOR MRA", "ping -c 5 {MRA_IP}"))
    if ha:
        r += [
            _it(SEC_E, "DISPLAY VRRP BRIEF (Estado de alta disponibilidad)", "display vrrp brief"),
            _it(SEC_E, "PING AL EQUIPO PRINCIPAL", "ping -c 5 {HA_PRINCIPAL_IP}"),
            _it(SEC_E, "PING AL EQUIPO DE CONTINGENCIA", "ping -c 5 {HA_CONT_IP}"),
            _it(SEC_E, "CUANDO EL PRINCIPAL CAE SE TIENE CONECTIVIDAD AL DE CONTINGENCIA"),
        ]
    return r


# ---------------------------------------------------------------------------
# CISCO (IOS XE)
# ---------------------------------------------------------------------------
def _cisco(kind: str, mra: bool, ha: bool) -> List[dict]:
    rpv, net = kind == "rpv", kind == "internet"
    r: List[dict] = []
    r += [
        _it(SEC_A, "SHOW RUNNING (Configuración actual)", "show running-config"),
        _it(SEC_A, "SHOW STARTUP-CONFIG (Configuración guardada)", "show startup-config"),
        _it(SEC_A, "SHOW VERSION", "show version"),
        _it(SEC_A, "SHOW BOOTVAR (Arranque)", "show bootvar"),
        _it(SEC_A, "SHOW FLASH", "dir"),
        _it(SEC_A, "SHOW PLATFORM (Estado del equipo)", "show platform"),
        _it(SEC_A, "SHOW INVENTORY", "show inventory"),
        _it(SEC_A, "SHOW CDP NEIGHBORS", "show cdp neighbors"),
    ]
    r += [
        _it(SEC_B, "SHOW IP ROUTE", "show ip route"),
        _it(SEC_B, "PING WAN (Ping hacia la IP del siguiente salto)", "ping {WAN_NH} size 1500 repeat 500"),
        _it(SEC_B, "PING LAN TO LAN (Ping hacia una IP remota)"),
        _it(SEC_B, "SHOW ACCESS-LIST", "show access-lists"),
    ]
    r += [
        _it(SEC_C, "SATURACIÓN OSTINATO"),
        _it(SEC_C, "SHOW INTERFACE WAN (Estadísticas de la interface WAN)", "show interfaces {WAN_IF}"),
        _it(SEC_C, "SHOW INTERFACE LAN (Estadísticas de la interface LAN)", "show interfaces {LAN_IF}"),
        _it(SEC_C, "CAP DEL SUP (Captura desde equipo de acceso)"),
    ]
    if net:
        r.append(_it(SEC_C, "SATURACIÓN SPEED TEST"))
    if rpv:
        r += [
            _it(SEC_C, "MARCADO EN WAN POR COS2", "show policy-map interface {WAN_SUBIF} output"),
            _it(SEC_C, "MARCADO EN LAN POR COS2", "show policy-map interface {LAN_VLANIF} input"),
            _it(SEC_C, "MARCADO COS 1 WAN"),
            _it(SEC_C, "MARCADO COS 1 LAN"),
        ]
    if net:
        r.append(_it(SEC_D, "TRACERT (Tracert hacia una IP remota)"))
    r += [
        _it(SEC_D, "SHOW ARP", "show arp"),
        _it(SEC_D, "SHOW IP INT BRIEF (Estado de las interfaces)", "show ip interface brief"),
        _it(SEC_D, "SHOW MAC ADDRESS-TABLE", "show mac address-table"),
        _it(SEC_D, "SHOW LLDP NEIGHBORS", "show lldp neighbors"),
        _it(SEC_D, "SHOW USERS", "show users"),
        _it(SEC_D, "SHOW BGP SUMMARY", "show ip bgp summary"),
        _it(SEC_D, "SHOW BGP NEIGHBORS NEXT HOP ADVERTISED-ROUTES", "show ip bgp neighbors {BGP_PEER} advertised-routes"),
        _it(SEC_D, "SHOW BGP NEIGHBORS NEXT HOP RECEIVED-ROUTES", "show ip bgp neighbors {BGP_PEER} received-routes"),
        _it(SEC_D, "SHOW HW-MODULE SUBSLOT 0/0 TRANSCEIVER 0 STATUS", "show hw-module subslot 0/0 transceiver 0 status"),
        _it(SEC_D, "SE GUARDÓ CONFIGURACIÓN", "write memory"),
    ]
    if mra:
        r.append(_it(SEC_D, "PING HACIA IP DE PROBE MRA", "ping {MRA_IP}"))
    if ha:
        r += [
            _it(SEC_E, "SHOW STANDBY BRIEF (Estado de alta disponibilidad)", "show standby brief"),
            _it(SEC_E, "PING AL EQUIPO PRINCIPAL", "ping {HA_PRINCIPAL_IP} repeat 100"),
            _it(SEC_E, "PING AL EQUIPO DE CONTINGENCIA", "ping {HA_CONT_IP} repeat 100"),
            _it(SEC_E, "CUANDO EL PRINCIPAL CAE SE TIENE CONECTIVIDAD AL DE CONTINGENCIA"),
        ]
    return r


# ---------------------------------------------------------------------------
# FORTINET (FortiGate)
# ---------------------------------------------------------------------------
def _fortinet() -> List[dict]:
    A, B, C = "A: CONFIGURACION", "B: CONECTIVIDAD", "C: PRUEBAS DE SATURACION"
    return [
        _it(A, "GET SYSTEM STATUS", "get system status"),
        _it(A, "GET HARDWARE STATUS", "get hardware status"),
        _it(A, "SHOW SYSTEM INTERFACE", "show system interface"),
        _it(A, "GET SYSTEM INTERFACE TRANSCEIVER", "get system interface transceiver"),
        _it(B, "GET ROUTER INFO ROUTING-TABLE ALL", "get router info routing-table all"),
        _it(B, "GET ROUTER INFO BGP SUMMARY", "get router info bgp summary"),
        _it(B, "GET ROUTER INFO BGP NEIGHBORS {BGP_PEER} ADVERTISED-ROUTES", "get router info bgp neighbors {BGP_PEER} advertised-routes"),
        _it(B, "GET ROUTER INFO BGP NEIGHBORS {BGP_PEER} RECEIVED-ROUTES", "get router info bgp neighbors {BGP_PEER} received-routes"),
        _it(B, "GET SYSTEM ARP", "get system arp"),
        _it(B, "PING AL SIGUIENTE SALTO", "execute ping {WAN_NH}"),
        _it(B, "PING A LA LAN", "execute ping {LAN_IP}"),
        _it(B, "PING A INTERNET", "execute ping 8.8.8.8"),
        _it(B, "TRAZA A INTERNET", "execute traceroute 8.8.8.8"),
        _it(C, "ACCESO (Captura desde equipo de acceso)"),
        _it(C, "SPEEDTEST"),
    ]


def profile_items(p: dict) -> List[dict]:
    """Ítems (con 'orden' de 10 en 10) del perfil p."""
    if p["vendor"] == HUAWEI:
        rows = _huawei(p["kind"], p["mra"], p["ha"])
    elif p["vendor"] == CISCO:
        rows = _cisco(p["kind"], p["mra"], p["ha"])
    else:
        rows = _fortinet()
    return [dict(r, orden=(i + 1) * 10) for i, r in enumerate(rows)]


def get_profile(clave: str) -> Optional[dict]:
    return next((p for p in PROFILES if p["clave"] == clave), None)


# ---------------------------------------------------------------------------
# Siembra
# ---------------------------------------------------------------------------
def _insert_items(db: Session, clave: str, rows: List[dict]) -> None:
    for it in rows:
        db.add(models.ChecklistItem(
            servicio=clave, seccion=it["seccion"], nombre=it["nombre"],
            orden=it["orden"], modo=it["modo"], comando=it["comando"],
        ))


def ensure_profiles(db: Session) -> None:
    """Crea los perfiles que falten. Nunca toca los que ya existen (conserva las ediciones)."""
    for p in PROFILES:
        svc = db.query(models.Service).filter_by(clave=p["clave"]).first()
        if svc is None:
            db.add(models.Service(clave=p["clave"], etiqueta=p["etiqueta"], vendor=p["vendor"]))
            db.flush()
            _insert_items(db, p["clave"], profile_items(p))
        elif not getattr(svc, "vendor", ""):
            svc.vendor = p["vendor"]  # el perfil ya estaba: solo se completa la marca
    db.commit()


def restore_profile(db: Session, clave: str) -> int:
    """Deja un perfil de fábrica como el original (borra sus ítems y los vuelve a crear)."""
    p = get_profile(clave)
    if p is None:
        raise KeyError(clave)
    svc = db.query(models.Service).filter_by(clave=clave).first()
    if svc is None:
        svc = models.Service(clave=clave, etiqueta=p["etiqueta"], vendor=p["vendor"])
        db.add(svc)
    svc.vendor = p["vendor"]
    db.query(models.ChecklistItem).filter(models.ChecklistItem.servicio == clave).delete()
    rows = profile_items(p)
    _insert_items(db, clave, rows)
    db.commit()
    return len(rows)


# ---------------------------------------------------------------------------
# Equivalencias (documentación): Huawei <-> Cisco
# ---------------------------------------------------------------------------
EQUIVALENCIAS: Dict[str, str] = {
    "display current-configuration": "show running-config",
    "display saved-configuration": "show startup-config",
    "display startup": "show bootvar",
    "display device": "show platform",
    "display elabel": "show inventory",
    "dir": "dir",
    "display acl all": "show access-lists",
    "display interface X": "show interfaces X",
    "display traffic policy statistics interface X outbound verbose classifier-base": "show policy-map interface X output",
    "display arp": "show arp",
    "display ip interface brief": "show ip interface brief",
    "display bgp peer": "show ip bgp summary",
    "display bgp routing-table peer X received-routes": "show ip bgp neighbors X received-routes",
    "display bgp routing-table peer X advertised-routes": "show ip bgp neighbors X advertised-routes",
    "display transceiver verbose": "show hw-module subslot 0/0 transceiver 0 status",
    "display lldp neighbor brief": "show lldp neighbors",
    "display mac-address": "show mac address-table",
    "display users": "show users",
    "display vrrp brief": "show standby brief",
}
