"""
Visualisation du graphe COSMOS -- façon Obsidian, mais ancrée dans du vrai
sémantique plutôt que dans la seule physique des liens.

Le graphe Obsidian positionne les notes uniquement par simulation de force
(liens = ressorts, notes = particules qui se repoussent) -- deux notes qui
parlent du même sujet sans jamais se citer explicitement finissent
n'importe où l'une par rapport à l'autre.

Ici, comme chaque noeud a un vrai vecteur d'embedding sémantique (voir
embeddings.py), on calcule une position 2D de départ par PCA sur ces
vecteurs -- les noeuds sémantiquement proches démarrent déjà proches à
l'écran, même sans aucune arête explicite entre eux. La simulation de
force de D3 prend ensuite le relais pour éviter les chevauchements et
laisser le graphe interactif (drag, zoom).

PCA implémenté à la main via SVD (numpy) -- pas de dépendance
supplémentaire (scikit-learn a été retiré des dependances en V1, voir
embeddings.py).
"""

import json
from pathlib import Path

import numpy as np

_NODE_TYPE_COLORS = {
    "fait": "#7aa2f7",
    "decision": "#e0af68",
    "tache": "#f7768e",
    "preference": "#9ece6a",
    "contexte_projet": "#bb9af7",
    "question_ouverte": "#73daca",
}
_DEFAULT_COLOR = "#9aa5ce"

_EDGE_TYPE_STYLE = {
    "proximite_thematique": {"color": "#565f89", "dash": "4,3"},
    "continuite_temporelle": {"color": "#7aa2f7", "dash": "0"},
    "citation": {"color": "#e0af68", "dash": "0"},
}
_DEFAULT_EDGE_STYLE = {"color": "#565f89", "dash": "0"}


def _pca_2d(vectors: np.ndarray) -> np.ndarray:
    """Projection en 2D par PCA (via SVD), sans dependance a scikit-learn."""
    n = len(vectors)
    if n == 0:
        return np.zeros((0, 2))
    if n == 1:
        return np.zeros((1, 2))
    centered = vectors - vectors.mean(axis=0)
    try:
        u, s, _vt = np.linalg.svd(centered, full_matrices=False)
    except np.linalg.LinAlgError:
        return np.zeros((n, 2))
    coords = u[:, :2] * s[:2]
    # Mise a l'echelle pour un canvas lisible (~ [-400, 400])
    max_abs = np.abs(coords).max()
    if max_abs > 0:
        coords = coords / max_abs * 400
    return coords


def build_graph_payload(graph_data: dict) -> dict:
    """Prend la sortie de CosmosEngine.export_graph() (embeddings en objets
    numpy) et produit un dict JSON-serialisable pret pour le rendu HTML.

    En plus des souvenirs reels ("planetes"), ajoute un noeud virtuel par
    categorie ("etoile", jamais stocke en base) positionne au centroide de
    ses membres, relie a chacun par une arete "orbite" -- une categorie
    marquee prioritaire (voir CosmosEngine.priority_context) est dessinee en
    etoile plus grande/lumineuse cote HTML."""
    nodes = graph_data["nodes"]
    edges = graph_data["edges"]
    categories = graph_data.get("categories", [])

    vectors = np.array([n["embedding"] for n in nodes]) if nodes else np.zeros((0, 1))
    coords = _pca_2d(vectors)

    payload_nodes = []
    positions_by_type: dict[str, list] = {}
    for node, (x, y) in zip(nodes, coords):
        color = _NODE_TYPE_COLORS.get(node["node_type"], _DEFAULT_COLOR)
        payload_nodes.append(
            {
                "id": node["id"],
                "kind": "planete",
                "session_id": node["session_id"],
                "node_type": node["node_type"],
                "surface": node["surface"],
                "abyss": node["abyss"],
                "created_at": node["created_at"],
                "x": float(x),
                "y": float(y),
                "color": color,
            }
        )
        positions_by_type.setdefault(node["node_type"], []).append((float(x), float(y)))

    category_info = {c["name"]: c for c in categories}

    star_nodes = []
    star_id_by_type = {}
    for node_type, positions in positions_by_type.items():
        star_id = f"etoile::{node_type}"
        star_id_by_type[node_type] = star_id
        info = category_info.get(node_type, {})
        star_nodes.append(
            {
                "id": star_id,
                "kind": "etoile",
                "node_type": node_type,
                "nom": node_type,
                "color": _NODE_TYPE_COLORS.get(node_type, _DEFAULT_COLOR),
                "prioritaire": bool(info.get("priorite", False)),
                "n_membres": info.get("n_exemples", len(positions)),
                "x": sum(p[0] for p in positions) / len(positions),
                "y": sum(p[1] for p in positions) / len(positions),
            }
        )

    payload_edges = []
    for edge in edges:
        style = _EDGE_TYPE_STYLE.get(edge["edge_type"], _DEFAULT_EDGE_STYLE)
        payload_edges.append(
            {
                "source": edge["source"],
                "target": edge["target"],
                "kind": "lien",
                "edge_type": edge["edge_type"],
                "weight": edge["weight"],
                "color": style["color"],
                "dash": style["dash"],
            }
        )
    for node in payload_nodes:
        payload_edges.append(
            {
                "source": star_id_by_type[node["node_type"]],
                "target": node["id"],
                "kind": "orbite",
                "edge_type": "orbite",
                "weight": 0.3,
                "color": node["color"],
                "dash": "2,3",
            }
        )

    return {"nodes": star_nodes + payload_nodes, "edges": payload_edges}


