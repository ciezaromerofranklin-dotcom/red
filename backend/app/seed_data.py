"""
seed_data.py
Datos semilla (mismos que la version de escritorio): fragmentos de
plantilla Cisco, items del checklist "Internet - CPE Cisco C1121-8P", e
items del reporte fotografico. Se insertan en Postgres solo la primera vez
(si las tablas estan vacias).
"""

SEED_FRAGMENTS = [
    {
        "nombre": "Base global (Cisco IOS-XE)",
        "marca": "cisco_ios",
        "modelos_compatibles": "ISR4000 series (ISR4321, ISR4331, ISR4351, etc.)",
        "servicios": ["internet", "rpv", "ha", "rf"],
        "orden": 10,
        "texto": (
            "!\n"
            "service timestamps debug datetime localtime\n"
            "service timestamps log datetime localtime\n"
            "service password-encryption\n"
            "platform qfp utilization monitor load 80\n"
            "platform punt-keepalive disable-kernel-core\n"
            "platform hardware throughput crypto 50000\n"
            "!\n"
            "hostname {HOSTNAME}\n"
            "!\n"
            "logging buffered 9000\n"
            "!\n"
            "clock timezone GMT -5 0\n"
            "!\n"
            "ip name-server 200.62.191.11 200.24.191.11 200.62.191.12 200.24.191.12\n"
            "ip domain name claro.com.pe\n"
            "!\n"
            "login on-success log\n"
            "!\n"
            "subscriber templating\n"
            "multilink bundle-name authenticated\n"
            "!\n"
            "diagnostic bootup level minimal\n"
            "!\n"
            "memory free low-watermark processor 64463\n"
            "!\n"
            "spanning-tree extend system-id\n"
            "!\n"
            "redundancy\n"
            " mode none\n"
            "!\n"
            "vlan internal allocation policy ascending\n"
            "!\n"
            "lldp run\n"
        ),
    },
    {
        "nombre": "TACACS (AAA + servidor)",
        "marca": "cisco_ios",
        "modelos_compatibles": "ISR4000 series",
        "servicios": ["internet", "rpv"],
        "orden": 20,
        "texto": (
            "!\n"
            "aaa new-model\n"
            "!\n"
            "aaa authentication login default group tacacs+ enable\n"
            "aaa authentication enable default group tacacs+ enable\n"
            "aaa authorization commands 1 default group tacacs+ none\n"
            "aaa authorization commands 15 default group tacacs+ none\n"
            "aaa accounting exec default start-stop group tacacs+\n"
            "aaa accounting commands 1 default start-stop group tacacs+\n"
            "aaa accounting commands 15 default start-stop group tacacs+\n"
            "aaa accounting network default start-stop group tacacs+\n"
            "aaa accounting connection default start-stop group tacacs+\n"
            "!\n"
            "aaa common-criteria policy iiot_policy\n"
            " min-length 10\n"
            " max-length 127\n"
            " numeric-count 1\n"
            " upper-case 1\n"
            " lower-case 1\n"
            " char-changes 4\n"
            "!\n"
            "aaa session-id common\n"
            "!\n"
            "ip tacacs source-interface {WAN_INTERFACE}\n"
            "!\n"
            "tacacs-server directed-request\n"
            "tacacs-server key 7 {TACACS_KEY}\n"
            "!\n"
            "tacacs server {TACACS_IP}\n"
            " address ipv4 {TACACS_IP}\n"
        ),
    },
    {
        "nombre": "MRA (SNMP + NTP + NetFlow)",
        "marca": "cisco_ios",
        "modelos_compatibles": "ISR4000 series",
        "servicios": ["internet", "rpv"],
        "orden": 30,
        "texto": (
            "!\n"
            "snmp-server community {SNMP_COMMUNITY} RO\n"
            "snmp-server ifindex persist\n"
            "snmp-server trap-source Vlan1\n"
            "snmp-server enable traps tty\n"
            "snmp-server enable traps config\n"
            "snmp-server enable traps entity\n"
            "snmp-server enable traps cpu threshold\n"
            "snmp-server enable traps syslog\n"
            "snmp-server host {MRA_IP} envmon\n"
            "snmp-server host {MRA_IP} version 2c {SNMP_COMMUNITY}\n"
            "!\n"
            "ntp server {MRA_IP}\n"
            "ntp source Vlan1\n"
            "!\n"
            "flow record RECORD-IN\n"
            " match ipv4 source address\n"
            " match ipv4 destination address\n"
            " match transport source-port\n"
            " match transport destination-port\n"
            " match interface input\n"
            " match ipv4 protocol\n"
            " match ipv4 tos\n"
            " match ipv4 dscp\n"
            " match application name\n"
            " collect routing source as\n"
            " collect routing destination as\n"
            " collect routing next-hop address ipv4\n"
            " collect transport tcp flags\n"
            " collect counter bytes\n"
            " collect counter packets\n"
            " collect timestamp sys-uptime first\n"
            " collect timestamp sys-uptime last\n"
            " collect ipv4 source mask\n"
            " collect ipv4 destination mask\n"
            "exit\n"
            "!\n"
            "flow record RECORD-OUT\n"
            " match ipv4 source address\n"
            " match ipv4 destination address\n"
            " match transport source-port\n"
            " match transport destination-port\n"
            " match interface output\n"
            " match ipv4 protocol\n"
            " match ipv4 tos\n"
            " match ipv4 dscp\n"
            " match application name\n"
            " collect routing source as\n"
            " collect routing destination as\n"
            " collect routing next-hop address ipv4\n"
            " collect transport tcp flags\n"
            " collect counter bytes\n"
            " collect counter packets\n"
            " collect timestamp sys-uptime first\n"
            " collect timestamp sys-uptime last\n"
            " collect ipv4 source mask\n"
            " collect ipv4 destination mask\n"
            "exit\n"
            "!\n"
            "flow exporter EXPORTER-1\n"
            " destination {MRA_IP}\n"
            " source Vlan1\n"
            " transport udp 9996\n"
            " template data timeout 60\n"
            "exit\n"
            "flow monitor MONITOR-OUT\n"
            " exporter EXPORTER-1\n"
            " cache timeout active 60\n"
            " record RECORD-OUT\n"
            "exit\n"
            "flow monitor MONITOR-IN\n"
            " exporter EXPORTER-1\n"
            " cache timeout active 60\n"
            " record RECORD-IN\n"
            "exit\n"
            "!\n"
            "interface Vlan1\n"
            " ip flow monitor MONITOR-IN input\n"
            " ip flow monitor MONITOR-OUT output\n"
        ),
    },
    {
        "nombre": "Interfaz WAN (dot1Q + subinterfaz)",
        "marca": "cisco_ios",
        "modelos_compatibles": "ISR4000 series",
        "servicios": ["internet", "rpv"],
        "orden": 40,
        "texto": (
            "!\n"
            "interface {WAN_INTERFACE}\n"
            " no ip address\n"
            " no ip redirects\n"
            " no ip unreachables\n"
            " no ip proxy-arp\n"
            " load-interval 30\n"
            " media-type sfp\n"
            " no negotiation auto\n"
            " no shutdown\n"
            "!\n"
            "interface {WAN_INTERFACE}.{VLAN}\n"
            " description WAN INTERNET {ANCHO_BANDA} MBPS - CID \"{CID}\" - {CLIENTE}\n"
            " bandwidth {BW_KBPS}\n"
            " encapsulation dot1Q {VLAN}\n"
            " ip address {WAN_IP} {WAN_MASK}\n"
            " no ip redirects\n"
            " no ip unreachables\n"
            " no ip proxy-arp\n"
            " no shutdown\n"
        ),
    },
    {
        "nombre": "Interfaz LAN (Vlan1)",
        "marca": "cisco_ios",
        "modelos_compatibles": "ISR4000 series",
        "servicios": ["internet", "rpv", "ha", "rf"],
        "orden": 50,
        "texto": (
            "!\n"
            "interface Vlan1\n"
            " description Interface LAN\n"
            " ip address {LAN_IP} {LAN_MASK}\n"
            " no ip redirects\n"
            " no ip unreachables\n"
            " no ip proxy-arp\n"
            " load-interval 30\n"
            " no shutdown\n"
        ),
    },
    {
        "nombre": "BGP + Route-maps (RPV)",
        "marca": "cisco_ios",
        "modelos_compatibles": "ISR4000 series",
        "servicios": ["rpv"],
        "orden": 60,
        "texto": (
            "!\n"
            "router bgp {AS_LOCAL}\n"
            " bgp router-id {WAN_IP}\n"
            " bgp log-neighbor-changes\n"
            " !\n"
            " neighbor WAN_CLIENTE peer-group\n"
            " neighbor WAN_CLIENTE remote-as {AS_REMOTO}\n"
            " neighbor WAN_CLIENTE password {BGP_PASSWORD}\n"
            " neighbor WAN_CLIENTE timers 10 30\n"
            " !\n"
            " neighbor {NEIGHBOR_IP} peer-group WAN_CLIENTE\n"
            " neighbor {NEIGHBOR_IP} description WAN CLIENTE\n"
            " !\n"
            " address-family ipv4\n"
            "  network {LAN_NETWORK} mask {LAN_NETWORK_MASK}\n"
            "{EXTRA_LAN_NETWORKS}"
            "  neighbor WAN_CLIENTE send-community both\n"
            "  neighbor WAN_CLIENTE soft-reconfiguration inbound\n"
            "  neighbor WAN_CLIENTE route-map RECIBIR_REDES in\n"
            "  neighbor WAN_CLIENTE route-map ENVIAR_REDES out\n"
            "  neighbor {NEIGHBOR_IP} activate\n"
            " exit-address-family\n"
            "!\n"
            "ip bgp-community new-format\n"
            "!\n"
            "ip prefix-list RED_LAN seq 10 permit {LAN_NETWORK}/{LAN_PREFIX_LEN}\n"
            "{EXTRA_PREFIX_LIST}"
            "!\n"
            "ip prefix-list DG seq 10 permit 0.0.0.0/0\n"
            "!\n"
            "route-map RECIBIR_REDES deny 10\n"
            " description Denegacion_RED_LAN\n"
            " match ip address prefix-list RED_LAN\n"
            "!\n"
            "route-map RECIBIR_REDES permit 20\n"
            " description Permitir_DEFAULT\n"
            " match ip address prefix-list DG\n"
            "!\n"
            "route-map ENVIAR_REDES permit 10\n"
            " description ENVIO_RED_LAN\n"
            " match ip address prefix-list RED_LAN\n"
            " set community {AS_REMOTO}:1200\n"
        ),
    },
    {
        "nombre": "Gestión SSH + ACL + líneas VTY/CON",
        "marca": "cisco_ios",
        "modelos_compatibles": "ISR4000 series",
        "servicios": ["internet", "rpv", "ha", "rf"],
        "orden": 70,
        "texto": (
            "!\n"
            "ip forward-protocol nd\n"
            "no ip http server\n"
            "ip http authentication local\n"
            "no ip http secure-server\n"
            "!\n"
            "ip ssh bulk-mode 131072\n"
            "ip ssh time-out 60\n"
            "ip ssh authentication-retries 2\n"
            "ip ssh server algorithm mac hmac-sha1\n"
            "ip ssh server algorithm encryption aes128-cbc 3des-cbc aes192-cbc aes256-cbc aes128-ctr aes192-ctr aes256-ctr\n"
            "ip ssh server algorithm kex diffie-hellman-group14-sha1 diffie-hellman-group14-sha256\n"
            "!\n"
            "ip access-list standard 25\n"
            "{ACL_MGMT_LINES}"
            "!\n"
            "control-plane\n"
            "!\n"
            "line con 0\n"
            " session-timeout 10 output\n"
            " password 7 {CON_PASSWORD_ENC}\n"
            " stopbits 1\n"
            "!\n"
            "line vty 0 4\n"
            " session-timeout 10 output\n"
            " access-class 25 in\n"
            " password 7 {VTY_PASSWORD_ENC}\n"
            " transport input ssh\n"
            "!\n"
            "line vty 5 15\n"
            " session-timeout 10 output\n"
            " access-class 25 in\n"
            " password 7 {VTY_PASSWORD_ENC}\n"
            " transport input ssh\n"
        ),
    },
    {
        "nombre": "GPON (transceiver no soportado + EEM)",
        "marca": "cisco_ios",
        "modelos_compatibles": "ISR4000 series (solo si el enlace WAN es GPON)",
        "servicios": ["internet", "rpv"],
        "orden": 80,
        "texto": (
            "!\n"
            "service unsupported-transceiver\n"
            "!\n"
            "event manager applet interface_UP_{WAN_INTERFACE_SLUG} authorization bypass\n"
            " event syslog pattern \"Interface {WAN_INTERFACE}, changed state to down\"\n"
            " action 1.0 cli command \"enable\"\n"
            " action 1.5 cli command \"config t\"\n"
            " action 2.0 cli command \"service unsupported-transceiver\"\n"
            " action 3.0 cli command \"end\"\n"
        ),
    },
    {
        "nombre": "Guardar configuración",
        "marca": "cisco_ios",
        "modelos_compatibles": "ISR4000 series",
        "servicios": ["internet", "rpv", "ha", "rf"],
        "orden": 999,
        "texto": "! La configuración se guarda automáticamente al aplicarla (botón 'Aplicar al equipo').\n"
                 "! Este fragmento solo aparece como referencia en la vista previa / al guardar como .txt.\n",
    },
]


