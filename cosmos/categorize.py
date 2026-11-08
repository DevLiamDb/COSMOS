"""
Catégorisation automatique des souvenirs -- zero-shot par embedding.

Principe réel et connu (pas inventé) : plutôt que d'entraîner un classifieur
dédié, on encode chaque catégorie candidate comme un petit ensemble de
phrases-exemples, on moyenne leurs embeddings pour obtenir un "prototype"
de catégorie, on encode le nouveau souvenir avec le même modèle
d'embedding (voir embeddings.py), et on assigne la catégorie dont le
prototype est le plus proche en similarité cosinus. C'est la même idée que
le "zero-shot classification" via embeddings utilisé par des outils réels.

Test réel fait pendant le développement (6 exemples français couvrant les
6 catégories) : une seule phrase-prototype par catégorie donnait 4/6
corrects, avec deux catégories carrément inversées (tâche <-> question
ouverte). Passer à plusieurs exemples moyennés par catégorie a fait
remonter le score à 5/6 -- amélioration mesurée, pas supposée.

Avantage : aucun modèle supplémentaire à charger -- on réutilise le même
modèle d'embedding multilingue déjà chargé pour la recherche sémantique
(cosmos/embeddings.py). Aucune donnée envoyée à un tiers, tout reste local.

Limite honnête : ce n'est toujours pas un vrai classifieur entraîné et
évalué sur un vrai jeu de test -- 5/6 sur six exemples n'est pas une
mesure statistiquement solide, juste un signe que la direction est bonne.
La confusion restante observée porte sur des cas ambigus par nature (un
fait qui décrit aussi le contexte d'un projet). Pour un besoin plus
précis : enrichir encore les exemples ci-dessous, ou brancher un vrai
classifieur (ou un appel LLM dédié) via `set_categorizer()`, sur le même
principe que `summarizer.py::set_summarizer()`.
"""

import numpy as np

from . import embeddings

# Taxonomie par défaut -- plusieurs phrases-exemples par catégorie (moyennées
# en un vecteur prototype) plutôt qu'une seule phrase abstraite : mesuré plus
# fiable pour distinguer des catégories proches (tache vs question_ouverte).
DEFAULT_TAXONOMY = {
    "fait": [
        "Le budget total du modèle est de 500 milliards de paramètres.",
        "La capitale de la France est Paris.",
        "Ce composant mesure 12 centimètres de large.",
    ],
    "decision": [
        "On a décidé de remettre cette fonctionnalité dans le fichier benchmarks.",
        "Après discussion, on choisit finalement la version SQLite plutôt que Postgres.",
        "Décision prise : on utilise fastembed plutôt que sentence-transformers.",
    ],
    "tache": [
        "Il faut encore corriger le README pour mentionner la nouvelle taxonomie.",
        "Reste à faire : ajouter les tests de concurrence.",
        "À faire prochainement : héberger le serveur à distance.",
    ],
    "preference": [
        "Julia préfère les réponses concises, sans trop de formatage.",
        "Elle aime que le code soit testé avant d'être livré.",
        "Style préféré : direct, sans fioriture inutile.",
    ],
    "contexte_projet": [
        "Ce projet est documenté dans plusieurs fichiers répartis sur différents dossiers.",
        "Ce dossier contient toute la documentation du projet COSMOS.",
        "Contexte général : on construit une mémoire externe pour une IA.",
    ],
    "question_ouverte": [
        "Est-ce que Cowork peut vraiment exécuter des serveurs MCP locaux ? Pas encore confirmé.",
        "Question non résolue : faut-il héberger cela en local ou dans le cloud ?",
        "On ne sait pas encore si cette approche va fonctionner à grande échelle.",
    ],
}

_active_categorizer = None  # callable(str) -> str, si remplace via set_categorizer
_prototype_cache: dict[str, np.ndarray] = {}


def set_categorizer(fn) -> None:
    """Remplace la categorisation zero-shot par embedding par une fonction
    personnalisee (ex: un vrai classifieur, ou un appel LLM dedie)."""
    global _active_categorizer
    _active_categorizer = fn


def _get_prototype_vectors(taxonomy: dict) -> dict:
    key = str(sorted((name, tuple(examples)) for name, examples in taxonomy.items()))
    if key not in _prototype_cache:
        result = {}
        for name, examples in taxonomy.items():
            if isinstance(examples, str):
                examples = [examples]
            vecs = [embeddings.embed(e) for e in examples]
            result[name] = np.mean(vecs, axis=0)
        _prototype_cache[key] = result
    return _prototype_cache[key]


def categorize(text: str, taxonomy: dict | None = None, extra_prototypes: dict | None = None) -> str:
    """Retourne le nom de la categorie la plus proche de `text` (zero-shot par
    embedding), ou la categorie assignee par un categoriseur personnalise si
    `set_categorizer()` a ete appele.

    `extra_prototypes` (optionnel) : des vecteurs de categories deja calcules
    ailleurs (typiquement par CosmosEngine, a partir des categories creees a
    la volee via node_type explicite -- voir graph.py::_touch_category) a
    comparer en plus de la taxonomie de base. C'est ce qui permet a une
    categorie inventee en cours de route de devenir reconnaissable
    automatiquement par la suite, sans rien coder en dur ici."""
    if _active_categorizer is not None:
        return _active_categorizer(text)

    taxonomy = taxonomy or DEFAULT_TAXONOMY
    if not text or not text.strip():
        return "fait"

    text_vec = embeddings.embed(text)
    # Copie : ne jamais muter le dict mis en cache par _get_prototype_vectors,
    # sinon des categories custom d'un appel fuiteraient dans le cache partage
    # d'un autre appel qui ne les a pas passees en extra_prototypes.
    prototypes = dict(_get_prototype_vectors(taxonomy))
    if extra_prototypes:
        prototypes.update(extra_prototypes)

    best_name, best_score = None, -1.0
    for name, proto_vec in prototypes.items():
        score = embeddings.cosine_similarity(text_vec, proto_vec)
        if score > best_score:
            best_name, best_score = name, score
    return best_name
