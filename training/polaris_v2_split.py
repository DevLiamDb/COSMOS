"""Polaris v2 data: the data-cosmos batches split into train / test / test_theme.

python training/polaris_v2_split.py <data-cosmos dir>
-> training/data_v2/raw_claude.jsonl  (train pool; `cosmos_embed.py pairs` takes its dev split from it)
-> training/data_v2/test.jsonl        (10% of the batches Polaris v1 never saw, same themes as train)
-> training/data_v2/test_theme.jsonl  (new batches of themes removed from train; v1 saw older batches of them)

A batch (one language, one theme) is one group: no batch is split between train and test.
Batches 0001-0088 are Polaris v1's data, so the test sets only use batches after 0088.
"""
import glob
import json
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cosmos_embed as CE  # noqa: E402

V1_LAST_BATCH = 88
HELD_OUT_THEMES = {"garden and plants", "wedding or big event", "podcast or YouTube channel"}
TEST_SHARE = 0.10
OUT = os.path.join(HERE, "data_v2")

src = sys.argv[1]
block = CE.benchmark_blocklist()
tokens = lambda s: set(re.findall(r"[\wÀ-ÿ'-]+", (s or "").lower()))

batches, bad, blocked = {}, 0, 0
for fp in sorted(glob.glob(os.path.join(src, "batches", "*.jsonl"))):
    for line in open(fp, encoding="utf-8"):
        if not line.strip():
            continue
        it = CE.check_claude_item(json.loads(line))
        if it is None:
            bad += 1
            continue
        txt = " ".join([it["memory"], it["update"] or "", it["distractor"] or "", it["absent_question"] or ""]
                       + it["questions"] + it["update_questions"])
        if tokens(txt) & block:
            blocked += 1
            continue
        batches.setdefault(os.path.basename(fp)[:4], []).append(it)

new = sorted(b for b in batches if int(b) > V1_LAST_BATCH)
theme_of = {b: batches[b][0]["topic"] for b in batches}
theme_test = [b for b in new if theme_of[b] in HELD_OUT_THEMES]
pool = [b for b in new if theme_of[b] not in HELD_OUT_THEMES]
random.Random(11).shuffle(pool)
test = sorted(pool[:round(len(pool) * TEST_SHARE)])
train = sorted(b for b in batches if b not in set(test) and theme_of[b] not in HELD_OUT_THEMES)

os.makedirs(OUT, exist_ok=True)
for name, bs in (("raw_claude", train), ("test", test), ("test_theme", theme_test)):
    with open(os.path.join(OUT, f"{name}.jsonl"), "w", encoding="utf-8") as f:
        for b in bs:
            for it in batches[b]:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
    print(f"{name:11} {len(bs):3} batches {sum(len(batches[b]) for b in bs):6} memories")
print(f"{bad} malformed, {blocked} dropped (benchmark names)")
