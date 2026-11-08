"""
Benchmark mémoire COSMOS.

Niveau 1 (sans IA, gratuit) : qualité du retrieval, de la catégorisation,
gestion des mises à jour, abstention, coût en tokens, latence.

Niveau 2 (avec un modèle local Hugging Face, ex. Qwen sur Kaggle) : on pose
les mêmes questions au modèle avec trois mémoires différentes :
  none     -> aucune mémoire (plancher)
  full_md  -> tous les souvenirs collés dans le prompt (un gros fichier .md)
  cosmos   -> seulement les top-k souvenirs trouvés par COSMOS

Usage :
  python -m benchmark.run                                  # niveau 1
  python -m benchmark.run --llm Qwen/Qwen3-4B-Instruct-2507  # niveaux 1 + 2
Options : --distractors N (bruit), --k K, --seed S, --configs a,b, --limit N
"""

import argparse
import json
import os
import random
import re
import statistics
import sys
import tempfile
import time
import unicodedata
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from cosmos import CosmosEngine  # noqa: E402
from benchmark import synth  # noqa: E402

ABSTAIN_MARKERS = [
    "jenesaispas", "nesaispas", "pasdinformation", "aucuneinformation",
    "pasmentionne", "pasdanslamemoire", "inconnu", "pasdedonnee", "aucunemention",
    "pasdisponible", "neconnaispas", "aucunsouvenir", "aucunesouvenir", "pasdetrace",
]


# ---------------------------------------------------------------- utilitaires
def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _match(option: str, answer: str, a_norm: str) -> bool:
    if option.isdigit():  # nombre : pas "4" dans "14", et "4 500" == "4500"
        compact = re.sub(r"(?<=\d)[   ](?=\d{3}(?!\d))", "", answer)
        return re.search(rf"(?<!\d){option}(?!\d)", compact) is not None
    return norm(option) in a_norm


def kw_ok(answer: str, kw: list) -> bool:
    a = norm(answer)
    for group in kw:
        options = group if isinstance(group, list) else [group]
        if not any(_match(o, answer, a) for o in options):
            return False
    return True


def abstained(answer: str) -> bool:
    a = norm(answer)
    return any(m in a for m in ABSTAIN_MARKERS)


def est_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def make_distractors(n: int, seed: int) -> list:
    """Faits plausibles mais sans rapport avec les questions (bruit)."""
    rng = random.Random(seed)
    people = ["Théo", "Maëlle", "Sacha", "Lola", "Nolan", "Zoé", "Enzo", "Jade", "Maxime", "Lina"]
    cities = ["Lyon", "Nantes", "Lille", "Gand", "Namur", "Rennes", "Tours", "Anvers", "Nice"]
    dishes = ["lasagnes", "ramen", "tajine", "paella", "risotto", "curry", "gratin"]
    colors = ["rouge", "bleue", "verte", "jaune", "noire", "blanche"]
    days = ["lundi", "mercredi", "jeudi", "vendredi", "samedi"]
    hobbies = ["la peinture", "le judo", "l'escalade", "la photo", "le piano", "le jardinage"]
    templates = [
        lambda: f"{rng.choice(people)} adore cuisiner des {rng.choice(dishes)} le week-end.",
        lambda: f"{rng.choice(people)} vit à {rng.choice(cities)} depuis {rng.randint(2, 15)} ans.",
        lambda: f"Rendez-vous avec {rng.choice(people)} le {rng.choice(days)} à {rng.randint(9, 18)}h.",
        lambda: f"{rng.choice(people)} a repeint son salon en {rng.choice(colors)}.",
        lambda: f"{rng.choice(people)} pratique {rng.choice(hobbies)} deux fois par semaine.",
        lambda: f"Le vélo de {rng.choice(people)} est {rng.choice(['rouge', 'bleu', 'vert', 'noir'])} et a {rng.randint(18, 27)} vitesses.",
        lambda: f"{rng.choice(people)} part en vacances à {rng.choice(cities)} en {rng.choice(['juin', 'juillet', 'septembre'])}.",
    ]
    seen, out = set(), []
    guard = 0
    while len(out) < n and guard < n * 50:
        guard += 1
        t = rng.choice(templates)()
        if t in seen:
            continue
        seen.add(t)
        out.append({"id": f"d{len(out):03d}", "text": t, "type": "bruit"})
    return out


