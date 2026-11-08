"""
Serveur MCP pour C.O.S.M.O.S.

Philosophie : pas de navigation rigide imposee (pas de "liste par categorie"
qui decide a la place du modele hote) -- juste les outils bruts (ecrire,
rappeler exactement, chercher par sens, parcourir le graphe), et le modele
hote decide lui-meme comment naviguer dans sa memoire. Meme logique que des
frameworks de memoire agentique reels (Letta/MemGPT).

Expose 22 outils standard, appelables par n'importe quel modele qui sait
faire du tool-calling (Claude, Gemini via un adaptateur, etc.) :

  cosmos_write(content, session_id?, node_type?, priority?)
      -> ecrit un nouveau noeud, retourne son id. node_type inconnu = cree une
         nouvelle categorie a la volee ; priority=True la marque prioritaire.
  cosmos_recall(node_id)
      -> rapatrie le contenu brut (Abyss) d'un noeud precis
  cosmos_query(query_text, top_k?, session_id?)
      -> recherche semantique, retourne des resumes Surface classes
  cosmos_neighbors(node_id, edge_type?)
      -> parcourt le graphe : voisins directs d'un noeud (proximite
         thematique, continuite temporelle, citation)
  cosmos_categories()
      -> liste la taxonomie actuelle (categories par defaut + creees a la
         volee), avec leur nombre d'exemples et si elles sont prioritaires
  cosmos_set_category_priority(name, priority)
      -> marque une categorie entiere comme a charger systematiquement
  cosmos_set_category_color(name, color)
      -> impose une couleur precise a une categorie (personnalisation manuelle)
  cosmos_rename_category(old_name, new_name)
      -> renomme une categorie et tous ses souvenirs
  cosmos_merge_categories(source, target)
      -> fusionne deux categories (ex: doublons crees par erreur)
  cosmos_update_node(node_id, title?, content?, node_type?)
      -> edite manuellement un souvenir existant
  cosmos_set_pinned(node_id, pinned)
      -> epingle un souvenir precis, independamment de sa categorie
  cosmos_delete_node(node_id) / cosmos_delete_nodes(node_ids)
      -> supprime definitivement un ou plusieurs souvenirs (et leurs liens)
  cosmos_delete_category(name)
      -> supprime une categorie entiere avec tous ses souvenirs
  cosmos_delete_session(session_id)
      -> supprime tous les souvenirs d'une session
  cosmos_delete_all(confirmation, keep_categories?)
      -> vide TOUTE la base (garde-fou : confirmation="SUPPRIMER TOUT")
  cosmos_priority_context()
      -> le "sac a dos" : tout le Surface des categories prioritaires, en un
         appel leger -- pense pour demarrer une conversation sans avoir a
         porter tout l'historique dans le contexte du modele hote
  cosmos_status()
      -> nombre de noeuds/aretes/sessions dans la base
  cosmos_reindex()
      -> recalcule tous les embeddings (apres changement de modele)
  cosmos_visualize(output_path?)
      -> genere un graphe HTML interactif (facon Obsidian) a ouvrir dans un navigateur
  cosmos_export_web(output_path?)
      -> exporte vers la webapp Next.js/Three.js COSMOS (etoiles/planetes,
         vraies connexions) -- remplace ses donnees de demonstration
  cosmos_graph_app()
      -> affiche le graphe EN DIRECT dans le chat (widget interactif, protocole
         MCP Apps -- pas un fichier a ouvrir a part, voir note ci-dessous)

MCP Apps (widget live dans le chat) : ce serveur declare une ressource UI
(ui://cosmos/graph, servie par cosmos_graph_resource) et lie l'outil
cosmos_graph_app a cette ressource via _meta.ui.resourceUri -- c'est le
pattern officiel du protocole MCP Apps (lance en janvier 2026). Verifie
manuellement que le tool listing expose bien _meta.ui.resourceUri (voir
tests). Limite honnete : d'apres la doc officielle Anthropic, le rendu live
de ces widgets dans Claude necessite un serveur MCP distant (connecteur
personnalise), pas un serveur stdio local via claude_desktop_config.json --
meme limite que pour les outils simples en mode Cowork.

Lancement local (stdio, pour Claude Desktop / un client MCP local) :
    python server.py

La base SQLite est creee a cote de ce fichier (cosmos.db) si elle
n'existe pas deja -- voir cosmos/db.py pour le detail du stockage.
"""

