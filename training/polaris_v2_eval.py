"""Search test for Polaris v2 on held-out data-cosmos batches (training/polaris_v2_split.py).

python training/polaris_v2_eval.py <test.jsonl> <name>=<model path or HF id> [...] [--out results.json]

All memories, newer versions and near-miss distractors of the test file form one store
(a few thousand passages, far harder than the ~200 of the COSMOS benchmark), then:
  direct   the item's questions; right answer = the memory or its newer version (as in training)
  update   the questions about the newer version; same right answers
  newest   share of updated items where the embedding alone ranks the newer version above the old one
           (COSMOS also uses the date, so this only shows how much the model keeps versions apart)
  absent   AUC of the top score: answerable questions vs absent_question (1.0 = always separable)
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cosmos_embed as CE  # noqa: E402


def auc(pos, neg):
    """Probability that an answerable question scores above an absent one (ties count half)."""
    pos, neg = np.asarray(pos), np.asarray(neg)
    order = np.argsort(np.concatenate([pos, neg]), kind="mergesort")
    ranks = np.empty(len(order))
    ranks[order] = np.arange(1, len(order) + 1)
    return float((ranks[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def evaluate(model_path, items):
    from sentence_transformers import SentenceTransformer

    st = SentenceTransformer(model_path).float()
    qp, pp = CE.prefixes_for(model_path)
    passages, mem_id, upd_id = [], [], []
    for it in items:
        mem_id.append(len(passages))
        passages.append(it["memory"])
        upd_id.append(len(passages) if it["update"] else None)
        if it["update"]:
            passages.append(it["update"])
        if it["distractor"]:
            passages.append(it["distractor"])
    enc = lambda texts, p: st.encode([p + t for t in texts], normalize_embeddings=True, batch_size=128,
                                     convert_to_numpy=True, show_progress_bar=False)
    P = enc([CE.as_stored(t) for t in passages], pp)

    res = {}
    for kind in ("direct", "update"):
        qs, gold = [], []
        for i, it in enumerate(items):
            for q in (it["questions"] if kind == "direct" else it["update_questions"]):
                qs.append(q)
                gold.append({mem_id[i], upd_id[i]} - {None})
        S = enc(qs, qp) @ P.T
        top = np.argsort(-S, axis=1)[:, :10]
        first = [next((r for r, j in enumerate(row) if j in g), None) for row, g in zip(top, gold)]
        res[f"{kind}_r@1"] = float(np.mean([f == 0 for f in first]))
        res[f"{kind}_r@3"] = float(np.mean([f is not None and f < 3 for f in first]))
        res[f"{kind}_mrr"] = float(np.mean([0 if f is None else 1 / (f + 1) for f in first]))
        if kind == "direct":
            answerable_top = S.max(axis=1)
        else:
            k, wins = 0, []
            for i, it in enumerate(items):
                for _ in it["update_questions"]:
                    wins.append(S[k, upd_id[i]] > S[k, mem_id[i]])
                    k += 1
            res["newest_first"] = float(np.mean(wins))
    absent = [it["absent_question"] for it in items if it["absent_question"]]
    res["absent_auc"] = auc(answerable_top, (enc(absent, qp) @ P.T).max(axis=1))
    res["n_passages"], res["n_questions"] = len(passages), len(answerable_top)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("test")
    ap.add_argument("models", nargs="+", help="name=path")
    ap.add_argument("--out")
    a = ap.parse_args()
    items = [json.loads(l) for l in open(a.test, encoding="utf-8") if l.strip()]
    results = {}
    for spec in a.models:
        name, path = spec.split("=", 1)
        results[name] = evaluate(path, items)
        print(name, json.dumps({k: round(v, 4) for k, v in results[name].items()}), flush=True)
    keys = [k for k in next(iter(results.values())) if not k.startswith("n_")]
    print(f"\n{os.path.basename(a.test)}  ({results[name]['n_passages']} passages)")
    print(f"{'metric':14}" + "".join(f"{n:>12}" for n in results))
    for k in keys:
        print(f"{k:14}" + "".join(f"{results[n][k] * 100:12.1f}" for n in results))
    if a.out:
        json.dump(results, open(a.out, "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
