"""
C.O.S.M.O.S. — Contextual Object Storage & Memory Over Sessions

Memoire externe persistante en graphe pour agents IA, avec separation
Surface (resume, toujours consultable) / Abyss (contenu brut, rapatrie
a la demande). Model-agnostic : n'importe quel hote capable de tool-calling
(Claude, Gemini, GPT, un modele local...) peut s'y brancher via le
serveur MCP fourni dans server.py.
"""

from .graph import CosmosEngine

__all__ = ["CosmosEngine"]
__version__ = "1.0.0"