_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>C.O.S.M.O.S. -- Graphe</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<style>
  html, body { margin: 0; height: 100%; background: #14151f; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow: hidden; }
  svg { width: 100vw; height: 100vh; cursor: grab; }
  .edge { stroke-opacity: 0.55; }
  .edge.orbit { stroke-opacity: 0.2; }
  .star-glyph, .star-label { cursor: pointer; }
  .star-label { font-weight: 600; letter-spacing: 0.02em; pointer-events: none; }
  .card-rect { stroke-width: 1.5px; cursor: pointer; rx: 20px; ry: 20px; }
  .card-body-html { width: 100%; height: 100%; box-sizing: border-box; padding: 7px 9px; pointer-events: none; }
  .card-title { font-weight: 600; font-size: 11.5px; margin: 0 0 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-text { font-size: 10.5px; line-height: 1.32; color: #a9b1d6; margin: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .card-date { position: absolute; bottom: 5px; right: 9px; font-size: 9px; color: #565f89; }
  #hud {
    position: fixed; top: 14px; left: 14px; color: #565f89; font-size: 12px;
    background: #1a1b26cc; padding: 8px 12px; border-radius: 6px; border: 1px solid #292e42;
    z-index: 5;
  }
  #hud b { color: #c0caf5; }
  #panel {
    position: fixed; top: 0; right: 0; width: 380px; max-width: 88vw; height: 100%;
    background: #1f2335; border-left: 1px solid #292e42; box-shadow: -12px 0 32px rgba(0,0,0,0.45);
    transform: translateX(100%); transition: transform 0.25s ease; z-index: 10;
    padding: 22px 22px 22px 24px; box-sizing: border-box; overflow-y: auto;
    font-family: inherit;
  }
  #panel.open { transform: translateX(0); }
  #panel-close {
    position: absolute; top: 14px; right: 16px; background: none; border: none; cursor: pointer;
    color: #565f89; font-size: 20px; line-height: 1;
  }
  #panel-close:hover { color: #c0caf5; }
  #panel-badge { display: inline-block; font-size: 10.5px; padding: 2px 9px; border-radius: 999px; margin-bottom: 12px; }
  #panel-title { color: #c0caf5; font-size: 16px; font-weight: 600; margin: 0 0 14px 0; line-height: 1.35; padding-right: 20px; }
  #panel-body { color: #c0caf5; font-size: 13.5px; line-height: 1.6; white-space: pre-wrap; margin: 0 0 20px 0; }
  #panel-meta { color: #565f89; font-size: 11.5px; line-height: 1.8; border-top: 1px solid #292e42; padding-top: 12px; }
  #panel-meta b { color: #7aa2f7; }
