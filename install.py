"""Installation de COSMOS en une commande : python install.py

Cree un environnement .venv, installe les dependances, telecharge le modele de
recherche et affiche (ou ecrit, avec --configure) la config Claude Desktop.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"


def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def claude_config_path() -> Path:
    if os.name == "nt":
        return Path(os.environ.get("APPDATA", Path.home())) / "Claude" / "claude_desktop_config.json"
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/Claude/claude_desktop_config.json"
    return Path.home() / ".config/Claude/claude_desktop_config.json"


def server_entry() -> dict:
    return {"command": str(venv_python()), "args": [str(ROOT / "server.py")]}


def configure_claude() -> None:
    path = claude_config_path()
    config = {}
    if path.exists():
        shutil.copy2(path, path.with_suffix(".json.bak"))
        config = json.loads(path.read_text(encoding="utf-8") or "{}")
    config.setdefault("mcpServers", {})["cosmos-engine"] = server_entry()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(f"Config ecrite dans {path} (copie de l'ancienne : .json.bak). Redemarre Claude Desktop.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Installe COSMOS.")
    parser.add_argument("--configure", action="store_true",
                        help="ajoute COSMOS a la config de Claude Desktop (sauvegarde l'ancienne)")
    args = parser.parse_args()

    if sys.version_info < (3, 10):
        print("COSMOS demande Python 3.10 ou plus recent.")
        return 1

    if not venv_python().exists():
        print("1/3 Creation de l'environnement .venv...")
        venv.EnvBuilder(with_pip=True).create(VENV)
    print("2/3 Installation des dependances (quelques minutes)...")
    subprocess.check_call([str(venv_python()), "-m", "pip", "install", "-q", "-r", str(ROOT / "requirements.txt")])

    print("3/3 Telechargement du modele de recherche (une seule fois)...")
    probe = "import cosmos.embeddings as e; e.embed('warm-up'); print('Modele :', e.MODEL_NAME)"
    try:
        subprocess.check_call([str(venv_python()), "-c", probe], cwd=ROOT)
    except subprocess.CalledProcessError:
        print("Le modele n'a pas pu etre telecharge (reseau ?). Il se telechargera au premier "
              "lancement, ou relance `python install.py` plus tard.")

    print("\nCOSMOS est installe.")
    if args.configure:
        configure_claude()
    else:
        print("\nPour le brancher sur Claude Desktop, relance avec --configure, ou ajoute ceci a claude_desktop_config.json :\n")
        print(json.dumps({"mcpServers": {"cosmos-engine": server_entry()}}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