import os
from mcp.server.mcpserver import MCPServer

from cosmos import CosmosEngine
from cosmos import visualize
from cosmos import web_export

DB_PATH = os.environ.get("COSMOS_DB_PATH", os.path.join(os.path.dirname(__file__), "cosmos.db"))
DEFAULT_GRAPH_HTML_PATH = os.path.join(os.path.dirname(__file__), "cosmos_graph.html")
# Chemin par defaut vers la webapp Next.js/Three.js COSMOS (desormais fusionnee
# dans ce meme dossier, sous webapp/ -- voir cosmos_export_web) -- surchargeable
# via COSMOS_WEB_DATASET_PATH si elle bouge encore.
DEFAULT_WEB_DATASET_PATH = os.environ.get(
    "COSMOS_WEB_DATASET_PATH",
    os.path.join(os.path.dirname(__file__), "webapp", "src", "lib", "cosmos", "live-data.json"),
)

engine = CosmosEngine(db_path=DB_PATH)
mcp = MCPServer(name="cosmos-engine", version="1.0.0")


@mcp.tool()
def cosmos_write(
    content: str,
    session_id: str = "default",
    node_type: str | None = None,
    priority: bool | None = None,
) -> dict:
    """Ecrit un nouveau souvenir dans le graphe COSMOS. Si node_type n'est pas
    precise, il est determine automatiquement (categorisation zero-shot par
    embedding : la taxonomie par defaut -- fait / decision / tache /
    preference / contexte_projet / question_ouverte -- UNION toutes les
    categories deja creees a la volee via un node_type explicite auparavant).
    Passer un node_type qui n'existe pas encore le cree : la taxonomie
    s'etend au fil de la conversation, rien n'est fige.

    `priority=True` marque la categorie ENTIERE (pas juste ce noeud) comme a
    charger systematiquement -- voir cosmos_priority_context(). Utile pour
    des categories type "regle" ou "preference_permanente" que tu veux
    retrouver sans avoir a les chercher par similarite a chaque fois.

    Retourne l'id du noeud cree et la categorie assignee."""
    node_id = engine.write_node(content, session_id=session_id, node_type=node_type, priority=priority)
    node = engine.recall(node_id)
    return {"node_id": node_id, "node_type": node["node_type"]}


@mcp.tool()
def cosmos_recall(node_id: str) -> dict:
    """Rapatrie le contenu brut complet (Abyss) d'un noeud precis a partir de son id."""
    result = engine.recall(node_id)
    if result is None:
        return {"error": f"aucun noeud avec l'id {node_id}"}
    return result


@mcp.tool()
def cosmos_query(query_text: str, top_k: int = 5, session_id: str | None = None) -> dict:
    """Recherche semantique dans le graphe : retourne les resumes Surface les plus proches du texte donne."""
    results = engine.query(query_text, top_k=top_k, session_id=session_id)
    return {"results": results}


@mcp.tool()
def cosmos_neighbors(node_id: str, edge_type: str | None = None) -> dict:
    """Parcourt le graphe a partir d'un noeud : retourne ses voisins directs
    (1 saut). Donne acces aux vraies relations du graphe -- proximite_thematique
    (souvenirs proches en sens), continuite_temporelle (souvenir precedent/suivant
    dans la meme session), citation (lien explicite pose manuellement) -- plutot
    que seulement la recherche par similarite. edge_type optionnel pour filtrer
    sur un seul type de relation (sinon retourne les trois)."""
    return {"voisins": engine.neighbors(node_id, edge_type=edge_type)}


@mcp.tool()
def cosmos_categories() -> dict:
    """Liste toutes les categories connues de COSMOS -- la taxonomie de base
    des qu'elle a servi, plus toutes celles creees a la volee via un
    node_type explicite -- avec leur nombre d'exemples et si elles sont
    marquees prioritaires (voir cosmos_set_category_priority)."""
    return {"categories": engine.list_categories()}


@mcp.tool()
def cosmos_set_category_priority(name: str, priority: bool) -> dict:
    """Marque une categorie entiere comme prioritaire, ou retire ce statut.
    Les noeuds d'une categorie prioritaire sont ce que retourne
    cosmos_priority_context() -- pense pour des categories comme "regle" ou
    "preference_permanente" que tu veux toujours avoir sous la main sans les
    rechercher explicitement."""
    existed = engine.set_category_priority(name, priority)
    return {"categorie": name, "priorite": priority, "categorie_existait_deja": existed}


