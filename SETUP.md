# AYCB Studio v2 — Setup on a New PC

How to download the project from GitHub and launch it with `start.bat` on
another Windows PC.

> **Everything is on the `dev-full` branch.** All work (committed + previously
> uncommitted) was bundled and pushed to `dev-full` on GitHub. Clone that branch
> on the new PC — do **not** use `dev` or `main`, they are behind.

---

## 1. Prerequisites (install once on the new PC)

| Tool | Version | Notes |
|---|---|---|
| **Python** | 3.14.x | Tick **"Add Python to PATH"** during install |
| **Node.js** | 24.x (LTS ok) | Includes `npm` |
| **Git** | any recent | For cloning |

Verify in a fresh terminal:

```powershell
python --version   # 3.14.x
node --version     # v24.x
npm --version      # 11.x
git --version
```

If `python` is not found, Python is not on PATH — reinstall and tick the PATH
checkbox, or add it manually.

---

## 2. Clone the repo

Download **only** the `dev-full` branch (single-branch, shallow = fastest):

```powershell
cd C:\Users\<YourUser>\Documents
git clone --branch dev-full --single-branch https://github.com/tony-uppercat/aycb-studio.git 00_aycb_v2
cd 00_aycb_v2
```

To pull later updates on the new PC: `git pull origin dev-full`.

The repo can live in **any folder** — `start.bat` is path-independent (it uses
its own location). The path does **not** have to match the main PC.

---

## 3. Install backend dependencies (Python)

From the repo root:

```powershell
pip install -e ".[api,dev]"
```

This installs FastAPI, uvicorn, socket.io, aiosqlite, pytest, etc. (defined in
`pyproject.toml`).

> Skip the `local` extra (`torch`, `diffusers`, …) unless you need on-device
> generation — it's a multi-GB download.

---

## 4. Install frontend dependencies (Node)

```powershell
cd frontend
npm install
cd ..
```

---

## 5. Create the `.env` file (NOT in git — copy by hand)

`.env` holds API keys and is intentionally **excluded from GitHub**. Create
`.env` in the repo root with these keys, copying the **values** from the main
PC's `.env`:

```ini
AYCB_GEMINI_API_KEY=...
AYCB_ANTHROPIC_API_KEY=...
AYCB_GCP_PROJECT=gen-lang-client-0045873715
AYCB_GCP_LOCATION=...
AYCB_SHARED_MEDIA_PATH=C:\Users\<YourUser>\Documents\shared\Media
```

Notes:
- The **OpenAI** key is **not** in `.env` — it is stored in the browser
  (localStorage) and entered in the UI. Re-enter it in Settings on the new PC.
- `AYCB_SHARED_MEDIA_PATH` must point to this PC's `shared/Media` folder
  (see next step).

---

## 6. Create the shared data folder (NOT in git)

All media/DB lives **outside the repo** at `..\shared\` relative to the project
(i.e. `Documents\shared\`). Create the folder tree:

```
Documents\shared\
├── Media\
├── References\
└── data\
    └── thumbnails\
```

The SQLite DB (`review-hub.db`) and thumbnails are created automatically on
first run. To move existing media/projects, copy the `shared\` folder from the
main PC.

If your shared root is somewhere else, set it in **Settings > Paths** in the UI
(persists to `.env` as `AYCB_SHARED_ROOT`).

---

## 7. Launch

Double-click **`start.bat`** in the repo root (or run it from a terminal).

It will:
1. Kill anything already on ports 5100 / 5101.
2. Open a **Backend** window — `uvicorn src.api:app --port 5101 --reload`.
3. Open a **Frontend** window — `npm run dev` (Vite on port 5100).
4. Open the browser at the Studio and Review Hub after ~5s.

| URL | What |
|---|---|
| http://localhost:5100 | Studio (node canvas) |
| http://localhost:5100/review | Review Hub |
| http://localhost:5101/api/health | Backend health check |

To stop: close the two CMD windows (or Ctrl+C in each).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `python` not recognized | Python not on PATH — reinstall with the PATH checkbox |
| `npm` not recognized | Install Node.js, reopen the terminal |
| Backend window flashes and closes | Run `python -m uvicorn src.api:app --port 5101 --reload` manually to read the error; usually missing deps (`pip install -e ".[api,dev]"`) or a bad `.env` |
| Port already in use | `start.bat` kills 5100/5101 on launch; if it persists, kill all Python: `Get-Process python \| Stop-Process -Force` |
| Restart button does nothing | uvicorn must be started with `--reload` (start.bat already does this) |
| Blank gallery / no media | `shared\Media` empty or `AYCB_SHARED_MEDIA_PATH` wrong — check Settings > Paths |
| Images won't generate | API key missing/invalid in `.env` (Gemini) or browser (OpenAI) |

---

## Quick checklist

- [ ] Python 3.14 + Node 24 + Git on PATH
- [ ] `git clone` + `git checkout dev`
- [ ] `pip install -e ".[api,dev]"`
- [ ] `cd frontend && npm install`
- [ ] `.env` created with keys (copied from main PC)
- [ ] `shared\` folder tree created
- [ ] Double-click `start.bat`
