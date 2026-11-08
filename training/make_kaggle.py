"""Build the Kaggle kit for COSMOS-Embed: a notebook + a zip with the code it needs.

python training/make_kaggle.py   (from COSMOS/)
-> training/cosmos_embed_kaggle.ipynb
-> training/cosmos_embed_kit.zip   (upload it as a Kaggle Dataset)
"""
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

FILES = ["requirements.txt", "training/cosmos_embed.py",
         "benchmark/__init__.py", "benchmark/run.py", "benchmark/synth.py", "benchmark/dataset.json"]
FILES += [f"cosmos/{f}" for f in sorted(os.listdir(os.path.join(ROOT, "cosmos"))) if f.endswith(".py")]
# data written by Claude (python training/cosmos_embed.py ingest), shipped with the kit when present
if os.path.exists(os.path.join(ROOT, "training/data/raw_claude.jsonl")):
    FILES.append("training/data/raw_claude.jsonl")

with zipfile.ZipFile(os.path.join(HERE, "cosmos_embed_kit.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    for f in FILES:
        z.write(os.path.join(ROOT, f), f)


def md(s): return {"cell_type": "markdown", "metadata": {}, "source": s.strip("\n").splitlines(True)}
def code(s): return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n").splitlines(True)}


cells = [
md("""
# COSMOS-Embed : entraîner notre propre modèle de recherche pour COSMOS

**Base :** `intfloat/multilingual-e5-small` (MIT), avec les préfixes `query: ` / `passage: `.
**Nos données :** des souvenirs + questions écrits par Claude (dépôt data-cosmos), avec des pièges (souvenir proche mais faux).
**Juge :** le benchmark de recherche de COSMOS, base contre notre modèle. Les noms et valeurs du benchmark sont retirés des données d'entraînement.

**Avant de lancer** (panneau de droite) :
- **Accelerator : GPU T4 x2**
- **Internet : On**
- **Add Input** : un Dataset avec `cosmos_embed_kit.zip`

Puis **Save Version → Save & Run All**. Compte environ 1 h 30 à 2 h 30.
`QUICK = True` dans la cellule 4 = test rapide (≈ 15 min) pour vérifier que tout marche.

**À la fin**, onglet **Output** : `cosmos-embed.zip` (le modèle, les résultats, les données générées).
"""),
code("""
# 1) Machine
!nvidia-smi -L
"""),
code("""
# 2) Code COSMOS depuis le Dataset
import glob, os, shutil, zipfile
dst = '/kaggle/working/cosmos'
shutil.rmtree(dst, ignore_errors=True)
hits = glob.glob('/kaggle/input/**/training/cosmos_embed.py', recursive=True)
if hits:
    shutil.copytree(os.path.dirname(os.path.dirname(hits[0])), dst)
else:
    zips = glob.glob('/kaggle/input/**/cosmos_embed_kit*.zip', recursive=True)
    assert zips, 'Rien trouve : Add Input -> le Dataset avec cosmos_embed_kit.zip'
    zipfile.ZipFile(zips[0]).extractall(dst)
%cd /kaggle/working/cosmos
!ls -R /kaggle/working/cosmos | head -30
"""),
code("""
# 3) Dépendances
!pip install -q -U sentence-transformers datasets fastembed accelerate
!python -c "import sentence_transformers as s, transformers as t, torch; print('st', s.__version__, '| tf', t.__version__, '| gpus', torch.cuda.device_count())"
"""),
code("""
# 4) Réglages
import os
QUICK = False                 # True = test rapide
HAS_CLAUDE = os.path.exists('training/data/raw_claude.jsonl')
RUN_QWEN = not HAS_CLAUDE     # avec les données de Claude, pas besoin de générer avec Qwen (mettre True pour ajouter les deux)
PROMPTS = 24 if QUICK else 480     # demandes à Qwen ; 8 souvenirs par demande
EPOCHS = 1 if QUICK else 2
if HAS_CLAUDE:
    n = sum(1 for _ in open('training/data/raw_claude.jsonl', encoding='utf-8'))
    print(f'Données de Claude trouvées : {n} souvenirs')
print('Génération Qwen :', 'oui' if RUN_QWEN else 'non')
"""),
md("""
## 5) Générer nos données (les 2 GPU en parallèle)
Sautée automatiquement si le kit contient les données écrites par Claude (`training/data/raw_claude.jsonl`).
Sinon, chaque GPU fait tourner Qwen3-4B sur la moitié des demandes.
"""),
code("""
import subprocess, time, os
os.chdir('/kaggle/working/cosmos')
procs = []
for shard in ((0, 1) if RUN_QWEN else ()):
    env = dict(os.environ, CUDA_VISIBLE_DEVICES=str(shard))
    log = open(f'/kaggle/working/gen_{shard}.log', 'w')
    procs.append(subprocess.Popen(['python', 'training/cosmos_embed.py', 'gen', '--prompts', str(PROMPTS),
                                   '--shard', str(shard), '--shards', '2'], env=env, stdout=log, stderr=subprocess.STDOUT))
while any(p.poll() is None for p in procs):
    time.sleep(60)
    for s in (0, 1):
        lines = [l for l in open(f'/kaggle/working/gen_{s}.log', errors='ignore') if 'prompts,' in l]
        print(f'GPU {s}:', lines[-1].strip() if lines else 'chargement...')
print('codes de retour :', [p.returncode for p in procs])
!tail -3 /kaggle/working/gen_*.log 2>/dev/null
!wc -l training/data/raw_*.jsonl
"""),
code("""
# 6) Paires d'entraînement (+ retrait des noms du benchmark)
!python training/cosmos_embed.py pairs
"""),
code("""
# 7) Fine-tuning complet de multilingual-e5-small sur nos données
!python training/cosmos_embed.py train --epochs {EPOCHS} --batch 64 --fp16
"""),
code("""
# 8) Juge : benchmark COSMOS, base contre notre modèle
!python training/cosmos_embed.py eval
"""),
code("""
# 9) Tout emballer
import zipfile, os, glob
z = '/kaggle/working/cosmos-embed.zip'
with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as out:
    for base in ('training/out/cosmos-embed', 'training/data'):
        for p in glob.glob(base + '/**/*', recursive=True):
            if os.path.isfile(p):
                out.write(p, p.replace('training/', ''))
    for p in ['training/out/eval.json'] + glob.glob('/kaggle/working/gen_*.log'):
        if os.path.exists(p):
            out.write(p, os.path.basename(p))
print(z, round(os.path.getsize(z) / 1e6, 1), 'Mo')
"""),
]
nb = {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                                   "language_info": {"name": "python"}}, "nbformat": 4, "nbformat_minor": 5}
json.dump(nb, open(os.path.join(HERE, "cosmos_embed_kaggle.ipynb"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("ok:", len(FILES), "files in the kit")
