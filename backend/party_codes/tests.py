"""Tests for the party-code API (#32).

Covers both endpoints: creating a code, looking up valid/invalid/expired codes,
input validation, and throttle behaviour.
"""
from datetime import timedelta

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import PartyCode


class PartyCodeModelTests(TestCase):
    def test_generate_unique_code_length_and_charset(self):
        code = PartyCode.generate_unique_code()
        self.assertEqual(len(code), 6)
        # Excludes visually ambiguous characters (no I, O, 0, 1).
        for ch in code:
            self.assertIn(ch, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')

    def test_expires_at_defaults_to_two_hours(self):
        pc = PartyCode.objects.create(code='ABC234', peer_id='racez-abc')
        self.assertIsNotNone(pc.expires_at)
        delta = pc.expires_at - pc.created_at
        # ~2 hours (allow a little slack for execution time).
        self.assertGreater(delta, timedelta(hours=1, minutes=59))
        self.assertLess(delta, timedelta(hours=2, minutes=1))


class CreatePartyCodeViewTests(TestCase):
    def test_create_valid(self):
        resp = self.client.post(
            '/api/party-codes/create/',
            data={'peer_id': 'racez-1234-abcd'},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIn('code', body)
        self.assertEqual(len(body['code']), 6)
        self.assertEqual(body['peer_id'], 'racez-1234-abcd')

    def test_create_rejects_missing_peer_id(self):
        resp = self.client.post(
            '/api/party-codes/create/',
            data={},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_create_rejects_malformed_peer_id(self):
        resp = self.client.post(
            '/api/party-codes/create/',
            data={'peer_id': 'bad id with spaces!'},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)


class LookupPartyCodeViewTests(TestCase):
    def setUp(self):
        self.pc = PartyCode.objects.create(code='ABC234', peer_id='racez-host-1')

    def test_lookup_valid(self):
        resp = self.client.get('/api/party-codes/lookup/ABC234/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['peer_id'], 'racez-host-1')

    def test_lookup_is_case_insensitive(self):
        resp = self.client.get('/api/party-codes/lookup/abc234/')
        self.assertEqual(resp.status_code, 200)

    def test_lookup_invalid_format(self):
        resp = self.client.get('/api/party-codes/lookup/!!!/')
        self.assertEqual(resp.status_code, 400)

    def test_lookup_not_found(self):
        resp = self.client.get('/api/party-codes/lookup/ZZZZZZ/')
        self.assertEqual(resp.status_code, 404)

    def test_lookup_expired_is_cleaned_and_404(self):
        self.pc.expires_at = timezone.now() - timedelta(minutes=1)
        self.pc.save()
        resp = self.client.get('/api/party-codes/lookup/ABC234/')
        self.assertEqual(resp.status_code, 404)
        # The expired row should have been deleted opportunistically.
        self.assertFalse(PartyCode.objects.filter(code='ABC234').exists())


class ThrottleTests(TestCase):
    """Verify the scoped throttle actually kicks in (#36).

    DRF binds throttle rates as class attributes at import time, so
    override_settings can't change them reliably. Instead we exercise the real
    configured `party_create` rate (10/min) and assert the 11th request in the
    window is rejected with 429.
    """

    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.addCleanup(cache.clear)

    def _create_rate_limit(self):
        from rest_framework.settings import api_settings
        rate = api_settings.DEFAULT_THROTTLE_RATES.get('party_create', '10/min')
        return int(rate.split('/')[0])

    def test_create_is_throttled(self):
        limit = self._create_rate_limit()
        statuses = []
        for _ in range(limit + 1):
            r = self.client.post(
                '/api/party-codes/create/',
                data={'peer_id': 'racez-throttle-test'},
                content_type='application/json',
            )
            statuses.append(r.status_code)
        # Everything up to the limit succeeds...
        self.assertTrue(all(s == 200 for s in statuses[:limit]))
        # ...and the next request in the window is throttled.
        self.assertEqual(statuses[-1], 429)
