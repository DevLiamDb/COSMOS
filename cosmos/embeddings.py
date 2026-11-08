"""
Embeddings de COSMOS -- V1.

Version beta (dépassée) : HashingVectorizer (sac-de-mots haché, scikit-learn).
Fonctionnel mais pas sémantique -- "voiture" et "automobile" n'étaient jamais
rapprochés faute de sens appris, seulement du vocabulaire partagé.

V1 : un vrai modèle d'embedding sémantique dense, via fastembed (Qdrant).
Choix de fastembed plutôt que sentence-transformers/torch directement :
mêmes modèles (exportés en ONNX), même qualité de sortie, mais sans la
dépendance à PyTorch (plusieurs centaines de Mo, cassante à installer dans
certains environnements) -- juste onnxruntime, une dépendance plus légère
et plus stable.

Modèle : sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
(384 dimensions, ~220 Mo, téléchargé une seule fois depuis Hugging Face au
premier lancement puis mis en cache localement -- par défaut dans le dossier
temporaire du système (voir fastembed.common.utils.define_cache_dir),
redirigeable via FASTEMBED_CACHE_DIR (voir _get_model ci-dessous et
DEPLOY.md pour le déploiement hébergé, où ça pointe vers le volume
persistant).
Choisi spécifiquement parce que le contenu de ce projet est majoritairement
en français -- un modèle anglais-only (comme bge-small-en) donnerait des
résultats nettement moins bons sur du texte français. Test réel fait
pendant le développement : sur deux phrases françaises reformulant le même
fait, similarité cosinus 0.97 ; contre une phrase sans rapport, 0.10 --
une séparation sémantique franche, pas juste du chevauchement de mots.

Chemin d'évolution : changer MODEL_NAME suffit pour changer de modèle
(voir `TextEmbedding.list_supported_models()` pour les options) -- le
reste de COSMOS ne dépend que de la signature `embed(text) -> vecteur`.

V2 : Polaris, notre propre modèle -- multilingual-e5-small fine-tuné sur
7 040 souvenirs écrits pour COSMOS (training/cosmos_embed.py), exporté en
ONNX (training/export_polaris.py) et publié sur Hugging Face
(DevLiamDb/polaris). Modèle par défaut : lu dans models/polaris s'il existe,
sinon téléchargé une fois (~490 Mo) puis mis en cache comme MiniLM.
COSMOS_EMBED_MODEL=minilm force l'ancien modèle. Changer de modèle rend les
vecteurs déjà stockés incompatibles : CosmosEngine le détecte à l'ouverture
de la base et réindexe (graph.py::_check_embedding_model).
"""

import json
import os
import sys
import threading
import warnings

import numpy as np
from fastembed import TextEmbedding
from fastembed.common.model_description import ModelSource, PoolingType

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POLARIS_REPO = os.environ.get("COSMOS_POLARIS_REPO", "DevLiamDb/polaris")
POLARIS_DIR = os.environ.get("COSMOS_POLARIS_DIR", os.path.join(_ROOT, "models", "polaris"))
_polaris_conf = os.path.join(POLARIS_DIR, "polaris.json")
_polaris_local = os.path.exists(_polaris_conf)
_use_polaris = os.environ.get("COSMOS_EMBED_MODEL", "polaris") != "minilm"


def _polaris_reachable() -> bool:
    """False seulement si Hugging Face repond que le repo est prive, ferme ou
    introuvable (401/403/404) -- sans token, un utilisateur n'aurait alors aucun
    moyen de telecharger Polaris. Hors ligne, on garde Polaris : le cache local
    peut deja le contenir."""
    try:
        from huggingface_hub import HfApi
        from huggingface_hub.errors import HfHubHTTPError
    except ImportError:
        return True
    try:
        HfApi().model_info(POLARIS_REPO, timeout=5)
    except HfHubHTTPError:
        print(f"COSMOS : Polaris ({POLARIS_REPO}) n'est pas accessible sans token Hugging Face, "
              "repli sur MiniLM. Definis HF_TOKEN pour utiliser Polaris.", file=sys.stderr)
        return False
    except Exception:
        return True
    return True


if _use_polaris and not _polaris_local and not _polaris_reachable():
    _use_polaris = False
# Copie de polaris.json, pour ne pas toucher au reseau a l'import quand le
# modele vient de Hugging Face (le dossier local, s'il existe, fait foi).
_POLARIS_DEFAULTS = {"dim": 384, "query_prefix": "query: ", "passage_prefix": "passage: ",
                     "supersede_sim": 0.54, "supersede_margin": 0.02}
if not _use_polaris:
    _conf = {}
elif _polaris_local:
    _conf = json.load(open(_polaris_conf, encoding="utf-8"))
else:
    _conf = _POLARIS_DEFAULTS

MODEL_NAME = POLARIS_REPO if _use_polaris else "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_DIM = _conf.get("dim", 384)

