# Playing multiplayer on your local network (LAN)

This gets you racing against friends on the same Wi-Fi/router — no internet
account, no cloud deploy. It also explains the admin login and how the pieces
fit together, then points to the production guide for going online.

---

## TL;DR (the happy path)

On **your** machine (the "host" PC that runs the servers):

```bash
# 1) Find your LAN IP (pick the 192.168.x.x / 10.x / 172.16-31.x address)
hostname -I | awk '{print $1}'
# example output: 192.168.1.20
```

**Terminal A — backend (party codes API):**
```bash
cd ~/Documents/web-racing/backend
source .venv/bin/activate
export SECRET_KEY="$(python -c 'from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())')"
export DEBUG=True
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

**Terminal B — frontend (the game):**
```bash
cd ~/Documents/web-racing/frontend
# IMPORTANT: remove any old localhost override so the app auto-detects the host
rm -f .env.local
npm run dev
```

Now on **every device** (your PC, phones, other laptops on the same Wi-Fi):

```
http://192.168.1.20:5173      <-- use YOUR IP from step 1
```

- One player clicks **Create Party**, shares the 6-char code (or the QR / invite
  link — those already point at your LAN IP automatically).
- Everyone else enters the code → **Join Party**.
- Host picks a track and starts. 🏁

That's it. You do **not** need to edit any config per device — the frontend now
derives the API address from whatever URL each device opened.

---

## Admin login (username & password)

There is **no default admin account** — that's why your `/admin` login was
rejected. Django admin users must be created explicitly. Create one (backend
venv active):

```bash
cd ~/Documents/web-racing/backend
source .venv/bin/activate
export SECRET_KEY="...whatever you used..."   # any value works in dev
export DEBUG=True
python manage.py createsuperuser
```

It will prompt for a username, email (optional), and password. Then log in at
`http://<your-ip>:8000/admin/`. Inside you'll find the **Party codes** table —
you can watch codes get created/looked up as people join.

> Note: `/admin` may be IP-restricted in production via `ADMIN_IP_ALLOWLIST`
> (see DEPLOY.md); in local dev it's open.

---

## "Why do I get 404 on these URLs?" — you don't have a bug

The backend is a **headless JSON API**, not a website. These 404s are **correct
and expected**:

| URL | Result | Why |
| --- | --- | --- |
| `http://host:8000/` | 404 | The API has no homepage. |
| `http://host:8000/api/party-codes/` | 404 | Not an endpoint by itself. |
| `http://host:8000/favicon.ico` | 404 | No favicon on the API. |

The **only** real endpoints are:

| URL | Method | Purpose |
| --- | --- | --- |
| `/admin/` | GET | Django admin (after `createsuperuser`). |
| `/api/party-codes/create/` | POST | Host creates a party → returns a code. |
| `/api/party-codes/lookup/<CODE>/` | GET | Guest resolves a code → host peer id. |

Your own server logs already prove it works:
```
"POST /api/party-codes/create/ HTTP/1.1" 200 115      ✅
"GET /api/party-codes/lookup/UXGTJ6/ HTTP/1.1" 200 56 ✅
```
So don't judge the backend by visiting `/` — judge it by the game working at
`:5173`.

---

## How the networking actually works

There are **two** separate connections:

1. **The API (Django, port 8000)** — only used to swap a short party code for the
   host's PeerJS id. Tiny, request/response.
2. **The game data (PeerJS / WebRTC)** — the cars, positions, finish times. This
   is **peer-to-peer, browser-to-browser**. It does *not* go through Django.

By default PeerJS uses its **public cloud broker** just to introduce the two
browsers (the "signalling" handshake). After that, car data flows directly
between devices. On a normal home network this works out of the box **as long as
each device has internet access** for that initial handshake.

### Fully offline LAN (no internet at all)?

If your network has **no internet**, the public PeerJS broker is unreachable, so
you must run your own broker on the host PC:

**Terminal C — PeerJS broker:**
```bash
cd ~/Documents/web-racing/frontend
npx -y peer --port 9000 --key peerjs --path /myapp --host 0.0.0.0
```

> **Note the package name:** the broker/server is the **`peer`** package, not
> `peerjs`. `peerjs` is the *client* library (no command-line tool), so
> `npx peerjs` fails with "could not determine executable to run". Always use
> `npx peer`. The first run will prompt to install `peer` — accept it.
> A successful start prints `Started PeerServer on 0.0.0.0, port: 9000, path:
> /myapp`. (Visiting `http://host:9000/` returns 404 — that's fine, the broker
> has no homepage.)

Then tell the frontend to use it. Create `frontend/.env.local`:
```bash
VITE_PEER_HOST=auto        # = "same host the page was opened from" (your LAN IP)
VITE_PEER_PORT=9000
VITE_PEER_PATH=/myapp
VITE_PEER_SECURE=false
VITE_PEER_KEY=peerjs
```
Restart `npm run dev`. Now signalling stays on your LAN too — 100% offline play.
(`VITE_PEER_HOST=auto` means every device automatically points its broker at the
same IP it loaded the game from, so again no per-device config.)

---

## Environment variables (frontend)

All optional. Set them in `frontend/.env.local` and restart `npm run dev`.

| Variable | Default | Effect |
| --- | --- | --- |
| `VITE_API_BASE_URL` | _(auto: same host, port 8000)_ | Force a specific API URL. Leave unset for LAN auto-detect. |
| `VITE_API_PORT` | `8000` | Backend port used by auto-detect. |
| `VITE_PEER_HOST` | _(unset → public cloud broker)_ | `auto` = LAN broker on the page's host; or an explicit host. |
| `VITE_PEER_PORT` | `9000` | Self-hosted broker port. |
| `VITE_PEER_PATH` | `/myapp` | Broker path. |
| `VITE_PEER_SECURE` | `false` | `true` for wss/https broker. |
| `VITE_PEER_KEY` | _(unset)_ | Broker key, if configured. |

> **Key point:** for LAN play, the simplest setup is to **delete `.env.local`
> entirely** (API auto-detects) and rely on the public PeerJS broker. Only add
> the `VITE_PEER_*` vars if you need fully offline play.

---

## Firewall

If other devices can't connect, your host PC's firewall is likely blocking the
ports. On Linux Mint / Ubuntu with `ufw`:

```bash
sudo ufw allow 5173/tcp     # game (Vite)
sudo ufw allow 8000/tcp     # API (Django)
sudo ufw allow 9000/tcp     # only if self-hosting the PeerJS broker
```

Also make sure all devices are on the **same** network (not a "Guest" Wi-Fi,
which often isolates clients from each other).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Friend's device can't open `:5173` | Wrong IP, different Wi-Fi, or firewall. Re-check `hostname -I` and `ufw` rules. |
| Game loads but "Create Party" fails | Backend not running, or an old `.env.local` still points at `localhost`. Delete it and restart the frontend. |
| `DisallowedHost` error in Django | You're not in `DEBUG=True`. Set `export DEBUG=True` before `runserver` (LAN hosts are only auto-allowed in dev). |
| Parties create but players never see each other | No internet for the public PeerJS broker → run your own broker (see "Fully offline LAN"). |
| `/admin` login rejected | You haven't created a user → `python manage.py createsuperuser`. |

---

## Security note

The permissive LAN behaviour (accepting any Host header, wildcard-ish CORS for
private IP ranges) is **only active when `DEBUG=True`**. With `DEBUG=False`
(production) the backend requires explicit `ALLOWED_HOSTS` and
`CORS_ALLOWED_ORIGINS` and rejects everything else. Never run a public server
with `DEBUG=True`. For going online, follow **DEPLOY.md**.
