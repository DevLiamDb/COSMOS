"""
CosmosEngine -- le coeur de C.O.S.M.O.S.

Graphe de noeuds/aretes avec separation Surface (resume, toujours
consultable a cout quasi nul) / Abyss (contenu brut, rapatrie
uniquement a la demande explicite via recall()).

Types d'aretes crees :
  - "proximite_thematique" : liee automatiquement a l'ecriture, entre
    un nouveau noeud et les noeuds existants les plus proches par
    similarite d'embedding (au-dessus d'un seuil).
  - "continuite_temporelle" : liee automatiquement entre un nouveau
    noeud et le noeud precedent de la meme session.
  - "citation" : jamais automatique -- creee explicitement via link()
    quand l'appelant (le modele hote) sait qu'un contenu en reference
    un autre explicitement.
"""

import sqlite3
import sys
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional

import numpy as np

from . import categorize
from . import db
from . import embeddings
from . import summarizer


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# Palette Tokyo Night -- meme famille de teintes que cosmos/visualize.py et
# cosmos/web_export.py. Assignee par ordre alphabetique de categorie la
# premiere fois qu'elle est lue (voir CosmosEngine.list_categories), puis
# PERSISTEE dans categories.color -- contrairement a l'ancien comportement de
# web_export.py qui la recalculait a chaque export (donc invisible pour un
# renommage/une recoloration manuelle depuis la webapp, qui a besoin d'une
# valeur stable a lire/ecrire).
_PALETTE = [
    "#7aa2f7", "#e0af68", "#f7768e", "#9ece6a", "#bb9af7", "#73daca",
    "#ff9e64", "#2ac3de", "#c0caf5", "#7dcfff", "#b4f9f8", "#f7c8e0",
    "#a9b1d6", "#c3e88d",
]


def _color_for(index: int) -> str:
    return _PALETTE[index % len(_PALETTE)]


