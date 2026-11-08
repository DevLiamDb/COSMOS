"""
Rapport complet du benchmark COSMOS : graphiques, tableaux, HTML, CSV, zip.

  python -m benchmark.report [--results benchmark/results] [--zip benchmark-cosmos.zip]

Lit les JSON écrits par run.py / run_all.py. Tolère les données manquantes
(modèle en échec, résultats partiels) : ce qui ne peut pas être tracé est
signalé dans le rapport au lieu de tout faire planter.
"""

import argparse
import base64
import glob
import html
import json
import math
import os
import shutil
import zipfile
from datetime import datetime

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CFG_ORDER = ["none", "full_md", "cosmos"]
CFG_LABEL = {"none": "Sans mémoire", "full_md": "Gros .md complet", "cosmos": "COSMOS (top-3)"}
CFG_COLOR = {"none": "#9aa0a6", "full_md": "#e8872b", "cosmos": "#2f6fdb"}
KINDS = ["direct", "paraphrase", "update", "history", "unanswerable"]
KIND_LABEL = {"direct": "directe", "paraphrase": "reformulée", "update": "mise à jour",
              "history": "historique", "unanswerable": "sans réponse"}
SKIP_JSON = {"meta.json", "run_status.json"}
MODEL_ORDER = ["Qwen/Qwen3-0.6B", "Qwen/Qwen3-1.7B", "Qwen/Qwen3.5-2B", "ibm-granite/granite-3.3-2b-instruct",
               "unsloth/Llama-3.2-3B-Instruct", "HuggingFaceTB/SmolLM3-3B", "microsoft/Phi-4-mini-instruct",
               "Qwen/Qwen3-4B-Instruct-2507", "unsloth/gemma-3-4b-it", "Qwen/Qwen3.5-4B", "Qwen/Qwen3-8B",
               "unsloth/Llama-3.1-8B-Instruct", "ibm-granite/granite-3.3-8b-instruct", "Qwen/Qwen3.5-9B"]


# ------------------------------------------------------------------ chargement
def load(results):
    models, rows, l1 = {}, [], None
    reps = []
    for path in sorted(glob.glob(os.path.join(results, "*.json"))):
        if os.path.basename(path) in SKIP_JSON:
            continue
        try:
            rep = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if "runs" not in rep:
            continue
        if not rep.get("model"):
            l1 = rep  # balayage retrieval seul (sans IA)
            continue
        reps.append(rep)
    reps.sort(key=lambda r: (MODEL_ORDER.index(r["model"]) if r["model"] in MODEL_ORDER else 99, r["model"]))
    for rep in reps:
        models[rep["model"]] = rep
        for run in rep["runs"]:
            for cfg, m in (run.get("niveau2") or {}).items():
                for r in m["details"]:
                    rows.append({"model": rep["model"], "scale": run["scale"], "seed": run["seed"], "config": cfg,
                                 "id": r.get("id"), "kind": r.get("kind"), "question": r.get("question", ""),
                                 "answer": r.get("answer", ""), "ok": bool(r.get("ok")),
                                 "prompt_tokens": r.get("prompt_tokens"), "sec": r.get("sec")})
    df = pd.DataFrame(rows, columns=["model", "scale", "seed", "config", "id", "kind", "question", "answer", "ok",
                                     "prompt_tokens", "sec"])
    return models, df, l1


def wilson(k, n, z=1.96):
    if n == 0:
        return float("nan"), float("nan"), float("nan")
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return p, max(0.0, c - h), min(1.0, c + h)


def rate(df, model, scale, cfg, kinds=None, exclude=None):
    d = df[(df.model == model) & (df.scale == scale) & (df.config == cfg)]
    if kinds is not None:
        d = d[d.kind.isin(kinds)]
    if exclude is not None:
        d = d[~d.kind.isin(exclude)]
    return int(d.ok.sum()), len(d)


def pct(x, nd=1):
    return "n/a" if x is None or x != x else f"{100 * x:.{nd}f}%"


def fmt_ci(k, n):
    p, lo, hi = wilson(k, n)
    return "n/a" if n == 0 else f"{100 * p:.0f}% [{100 * lo:.0f}–{100 * hi:.0f}]"


# ------------------------------------------------------------------- tableaux
def build_tables(df):
    """Tous les tableaux sous forme de DataFrame prêts à afficher / exporter."""
    t = {}
    if df.empty:
        return t
    models = list(df.model.unique())
    scales = sorted(df.scale.unique())
    acc_rows, kind_rows = [], []
    for m in models:
        for s in scales:
            for c in CFG_ORDER:
                k, n = rate(df, m, s, c, exclude=["unanswerable"])
                ka, na = rate(df, m, s, c, kinds=["unanswerable"])
                ku, nu = rate(df, m, s, c, kinds=["update"])
                if n == 0:
                    continue
                d = df[(df.model == m) & (df.scale == s) & (df.config == c)]
                p, lo, hi = wilson(k, n)
                acc_rows.append({"model": m, "scale": s, "config": c, "n_questions": n, "n_correct": k,
                                 "accuracy": p, "ci_low": lo, "ci_high": hi,
                                 "abstention": ka / na if na else float("nan"), "update_acc": ku / nu if nu else float("nan"),
                                 "prompt_tokens": d.prompt_tokens.mean(), "sec_per_answer": d.sec.mean()})
                for kd in KINDS:
                    kk, nn = rate(df, m, s, c, kinds=[kd])
                    if nn:
                        kind_rows.append({"model": m, "scale": s, "config": c, "kind": kd, "n": nn, "accuracy": kk / nn})
    t["accuracy"] = pd.DataFrame(acc_rows)
    t["by_kind"] = pd.DataFrame(kind_rows)
    return t


