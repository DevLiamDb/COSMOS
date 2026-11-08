"""
Couche de stockage de COSMOS.

Choix assume : SQLite. Un seul fichier, zero serveur a faire tourner,
zero dependance reseau, inspectable avec n'importe quel outil SQLite
standard. C'est une vraie base de production pour un volume modeste a
moyen (des dizaines/centaines de milliers de noeuds tournent sans
probleme) -- pas un jouet, mais pas non plus dimensionne pour un usage
multi-utilisateurs a tres grande echelle.

Chemin d'evolution honnete si ca grossit :
  - Beaucoup d'ecritures concurrentes / plusieurs process -> Postgres
    (+ extension pgvector pour les embeddings au lieu du BLOB brut ici).
  - Graphe avec des requetes multi-sauts complexes et un tres grand
    nombre d'aretes -> une vraie base graphe (Neo4j).
Le code de graph.py n'expose que des fonctions (write_node, recall,
query, link, neighbors) -- changer le backend de stockage ne casse pas
l'interface utilisee par server.py.

Localisation des donnees : par defaut, un fichier `cosmos.db` a la
racine du dossier COSMOS. Rien n'est envoye ailleurs -- c'est un fichier
local sur la machine qui fait tourner le serveur.
"""

import sqlite3
import numpy as np
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS nodes (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    node_type   TEXT NOT NULL DEFAULT 'fact',
    surface     TEXT NOT NULL,
    abyss       TEXT NOT NULL,
    embedding   BLOB NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_node   TEXT NOT NULL,
    to_node     TEXT NOT NULL,
    edge_type   TEXT NOT NULL,
    weight      REAL NOT NULL DEFAULT 1.0,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (from_node) REFERENCES nodes(id),
    FOREIGN KEY (to_node)   REFERENCES nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_session ON nodes(session_id);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node);

-- Une categorie par node_type deja rencontre -- son embedding est la moyenne
-- courante de tous les noeuds qui lui ont ete assignes (mise a jour a chaque
-- ecriture, voir CosmosEngine._touch_category). Sert a deux choses : la
-- classification automatique reconnait aussi les categories inventees a la
-- volee (pas seulement la taxonomie par defaut de categorize.py), et
-- `priority` permet de marquer certaines categories (regles, preferences
-- permanentes...) comme a charger systematiquement -- voir priority_context().
CREATE TABLE IF NOT EXISTS categories (
    name        TEXT PRIMARY KEY,
    embedding   BLOB NOT NULL,
    n_examples  INTEGER NOT NULL DEFAULT 0,
    priority    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

-- Reglages de la base, en cle/valeur. "embedding_model" = le modele qui a
-- calcule les vecteurs stockes : s'il change, CosmosEngine reindexe (voir
-- graph.py::_check_embedding_model) au lieu de comparer des vecteurs de
-- deux modeles differents.
CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
"""

# Colonnes ajoutees apres coup (personnalisation manuelle depuis la webapp :
# renommer/recolorer une categorie, editer/epingler un souvenir). Migration
# additive via ALTER TABLE -- jamais de DROP/RENAME destructif, les anciennes
# bases s'auto-completent silencieusement a la prochaine connexion, cote
# Python comme cote TypeScript (voir webapp/src/lib/cosmos/cosmos-db.ts qui
# fait exactement le meme constat avant d'ecrire dans le meme fichier).
_MIGRATIONS = {
    "categories": {
        "color": "ALTER TABLE categories ADD COLUMN color TEXT",
    },
    "nodes": {
        "pinned": "ALTER TABLE nodes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
        "title": "ALTER TABLE nodes ADD COLUMN title TEXT",
        "updated_at": "ALTER TABLE nodes ADD COLUMN updated_at TEXT",
    },
}


def _run_migrations(conn: sqlite3.Connection) -> None:
    for table, columns in _MIGRATIONS.items():
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        for column, ddl in columns.items():
            if column not in existing:
                conn.execute(ddl)
    # updated_at retro-rempli avec created_at pour les lignes anterieures a la
    # migration -- sinon un noeud jamais edite depuis n'aurait pas de date de
    # mise a jour du tout, ce qui casserait tout affichage qui en depend.
    conn.execute("UPDATE nodes SET updated_at = created_at WHERE updated_at IS NULL")
    conn.commit()


def connect(db_path: str) -> sqlite3.Connection:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False : le serveur MCP execute chaque appel d'outil
    # dans un thread de worker different (via anyio.to_thread), alors que la
    # connexion est creee une seule fois au demarrage dans le thread principal.
    # SQLite l'interdit par defaut (ProgrammingError) meme si les acces ne
    # sont jamais reellement concurrents en pratique ici -- CosmosEngine
    # serialise ses operations via son unique connexion, donc c'est sur de
    # desactiver cette verification.
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.commit()
    _run_migrations(conn)
    return conn


def embedding_to_blob(vec: np.ndarray) -> bytes:
    return vec.astype(np.float32).tobytes()


def blob_to_embedding(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)
