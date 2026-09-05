# Deploying Racez.io

For local development see **[RUNNING.md](RUNNING.md)**. This file documents the
environment variables used in production.

## Frontend (Vite build-time env)

Set these before `npm run build`. They are baked into the bundle.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `https://mankydanky.pythonanywhere.com` | Base URL of the party-code API. |
| `VITE_PEER_HOST` | _(unset → PeerJS public cloud)_ | Self-hosted PeerJS broker host. |
| `VITE_PEER_PORT` | _(unset)_ | Broker port. |
| `VITE_PEER_PATH` | `/myapp` | Broker path. |
| `VITE_PEER_SECURE` | `true` | Use `wss`/`https` to the broker. |
| `VITE_PEER_KEY` | _(unset)_ | Broker API key, if configured. |

Example `frontend/.env.production`:

```bash
VITE_API_BASE_URL=https://api.example.com
VITE_PEER_HOST=peer.example.com
VITE_PEER_PORT=443
VITE_PEER_PATH=/myapp
VITE_PEER_SECURE=true
```

## Backend (Django runtime env)

| Variable | Required | Purpose |
| --- | --- | --- |
| `SECRET_KEY` | **yes** | Django secret; the app refuses to start without it. |
| `DEBUG` | no (default `False`) | Never enable in production. |
| `DATABASE_URL` | recommended | e.g. `postgres://user:pass@host:5432/db`. Falls back to SQLite. |
| `ALLOWED_HOSTS` | yes (prod) | Comma-separated hostnames. |
| `CORS_ALLOWED_ORIGINS` | yes (prod) | Comma-separated frontend origins. |
| `ADMIN_IP_ALLOWLIST` | optional | Comma-separated IPs allowed to reach `/admin`. |
| `SECURE_SSL_REDIRECT` | optional (default `True` when `DEBUG=False`) | Force HTTPS. |
| `SECURE_HSTS_SECONDS` | optional (default `31536000`) | HSTS max-age. |

### Build & run

```bash
pip install Django==4.2.20 djangorestframework==3.16.0 django-cors-headers==4.7.0 \
    dj-database-url==2.1.0 whitenoise==6.6.0
python manage.py migrate
python manage.py collectstatic --noinput
gunicorn webracing_backend.wsgi   # or your WSGI server of choice
```

### Scheduled cleanup

Run periodically (e.g. hourly cron) to purge expired party codes:

```bash
python manage.py cleanup_party_codes
```
