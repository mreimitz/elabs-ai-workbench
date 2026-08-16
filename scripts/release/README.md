# MCP Token Footprint — run it locally

This is a self-contained copy of **MCP Token Footprint** packaged as a Docker image. You do **not**
need the source code, a GitHub account, or any registry login — just **Docker Desktop** and the two
files in this folder.

## What you got

| File | What it is |
| --- | --- |
| `mcp-token-footprint-vX.Y.Z-docker-image.tar.gz` | The application, packaged as a Docker image. |
| `run.sh` | One-click launcher for **macOS / Linux**. |
| `run.ps1` | One-click launcher for **Windows**. |
| `SHA256SUMS.txt` | Optional integrity check. |

Keep the launcher **in the same folder** as the `.tar.gz`.

## Prerequisites

- **Docker Desktop** — the only thing you need to install. Free for personal use; download from
  <https://www.docker.com/products/docker-desktop/>.
  - **macOS:** macOS 12 (Monterey) or newer, Apple Silicon **or** Intel.
  - **Windows:** Windows 10/11 64-bit. Docker Desktop sets up its **WSL 2** backend for you during
    installation — accept the prompts; a reboot may be required.
- **Disk:** ~2–4 GB free (the image is a couple of GB; it’s stored once).
- **Memory:** 4 GB RAM available to Docker is plenty.
- **A free port** — the app prefers **8080** and, if it’s already taken, the launcher automatically
  moves to the next free port and tells you which one it chose.
- No internet connection is needed to run it — everything is inside the file you were given.

After installing, **open Docker Desktop and wait until it shows “running”** before continuing.

## Run it

### macOS

1. Put `run.sh` and the `.tar.gz` in the same folder (e.g. Downloads).
2. Open **Terminal**, then:
   ```bash
   cd ~/Downloads          # the folder with the two files
   chmod +x run.sh
   ./run.sh
   ```
   (Or, in Finder, right-click `run.sh` → **Open With → Terminal**.)

### Windows

1. Put `run.ps1` and the `.tar.gz` in the same folder (e.g. Downloads).
2. **Right-click `run.ps1` → Run with PowerShell.**
3. If Windows blocks the script (“running scripts is disabled”), open **PowerShell** in that folder
   and run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\run.ps1
   ```

### Linux

Same as macOS: `chmod +x run.sh && ./run.sh`.

In every case the launcher loads the image, starts the container, waits until it’s healthy, and
opens the app in your browser. **First start takes a minute or two.**

## Ports — handled automatically

The app prefers **<http://localhost:8080>**. If that port is already in use, the launcher
**automatically picks the next free port** (8081, 8082, …), starts the app there, and prints the
exact URL it chose — just open the link it shows you.

Want to force a specific starting port? Set `PORT` (it still auto-advances if that one is busy too):

- macOS / Linux: `PORT=9090 ./run.sh`
- Windows: `$env:PORT='9090'; .\run.ps1`

## Managing it afterwards

```
docker stop mcp-token-footprint      # stop
docker start mcp-token-footprint     # start again
docker rm -f mcp-token-footprint     # remove the container (your data is kept)
```

Your data (servers, scans, settings) lives in a Docker volume named **`mcp-token-footprint-data`**
and survives stops, restarts, and re-running the launcher for a newer version. To erase it
completely: `docker volume rm mcp-token-footprint-data` (after removing the container).

## Upgrading to a newer version

You’ll get a new `.tar.gz`. Put it in a folder with the launcher and run it again — it replaces the
container and **keeps your data volume**.

## Troubleshooting

- **“Docker is not running”** — open Docker Desktop and wait for it to finish starting.
- **Port already in use** — handled for you: the launcher moves to the next free port and prints the
  URL. Open the link it shows (it may not be 8080).
- **Nothing opens** — wait ~30s, then visit the URL the launcher printed.
- **Provider / MCP features** — some capabilities need you to add your own API keys or MCP servers
  from inside the app (Settings). Nothing is pre-configured.

## Verify integrity (optional)

macOS / Linux, in this folder:
```bash
shasum -a 256 -c SHA256SUMS.txt --ignore-missing
```
