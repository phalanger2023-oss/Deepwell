#!/bin/bash
# Mise à jour des applications de Julien (PDM et DeepWell) sur le serveur.
# Installé dans /usr/local/sbin/deploy-julien (propriétaire root) ; Julien le lance avec : sudo deploy-julien <appli> <action>
# Il ne donne accès qu'à ces deux applis : le fichier compose est vérifié avant chaque lancement.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

APP="${1:-}"; ACTION="${2:-deploy}"
USER_APP=julien
BASE=/home/julien/apps
case "$APP" in
  pdm)      DIR="$BASE/pdm";      SVC=pdf;      HOST_OK="pdm.louisharicuisine.com";      VOL_OK="annotateur_pdf_documents" ;;
  deepwell) DIR="$BASE/deepwell"; SVC=deepwell; HOST_OK="deepwell.louisharicuisine.com"; VOL_OK="deepwell_data" ;;
  *) echo "Usage : sudo deploy-julien <pdm|deepwell> <deploy|rebuild|status|logs|restart>"; exit 1 ;;
esac
case "$ACTION" in deploy|rebuild|status|logs|restart) ;; *) echo "Action inconnue : $ACTION (deploy, rebuild, status, logs, restart)"; exit 1 ;; esac
[ -d "$DIR" ] || { echo "Dossier introuvable : $DIR"; exit 1; }
cd "$DIR"

preparer() {  # fichier compose résolu, figé et lisible par root seulement : le contrôle porte sur le fichier réellement lancé
  TMP=$(mktemp /root/compose-XXXXXX); chmod 600 "$TMP"; trap 'rm -f "$TMP" "$TMP.json"' EXIT
  docker compose -p "$APP" config > "$TMP"
  docker compose -p "$APP" -f "$TMP" config --format json > "$TMP.json"
  APP_DIR="$DIR" HOST_OK="$HOST_OK" VOL_OK="$VOL_OK" python3 /usr/local/sbin/deploy-julien-check.py "$TMP.json"
}

case "$ACTION" in
  status)  docker compose -p "$APP" ps ;;
  logs)    docker compose -p "$APP" logs --tail 100 "$SVC" ;;
  restart) docker compose -p "$APP" restart "$SVC" ;;
  deploy|rebuild)
    echo "== Récupération du code (git pull)"; runuser -u "$USER_APP" -- git -C "$DIR" pull --ff-only
    preparer
    if [ "$ACTION" = rebuild ]; then echo "== Construction sans cache"; docker compose -p "$APP" -f "$TMP" build --no-cache; docker compose -p "$APP" -f "$TMP" up -d
    else echo "== Construction et démarrage"; docker compose -p "$APP" -f "$TMP" up -d --build; fi
    docker compose -p "$APP" -f "$TMP" ps ;;
esac
