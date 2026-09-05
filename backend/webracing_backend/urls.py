"""
URL configuration for webracing_backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.conf import settings
from django.contrib import admin
from django.urls import path, include, re_path

from . import spa

urlpatterns = [
    # Admin lives at a configurable (optionally secret) path (#38).
    path(settings.ADMIN_URL, admin.site.urls),
    path("api/party-codes/", include("party_codes.urls")),
]

# Single-service mode (#7): when a built frontend is present, serve it from
# Django so the whole game runs on one port. The API/admin routes above always
# take precedence; everything else falls through to the SPA. If there's no build
# these routes are simply not added (pure-API deployments keep working).
if getattr(settings, "FRONTEND_DIST", ""):
    urlpatterns += [
        path("", spa.index, name="spa-index"),
        path("game.html", spa.game, name="spa-game"),
        # Catch-all SPA fallback (must be last). Excludes api/ admin/ static/.
        re_path(r"^(?!api/|static/|assets/)(?P<path>.*)$", spa.spa_fallback, name="spa-fallback"),
    ]
