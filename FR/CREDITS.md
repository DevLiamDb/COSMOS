# Crédits

[🇬🇧 English version](../CREDITS.md)

COSMOS a été écrit avec de l'IA, et ce fichier le dit franchement.

## L'histoire derrière

COSMOS a commencé comme une **histoire**, pas comme un logiciel. Liam DB écrivait une histoire et faisait du roleplay avec des IA pour s'imaginer vivre au milieu de modèles d'IA inventés. L'un d'eux avait une **mémoire infinie**, gardée en dehors du modèle. Dans l'histoire, cette mémoire s'appelait **COSMOS**. À un moment, la question est devenue « est-ce que ça pourrait vraiment exister ? », et l'histoire est devenue un vrai projet.

| | |
|---|---|
| **Naissance** | Vendredi 11 septembre 2026, 12:28:28 |
| **Ancien nom** | Cosmos Engine |
| **Origine** | Un modèle d'IA fictif à mémoire infinie, tiré d'une histoire de roleplay |
| **Aujourd'hui** | Un vrai serveur MCP avec son propre modèle de recherche, Polaris |

## Chronologie

| Quand | Quoi |
|---|---|
| 11 septembre 2026 | L'idée et le projet naissent (Cosmos Engine) |
| Octobre 2026 | Modèle de recherche Polaris entraîné et publié sur Hugging Face (23 octobre) ; benchmark lancé sur Kaggle |
| Novembre 2026 | Site web (cosmos.devliam.com) et dépôt GitHub |

## Retrouver le créateur

- 🌐 Portfolio : [devliam.com](https://devliam.com)
- 🐙 GitHub : [DevLiamDb](https://github.com/DevLiamDb)

## Les personnes et l'IA derrière le projet

| Qui | Quoi |
|---|---|
| **Liam DB** ([DevLiamDb](https://github.com/DevLiamDb)) | Créateur. L'idée, la direction, les décisions, les tests. |
| **[Claude Code](https://claude.com/claude-code)** (Anthropic) | A écrit le code du projet (moteur, serveur MCP, installateur, benchmark, scripts d'entraînement), sous la direction de Liam DB. |
| **Z.ai, modèle GLM 5.3 Flash** | A généré l'interface de l'app web (`webapp/`). |

Les souvenirs d'entraînement, les questions du benchmark et les textes de test ont aussi été écrits avec de l'IA, pas collectés auprès de vrais utilisateurs.

## Modèles

| Modèle | Utilisé pour | Auteur | Licence |
|---|---|---|---|
| [`intfloat/multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small) | Base de Polaris | Wang et al. (intfloat) | MIT |
| **Polaris** (`DevLiamDb/polaris`) | Modèle de recherche de COSMOS | Liam DB, affiné à partir de e5-small | voir sa page Hugging Face |
| [`paraphrase-multilingual-MiniLM-L12-v2`](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) | Modèle de recherche de repli | sentence-transformers | Apache-2.0 |
| Qwen3 (1,7B, 4B, 8B), Qwen3.5 4B | Benchmark | Qwen (Alibaba) | voir la page de chaque modèle |
| SmolLM3 3B | Benchmark | Hugging Face | voir la page du modèle |
| Llama 3.2 3B | Benchmark | Meta | licence Llama |
| Phi-4 mini | Benchmark | Microsoft | voir la page du modèle |
| Gemma 3 4B | Benchmark | Google | licence Gemma |

## Bibliothèques et services

- [MCP, le Model Context Protocol](https://modelcontextprotocol.io/) et son SDK Python (Anthropic)
- [fastembed](https://github.com/qdrant/fastembed) (Qdrant) et [ONNX Runtime](https://onnxruntime.ai/) pour faire tourner les modèles sur le processeur
- [Hugging Face Hub](https://huggingface.co/) pour héberger Polaris
- [Kaggle](https://www.kaggle.com/) (2 GPU Tesla T4) pour l'entraînement et le benchmark
- [SQLite](https://www.sqlite.org/) pour le stockage, [NumPy](https://numpy.org/) pour les vecteurs
- App web : [Next.js](https://nextjs.org/), [React](https://react.dev/), [Three.js](https://threejs.org/), [Tailwind CSS](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/), [Prisma](https://www.prisma.io/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- Vue en graphe : [D3.js](https://d3js.org/)
- Polices : [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) et [Inter](https://rsms.me/inter/) (SIL Open Font License), utilisées sur le site et dans le PDF du benchmark

Chacun garde sa propre licence. Cette liste de crédits ne la change pas.

*Si tu penses qu'il manque quelque chose ou quelqu'un, ouvre une issue et ce sera ajouté.*