def verdicts(acc, scale):
    """Une phrase par modèle : COSMOS vs gros .md, avec test de significativité simple."""
    out = []
    for m in acc.model.unique():
        c = acc[(acc.model == m) & (acc.scale == scale) & (acc.config == "cosmos")]
        f = acc[(acc.model == m) & (acc.scale == scale) & (acc.config == "full_md")]
        if c.empty or f.empty:
            continue
        c, f = c.iloc[0], f.iloc[0]
        d = c.accuracy - f.accuracy
        hc, hf = (c.ci_high - c.ci_low) / 2, (f.ci_high - f.ci_low) / 2
        signif = abs(d) > math.sqrt(hc ** 2 + hf ** 2)
        saving = f.prompt_tokens / c.prompt_tokens if c.prompt_tokens else float("nan")
        if signif and d > 0:
            word = "COSMOS meilleur"
        elif signif and d < 0:
            word = "gros .md meilleur"
        else:
            word = "équivalent (écart non significatif)"
        out.append({"model": m, "delta": d, "word": word, "saving": saving, "cosmos": c.accuracy, "full_md": f.accuracy,
                    "half": math.sqrt(hc ** 2 + hf ** 2)})
    return out


# ------------------------------------------------------------------ graphiques
def style_ax(ax, grid_axis="y"):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.grid(axis=grid_axis, alpha=0.25)
    ax.set_axisbelow(True)


def logx(ax, xs):
    """Axe x logarithmique avec de vraies valeurs (50, 100, 200...) au lieu de 5×10¹."""
    ax.set_xscale("log")
    ax.set_xticks(xs)
    ax.set_xticklabels([str(x) for x in xs])
    ax.minorticks_off()


def short(m):
    return m.split("/")[-1]


