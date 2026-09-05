# Using the improved web-racing locally

Everything below runs in this workspace right now; the same commands work on your machine.

## Play immediately (already running here)
The rebuilt game is live in the preview on **port 8002** ("Racez.io clone").
- Open it, type a name, pick a color, **PLAY GAME** → solo race vs optional AI bots
  (gear icon → "AI opponents (solo)" → 1-3 → reload lobby → play).
- **Two browser tabs** on localhost = a real multiplayer race (localhost is HTTPS-exempt
  for WebRTC): create a party in tab A, type the 6-letter code (or scan the QR) in tab B.
  Party codes come from the public registry the game ships with.

## Run it yourself from a fresh clone
```bash
git clone https://github.com/MankyDanky/web-racing.git   # or this improved copy
cd web-racing/frontend
npm install
npm run dev            # Vite dev server (console logs kept in dev)
# or production:
npm run build && npx vite preview --port 8002
```
Solo play and tab-to-tab multiplayer work out of the box.

## Backend (only needed for your own party-code registry)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export SECRET_KEY=$(python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())")
export DEBUG=True ALLOWED_HOSTS=localhost
python manage.py migrate
python manage.py runserver 8000
```
Point the frontend at it: `VITE_API_URL=http://localhost:8000 npm run build`
(the lobby reads `import.meta.env.VITE_API_URL`).

## Controls
W/S accelerate/brake-reverse, A/D steer, R reset car, P spectator mode,
C free camera while spectating (drag to orbit, wheel to zoom), gear = settings.
Mobile: virtual stick; optional tilt steering in settings.

## Verify (the same checks run in CI)
```bash
cd frontend && npm test                 # 13 unit tests (netcode, sanitize)
cd ../backend && python manage.py test  # 8 API/model tests
cd ../frontend && npm run build         # production build, console stripped
npx eslint src/ test/                   # 0 errors
```

## Going public
See DEPLOY-web-racing.md (Netlify/Vercel frontend, Render/PythonAnywhere backend,
optional self-hosted PeerJS broker via ?peerHost= or VITE_PEER_HOST).