SEED_CHECKLIST_ITEMS = [
    {"seccion": "1A: VERIFICACION DE LA CONFIGURACIÓN", "nombre": "SHOW RUNNING (Configuración Actual)",
     "orden": 10, "modo": "auto", "comando": "show running-config"},
    {"seccion": "1A: VERIFICACION DE LA CONFIGURACIÓN", "nombre": "SHOW STARTUP-CONFIG (Configuración Guardada)",
     "orden": 20, "modo": "auto", "comando": "show startup-config"},
    {"seccion": "1A: VERIFICACION DE LA CONFIGURACIÓN", "nombre": "SHOW VERSION",
     "orden": 30, "modo": "auto", "comando": "show version"},
    {"seccion": "1A: VERIFICACION DE LA CONFIGURACIÓN", "nombre": "SHOW FLASH",
     "orden": 40, "modo": "auto", "comando": "show flash"},
    {"seccion": "1A: VERIFICACION DE LA CONFIGURACIÓN", "nombre": "SHOW INVENTORY",
     "orden": 50, "modo": "auto", "comando": "show inventory"},
    {"seccion": "1A: VERIFICACION DE LA CONFIGURACIÓN", "nombre": "SHOW CDP NEIGHBORS",
     "orden": 60, "modo": "auto", "comando": "show cdp neighbors"},

    {"seccion": "B: VERIFICACIÓN DE CONECTIVIDAD", "nombre": "SHOW IP ROUTE",
     "orden": 70, "modo": "auto", "comando": "show ip route"},
    {"seccion": "B: VERIFICACIÓN DE CONECTIVIDAD", "nombre": "PING WAN",
     "orden": 80, "modo": "auto", "comando": "ping {PARAM}"},
    {"seccion": "B: VERIFICACIÓN DE CONECTIVIDAD", "nombre": "PING LAN TO LAN",
     "orden": 90, "modo": "auto", "comando": "ping {PARAM}"},
    {"seccion": "B: VERIFICACIÓN DE CONECTIVIDAD", "nombre": "SHOW ACCESS-LIST",
     "orden": 100, "modo": "auto", "comando": "show access-list"},

    {"seccion": "C: PRUEBAS DE SATURACIÓN", "nombre": "SHOW INTERFACE WAN",
     "orden": 110, "modo": "auto", "comando": "show interface {PARAM}"},
    {"seccion": "C: PRUEBAS DE SATURACIÓN", "nombre": "SHOW INTERFACE LAN",
     "orden": 120, "modo": "auto", "comando": "show interface {PARAM}"},
    {"seccion": "C: PRUEBAS DE SATURACIÓN", "nombre": "CAP DEL SUP (captura de saturación / speedtest)",
     "orden": 130, "modo": "manual"},

    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "SHOW ARP",
     "orden": 140, "modo": "auto", "comando": "show arp"},
    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "SHOW IP INTERFACE BRIEF",
     "orden": 150, "modo": "auto", "comando": "show ip interface brief"},
    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "SE GUARDO CONFIGURACIÓN (write memory)",
     "orden": 160, "modo": "auto", "comando": "write memory"},
    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "SHOW MAC ADDRESS-TABLE",
     "orden": 170, "modo": "auto", "comando": "show mac address-table"},
    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "MARCADO EN WAN POR COS2",
     "orden": 180, "modo": "auto", "comando": "show policy-map interface {PARAM}"},
    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "MARCADO EN LAN POR COS2",
     "orden": 190, "modo": "auto", "comando": "show policy-map interface {PARAM}"},
    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "MARCADO COS 1 WAN",
     "orden": 200, "modo": "auto", "comando": "show policy-map interface {PARAM}"},
    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "MARCADO COS 3 LAN",
     "orden": 210, "modo": "auto", "comando": "show policy-map interface {PARAM}"},
    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "SHOW BGP SUMMARY",
     "orden": 220, "modo": "auto", "comando": "show bgp summary"},
    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "SHOW BGP NEIGHBORS ADVERTISED-ROUTES",
     "orden": 230, "modo": "auto", "comando": "show bgp neighbors {PARAM} advertised-routes"},
    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "SHOW BGP NEIGHBORS RECEIVED-ROUTES",
     "orden": 240, "modo": "auto", "comando": "show bgp neighbors {PARAM} received-routes"},
    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "MRA VIEWTINET (monitoreo)",
     "orden": 250, "modo": "manual"},
    {"seccion": "D: PRUEBAS ADICIONALES", "nombre": "SHOW HW-MODULE SUBSLOT TRANSCEIVER STATUS",
     "orden": 260, "modo": "auto", "comando": "show hw-module subslot {PARAM} transceiver 0 status"},
]