</style>
</head>
<body>
<div id="hud"><b>C.O.S.M.O.S.</b> -- __N_NODES__ noeuds, __N_EDGES__ aretes -- ✦ = categorie, planete = souvenir -- clic pour le detail, molette pour zoomer, glisser pour deplacer</div>
<div id="panel">
  <button id="panel-close" title="Fermer">×</button>
  <div id="panel-badge"></div>
  <p id="panel-title"></p>
  <p id="panel-body"></p>
  <div id="panel-meta"></div>
</div>
<svg></svg>
<script>
const graph = __GRAPH_JSON__;
const CARD_W = 190, CARD_H = 84;

function extractTitle(text) {
  const firstSentence = text.split(/(?<=[.!?])\\s/)[0] || text;
  return firstSentence.length > 46 ? firstSentence.slice(0, 44) + "…" : firstSentence;
}
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch (e) { return iso; }
}
graph.nodes.forEach(d => {
  if (d.kind === "planete") { d.title = extractTitle(d.surface); d.dateLabel = formatDate(d.created_at); }
});

const svg = d3.select("svg");
const width = window.innerWidth, height = window.innerHeight;
const container = svg.append("g");

svg.call(d3.zoom().scaleExtent([0.1, 6]).on("zoom", (event) => {
  container.attr("transform", event.transform);
}));

// Uniquement les aretes etoile -> planete : chaque souvenir n'est relie qu'a
// sa propre categorie, pas aux autres souvenirs -- evite le graphe touffu ou
// tout semble connecte a tout. Les liens semantiques/temporels reels restent
// dans graph.edges (accessibles via cosmos_neighbors) mais ne sont pas
// dessines ici.
const orbitEdges = graph.edges.filter(d => d.kind === "orbite");

// Beaucoup d'espace entre les elements pour eviter que les cartes se
// chevauchent (chaque carte planete fait 190x84, une collision serree les
// ferait se coller les unes aux autres) : distance d'orbite genereuse,
// forte repulsion mutuelle, ancrage PCA lache pour laisser la place aux
// deux autres forces de vraiment ecarter les elements.
const simulation = d3.forceSimulation(graph.nodes)
  .force("link", d3.forceLink(orbitEdges).id(d => d.id).distance(230).strength(0.7))
  .force("charge", d3.forceManyBody().strength(d => d.kind === "etoile" ? -900 : -420))
  .force("x", d3.forceX(d => d.x).strength(0.05))
  .force("y", d3.forceY(d => d.y).strength(0.05))
  .force("collide", d3.forceCollide(d => d.kind === "etoile" ? 90 : 135).strength(1).iterations(3));

// Planetes groupees par etoile -- sert a deplacer tout le systeme d'un coup
// quand on fait glisser une etoile (voir le drag handler plus bas).
const planetsByStarId = {};
graph.nodes.filter(d => d.kind === "planete").forEach(p => {
  const starId = `etoile::${p.node_type}`;
  (planetsByStarId[starId] = planetsByStarId[starId] || []).push(p);
});

container.attr("transform", `translate(${width/2}, ${height/2})`);

const edge = container.append("g")
  .selectAll("line")
  .data(orbitEdges)
  .join("line")
  .attr("class", "edge orbit")
  .attr("stroke", d => d.color)
  .attr("stroke-dasharray", d => d.dash)
  .attr("stroke-width", 1);

const node = container.append("g")
  .selectAll("g")
  .data(graph.nodes)
  .join("g")
  .attr("class", d => "node " + d.kind)
  .call(d3.drag()
    // Faire glisser une etoile entraine toutes ses planetes avec elle (meme
    // delta applique a chacune) -- on deplace tout le "systeme" d'un coup
    // plutot que de laisser les planetes seules derriere. Faire glisser une
    // planete ne bouge qu'elle-meme.
    .on("start", (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
      if (d.kind === "etoile") {
        (planetsByStarId[d.id] || []).forEach(p => { p.fx = p.x; p.fy = p.y; });
      }
    })
    .on("drag", (event, d) => {
      const dx = event.x - d.fx, dy = event.y - d.fy;
      d.fx = event.x; d.fy = event.y;
      if (d.kind === "etoile") {
        (planetsByStarId[d.id] || []).forEach(p => { p.fx += dx; p.fy += dy; });
      }
    })
    .on("end", (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null; d.fy = null;
      if (d.kind === "etoile") {
        (planetsByStarId[d.id] || []).forEach(p => { p.fx = null; p.fy = null; });
      }
    }));