def interleave(facts: list, distractors: list, seed: int) -> list:
    """Insère le bruit au hasard sans changer l'ordre relatif des vrais faits."""
    rng = random.Random(seed + 1)
    items = list(facts)
    for d in distractors:
        items.insert(rng.randrange(len(items) + 1), d)
    return items


# ----------------------------------------------------------------- niveau 1
def build_engine(items: list):
    tmp = tempfile.mkdtemp(prefix="cosmos_bench_")
    eng = CosmosEngine(db_path=os.path.join(tmp, "bench.db"))
    node_to_item, item_to_node, assigned, write_ms = {}, {}, {}, []
    for idx, it in enumerate(items):
        t0 = time.perf_counter()
        nid = eng.write_node(it["text"], session_id="bench")  # catégorie automatique
        write_ms.append((time.perf_counter() - t0) * 1000)
        node_to_item[nid] = it["id"]
        item_to_node[it["id"]] = nid
        assigned[it["id"]] = eng.recall(nid)["node_type"]
    return eng, node_to_item, item_to_node, assigned, write_ms


def level1(eng, items, questions, node_to_item, assigned, write_ms, k_max=10):
    by_id = {it["id"]: it for it in items}
    ranks, per_kind, top1_scores, latencies = {}, {}, {"ans": [], "unans": []}, []
    update_ok, update_n = 0, 0
    for q in questions:
        t0 = time.perf_counter()
        res = eng.query(q["q"], top_k=k_max)
        latencies.append((time.perf_counter() - t0) * 1000)
        ids = [node_to_item[r["id"]] for r in res]
        top1 = res[0]["score"] if res else 0.0
        if q["gold"] is None:
            top1_scores["unans"].append(top1)
            continue
        top1_scores["ans"].append(top1)
        rank = ids.index(q["gold"]) + 1 if q["gold"] in ids else None
        ranks[q["id"]] = rank
        per_kind.setdefault(q["kind"], []).append(rank)
        if q["kind"] == "update":
            update_n += 1
            old = by_id[q["gold"]].get("supersedes")
            old_rank = ids.index(old) + 1 if old in ids else 10**6
            if rank is not None and rank < old_rank:
                update_ok += 1

    def at(k, rs):
        return sum(1 for r in rs if r is not None and r <= k) / len(rs) if rs else float("nan")

    all_ranks = list(ranks.values())
    mrr = statistics.mean((1 / r) if r else 0 for r in all_ranks)

    # abstention : meilleur seuil sur le score du top-1
    cands = sorted(set(top1_scores["ans"] + top1_scores["unans"]))
    best_acc, best_thr = 0.0, 0.0
    total = len(top1_scores["ans"]) + len(top1_scores["unans"])
    for thr in cands:
        good = sum(1 for s in top1_scores["ans"] if s >= thr) + sum(1 for s in top1_scores["unans"] if s < thr)
        if good / total > best_acc:
            best_acc, best_thr = good / total, thr

    # catégorisation (vrais faits uniquement)
    real = [it for it in items if it["type"] not in ("bruit", "synth")]
    cat_ok = sum(1 for it in real if assigned[it["id"]] == it["type"])
    wrong = [(it["id"], it["type"], assigned[it["id"]]) for it in real if assigned[it["id"]] != it["type"]]

    full_md = "\n".join("- " + it["text"] for it in items)
    return {
        "recall@1": at(1, all_ranks), "recall@3": at(3, all_ranks), "recall@5": at(5, all_ranks),
        "mrr": mrr,
        "recall@3_par_type": {kd: at(3, rs) for kd, rs in per_kind.items()},
        "update_gold_avant_ancien": f"{update_ok}/{update_n}",
        "update_acc": update_ok / update_n if update_n else float("nan"),
        "abstention_best_acc": best_acc, "abstention_seuil": best_thr,
        "score_top1_moy_repondable": statistics.mean(top1_scores["ans"]),
        "score_top1_moy_sans_reponse": statistics.mean(top1_scores["unans"]) if top1_scores["unans"] else None,
        "categorisation_acc": cat_ok / len(real), "categorisation_erreurs": wrong,
        "latence_query_ms_med": statistics.median(latencies),
        "latence_write_ms_med": statistics.median(write_ms),
        "tokens_estimes_full_md": est_tokens(full_md),
        "n_souvenirs": len(items),
    }


