"""Management command to purge expired party codes (#37).

Previously expired rows were only deleted opportunistically when someone hit
/lookup/. Run this from cron / a Render scheduled job so the table stays clean
even without lookup traffic:

    python manage.py cleanup_party_codes
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from party_codes.models import PartyCode


class Command(BaseCommand):
    help = "Delete expired party codes."

    def handle(self, *args, **options):
        deleted, _ = PartyCode.objects.filter(expires_at__lt=timezone.now()).delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} expired party code(s)."))
