#!/bin/sh
# Costruisce l'immagine e avvia la dashboard su http://localhost:${PORT:-8080}
set -e
cd "$(dirname "$0")"
podman build -t wordle-dashboard .
podman rm -f wordle-dashboard 2>/dev/null || true
podman run -d --name wordle-dashboard --restart=unless-stopped -p "${PORT:-8080}:80" wordle-dashboard
echo "Dashboard: http://localhost:${PORT:-8080}"