const stars = node.filter(d => d.kind === "etoile");
const planets = node.filter(d => d.kind === "planete");

// Zone de clic invisible plus large que le glyphe texte seul.
stars.append("circle")
  .attr("r", 36)
  .attr("fill", "transparent");

stars.append("text")
  .attr("class", "star-glyph")
  .attr("text-anchor", "middle")
  .attr("dy", "0.35em")
  .style("font-size", d => d.prioritaire ? "42px" : "30px")
  .style("fill", d => d.color)
  .style("filter", d => `drop-shadow(0 0 ${d.prioritaire ? 12 : 5}px ${d.color}${d.prioritaire ? "" : "99"})`)
  .text("✦");

stars.append("text")
  .attr("class", "star-label")
  .attr("text-anchor", "middle")
  .attr("dy", d => d.prioritaire ? "38px" : "30px")
  .style("font-size", "10.5px")
  .style("fill", d => d.color)
  .text(d => `${d.nom}${d.prioritaire ? " ★" : ""} (${d.n_membres})`);

planets.append("rect")
  .attr("class", "card-rect")
  .attr("width", CARD_W)
  .attr("height", CARD_H)
  .attr("x", -CARD_W / 2)
  .attr("y", -CARD_H / 2)
  .attr("fill", "#242840")
  .attr("stroke", d => d.color);

planets.append("foreignObject")
  .attr("width", CARD_W)
  .attr("height", CARD_H)
  .attr("x", -CARD_W / 2)
  .attr("y", -CARD_H / 2)
  .style("pointer-events", "none")
  .append("xhtml:div")
  .attr("class", "card-body-html")
  .style("position", "relative")
  .html(d => `
    <div class="card-title" style="color:${d.color}">${d.title}</div>
    <div class="card-text">${d.surface}</div>
    <div class="card-date">${d.dateLabel}</div>
  `);

const panel = d3.select("#panel");
const panelBadge = d3.select("#panel-badge");
const panelTitle = d3.select("#panel-title");
const panelBody = d3.select("#panel-body");
const panelMeta = d3.select("#panel-meta");

function openPlanetPanel(d) {
  panelBadge.style("background", d.color + "33").style("color", d.color).text(d.node_type);
  panelTitle.text(d.title);
  panelBody.text(d.abyss);
  panelMeta.html(`<b>Session</b> ${d.session_id}<br><b>Ecrit le</b> ${d.dateLabel}<br><b>Id</b> ${d.id}`);
  panel.classed("open", true);
}
function openStarPanel(d) {
  panelBadge.style("background", d.color + "33").style("color", d.color).text("categorie");
  panelTitle.text(`✦ ${d.nom}`);
  panelBody.text(
    `${d.n_membres} souvenir${d.n_membres > 1 ? "s" : ""} dans cette categorie.` +
    (d.prioritaire
      ? " Marquee prioritaire : chargee automatiquement par cosmos_priority_context, sans avoir a la rechercher."
      : " Categorie normale : accessible via cosmos_query, pas chargee automatiquement.")
  );
  panelMeta.html(`<b>Nom interne (node_type)</b> ${d.node_type}`);
  panel.classed("open", true);
}
function closePanel() { panel.classed("open", false); }

planets.on("click", (event, d) => { event.stopPropagation(); openPlanetPanel(d); });
stars.on("click", (event, d) => { event.stopPropagation(); openStarPanel(d); });
svg.on("click", closePanel);
d3.select("#panel-close").on("click", closePanel);

simulation.on("tick", () => {
  edge
    .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
  node.attr("transform", d => `translate(${d.x},${d.y})`);
});
</script>
</body>
</html>
"""


def build_html(graph_data: dict) -> str:
    payload = build_graph_payload(graph_data)
    html = _HTML_TEMPLATE.replace("__GRAPH_JSON__", json.dumps(payload, ensure_ascii=False))
    html = html.replace("__N_NODES__", str(len(payload["nodes"])))
    html = html.replace("__N_EDGES__", str(len(payload["edges"])))
    return html


def save_html(graph_data: dict, output_path: str) -> str:
    html = build_html(graph_data)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")
    return str(path)
