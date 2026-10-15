#!/bin/sh
# Aggiorna l'archivio NYT Connections (nuovi puzzle giornalieri) e ricostruisce il container
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -sfL -o "$tmp/connections.json" https://raw.githubusercontent.com/Eyefyre/NYT-Connections-Answers/main/connections.json
python3 -I tools/build_connections_data.py puzzles "$tmp/connections.json" app
./run.sh