SEED_PHOTO_ITEMS = [
    {"categoria": "EQUIPOS INSTALADOS ACCESO", "nombre": "serie de modulo instalado", "orden": 10},
    {"categoria": "EQUIPOS INSTALADOS ACCESO", "nombre": "Puerto del equipo de acceso asignado", "orden": 20},
    {"categoria": "EQUIPOS INSTALADOS ACCESO", "nombre": "Puerto en caja Panduit", "orden": 30},
    {"categoria": "ETIQUETADO", "nombre": "Etiquetado jumper f.o lado panduit", "orden": 40},
    {"categoria": "ETIQUETADO", "nombre": "Etiquetado de jumper f.o lado equipo de acceso", "orden": 50},
    {"categoria": "RECORRIDO EN ACCESO", "nombre": "Recorrido de jumper F.O. desde caja Panduit hacia ATN", "orden": 60},
    {"categoria": "VISTA GENERAL UBICACION DE EQUIPOS", "nombre": "vista general de instalación", "orden": 70},
    {"categoria": "EQUIPOS LADO CLIENTE", "nombre": "Serie del router instalado", "orden": 80},
    {"categoria": "EQUIPOS LADO CLIENTE", "nombre": "Transceiver instalado (cliente)", "orden": 90},
    {"categoria": "ETIQUETADO CLIENTE", "nombre": "Etiqueta en jumper f.o en ont", "orden": 100},
    {"categoria": "ETIQUETADO CLIENTE", "nombre": "Etiqueta en caja panduit", "orden": 110},
    {"categoria": "ETIQUETADO CLIENTE", "nombre": "Etiqueta en la roseta", "orden": 120},
    {"categoria": "ETIQUETADO CLIENTE", "nombre": "Etiqueta en patch cord de red en ont", "orden": 130},
    {"categoria": "ETIQUETADO CLIENTE", "nombre": "Etiqueta en la WAN del router", "orden": 140},
    {"categoria": "ETIQUETADO CLIENTE", "nombre": "Etiqueta patch cord (cable de red) en la lan del router", "orden": 150},
    {"categoria": "ETIQUETADO CLIENTE", "nombre": "Etiqueta patch cord (cable de red) en swich del cliente", "orden": 160},
    {"categoria": "VISTA INSTALACION EN GABINETE", "nombre": "Caja Panduit", "orden": 170},
    {"categoria": "VISTA INSTALACION EN GABINETE", "nombre": "Caja Roseta", "orden": 180},
    {"categoria": "VISTA INSTALACION EN GABINETE", "nombre": "vista de equipos instalados", "orden": 190},
    {"categoria": "VISTA INSTALACION EN GABINETE", "nombre": "identificacion de equipos", "orden": 200},
    {"categoria": "VISTA INSTALACION EN GABINETE", "nombre": "Vista de jumper etiquetado y conectado a caja Panduit", "orden": 210},
    {"categoria": "RECORRIDO CLIENTE", "nombre": "Recorrido de jumper F.O. desde caja Panduit hacia router", "orden": 220},
    {"categoria": "RECORRIDO CLIENTE", "nombre": "Recorrido de jumper F.O. desde Roseta hacia router", "orden": 230},
    {"categoria": "RECORRIDO CLIENTE", "nombre": "Recorrido de jumper F.O. desde Router hacia Caja Panduit", "orden": 240},
    {"categoria": "RECORRIDO CLIENTE", "nombre": "Recorrido de jumper F.O. desde Router hacia Roseta", "orden": 250},
    {"categoria": "VISTA INSTALACION DE EQUIPOS", "nombre": "panoramica de equipos instalados", "orden": 260},
    {"categoria": "VISTA INSTALACION DE EQUIPOS", "nombre": "panoramica de equipos instalados", "orden": 270},
    {"categoria": "MULTIMETRO", "nombre": "medicion de voltaje con equipo sanwa(multimetro)", "orden": 280},
    {"categoria": "QR", "nombre": "QR Captura de encuesta del Cliente", "orden": 290},
]


