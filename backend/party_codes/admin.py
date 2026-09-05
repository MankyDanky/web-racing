from django.contrib import admin

from .models import PartyCode


@admin.register(PartyCode)
class PartyCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "peer_id", "created_at", "expires_at")
    search_fields = ("code", "peer_id")
    readonly_fields = ("created_at",)
    ordering = ("-created_at",)
