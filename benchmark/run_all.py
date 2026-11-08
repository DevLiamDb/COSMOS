"""
Lance le benchmark COSMOS sur plusieurs modèles, tout seul (fait pour tourner
en arrière-plan sur Kaggle : "Save Version" -> "Save & Run All").

Déroulé :
  1. Test minuscule (Qwen3-0.6B, quelques questions). S'il échoue, on s'arrête
     tout de suite : pas de GPU gaspillé.
  2. Balayage retrieval seul (sans IA) : de 50 à 1600 souvenirs de bruit.
  3. Modèles petits : deux en parallèle, un par GPU.
  4. Gros modèles (répartis sur tous les GPU), un par un.
  5. Rapport complet (HTML, graphiques, CSV) + benchmark-cosmos.zip.

Un modèle qui plante est noté "échec" et on passe au suivant. Les résultats
sont sauvegardés après chaque série : un timeout ne perd pas tout.
Usage : python -m benchmark.run_all [--budget-hours 8] [--models a,b,c]
"""

import argparse
import json
import os
import platform
import queue
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# 5 familles (Qwen, Google, Microsoft, Meta, Hugging Face), de 1,7 à 8 milliards de paramètres.
# Rangés du plus gros au plus petit : meilleur équilibre entre les deux GPU.
SMALL = [
    "Qwen/Qwen3.5-4B",
    "unsloth/gemma-3-4b-it",  # copie ouverte de google/gemma-3-4b-it (l'original demande une autorisation)
    "Qwen/Qwen3-4B-Instruct-2507",
    "microsoft/Phi-4-mini-instruct",
    "unsloth/Llama-3.2-3B-Instruct",  # copie ouverte de meta-llama/Llama-3.2-3B-Instruct
    "HuggingFaceTB/SmolLM3-3B",
    "Qwen/Qwen3-1.7B",
]
BIG = ["Qwen/Qwen3-8B"]  # réparti sur les 2 GPU
# Disponibles via --models (non lancés par défaut : trop longs)
OPTIONAL_BIG = ["unsloth/Llama-3.1-8B-Instruct", "ibm-granite/granite-3.3-8b-instruct", "Qwen/Qwen3.5-9B"]
SMOKE = "Qwen/Qwen3-0.6B"


def gpu_info():
    try:
        import torch

        n = torch.cuda.device_count()
        return n, [torch.cuda.get_device_name(i) for i in range(n)]
    except Exception:  # noqa: BLE001
        return 0, []


def hf_cache_dir() -> str:
    try:
        from huggingface_hub import constants

        return constants.HF_HUB_CACHE
    except Exception:  # noqa: BLE001
        return os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")


def delete_model_cache(model: str) -> None:
    """Libère le disque (Kaggle : ~57 Go) : les modèles font ~60 Go ensemble."""
    shutil.rmtree(os.path.join(hf_cache_dir(), "models--" + model.replace("/", "--")), ignore_errors=True)


def log_tail(path: str, n: int = 30) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return "".join(f.readlines()[-n:])
    except OSError:
        return "(log illisible)"


def run_cmd(label, cmd, log_path, gpu, timeout_h, cleanup_model=None):
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    env = dict(os.environ)
    if gpu == "none":
        env["CUDA_VISIBLE_DEVICES"] = ""
    elif gpu is not None:
        env["CUDA_VISIBLE_DEVICES"] = str(gpu)
    t0 = time.time()
    print(f"[{datetime.now():%H:%M:%S}] DÉBUT {label} (gpu={gpu if gpu is not None else 'tous'})", flush=True)
    try:
        with open(log_path, "w", encoding="utf-8") as log:
            proc = subprocess.run(cmd, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout_h * 3600)
        ok = proc.returncode == 0
        reason = "" if ok else f"code retour {proc.returncode}"
    except subprocess.TimeoutExpired:
        ok, reason = False, f"timeout > {timeout_h:.1f} h"
    dt = (time.time() - t0) / 60
    print(f"[{datetime.now():%H:%M:%S}] {'OK ' if ok else 'ÉCHEC'} {label} en {dt:.0f} min {reason}", flush=True)
    if not ok:
        print(f"--- fin du log {log_path} ---", flush=True)
        print(log_tail(log_path) + "--- fin ---", flush=True)
    if cleanup_model:
        delete_model_cache(cleanup_model)
    return {"model": label, "ok": ok, "minutes": round(dt, 1), "reason": reason, "log": log_path}


def run_model(model, device_map, gpu, out_dir, extra, timeout_h):
    log_path = os.path.join(out_dir, "logs", model.replace("/", "__") + ".log")
    cmd = [sys.executable, "-m", "benchmark.run", "--llm", model, "--device-map", device_map, "--out", out_dir] + extra
    return run_cmd(model, cmd, log_path, gpu, timeout_h, cleanup_model=model)


def write_meta(out_dir, args, start, gpu_names):
    meta = {"date_debut": datetime.fromtimestamp(start).isoformat(timespec="seconds"),
            "python": sys.version.split()[0], "plateforme": platform.platform(), "gpus": gpu_names or "aucun"}
    for lib in ("torch", "transformers", "fastembed", "numpy", "accelerate"):
        try:
            meta[lib] = __import__(lib).__version__
        except Exception:  # noqa: BLE001
            meta[lib] = "non installé"
    meta["parametres"] = dict(vars(args))
    meta["duree_totale_minutes"] = round((time.time() - start) / 60, 1)
    meta["date_fin"] = datetime.now().isoformat(timespec="seconds")
    json.dump(meta, open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)