# ----------------------------------------------------------------- niveau 2
SYSTEM = (
    "Tu es un assistant qui connaît l'utilisateur grâce à une mémoire. "
    "Réponds en français, en une phrase courte, uniquement à partir de la mémoire fournie. "
    "Si la réponse n'est pas dans la mémoire, réponds exactement : Je ne sais pas. "
    "Chaque souvenir a un numéro : plus il est grand, plus il est récent. "
    "Si deux souvenirs se contredisent, le plus récent fait foi, sauf si la question porte sur le passé."
)


class HFModel:
    """Modèle Hugging Face local. Essaie fp16, puis bf16 si les réponses sont du charabia
    (fp16 peut déborder sur certains modèles) ; échoue clairement sinon."""

    def __init__(self, name: str, device_map: str = "single"):
        import torch
        import transformers
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.torch, self.name = torch, name
        self.tok = AutoTokenizer.from_pretrained(name)
        cuda = torch.cuda.is_available()
        self.dm = {"": 0} if (device_map == "single" and cuda) else "auto"
        # Qwen3.5 est multimodal : AutoModelForCausalLM peut échouer, on essaie les autres classes.
        self.loaders = [AutoModelForCausalLM]
        for extra in ("AutoModelForImageTextToText", "AutoModelForMultimodalLM"):
            if hasattr(transformers, extra):
                self.loaders.append(getattr(transformers, extra))
        dtypes = [("float16", torch.float16), ("bfloat16", torch.bfloat16)] if cuda else [("float32", torch.float32)]
        errors = []
        for dname, dtype in dtypes:
            try:
                self.model = self._load(dtype)
                self.model.eval()
                if self._sane():
                    self.dtype = dname
                    print(f"Modèle chargé en {dname}, test de cohérence OK", flush=True)
                    return
                errors.append(f"{dname}: réponses incohérentes (charabia)")
            except Exception as e:  # noqa: BLE001
                errors.append(f"{dname}: {type(e).__name__}: {str(e)[:200]}")
            self.model = None
            if cuda:
                torch.cuda.empty_cache()
        raise RuntimeError("Impossible de charger " + name + " -> " + " | ".join(errors))

    def _load(self, dtype):
        last_err = None
        for loader in self.loaders:
            for kw in ({"dtype": dtype}, {"torch_dtype": dtype}):
                try:
                    return loader.from_pretrained(self.name, device_map=self.dm, **kw)
                except Exception as e:  # noqa: BLE001
                    last_err = e
        raise last_err

    def _sane(self) -> bool:
        raw, _, _ = self._generate("Réponds en un mot.", "Quelle est la capitale de la France ?", 32)
        letters = sum(c.isalpha() for c in raw)
        visible = sum(not c.isspace() for c in raw)
        print(f"Test de cohérence : {raw[:60]!r}", flush=True)
        return visible >= 3 and letters / visible >= 0.6

    def _generate(self, system, user, max_new_tokens):
        msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        try:
            prompt = self.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        except TypeError:
            prompt = self.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        # le gabarit de chat contient déjà les tokens spéciaux : ne pas les rajouter
        inputs = self.tok(prompt, return_tensors="pt", add_special_tokens=False).to(self.model.device)
        n_prompt = inputs["input_ids"].shape[1]
        t0 = time.perf_counter()
        gen = dict(max_new_tokens=max_new_tokens, do_sample=False,
                   pad_token_id=self.tok.pad_token_id or self.tok.eos_token_id)
        with self.torch.no_grad():
            chunk = PREFILL_CHUNK
            if chunk and n_prompt > chunk:
                # Long prompt: read it in pieces to fill the cache, so attention never builds
                # one huge (tokens x tokens) matrix. Same computation, far less GPU memory.
                cache = _new_cache(self.model)
                ids = inputs["input_ids"]
                for s in range(0, n_prompt - 1, chunk):
                    e = min(s + chunk, n_prompt - 1)
                    self.model(input_ids=ids[:, s:e], past_key_values=cache, use_cache=True)
                out = self.model.generate(**inputs, past_key_values=cache, **gen)
            else:
                out = self.model.generate(**inputs, **gen)
        dt = time.perf_counter() - t0
        return self.tok.decode(out[0][n_prompt:], skip_special_tokens=True), n_prompt, dt

    def chat(self, system: str, user: str, max_new_tokens: int = 96):
        raw, n_prompt, dt = self._generate(system, user, max_new_tokens)
        text = re.sub(r"<think>.*?</think>", "", raw, flags=re.S)
        text = re.sub(r"<think>.*", "", text, flags=re.S).strip()  # réflexion coupée par la limite de tokens
        return text, n_prompt, dt