class CosmosEngine:
    def __init__(self, db_path: str = "cosmos.db"):
        self.db_path = db_path
        self.conn = db.connect(db_path)
        # Le serveur MCP peut executer plusieurs appels d'outils en parallele
        # dans des threads differents (voir cosmos/db.py::connect) -- ce verrou
        # serialise les acces a la connexion SQLite partagee pour eviter toute
        # corruption/interference entre deux appels simultanes. RLock (et non
        # Lock simple) car write_node() appelle link() en interne tout en
        # tenant deja le verrou -- Lock simple ferait un deadlock.
        self._lock = threading.RLock()
        self._check_embedding_model()

    def close(self) -> None:
        self.conn.close()

    def _check_embedding_model(self) -> None:
        """Les vecteurs stockes ne se comparent qu'avec ceux du MEME modele.
        Si la base a ete indexee par un autre modele (ou par une version de
        COSMOS qui ne le notait pas encore), on reindexe une fois, ici, plutot
        que de laisser query() comparer des vecteurs incompatibles en silence."""
        row = self.conn.execute("SELECT value FROM meta WHERE key = 'embedding_model'").fetchone()
        if row is not None and row["value"] == embeddings.MODEL_NAME:
            return
        n = self.conn.execute("SELECT COUNT(*) AS n FROM nodes").fetchone()["n"]
        if n:
            # stderr : en MCP stdio, stdout est reserve au protocole
            print(f"COSMOS : base indexee par {row['value'] if row else 'un modele inconnu'}, "
                  f"reindexation de {n} souvenirs avec {embeddings.MODEL_NAME}...", file=sys.stderr)
            self.reindex_embeddings()
        else:
            self._set_embedding_model()

    def _set_embedding_model(self) -> None:
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES ('embedding_model', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (embeddings.MODEL_NAME,),
        )
        self.conn.commit()

    # ------------------------------------------------------------------
    # Ecriture
    # ------------------------------------------------------------------
    def write_node(
        self,
        content: str,
        session_id: str = "default",
        node_type: Optional[str] = None,
        priority: Optional[bool] = None,
        auto_link: bool = True,
        link_threshold: float = 0.20,
        top_k_links: int = 3,
    ) -> str:
        """node_type=None (par defaut) -> categorise automatiquement le contenu
        via cosmos/categorize.py (zero-shot par embedding, taxonomie par defaut :
        fait / decision / tache / preference / contexte_projet / question_ouverte
        -- UNION les categories deja creees a la volee, voir _custom_category_prototypes).
        Passer node_type force une categorie precise ; si elle n'existe pas
        encore, elle est creee -- c'est comme ca que la taxonomie s'etend au
        fil de l'usage, sans rien coder en dur.

        `priority` (optionnel) marque -- ou demarque -- la categorie entiere
        (pas seulement ce noeud) comme prioritaire. Voir priority_context()."""
        if not content or not content.strip():
            raise ValueError("content vide -- rien a ecrire dans le graphe")

        node_id = str(uuid.uuid4())
        if node_type is None:
            with self._lock:
                extra_prototypes = self._custom_category_prototypes()
            node_type = categorize.categorize(content, extra_prototypes=extra_prototypes)
        surface = summarizer.summarize(content)
        vec = embeddings.embed(f"{surface} {content[:500]}")
        created_at = _now()

        with self._lock:
            self.conn.execute(
                "INSERT INTO nodes (id, session_id, node_type, surface, abyss, embedding, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (node_id, session_id, node_type, surface, content, db.embedding_to_blob(vec), created_at),
            )
            self._touch_category(node_type, vec, priority=priority)
            self.conn.commit()

            if auto_link:
                self._auto_link_thematic(node_id, vec, threshold=link_threshold, top_k=top_k_links)
                self._auto_link_temporal(node_id, session_id)

        return node_id

    # ------------------------------------------------------------------
    # Categories dynamiques -- le "sac a dos" : la taxonomie n'est pas figee,
    # elle apprend une categorie a chaque node_type explicite rencontre, et
    # certaines peuvent etre marquees comme a toujours charger en priorite.
    # ------------------------------------------------------------------
    def _custom_category_prototypes(self) -> dict:
        """Vecteurs prototypes de toutes les categories deja vues -- passes a
        categorize.categorize() pour que la classification automatique
        reconnaisse aussi ce qui a ete appris en cours de route, pas
        seulement la taxonomie codee en dur dans categorize.py. Doit etre
        appele avec self._lock deja tenu (lu depuis write_node)."""
        rows = self.conn.execute("SELECT name, embedding FROM categories WHERE n_examples > 0").fetchall()
        return {row["name"]: db.blob_to_embedding(row["embedding"]) for row in rows}

    def _touch_category(self, name: str, vec: np.ndarray, priority: Optional[bool] = None) -> None:
        """Cree la categorie si elle n'existe pas encore, sinon met a jour son
        prototype (moyenne courante de tous les embeddings qui lui ont ete
        assignes). Doit etre appele avec self._lock deja tenu."""
        row = self.conn.execute(
            "SELECT embedding, n_examples, priority FROM categories WHERE name = ?", (name,)
        ).fetchone()
        if row is None:
            self.conn.execute(
                "INSERT INTO categories (name, embedding, n_examples, priority, created_at) VALUES (?, ?, 1, ?, ?)",
                (name, db.embedding_to_blob(vec), int(bool(priority)), _now()),
            )
            return

        n = row["n_examples"]
        if n > 0:
            old_vec = db.blob_to_embedding(row["embedding"])
            new_vec = (old_vec * n + vec) / (n + 1)
        else:
            new_vec = vec  # categorie creee vide via set_category_priority(), premier vrai exemple
        new_priority = int(bool(priority)) if priority is not None else row["priority"]
        self.conn.execute(
            "UPDATE categories SET embedding = ?, n_examples = ?, priority = ? WHERE name = ?",
            (db.embedding_to_blob(new_vec), n + 1, new_priority, name),
        )

    def list_categories(self) -> list:
        """Toutes les categories connues -- taxonomie par defaut incluse des
        qu'elle a servi au moins une fois, plus tout ce qui a ete cree a la
        volee via node_type explicite. Toute categorie sans couleur assignee
        (jamais vue avant la migration `color`) en recoit une deterministe
        et la persiste immediatement -- lecture auto-reparatrice, comme le
        reste du sac a dos."""
        with self._lock:
            rows = self.conn.execute(
                "SELECT name, n_examples, priority, color, created_at FROM categories ORDER BY name"
            ).fetchall()
            result = []
            dirty = False
            for i, r in enumerate(rows):
                color = r["color"]
                if not color:
                    color = _color_for(i)
                    self.conn.execute("UPDATE categories SET color = ? WHERE name = ?", (color, r["name"]))
                    dirty = True
                result.append({
                    "name": r["name"],
                    "n_exemples": r["n_examples"],
                    "priorite": bool(r["priority"]),
                    "color": color,
                    "created_at": r["created_at"],
                })
            if dirty:
                self.conn.commit()
        return result

    def set_category_color(self, name: str, color: str) -> bool:
        """Impose une couleur precise (hors palette auto) -- personnalisation
        manuelle depuis la webapp. Retourne True si la categorie existait
        deja, False si elle vient d'etre creee vide (comme
        set_category_priority)."""
        with self._lock:
            row = self.conn.execute("SELECT name FROM categories WHERE name = ?", (name,)).fetchone()
            existed = row is not None
            if existed:
                self.conn.execute("UPDATE categories SET color = ? WHERE name = ?", (color, name))
            else:
                empty_vec = np.zeros(embeddings.EMBEDDING_DIM, dtype=np.float32)
                self.conn.execute(
                    "INSERT INTO categories (name, embedding, n_examples, priority, color, created_at) "
                    "VALUES (?, ?, 0, 0, ?, ?)",
                    (name, db.embedding_to_blob(empty_vec), color, _now()),
                )
            self.conn.commit()
        return existed

    def rename_category(self, old_name: str, new_name: str) -> None:
        """Renomme une categorie et tous les souvenirs qui lui appartiennent
        (node_type n'est pas une cle etrangere formelle en SQL, mais c'est la
        seule reference -- les deux tables doivent bouger ensemble, dans la
        meme transaction). Refuse si `new_name` existe deja : utiliser
        merge_categories() pour fusionner deux categories existantes."""
        if not new_name or not new_name.strip():
            raise ValueError("le nouveau nom ne peut pas etre vide")
        with self._lock:
            row = self.conn.execute("SELECT name FROM categories WHERE name = ?", (old_name,)).fetchone()
            if row is None:
                raise ValueError(f"categorie inconnue : {old_name!r}")
            clash = self.conn.execute("SELECT name FROM categories WHERE name = ?", (new_name,)).fetchone()
            if clash is not None:
                raise ValueError(f"« {new_name} » existe deja -- utilise merge_categories() pour fusionner")
            self.conn.execute("UPDATE categories SET name = ? WHERE name = ?", (new_name, old_name))
            self.conn.execute("UPDATE nodes SET node_type = ? WHERE node_type = ?", (new_name, old_name))
            self.conn.commit()

    def merge_categories(self, source: str, target: str) -> int:
        """Fusionne `source` dans `target` : tous les souvenirs de source
        deviennent target, les prototypes d'embedding sont moyennes (pondere
        par n_examples), les compteurs s'additionnent, la priorite resultante
        est vraie si l'une des deux l'etait, et la couleur de `target` est
        conservee (c'est elle qui « absorbe », son identite visuelle prime).
        Retourne le nombre de souvenirs deplaces."""
        if source == target:
            raise ValueError("impossible de fusionner une categorie avec elle-meme")
        with self._lock:
            src = self.conn.execute(
                "SELECT embedding, n_examples, priority FROM categories WHERE name = ?", (source,)
            ).fetchone()
            tgt = self.conn.execute(
                "SELECT embedding, n_examples, priority, color FROM categories WHERE name = ?", (target,)
            ).fetchone()
            if src is None:
                raise ValueError(f"categorie inconnue : {source!r}")
            if tgt is None:
                raise ValueError(f"categorie inconnue : {target!r}")

            n_src, n_tgt = src["n_examples"], tgt["n_examples"]
            if n_src + n_tgt > 0:
                v_src = db.blob_to_embedding(src["embedding"])
                v_tgt = db.blob_to_embedding(tgt["embedding"])
                merged_vec = (v_src * n_src + v_tgt * n_tgt) / max(n_src + n_tgt, 1)
            else:
                merged_vec = db.blob_to_embedding(tgt["embedding"])

            cur = self.conn.execute("UPDATE nodes SET node_type = ? WHERE node_type = ?", (target, source))
            moved = cur.rowcount
            self.conn.execute(
                "UPDATE categories SET embedding = ?, n_examples = ?, priority = ? WHERE name = ?",
                (db.embedding_to_blob(merged_vec), n_src + n_tgt, int(bool(src["priority"] or tgt["priority"])), target),
            )
            self.conn.execute("DELETE FROM categories WHERE name = ?", (source,))
            self.conn.commit()
        return moved

    def set_category_priority(self, name: str, priority: bool) -> bool:
        """Marque (ou demarque) une categorie entiere comme prioritaire.
        Retourne True si la categorie existait deja, False si elle vient
        d'etre creee (vide, en attendant son premier vrai noeud)."""
        with self._lock:
            row = self.conn.execute("SELECT name FROM categories WHERE name = ?", (name,)).fetchone()
            existed = row is not None
            if existed:
                self.conn.execute("UPDATE categories SET priority = ? WHERE name = ?", (int(priority), name))
            else:
                empty_vec = np.zeros(embeddings.EMBEDDING_DIM, dtype=np.float32)
                self.conn.execute(
                    "INSERT INTO categories (name, embedding, n_examples, priority, created_at) VALUES (?, ?, 0, ?, ?)",
                    (name, db.embedding_to_blob(empty_vec), int(priority), _now()),
                )
            self.conn.commit()
        return existed

    def priority_context(self) -> list:
        """Le sac a dos : le Surface (jamais l'Abyss complet -- cout
        volontairement bas) de tous les noeuds dont la categorie est marquee
        prioritaire (regles, preferences permanentes...). Fait pour etre
        appele une fois en debut de conversation par le modele hote, a la
        place de garder tout l'historique dans son contexte d'entree."""
        with self._lock:
            rows = self.conn.execute(
                "SELECT n.id, n.node_type, n.surface, n.created_at FROM nodes n "
                "JOIN categories c ON c.name = n.node_type WHERE c.priority = 1 "
                "ORDER BY n.created_at"
            ).fetchall()
        return [
            {"id": r["id"], "node_type": r["node_type"], "surface": r["surface"], "created_at": r["created_at"]}
            for r in rows
        ]

    def _auto_link_thematic(self, node_id: str, vec, threshold: float, top_k: int) -> None:
        rows = self.conn.execute(
            "SELECT id, embedding FROM nodes WHERE id != ?", (node_id,)
        ).fetchall()
        scored = []
        for row in rows:
            other_vec = db.blob_to_embedding(row["embedding"])
            score = embeddings.cosine_similarity(vec, other_vec)
            if score >= threshold:
                scored.append((score, row["id"]))
        scored.sort(reverse=True)
        for score, other_id in scored[:top_k]:
            self.link(node_id, other_id, edge_type="proximite_thematique", weight=score)

    def _auto_link_temporal(self, node_id: str, session_id: str) -> None:
        row = self.conn.execute(
            "SELECT id FROM nodes WHERE session_id = ? AND id != ? ORDER BY created_at DESC LIMIT 1",
            (session_id, node_id),
        ).fetchone()
        if row:
            self.link(row["id"], node_id, edge_type="continuite_temporelle", weight=1.0)

    def update_node(
        self,
        node_id: str,
        title: Optional[str] = None,
        content: Optional[str] = None,
        node_type: Optional[str] = None,
    ) -> bool:
        """Edition manuelle d'un souvenir existant -- ce qui rend le systeme
        personnalisable plutot que purement en lecture seule sur ce que l'IA
        y a ecrit. `title` surcharge le titre auto-extrait du Surface (voir
        web_export._extract_title) ; `content` remplace l'Abyss ET recalcule
        le Surface (resume) et l'embedding, pour que la recherche semantique
        et l'auto-liaison restent coherentes avec le nouveau texte -- contrairement
        a une edition faite cote webapp (TypeScript, sans acces au modele
        d'embedding), qui elle doit attendre un cosmos_reindex() explicite.
        `node_type` change la categorie d'appartenance (voir aussi
        merge_categories si le but est de fusionner deux categories entieres).
        Ne touche a rien si tous les parametres sont None. Retourne False si
        le noeud n'existe pas."""
        with self._lock:
            row = self.conn.execute("SELECT surface, abyss, node_type FROM nodes WHERE id = ?", (node_id,)).fetchone()
            if row is None:
                return False

            sets: list = []
            params: list = []
            if content is not None and content.strip():
                surface = summarizer.summarize(content)
                vec = embeddings.embed(f"{surface} {content[:500]}")
                sets += ["abyss = ?", "surface = ?", "embedding = ?"]
                params += [content, surface, db.embedding_to_blob(vec)]
            if title is not None:
                sets += ["title = ?"]
                params += [title or None]
            if node_type is not None and node_type != row["node_type"]:
                extra_prototypes = self._custom_category_prototypes()
                # Le noeud change de categorie : la nouvelle doit exister (ou
                # etre creee) comme n'importe quel node_type explicite.
                vec_for_touch = embeddings.embed(f"{row['surface']} {row['abyss'][:500]}")
                self._touch_category(node_type, vec_for_touch)
                sets += ["node_type = ?"]
                params += [node_type]

            if not sets:
                return True
            sets.append("updated_at = ?")
            params.append(_now())
            params.append(node_id)
            self.conn.execute(f"UPDATE nodes SET {', '.join(sets)} WHERE id = ?", params)
            self.conn.commit()
        return True

    def set_pinned(self, node_id: str, pinned: bool) -> bool:
        """Epinglage libre d'un souvenir precis -- independant de la priorite
        de categorie (qui, elle, s'applique a tout un groupe). Un repere
        personnel ('important pour moi') plutot qu'une classification.
        Retourne False si le noeud n'existe pas."""
        with self._lock:
            cur = self.conn.execute(
                "UPDATE nodes SET pinned = ?, updated_at = ? WHERE id = ?",
                (int(pinned), _now(), node_id),
            )
            self.conn.commit()
        return cur.rowcount > 0

    # ------------------------------------------------------------------
    # Suppression -- IRREVERSIBLE (pas de corbeille). Chaque fonction retire
    # aussi les aretes qui touchaient les noeuds supprimes (sinon elles
    # pointeraient dans le vide et casseraient export_graph / visualize) et
    # remet a jour les categories concernees.
    # ------------------------------------------------------------------
    def _refresh_category(self, name: str, keep_empty: bool = False) -> bool:
        """Apres suppression de noeuds : recalcule n_examples et le prototype
        d'embedding de la categorie a partir des noeuds qu'il lui reste. Si
        elle n'en a plus, elle est supprimee (sauf keep_empty=True : elle reste,
        vide, avec sa priorite et sa couleur). Retourne True si la categorie a
        ete supprimee. Doit etre appele avec self._lock deja tenu."""
        rows = self.conn.execute("SELECT embedding FROM nodes WHERE node_type = ?", (name,)).fetchall()
        if not rows:
            if keep_empty:
                empty_vec = np.zeros(embeddings.EMBEDDING_DIM, dtype=np.float32)
                self.conn.execute(
                    "UPDATE categories SET embedding = ?, n_examples = 0 WHERE name = ?",
                    (db.embedding_to_blob(empty_vec), name),
                )
                return False
            self.conn.execute("DELETE FROM categories WHERE name = ?", (name,))
            return True
        try:
            mean_vec = np.mean([db.blob_to_embedding(r["embedding"]) for r in rows], axis=0)
            self.conn.execute(
                "UPDATE categories SET embedding = ?, n_examples = ? WHERE name = ?",
                (db.embedding_to_blob(mean_vec), len(rows), name),
            )
        except ValueError:
            # Vecteurs de dimensions differentes (base beta pas encore reindexee) :
            # on garde l'ancien prototype, on ne corrige que le compteur.
            self.conn.execute("UPDATE categories SET n_examples = ? WHERE name = ?", (len(rows), name))
        return False

    def delete_nodes(self, node_ids: list, keep_empty_categories: bool = False) -> dict:
        """Supprime des souvenirs precis (et toutes leurs aretes). Les ids
        inconnus sont simplement listes dans `ids_introuvables`, sans erreur.
        Une categorie qui se retrouve sans aucun souvenir est supprimee aussi
        (sauf keep_empty_categories=True)."""
        ids = list(dict.fromkeys(node_ids))
        with self._lock:
            self.conn.execute("PRAGMA secure_delete = ON")  # efface le contenu sur disque, pas seulement l'entree
            found: dict = {}
            missing: list = []
            for node_id in ids:
                row = self.conn.execute("SELECT node_type FROM nodes WHERE id = ?", (node_id,)).fetchone()
                if row is None:
                    missing.append(node_id)
                else:
                    found[node_id] = row["node_type"]

            edges_removed = 0
            for node_id in found:
                cur = self.conn.execute(
                    "DELETE FROM edges WHERE from_node = ? OR to_node = ?", (node_id, node_id)
                )
                edges_removed += cur.rowcount
                self.conn.execute("DELETE FROM nodes WHERE id = ?", (node_id,))

            dropped_categories = [
                name
                for name in sorted(set(found.values()))
                if self._refresh_category(name, keep_empty=keep_empty_categories)
            ]
            self.conn.commit()
        return {
            "noeuds_supprimes": len(found),
            "aretes_supprimees": edges_removed,
            "ids_introuvables": missing,
            "categories_supprimees": dropped_categories,
        }

    def delete_node(self, node_id: str) -> bool:
        """Supprime un souvenir precis. Retourne False s'il n'existe pas."""
        return self.delete_nodes([node_id])["noeuds_supprimes"] == 1

    def delete_category(self, name: str) -> dict:
        """Supprime une categorie ENTIERE avec tous les souvenirs qu'elle
        contient. (Pour garder les souvenirs et les deplacer ailleurs, utiliser
        merge_categories.) Leve ValueError si la categorie n'existe pas."""
        with self._lock:
            cat = self.conn.execute("SELECT name FROM categories WHERE name = ?", (name,)).fetchone()
            ids = [r["id"] for r in self.conn.execute("SELECT id FROM nodes WHERE node_type = ?", (name,)).fetchall()]
            if cat is None and not ids:
                raise ValueError(f"categorie inconnue : {name!r}")
            result = self.delete_nodes(ids)
            # Categorie creee vide (jamais de souvenir) ou deja retiree par delete_nodes.
            self.conn.execute("DELETE FROM categories WHERE name = ?", (name,))
            self.conn.commit()
        result["categorie"] = name
        result["categories_supprimees"] = [name]
        return result

    def delete_session(self, session_id: str) -> dict:
        """Supprime tous les souvenirs d'une session (et leurs aretes). Leve
        ValueError si aucune session de ce nom."""
        with self._lock:
            ids = [
                r["id"]
                for r in self.conn.execute("SELECT id FROM nodes WHERE session_id = ?", (session_id,)).fetchall()
            ]
            if not ids:
                raise ValueError(f"aucun souvenir dans la session {session_id!r}")
            result = self.delete_nodes(ids)
        result["session_id"] = session_id
        return result

    def reset_all(self, keep_categories: bool = False) -> dict:
        """Vide COMPLETEMENT la base : tous les souvenirs, toutes les aretes et
        (sauf keep_categories=True) toute la taxonomie apprise, y compris les
        priorites et couleurs. Le fichier cosmos.db et son schema restent, prets
        a etre reutilises. Purge ensuite le disque (checkpoint WAL + VACUUM) pour
        que le contenu supprime ne subsiste pas dans le fichier."""
        with self._lock:
            self.conn.execute("PRAGMA secure_delete = ON")
            n_nodes = self.conn.execute("SELECT COUNT(*) AS c FROM nodes").fetchone()["c"]
            n_edges = self.conn.execute("SELECT COUNT(*) AS c FROM edges").fetchone()["c"]
            n_categories = self.conn.execute("SELECT COUNT(*) AS c FROM categories").fetchone()["c"]

            self.conn.execute("DELETE FROM edges")
            self.conn.execute("DELETE FROM nodes")
            if keep_categories:
                empty_vec = np.zeros(embeddings.EMBEDDING_DIM, dtype=np.float32)
                self.conn.execute(
                    "UPDATE categories SET embedding = ?, n_examples = 0", (db.embedding_to_blob(empty_vec),)
                )
                categories_removed = 0
            else:
                self.conn.execute("DELETE FROM categories")
                categories_removed = n_categories
            try:
                self.conn.execute("DELETE FROM sqlite_sequence WHERE name = 'edges'")  # ids d'aretes repartent a 1
            except sqlite3.OperationalError:
                pass  # pas de table sqlite_sequence : rien a remettre a zero
            self.conn.commit()
            purged = self._purge_disk()
        return {
            "noeuds_supprimes": n_nodes,
            "aretes_supprimees": n_edges,
            "categories_supprimees": categories_removed,
            "disque_purge": purged,
        }

    def _purge_disk(self) -> bool:
        """Checkpoint du WAL puis VACUUM, pour reellement liberer/ecraser les
        pages des donnees supprimees. Peut echouer sans gravite (SQLITE_BUSY)
        si un autre process -- la webapp, par exemple -- lit la base au meme
        instant : les donnees sont deja supprimees logiquement, seul le
        nettoyage physique est a refaire. Retourne True si tout a reussi."""
        try:
            self.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            self.conn.execute("VACUUM")
            self.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            return True
        except sqlite3.OperationalError:
            return False

    def link(self, from_id: str, to_id: str, edge_type: str = "citation", weight: float = 1.0) -> None:
        with self._lock:
            self.conn.execute(
                "INSERT INTO edges (from_node, to_node, edge_type, weight, created_at) VALUES (?, ?, ?, ?, ?)",
                (from_id, to_id, edge_type, weight, _now()),
            )
            self.conn.commit()

    # ------------------------------------------------------------------
    # Lecture -- Surface (leger) et Abyss (a la demande)
    # ------------------------------------------------------------------
    def recall(self, node_id: str) -> Optional[dict]:
        """Rapatrie le contenu Abyss complet d'un noeud precis -- l'equivalent
        de deepsearch.source() / hush.source() dans les autres modules."""
        with self._lock:
            row = self.conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "session_id": row["session_id"],
            "node_type": row["node_type"],
            "surface": row["surface"],
            "abyss": row["abyss"],
            "created_at": row["created_at"],
        }

    def query(self, text: str, top_k: int = 5, session_id: Optional[str] = None, recency_weight: float = 0.03) -> list:
        """Recherche semantique : retourne les noeuds les plus proches du texte
        de requete, avec leur resume Surface seulement (pas l'Abyss -- il faut
        appeler recall() explicitement sur l'id qui interesse).

        Tient compte de la DATE des souvenirs :
        - a similarite presque egale, le souvenir le plus recent passe devant
          (bonus de `recency_weight` au maximum, ajoute au score de classement).
        - deux versions d'un meme fait (cosinus entre elles >= embeddings.SUPERSEDE_SIM,
          seuil calibre par modele) : la plus recente est placee juste devant
          l'ancienne -- typiquement un fait mis a jour ("j'habite a Liege" puis
          "j'ai demenage a Bruxelles").
        - chaque resultat porte `obsolete` : True si une version plus recente
          figure aussi dans les resultats. Le score affiche reste la similarite pure."""
        query_vec = embeddings.embed(text, kind="query")
        sql = "SELECT id, session_id, node_type, surface, embedding, created_at FROM nodes"
        params: tuple = ()
        if session_id is not None:
            sql += " WHERE session_id = ?"
            params = (session_id,)
        with self._lock:
            rows = self.conn.execute(sql, params).fetchall()

        n = len(rows)
        by_age = sorted(range(n), key=lambda i: rows[i]["created_at"])
        age_rank = {i: r for r, i in enumerate(by_age)}  # 0 = le plus ancien

        scored = []
        for i, row in enumerate(rows):
            vec = db.blob_to_embedding(row["embedding"])
            sim = embeddings.cosine_similarity(query_vec, vec)
            bonus = recency_weight * (age_rank[i] / (n - 1)) if n > 1 else 0.0
            scored.append((sim + bonus, sim, row, vec))
        scored.sort(key=lambda t: t[0], reverse=True)
        # Fenetre un peu plus large que top_k : la version recente d'un fait peut
        # etre juste sous la coupure alors que l'ancienne est dedans.
        window = scored[:top_k + 5]

        # Deux versions d'un meme fait : la plus recente passe juste devant
        # l'ancienne. Le bonus de recence global n'y suffit pas -- les deux
        # versions ont un rang d'age presque identique dans toute la memoire.
        threshold = embeddings.SUPERSEDE_SIM
        margin = embeddings.SUPERSEDE_MARGIN

        def newer_version(a, relevant_only=False):
            for b in window:
                if b[2]["created_at"] > a[2]["created_at"] and embeddings.cosine_similarity(a[3], b[3]) >= threshold:
                    # pour reclasser, la version recente doit aussi repondre a la question :
                    # un souvenir voisin plus recent (meme personne, autre fait) ne passe pas devant
                    if not relevant_only or b[1] >= a[1] - margin:
                        return b
            return None

        for _ in range(len(window)):  # borne : chaque passe deplace au plus un element
            moved = False
            for a_i, a in enumerate(window):
                b = newer_version(a, relevant_only=True)
                if b is not None and window.index(b) > a_i:
                    window.remove(b)
                    window.insert(a_i, b)
                    moved = True
                    break
            if not moved:
                break

        top = window[:top_k]
        obsolete = {i for i, a in enumerate(top) if (b := newer_version(a)) is not None and b in top}

        return [
            {
                "id": row["id"],
                "session_id": row["session_id"],
                "node_type": row["node_type"],
                "surface": row["surface"],
                "score": round(sim, 4),
                "created_at": row["created_at"],
                "obsolete": idx in obsolete,
            }
            for idx, (_, sim, row, _) in enumerate(top)
        ]

    def neighbors(self, node_id: str, edge_type: Optional[str] = None) -> list:
        """Voisins directs d'un noeud dans le graphe (1 saut), utile pour
        explorer 'tout ce qui touche a ce sujet' plutot qu'une liste plate."""
        sql = (
            "SELECT to_node AS neighbor, edge_type, weight FROM edges WHERE from_node = ? "
            "UNION "
            "SELECT from_node AS neighbor, edge_type, weight FROM edges WHERE to_node = ?"
        )
        params = (node_id, node_id)
        if edge_type is not None:
            sql = (
                "SELECT to_node AS neighbor, edge_type, weight FROM edges WHERE from_node = ? AND edge_type = ? "
                "UNION "
                "SELECT from_node AS neighbor, edge_type, weight FROM edges WHERE to_node = ? AND edge_type = ?"
            )
            params = (node_id, edge_type, node_id, edge_type)
        with self._lock:
            rows = self.conn.execute(sql, params).fetchall()
        return [{"neighbor": r["neighbor"], "edge_type": r["edge_type"], "weight": r["weight"]} for r in rows]

    def reindex_embeddings(self) -> int:
        """Recalcule l'embedding de tous les noeuds existants avec le backend
        d'embedding actuel (cosmos/embeddings.py). Necessaire apres tout
        changement de modele d'embedding -- par exemple le passage de la beta
        (HashingVectorizer, 512 dims) a la V1 (fastembed, 384 dims) : les
        anciens vecteurs stockes ne sont plus compatibles en dimension avec
        les nouveaux, donc query()/link automatique planteraient ou donneraient
        des resultats faux sans ce recalcul. Retourne le nombre de noeuds mis a jour."""
        with self._lock:
            rows = self.conn.execute("SELECT id, surface, abyss FROM nodes").fetchall()
            for row in rows:
                vec = embeddings.embed(f"{row['surface']} {row['abyss'][:500]}")
                self.conn.execute(
                    "UPDATE nodes SET embedding = ? WHERE id = ?",
                    (db.embedding_to_blob(vec), row["id"]),
                )
            # les prototypes de categorie sont des moyennes de vecteurs de noeuds :
            # les garder de l'ancien modele fausserait la categorisation automatique
            for cat in self.conn.execute("SELECT name FROM categories").fetchall():
                self._refresh_category(cat["name"], keep_empty=True)
            self._set_embedding_model()  # commit compris
            return len(rows)

    def export_graph(self) -> dict:
        """Exporte tout le graphe (noeuds + aretes + vecteurs d'embedding bruts)
        pour visualisation -- voir cosmos/visualize.py pour la projection en 2D
        et la generation du HTML interactif. Inclut aussi les categories
        (nom, priorite) : visualize.py s'en sert pour dessiner une "etoile"
        par categorie, autour de laquelle gravitent ses souvenirs."""
        categories = self.list_categories()
        with self._lock:
            node_rows = self.conn.execute(
                "SELECT id, session_id, node_type, surface, abyss, title, pinned, embedding, created_at, updated_at FROM nodes"
            ).fetchall()
            edge_rows = self.conn.execute(
                "SELECT from_node, to_node, edge_type, weight FROM edges"
            ).fetchall()

        nodes = [
            {
                "id": row["id"],
                "session_id": row["session_id"],
                "node_type": row["node_type"],
                "surface": row["surface"],
                "abyss": row["abyss"],
                "title": row["title"],
                "pinned": bool(row["pinned"]),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"] or row["created_at"],
                "embedding": db.blob_to_embedding(row["embedding"]),
            }
            for row in node_rows
        ]
        edges = [
            {"source": row["from_node"], "target": row["to_node"], "edge_type": row["edge_type"], "weight": row["weight"]}
            for row in edge_rows
        ]
        return {"nodes": nodes, "edges": edges, "categories": categories}

    def status(self) -> dict:
        with self._lock:
            n_nodes = self.conn.execute("SELECT COUNT(*) AS c FROM nodes").fetchone()["c"]
            n_edges = self.conn.execute("SELECT COUNT(*) AS c FROM edges").fetchone()["c"]
            n_sessions = self.conn.execute("SELECT COUNT(DISTINCT session_id) AS c FROM nodes").fetchone()["c"]
        return {"n_nodes": n_nodes, "n_edges": n_edges, "n_sessions": n_sessions, "db_path": self.db_path}
