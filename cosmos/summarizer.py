"""
Resume Surface -- version MVP honnete.

Choix assume pour le prototype : un resume extractif naif (les
premieres phrases, tronquees a une longueur max). Ca fonctionne et
c'est deterministe/gratuit/hors-ligne, mais ce n'est PAS aussi bon
qu'un vrai resume genere par un LLM -- un resume extractif peut couper
une phrase importante juste parce qu'elle arrive en 4e position plutot
qu'en 1ere.

Chemin d'evolution honnete et deja cable : `set_summarizer()` permet de
remplacer cette fonction par un vrai appel LLM (Claude, Gemini, un
modele local...) sans toucher a graph.py -- c'est exactement le point
d'integration a utiliser en production.
"""

import re

_MAX_SURFACE_CHARS = 240
_active_summarizer = None  # callable(str) -> str, si remplace via set_summarizer


def set_summarizer(fn) -> None:
    """Branche un vrai resumeur (ex: un appel a l'API Claude) a la place du repli naif."""
    global _active_summarizer
    _active_summarizer = fn


def _naive_extractive(text: str, max_chars: int = _MAX_SURFACE_CHARS) -> str:
    text = text.strip()
    if len(text) <= max_chars:
        return text
    sentences = re.split(r"(?<=[.!?])\s+", text)
    out = ""
    for s in sentences:
        if len(out) + len(s) + 1 > max_chars:
            break
        out = f"{out} {s}".strip()
    if not out:
        out = text[:max_chars].rstrip() + "…"
    return out


def summarize(text: str) -> str:
    if _active_summarizer is not None:
        return _active_summarizer(text)
    return _naive_extractive(text)
