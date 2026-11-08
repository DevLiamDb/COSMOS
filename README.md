<div align="right">

🇬🇧 English | [🇫🇷 Français](FR/README.md)

</div>

<div align="center">

<img src="assets/logo.png" width="96" alt="COSMOS logo">

# COSMOS

**Contextual Object Storage & Memory Over Sessions**

[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/downloads/)
[![MCP](https://img.shields.io/badge/MCP-server-7C3AED)](https://modelcontextprotocol.io/)
![Storage](https://img.shields.io/badge/Storage-local_SQLite-003B57?logo=sqlite&logoColor=white)
![Tools](https://img.shields.io/badge/MCP_tools-22-F5B942)
![OS](https://img.shields.io/badge/OS-Windows%20%7C%20macOS%20%7C%20Linux-0078D4)

<br>

**Your AI forgets everything between conversations. Pasting all your notes into every prompt works... until it doesn't.**

**COSMOS gives your assistant a memory that lives outside its context window.**

*Built by Liam — with the help of AI.*

</div>

---

<div align="center">

<img src="assets/app.gif" width="760" alt="The COSMOS web app: stars are categories, planets are memories">

*The COSMOS web app on an example project: a star is a category, a planet is a memory.*

</div>

---

> COSMOS is an [MCP](https://modelcontextprotocol.io/) server. Any assistant that can call tools (Claude Desktop, a local model...) writes its memories into a local SQLite file and gets back only the few that matter for the question.

<div align="center">
<table>
<tr>
<td align="center" width="16%">

**🧠 Two layers**<br>
Short summary always<br>
available, full text<br>
on demand

</td>
<td align="center" width="16%">

**🔎 Search by meaning**<br>
Finds rephrased<br>
questions, in<br>
12 languages

</td>
<td align="center" width="16%">

**🏠 100% local**<br>
One SQLite file,<br>
no cloud, no account

</td>
<td align="center" width="16%">

**🗂️ Auto categories**<br>
They grow with use,<br>
priority ones load<br>
at conversation start

</td>
<td align="center" width="16%">

**🕸️ Memory graph**<br>
Links by topic<br>
and by time

</td>
<td align="center" width="16%">

**🌌 2D / 3D app**<br>
See your memory<br>
as a sky of stars<br>
and planets

</td>
</tr>
</table>
</div>

---

## Why COSMOS

We compared COSMOS with the usual approach (pasting the whole notes file into the prompt) on **8 open models** (1.7B to 8B parameters), 298 questions per model and per setup, with about 200 memories stored.

| | Whole `.md` file in the prompt | COSMOS |
|---|:---:|:---:|
| Tokens sent per question | ≈ 4,750 | **≈ 210** (×23 fewer) |
| Time per answer | ≈ 7.9 s | **≈ 0.75 s** (×11 faster) |
| Right memory in the top 3 of the search | — | **97%** (95% with 1,700 memories) |
| Models where it wins · ties · loses | | **4 · 2 · 2** |

COSMOS is not better everywhere: it loses against the full file on Llama 3.2 3B and Qwen3.5 4B. The honest details, the method and the limits are in [`benchmark-cosmos/`](benchmark-cosmos/SUMMARY.md) and on the [website](https://cosmos.devliam.com).

---

## Installation

> Requirements: **Python 3.10+** and **git** (no Git? download the ZIP from GitHub).

```bash
git clone https://github.com/DevLiamDb/COSMOS.git
cd COSMOS
python install.py --configure
```

Then **restart Claude Desktop**. That's it.

<!-- 📸 ADD YOUR GIF HERE — record the install in a terminal with ScreenToGif (Windows) or asciinema, save it as assets/install.gif, then uncomment: -->
<!-- ![Installing COSMOS](assets/install.gif) -->

`install.py` does everything for you:

1. creates a `.venv` environment,
2. installs the dependencies,
3. downloads the search model once (it then stays cached on your machine),
4. with `--configure`, adds COSMOS to Claude Desktop (your old config is saved as `claude_desktop_config.json.bak`).

**Prefer to edit the config yourself?** Run `python install.py` without `--configure`: it prints the block to paste in `claude_desktop_config.json`.

**About the search model.** COSMOS searches with **Polaris**, our own model (multilingual-e5-small fine-tuned on memories written for COSMOS). Polaris is currently private on Hugging Face: without a token, COSMOS **automatically falls back to MiniLM**, which works the same way. With access, set `HF_TOKEN` before running `install.py`.

---

## Usage

### 1. Talk to your assistant

Once connected, Claude sees 22 `cosmos_*` tools. You don't call them yourself: the assistant does.

```
cosmos_write("We are moving the database to PostgreSQL: lower cost.")
→ stored · category: Example Project · type: decision

cosmos_query("why did we change databases?")
→ Database: switch to PostgreSQL (cost).        ← short summaries only

cosmos_recall(id)
→ Team meeting: we are moving from Firebase to PostgreSQL because of cost...   ← full text, on demand
```

To make the assistant use COSMOS on its own, give it the instructions in [`cosmos-memory.md`](cosmos-memory.md).

### 2. Priority categories — the "backpack"

Mark a category as priority (rules, preferences). `cosmos_priority_context()` returns all of it in one light call, to be run at the start of every conversation.

<div align="center">

<img src="assets/decision.gif" width="680" alt="A priority category opened in the COSMOS app">

*A "Decisions" star opened in the app: seven memories in orbit.*

</div>

### 3. See your memory (web app)

```bash
cd webapp
bun install
bun dev
```

Open http://localhost:3000. Search with `Ctrl K`, filter, edit, switch between 2D and 3D. The app reads and writes the same `cosmos.db` as the server.

### 4. Test it without an MCP client *(optional)*

```bash
set ANTHROPIC_API_KEY=sk-ant-...      # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
python scripts/chat_with_memory.py
```

A terminal chat that uses COSMOS as its memory (needs your own Claude API key, billed on that account).

### 5. Run the tests *(optional)*

```bash
.venv/Scripts/python -m unittest discover -s tests -v
```

Use `.venv/bin/python` on macOS and Linux.

---

## Polaris, the search model

Every search goes through an embedding model that turns a question and a memory into vectors and compares them. Polaris was fine-tuned on 7,040 memories in 12 languages.

| Search measure (no AI, ~200 memories) | MiniLM | e5-small | **Polaris** |
|---|:---:|:---:|:---:|
| Right memory in the top 3 | 97.6% | 96.3% | **98.3%** |
| "Not in memory" recognized | 84.6% | 84.8% | **92.0%** |
| Newest version of a fact ranked first | 91.7% | 91.7% | 86.1% |

It is not ahead everywhere: on search alone it ranks the newest version of a fact first less often. COSMOS fixes that order afterwards using the date. Small test set (~125 questions per draw): gaps of 1 to 2 points are within chance.

---

<details>
<summary><b>🗂️ File structure</b></summary>
<br>

```
COSMOS/
├── install.py            ← one-command installer ← START HERE
├── server.py             ← MCP server (22 tools)
├── cosmos/               ← the engine
│   ├── db.py             ← SQLite schema (nodes, edges), embeddings storage
│   ├── embeddings.py     ← semantic vectors (Polaris, MiniLM fallback)
│   ├── summarizer.py     ← "Surface" summary of each memory
│   ├── categorize.py     ← automatic categories (zero-shot)
│   ├── graph.py          ← CosmosEngine: write, recall, query, link, neighbors...
│   ├── visualize.py      ← standalone interactive HTML graph
│   └── web_export.py     ← JSON export for the web app
├── webapp/               ← Next.js / Three.js app (2D and 3D)
├── scripts/              ← terminal chat with memory
├── tests/                ← test suite
├── benchmark/            ← benchmark code (run, report, synthetic data)
├── benchmark-cosmos/     ← real results: charts, tables, raw answers
├── training/             ← Polaris training and export scripts
├── cosmos-memory.md      ← instructions to give your assistant
├── docs/                 ← detailed documentation (French)
└── assets/               ← logo and GIFs
```

</details>

---

<details>
<summary><b>🧰 The 22 tools</b></summary>
<br>

`cosmos_write`, `cosmos_recall`, `cosmos_query`, `cosmos_neighbors`, `cosmos_categories`, `cosmos_set_category_priority`, `cosmos_priority_context`, `cosmos_set_category_color`, `cosmos_rename_category`, `cosmos_merge_categories`, `cosmos_update_node`, `cosmos_set_pinned`, `cosmos_delete_node`, `cosmos_delete_nodes`, `cosmos_delete_category`, `cosmos_delete_session`, `cosmos_delete_all`, `cosmos_status`, `cosmos_reindex`, `cosmos_visualize`, `cosmos_export_web`, `cosmos_graph_app`.

The deletion tools are irreversible. They are only meant to run when you ask for it explicitly.

</details>

---

<details>
<summary><b>⚙️ How it works inside</b></summary>
<br>

```
assistant ──MCP──► server.py ──► CosmosEngine ──► cosmos.db (SQLite)
                                      │
                                      └── Polaris / MiniLM (ONNX, CPU, via fastembed)
```

- **Write:** the full text is stored (Abyss), summarized (Surface), turned into a vector, categorized and dated.
- **Query:** the question becomes a vector, the closest memories come back as short summaries. Newer versions of a fact rank first, outdated ones are flagged as replaced.
- **Recall:** the assistant asks for the full text of one memory. Nothing else enters its context window.

If you change the embedding model, COSMOS detects it when the database opens and re-indexes your memories.

The full French documentation (categories, web app routes, graph, limits) is in [`docs/DETAILS-fr.md`](docs/DETAILS-fr.md).

</details>

---

<details>
<summary><b>❓ FAQ</b></summary>
<br>

**Where is my data?**
In `cosmos.db`, created next to `server.py` the first time it runs. It never leaves your machine. You can open it with any SQLite client, back it up or delete it.

**Do I need a GPU or an account?**
No. Polaris runs on the CPU. No account, no API key (except for the optional terminal chat).

**The first launch is slow.**
The search model downloads once (about 220 MB for MiniLM, 470 MB for Polaris), then stays in your cache.

**Claude doesn't see the tools.**
Restart Claude Desktop completely after `install.py --configure`. Check that `claude_desktop_config.json` contains a `cosmos-engine` entry.

**I changed the search model, did I lose my memories?**
No. COSMOS re-indexes them automatically the next time the database opens.

**How reliable is the automatic categorization?**
Weak: 21 to 39% correct on our test set. You can always force a category with `node_type`, and merge categories later.

</details>

---

<div align="center">

Built by Liam — with the help of AI.

</div>