def save_fig(fig, charts_dir, name):
    path = os.path.join(charts_dir, name)
    fig.savefig(path, dpi=140, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return path


def chart_accuracy_by_model(df, acc, charts_dir):
    scales = sorted(acc.scale.unique())
    models = list(acc.model.unique())
    fig, axes = plt.subplots(len(scales), 1, figsize=(max(9, 1.0 * len(models) + 3), 3.9 * len(scales)),
                             sharey=True, squeeze=False)
    w = 0.26
    for ax, s in zip(axes[:, 0], scales):
        for j, c in enumerate(CFG_ORDER):
            xs, ys, lo, hi = [], [], [], []
            for i, m in enumerate(models):
                r = acc[(acc.model == m) & (acc.scale == s) & (acc.config == c)]
                if r.empty:
                    continue
                r = r.iloc[0]
                xs.append(i + (j - 1) * w)
                ys.append(r.accuracy * 100)
                lo.append((r.accuracy - r.ci_low) * 100)
                hi.append((r.ci_high - r.accuracy) * 100)
            ax.bar(xs, ys, w, yerr=[lo, hi], color=CFG_COLOR[c], label=CFG_LABEL[c], capsize=2,
                   error_kw={"elinewidth": 1, "alpha": 0.7})
            for x, y in zip(xs, ys):
                ax.text(x, y + 3, f"{y:.0f}", ha="center", va="bottom", fontsize=7)
        ax.set_xticks(range(len(models)))
        ax.set_xticklabels([short(m) for m in models], rotation=30, ha="right", fontsize=8)
        ax.set_title(f"Bruit = {s} souvenirs", fontsize=10)
        ax.set_ylim(0, 112)
        style_ax(ax)
    for ax in axes[:, 0]:
        ax.set_ylabel("Bonnes réponses (%)", fontsize=9)
    axes[0][0].legend(fontsize=8, loc="upper left", frameon=False, ncol=3)
    fig.suptitle("Justesse sur les questions avec réponse  (barres d'erreur = intervalle à 95 %)", fontsize=12, y=1.0)
    fig.tight_layout()
    return save_fig(fig, charts_dir, "01_justesse_par_modele.png")


def chart_accuracy_vs_noise(df, acc, charts_dir):
    models = list(acc.model.unique())
    cols = min(3, len(models))
    rows_n = math.ceil(len(models) / cols)
    fig, axes = plt.subplots(rows_n, cols, figsize=(4.6 * cols, 3.4 * rows_n), sharey=True, squeeze=False)
    for ax, m in zip(axes.flat, models):
        for c in CFG_ORDER:
            r = acc[(acc.model == m) & (acc.config == c)].sort_values("scale")
            if r.empty:
                continue
            ax.plot(r.scale, r.accuracy * 100, "-o", color=CFG_COLOR[c], label=CFG_LABEL[c], lw=2, ms=5)
            ax.fill_between(r.scale, r.ci_low * 100, r.ci_high * 100, color=CFG_COLOR[c], alpha=0.15)
        ax.set_title(short(m), fontsize=10)
        ax.set_xlabel("souvenirs de bruit")
        ax.set_ylim(0, 105)
        style_ax(ax, "both")
    for ax in list(axes.flat)[len(models):]:
        ax.axis("off")
    axes[0][0].set_ylabel("Bonnes réponses (%)")
    axes[0][0].legend(fontsize=8, frameon=False, loc="lower left")
    fig.suptitle("Que se passe-t-il quand la mémoire grossit ?", fontsize=12, y=1.01)
    fig.tight_layout()
    return save_fig(fig, charts_dir, "02_justesse_selon_le_bruit.png")


def chart_tokens(acc, charts_dir):
    scales = sorted(acc.scale.unique())
    models = list(acc.model.unique())
    fig, axes = plt.subplots(len(scales), 1, figsize=(max(9, 1.0 * len(models) + 3), 3.6 * len(scales)),
                             sharey=True, squeeze=False)
    w = 0.27
    for ax, s in zip(axes[:, 0], scales):
        for j, c in enumerate(CFG_ORDER):
            xs, ys = [], []
            for i, m in enumerate(models):
                r = acc[(acc.model == m) & (acc.scale == s) & (acc.config == c)]
                if not r.empty:
                    xs.append(i + (j - 1) * w)
                    ys.append(r.iloc[0].prompt_tokens)
            ax.bar(xs, ys, w, color=CFG_COLOR[c], label=CFG_LABEL[c])
            for x, y in zip(xs, ys):
                ax.text(x, y * 1.08, f"{y:.0f}", ha="center", fontsize=7)
        ax.set_yscale("log")
        ax.set_xticks(range(len(models)))
        ax.set_xticklabels([short(m) for m in models], rotation=30, ha="right", fontsize=8)
        ax.set_title(f"Bruit = {s} souvenirs", fontsize=10)
        style_ax(ax)
    for ax in axes[:, 0]:
        ax.set_ylabel("Tokens (échelle log)", fontsize=9)
    axes[0][0].legend(fontsize=8, frameon=False, loc="upper left", ncol=3)
    fig.suptitle("Coût en tokens envoyés au modèle, par question", fontsize=12, y=1.0)
    fig.tight_layout()
    return save_fig(fig, charts_dir, "03_cout_en_tokens.png")


def chart_delta(acc, charts_dir):
    labels, vals, errs = [], [], []
    for s in sorted(acc.scale.unique()):
        for v in verdicts(acc, s):
            labels.append(f"{short(v['model'])}  (bruit {s})")
            vals.append(v["delta"] * 100)
            errs.append(v["half"] * 100)
    if not labels:
        return None
    fig, ax = plt.subplots(figsize=(8, max(3, 0.34 * len(labels) + 1.2)))
    y = np.arange(len(labels))
    ax.barh(y, vals, xerr=errs, color=[CFG_COLOR["cosmos"] if v >= 0 else CFG_COLOR["full_md"] for v in vals],
            capsize=2, error_kw={"elinewidth": 1, "alpha": 0.7})
    ax.axvline(0, color="black", lw=0.8)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=8)
    ax.invert_yaxis()
    ax.set_xlabel("Écart de justesse : COSMOS − gros .md  (points de %)   → droite = COSMOS meilleur")
    ax.set_title("COSMOS contre un gros fichier .md complet", fontsize=11)
    style_ax(ax, "x")
    return save_fig(fig, charts_dir, "04_cosmos_contre_gros_md.png")


def heat(ax, mat, rows, cols, title):
    arr = np.array(mat, dtype=float)
    im = ax.imshow(arr, vmin=0, vmax=1, cmap="RdYlGn", aspect="auto")
    ax.set_xticks(range(len(cols)))
    ax.set_xticklabels(cols, rotation=30, ha="right", fontsize=8)
    ax.set_yticks(range(len(rows)))
    ax.set_yticklabels(rows, fontsize=8)
    for i in range(arr.shape[0]):
        for j in range(arr.shape[1]):
            v = arr[i, j]
            dark = v == v and (v < 0.2 or v > 0.85)
            ax.text(j, i, "–" if v != v else f"{100 * v:.0f}", ha="center", va="center", fontsize=8,
                    color="white" if dark else "black")
    ax.set_title(title, fontsize=10)
    return im


def chart_by_kind(by_kind, charts_dir):
    s = by_kind.scale.max()
    models = list(by_kind.model.unique())
    kinds = [k for k in KINDS if k in set(by_kind.kind)]
    fig, axes = plt.subplots(1, 3, figsize=(4.4 * 3, 0.55 * len(models) + 2.2), squeeze=False)
    for ax, c in zip(axes[0], CFG_ORDER):
        mat = []
        for m in models:
            row = []
            for k in kinds:
                r = by_kind[(by_kind.model == m) & (by_kind.scale == s) & (by_kind.config == c) & (by_kind.kind == k)]
                row.append(r.iloc[0].accuracy if not r.empty else float("nan"))
            mat.append(row)
        heat(ax, mat, [short(m) for m in models], [KIND_LABEL[k] for k in kinds], CFG_LABEL[c])
        if c != CFG_ORDER[0]:
            ax.set_yticklabels([])
    fig.suptitle(f"Justesse (%) par type de question — bruit = {s} souvenirs", fontsize=12, y=1.02)
    fig.tight_layout()
    return save_fig(fig, charts_dir, "05_justesse_par_type_de_question.png")