@mcp.tool()
def cosmos_priority_context() -> dict:
    """Le "sac a dos" : retourne en un seul appel, leger (juste le Surface,
    pas l'Abyss complet), tous les souvenirs des categories marquees
    prioritaires. Concu pour etre appele une fois en debut de conversation
    par le modele hote, a la place de porter tout l'historique dans son
    contexte d'entree -- seules les regles/preferences qui comptent vraiment
    sont chargees, le reste reste dans COSMOS et se recupere via
    cosmos_query au besoin."""
    return {"souvenirs_prioritaires": engine.priority_context()}


@mcp.tool()
def cosmos_set_category_color(name: str, color: str) -> dict:
    """Impose une couleur precise (hex, ex: "#7aa2f7") a une categorie --
    personnalisation manuelle qui prime sur l'assignation automatique par
    palette. Visible cote webapp (couleur de l'etoile et de ses planetes)
    des le prochain rechargement."""
    existed = engine.set_category_color(name, color)
    return {"categorie": name, "color": color, "categorie_existait_deja": existed}


@mcp.tool()
def cosmos_rename_category(old_name: str, new_name: str) -> dict:
    """Renomme une categorie et tous les souvenirs qui lui appartiennent.
    Echoue si new_name existe deja -- dans ce cas utiliser
    cosmos_merge_categories() pour fusionner les deux."""
    engine.rename_category(old_name, new_name)
    return {"ancien_nom": old_name, "nouveau_nom": new_name}


@mcp.tool()
def cosmos_merge_categories(source: str, target: str) -> dict:
    """Fusionne la categorie `source` dans `target` : tous les souvenirs de
    source rejoignent target, les prototypes d'embedding sont moyennes, la
    priorite resultante est vraie si l'une des deux l'etait, la couleur de
    target est conservee. Utile pour reparer deux categories quasi-identiques
    creees separement par erreur (ex: "idee" et "inspiration"). Irreversible :
    source disparait de la taxonomie."""
    moved = engine.merge_categories(source, target)
    return {"source": source, "target": target, "souvenirs_deplaces": moved}


@mcp.tool()
def cosmos_update_node(
    node_id: str,
    title: str | None = None,
    content: str | None = None,
    node_type: str | None = None,
) -> dict:
    """Edite manuellement un souvenir existant : titre affiche (surcharge
    l'extraction automatique), contenu complet (recalcule aussi le resume
    Surface et l'embedding -- la recherche semantique reste coherente), et/ou
    categorie d'appartenance. Ne change que les champs fournis."""
    ok = engine.update_node(node_id, title=title, content=content, node_type=node_type)
    if not ok:
        return {"error": f"aucun noeud avec l'id {node_id}"}
    return {"node_id": node_id, "modifie": True}


@mcp.tool()
def cosmos_set_pinned(node_id: str, pinned: bool) -> dict:
    """Epingle (ou desepingle) un souvenir precis -- un repere personnel
    independant de la priorite de categorie, pour marquer "ca c'est important
    pour moi" sur une planete en particulier plutot que sur tout un groupe."""
    ok = engine.set_pinned(node_id, pinned)
    if not ok:
        return {"error": f"aucun noeud avec l'id {node_id}"}
    return {"node_id": node_id, "epingle": pinned}


@mcp.tool()
def cosmos_delete_node(node_id: str) -> dict:
    """Supprime DEFINITIVEMENT un souvenir precis (contenu Surface + Abyss et
    tous ses liens). Irreversible, pas de corbeille. Si sa categorie n'a plus
    aucun souvenir apres ca, elle disparait aussi. Utiliser cosmos_recall avant
    si tu n'es pas sur de l'id."""
    result = engine.delete_nodes([node_id])
    if result["noeuds_supprimes"] == 0:
        return {"error": f"aucun noeud avec l'id {node_id}"}
    return {"node_id": node_id, "supprime": True, **result}


@mcp.tool()
def cosmos_delete_nodes(node_ids: list[str]) -> dict:
    """Supprime DEFINITIVEMENT plusieurs souvenirs d'un coup (liste d'ids).
    Les ids inconnus sont ignores et listes dans `ids_introuvables`.
    Irreversible. Les categories devenues vides sont supprimees."""
    return engine.delete_nodes(node_ids)


