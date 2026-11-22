#!/usr/bin/env python3
"""Contrôle du fichier compose d'une appli de Julien : seuls les réglages de CETTE appli sont acceptés.
Usage : deploy-julien-check.py <config.json>   (variables : APP_DIR, HOST_OK, VOL_OK)"""
import json, os, re, sys

cfg = json.load(open(sys.argv[1]))
d = os.path.realpath(os.environ["APP_DIR"])
host_ok, vol_ok = os.environ["HOST_OK"], os.environ["VOL_OK"]
erreurs = []

for nom, s in (cfg.get("services") or {}).items():
    for k in ("privileged", "cap_add", "pid", "ipc", "network_mode", "devices", "security_opt", "userns_mode",
              "uts", "cgroup_parent", "sysctls", "extra_hosts", "ports", "volumes_from", "group_add"):
        if s.get(k):
            erreurs.append(f"{nom}: option interdite « {k} »")
    if str(s.get("user", "")) in ("root", "0", "0:0"):
        erreurs.append(f"{nom}: utilisateur root interdit")
    for v in s.get("volumes") or []:
        reel = ((cfg.get("volumes") or {}).get(v.get("source")) or {}).get("name")
        if v.get("type") != "volume" or reel != vol_ok:
            erreurs.append(f"{nom}: volume interdit ({v.get('source')}) ; seul « {vol_ok} » est autorisé")
    for n in (s.get("networks") or {}):
        if n != "traefik-public":
            erreurs.append(f"{nom}: réseau interdit « {n} »")
    b = s.get("build")
    if b:
        ctx = os.path.realpath(b["context"] if isinstance(b, dict) else b)
        if not (ctx == d or ctx.startswith(d + "/")):
            erreurs.append(f"{nom}: le dossier de construction sort de {d}")
    m = s.get("mem_limit")
    if not m or int(m) > 1024 ** 3:
        erreurs.append(f"{nom}: mem_limit obligatoire et au plus 1 Go")
    for cle, val in (s.get("labels") or {}).items():
        if cle.endswith(".rule"):
            hotes = re.findall(r"Host\(`([^`]+)`\)", val)
            if hotes != [host_ok] or re.search(r"HostRegexp|HostSNI|PathPrefix\(`/`\)\s*\|\|", val) or "||" in val:
                erreurs.append(f"{nom}: règle Traefik interdite ({val}) ; seul Host(`{host_ok}`) est autorisé")
        if cle.startswith("traefik.") and "entrypoints" in cle and val != "websecure":
            erreurs.append(f"{nom}: entrypoint interdit")

for v, c in (cfg.get("volumes") or {}).items():
    c = c or {}
    if c.get("external") or c.get("name") != vol_ok:
        erreurs.append(f"volume interdit « {v} »")
for n, c in (cfg.get("networks") or {}).items():
    if n != "traefik-public" or not (c or {}).get("external"):
        erreurs.append(f"réseau interdit « {n} »")

if erreurs:
    print("REFUSÉ :")
    for e in erreurs:
        print(" -", e)
    sys.exit(1)
print("Contrôle du fichier compose : OK")
