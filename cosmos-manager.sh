#!/bin/sh
# COSMOS Manager: keeps the web app and MCP server on, manages storage.
cd "$(dirname "$0")" || exit 1
if [ -x ".venv/bin/python" ]; then exec .venv/bin/python manager/cosmos_manager.py "$@"; fi
exec python3 manager/cosmos_manager.py "$@"
