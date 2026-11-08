#!/bin/sh
# Au premier démarrage sur un volume vide, copie le modèle d'embedding
# pré-téléchargé au build (voir Dockerfile) vers le volume persistant --
# sinon fastembed le re-téléchargerait depuis Hugging Face à chaque
# redémarrage du conteneur (le volume, lui, survit ; l'image seule, non).
set -e

BUILD_CACHE_DIR=/opt/fastembed_cache

if [ -n "$FASTEMBED_CACHE_DIR" ] && [ ! -d "$FASTEMBED_CACHE_DIR" -o -z "$(ls -A "$FASTEMBED_CACHE_DIR" 2>/dev/null)" ]; then
  echo "[entrypoint] premier démarrage : copie du modèle d'embedding vers $FASTEMBED_CACHE_DIR"
  mkdir -p "$FASTEMBED_CACHE_DIR"
  cp -r "$BUILD_CACHE_DIR/." "$FASTEMBED_CACHE_DIR/" 2>/dev/null || true
fi

exec python server.py
