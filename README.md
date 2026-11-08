# C.O.S.M.O.S. — V1

**Contextual Object Storage & Memory Over Sessions**

Une vraie implémentation, fonctionnelle et testée, du principe "Cosmos Engine" décrit dans les fiches du lineup Nyros (`Liam/module/cosmos-engine.md`) — mémoire externe persistante en graphe, séparée en deux couches :

- **Surface** : un résumé compressé de chaque souvenir, toujours consultable, coût quasi nul.
- **Abyss** : le contenu brut complet, jamais chargé par défaut, rapatrié uniquement à la demande explicite.

C'est **model-agnostic** par construction : COSMOS tourne comme un serveur MCP (Model Context Protocol) séparé de tout modèle. N'importe quelle IA capable de tool-calling (Claude, Gemini via un adaptateur function-calling, un modèle local...) peut s'y brancher et lire/écrire dans le même graphe.

---

## Installation rapide

Il faut seulement Python 3.10 ou plus récent.

```bash
git clone https://github.com/DevLiamDb/COSMOS.git
cd COSMOS
python install.py --configure
```

Le script crée un environnement `.venv`, installe les dépendances, télécharge le modèle de recherche (une seule fois) et ajoute COSMOS à Claude Desktop, après avoir sauvegardé ton ancienne config (`.json.bak`). Sans `--configure`, il affiche le bloc à copier à la main. Redémarre ensuite Claude Desktop.

Polaris, notre modèle de recherche, est privé pour l'instant : sans token Hugging Face, COSMOS utilise automatiquement MiniLM (même fonctionnement, un peu moins précis sur la détection de « rien en mémoire »). Avec un token, définis `HF_TOKEN` avant `python install.py` pour utiliser Polaris.

---

## Où vont les données ?

Dans un fichier **SQLite local** (`cosmos.db`, créé à côté de `server.py` la première fois que le serveur tourne). Pas de service cloud, pas d'envoi à un tiers, pas de compte à créer — le fichier vit sur la machine qui fait tourner le serveur, sous ton contrôle total. Tu peux l'ouvrir avec n'importe quel client SQLite standard, le sauvegarder, le supprimer.

Si le volume grossit au point qu'un seul fichier SQLite devient limitant (beaucoup d'écritures concurrentes, plusieurs process), le chemin d'évolution naturel est Postgres (+ l'extension `pgvector` à la place du BLOB numpy actuel pour les embeddings) — mais ça reste un choix à faire plus tard, pas un prérequis pour que ça marche aujourd'hui.

---

## Structure

```
COSMOS/
├── cosmos/
│   ├── db.py          # schéma SQLite (nodes, edges), sérialisation des embeddings
│   ├── embeddings.py  # vectorisation sémantique réelle (fastembed, voir section dédiée)
│   ├── summarizer.py  # résumé Surface (extractif naïf par défaut, branchable sur un LLM)
│   ├── categorize.py  # catégorisation automatique (zero-shot par embedding, voir section dédiée)
│   ├── graph.py        # CosmosEngine : write_node, recall, query, link, neighbors, status, reindex_embeddings, export_graph
│   └── visualize.py    # graphe HTML interactif (PCA sur les embeddings + D3.js), façon Obsidian
├── server.py           # serveur MCP : cosmos_write / recall / query / status / reindex / visualize / graph_app
├── scripts/
│   └── chat_with_memory.py  # chat direct via l'API Claude, sans serveur MCP (voir section dédiée)
├── tests/test_cosmos.py
└── requirements.txt
```

## Catégorisation automatique

Quand `cosmos_write` est appelé sans préciser `node_type`, COSMOS classe automatiquement le souvenir dans une catégorie (`fait`, `decision`, `tache`, `preference`, `contexte_projet`, `question_ouverte`) — zero-shot, par comparaison d'embedding avec des exemples-prototypes par catégorie (voir `cosmos/categorize.py`). Test réel sur 6 exemples français : 5/6 corrects. La seule confusion observée porte sur un cas ambigu par nature (un fait qui décrit aussi le contexte d'un projet). `node_type` explicite reste toujours possible pour forcer une catégorie précise ou en sortir de la taxonomie par défaut.

