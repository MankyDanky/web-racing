from django.core.management.base import BaseCommand
from django.utils import timezone

from party_codes.models import PartyCode


class Command(BaseCommand):
    help = "Delete expired party codes. Run from cron, e.g. every 15 minutes: " \
           "*/15 * * * * python manage.py cleanupexpiredcodes"

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report what would be deleted without deleting it.',
        )

    def handle(self, *args, **options):
        expired = PartyCode.objects.filter(expires_at__lt=timezone.now())
        count = expired.count()
        if options['dry_run']:
            self.stdout.write(f'Would delete {count} expired code(s).')
            return
        deleted, _ = expired.delete()
        self.stdout.write(self.style.SUCCESS(f'Deleted {deleted} expired party code row(s).'))
