"""
Chat direct avec Claude + COSMOS, sans passer par Claude Desktop/Cowork.

Pourquoi ce script existe : les serveurs MCP locaux ne sont pas execut-
ables depuis Cowork (voir README.md), et meme en chat Desktop classique le
protocole MCP Apps demande un serveur distant. Ce script contourne tout
ca en appelant directement l'API Claude (Messages API + tool use) et en
branchant les memes methodes de CosmosEngine comme implementation des
outils -- aucun serveur MCP, aucun hebergement, aucune config Desktop.
C'est le moyen le plus rapide de verifier concretement que "COSMOS comme
memoire d'IA" fonctionne, avant d'investir dans l'hebergement distant.

Prerequis : une cle API Claude (console.anthropic.com), differente de
l'abonnement Claude.ai/Desktop -- l'usage de ce script est facture a
l'usage sur ce compte API.

Usage :
    set ANTHROPIC_API_KEY=sk-ant-...          (Windows, PowerShell : $env:ANTHROPIC_API_KEY="sk-ant-...")
    python scripts/chat_with_memory.py
"""

import os
import sys

import anthropic

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cosmos import CosmosEngine  # noqa: E402

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")
DB_PATH = os.environ.get("COSMOS_DB_PATH", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cosmos.db"))

SYSTEM_PROMPT = (
    "Tu es Claude, avec une memoire externe persistante appelee COSMOS. "
    "Utilise cosmos_write pour retenir tout fait important que l'utilisateur mentionne "
    "(pas besoin de preciser node_type, une categorisation automatique s'en charge). "
    "Utilise cosmos_query pour chercher dans tes souvenirs avant de repondre a une question "
    "qui pourrait deja avoir ete abordee. Utilise cosmos_recall si tu as besoin du contenu "
    "complet d'un souvenir precis (a partir de son id). N'annonce pas explicitement chaque "
    "appel d'outil a l'utilisateur -- utilise-les naturellement, comme une vraie memoire."
)

TOOLS = [
    {
        "name": "cosmos_write",
        "description": "Ecrit un nouveau souvenir dans la memoire persistante COSMOS.",
        "input_schema": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "Le contenu complet a retenir."},
                "session_id": {"type": "string", "description": "Identifiant de session/contexte (optionnel)."},
            },
            "required": ["content"],
        },
    },
    {
        "name": "cosmos_query",
        "description": "Recherche semantique dans la memoire COSMOS. Retourne les souvenirs les plus proches (resumes courts).",
        "input_schema": {
            "type": "object",
            "properties": {
                "query_text": {"type": "string"},
                "top_k": {"type": "integer", "description": "Nombre de resultats (defaut 5)."},
            },
            "required": ["query_text"],
        },
    },
    {
        "name": "cosmos_recall",
        "description": "Rapatrie le contenu brut complet d'un souvenir precis a partir de son id.",
        "input_schema": {
            "type": "object",
            "properties": {"node_id": {"type": "string"}},
            "required": ["node_id"],
        },
    },
    {
        "name": "cosmos_status",
        "description": "Retourne le nombre de souvenirs/liens/sessions dans la memoire.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


def run_tool(engine: CosmosEngine, name: str, tool_input: dict) -> dict:
    if name == "cosmos_write":
        node_id = engine.write_node(
            tool_input["content"], session_id=tool_input.get("session_id", "chat_direct")
        )
        node = engine.recall(node_id)
        return {"node_id": node_id, "node_type": node["node_type"]}
    if name == "cosmos_query":
        return {"results": engine.query(tool_input["query_text"], top_k=tool_input.get("top_k", 5))}
    if name == "cosmos_recall":
        result = engine.recall(tool_input["node_id"])
        return result if result is not None else {"error": "id inconnu"}
    if name == "cosmos_status":
        return engine.status()
    return {"error": f"outil inconnu: {name}"}


def main() -> None:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ANTHROPIC_API_KEY n'est pas defini. Voir l'en-tete de ce fichier pour comment le configurer.")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    engine = CosmosEngine(db_path=DB_PATH)
    print(f"Connecte a COSMOS ({DB_PATH}) -- {engine.status()}")
    print("Tape 'exit' pour quitter.\n")

    messages: list = []
    try:
        while True:
            user_input = input("Toi> ").strip()
            if user_input.lower() in {"exit", "quit"}:
                break
            if not user_input:
                continue

            messages.append({"role": "user", "content": user_input})

            while True:
                response = client.messages.create(
                    model=MODEL,
                    max_tokens=1024,
                    system=SYSTEM_PROMPT,
                    tools=TOOLS,
                    messages=messages,
                )
                messages.append({"role": "assistant", "content": response.content})

                tool_uses = [block for block in response.content if block.type == "tool_use"]
                text_blocks = [block.text for block in response.content if block.type == "text"]

                if text_blocks:
                    print("Claude>", " ".join(text_blocks))

                if not tool_uses:
                    break

                tool_results = []
                for tool_use in tool_uses:
                    result = run_tool(engine, tool_use.name, tool_use.input)
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use.id,
                            "content": str(result),
                        }
                    )
                messages.append({"role": "user", "content": tool_results})
    finally:
        engine.close()


if __name__ == "__main__":
    main()
