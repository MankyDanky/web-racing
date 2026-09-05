"""Serve the built Vite frontend (frontend/dist) from Django (#7).

This lets the entire game run as a SINGLE service on a SINGLE port — ideal for
the Render free tier, which only exposes one public port per web service. The
API stays under /api/, the admin under its configured path, and every other
path serves the appropriate built HTML page:

  /            -> index.html   (the lobby)
  /game.html   -> game.html    (the race)
  /<anything>  -> index.html   (SPA fallback)

Hashed assets (JS/CSS/GLB models under /assets, /models, /draco, ...) are served
by WhiteNoise directly from settings.FRONTEND_DIST.
"""

import os

from django.conf import settings
from django.http import HttpResponse, HttpResponseNotFound
from django.views.decorators.cache import never_cache


def _serve_html(filename):
    dist = getattr(settings, "FRONTEND_DIST", "")
    if not dist:
        return HttpResponse(
            "Frontend build not found. Run `npm run build` in frontend/ "
            "(or `python run.py`) so frontend/dist exists.",
            status=503,
            content_type="text/plain",
        )
    path = os.path.join(dist, filename)
    if not os.path.isfile(path):
        return HttpResponseNotFound("Not found")
    with open(path, "rb") as fh:
        return HttpResponse(fh.read(), content_type="text/html")


@never_cache
def index(request):
    return _serve_html("index.html")


@never_cache
def game(request):
    return _serve_html("game.html")


@never_cache
def spa_fallback(request, path=""):
    """Serve game.html for /game*, otherwise the lobby index.html."""
    if path.startswith("game"):
        resp = _serve_html("game.html")
        if resp.status_code == 200:
            return resp
    return _serve_html("index.html")
