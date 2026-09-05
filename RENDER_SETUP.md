# Deploying Racez.io to Render (A → Z)

This guide takes you from nothing to a **live, public URL** on Render's **free
tier**, step by step. The whole game (the site *and* the party-code API) runs as
**one** Render web service on **one** port — no separate static host and no
PeerJS broker to run. Multiplayer signalling uses the public PeerJS cloud, and
the actual car-to-car data stays peer-to-peer (WebRTC).

> **Why one service?** Render's free web service exposes a single public port.
> We serve the built frontend straight from Django (via WhiteNoise) and keep the
> API under `/api/`, so everything lives behind that one port. That's exactly
> what the `render.yaml` blueprint and `render-build.sh` in this repo set up.

---

## A. What you need first

1. A **GitHub account** with this repository pushed to it (your fork is fine).
2. A **free Render account** — sign up at <https://render.com> (you can log in
   with GitHub, which makes step D one click).

That's it. You do **not** need a credit card for the free tier.

---

## B. Make sure these files are in your repo root

They already are in this project — just confirm they're committed:

| File | Purpose |
| --- | --- |
| `render.yaml` | Render Blueprint: defines the single web service. |
| `render-build.sh` | Build step: builds the frontend + installs backend. |
| `backend/requirements.txt` | Python dependencies (incl. gunicorn, whitenoise). |
| `run.py` | One-command local runner (not used by Render, handy for you). |

---

## C. Push your code to GitHub

```bash
git add .
git commit -m "Deploy Racez.io to Render"
git push origin main
```

---

## D. Create the service on Render (Blueprint — the easy way)

1. Go to the Render dashboard: <https://dashboard.render.com>.
2. Click **New +** (top right) → **Blueprint**.
3. **Connect your GitHub repo** (authorise Render if it asks), pick this repo.
4. Render detects `render.yaml` and shows a plan: one web service named
   **web-racing** on the **free** plan.
5. Click **Apply** / **Create**. Render generates a `SECRET_KEY` automatically
   (declared as `generateValue: true` in the blueprint).

Render now runs `render-build.sh` (builds the frontend, installs Python deps,
collects static, migrates) and then starts gunicorn. First build takes a few
minutes (it installs Node + Python deps and compiles the frontend).

> **Prefer clicking over blueprints?** See **Appendix: manual setup** below.

---

## E. Watch the build

- Open the service → **Logs** tab. You'll see the three build phases from
  `render-build.sh` (frontend build → backend deps → collectstatic + migrate),
  then `Starting gunicorn`.
- When you see it listening on the port and the status turns **Live**, you're up.

---

## F. Open your game

Your public URL is shown at the top of the service page, e.g.:

```
https://web-racing.onrender.com
```

Open it — you get the lobby. Enter a name, pick a car and a track, and **Play**
a single-player race immediately. For multiplayer, **Create Party**, share the
6-character code / QR / invite link, and have a friend **Join Party**.

Nothing else to configure: `RENDER_EXTERNAL_HOSTNAME` is injected by Render and
auto-added to `ALLOWED_HOSTS` **and** `CSRF_TRUSTED_ORIGINS` by `settings.py`.

---

## G. (Optional) Durable party codes with free Postgres

The free tier has **no persistent disk**, so the default SQLite database is
**ephemeral** — it resets on every deploy/restart. Party codes are short-lived
(they expire quickly), so this is usually fine. If you want them to survive
restarts:

1. In `render.yaml`, **uncomment** the `databases:` block at the bottom **and**
   the `DATABASE_URL` env var under the web service. Commit & push.
2. Render creates a free Postgres and injects `DATABASE_URL`. The backend reads
   it automatically via `dj-database-url`.

Or add it in the dashboard: **New + → PostgreSQL (free)**, then on the web
service add an env var `DATABASE_URL` = the database's *Internal Connection
String*.

---

## H. (Optional) Create an admin user

To reach the Django admin (`/admin/` by default) on your live site:

1. Service → **Shell** tab (free tier includes a shell).
2. Run:
   ```bash
   cd backend
   python manage.py createsuperuser
   ```
3. Visit `https://<your-app>.onrender.com/admin/`.

Harden it (optional): set `ADMIN_URL` (e.g. `secret-console/`) to move the admin
off the well-known path, and `ADMIN_IP_ALLOWLIST` (comma-separated IPs) to
restrict who can reach it. Both are read in `settings.py`.

---

## I. Redeploying

Every `git push` to the connected branch triggers an automatic redeploy. You can
also hit **Manual Deploy → Deploy latest commit** from the dashboard.

---

## J. Free-tier gotchas (read this)

- **Cold starts / spin-down:** free web services **sleep after ~15 minutes** of
  no traffic. The next visit takes ~30–60s to wake. That's normal on free.
- **Ephemeral disk:** don't rely on SQLite or uploaded files persisting — use
  the free Postgres (step G) if you need durability.
- **One port only:** that's exactly why we run everything from a single Django
  service. Don't try to run a separate PeerJS broker on the free plan — the
  public PeerJS cloud is used instead (already the default).
- **Build minutes / bandwidth:** generous but finite on free; fine for a game
  like this.

---

## Environment variables reference

Set automatically by the blueprint (you normally touch none of these):

| Variable | Set by | Purpose |
| --- | --- | --- |
| `SECRET_KEY` | Render (`generateValue`) | Django secret. |
| `DEBUG` | blueprint = `False` | Production mode. |
| `FRONTEND_DIST` | blueprint | Where Django finds the built site. |
| `RENDER_EXTERNAL_HOSTNAME` | Render | Auto-added to hosts + CSRF. |
| `PYTHON_VERSION` | blueprint | Pin the Python runtime. |

Optional (add in the dashboard if you want them):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Use managed Postgres instead of SQLite. |
| `ADMIN_URL` | Move the admin off `/admin/`. |
| `ADMIN_IP_ALLOWLIST` | Restrict admin access to given IPs. |
| `REDIS_URL` | Shared throttle cache across gunicorn workers. |
| `SECURE_HSTS_SECONDS` | Tune HSTS (default 1 year). |

---

## Appendix: manual setup (without the blueprint)

If you'd rather click through instead of using `render.yaml`:

1. **New + → Web Service**, connect the repo.
2. **Runtime:** Python 3.
3. **Build Command:**
   ```bash
   ./render-build.sh
   ```
4. **Start Command:**
   ```bash
   cd backend && gunicorn webracing_backend.wsgi --bind 0.0.0.0:$PORT
   ```
5. **Environment variables:** add
   - `SECRET_KEY` = *(click Generate)*
   - `DEBUG` = `False`
   - `FRONTEND_DIST` = `/opt/render/project/src/frontend/dist`
   - `PYTHON_VERSION` = `3.12.6`
6. Create the service. Done — same result as the blueprint.

---

## Local sanity check before deploying

Run the exact single-service setup on your own machine first:

```bash
python3 run.py
```

Then open <http://localhost:8000>. If it works locally, it'll work on Render.
