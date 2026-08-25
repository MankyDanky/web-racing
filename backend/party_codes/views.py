import re

from django.shortcuts import render
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.utils import timezone
from .models import PartyCode

# PeerJS IDs are alphanumeric (with dashes/underscores); anything else is junk
PEER_ID_PATTERN = re.compile(r'^[A-Za-z0-9_-]{4,100}$')

# Codes are 6 chars (8 in the rare collision-fallback case)
PARTY_CODE_PATTERN = re.compile(r'^[A-Z2-9]{6,8}$')


class CreatePartyCodeView(APIView):
    """Create a new party code mapped to a peer ID"""
    throttle_scope = 'party_create'

    def post(self, request):
        peer_id = request.data.get('peer_id')
        if not isinstance(peer_id, str) or not PEER_ID_PATTERN.match(peer_id):
            return Response(
                {'error': 'A valid peer_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Generate a unique code
        code = PartyCode.generate_unique_code()

        # Create the party code entry
        party_code = PartyCode.objects.create(
            code=code,
            peer_id=peer_id
        )

        return Response({
            'code': party_code.code,
            'peer_id': party_code.peer_id,
            'expires_at': party_code.expires_at
        })

class LookupPartyCodeView(APIView):
    """Look up a peer ID based on a party code"""
    throttle_scope = 'party_lookup'

    def get(self, request, code):
        # Clean up expired codes
        PartyCode.objects.filter(expires_at__lt=timezone.now()).delete()

        # Reject malformed codes early so brute-force attempts cost nothing
        code = code.upper()
        if not PARTY_CODE_PATTERN.match(code):
            return Response(
                {'error': 'Invalid party code format'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # Find the party code
            party_code = PartyCode.objects.get(code=code)
            return Response({
                'peer_id': party_code.peer_id
            })
        except PartyCode.DoesNotExist:
            return Response(
                {'error': 'Party code not found'},
                status=status.HTTP_404_NOT_FOUND
            )