CATEGORIAS = ["EQUIPOS INSTALADOS ACCESO","ETIQUETADO","RECORRIDO EN ACCESO","VISTA GENERAL UBICACION DE EQUIPOS","EQUIPOS LADO CLIENTE","ETIQUETADO CLIENTE","VISTA INSTALACION EN GABINETE","RECORRIDO CLIENTE","VISTA INSTALACION DE EQUIPOS","MULTIMETRO","QR"]

# ------------------------------------------------------------
# GPON: solo lado cliente. Cada tipo tiene su propia lista.
# ------------------------------------------------------------
CAT_GPON = [
    "EQUIPOS INSTALADOS",
    "INSTALACION Y IDENTIFICACION DE EQUIPOS",
    "RECORRIDO",
    "ETIQUETADO",
    "PANORAMICA DE UBICACION",
    "MULTIMETRO",
    "QR",
]

# Orden oficial de categorías por tipo (fibra usa CATEGORIAS)
TIPO_CATEGORIAS = {
    "fibra": CATEGORIAS,
    "gpon_ont": CAT_GPON,
    "gpon_modulo": CAT_GPON,
}

_COMUN_FINAL = [
    ("PANORAMICA DE UBICACION", "Panorámica del gabinete donde se instalaron los equipos"),
    ("MULTIMETRO", "Medición de voltaje con equipo Sanwa (multímetro)"),
    ("QR", "QR Captura de encuesta del Cliente"),
]