# Optional: COSMOS_PREFILL_CHUNK=1024 reads long prompts in pieces (used for Qwen3-4B / Qwen3-8B,
# which ran out of GPU memory on the full .md prompt). 0 = off, the default for every other model.
PREFILL_CHUNK = int(os.environ.get("COSMOS_PREFILL_CHUNK", "0") or 0)


def _new_cache(model):
    from transformers import DynamicCache

    try:
        return DynamicCache(config=model.config)
    except TypeError:
        return DynamicCache()


def memory_for(cfg, q, eng, items, node_to_item, k):
    """Les souvenirs sont numérotés dans l'ordre d'écriture (plus grand = plus récent), pour les deux
    configs. Seul COSMOS sait en plus marquer un souvenir comme remplacé par un plus récent."""
    if cfg == "none":
        return "(aucune mémoire)"

    def line(idx, text, old=False):
        return f"- [souvenir n°{idx + 1}{', remplacé par un plus récent' if old else ''}] {text}"

    if cfg == "full_md":
        return "\n".join(line(i, it["text"]) for i, it in enumerate(items))
    pos = {it["id"]: i for i, it in enumerate(items)}
    res = sorted(eng.query(q["q"], top_k=k), key=lambda r: pos[node_to_item[r["id"]]])  # ordre chronologique
    return "\n".join(line(pos[node_to_item[r["id"]]], eng.recall(r["id"])["abyss"], r.get("obsolete")) for r in res)


def level2(model, eng, items, questions, node_to_item, configs, k):
    out = {}
    for cfg in configs:
        rows = []
        for q in questions:
            mem = memory_for(cfg, q, eng, items, node_to_item, k)
            user = f"Mémoire :\n{mem}\n\nQuestion : {q['q']}"
            ans, n_prompt, dt = model.chat(SYSTEM, user)
            if q["gold"] is None:
                ok = abstained(ans)
            else:
                ok = kw_ok(ans, q["kw"]) and not abstained(ans)
            rows.append({"id": q["id"], "kind": q["kind"], "question": q["q"], "ok": ok, "answer": ans,
                         "prompt_tokens": n_prompt, "sec": dt})
            print(f"  [{cfg}] {q['id']} {'OK ' if ok else 'KO '} {ans[:70]!r}", flush=True)

        def acc(kind=None, exclude=None):
            sel = [r for r in rows if (kind is None or r["kind"] == kind) and (exclude is None or r["kind"] != exclude)]
            return sum(r["ok"] for r in sel) / len(sel) if sel else float("nan")

        out[cfg] = {
            "accuracy_repondables": acc(exclude="unanswerable"),
            "accuracy_update": acc("update"),
            "accuracy_history": acc("history"),
            "abstention_ok": acc("unanswerable"),
            "tokens_prompt_moy": statistics.mean(r["prompt_tokens"] for r in rows),
            "sec_moy": statistics.mean(r["sec"] for r in rows),
            "details": rows,
        }
    return out


# ------------------------------------------------------------------- rapport
def pct(x):
    return "  n/a" if x is None or x != x else f"{100 * x:5.1f}%"


