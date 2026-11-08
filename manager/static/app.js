const TOKEN = document.body.dataset.token;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts = {}) {
  const res = await fetch("/api/" + path, {
    method: opts.method || "GET",
    headers: { "X-Cosmos-Token": TOKEN, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (err ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), err ? 6000 : 2600);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

const fmtBytes = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`;
const fmtUp = (s) => s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;

let S = null;
let tab = "overview";
let tokShown = false;

function showTab(name) {
  tab = name;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + name));
  refresh();
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

async function refresh() {
  S = await api("state");
  renderStats();
  renderService("web");
  renderService("mcp");
  renderFrame();
  renderPill();
  renderStorage();
}

function renderPill() {
  const { web, mcp } = S.services;
  const ok = [web, mcp].filter((s) => s.healthy).length;
  const waiting = [web, mcp].some((s) => s.wanted && !s.healthy);
  $("pill").className = "pill " + (waiting ? "warn" : ok ? "on" : "off");
  $("pill").querySelector("span").textContent = waiting ? "Starting..." : ok === 2 ? "Everything on" : ok === 1 ? (web.healthy ? "Web app on" : "MCP server on") : "Off";
}

function renderStats() {
  const c = S.storage.counts;
  $("stats").innerHTML = [["memories", c.nodes], ["links", c.edges], ["categories", c.categories], ["sessions", c.sessions]]
    .map(([l, n]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join("");
  const last = S.storage.last_change ? ` Last change: ${S.storage.last_change.slice(0, 16).replace("T", " ")}.` : "";
  $("model-line").textContent = (S.storage.model ? `Search model of the stored vectors: ${S.storage.model}.` : "No search vectors yet.") + last;
}

function statusText(s) {
  if (s.healthy) return "running and answering";
  if (s.running) return "starting...";
  if (s.wanted) return "stopped, restarting soon";
  return s.error ? "cannot start" : "off";
}

function renderService(name) {
  const s = S.services[name];
  const rows = [["Status", statusText(s)]];
  if (s.running) rows.push(["Up for", fmtUp(s.uptime)]);
  rows.push(["Address", `<code>${esc(s.url)}</code>`]);
  if (s.restarts) rows.push(["Restarts", `${s.restarts}${s.last_exit != null ? ` (last exit code ${s.last_exit})` : ""}`]);
  if (name === "mcp") rows.push(["Access token", `<code id="tok">${tokShown ? esc(S.mcp_token) : "hidden"}</code> <button class="btn small" id="tok-show">${tokShown ? "Hide" : "Show"}</button> <button class="btn small" id="tok-copy">Copy</button>`]);
  $(name + "-info").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  $(name + "-logs").textContent = s.logs.length ? s.logs.join("\n") : "No output yet.";
  $(name + "-toggle").textContent = s.wanted ? "Stop" : "Start";
  if (name === "mcp") {
    $("mcp-restart").disabled = !s.wanted;
    $("tok-show").onclick = () => { tokShown = !tokShown; renderService("mcp"); };
    $("tok-copy").onclick = () => navigator.clipboard.writeText(S.mcp_token).then(() => toast("Token copied"));
  } else {
    const setup = S.setup;
    const problem = S.webapp_problem;
    $("web-problem").classList.toggle("hidden", !problem && setup.state === "idle");
    $("web-problem").textContent = setup.state === "running" ? "Installing the web app (a few minutes)..." :
      setup.state === "failed" ? "Setup failed. See the log below." : setup.state === "done" && !problem ? "Web app installed. You can start it." : (problem || "");
    $("web-setup").classList.toggle("hidden", !problem || problem.startsWith("Node.js"));
    $("web-setup").disabled = setup.state === "running";
    $("web-open").disabled = !s.healthy;
    if (setup.logs.length && !s.logs.length) $("web-logs").textContent = setup.logs.join("\n");
  }
}

let webSeen = false;  // the frame stays up while the dev server is busy compiling (health checks may time out)
function renderFrame() {
  const s = S.services.web;
  const frame = $("app-frame");
  if (s.healthy) webSeen = true;
  if (!s.running) webSeen = false;
  const live = webSeen;
  frame.hidden = !live;
  $("app-empty").classList.toggle("hidden", live);
  $("app-pop").classList.toggle("hidden", !live);
  $("app-pop").href = s.url;
  if (live && tab === "app" && frame.getAttribute("src") !== s.url) frame.src = s.url;
  if (!live && frame.getAttribute("src")) frame.removeAttribute("src");
}

function renderStorage() {
  const st = S.storage;
  $("db-info").innerHTML = [["File", `<code>${esc(st.path)}</code>`], ["Size on disk", fmtBytes(st.size)], ["Free space", fmtBytes(st.disk_free)],
    ["Memories", st.counts.nodes], ["Backups folder", `<code>${esc(st.backups_dir)}</code>`]].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  $("bk-info").textContent = st.backups.length ? `${st.backups.length} backup(s), ${fmtBytes(st.backups_size)} in total.` : "No backup yet.";
  $("bk-list").innerHTML = st.backups.map((b) => `<div class="bk"><span class="n">${esc(b.name)}</span>
    <span class="m">${b.memories ?? "?"} memories, ${fmtBytes(b.size)}</span>
    <button class="btn small" data-restore="${esc(b.name)}">Restore</button><button class="btn small bad" data-delbk="${esc(b.name)}">Delete</button></div>`).join("");
  $("bk-list").querySelectorAll("[data-restore]").forEach((b) => (b.onclick = guard(async () => {
    if (!confirm(`Restore ${b.dataset.restore}?\nYour current data is backed up first, and the services are paused during the restore.`)) return;
    const r = await api("backup/restore", { method: "POST", body: { name: b.dataset.restore } });
    toast(`Restored. Previous data saved as ${r.safety_backup}`);
    await refresh();
  })));
  $("bk-list").querySelectorAll("[data-delbk]").forEach((b) => (b.onclick = guard(async () => {
    if (!confirm(`Delete ${b.dataset.delbk}? This cannot be undone.`)) return;
    await api("backup/" + encodeURIComponent(b.dataset.delbk), { method: "DELETE" });
    await refresh();
  })));
}

const service = (name, action) => guard(async () => { await api(`service/${name}/${action}`, { method: "POST" }); await refresh(); });
$("web-toggle").onclick = guard(async () => { await api(`service/web/${S.services.web.wanted ? "stop" : "start"}`, { method: "POST" }); await refresh(); });
$("mcp-toggle").onclick = guard(async () => { await api(`service/mcp/${S.services.mcp.wanted ? "stop" : "start"}`, { method: "POST" }); await refresh(); });
$("mcp-restart").onclick = service("mcp", "restart");
$("all-on").onclick = guard(async () => { await api("service/web/start", { method: "POST" }); await api("service/mcp/start", { method: "POST" }); await refresh(); });
$("all-off").onclick = guard(async () => { await api("service/web/stop", { method: "POST" }); await api("service/mcp/stop", { method: "POST" }); await refresh(); });
$("web-open").onclick = () => window.open(S.services.web.url, "_blank", "noopener");
$("web-setup").onclick = guard(async () => { await api("setup", { method: "POST" }); await refresh(); });
$("app-start").onclick = service("web", "start");

const doBackup = guard(async () => { const r = await api("backup", { method: "POST" }); toast("Backup saved: " + r.name); await refresh(); });
$("qa-backup").onclick = doBackup;
$("bk-new").onclick = doBackup;
const openFolder = guard(async () => { await api("open-folder", { method: "POST" }); });
$("qa-folder").onclick = openFolder;
$("st-folder").onclick = openFolder;
$("st-opt").onclick = guard(async () => { const r = await api("optimize", { method: "POST" }); toast(r.freed > 0 ? `Freed ${fmtBytes(r.freed)}` : "Already compact"); await refresh(); });

async function download(kind, filename) {
  const text = await api("export/" + kind);
  const blob = new Blob([typeof text === "string" ? text : JSON.stringify(text, null, 2)], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$("ex-json").onclick = guard(() => download("json", "cosmos-export.json"));
$("ex-md").onclick = guard(() => download("md", "cosmos-export.md"));

$("reset-confirm").oninput = () => { $("reset-go").disabled = $("reset-confirm").value !== "DELETE"; };
$("reset-go").onclick = guard(async () => {
  if (!confirm("Erase every memory? A backup is made first.")) return;
  const r = await api("reset", { method: "POST", body: { confirm: "DELETE" } });
  $("reset-confirm").value = "";
  $("reset-go").disabled = true;
  toast(`Everything erased. Backup: ${r.safety_backup}`);
  await refresh();
});

refresh().catch((e) => toast(e.message, true));
setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 3000);
