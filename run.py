#!/usr/bin/env python3
"""One command to run the whole game locally (#7).

    python3 run.py

What it does, in order:
  1. Builds the frontend (frontend/dist) if it's missing or --build is passed.
     The build is configured for SAME-ORIGIN mode, so the browser calls the API
     with relative URLs — no CORS, no second server, no PeerJS broker to run
     (multiplayer signalling uses the public PeerJS cloud).
  2. Ensures a Python virtualenv with the backend deps.
  3. Runs Django (migrate + collectstatic + serve). Django serves BOTH the built
     site and the /api/ endpoints from a single port.

Then open the printed URL (default http://localhost:8000) and play — including
multiplayer party codes — with nothing else running.

Flags:
  --build            Force a fresh frontend build even if dist/ exists.
  --no-build         Never build (use an existing frontend/dist).
  --port PORT        Port to serve on (default 8000, or $PORT).
  --host HOST        Bind address (default 0.0.0.0 so LAN devices can join).
  --skip-venv        Use the current Python environment as-is (no venv).

Requirements: Node.js 20+ and Python 3.11+ on your PATH.
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"
DIST = FRONTEND / "dist"
VENV = BACKEND / ".venv"


def sh(cmd, cwd=None, env=None):
    """Run a command, streaming output; abort on failure."""
    print(f"\n$ {' '.join(str(c) for c in cmd)}  (in {cwd or ROOT})", flush=True)
    result = subprocess.run(cmd, cwd=str(cwd or ROOT), env=env)
    if result.returncode != 0:
        print(f"\n✖ Command failed ({result.returncode}): {' '.join(map(str, cmd))}")
        sys.exit(result.returncode)


def which_or_die(name, hint):
    path = shutil.which(name)
    if not path:
        print(f"✖ '{name}' not found on PATH. {hint}")
        sys.exit(1)
    return path


def venv_python():
    if os.name == "nt":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def build_frontend(force):
    if DIST.exists() and not force:
        print(f"✓ Frontend build already present at {DIST} (use --build to rebuild).")
        return
    npm = which_or_die("npm", "Install Node.js 20+ from https://nodejs.org/")
    if not (FRONTEND / "node_modules").exists():
        sh([npm, "install"], cwd=FRONTEND)
    # SAME-ORIGIN build: the API is served from the same host/port as the site.
    env = os.environ.copy()
    env["VITE_API_BASE_URL"] = "same-origin"
    sh([npm, "run", "build"], cwd=FRONTEND, env=env)
    print(f"✓ Built frontend -> {DIST}")


def ensure_venv(skip_venv):
    if skip_venv:
        return sys.executable
    if not VENV.exists():
        print("• Creating backend virtualenv...")
        sh([sys.executable, "-m", "venv", str(VENV)])
    py = str(venv_python())
    sh([py, "-m", "pip", "install", "--upgrade", "pip"], cwd=BACKEND)
    sh([py, "-m", "pip", "install", "-r", "requirements.txt"], cwd=BACKEND)
    return py


def run_backend(py, host, port):
    env = os.environ.copy()
    # A SECRET_KEY is mandatory. Generate an ephemeral one for local dev if unset.
    if not env.get("SECRET_KEY"):
        gen = subprocess.check_output(
            [py, "-c", "from django.core.management.utils import get_random_secret_key as g; print(g())"],
            cwd=str(BACKEND), env=env,
        ).decode().strip()
        env["SECRET_KEY"] = gen
        print("• Generated an ephemeral SECRET_KEY for this local run.")
    # Local dev defaults: DEBUG on (unless overridden) so http + any host works.
    env.setdefault("DEBUG", "True")
    # Point Django at the build we just made.
    env["FRONTEND_DIST"] = str(DIST)

    sh([py, "manage.py", "migrate", "--noinput"], cwd=BACKEND, env=env)
    # collectstatic gathers admin/DRF static; SPA assets are served from DIST.
    sh([py, "manage.py", "collectstatic", "--noinput"], cwd=BACKEND, env=env)

    print("\n" + "=" * 64)
    print(f"  ▶ Racez.io is running at:  http://localhost:{port}")
    print(f"    (LAN devices: http://<your-LAN-IP>:{port} )")
    print("  Single process serves the game AND the party-code API.")
    print("  Multiplayer signalling uses the public PeerJS cloud.")
    print("  Press Ctrl+C to stop.")
    print("=" * 64 + "\n")
    sh([py, "manage.py", "runserver", f"{host}:{port}"], cwd=BACKEND, env=env)


def main():
    ap = argparse.ArgumentParser(description="Run the whole game with one command.")
    ap.add_argument("--build", action="store_true", help="Force a fresh frontend build.")
    ap.add_argument("--no-build", action="store_true", help="Never build; use existing dist/.")
    ap.add_argument("--port", default=os.environ.get("PORT", "8000"))
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--skip-venv", action="store_true", help="Use current Python env, no venv.")
    args = ap.parse_args()

    print("Racez.io — one-command launcher")
    if not args.no_build:
        build_frontend(force=args.build)
    elif not DIST.exists():
        print("✖ --no-build was given but frontend/dist doesn't exist. Build first.")
        sys.exit(1)

    py = ensure_venv(args.skip_venv)
    try:
        run_backend(py, args.host, args.port)
    except KeyboardInterrupt:
        print("\n👋 Stopped.")


if __name__ == "__main__":
    main()
