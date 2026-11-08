# COSMOS Manager

A tiny local control panel (Python standard library, no extra install).

```bash
cosmos-manager.bat        # Windows
./cosmos-manager.sh       # macOS / Linux
```

It opens http://127.0.0.1:8770 with three tabs:

- **Overview**: your memory in numbers, plus start / stop switches for the **web app** and the **MCP server**.
  Whatever you start is kept on: if it stops, the manager starts it again. Closing the manager stops both.
- **COSMOS**: the COSMOS web app shown inside the panel. The 2D and 3D views, search, filters and editing are the
  web app's own; the manager only starts it (with the same `cosmos.db`) and shows it.
- **Storage**: file size and free space, one-click **backups** with restore, export to JSON or Markdown,
  optimize, open the data folder, and erase everything (a backup is always made first).

Options: `--db PATH`, `--port 8770`, `--web-port 3000`, `--mcp-port 8765`, `--keep-on` (start both right away), `--no-browser`.

The web app needs [Node.js](https://nodejs.org). If its dependencies are missing, the **Set up** button runs `npm install` for you.
Claude Desktop starts COSMOS by itself: the MCP server switch is only for connectors and other tools that need it to stay on.

Safety: the panel listens on 127.0.0.1 only, rejects other host names, and every request must carry a random token
that only the page receives. The MCP server gets its own access token, saved in `.cosmos-manager.json` (not committed).