## Le sac à dos : catégories dynamiques et prioritaires

Idée de départ : plutôt que le modèle hôte garde tout dans son contexte d'entrée, il pose dans COSMOS ce qui compte, rangé par catégorie — et certaines catégories (des règles, des préférences permanentes) doivent être **toujours** disponibles sans avoir à les rechercher, comme un sac à dos qu'on ouvre en démarrant une conversation plutôt que de tout porter sur soi en permanence.

Deux mécanismes réels pour ça :

- **Taxonomie dynamique.** La liste de catégories dans `categorize.py` (`fait`, `decision`, `tache`, `preference`, `contexte_projet`, `question_ouverte`) n'est plus figée. Écrire avec un `node_type` qui n'existe pas encore (ex: `cosmos_write(..., node_type="regle_securite")`) le crée à la volée — son embedding devient la moyenne de tous les souvenirs qui lui sont assignés (`CosmosEngine._touch_category`). Résultat mesuré (`test_dynamic_category_gets_reused_by_auto_categorization`) : après deux écritures explicites dans `regle_securite`, une troisième phrase similaire écrite *sans* préciser `node_type` est reconnue automatiquement dans cette même catégorie plutôt que rangée dans la taxonomie par défaut — la classification zero-shot compare maintenant contre la taxonomie de base **union** tout ce qui a déjà été appris.
- **Catégories prioritaires.** `cosmos_write(..., priority=True)` (ou `cosmos_set_category_priority`) marque une catégorie entière comme prioritaire. `cosmos_priority_context()` retourne alors, en un seul appel léger (juste le Surface, jamais l'Abyss complet), tous les souvenirs de ces catégories — pensé pour être appelé une fois en début de conversation plutôt que de porter tout l'historique dans le contexte du modèle hôte. `cosmos_categories()` liste la taxonomie actuelle (nom, nombre d'exemples, prioritaire ou non) pour voir ce qui a émergé.

Limite honnête : l'auto-création de catégorie ne juge jamais si le nom choisi est pertinent ou redondant avec une catégorie existante proche (ex: `regle` et `regles_projet` cohabiteraient sans fusion automatique) — c'est au modèle hôte de rester cohérent dans les noms qu'il choisit, COSMOS ne fait qu'apprendre ce qu'on lui donne.

## Chat direct via l'API (sans serveur MCP)

Pour tester COSMOS comme vraie mémoire d'IA tout de suite, sans passer par un connecteur Cowork ni un hébergement distant :

```bash
pip install -r requirements.txt
set ANTHROPIC_API_KEY=sk-ant-...      # PowerShell : $env:ANTHROPIC_API_KEY="sk-ant-..."
python scripts/chat_with_memory.py
```

Ce script parle directement à l'API Claude (Messages API, tool use) et branche les mêmes méthodes de `CosmosEngine` comme implémentation des outils — aucun serveur MCP, aucune config Desktop, aucun hébergement. C'est le chemin le plus rapide pour vérifier que la mémoire fonctionne vraiment en conversation. Nécessite une clé API Claude (console.anthropic.com, différente de l'abonnement Claude.ai — facturé à l'usage sur ce compte API séparément).

## Webapp Next.js/Three.js (visualisation officielle)

`webapp/` (fusionnee ici depuis l'ancien dossier `COSMOS-` separe) est une webapp Next.js/Three.js (univers 2D Canvas + 3D WebGL, recherche `Ctrl K`, filtres, panneaux de detail) qui lit et ecrit DIRECTEMENT `cosmos.db` (voir `webapp/src/lib/cosmos/cosmos-db.ts`) -- pas besoin de rappeler `cosmos_export_web()` pour qu'elle reflete tes vrais souvenirs, meme les editions manuelles faites depuis l'interface. Le mapping (voir `cosmos/web_export.py` pour le detail honnete des approximations, utilise seulement par l'export JSON de secours) : chaque categorie COSMOS devient une etoile ✦ (systeme solaire), chaque souvenir une planete en orbite, les vraies aretes du graphe deviennent les "connexions" affichees dans le panneau de detail.

**La route `GET /api/cosmos/sync` essaie trois sources, dans cet ordre** (voir `webapp/src/app/api/cosmos/sync/route.ts`) :

1. **Lecture directe de `cosmos.db`** (`cosmos-db.ts::readCosmosDataset`) -- la vraie source, toujours a jour.
2. **Repli** : l'ancien instantane `live-data.json` (ecrit par `cosmos_export_web`), utilise seulement si `cosmos.db` est illisible depuis ce process.
3. **Dernier repli** : une base Prisma/SQLite propre a la webapp (`prisma/schema.prisma`), amorcee au premier appel avec un jeu de donnees ecrit a la main dans `webapp/src/lib/cosmos/current-data.ts` (8 categories, 41 souvenirs) -- un exemple honnete, **pas** du vrai `cosmos.db`, utilise seulement si aucune des deux sources reelles n'est disponible sur la machine qui fait tourner la webapp.

**L'edition depuis l'interface est un vrai second client d'ecriture**, pas juste de la lecture : `POST /api/cosmos/planets` (creer), `PATCH /api/cosmos/planets/[id]` (editer titre/contenu/categorie), `POST /api/cosmos/planets/[id]/pin` (epingler), `POST /api/cosmos/categories/rename`, `/color`, `/merge` -- tous appellent directement les fonctions d'ecriture de `cosmos-db.ts` sur `cosmos.db`. Il y a aussi `POST /api/cosmos/import` pour importer des notes personnelles (fichiers `.md`/`.txt`, un fichier = un souvenir, titre pris sur le premier `# titre` sinon le nom de fichier) sans passer par une conversation avec l'IA.

Pour la voir tourner (webapp Next.js classique, pas geree par le serveur MCP -- le projet est configure pour **bun**, `npm`/`npx` fonctionnent aussi mais `bun.lock` fait foi) :

```bash
cd webapp
bun install
bun dev
```

Puis ouvrir `http://localhost:3000`. Rappeler `cosmos_export_web()` apres de nouvelles ecritures faites depuis une conversation Claude (pas depuis la webapp elle-meme, qui ecrit deja directement dans `cosmos.db`) pour rafraichir `live-data.json`, le repli n°2 ci-dessus.

## Visualiser le graphe (fichier HTML autonome, sans rien installer)

```
cosmos_visualize()  # depuis Claude, ou directement :
python -c "from cosmos import CosmosEngine, visualize; visualize.save_html(CosmosEngine('cosmos.db').export_graph(), 'cosmos_graph.html')"
```

Génère un fichier HTML autonome (D3.js chargé depuis un CDN, tout le reste inline) à ouvrir dans un navigateur — un graphe interactif façon Obsidian, avec une différence : les nœuds démarrent positionnés par vraie proximité sémantique (PCA sur les embeddings, pas juste une simulation de force basée sur les liens), donc des souvenirs qui parlent du même sujet se regroupent visuellement même sans arête explicite entre eux. Survoler un nœud affiche le contenu complet (Abyss) ; les arêtes sont colorées par type (proximité thématique en pointillés, continuité temporelle, citation).

## Widget live dans le chat (MCP Apps) — et sa vraie limite

`cosmos_graph_app` tente d'aller plus loin que "génère un fichier à ouvrir" : afficher le graphe **en direct, dans la fenêtre de chat de Claude**, comme un vrai widget interactif. C'est possible grâce à **MCP Apps**, une extension officielle du protocole MCP lancée le 26 janvier 2026 (Claude, VS Code, Microsoft 365 Copilot la supportent). Le mécanisme : un outil (`cosmos_graph_app`) déclare `_meta.ui.resourceUri` pointant vers une ressource `ui://cosmos/graph`, qui sert le HTML du graphe ; l'hôte (Claude) le rend dans un iframe sécurisé.

Ce qui est réellement fait et testé :

- Le câblage protocole est correct et vérifié (`tests/test_cosmos.py::TestMcpAppsWiring`) — l'outil expose bien `_meta.ui.resourceUri`, la ressource sert bien le HTML du graphe.
- Le SDK Python officiel côté serveur pour MCP Apps (`mcp-ui-server` sur PyPI) a un vrai bug de compatibilité avec la version de `mcp` installée ici (`ValidationError` sur le type d'URI) — contourné en construisant la ressource directement avec les types natifs du SDK `mcp`, sans dépendance supplémentaire.

Ce qui n'est *pas* garanti fonctionner tel quel :

> ⚠️ **D'après la documentation officielle Anthropic elle-même**, tester un widget MCP Apps avec Claude nécessite un serveur MCP **distant** (exposé publiquement, ajouté comme "connecteur personnalisé") — pas un serveur stdio local via `claude_desktop_config.json` comme celui-ci. C'est exactement la même limite que celle déjà rencontrée pour les outils simples de COSMOS en mode Cowork. Le code est prêt et correct côté protocole ; le rendu visuel réel dans Claude reste à vérifier une fois COSMOS hébergé à distance (voir la section suivante).

## Lancer

```bash
pip install -r requirements.txt
python -m unittest discover -s tests -v   # 50 tests, tous passent sur une vraie base SQLite temporaire
python server.py                          # lance le serveur MCP en stdio
```

> Premier lancement plus lent que les suivants : le modèle d'embedding (~220 Mo) se télécharge une seule fois depuis Hugging Face et se met en cache localement (`~/.cache/fastembed` — `%USERPROFILE%\.cache\fastembed` sur Windows).

## Brancher sur Claude Desktop

Ajouter dans la config MCP de Claude Desktop (`claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "cosmos-engine": {
      "command": "python",
      "args": ["/chemin/absolu/vers/COSMOS/server.py"]
    }
  }
}
```

Claude verra alors les **22 outils** exposés par `server.py` comme n'importe quel autre outil MCP : `cosmos_write`, `cosmos_recall`, `cosmos_query`, `cosmos_neighbors`, `cosmos_categories`, `cosmos_set_category_priority`, `cosmos_priority_context`, `cosmos_set_category_color`, `cosmos_rename_category`, `cosmos_merge_categories`, `cosmos_update_node`, `cosmos_set_pinned`, `cosmos_delete_node`, `cosmos_delete_nodes`, `cosmos_delete_category`, `cosmos_delete_session`, `cosmos_delete_all`, `cosmos_status`, `cosmos_reindex`, `cosmos_visualize`, `cosmos_export_web`, `cosmos_graph_app` — voir la section précédente pour la limite connue sur `cosmos_graph_app` en local.

> Note : `scripts/chat_with_memory.py` (chat direct via l'API, voir plus haut) ne branche lui qu'un sous-ensemble minimal — `cosmos_write`, `cosmos_query`, `cosmos_recall`, `cosmos_status` — pas les 17 outils complets, volontairement, pour rester simple comme point d'entrée rapide.

### Suppression (irréversible)

Cinq outils permettent d'effacer, sans corbeille ni sauvegarde automatique : `cosmos_delete_node` / `cosmos_delete_nodes` (un ou plusieurs souvenirs précis, avec leurs liens), `cosmos_delete_category` (une catégorie entière avec tous ses souvenirs), `cosmos_delete_session` (tous les souvenirs d'une session) et `cosmos_delete_all` (toute la base). Une catégorie qui n'a plus aucun souvenir disparaît avec le dernier. `cosmos_delete_all` ne fait rien sans `confirmation="SUPPRIMER TOUT"` (sans elle, il indique seulement ce qui serait supprimé) ; `keep_categories=True` conserve les catégories vides avec leurs priorités et couleurs. Il purge aussi le fichier sur disque (checkpoint WAL + VACUUM) ; si la webapp lit la base à cet instant, la purge peut être reportée (`disque_purge: false`) sans que les données restent visibles. `live-data.json` (instantané de repli de la webapp) n'est pas touché : rappeler `cosmos_export_web()` pour l'écraser.

### Philosophie de navigation : pas de "liste par catégorie" imposée

Volontairement, il n'y a pas d'outil du genre "liste-moi toutes les tâches" ou "montre-moi telle session en entier". COSMOS donne les outils bruts (écrire, rappeler exactement, chercher par sens, parcourir le graphe via `cosmos_neighbors`) et laisse le modèle hôte décider comment naviguer sa propre mémoire — la catégorisation automatique (`cosmos/categorize.py`) sert de signal pour la recherche et l'organisation interne, pas de menu figé imposé à l'utilisateur.

## Brancher sur Gemini

L'API Gemini a son propre format de function calling (pas MCP nativement) — il faut soit exposer les mêmes fonctions via ses "function declarations" (un petit adaptateur qui appelle les mêmes méthodes de `CosmosEngine`), soit passer par un pont MCP-vers-Gemini. Le stockage (`cosmos.db`) reste unique et partagé entre les deux — c'est ce qui permet à Claude et Gemini de lire/écrire dans la même mémoire.

---

## Embeddings — ce qui a changé en V1

La beta utilisait un sac-de-mots haché (`HashingVectorizer`, scikit-learn) : réel et fonctionnel, mais pas sémantique — deux phrases qui disent la même chose avec des mots différents n'étaient jamais rapprochées.

La V1 utilise un vrai modèle d'embedding dense via **fastembed** (`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, 384 dimensions, multilingue — choisi parce que le contenu de ce projet est en français). Test réel fait pendant le développement : deux phrases françaises reformulant le même fait → similarité cosinus **0,97** ; contre une phrase sans rapport → **0,10**. fastembed plutôt que sentence-transformers/torch directement : mêmes modèles (exportés en ONNX), sans la dépendance lourde et cassante à PyTorch.

> ⚠️ **Migration depuis une base beta existante.** Les vecteurs stockés par la beta (512 dims, sac-de-mots) et la V1 (384 dims, sémantique) ne sont pas compatibles. Si tu as déjà un `cosmos.db` créé avec la beta, appelle l'outil `cosmos_reindex` (ou `CosmosEngine.reindex_embeddings()`) une fois après la mise à jour — ça recalcule l'embedding de tous les nœuds existants avec le nouveau modèle. Sans ça, les recherches sémantiques sur d'anciens nœuds échoueront ou donneront des résultats faux.

---

## Limites honnêtes restantes (V1, pas encore un système multi-utilisateurs à grande échelle)

- **Résumé Surface** : extractif naïf (premières phrases, troncature) par défaut — fonctionnel mais moins bon qu'un vrai résumé généré par un LLM. `cosmos/summarizer.py::set_summarizer()` est déjà câblé pour brancher un vrai appel LLM sans toucher au reste.
- **Échelle** : testé et adapté pour des dizaines/centaines de milliers de nœuds sur une seule machine. Pas dimensionné pour du multi-utilisateurs à très grande échelle ou des requêtes de graphe multi-sauts complexes — voir la note sur Postgres/Neo4j plus haut.
- **Sécurité/concurrence** : la connexion SQLite est maintenant protégée par un verrou (`threading.RLock`) contre les accès concurrents multi-thread du serveur MCP — testé (`test_concurrent_access_from_multiple_threads`). Il n'y a en revanche toujours pas d'authentification sur le serveur MCP lui-même, ni de gestion multi-process (plusieurs instances de `server.py` sur le même fichier) — à ajouter avant un déploiement partagé entre plusieurs utilisateurs non session-isolés.
- **Premier lancement** : télécharge ~220 Mo (le modèle d'embedding) depuis Hugging Face — nécessite une connexion internet la première fois seulement, tout tourne hors-ligne ensuite.

Ce ne sont pas des détails cachés : le but de ce README est de dire clairement ce qui est un vrai mécanisme fonctionnel et testé (le graphe, Surface/Abyss, les embeddings sémantiques, le verrouillage thread-safe) vs ce qui reste à durcir avant un usage multi-utilisateurs en production (résumé, auth, multi-process).