def chart_speed(acc, charts_dir):
    s = acc.scale.max()
    models = list(acc.model.unique())
    fig, ax = plt.subplots(figsize=(max(6, 1.6 * len(models)), 4))
    w = 0.27
    for j, c in enumerate(CFG_ORDER):
        xs, ys = [], []
        for i, m in enumerate(models):
            r = acc[(acc.model == m) & (acc.scale == s) & (acc.config == c)]
            if not r.empty:
                xs.append(i + (j - 1) * w)
                ys.append(r.iloc[0].sec_per_answer)
        ax.bar(xs, ys, w, color=CFG_COLOR[c], label=CFG_LABEL[c])
        for x, y in zip(xs, ys):
            ax.text(x, y, f"{y:.1f}", ha="center", va="bottom", fontsize=7)
    ax.set_xticks(range(len(models)))
    ax.set_xticklabels([short(m) for m in models], rotation=30, ha="right", fontsize=8)
    ax.set_ylabel("secondes par réponse")
    ax.set_title(f"Temps de réponse — bruit = {s} souvenirs", fontsize=11)
    ax.legend(frameon=False, fontsize=8)
    style_ax(ax)
    return save_fig(fig, charts_dir, "06_temps_de_reponse.png")


def chart_retrieval(l1, charts_dir):
    summ = l1.get("summary") or {}
    scales = sorted(summ, key=lambda x: int(x))
    if not scales:
        return []
    xs = [int(s) for s in scales]

    def series(key):
        m = [summ[s]["niveau1"][key][0] if summ[s]["niveau1"].get(key) else float("nan") for s in scales]
        sd = [summ[s]["niveau1"][key][1] if summ[s]["niveau1"].get(key) else 0 for s in scales]
        return np.array(m), np.array(sd)

    paths = []
    fig, axes = plt.subplots(1, 2, figsize=(11, 4), sharex=True)
    for key, lab, col, ls in (("recall@1", "recall@1", "#2f6fdb", "-"), ("recall@3", "recall@3", "#1b9e77", "--"),
                              ("recall@5", "recall@5", "#7570b3", ":"), ("mrr", "MRR (×100)", "#555555", "-")):
        m, sd = series(key)
        if key == "mrr":
            m, sd = m, sd
        axes[0].plot(xs, m * 100, ls, marker="o", label=lab, color=col, lw=2, ms=4)
        axes[0].fill_between(xs, (m - sd) * 100, (m + sd) * 100, color=col, alpha=0.12)
    axes[0].set_ylabel("%")
    axes[0].set_title("Retrouver le bon souvenir", fontsize=10)
    for key, lab, col in (("update_acc", "mise à jour (récent avant ancien)", "#d95f02"),
                          ("abstention_best_acc", "détection « pas de réponse »", "#66a61e"),
                          ("categorisation_acc", "catégorie automatique", "#e7298a")):
        m, sd = series(key)
        axes[1].plot(xs, m * 100, "-o", label=lab, color=col, lw=2, ms=4)
        axes[1].fill_between(xs, (m - sd) * 100, (m + sd) * 100, color=col, alpha=0.12)
    axes[1].set_title("Autres capacités de COSMOS", fontsize=10)
    for ax in axes:
        logx(ax, xs)
        ax.set_xlabel("souvenirs de bruit (échelle log)")
        ax.set_ylim(0, 105)
        ax.legend(fontsize=8, frameon=False, loc="lower left")
        style_ax(ax, "both")
    fig.suptitle("COSMOS seul (sans IA) quand la mémoire grossit", fontsize=12, y=1.02)
    paths.append(save_fig(fig, charts_dir, "07_retrieval_selon_le_bruit.png"))

    fig, axes = plt.subplots(1, 2, figsize=(11, 3.6))
    for key, lab, col in (("latence_query_ms_med", "recherche", "#2f6fdb"),):
        m, _ = series(key)
        axes[0].plot(xs, m, "-o", color=col, label=lab)
    axes[0].set_title("Latence médiane d'une recherche (ms)", fontsize=10)
    m, _ = series("tokens_estimes_full_md")
    axes[1].plot(xs, m, "-o", color=CFG_COLOR["full_md"], label="gros .md complet")
    axes[1].axhline(170, color=CFG_COLOR["cosmos"], ls="--", label="COSMOS (≈ 3 souvenirs)")
    axes[1].set_title("Taille du gros .md (tokens, estimation)", fontsize=10)
    for ax in axes:
        logx(ax, xs)
        ax.set_xlabel("souvenirs de bruit")
        ax.legend(fontsize=8, frameon=False)
        style_ax(ax, "both")
    paths.append(save_fig(fig, charts_dir, "08_latence_et_taille.png"))
    return paths


