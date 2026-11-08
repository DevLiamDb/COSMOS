# COSMOS — image pour déploiement hébergé (voir DEPLOY.md).
# Non utilisée pour l'usage local classique (python server.py en stdio).

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Pré-télécharge le modèle d'embedding (~220 Mo) au build plutôt qu'au
# premier appel réel -- évite un cold start très lent au premier souvenir
# écrit après un déploiement. Chemin FIXE et explicite (pas le dossier
# temporaire par défaut de fastembed, qui dépend de TMPDIR/tempfile.gettempdir()
# -- ambigu et pas garanti stable d'un environnement à l'autre). entrypoint.sh
# copie ce cache vers le volume persistant au premier démarrage réel.
RUN FASTEMBED_CACHE_DIR=/opt/fastembed_cache python -c "from cosmos.embeddings import embed; embed('warm-up')"

ENV COSMOS_MCP_TRANSPORT=http
ENV COSMOS_MCP_HOST=0.0.0.0
ENV COSMOS_DB_PATH=/data/cosmos.db
ENV FASTEMBED_CACHE_DIR=/data/fastembed_cache

EXPOSE 8765

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
