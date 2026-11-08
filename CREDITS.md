# Credits

[🇫🇷 Version française](FR/CREDITS.md)

COSMOS was written with AI, and this file says so plainly.

## The story behind it

COSMOS started as a **story**, not as software. Liam DB was writing a story and playing roleplay with AI to imagine himself living among invented AI models. One of them had **infinite memory**, kept outside the model. In the story, that memory was called **COSMOS**. At some point the question became "could this really exist?", and the story turned into a real project.

| | |
|---|---|
| **Born** | Friday 11 September 2026, 12:28:28 |
| **Former name** | Cosmos Engine |
| **Origin** | A fictional AI model with infinite memory, from a roleplay story |
| **Today** | A real MCP server with its own search model, Polaris |

## Timeline

| When | What |
|---|---|
| 11 September 2026 | The idea and the project are born (Cosmos Engine) |
| October 2026 | Search model Polaris trained and published on Hugging Face (23 October); benchmark run on Kaggle |
| November 2026 | Website (cosmos.devliam.com) and GitHub repository |

## Find the creator

- 🌐 Portfolio: [devliam.com](https://devliam.com)
- 🐙 GitHub: [DevLiamDb](https://github.com/DevLiamDb)

## The people and the AI behind it

| Who | What |
|---|---|
| **Liam DB** ([DevLiamDb](https://github.com/DevLiamDb)) | Creator. The idea, the direction, the decisions, the testing. |
| **[Claude Code](https://claude.com/claude-code)** (Anthropic) | Wrote the code of the project (engine, MCP server, installer, benchmark, training scripts), under Liam DB's direction. |
| **Z.ai, model GLM 5.3 Flash** | Generated the interface of the web app (`webapp/`). |

The training memories, the benchmark questions and the test texts were also written with AI, not collected from real users.

## Models

| Model | Used for | Author | License |
|---|---|---|---|
| [`intfloat/multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small) | Base of Polaris | Wang et al. (intfloat) | MIT |
| **Polaris** (`DevLiamDb/polaris`) | COSMOS search model | Liam DB, fine-tuned from e5-small | see its Hugging Face page |
| [`paraphrase-multilingual-MiniLM-L12-v2`](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) | Fallback search model | sentence-transformers | Apache-2.0 |
| Qwen3 (1.7B, 4B, 8B), Qwen3.5 4B | Benchmark | Qwen (Alibaba) | see each model page |
| SmolLM3 3B | Benchmark | Hugging Face | see model page |
| Llama 3.2 3B | Benchmark | Meta | Llama license |
| Phi-4 mini | Benchmark | Microsoft | see model page |
| Gemma 3 4B | Benchmark | Google | Gemma license |

## Libraries and services

- [MCP, the Model Context Protocol](https://modelcontextprotocol.io/) and its Python SDK (Anthropic)
- [fastembed](https://github.com/qdrant/fastembed) (Qdrant) and [ONNX Runtime](https://onnxruntime.ai/) to run the models on the CPU
- [Hugging Face Hub](https://huggingface.co/) to host Polaris
- [Kaggle](https://www.kaggle.com/) (2 Tesla T4 GPUs) for the training and the benchmark run
- [SQLite](https://www.sqlite.org/) for storage, [NumPy](https://numpy.org/) for vectors
- Web app: [Next.js](https://nextjs.org/), [React](https://react.dev/), [Three.js](https://threejs.org/), [Tailwind CSS](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/), [Prisma](https://www.prisma.io/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- Graph view: [D3.js](https://d3js.org/)

Each of these keeps its own license. This credit list does not change it.

*If you think something or someone is missing, open an issue and it will be added.*