# ------------------------------------------------------------------- sorties
def md_table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def leaderboard_rows(acc, scale):
    rows = []
    for m in acc.model.unique():
        cell = {}
        for c in CFG_ORDER:
            r = acc[(acc.model == m) & (acc.scale == scale) & (acc.config == c)]
            cell[c] = r.iloc[0] if not r.empty else None
        if cell["cosmos"] is None:
            continue
        cs, fm, no = cell["cosmos"], cell["full_md"], cell["none"]
        rows.append({
            "model": m, "cosmos": cs.accuracy, "full_md": fm.accuracy if fm is not None else float("nan"),
            "none": no.accuracy if no is not None else float("nan"),
            "cosmos_txt": fmt_ci(cs.n_correct, cs.n_questions),
            "full_txt": fmt_ci(fm.n_correct, fm.n_questions) if fm is not None else "n/a",
            "none_txt": fmt_ci(no.n_correct, no.n_questions) if no is not None else "n/a",
            "abst_c": cs.abstention, "abst_f": fm.abstention if fm is not None else float("nan"),
            "upd_c": cs.update_acc, "upd_f": fm.update_acc if fm is not None else float("nan"),
            "tok_c": cs.prompt_tokens, "tok_f": fm.prompt_tokens if fm is not None else float("nan"),
            "sec_c": cs.sec_per_answer, "sec_f": fm.sec_per_answer if fm is not None else float("nan"),
        })
    rows.sort(key=lambda r: -(r["cosmos"] if r["cosmos"] == r["cosmos"] else -1))
    return rows


def html_page(sections, title):
    css = """
:root{--bg:#fff;--fg:#1f2328;--mut:#656d76;--card:#f6f8fa;--bd:#d0d7de;--ac:#2f6fdb;--ok:#1a7f37;--ko:#cf222e}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#8b949e;--card:#161b22;--bd:#30363d;--ac:#58a6ff;--ok:#3fb950;--ko:#f85149}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,Segoe UI,Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 80px}h1{font-size:28px;margin:0 0 4px}h2{font-size:21px;margin:38px 0 10px;
border-bottom:1px solid var(--bd);padding-bottom:6px}h3{font-size:16px;margin:22px 0 6px}p,li{max-width:80ch}.mut{color:var(--mut)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:14px 0}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px 14px}.card b{display:block;font-size:26px}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13.5px}th,td{border:1px solid var(--bd);padding:5px 8px;text-align:left}
th{background:var(--card)}td.num{text-align:right;font-variant-numeric:tabular-nums}.best{font-weight:700;color:var(--ok)}
.scroll{overflow-x:auto}img{max-width:100%;height:auto;border:1px solid var(--bd);border-radius:8px;background:#fff;margin:6px 0}
code{background:var(--card);padding:1px 5px;border-radius:4px}.warn{border-left:4px solid var(--ko);padding:6px 12px;background:var(--card)}
"""
    body = "\n".join(sections)
    return (f"<!doctype html><html lang='fr'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,"
            f"initial-scale=1'><title>{html.escape(title)}</title><style>{css}</style></head><body><main>{body}</main></body></html>")


def img_tag(path, alt):
    data = base64.b64encode(open(path, "rb").read()).decode()
    return f"<img alt='{html.escape(alt)}' src='data:image/png;base64,{data}'>"


def table_html(headers, rows, num_cols=(), best=None):
    """rows : liste de listes de chaînes. best : set de (ligne, colonne) à mettre en gras vert."""
    best = best or set()
    h = "".join(f"<th>{html.escape(x)}</th>" for x in headers)
    trs = []
    for i, r in enumerate(rows):
        tds = "".join(f"<td class='{'num ' if j in num_cols else ''}{'best' if (i, j) in best else ''}'>{html.escape(str(c))}</td>"
                      for j, c in enumerate(r))
        trs.append(f"<tr>{tds}</tr>")
    return f"<div class='scroll'><table><tr>{h}</tr>{''.join(trs)}</table></div>"


