<div align="right">

[🇬🇧 English](../README.md) | 🇫🇷 Français

</div>

<div align="center">

<img src="../assets/logo.png" width="96" alt="Logo COSMOS">

# COSMOS

**Contextual Object Storage & Memory Over Sessions**

[![Python](../assets/badges/python.svg)](https://www.python.org/downloads/)
[![MCP](../assets/badges/mcp-fr.svg)](https://modelcontextprotocol.io/)
![Stockage](../assets/badges/storage-fr.svg)
![Outils](../assets/badges/tools-fr.svg)
![OS](../assets/badges/os.svg)
[![License](../assets/badges/license.svg)](LICENSE.md)

<br>

**Ton IA oublie tout entre deux conversations. Coller toutes tes notes dans chaque prompt marche... jusqu'à ce que ça ne marche plus.**

**COSMOS donne à ton assistant une mémoire qui vit en dehors de sa fenêtre de contexte.**

*Créé par Liam — avec l'aide de l'IA.*

</div>

---

<div align="center">

<img src="../assets/app.gif" width="760" alt="L'application COSMOS : les étoiles sont des catégories, les planètes des souvenirs">

*L'application web COSMOS sur un projet d'exemple : une étoile est une catégorie, une planète est un souvenir.*

</div>

---

> COSMOS est un serveur [MCP](https://modelcontextprotocol.io/). Tout assistant capable d'appeler des outils (Claude Desktop, un modèle local...) écrit ses souvenirs dans un fichier SQLite local et ne récupère que les quelques-uns qui comptent pour la question.

<div align="center">
<table>
<tr>
<td align="center" width="16%">

**🧠 Deux couches**<br>
Résumé court toujours<br>
dispo, texte complet<br>
à la demande

</td>
<td align="center" width="16%">

**🔎 Recherche par sens**<br>
Retrouve les questions<br>
reformulées, en<br>
12 langues

</td>
<td align="center" width="16%">

**🏠 100 % local**<br>
Un fichier SQLite,<br>
pas de cloud, pas de compte

</td>
<td align="center" width="16%">

**🗂️ Catégories auto**<br>
Elles grandissent à l'usage,<br>
les prioritaires se chargent<br>
au début de chaque conversation

</td>
<td align="center" width="16%">

**🕸️ Graphe de mémoire**<br>
Liens par thème<br>
et par date

</td>
<td align="center" width="16%">

**🌌 App 2D / 3D**<br>
Ta mémoire comme<br>
un ciel d'étoiles<br>
et de planètes

</td>
</tr>
</table>
</div>

---

## Pourquoi COSMOS

On a comparé COSMOS à l'approche habituelle (coller tout le fichier de notes dans le prompt) sur **8 modèles ouverts** (1,7 à 8 milliards de paramètres), 298 questions par modèle et par configuration, avec environ 200 souvenirs en mémoire.

| | Tout le fichier `.md` dans le prompt | COSMOS |
|---|:---:|:---:|
| Tokens envoyés par question | ≈ 4 750 | **≈ 210** (÷ 23) |
| Temps par réponse | ≈ 7,9 s | **≈ 0,75 s** (÷ 11) |
| Bon souvenir dans le top 3 de la recherche | — | **97 %** (95 % avec 1 700 souvenirs) |
| Modèles où il gagne · égalise · perd | | **4 · 2 · 2** |

COSMOS n'est pas meilleur partout : il perd face au fichier complet sur Llama 3.2 3B et Qwen3.5 4B. Les détails honnêtes, la méthode et les limites sont dans [`benchmark-cosmos/`](../benchmark-cosmos/SUMMARY.md) et sur le [site](https://cosmos.devliam.com).

---

## Installation

> Prérequis : **Python 3.10+** et **git** (pas de Git ? télécharge le ZIP depuis GitHub).

```bash
git clone https://github.com/DevLiamDb/COSMOS.git
cd COSMOS
python install.py --configure
```

Puis **redémarre Claude Desktop**. C'est tout.

<!-- 📸 AJOUTE TON GIF ICI — enregistre l'installation dans un terminal avec ScreenToGif (Windows) ou asciinema, sauvegarde-le dans assets/install.gif, puis décommente : -->
<!-- ![Installation de COSMOS](../assets/install.gif) -->

`install.py` fait tout à ta place :

1. crée un environnement `.venv`,
2. installe les dépendances,
3. télécharge le modèle de recherche une seule fois (il reste ensuite en cache sur ta machine),
4. avec `--configure`, ajoute COSMOS à Claude Desktop (ton ancienne config est sauvegardée en `claude_desktop_config.json.bak`).

**Tu préfères éditer la config toi-même ?** Lance `python install.py` sans `--configure` : il affiche le bloc à coller dans `claude_desktop_config.json`.

**À propos du modèle de recherche.** COSMOS cherche avec **Polaris**, notre propre modèle (multilingual-e5-small affiné sur des souvenirs écrits pour COSMOS). Polaris est pour l'instant privé sur Hugging Face : sans token, COSMOS **se replie automatiquement sur MiniLM**, qui fonctionne pareil. Si tu y as accès, définis `HF_TOKEN` avant de lancer `install.py`.

---

## Utilisation

### 1. Parle à ton assistant

Une fois branché, Claude voit 22 outils `cosmos_*`. Tu ne les appelles pas toi-même : c'est l'assistant qui le fait.

```
cosmos_write("On migre la base vers PostgreSQL : coût plus bas.")
→ stocké · catégorie : Projet d'exemple · type : decision

cosmos_query("pourquoi a-t-on changé de base ?")
→ Base : passage à PostgreSQL (coût).        ← résumés courts seulement

cosmos_recall(id)
→ Réunion d'équipe : on quitte Firebase pour PostgreSQL à cause du coût...   ← texte complet, à la demande
```

Pour que l'assistant utilise COSMOS tout seul, donne-lui les instructions de [`cosmos-memory.md`](../cosmos-memory.md).

### 2. Catégories prioritaires — le « sac à dos »

Marque une catégorie comme prioritaire (règles, préférences). `cosmos_priority_context()` renvoie tout son contenu en un appel léger, à lancer au début de chaque conversation.

<div align="center">

<img src="../assets/decision.gif" width="680" alt="Une catégorie prioritaire ouverte dans l'application COSMOS">

*Une étoile « Decisions » ouverte dans l'app : sept souvenirs en orbite.*

</div>

### 3. Voir ta mémoire (application web)

```bash
cd webapp
bun install
bun dev
```

Ouvre http://localhost:3000. Recherche avec `Ctrl K`, filtres, édition, bascule 2D / 3D. L'app lit et écrit le même `cosmos.db` que le serveur.

### 4. Tester sans client MCP *(optionnel)*

```bash
set ANTHROPIC_API_KEY=sk-ant-...      # PowerShell : $env:ANTHROPIC_API_KEY="sk-ant-..."
python scripts/chat_with_memory.py
```

Un chat dans le terminal qui utilise COSMOS comme mémoire (il faut ta propre clé API Claude, facturée sur ce compte).

### 5. Lancer les tests *(optionnel)*

```bash
.venv/Scripts/python -m unittest discover -s tests -v
```

Sur macOS et Linux, utilise `.venv/bin/python`.

---

## Polaris, le modèle de recherche

Chaque recherche passe par un modèle d'embedding qui transforme la question et le souvenir en vecteurs pour les comparer. Polaris a été affiné sur 7 040 souvenirs en 12 langues.

| Mesure de recherche (sans IA, ~200 souvenirs) | MiniLM | e5-small | **Polaris** |
|---|:---:|:---:|:---:|
| Bon souvenir dans le top 3 | 97,6 % | 96,3 % | **98,3 %** |
| « Pas en mémoire » reconnu | 84,6 % | 84,8 % | **92,0 %** |
| Version la plus récente d'un fait classée en premier | 91,7 % | 91,7 % | 86,1 % |

Il n'est pas devant partout : sur la recherche seule, il classe moins souvent en premier la version la plus récente d'un fait. COSMOS corrige cet ordre ensuite, grâce à la date. Petit jeu de test (~125 questions par tirage) : des écarts de 1 à 2 points restent dans la marge du hasard.

---

<details>
<summary><b>🗂️ Structure des fichiers</b></summary>
<br>

```
COSMOS/
├── install.py            ← installation en une commande ← COMMENCE ICI
├── server.py             ← serveur MCP (22 outils)
├── cosmos/               ← le moteur
│   ├── db.py             ← schéma SQLite (nodes, edges), stockage des embeddings
│   ├── embeddings.py     ← vecteurs sémantiques (Polaris, repli sur MiniLM)
│   ├── summarizer.py     ← résumé « Surface » de chaque souvenir
│   ├── categorize.py     ← catégories automatiques (zero-shot)
│   ├── graph.py          ← CosmosEngine : write, recall, query, link, neighbors...
│   ├── visualize.py      ← graphe HTML interactif autonome
│   └── web_export.py     ← export JSON pour l'app web
├── webapp/               ← app Next.js / Three.js (2D et 3D)
├── scripts/              ← chat terminal avec mémoire
├── tests/                ← suite de tests
├── benchmark/            ← code du benchmark (run, report, données synthétiques)
├── benchmark-cosmos/     ← résultats réels : graphiques, tableaux, réponses brutes
├── training/             ← scripts d'entraînement et d'export de Polaris
├── cosmos-memory.md      ← instructions à donner à ton assistant
├── docs/                 ← documentation détaillée (français)
└── assets/               ← logo et GIFs
```

</details>

---

<details>
<summary><b>🧰 Les 22 outils</b></summary>
<br>

`cosmos_write`, `cosmos_recall`, `cosmos_query`, `cosmos_neighbors`, `cosmos_categories`, `cosmos_set_category_priority`, `cosmos_priority_context`, `cosmos_set_category_color`, `cosmos_rename_category`, `cosmos_merge_categories`, `cosmos_update_node`, `cosmos_set_pinned`, `cosmos_delete_node`, `cosmos_delete_nodes`, `cosmos_delete_category`, `cosmos_delete_session`, `cosmos_delete_all`, `cosmos_status`, `cosmos_reindex`, `cosmos_visualize`, `cosmos_export_web`, `cosmos_graph_app`.

Les outils de suppression sont irréversibles. Ils ne doivent tourner que sur ta demande explicite.

</details>

---

<details>
<summary><b>⚙️ Comment ça marche à l'intérieur</b></summary>
<br>

```
assistant ──MCP──► server.py ──► CosmosEngine ──► cosmos.db (SQLite)
                                      │
                                      └── Polaris / MiniLM (ONNX, CPU, via fastembed)
```

- **Écrire :** le texte complet est stocké (Abyss), résumé (Surface), transformé en vecteur, catégorisé et daté.
- **Chercher :** la question devient un vecteur, les souvenirs les plus proches reviennent en résumés courts. Les versions récentes d'un fait passent en premier, les anciennes sont signalées comme remplacées.
- **Rappeler :** l'assistant demande le texte complet d'un seul souvenir. Rien d'autre n'entre dans sa fenêtre de contexte.

Si tu changes de modèle d'embedding, COSMOS le détecte à l'ouverture de la base et réindexe tes souvenirs.

La documentation française complète (catégories, routes de l'app web, graphe, limites) est dans [`docs/DETAILS-fr.md`](../docs/DETAILS-fr.md).

</details>

---

<details>
<summary><b>❓ FAQ</b></summary>
<br>

**Où sont mes données ?**
Dans `cosmos.db`, créé à côté de `server.py` au premier lancement. Il ne quitte jamais ta machine. Tu peux l'ouvrir avec n'importe quel client SQLite, le sauvegarder ou le supprimer.

**Il me faut un GPU ou un compte ?**
Non. Polaris tourne sur le CPU. Pas de compte, pas de clé API (sauf pour le chat terminal optionnel).

**Le premier lancement est lent.**
Le modèle de recherche se télécharge une seule fois (environ 220 Mo pour MiniLM, 470 Mo pour Polaris), puis reste en cache.

**Claude ne voit pas les outils.**
Redémarre complètement Claude Desktop après `install.py --configure`. Vérifie que `claude_desktop_config.json` contient bien une entrée `cosmos-engine`.

**J'ai changé de modèle de recherche, j'ai perdu mes souvenirs ?**
Non. COSMOS les réindexe automatiquement à la prochaine ouverture de la base.

**La catégorisation automatique est-elle fiable ?**
Faiblement : 21 à 39 % de bonnes réponses sur notre jeu de test. Tu peux toujours imposer une catégorie avec `node_type` et fusionner les catégories ensuite.

</details>

---

## Licence

**COSMOS Personal Use License v1.0**

✅ Libre d'utilisation : personnel, éducatif, recherche
✅ Modification et partage autorisés, en citant l'auteur d'origine
✅ Tes souvenirs et ton `cosmos.db` t'appartiennent
❌ Interdit de vendre COSMOS sans autorisation écrite
❌ Interdit de se faire passer pour son créateur

Voir [LICENSE.md](LICENSE.md) pour les conditions complètes.

---

<div align="center">

Créé par Liam — avec l'aide de l'IA.

</div>
