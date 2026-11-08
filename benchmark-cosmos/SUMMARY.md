# Benchmark mémoire COSMOS

Rapport généré le 2026-10-22 15:55

## Résumé

**Avec 100 souvenirs de bruit, COSMOS est meilleur que le gros .md sur 4 modèle(s), équivalent sur 2, moins bon sur 2. Il envoie environ 22.7 fois moins de tokens au modèle.**

## Classement (bruit = 100 souvenirs)

| Modèle | COSMOS | Gros .md | Sans mémoire | Verdict | Tokens COSMOS | Tokens .md | Économie | Abstention COSMOS / .md | Maj. COSMOS / .md | s/réponse COSMOS / .md |
|---|---|---|---|---|---|---|---|---|---|---|
| Qwen3-4B-Instruct-2507 | 96% [94–98] | 98% [95–99] | 0% [0–1] | équivalent (écart non significatif) | 212 | 5056 | × 23.8 | 99% / 100% | 97% / 100% | 0.8 / 5.7 |
| Qwen3-8B | 96% [94–98] | 89% [84–92] | 1% [0–3] | COSMOS meilleur | 216 | 5060 | × 23.4 | 100% / 100% | 97% / 86% | 0.7 / 7.2 |
| SmolLM3-3B | 94% [90–96] | 87% [83–91] | 1% [0–3] | COSMOS meilleur | 243 | 4530 | × 18.7 | 95% / 60% | 83% / 89% | 0.6 / 6.8 |
| gemma-3-4b-it | 93% [90–96] | 78% [72–82] | 0% [0–1] | COSMOS meilleur | 193 | 4752 | × 24.6 | 90% / 92% | 78% / 75% | 1.3 / 18.8 |
| Qwen3.5-4B | 91% [88–94] | 96% [94–98] | 0% [0–1] | gros .md meilleur | 200 | 4815 | × 24.0 | 99% / 100% | 94% / 100% | 1.1 / 6.0 |
| Phi-4-mini-instruct | 90% [86–93] | 92% [88–95] | 0% [0–1] | équivalent (écart non significatif) | 176 | 4171 | × 23.7 | 100% / 72% | 89% / 81% | 0.5 / 6.7 |
| Qwen3-1.7B | 83% [78–87] | 39% [34–45] | 0% [0–1] | COSMOS meilleur | 216 | 5060 | × 23.4 | 97% / 100% | 81% / 11% | 0.5 / 5.3 |
| Llama-3.2-3B-Instruct | 57% [52–63] | 74% [69–79] | 0% [0–1] | gros .md meilleur | 227 | 4514 | × 19.9 | 100% / 100% | 17% / 39% | 0.5 / 7.0 |

### Bruit = 100

| Modèle | COSMOS | Gros .md | Sans mémoire | Tokens COSMOS | Tokens .md |
|---|---|---|---|---|---|
| Qwen3-4B-Instruct-2507 | 96% [94–98] | 98% [95–99] | 0% [0–1] | 212 | 5056 |
| Qwen3-8B | 96% [94–98] | 89% [84–92] | 1% [0–3] | 216 | 5060 |
| SmolLM3-3B | 94% [90–96] | 87% [83–91] | 1% [0–3] | 243 | 4530 |
| gemma-3-4b-it | 93% [90–96] | 78% [72–82] | 0% [0–1] | 193 | 4752 |
| Qwen3.5-4B | 91% [88–94] | 96% [94–98] | 0% [0–1] | 200 | 4815 |
| Phi-4-mini-instruct | 90% [86–93] | 92% [88–95] | 0% [0–1] | 176 | 4171 |
| Qwen3-1.7B | 83% [78–87] | 39% [34–45] | 0% [0–1] | 216 | 5060 |
| Llama-3.2-3B-Instruct | 57% [52–63] | 74% [69–79] | 0% [0–1] | 227 | 4514 |

## COSMOS seul (sans IA)

| Bruit | Souvenirs | recall@1 | recall@3 | recall@5 | MRR | Mises à jour | Abstention | Catégorie auto | Latence recherche |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 150 | 83.4% | 97.2% | 97.8% | 0.903 | 70.0% | 84.8% | 38.0% | 10.1 ms |
| 100 | 200 | 83.4% | 97.2% | 97.4% | 0.902 | 70.0% | 84.8% | 38.7% | 11.5 ms |
| 200 | 300 | 83.2% | 97.0% | 97.4% | 0.899 | 70.0% | 84.8% | 32.7% | 12.9 ms |
| 400 | 500 | 83.0% | 96.6% | 97.4% | 0.897 | 70.0% | 84.8% | 30.0% | 14.3 ms |
| 800 | 900 | 82.8% | 95.7% | 97.0% | 0.894 | 70.0% | 85.0% | 21.3% | 20.9 ms |
| 1600 | 1700 | 82.8% | 94.9% | 96.6% | 0.891 | 70.0% | 85.0% | 25.3% | 33.1 ms |