def build_report(results, zip_path=None, out_dir=None):
    out_dir = out_dir or results
    charts_dir = os.path.join(out_dir, "charts")
    tables_dir = os.path.join(out_dir, "tables")
    os.makedirs(charts_dir, exist_ok=True)
    os.makedirs(tables_dir, exist_ok=True)
    models, df, l1 = load(results)
    meta = json.load(open(os.path.join(results, "meta.json"), encoding="utf-8")) if os.path.exists(os.path.join(results, "meta.json")) else {}
    status = json.load(open(os.path.join(results, "run_status.json"), encoding="utf-8")) if os.path.exists(os.path.join(results, "run_status.json")) else []
    problems = []
    tables = build_tables(df)
    acc = tables.get("accuracy", pd.DataFrame())
    charts = {}

    def safe(name, fn, *a):
        try:
            res = fn(*a)
            charts[name] = res
        except Exception as e:  # noqa: BLE001
            problems.append(f"graphique {name} : {type(e).__name__}: {e}")
            plt.close("all")

    if not acc.empty:
        safe("accuracy", chart_accuracy_by_model, df, acc, charts_dir)
        safe("noise", chart_accuracy_vs_noise, df, acc, charts_dir)
        safe("tokens", chart_tokens, acc, charts_dir)
        safe("delta", chart_delta, acc, charts_dir)
        safe("kind", chart_by_kind, tables["by_kind"], charts_dir)
        safe("speed", chart_speed, acc, charts_dir)
    if l1:
        safe("retrieval", chart_retrieval, l1, charts_dir)

    # ---------- CSV
    if not acc.empty:
        acc.to_csv(os.path.join(tables_dir, "justesse_par_modele.csv"), index=False, encoding="utf-8-sig")
        tables["by_kind"].to_csv(os.path.join(tables_dir, "justesse_par_type.csv"), index=False, encoding="utf-8-sig")
        df.to_csv(os.path.join(tables_dir, "toutes_les_reponses.csv"), index=False, encoding="utf-8-sig")
    if l1:
        rows = []
        for s, e in (l1.get("summary") or {}).items():
            row = {"bruit": int(s), "n_souvenirs": e["n_souvenirs"], "n_questions": e["n_questions"], "graines": len(e["seeds"])}
            for k, v in e["niveau1"].items():
                row[k] = v[0] if v else None
                row[k + "_std"] = v[1] if v else None
            rows.append(row)
        pd.DataFrame(rows).sort_values("bruit").to_csv(os.path.join(tables_dir, "retrieval_sans_ia.csv"), index=False, encoding="utf-8-sig")

    # ---------- texte : verdict, tableaux
    sections, md = [], []
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    sections.append(f"<h1>Benchmark mémoire COSMOS</h1><p class='mut'>Rapport généré le {now}</p>")
    md.append(f"# Benchmark mémoire COSMOS\n\nRapport généré le {now}\n")

    if not acc.empty:
        big = int(acc.scale.max())
        vs = verdicts(acc, big)
        board = leaderboard_rows(acc, big)
        mean_delta = np.mean([v["delta"] for v in vs]) if vs else float("nan")
        mean_save = np.nanmean([v["saving"] for v in vs]) if vs else float("nan")
        n_better = sum(v["word"] == "COSMOS meilleur" for v in vs)
        n_equal = sum(v["word"].startswith("équivalent") for v in vs)
        n_worse = sum(v["word"] == "gros .md meilleur" for v in vs)
        cards = [("Modèles testés", str(len(models))), ("Questions par série", str(int(acc.n_questions.max()))),
                 (f"Écart COSMOS − gros .md (bruit {big})", f"{100 * mean_delta:+.1f} pts"),
                 ("Tokens économisés", f"× {mean_save:.1f}")]
        sections.append("<div class='cards'>" + "".join(f"<div class='card'><span class='mut'>{html.escape(a)}</span><b>{html.escape(b)}</b></div>" for a, b in cards) + "</div>")
        summary_txt = (f"Avec {big} souvenirs de bruit, COSMOS est meilleur que le gros .md sur {n_better} modèle(s), équivalent sur "
                       f"{n_equal}, moins bon sur {n_worse}. Il envoie environ {mean_save:.1f} fois moins de tokens au modèle.")
        sections.append(f"<h2>Résumé</h2><p><b>{html.escape(summary_txt)}</b></p>")
        md.append(f"## Résumé\n\n**{summary_txt}**\n")
        sections.append("<p class='mut'>« Équivalent » veut dire que l'écart est plus petit que l'incertitude statistique (intervalle de confiance à 95 %). "
                        "Quand c'est le cas, on ne peut pas dire lequel des deux est meilleur avec ces données.</p>")

        # graphiques principaux
        for key, title, comment in (
            ("delta", "COSMOS contre un gros fichier .md", "Chaque barre = écart de justesse. À droite de 0, COSMOS gagne. La barre d'erreur est l'incertitude."),
            ("accuracy", "Justesse par modèle", "Pourcentage de bonnes réponses sur les questions dont la réponse est dans la mémoire."),
            ("noise", "Quand la mémoire grossit", "Si le gros .md baisse avec plus de bruit alors que COSMOS tient, c'est l'avantage de COSMOS."),
            ("tokens", "Coût en tokens", "Nombre de tokens envoyés au modèle à chaque question (échelle logarithmique)."),
            ("kind", "Par type de question", "Où COSMOS réussit ou échoue : question directe, reformulée, mise à jour d'un fait, historique, ou sans réponse."),
            ("speed", "Temps de réponse", "Plus le prompt est long, plus la réponse est lente.")):
            if charts.get(key):
                sections.append(f"<h2>{title}</h2><p>{comment}</p>{img_tag(charts[key], title)}")

        # classement
        sections.append(f"<h2>Classement (bruit = {big} souvenirs)</h2><p class='mut'>Trié par justesse de COSMOS. Entre crochets : intervalle de confiance à 95 %.</p>")
        hdr = ["Modèle", "COSMOS", "Gros .md", "Sans mémoire", "Verdict", "Tokens COSMOS", "Tokens .md", "Économie", "Abstention COSMOS / .md", "Maj. COSMOS / .md", "s/réponse COSMOS / .md"]
        vmap = {v["model"]: v for v in vs}
        trs, best = [], set()
        for i, r in enumerate(board):
            v = vmap.get(r["model"])
            trs.append([short(r["model"]), r["cosmos_txt"], r["full_txt"], r["none_txt"], v["word"] if v else "n/a",
                        f"{r['tok_c']:.0f}", f"{r['tok_f']:.0f}", f"× {v['saving']:.1f}" if v else "n/a",
                        f"{pct(r['abst_c'], 0)} / {pct(r['abst_f'], 0)}", f"{pct(r['upd_c'], 0)} / {pct(r['upd_f'], 0)}",
                        f"{r['sec_c']:.1f} / {r['sec_f']:.1f}"])
            if r["cosmos"] >= r["full_md"] or r["full_md"] != r["full_md"]:
                best.add((i, 1))
            else:
                best.add((i, 2))
        sections.append(table_html(hdr, trs, num_cols=range(5, 11), best=best))
        md.append(f"## Classement (bruit = {big} souvenirs)\n\n" + md_table(hdr, trs) + "\n")

        # tous les niveaux de bruit
        sections.append("<h2>Tous les niveaux de bruit</h2>")
        for s in sorted(acc.scale.unique()):
            rows_s = leaderboard_rows(acc, int(s))
            hdr2 = ["Modèle", "COSMOS", "Gros .md", "Sans mémoire", "Tokens COSMOS", "Tokens .md"]
            t2 = [[short(r["model"]), r["cosmos_txt"], r["full_txt"], r["none_txt"], f"{r['tok_c']:.0f}", f"{r['tok_f']:.0f}"] for r in rows_s]
            sections.append(f"<h3>Bruit = {int(s)} souvenirs</h3>" + table_html(hdr2, t2, num_cols=(4, 5)))
            md.append(f"### Bruit = {int(s)}\n\n" + md_table(hdr2, t2) + "\n")

        # par type de question
        bk = tables["by_kind"]
        sections.append(f"<h2>Détail par type de question (bruit = {big})</h2>")
        kinds = [k for k in KINDS if k in set(bk.kind)]
        hdr3 = ["Modèle", "Config"] + [KIND_LABEL[k] for k in kinds]
        t3 = []
        for m in acc.model.unique():
            for c in ("cosmos", "full_md"):
                row = [short(m), CFG_LABEL[c]]
                for k in kinds:
                    r = bk[(bk.model == m) & (bk.scale == big) & (bk.config == c) & (bk.kind == k)]
                    row.append(pct(r.iloc[0].accuracy, 0) if not r.empty else "–")
                t3.append(row)
        sections.append(table_html(hdr3, t3, num_cols=range(2, 2 + len(kinds))))

        # questions les plus ratées
        d = df[(df.scale == big) & df.id.fillna("").str.match(r"^q\d+$")]
        if not d.empty:
            miss = []
            for qid, g in d.groupby("id"):
                fc = 1 - g[g.config == "cosmos"].ok.mean() if (g.config == "cosmos").any() else float("nan")
                ff = 1 - g[g.config == "full_md"].ok.mean() if (g.config == "full_md").any() else float("nan")
                bad = g[(g.config == "cosmos") & (~g.ok)]
                ex = str(bad.iloc[0].answer)[:80] if not bad.empty else ""
                miss.append((fc, ff, qid, g.iloc[0].question, ex))
            miss.sort(key=lambda t: -(t[0] if t[0] == t[0] else 0))
            t4 = [[qid, q, pct(fc, 0), pct(ff, 0), ex] for fc, ff, qid, q, ex in miss[:15] if fc == fc and fc > 0]
            if t4:
                sections.append("<h2>Questions les plus ratées par COSMOS</h2><p class='mut'>Questions écrites à la main, taux d'échec sur tous les modèles et toutes les graines.</p>"
                                + table_html(["Id", "Question", "Échec COSMOS", "Échec .md", "Exemple de réponse fausse (COSMOS)"], t4))

    # retrieval
    if charts.get("retrieval"):
        sections.append("<h2>COSMOS seul, sans IA (retrieval)</h2><p>Mesure la qualité de la recherche pure : le bon souvenir est-il dans les premiers résultats ? "
                        "Plus il y a de bruit, plus c'est difficile.</p>")
        for p in charts["retrieval"]:
            sections.append(img_tag(p, "retrieval"))
        rows = []
        for s, e in sorted((l1.get("summary") or {}).items(), key=lambda kv: int(kv[0])):
            n1 = e["niveau1"]
            f = lambda k: pct(n1[k][0], 1) if n1.get(k) else "n/a"  # noqa: E731
            rows.append([s, e["n_souvenirs"], f("recall@1"), f("recall@3"), f("recall@5"), f"{n1['mrr'][0]:.3f}", f("update_acc"), f("abstention_best_acc"), f("categorisation_acc"), f"{n1['latence_query_ms_med'][0]:.1f} ms"])
        hdr5 = ["Bruit", "Souvenirs", "recall@1", "recall@3", "recall@5", "MRR", "Mises à jour", "Abstention", "Catégorie auto", "Latence recherche"]
        sections.append(table_html(hdr5, rows, num_cols=range(0, 10)))
        md.append("## COSMOS seul (sans IA)\n\n" + md_table(hdr5, rows) + "\n")

    # exécution et environnement
    if status:
        sections.append("<h2>Exécution</h2>" + table_html(["Modèle", "Statut", "Minutes", "Détail"],
                        [[s["model"], "OK" if s["ok"] else "ÉCHEC", s["minutes"], s.get("reason", "")] for s in status], num_cols=(2,)))
    if meta:
        sections.append("<h2>Environnement</h2>" + table_html(["Clé", "Valeur"], [[k, json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v] for k, v in meta.items()]))
    if problems:
        sections.append("<h2>Avertissements</h2><div class='warn'>" + "<br>".join(html.escape(p) for p in problems) + "</div>")
    if acc.empty and not l1:
        sections.append("<div class='warn'>Aucun résultat exploitable trouvé dans le dossier de résultats.</div>")

    sections.append("""<h2>Méthode</h2><ul>
<li><b>Données :</b> 30 souvenirs écrits à la main, 38 questions, plus des cas générés au hasard à chaque graine (personnes et valeurs inventées : le modèle ne peut pas répondre grâce à ses connaissances), plus du bruit (faits sans rapport).</li>
<li><b>Trois mémoires comparées :</b> « sans mémoire » ; « gros .md » = tous les souvenirs numérotés collés dans le prompt, dans l'ordre d'écriture ; « COSMOS » = seulement les 3 souvenirs les plus proches de la question, remis dans l'ordre d'écriture.</li>
<li><b>Notation :</b> une réponse est juste si elle contient le ou les mots attendus (accents et majuscules ignorés). Pour les questions sans réponse, le modèle doit dire qu'il ne sait pas.</li>
<li><b>Fiabilité :</b> plusieurs graines (jeux de bruit et cas générés différents). Les intervalles à 95 % sont de type Wilson sur l'ensemble des questions ; les questions écrites à la main reviennent à chaque graine, donc l'intervalle est un peu optimiste.</li>
<li><b>Limites :</b> petits modèles (≤ 8 milliards de paramètres), français uniquement, notation par mots-clés, un seul prompt. COSMOS tient compte de la date (le plus récent passe devant, l'ancien est marqué « remplacé ») ; le gros .md reçoit seulement les numéros d'ordre. Le seuil de détection d'un souvenir remplacé (0,75) n'a pas été réglé finement.</li></ul>""")

    html_text = html_page(sections, "Benchmark mémoire COSMOS")
    with open(os.path.join(out_dir, "report.html"), "w", encoding="utf-8") as f:
        f.write(html_text)
    with open(os.path.join(out_dir, "SUMMARY.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + ("\n## Avertissements\n\n" + "\n".join(problems) + "\n" if problems else ""))

    if zip_path:
        make_zip(results, out_dir, zip_path)
    return os.path.join(out_dir, "report.html"), problems


def make_zip(results, out_dir, zip_path):
    readme = ("Benchmark COSMOS\n================\n"
              "report.html        -> ouvre ce fichier d'abord (tableaux + graphiques, tout en un)\n"
              "SUMMARY.md         -> résumé en texte\n"
              "charts/            -> les graphiques en PNG\n"
              "tables/            -> les tableaux en CSV (toutes_les_reponses.csv = chaque réponse de chaque modèle)\n"
              "raw/               -> résultats bruts JSON par modèle\n"
              "logs/              -> journal complet de chaque modèle\n"
              "dataset.json       -> les souvenirs et questions écrits à la main\n"
              "meta.json          -> machine, versions, paramètres\n")
    tmp = zip_path + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("LISEZMOI.txt", readme)
        for name in ("report.html", "SUMMARY.md"):
            p = os.path.join(out_dir, name)
            if os.path.exists(p):
                z.write(p, name)
        for sub in ("charts", "tables"):
            for p in glob.glob(os.path.join(out_dir, sub, "*")):
                z.write(p, f"{sub}/{os.path.basename(p)}")
        for p in glob.glob(os.path.join(results, "*.json")):
            base = os.path.basename(p)
            z.write(p, base if base in SKIP_JSON else f"raw/{base}")
        for p in glob.glob(os.path.join(results, "logs", "*")):
            z.write(p, f"logs/{os.path.basename(p)}")
        for p in glob.glob(os.path.join(results, "smoke", "logs", "*")):
            z.write(p, f"logs/smoke_{os.path.basename(p)}")
        ds = os.path.join(HERE, "dataset.json")
        if os.path.exists(ds):
            z.write(ds, "dataset.json")
    shutil.move(tmp, zip_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default=os.path.join(HERE, "results"))
    ap.add_argument("--zip", help="chemin du zip final, ex. /kaggle/working/benchmark-cosmos.zip")
    args = ap.parse_args()
    path, problems = build_report(args.results, args.zip)
    print(f"Rapport : {path}")
    for p in problems:
        print("AVERTISSEMENT :", p)
    if args.zip:
        print(f"Zip : {args.zip} ({os.path.getsize(args.zip) / 1e6:.1f} Mo)")


if __name__ == "__main__":
    main()