@mcp.tool()
def cosmos_delete_category(name: str) -> dict:
    """Supprime DEFINITIVEMENT une categorie ENTIERE avec TOUS les souvenirs
    qu'elle contient (et leurs liens). Irreversible. Pour garder les souvenirs
    et seulement les regrouper ailleurs, utiliser cosmos_merge_categories."""
    try:
        return engine.delete_category(name)
    except ValueError as exc:
        return {"error": str(exc)}


@mcp.tool()
def cosmos_delete_session(session_id: str) -> dict:
    """Supprime DEFINITIVEMENT tous les souvenirs d'une session (et leurs
    liens). Irreversible."""
    try:
        return engine.delete_session(session_id)
    except ValueError as exc:
        return {"error": str(exc)}


DELETE_ALL_CONFIRMATION = "SUPPRIMER TOUT"


@mcp.tool()
def cosmos_delete_all(confirmation: str = "", keep_categories: bool = False) -> dict:
    """VIDE TOUTE la base COSMOS : tous les souvenirs, tous les liens et toute
    la taxonomie apprise (categories, priorites, couleurs), puis purge le
    fichier cosmos.db sur disque. IRREVERSIBLE -- aucune sauvegarde n'est faite.

    Garde-fou : ne fait rien tant que `confirmation` n'est pas exactement
    "SUPPRIMER TOUT" ; sans elle, retourne juste ce qui SERAIT supprime.
    `keep_categories=True` garde les categories (vides, avec priorites et
    couleurs) et ne supprime que les souvenirs et les liens.

    Ne touche pas a live-data.json de la webapp (instantane de repli, voir
    cosmos_export_web) : le rappeler apres ca pour aussi l'ecraser."""
    if confirmation != DELETE_ALL_CONFIRMATION:
        status = engine.status()
        return {
            "supprime": False,
            "message": (
                f"Rien n'a ete supprime. Cette operation effacerait {status['n_nodes']} souvenirs et "
                f"{status['n_edges']} liens. Pour confirmer, rappelle cosmos_delete_all avec "
                f'confirmation="{DELETE_ALL_CONFIRMATION}".'
            ),
        }
    return {"supprime": True, **engine.reset_all(keep_categories=keep_categories)}


@mcp.tool()
def cosmos_export_web(output_path: str | None = None) -> dict:
    """Exporte le graphe COSMOS reel au format attendu par la webapp
    Next.js/Three.js COSMOS (categories comme etoiles, souvenirs comme
    planetes, vraies connexions du graphe) -- ecrit par defaut dans
    live-data.json de cette webapp, qui remplace alors ses donnees de
    demonstration au prochain rechargement (bun dev regarde ce fichier).
    A rappeler apres de nouvelles ecritures pour rafraichir la webapp."""
    target = output_path or DEFAULT_WEB_DATASET_PATH
    graph_data = engine.export_graph()
    path = web_export.save_web_dataset(graph_data, target)
    payload = web_export.build_web_dataset(graph_data)
    return {
        "path": path,
        "n_categories": len(payload["categories"]),
        "n_planetes": len(payload["planets"]),
        "n_sessions": len(payload["sessions"]),
    }


@mcp.tool()
def cosmos_status() -> dict:
    """Retourne des statistiques de base sur le graphe (nombre de noeuds, d'aretes, de sessions)."""
    return engine.status()


@mcp.tool()
def cosmos_reindex() -> dict:
    """Recalcule l'embedding de tous les noeuds avec le backend actuel. A appeler
    une fois apres une mise a jour qui change le modele d'embedding (ex: migration
    beta -> V1) -- sans ca, les recherches semantiques sur d'anciens noeuds echouent
    ou donnent des resultats faux (dimensions de vecteur incompatibles)."""
    count = engine.reindex_embeddings()
    return {"noeuds_reindexes": count}


@mcp.tool()
def cosmos_visualize(output_path: str | None = None) -> dict:
    """Genere une visualisation HTML interactive du graphe (facon Obsidian) --
    noeuds positionnes par proximite semantique reelle (PCA sur les embeddings),
    aretes colorees par type (proximite thematique / continuite temporelle /
    citation). Ouvrir le fichier retourne dans un navigateur. Ecrit par defaut
    a cote de ce serveur (cosmos_graph.html)."""
    target = output_path or DEFAULT_GRAPH_HTML_PATH
    graph_data = engine.export_graph()
    path = visualize.save_html(graph_data, target)
    return {"path": path, "n_noeuds": len(graph_data["nodes"]), "n_aretes": len(graph_data["edges"])}


