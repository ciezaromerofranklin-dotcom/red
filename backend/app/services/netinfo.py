"""
netinfo.py
Datos de red del PC donde corre el backend: IPs de cada tarjeta, puerta de enlace
(DG) y si hay permisos de administrador (necesarios para el modo ICMP).
"""

import ctypes
import ipaddress
import os
import platform
import re
import socket
import subprocess

import psutil

IPV4_RE = r"(\d{1,3}(?:\.\d{1,3}){3})"


def _run(cmd, timeout=6) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout or ""
    except Exception:
        return ""


def list_interfaces():
    out = []
    stats = psutil.net_if_stats()
    for name, addrs in psutil.net_if_addrs().items():
        st = stats.get(name)
        for a in addrs:
            if a.family == socket.AF_INET and not a.address.startswith("127."):
                out.append({"name": name, "ip": a.address, "netmask": a.netmask or "",
                            "up": bool(st and st.isup), "speed_mbps": st.speed if st else 0})
    return out


def default_gateways():
    """Lista [{gateway, iface_ip, metric}] ordenada por métrica (la primera es la que se usa)."""
    system = platform.system()
    gws = []
    if system == "Windows":
        text = _run(["route", "print", "-4", "0.0.0.0"])
        for m in re.finditer(rf"^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+{IPV4_RE}\s+{IPV4_RE}\s+(\d+)", text, re.M):
            gws.append({"gateway": m.group(1), "iface_ip": m.group(2), "metric": int(m.group(3))})
    elif system == "Darwin":
        text = _run(["route", "-n", "get", "default"])
        g = re.search(rf"gateway:\s*{IPV4_RE}", text)
        if g:
            gws.append({"gateway": g.group(1), "iface_ip": "", "metric": 0})
    else:
        text = _run(["ip", "-4", "route", "show", "default"])
        for m in re.finditer(rf"default via {IPV4_RE}(?: dev (\S+))?(?:.*?metric (\d+))?", text):
            gws.append({"gateway": m.group(1), "iface_ip": "", "dev": m.group(2) or "",
                        "metric": int(m.group(3) or 0)})
    gws.sort(key=lambda g: g["metric"])
    # completa la IP de la tarjeta si solo se conoce el nombre
    if gws and any(not g["iface_ip"] for g in gws):
        by_name = {i["name"]: i["ip"] for i in list_interfaces()}
        for g in gws:
            if not g["iface_ip"]:
                g["iface_ip"] = by_name.get(g.get("dev", ""), "")
    # evita duplicados
    seen, uniq = set(), []
    for g in gws:
        key = (g["gateway"], g["iface_ip"])
        if key not in seen:
            seen.add(key)
            uniq.append(g)
    return uniq


def is_admin() -> bool:
    try:
        if platform.system() == "Windows":
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        return os.geteuid() == 0
    except Exception:
        return False


def same_subnet(ip: str, other: str, netmask: str) -> bool:
    try:
        net = ipaddress.ip_network(f"{ip}/{netmask}", strict=False)
        return ipaddress.ip_address(other) in net
    except ValueError:
        return False


def net_info():
    ifaces = list_interfaces()
    gws = default_gateways()
    for i in ifaces:  # marca la tarjeta que contiene cada DG
        i["gateway"] = next((g["gateway"] for g in gws if same_subnet(i["ip"], g["gateway"], i["netmask"] or "255.255.255.0")), "")
    return {"platform": platform.system(), "is_admin": is_admin(), "interfaces": ifaces, "gateways": gws}
