"""Admin IP allowlist middleware (#38).

Restricts access to the Django admin to a configured set of client IPs. Enabled
only when ADMIN_IP_ALLOWLIST is set in settings/env. Combined with moving the
admin off /admin/ (ADMIN_URL), this keeps the admin console off-limits on a
public API box.
"""
from django.conf import settings
from django.http import HttpResponseForbidden


class AdminIPAllowlistMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self.allowlist = set(getattr(settings, "ADMIN_IP_ALLOWLIST", []) or [])
        # Normalise the configured admin path to a leading-slash form.
        admin_url = getattr(settings, "ADMIN_URL", "admin/")
        self.admin_prefix = "/" + admin_url.lstrip("/")

    def _client_ip(self, request):
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "")

    def __call__(self, request):
        if self.allowlist and request.path.startswith(self.admin_prefix):
            if self._client_ip(request) not in self.allowlist:
                return HttpResponseForbidden("Admin access is restricted.")
        return self.get_response(request)
