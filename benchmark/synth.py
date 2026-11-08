"""
Générateur de cas synthétiques pour le benchmark COSMOS.

Chaque cas parle d'une personne inventée (nom complet unique) avec des valeurs
tirées au hasard (noms d'entreprise et d'animaux inventés, codes, dates) :
un modèle ne peut donc pas répondre grâce à ses connaissances, seulement grâce
à la mémoire. Résultat reproductible via la graine.
"""

import random

FIRST = [
    "Lola", "Marc", "Sofia", "Karim", "Aurèle", "Nina", "Paul", "Yasmine", "Hector", "Elsa",
    "Bruno", "Clara", "Félix", "Amélie", "Omar", "Pauline", "Louis", "Salomé", "Ivan", "Mélanie",
    "Gaspard", "Leïla", "Romain", "Anaïs", "Victor", "Margaux", "Samir", "Océane", "Axel", "Chloé",
]
CITIES = [
    "Lyon", "Nantes", "Lille", "Gand", "Namur", "Rennes", "Tours", "Anvers", "Nice", "Dijon",
    "Brest", "Metz", "Mons", "Liège", "Toulouse", "Bordeaux", "Grenoble", "Reims", "Nancy", "Caen",
]
ANIMALS = ["chien", "chat", "lapin", "perroquet", "hamster", "cheval", "furet", "tortue"]
JOBS = ["boulanger", "architecte", "infirmier", "plombier", "graphiste", "professeur", "électricien", "journaliste"]
SUFFIX = ["SA", "Industries", "Studio", "Logistics", "Conseil", "Labs"]
MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
UNANSWERABLE = [
    "Quel est le numéro de téléphone de {p} ?",
    "De quelle couleur est la voiture de {p} ?",
    "Quel est le plat préféré de {p} ?",
    "Quelle est la taille de {p} ?",
    "Quel est le salaire de {p} ?",
]


def pseudo(rng: random.Random, n_syl: int = 3) -> str:
    cons, vow = "bdfgklmnprstvz", "aeiou"
    return "".join(rng.choice(cons) + rng.choice(vow) for _ in range(n_syl)).capitalize()


def generate(n_cases: int, seed: int):
    """Retourne (facts, questions) au même format que dataset.json."""
    rng = random.Random(seed * 7919 + 13)
    facts, questions = [], []
    kinds = ["pet", "job", "city", "birthday", "code", "update"]
    used_names = set()

    def fid():
        return f"s{seed}_{len(facts):04d}"

    def add_fact(text, supersedes=None):
        f = {"id": fid(), "text": text, "type": "synth"}
        if supersedes:
            f["supersedes"] = supersedes
        facts.append(f)
        return f["id"]

    def add_q(q, gold, kw, kind):
        questions.append({"id": f"sq{seed}_{len(questions):04d}", "q": q, "gold": gold, "kw": kw, "kind": kind})

    for i in range(n_cases):
        while True:
            person = f"{rng.choice(FIRST)} {pseudo(rng, 2)}"
            if person not in used_names:
                used_names.add(person)
                break
        kind = kinds[i % len(kinds)]

        if kind == "pet":
            animal, name = rng.choice(ANIMALS), pseudo(rng, 2)
            g = add_fact(f"{person} a un {animal} qui s'appelle {name}.")
            add_q(f"Comment s'appelle l'animal de compagnie de {person} ?", g, [name], "direct")
        elif kind == "job":
            job, company = rng.choice(JOBS), f"{pseudo(rng, 2)} {rng.choice(SUFFIX)}"
            g = add_fact(f"{person} travaille comme {job} chez {company}.")
            if rng.random() < 0.5:
                add_q(f"Chez quelle entreprise travaille {person} ?", g, [company.split()[0]], "direct")
            else:
                add_q(f"Quel est le métier de {person} ?", g, [job], "paraphrase")
        elif kind == "city":
            city = rng.choice(CITIES)
            g = add_fact(f"{person} a déménagé à {city} l'an dernier.")
            add_q(f"Dans quelle ville vit {person} ?", g, [city], "paraphrase")
        elif kind == "birthday":
            d, m = rng.randint(1, 28), rng.choice(MONTHS)
            g = add_fact(f"L'anniversaire de {person} est le {d} {m}.")
            add_q(f"Quand est l'anniversaire de {person} ?", g, [f"{d} {m}"], "direct")
        elif kind == "code":
            code = str(rng.randint(1000, 9999))
            g = add_fact(f"Le code du coffre de {person} est {code}.")
            add_q(f"Quel est le code du coffre de {person} ?", g, [code], "direct")
        else:  # update : ancienne ville puis nouvelle ville
            c1, c2 = rng.sample(CITIES, 2)
            old = add_fact(f"{person} habite à {c1}.")
            new = add_fact(f"{person} a déménagé, il habite maintenant à {c2}.", supersedes=old)
            add_q(f"Où habite {person} en ce moment ?", new, [c2], "update")
            if rng.random() < 0.5:
                add_q(f"Où habitait {person} avant son déménagement ?", old, [c1], "history")

        if i % 3 == 0:
            add_q(rng.choice(UNANSWERABLE).format(p=person), None, [], "unanswerable")

    return facts, questions