def print_l1(r):
    print("\n=== NIVEAU 1 : retrieval (sans IA) ===")
    print(f"souvenirs en mémoire : {r['n_souvenirs']}")
    print(f"recall@1 {pct(r['recall@1'])} | recall@3 {pct(r['recall@3'])} | recall@5 {pct(r['recall@5'])} | MRR {r['mrr']:.3f}")
    print("recall@3 par type de question : " + ", ".join(f"{k}={pct(v)}" for k, v in r["recall@3_par_type"].items()))
    print(f"mises à jour (le récent passe avant l'ancien) : {r['update_gold_avant_ancien']}")
    print(f"abstention (meilleur seuil {r['abstention_seuil']:.2f}) : {pct(r['abstention_best_acc'])}"
          f"  [score top-1 moyen : réponse dispo {r['score_top1_moy_repondable']:.2f} / sans réponse {r['score_top1_moy_sans_reponse'] or 0:.2f}]")
    print(f"catégorisation automatique : {pct(r['categorisation_acc'])}  (erreurs : {len(r['categorisation_erreurs'])})")
    print(f"latence médiane : query {r['latence_query_ms_med']:.1f} ms | write {r['latence_write_ms_med']:.1f} ms")
    print(f"un .md complet ≈ {r['tokens_estimes_full_md']} tokens (estimation)")


def print_l2(r):
    print("\n=== NIVEAU 2 : modèle IA ===")
    print(f"{'config':9} {'répond.':>8} {'update':>8} {'histor.':>8} {'abstent.':>9} {'tok/prompt':>11} {'s/rép.':>7}")
    for cfg, m in r.items():
        print(f"{cfg:9} {pct(m['accuracy_repondables']):>8} {pct(m['accuracy_update']):>8} {pct(m['accuracy_history']):>8} "
              f"{pct(m['abstention_ok']):>9} {m['tokens_prompt_moy']:>11.0f} {m['sec_moy']:>7.2f}")




# ----------------------------------------------------------------- agrégation
def mean_std(values):
    values = [v for v in values if v is not None and v == v]
    if not values:
        return None
    return [statistics.mean(values), statistics.pstdev(values) if len(values) > 1 else 0.0]


L1_KEYS = ["recall@1", "recall@3", "recall@5", "mrr", "update_acc", "abstention_best_acc",
           "categorisation_acc", "latence_query_ms_med", "tokens_estimes_full_md"]
L2_KEYS = ["accuracy_repondables", "accuracy_update", "accuracy_history", "abstention_ok",
           "tokens_prompt_moy", "sec_moy"]


def summarize(runs):
    summary = {}
    for scale in sorted({r["scale"] for r in runs}):
        sel = [r for r in runs if r["scale"] == scale]
        entry = {"seeds": [r["seed"] for r in sel],
                 "n_questions": sel[0]["n_questions"], "n_souvenirs": sel[0]["niveau1"]["n_souvenirs"],
                 "niveau1": {k: mean_std([r["niveau1"][k] for r in sel]) for k in L1_KEYS}}
        if "niveau2" in sel[0]:
            entry["niveau2"] = {
                cfg: {k: mean_std([r["niveau2"][cfg][k] for r in sel]) for k in L2_KEYS}
                for cfg in sel[0]["niveau2"]
            }
        summary[str(scale)] = entry
    return summary


def fmt(ms, is_pct=True):
    if ms is None:
        return "n/a"
    m, s = ms
    return f"{100 * m:.1f}% ±{100 * s:.1f}" if is_pct else f"{m:.0f} ±{s:.0f}"


