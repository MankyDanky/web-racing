# This folder is a PR-ready copy of Racez.io

`site/` is a **complete, self-contained mirror** of the project with all of the
improvements applied — ready to push to GitHub and open a pull request against
the upstream repo (<https://github.com/MankyDanky/web-racing>).

It contains everything the app needs and nothing that shouldn't be committed:

- ✅ Full `frontend/` (source, tests, ESLint/Prettier configs, Draco decoders,
  all `.glb` models, `public/`).
- ✅ Full `backend/` (Django project, `party_codes` app, migrations, management
  commands, middleware, `requirements.txt`).
- ✅ Deploy tooling: `run.py` (one-command local run), `render.yaml`,
  `render-build.sh`.
- ✅ Docs: `README.md`, `RUNNING.md`, `RENDER_SETUP.md`, `DEPLOY.md`,
  `LAN_MULTIPLAYER.md`, `LICENSE`.
- ✅ CI: `.github/workflows/ci.yml`.
- ✅ `.gitignore` that excludes `node_modules/`, `frontend/dist/`,
  `backend/.venv/`, `backend/db.sqlite3`, `staticfiles/`, `__pycache__/`,
  `.DS_Store`, and `.env*`.
- 🚫 No `node_modules/`, no build output, no virtualenv, no database, no secrets.

## Verify locally

```bash
# One command runs the whole thing on http://localhost:8000
python3 run.py
```

Or the individual checks:

```bash
cd frontend && npm install && npm run lint && npm test && npm run build
cd ../backend && python -m venv .venv && . .venv/bin/activate \
  && pip install -r requirements.txt \
  && SECRET_KEY=x DEBUG=True python manage.py test
```

## Open the PR

```bash
# From inside this folder (treat it as the repo root):
git init
git remote add origin https://github.com/<you>/web-racing.git
git add .
git commit -m "Gameplay, multiplayer, UX, and one-command/Render deploy improvements"
git push -u origin main
# then open a PR against MankyDanky/web-racing on GitHub
```
