# Crédits

[🇬🇧 English version](../CREDITS.md)

COSMOS a été écrit avec de l'IA, et ce fichier le dit franchement.

## Les personnes et l'IA derrière le projet

| Qui | Quoi |
|---|---|
| **Liam** ([DevLiamDb](https://github.com/DevLiamDb)) | Créateur. L'idée, la direction, les décisions, les tests. |
| **[Claude Code](https://claude.com/claude-code)** (Anthropic) | A écrit le code du projet (moteur, serveur MCP, installateur, benchmark, scripts d'entraînement), sous la direction de Liam. |
| **Z.ai, modèle GLM 5.3 Flash** | A généré l'interface de l'app web (`webapp/`). |

Les souvenirs d'entraînement, les questions du benchmark et les textes de test ont aussi été écrits avec de l'IA, pas collectés auprès de vrais utilisateurs.

## Modèles

| Modèle | Utilisé pour | Auteur | Licence |
|---|---|---|---|
| [`intfloat/multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small) | Base de Polaris | Wang et al. (intfloat) | MIT |
| **Polaris** (`DevLiamDb/polaris`) | Modèle de recherche de COSMOS | Liam, affiné à partir de e5-small | voir sa page Hugging Face |
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

Chacun garde sa propre licence. Cette liste de crédits ne la change pas.

*Si tu penses qu'il manque quelque chose ou quelqu'un, ouvre une issue et ce sera ajouté.*
