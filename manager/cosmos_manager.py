"""COSMOS Manager: a tiny local control panel.

It keeps the COSMOS web app (2D / 3D view and editing) and the MCP server running, and manages the
storage (backups, restore, export, reset). The 2D / 3D views and the editor themselves are the ones
of the COSMOS web app: the manager only starts it and shows it.

    python manager/cosmos_manager.py [--db PATH] [--port 8770] [--web-port 3000] [--no-browser] [--keep-on]

Everything stays on your machine: the panel answers to 127.0.0.1 only, and every request must carry a
random token that only the page itself receives.
"""
import argparse
import atexit
import collections
import json
import mimetypes
import os
import secrets
import shutil
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
STATIC = HERE / "static"
WEBAPP = ROOT / "webapp"
CONFIG = ROOT / ".cosmos-manager.json"
IS_WIN = os.name == "nt"


def _load_db_module():
    """cosmos/db.py alone: importing the cosmos package would load the search model."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("cosmos_db", ROOT / "cosmos" / "db.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cdb = _load_db_module()


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def load_config():
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_config(cfg):
    CONFIG.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


_JOB = None


def tie_to_manager(proc):
    """Windows: put the child in a job object that dies with the manager, so a hard-killed manager leaves nothing behind."""
    global _JOB
    if not IS_WIN:
        return
    try:
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.windll.kernel32
        if _JOB is None:
            class Basic(ctypes.Structure):
                _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                            ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                            ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                            ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

            class Extended(ctypes.Structure):
                _fields_ = [("Basic", Basic), ("Io", ctypes.c_uint64 * 6), ("ProcessMemoryLimit", ctypes.c_size_t),
                            ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                            ("PeakJobMemoryUsed", ctypes.c_size_t)]

            job = k32.CreateJobObjectW(None, None)
            info = Extended()
            info.Basic.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info))
            _JOB = job
        k32.AssignProcessToJobObject(_JOB, wintypes.HANDLE(int(proc._handle)))
    except Exception:  # noqa: BLE001 - best effort, the normal shutdown path still works
        pass


def kill_tree(proc):
    if proc.poll() is not None:
        return
    try:
        if IS_WIN:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, timeout=10)
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        proc.wait(timeout=8)
    except Exception:  # noqa: BLE001 - last resort
        proc.kill()


# ------------------------------------------------------------------ a service kept alive
class Service:
    """A child process that is restarted when it dies (with a growing delay)."""

    def __init__(self, name, build, health_url, url):
        self.name, self.build, self.health_url, self.url = name, build, health_url, url
        self.proc = None
        self.want = False
        self.restarts = 0
        self.started_at = None
        self.last_exit = None
        self.error = None
        self.logs = collections.deque(maxlen=300)
        self.lock = threading.Lock()
        threading.Thread(target=self._watch, daemon=True).start()

    def _spawn(self):
        cmd, cwd, env, problem = self.build()
        if problem:
            self.error, self.want = problem, False
            self.logs.append(f"[manager] cannot start: {problem}")
            return
        self.error = None
        kw = {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)} if IS_WIN else {"start_new_session": True}
        self.proc = subprocess.Popen(cmd, cwd=str(cwd), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     text=True, encoding="utf-8", errors="replace", **kw)
        tie_to_manager(self.proc)
        self.started_at = time.time()
        threading.Thread(target=self._pump, args=(self.proc,), daemon=True).start()

    def _pump(self, proc):
        for line in proc.stdout:
            self.logs.append(line.rstrip())

    def _watch(self):
        delay = 1
        while True:
            time.sleep(1.5)
            with self.lock:
                if not self.want:
                    continue
                if self.proc is not None and self.proc.poll() is None:
                    if time.time() - (self.started_at or 0) > 30:
                        delay = 1
                    continue
                if self.proc is not None:
                    self.last_exit = self.proc.returncode
                    self.restarts += 1
                    self.logs.append(f"[manager] stopped (code {self.last_exit}), restarting in {delay}s")
                    self.proc = None
            time.sleep(delay)
            delay = min(delay * 2, 30)
            with self.lock:
                if self.want and self.proc is None:
                    self._spawn()

    def start(self):
        with self.lock:
            self.want = True
            if self.proc is None or self.proc.poll() is not None:
                self.restarts = 0
                self._spawn()

    def stop(self):
        with self.lock:
            self.want = False
            proc, self.proc = self.proc, None
        if proc:
            kill_tree(proc)

    def healthy(self):
        try:
            with urllib.request.urlopen(self.health_url, timeout=4) as r:
                return r.status < 500
        except Exception:  # noqa: BLE001
            return False

    def status(self):
        running = self.proc is not None and self.proc.poll() is None
        return {"wanted": self.want, "running": running, "healthy": running and self.healthy(),
                "uptime": int(time.time() - self.started_at) if running and self.started_at else 0,
                "restarts": self.restarts, "last_exit": self.last_exit, "error": self.error, "url": self.url,
                "logs": list(self.logs)[-60:]}


def js_runtime():
    return shutil.which("node") or shutil.which("bun")


def webapp_problem():
    if not js_runtime():
        return "Node.js (or Bun) is needed to run the web app: https://nodejs.org"
    if not (WEBAPP / "node_modules" / "next" / "dist" / "bin" / "next").exists():
        return "The web app is not installed yet. Use the Set up button."
    return None


# ------------------------------------------------------------------ one-off job: install the web app
class Setup:
    def __init__(self):
        self.state, self.logs = "idle", collections.deque(maxlen=300)

    def run(self):
        if self.state == "running":
            return
        runtime = shutil.which("bun") or shutil.which("npm")
        if not runtime:
            raise ApiError("Install Node.js first (it includes npm): https://nodejs.org")
        self.state = "running"
        self.logs.clear()
        threading.Thread(target=self._job, args=([runtime, "install"],), daemon=True).start()

    def _job(self, cmd):
        try:
            p = subprocess.Popen(cmd, cwd=str(WEBAPP), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                 encoding="utf-8", errors="replace", shell=IS_WIN)
            for line in p.stdout:
                self.logs.append(line.rstrip())
            self.state = "done" if p.wait() == 0 else "failed"
        except Exception as e:  # noqa: BLE001
            self.logs.append(str(e))
            self.state = "failed"

    def status(self):
        return {"state": self.state, "logs": list(self.logs)[-40:]}


# ------------------------------------------------------------------ storage
class Store:
    def __init__(self, db_path):
        self.db = Path(db_path).resolve()
        self.backups_dir = self.db.parent / "backups"
        self._engine = None
        self._elock = threading.Lock()
        cdb.connect(str(self.db)).close()  # creates the file / applies additive migrations

    def ro(self):
        return sqlite3.connect(f"{self.db.as_uri()}?mode=ro", uri=True)

    def engine(self):
        with self._elock:
            if self._engine is None:
                sys.path.insert(0, str(ROOT))
                from cosmos import CosmosEngine
                self._engine = CosmosEngine(db_path=str(self.db))
            return self._engine

    def close_engine(self):
        with self._elock:
            if self._engine is not None:
                self._engine.close()
                self._engine = None

    def storage(self):
        conn = self.ro()
        n = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("nodes", "edges", "categories")}
        n["sessions"] = conn.execute("SELECT COUNT(DISTINCT session_id) FROM nodes").fetchone()[0]
        row = conn.execute("SELECT value FROM meta WHERE key = 'embedding_model'").fetchone()
        last = conn.execute("SELECT MAX(COALESCE(updated_at, created_at)) FROM nodes").fetchone()[0]
        conn.close()
        size = sum(p.stat().st_size for p in (self.db, Path(f"{self.db}-wal"), Path(f"{self.db}-shm")) if p.exists())
        backups = self.list_backups()
        return {"path": str(self.db), "size": size, "counts": n, "model": row[0] if row else None, "last_change": last,
                "disk_free": shutil.disk_usage(self.db.parent).free, "backups_dir": str(self.backups_dir),
                "backups": backups, "backups_size": sum(b["size"] for b in backups)}

    def list_backups(self):
        if not self.backups_dir.exists():
            return []
        out = []
        for p in sorted(self.backups_dir.glob("cosmos-*.db"), reverse=True):
            try:
                c = sqlite3.connect(f"{p.resolve().as_uri()}?mode=ro", uri=True)
                n = c.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
                c.close()
            except sqlite3.Error:
                n = None
            out.append({"name": p.name, "size": p.stat().st_size, "modified": p.stat().st_mtime, "memories": n})
        return out

    def backup(self, label=""):
        self.backups_dir.mkdir(parents=True, exist_ok=True)
        label = "".join(ch for ch in label if ch.isalnum() or ch in "-_")[:24]
        name = f"cosmos-{datetime.now():%Y%m%d-%H%M%S}{('-' + label) if label else ''}.db"
        src = sqlite3.connect(str(self.db))
        dst = sqlite3.connect(str(self.backups_dir / name))
        src.backup(dst)
        dst.execute("PRAGMA journal_mode=DELETE")  # each backup stays one self-contained file
        dst.close()
        src.close()
        return name

    def _backup_path(self, name):
        p = (self.backups_dir / name).resolve()
        if p.parent != self.backups_dir.resolve() or not p.name.startswith("cosmos-") or p.suffix != ".db" or not p.exists():
            raise ApiError("backup not found", 404)
        return p

    def restore(self, name):
        p = self._backup_path(name)
        safety = self.backup("before-restore")
        self.close_engine()
        src = sqlite3.connect(str(p))
        dst = sqlite3.connect(str(self.db))
        src.backup(dst)
        dst.close()
        src.close()
        return safety

    def delete_backup(self, name):
        self._backup_path(name).unlink()

    def _rows(self):
        conn = self.ro()
        conn.row_factory = sqlite3.Row
        nodes = conn.execute("SELECT id, node_type, surface, abyss, title, pinned, session_id, created_at, updated_at "
                             "FROM nodes ORDER BY created_at").fetchall()
        edges = conn.execute("SELECT from_node, to_node, edge_type FROM edges").fetchall()
        cats = conn.execute("SELECT name, priority, color FROM categories ORDER BY name").fetchall()
        conn.close()
        return nodes, edges, cats

    def export_json(self):
        nodes, edges, cats = self._rows()
        return json.dumps({
            "exported": datetime.now().isoformat(timespec="seconds"),
            "memories": [{"id": r["id"], "title": r["title"], "category": r["node_type"], "summary": r["surface"],
                          "content": r["abyss"], "pinned": bool(r["pinned"]), "session": r["session_id"],
                          "created": r["created_at"], "updated": r["updated_at"] or r["created_at"]} for r in nodes],
            "links": [{"from": e["from_node"], "to": e["to_node"], "type": e["edge_type"]} for e in edges],
            "categories": [{"name": c["name"], "priority": bool(c["priority"]), "color": c["color"]} for c in cats],
        }, ensure_ascii=False, indent=2)

    def export_md(self):
        nodes, _, _ = self._rows()
        by = collections.defaultdict(list)
        for r in nodes:
            by[r["node_type"]].append(r)
        lines = [f"# COSMOS memories ({len(nodes)})", ""]
        for cat in sorted(by):
            lines += [f"## {cat}", ""]
            for r in by[cat]:
                lines += [f"### {r['title'] or r['surface'][:60]}", f"*{(r['created_at'] or '')[:10]}*" + (" - pinned" if r["pinned"] else ""),
                          "", r["abyss"], ""]
        return "\n".join(lines)

    def reset(self):
        safety = self.backup("before-reset")
        self.engine().reset_all()
        self.close_engine()
        return safety

    def optimize(self):
        self.close_engine()
        before = self.db.stat().st_size
        c = sqlite3.connect(str(self.db))
        c.execute("VACUUM")
        c.close()
        return before - self.db.stat().st_size


# ------------------------------------------------------------------ HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "CosmosManager"
    store: Store
    services: dict
    installer: Setup
    token: str
    mcp_token: str

    def log_message(self, *a):
        pass

    def _send(self, status, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body)).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except ValueError:
            raise ApiError("invalid JSON")

    def _handle(self, method):
        if (self.headers.get("Host") or "").split(":")[0] not in ("127.0.0.1", "localhost"):
            return self._send(403, {"error": "forbidden host"})
        path = unquote(urlparse(self.path).path)
        if not path.startswith("/api/"):
            return self._static(path) if method == "GET" else self._send(405, {"error": "method not allowed"})
        if self.headers.get("X-Cosmos-Token") != self.token:
            return self._send(401, {"error": "missing or wrong token (reload the page)"})
        try:
            self._api(method, path)
        except ApiError as e:
            self._send(e.status, {"error": str(e)})
        except Exception as e:  # noqa: BLE001 - report instead of crashing the thread
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    do_GET = lambda self: self._handle("GET")
    do_POST = lambda self: self._handle("POST")
    do_DELETE = lambda self: self._handle("DELETE")

    def _static(self, path):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        f = (STATIC / rel).resolve()
        if STATIC.resolve() not in f.parents or not f.is_file():
            return self._send(404, {"error": "not found"})
        data = f.read_bytes()
        if rel == "index.html":
            data = data.replace(b"__TOKEN__", self.token.encode())
        ctype = {".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2"}.get(
            f.suffix, mimetypes.guess_type(f.name)[0] or "application/octet-stream")
        self._send(200, data, ctype + "; charset=utf-8" if ctype.startswith("text/") else ctype)

    def _api(self, method, path):
        s = self.store
        parts = path[len("/api/"):].strip("/").split("/")
        route = parts[0]
        if method == "GET" and route == "state":
            return self._send(200, {"storage": s.storage(), "mcp_token": self.mcp_token,
                                    "services": {k: v.status() for k, v in self.services.items()},
                                    "webapp_problem": webapp_problem(), "setup": self.installer.status()})
        if method == "POST" and route == "service" and len(parts) == 3 and parts[1] in self.services:
            svc, action = self.services[parts[1]], parts[2]
            if action == "start":
                svc.start()
            elif action == "stop":
                svc.stop()
            elif action == "restart":
                svc.stop()
                svc.start()
            else:
                raise ApiError("unknown action")
            return self._send(200, svc.status())
        if method == "POST" and route == "setup":
            self.installer.run()
            return self._send(200, self.installer.status())
        if route == "backup":
            if method == "POST" and len(parts) == 1:
                return self._send(200, {"name": s.backup()})
            if method == "POST" and len(parts) == 2 and parts[1] == "restore":
                name = self._body().get("name", "")
                was_on = [svc for svc in self.services.values() if svc.want]
                for svc in was_on:
                    svc.stop()
                try:
                    safety = s.restore(name)
                finally:
                    for svc in was_on:
                        svc.start()
                return self._send(200, {"safety_backup": safety})
            if method == "DELETE" and len(parts) == 2:
                s.delete_backup(parts[1])
                return self._send(200, {"ok": True})
        if method == "GET" and route == "export":
            if len(parts) > 1 and parts[1] == "md":
                return self._send(200, s.export_md(), "text/markdown; charset=utf-8")
            return self._send(200, s.export_json(), "application/json; charset=utf-8")
        if method == "POST" and route == "optimize":
            return self._send(200, {"freed": s.optimize()})
        if method == "POST" and route == "reset":
            if self._body().get("confirm") != "DELETE":
                raise ApiError("type DELETE to confirm")
            return self._send(200, {"safety_backup": s.reset()})
        if method == "POST" and route == "open-folder":
            folder = str(s.db.parent)
            if IS_WIN:
                os.startfile(folder)  # noqa: S606 - local folder chosen by the user
            else:
                subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", folder])
            return self._send(200, {"ok": True})
        raise ApiError("unknown route", 404)


def main():
    ap = argparse.ArgumentParser(description="COSMOS Manager")
    ap.add_argument("--db", default=os.environ.get("COSMOS_DB_PATH", str(ROOT / "cosmos.db")))
    ap.add_argument("--port", type=int, default=8770, help="port of this control panel")
    ap.add_argument("--web-port", type=int, default=3000, help="port of the COSMOS web app")
    ap.add_argument("--mcp-port", type=int, default=8765, help="port of the MCP server (HTTP)")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--keep-on", action="store_true", help="start the web app and the MCP server right away")
    args = ap.parse_args()

    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))  # let atexit stop the services
    store = Store(args.db)
    cfg = load_config()
    if not cfg.get("mcp_token"):
        cfg["mcp_token"] = secrets.token_urlsafe(24)
        save_config(cfg)
    db = str(store.db)

    def build_web():
        env = dict(os.environ, COSMOS_DB_PATH=db, NEXT_TELEMETRY_DISABLED="1")
        if not (WEBAPP / ".env").exists():
            env.setdefault("DATABASE_URL", "file:./db/custom.db")
        # --webpack: Turbopack panicked ("Next.js package not found") on this install and left a blank page
        cmd = [js_runtime() or "node", str(WEBAPP / "node_modules" / "next" / "dist" / "bin" / "next"), "dev", "--webpack",
               "-p", str(args.web_port), "-H", "127.0.0.1"]
        return cmd, WEBAPP, env, webapp_problem()

    def build_mcp():
        env = dict(os.environ, COSMOS_MCP_TRANSPORT="http", COSMOS_MCP_HOST="127.0.0.1", COSMOS_MCP_PORT=str(args.mcp_port),
                   COSMOS_MCP_TOKEN=cfg["mcp_token"], COSMOS_DB_PATH=db, PYTHONUNBUFFERED="1")
        return [sys.executable, str(ROOT / "server.py")], ROOT, env, None

    services = {
        "web": Service("web", build_web, f"http://127.0.0.1:{args.web_port}/", f"http://127.0.0.1:{args.web_port}/"),
        "mcp": Service("mcp", build_mcp, f"http://127.0.0.1:{args.mcp_port}/health", f"http://127.0.0.1:{args.mcp_port}/mcp"),
    }
    atexit.register(lambda: [svc.stop() for svc in services.values()])
    Handler.store, Handler.services, Handler.installer = store, services, Setup()
    Handler.token, Handler.mcp_token = secrets.token_urlsafe(24), cfg["mcp_token"]
    if args.keep_on:
        for svc in services.values():
            svc.start()

    httpd = None
    for port in range(args.port, args.port + 20):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if httpd is None:
        sys.exit(f"No free port between {args.port} and {args.port + 19}.")
    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    print(f"COSMOS Manager: {url}\nDatabase: {store.db}\nCtrl+C stops the manager and everything it started.")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for svc in services.values():
            svc.stop()
        store.close_engine()


if __name__ == "__main__":
    main()