_GPON_ONT = [
    ("EQUIPOS INSTALADOS", "Serie del router instalado"),
    ("EQUIPOS INSTALADOS", "ONT instalada"),
    ("INSTALACION Y IDENTIFICACION DE EQUIPOS", "Vista general de la instalación"),
    ("INSTALACION Y IDENTIFICACION DE EQUIPOS", "Identificación de los equipos instalados"),
    ("RECORRIDO", "Foto de la roseta"),
    ("RECORRIDO", "Recorrido de fibra desde la roseta hacia la ONT"),
    ("RECORRIDO", "Recorrido desde la ONT hacia el router (puerto WAN)"),
    ("RECORRIDO", "Foto de la ONT conectada al router"),
    ("ETIQUETADO", "Etiquetado lado roseta"),
    ("ETIQUETADO", "Etiquetado lado ONT"),
    ("ETIQUETADO", "Etiquetado de cable de red lado ONT"),
    ("ETIQUETADO", "Etiquetado lado router"),
] + _COMUN_FINAL

# Sin ONT: la fibra va directo de la roseta al router.
_GPON_MODULO = [
    ("EQUIPOS INSTALADOS", "Serie del router instalado"),
    ("EQUIPOS INSTALADOS", "Módulo instalado en el router"),
    ("INSTALACION Y IDENTIFICACION DE EQUIPOS", "Vista general de la instalación"),
    ("INSTALACION Y IDENTIFICACION DE EQUIPOS", "Identificación de los equipos instalados"),
    ("RECORRIDO", "Foto de la roseta"),
    ("RECORRIDO", "Recorrido de fibra desde la roseta hacia el router"),
    ("RECORRIDO", "Fibra conectada al módulo del router"),
    ("ETIQUETADO", "Etiquetado lado roseta"),
    ("ETIQUETADO", "Etiquetado de fibra lado router"),
    ("ETIQUETADO", "Etiquetado de cable de red lado router"),
] + _COMUN_FINAL


def _with_order(rows):
    return [{"categoria": c, "nombre": n, "orden": (i + 1) * 10} for i, (c, n) in enumerate(rows)]


SEED_PHOTO_ITEMS_BY_TIPO = {
    "gpon_ont": _with_order(_GPON_ONT),
    "gpon_modulo": _with_order(_GPON_MODULO),
}

DEFAULT_SERVICE = "internet_cpe_cisco"
DEFAULT_SERVICE_LABEL = "Internet - CPE Cisco C1121-8P"