def print_summary(summary):
    for scale, e in summary.items():
        print(f"\n######## {scale} souvenirs de bruit — {e['n_souvenirs']} souvenirs, "
              f"{e['n_questions']} questions, graines {e['seeds']} (moyenne ±écart-type)")
        l1 = e["niveau1"]
        print(f"[retrieval] recall@1 {fmt(l1['recall@1'])} | recall@3 {fmt(l1['recall@3'])} | "
              f"MRR {l1['mrr'][0]:.3f} | maj. {fmt(l1['update_acc'])} | abstention {fmt(l1['abstention_best_acc'])} | "
              f"catégorie {fmt(l1['categorisation_acc'])}")
        if "niveau2" in e:
            print(f"{'config':9} {'répond.':>16} {'update':>16} {'abstent.':>16} {'tok/prompt':>12} {'s/rép.':>7}")
            for cfg, m in e["niveau2"].items():
                print(f"{cfg:9} {fmt(m['accuracy_repondables']):>16} {fmt(m['accuracy_update']):>16} "
                      f"{fmt(m['abstention_ok']):>16} {m['tokens_prompt_moy'][0]:>12.0f} {m['sec_moy'][0]:>7.2f}")


# ----------------------------------------------------------------------- main
def run_one(scale, seed, args, facts, questions, model):
    s_facts, s_questions = (synth.generate(args.synthetic, seed) if args.synthetic else ([], []))
    all_facts = facts + s_facts
    all_questions = questions + s_questions
    if args.limit:
        # garde toujours 2 questions sans réponse
        unans = [q for q in all_questions if q["gold"] is None][:2]
        rest = [q for q in all_questions if q["gold"] is not None][: max(1, args.limit - 2)]
        all_questions = rest + unans
    items = interleave(all_facts, make_distractors(scale, seed), seed)
    print(f"\n--- bruit={scale} graine={seed} : {len(items)} souvenirs, {len(all_questions)} questions ---", flush=True)
    eng, node_to_item, _, assigned, write_ms = build_engine(items)
    run = {"scale": scale, "seed": seed, "n_questions": len(all_questions)}
    run["niveau1"] = level1(eng, items, all_questions, node_to_item, assigned, write_ms)
    print_l1(run["niveau1"])
    if model is not None:
        run["niveau2"] = level2(model, eng, items, all_questions, node_to_item, args.configs.split(","), args.k)
        print_l2(run["niveau2"])
    eng.close()
    return run


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--llm", help="id Hugging Face du modèle (active le niveau 2)")
    ap.add_argument("--device-map", default="single", choices=["single", "auto"],
                    help="single = un seul GPU ; auto = répartit sur tous les GPU (gros modèles)")
    ap.add_argument("--scales", default="200", help="quantités de bruit à tester, ex. 100,600")
    ap.add_argument("--seeds", default="0", help="graines, ex. 0,1,2 (résultats moyennés)")
    ap.add_argument("--synthetic", type=int, default=60, help="nombre de cas générés au hasard par graine")
    ap.add_argument("--k", type=int, default=3, help="souvenirs donnés au modèle en config cosmos")
    ap.add_argument("--configs", default="none,full_md,cosmos")
    ap.add_argument("--limit", type=int, default=0, help="limiter le nombre de questions (test rapide)")
    ap.add_argument("--out", default=os.path.join(HERE, "results"))
    args = ap.parse_args()

    data = json.load(open(os.path.join(HERE, "dataset.json"), encoding="utf-8"))
    scales = [int(x) for x in args.scales.split(",")]
    seeds = [int(x) for x in args.seeds.split(",")]

    model = None
    if args.llm:
        print(f"Chargement du modèle {args.llm}...", flush=True)
        model = HFModel(args.llm, args.device_map)

    os.makedirs(args.out, exist_ok=True)
    slug = (args.llm or "niveau1").replace("/", "__")
    path = os.path.join(args.out, f"{slug}.json")

    def save(runs, partial):
        report = {"date": datetime.now().isoformat(timespec="seconds"), "model": args.llm, "args": vars(args),
                  "partial": partial, "dtype": getattr(model, "dtype", None),
                  "summary": summarize(runs), "runs": runs}
        json.dump(report, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    runs = []
    for scale in scales:
        for seed in seeds:
            runs.append(run_one(scale, seed, args, data["facts"], data["questions"], model))
            save(runs, partial=True)  # sauvegarde après chaque série : un timeout ne perd rien

    save(runs, partial=False)
    print_summary(summarize(runs))
    print(f"Résultats : {path}")


if __name__ == "__main__":
    main()
