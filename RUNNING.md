# Running Racez.io locally

## TL;DR — one command

If you just want to play (single- **and** multiplayer) with the least fuss:

```bash
python3 run.py
```

Open <http://localhost:8000>. This builds the frontend and runs a single Django
process that serves both the game and the party-code API on one port.
Multiplayer signalling uses the public PeerJS cloud, so nothing else is needed.
Flags: `python3 run.py --help` (`--build` to force a rebuild, `--port`, etc.).

The rest of this guide covers the **classic developer setup** — a Vite dev
server with hot-reload for the frontend and a separate Django API — which is
nicer when you're editing code.

---

This guide gets the game running on your own machine — a Vite dev server for the
frontend and a Django API for party codes. You can run the frontend on its own
for **single-player** (AI opponents, time trials, ghosts); the backend is only
needed for **multiplayer** party codes.

## Prerequisites

- **Node.js 20+** and npm
- **Python 3.11+** (3.12 recommended)
- Git

On Debian/Ubuntu/Linux Mint the `python` command usually doesn't exist — use
**`python3`**, and make sure the venv package is installed:

```bash
sudo apt install python3-venv python3-full
```

Then clone the repo:

```bash
git clone https://github.com/MankyDanky/web-racing.git
cd web-racing
```

> **Tip:** run the frontend and backend in **two separate terminals**. Each
> `cd` below is written relative to the repository root (`web-racing/`), so
> `cd frontend` assumes you are *not* already inside `frontend/`.

---

## 1. Frontend (required)

```bash
cd frontend
npm install
npm run dev
```

Vite prints a local URL (default **http://localhost:5173**). Open it in your
browser. You can immediately:

- Enter a name, pick a car color, choose a track, and **Play** a single-player
  race against AI bots.
- Use **W/A/S/D** to drive, **R** to reset to the last checkpoint.

That's all you need for single-player. For multiplayer party codes, also run the
backend below.

### Frontend commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server (hot reload). |
| `npm run build` | Production build into `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm test` | Run the unit tests (timing / sanitizer / netcode). |
| `npm run lint` | ESLint. |
| `npm run format` | Prettier write. |
| `npm run smoke` | Optional headless-browser boot check (needs Chrome; see below). |
| `npm run optimize:assets` | Compress the GLB models (needs `npm i -D @gltf-transform/cli` first). |

---

## 2. Backend (only for multiplayer)

The backend is a small Django + DRF service that hands out short, shareable
party codes and maps them to PeerJS ids.

```bash
cd backend
python3 -m venv .venv             # use python3 on Linux/macOS
source .venv/bin/activate         # Windows: .venv\Scripts\activate
# Once activated your prompt shows (.venv). Inside the venv, `python` and `pip`
# resolve to the venv's own copies — this is what avoids the Debian/Mint
# "externally-managed-environment" (PEP 668) pip error.

pip install Django==4.2.20 djangorestframework==3.16.0 django-cors-headers==4.7.0 \
    dj-database-url==2.1.0 whitenoise==6.6.0

# A SECRET_KEY is mandatory (the app refuses to boot without one).
export SECRET_KEY="$(python -c 'from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())')"
export DEBUG=True                 # SQLite + relaxed security for local dev

python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

The API now serves on **http://localhost:8000**.

> **Note:** the `python` / `pip` commands above work only *after*
> `source .venv/bin/activate`. If you ever see
> `externally-managed-environment`, the venv isn't active — re-run the
> `source .venv/bin/activate` line (you should see `(.venv)` in your prompt).

### Point the frontend at your local backend

By default the frontend talks to the hosted production API. To use your local
one, create `frontend/.env.local`:

```bash
# frontend/.env.local
VITE_API_BASE_URL=http://localhost:8000
```

Restart `npm run dev` after adding it. Now "Create Party" / "Join Party" hit
your local Django instance.

> **Peer-to-peer note:** Actual car sync happens directly browser-to-browser via
> WebRTC (PeerJS). Out of the box PeerJS uses its public signaling broker, so
> two browsers on the same machine/LAN can connect with no extra setup. To
> self-host the broker too, see **Self-hosting the PeerJS broker** below.

### Backend commands

| Command | What it does |
| --- | --- |
| `python manage.py runserver` | Start the API. |
| `python manage.py test` | Run the test suite (11 tests). |
| `python manage.py cleanup_party_codes` | Delete expired party codes (run from cron). |

---

> **Playing with friends on the same Wi-Fi?** See
> **[LAN_MULTIPLAYER.md](LAN_MULTIPLAYER.md)** — it covers LAN setup, the admin
> login, why `/` returns 404, firewall rules, and fully-offline play.

## 3. Try multiplayer locally

1. Start the backend (step 2) and the frontend (step 1) with `.env.local` set.
2. Open **http://localhost:5173** in one browser window → enter a name →
   **Create Party**. A 6-character code (and a QR code / invite link) appears.
3. Open a second window (or another device on your LAN) → enter the code →
   **Join Party**. Or just scan the QR / open the `?party=CODE` link.
4. The host picks a track and starts the race.

Tip: if you refresh a guest tab by accident, it auto-rejoins the party.

---

## Optional: headless smoke test

`npm run smoke` launches Chrome headlessly, loads the lobby and a single-player
race, and asserts there are **zero** console/page errors. It requires a full
Chrome install with system libraries (on Debian/Ubuntu: `libnss3`, `libnspr4`,
`libatk1.0-0`, `libatk-bridge2.0-0`, `libcups2`, `libxkbcommon0`, `libasound2`,
`libxdamage1`, `libgbm1`, `libpango-1.0-0`, `libcairo2`, `libatspi2.0-0`). The
CI runs it as a non-blocking job.

---

## Self-hosting the PeerJS broker (optional)

To avoid the public PeerJS cloud, run your own broker and set the matching env
vars in `frontend/.env.local`:

```bash
# The broker is the `peer` package (NOT `peerjs`, which is the client library).
npx -y peer --port 9000 --key peerjs --path /myapp --host 0.0.0.0
```

```bash
# frontend/.env.local
VITE_PEER_HOST=localhost
VITE_PEER_PORT=9000
VITE_PEER_PATH=/myapp
VITE_PEER_SECURE=false
VITE_PEER_KEY=peerjs
```

---

## Production notes

- Set `DEBUG=False` and provide a strong `SECRET_KEY`.
- Set `DATABASE_URL` (e.g. `postgres://user:pass@host:5432/db`) — the backend
  reads it via `dj-database-url`; without it, it falls back to SQLite.
- Set `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and optionally
  `ADMIN_IP_ALLOWLIST` (comma-separated IPs allowed to reach `/admin`).
- Security headers (HSTS, SSL redirect, nosniff) turn on automatically when
  `DEBUG=False`; tune them with the `SECURE_*` env vars.
- Static files are served by WhiteNoise: run `python manage.py collectstatic`.
