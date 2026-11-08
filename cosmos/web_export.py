"""
Export du graphe COSMOS reel vers le format attendu par la webapp
Next.js/Three.js (workspace-8a7d0166-36e1-4471-b6eb-bcd20b67546d,
voir src/lib/cosmos/types.ts::CosmosDataset) -- remplace ses donnees
de demonstration par les vrais souvenirs de cosmos.db.

Mapping assume, documente honnetement (pas invente au hasard) :

- Une categorie COSMOS (node_type dynamique -- "regle", "fait", ou n'importe
  quel nom cree a la volee, voir cosmos/graph.py) devient une CategoryNode,
  l'etoile ✦ de la webapp -- correspondance directe, c'est le meme concept
  des deux cotes (un groupe de souvenirs autour d'un centre).

- Le champ `node_type` de la webapp est une taxonomie FIXE a 14 valeurs
  (note/idee/decision/evenement/personne/tache/document/conversation/
  recherche/concept/technique/reference/session/projet), utilisee la-bas
  uniquement pour le filtre croise (FilterBar) -- un concept different de
  nos categories dynamiques. Comme COSMOS n'a qu'un seul axe de
  classification, ce module approxime via _NODE_TYPE_MAPPING (best effort,
  pas une verite mesuree) ; le regroupement reel en etoiles/systemes reste
  lui exact, il passe par `category_id`, pas par ce champ.

- `metadata.importance` derive du flag "prioritaire" de la categorie
  (5 si prioritaire, 3 sinon) -- un choix d'affichage raisonnable, pas une
  valeur mesuree.

- `metadata.connections` = les vraies aretes du graphe COSMOS (proximite
  thematique, continuite temporelle, citation) filtrees aux deux bouts sur
  des noeuds reels -- donc les "Connexions" affichees dans le panneau de
  detail de la webapp sont authentiques, pas de la demo.
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

_NODE_TYPE_MAPPING = {
    "fait": "note",
    "decision": "decision",
    "tache": "tache",
    "preference": "reference",
    "contexte_projet": "projet",
    "question_ouverte": "idee",
    "regle": "reference",
}
_DEFAULT_NODE_TYPE = "note"


def _extract_title(surface: str) -> str:
    parts = re.split(r"(?<=[.!?])\s", surface, maxsplit=1)
    first = parts[0] if parts else surface
    return first if len(first) <= 60 else first[:57] + "…"


def build_web_dataset(graph_data: dict) -> dict:
    """Prend la sortie de CosmosEngine.export_graph() et produit un dict au
    format CosmosDataset (categories, planets, sessions, generatedAt, isDemo)."""
    nodes = graph_data["nodes"]
    edges = graph_data["edges"]
    categories = graph_data.get("categories", [])

    # Seules les categories qui ont au moins un vrai souvenir deviennent une
    # etoile -- une categorie creee via cosmos_set_category_priority mais
    # jamais utilisee n'aurait aucune planete, un systeme vide n'a pas de sens.
    category_names = sorted({n["node_type"] for n in nodes})
    # La couleur est desormais persistee dans categories.color (voir
    # CosmosEngine.list_categories, qui l'assigne et l'ecrit au premier
    # acces) -- fini le recalcul par index a chaque export, qui empechait
    # toute recoloration manuelle stable depuis la webapp. Repli sur un gris
    # neutre uniquement dans le cas theorique d'une categorie sans ligne
    # `categories` du tout (ne devrait pas arriver, _touch_category en cree
    # toujours une).
    color_by_meta = {c["name"]: c.get("color") for c in categories}
    color_by_name = {name: color_by_meta.get(name) or "#7aa2f7" for name in category_names}
    priority_by_name = {c["name"]: bool(c.get("priorite", False)) for c in categories}

    node_ids = {n["id"] for n in nodes}
    connections: dict = {nid: set() for nid in node_ids}
    for e in edges:
        a, b = e["source"], e["target"]
        if a in connections and b in connections:
            connections[a].add(b)
            connections[b].add(a)

    sessions: dict = {}
    web_planets = []
    for n in nodes:
        node_type = n["node_type"]
        sid = n["session_id"]
        if sid not in sessions or n["created_at"] < sessions[sid]:
            sessions[sid] = n["created_at"]

        web_planets.append(
            {
                "id": n["id"],
                "kind": "planet",
                "category_id": node_type,
                "session_id": sid,
                "node_type": _NODE_TYPE_MAPPING.get(node_type, _DEFAULT_NODE_TYPE),
                # Un titre pose a la main (webapp ou cosmos_update_node)
                # prime toujours sur l'extraction automatique -- c'est le
                # sens meme de l'edition manuelle.
                "title": n.get("title") or _extract_title(n["surface"]),
                "short_description": n["surface"],
                "content": n["abyss"],
                "created_at": n["created_at"],
                "updated_at": n.get("updated_at") or n["created_at"],
                "color": color_by_name[node_type],
                "metadata": {
                    "importance": 5 if priority_by_name.get(node_type, False) else 3,
                    "tags": [],
                    "connections": sorted(connections.get(n["id"], [])),
                    "pinned": bool(n.get("pinned", False)),
                },
            }
        )

    web_categories = [
        {
            "id": name,
            "kind": "category",
            "name": name,
            "color": color_by_name[name],
            "description": (
                "Categorie prioritaire -- chargee automatiquement par cosmos_priority_context, "
                "sans avoir a la rechercher."
                if priority_by_name.get(name, False)
                else "Categorie de souvenirs COSMOS."
            ),
            # Consomme cote webapp par layout.ts (etoile plus grande) et
            # engine-2d.ts/engine-3d.ts (halo plus intense) -- la meme info
            # que cosmos_categories() cote MCP, juste sous une autre forme.
            "priority": priority_by_name.get(name, False),
            "metadata": {"tags": [], "domain": name},
        }
        for name in category_names
    ]

    web_sessions = [{"id": sid, "label": sid, "date": date} for sid, date in sessions.items()]

    return {
        "categories": web_categories,
        "planets": web_planets,
        "sessions": web_sessions,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "isDemo": False,
    }


def save_web_dataset(graph_data: dict, output_path: str) -> str:
    payload = build_web_dataset(graph_data)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path)