# ---------------------------------------------------------------------------
# MCP Apps -- widget graphe rendu EN DIRECT dans le chat, pas un fichier a part.
# Pattern officiel : un outil dont le _meta.ui.resourceUri pointe vers une
# ressource ui:// qui sert le HTML. Voir la note d'honnetete plus haut sur la
# limite reelle (serveur distant necessaire pour que Claude le rende).
# ---------------------------------------------------------------------------

GRAPH_UI_URI = "ui://cosmos/graph"


@mcp.resource(GRAPH_UI_URI, mime_type="text/html;profile=mcp-app")
def cosmos_graph_resource() -> str:
    """Sert le HTML du graphe interactif pour affichage en direct dans le chat."""
    graph_data = engine.export_graph()
    return visualize.build_html(graph_data)


@mcp.tool(meta={"ui": {"resourceUri": GRAPH_UI_URI}})
def cosmos_graph_app() -> dict:
    """Affiche le graphe COSMOS en direct dans le chat, sous forme de widget
    interactif (pas un fichier a ouvrir a part) -- necessite un hote qui
    supporte le protocole MCP Apps et, d'apres la doc Anthropic, un serveur
    MCP distant plutot que local pour que le rendu fonctionne reellement."""
    graph_data = engine.export_graph()
    return {"n_noeuds": len(graph_data["nodes"]), "n_aretes": len(graph_data["edges"])}


# ---------------------------------------------------------------------------
# Transport HTTP (deploiement heberge) -- voir DEPLOY.md.
#
# Par defaut ce serveur tourne en stdio (transport = 'stdio'), lance
# localement par Claude Desktop via claude_desktop_config.json -- c'est le
# mode "developpeur" existant, inchange. COSMOS_MCP_TRANSPORT=http bascule
# vers le transport Streamable HTTP du SDK MCP (le transport standard pour
# un serveur MCP distant), servi par uvicorn -- utilisable comme "connecteur
# personnalise" depuis les reglages de Claude (ou tout autre client MCP
# compatible HTTP), sans toucher a un fichier de config.
#
# Authentification : un jeton partage simple (Authorization: Bearer <jeton>),
# verifie par un middleware ASGI brut plutot que le systeme OAuth complet du
# SDK (issuer_url, client registration...) -- volontairement plus leger,
# adapte a un usage personnel mono-utilisateur, pas a un service
# multi-tenant. Middleware ASGI brut (pas BaseHTTPMiddleware) pour ne pas
# interferer avec le streaming SSE du transport Streamable HTTP.
# ---------------------------------------------------------------------------

COSMOS_MCP_TRANSPORT = os.environ.get("COSMOS_MCP_TRANSPORT", "stdio")
COSMOS_MCP_TOKEN = os.environ.get("COSMOS_MCP_TOKEN")
COSMOS_MCP_HOST = os.environ.get("COSMOS_MCP_HOST", "0.0.0.0")
COSMOS_MCP_PORT = int(os.environ.get("PORT", os.environ.get("COSMOS_MCP_PORT", "8765")))


class _BearerAuthMiddleware:
    def __init__(self, app, token: str):
        self.app = app
        self.token = token

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] == "/health":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        auth = headers.get(b"authorization", b"").decode("latin-1")
        if auth != f"Bearer {self.token}":
            from starlette.responses import PlainTextResponse

            response = PlainTextResponse("Unauthorized", status_code=401)
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def _run_http() -> None:
    import uvicorn
    from starlette.responses import PlainTextResponse

    if not COSMOS_MCP_TOKEN:
        raise RuntimeError(
            "COSMOS_MCP_TRANSPORT=http necessite COSMOS_MCP_TOKEN (secret partage pour "
            "l'authentification des clients distants -- voir DEPLOY.md)."
        )

    app = mcp.streamable_http_app(host=COSMOS_MCP_HOST)

    async def health(request):  # noqa: ARG001 - signature imposee par Starlette
        return PlainTextResponse("ok")

    app.add_route("/health", health, methods=["GET"])
    guarded = _BearerAuthMiddleware(app, COSMOS_MCP_TOKEN)
    uvicorn.run(guarded, host=COSMOS_MCP_HOST, port=COSMOS_MCP_PORT, log_level="info")


if __name__ == "__main__":
    if COSMOS_MCP_TRANSPORT == "http":
        _run_http()
    else:
        mcp.run()