def finish(args, statuses, start, gpu_names):
    """Rapport + zip. Ne doit jamais faire planter le run : les résultats bruts sont déjà sauvés."""
    write_meta(args.out, args, start, gpu_names)
    json.dump(statuses, open(os.path.join(args.out, "run_status.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    on_kaggle = os.path.isdir("/kaggle/working")
    zip_path = "/kaggle/working/benchmark-cosmos.zip" if on_kaggle else os.path.join(ROOT, "benchmark-cosmos.zip")
    try:
        from benchmark import report

        html_path, problems = report.build_report(args.out, zip_path)
        for p in problems:
            print("AVERTISSEMENT rapport :", p, flush=True)
        if on_kaggle:
            shutil.copy(html_path, "/kaggle/working/report.html")
    except Exception as e:  # noqa: BLE001
        print(f"Le rapport a échoué ({type(e).__name__}: {e}) : je zippe quand même les résultats bruts.", flush=True)
        shutil.make_archive(zip_path[:-4], "zip", args.out)
    print(f"\nArchive finale : {zip_path}", flush=True)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget-hours", type=float, default=8.0, help="aucun nouveau modèle après ce temps")
    ap.add_argument("--hard-limit-hours", type=float, default=10.5, help="un modèle en cours est coupé à ce temps")
    ap.add_argument("--model-timeout-hours", type=float, default=3.0)
    ap.add_argument("--models", help="liste d'ids séparés par des virgules (remplace la liste par défaut)")
    ap.add_argument("--no-smoke", action="store_true")
    ap.add_argument("--no-level1", action="store_true", help="saute le balayage retrieval sans IA")
    ap.add_argument("--scales", default="100,300,700")
    ap.add_argument("--seeds", default="0,1,2")
    ap.add_argument("--synthetic", default="60")
    ap.add_argument("--limit", default="0")
    ap.add_argument("--out", default=os.path.join(HERE, "results"))
    args = ap.parse_args()

    COMMON = ["--scales", args.scales, "--seeds", args.seeds, "--synthetic", args.synthetic,
              "--limit", args.limit, "--k", "3"]
    os.makedirs(args.out, exist_ok=True)
    start = time.time()
    statuses = []
    n_gpu, gpu_names = gpu_info()
    print(f"GPU détectés : {n_gpu} {gpu_names}", flush=True)

    if not args.no_smoke:
        print("== Test minuscule ==", flush=True)
        smoke_out = os.path.join(args.out, "smoke")
        st = run_model(SMOKE, "single", 0 if n_gpu else None, smoke_out,
                       ["--scales", "20", "--seeds", "0", "--synthetic", "6", "--limit", "10"], 0.5)
        if not st["ok"]:
            print(f"Le test minuscule a échoué : on s'arrête. Lis {st['log']}", flush=True)
            sys.exit(1)

    if not args.no_level1:
        print("== Retrieval seul (sans IA) ==", flush=True)
        quick = args.limit != "0"
        cmd = [sys.executable, "-m", "benchmark.run", "--scales", "30,60" if quick else "50,100,200,400,800,1600",
               "--seeds", "0" if quick else "0,1,2,3,4", "--synthetic", args.synthetic, "--limit", args.limit,
               "--out", args.out]
        statuses.append(run_cmd("niveau1 (sans IA)", cmd, os.path.join(args.out, "logs", "niveau1.log"), "none", 1.0))

    if args.models:
        wanted = args.models.split(",")
        big = [x for x in wanted if x in BIG + OPTIONAL_BIG]
        small = [x for x in wanted if x not in big]
    else:
        small, big = SMALL, BIG

    q = queue.Queue()
    for mdl in small:
        q.put(mdl)
    lock = threading.Lock()

    def worker(gpu):
        while True:
            if (time.time() - start) / 3600 > args.budget_hours:
                return
            try:
                mdl = q.get_nowait()
            except queue.Empty:
                return
            left = args.hard_limit_hours - (time.time() - start) / 3600
            st = run_model(mdl, "single", gpu, args.out, COMMON, min(args.model_timeout_hours, left))
            with lock:
                statuses.append(st)

    print("== Modèles petits (un par GPU) ==", flush=True)
    workers = max(1, n_gpu)
    threads = [threading.Thread(target=worker, args=(g if n_gpu else None,)) for g in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    for mdl in list(q.queue):
        statuses.append({"model": mdl, "ok": False, "minutes": 0, "reason": "ignoré : budget de temps dépassé", "log": ""})

    print("== Gros modèles (tous les GPU) ==", flush=True)
    for mdl in big:
        elapsed = (time.time() - start) / 3600
        left = args.hard_limit_hours - elapsed
        if elapsed > args.budget_hours or left < 0.3:
            print(f"Plus assez de temps : {mdl} ignoré", flush=True)
            statuses.append({"model": mdl, "ok": False, "minutes": 0, "reason": "ignoré : budget de temps dépassé", "log": ""})
            continue
        statuses.append(run_model(mdl, "auto", None, args.out, COMMON, min(args.model_timeout_hours, left)))

    finish(args, statuses, start, gpu_names)


if __name__ == "__main__":
    main()
