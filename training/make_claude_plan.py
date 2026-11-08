"""Write the batch plan for the Claude data prompt (training/claude_batches.csv) and paste it into the prompt.

python training/make_claude_plan.py   (from COSMOS/)
"""
import csv
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
N_BATCHES = 380

LANGS = ["en", "fr", "es"] * 3 + ["de", "it", "pt"] * 2 + ["nl", "pl", "tr", "ja", "zh", "ar"]   # 21 slots
THEMES = [
    "software project (stack, deploys, incidents)", "mobile app startup", "e-commerce shop", "data / ML experiment",
    "research thesis", "school or university course", "freelance client work", "agency client accounts",
    "open-source library", "video game development", "podcast or YouTube channel", "restaurant or café",
    "wedding or big event", "house renovation", "moving house", "family life and birthdays", "pets",
    "sport and training plan", "cooking and diet", "travel planning", "car, bike and transport",
    "personal finances and subscriptions", "health appointments (non-sensitive, logistics only)", "garden and plants",
    "books, films and music", "hobbies and crafts", "friends and social events", "job search and interviews",
    "team rituals and tools", "company policies and HR logistics", "legal and admin paperwork (invented)",
    "home server and smart home", "writing a book", "teaching and courses", "volunteering and associations",
    "investing education (no advice)", "science and lab notes", "hardware and electronics projects",
    "assistant rules and answer style", "coding style and tooling preferences",
]
STYLES = ["personal notes", "team project notes", "assistant preferences", "chat-like messages"]

rows = []
for i in range(N_BATCHES):
    # coprime steps so every (language, theme, style) mix shows up
    rows.append((f"{i + 1:04d}", LANGS[(i * 5) % len(LANGS)], THEMES[(i * 7) % len(THEMES)], STYLES[(i * 3) % len(STYLES)]))

with open(os.path.join(HERE, "claude_batches.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["batch", "lang", "theme", "style"])
    w.writerows(rows)

counts = {}
for _, l, _, _ in rows:
    counts[l] = counts.get(l, 0) + 1
print("batches per language:", dict(sorted(counts.items(), key=lambda x: -x[1])))

plan = "\n".join(f"{b} | {l} | {t} | {s}" for b, l, t, s in rows)
p = os.path.join(HERE, "CLAUDE_DATA_PROMPT.md")
md = open(p, encoding="utf-8").read()
start = md.index("The full plan is in `claude_batches.csv`")
end = md.index("Begin now with **batch 0001**")
md = md[:start] + "Full plan (batch | language | theme | style):\n\n```\n" + plan + "\n```\n\n" + md[end:]
open(p, "w", encoding="utf-8").write(md)
print("plan written:", len(rows), "batches,", len(rows) * 80, "memories")