# Prefixes ajoutes avant d'encoder une recherche (query) ou un souvenir stocke
# (passage). Vides pour MiniLM (modele symetrique) ; les modeles de recherche
# asymetriques comme multilingual-e5 (donc Polaris) en exigent
# ("query: " / "passage: "), sans quoi leurs scores s'effondrent.
QUERY_PREFIX = os.environ.get("COSMOS_QUERY_PREFIX", _conf.get("query_prefix", ""))
PASSAGE_PREFIX = os.environ.get("COSMOS_PASSAGE_PREFIX", _conf.get("passage_prefix", ""))

# Cosinus a partir duquel deux souvenirs sont deux versions d'un meme fait
# (voir graph.py::query). Depend du modele : mesure sur les groupes dev de
# data-cosmos (versions d'un fait vs souvenir proche mais different), MiniLM
# separe le mieux a 0.60 (69% des versions reconnues, 15% de faux). L'ancien
# 0.75 n'en reconnaissait que 23%. e5-small de base : 0.90 ; Polaris : 0.54
# (lu dans polaris.json).
SUPERSEDE_SIM = float(os.environ.get("COSMOS_SUPERSEDE_SIM", _conf.get("supersede_sim", 0.60)))
# Ecart de score (similarite a la question) toléré pour qu'une version recente
# passe devant l'ancienne : au-dela, elle repond moins bien a la question posee.
SUPERSEDE_MARGIN = float(os.environ.get("COSMOS_SUPERSEDE_MARGIN", _conf.get("supersede_margin", 0.05)))

_model = None  # charge paresseusement, une seule fois par process
# Verrou du chargement paresseux -- CosmosEngine appelle embed() AVANT de
# prendre son propre RLock (voir graph.py::write_node), donc rien ne
# protegeait _get_model() contre plusieurs threads entrant en meme temps
# dans "if _model is None" au tout premier appel (serveur MCP = un thread
# de worker different par appel d'outil). Sans ce verrou, un cache fastembed
# incomplet/corrompu (ex: special_tokens_map.json manquant) fait que N
# threads tentent simultanement de re-initialiser/re-telecharger le modele,
# ce qui peut se manifester en erreurs reseau (connexions fermees) plutot
# qu'une seule erreur claire -- observe reellement en test de concurrence.
_model_lock = threading.Lock()


def _get_model() -> TextEmbedding:
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:  # double verification : un autre thread a pu finir pendant l'attente
                # Avertissement inoffensif de fastembed sur un changement de pooling
                # interne entre versions -- n'affecte pas la coherence des vecteurs
                # produits par CE process (toujours le meme calcul d'un appel a l'autre),
                # seulement supprime ici pour ne pas polluer les logs du serveur MCP.
                # cache_dir : par defaut ~/.cache/fastembed (poste local). En
                # deploiement heberge (voir COSMOS/DEPLOY.md), FASTEMBED_CACHE_DIR
                # pointe vers le volume persistant -- sinon le modele (~220 Mo) serait
                # re-telecharge a chaque redemarrage du conteneur.
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    if MODEL_NAME == POLARIS_REPO:
                        # e5 = mean pooling + normalisation
                        try:
                            TextEmbedding.add_custom_model(
                                model=POLARIS_REPO, pooling=PoolingType.MEAN, normalization=True,
                                sources=ModelSource(hf=POLARIS_REPO), dim=EMBEDDING_DIM, model_file="model.onnx",
                            )
                        except ValueError:
                            pass  # deja enregistre dans ce process
                        if _polaris_local:
                            _model = TextEmbedding(model_name=POLARIS_REPO, specific_model_path=POLARIS_DIR)
                        else:
                            _model = TextEmbedding(model_name=POLARIS_REPO, cache_dir=os.environ.get("FASTEMBED_CACHE_DIR"))
                    else:
                        _model = TextEmbedding(model_name=MODEL_NAME, cache_dir=os.environ.get("FASTEMBED_CACHE_DIR"))
    return _model


def embed(text: str, kind: str = "passage") -> np.ndarray:
    """Retourne un vecteur de dimension EMBEDDING_DIM (embedding sémantique réel,
    pas un sac-de-mots -- deux formulations différentes du même fait auront une
    similarité cosinus élevée même sans vocabulaire partagé).

    `kind` : "query" pour une recherche, "passage" (defaut) pour un souvenir
    stocke ou un exemple de categorie -- choisit le prefixe a appliquer."""
    if not text or not text.strip():
        return np.zeros(EMBEDDING_DIM, dtype=np.float32)
    prefix = QUERY_PREFIX if kind == "query" else PASSAGE_PREFIX
    vec = next(_get_model().embed([prefix + text]))
    return np.asarray(vec, dtype=np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0.0:
        return 0.0
    return float(np.dot(a, b) / denom)
