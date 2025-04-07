from django.shortcuts import render
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.utils import timezone
from .models import PartyCode

class CreatePartyCodeView(APIView):
    """Create a new party code mapped to a peer ID"""
    
    def post(self, request):
        peer_id = request.data.get('peer_id')
        if not peer_id:
            return Response(
                {'error': 'peer_id is required'}, 
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
    
    def get(self, request, code):
        # Clean up expired codes
        PartyCode.objects.filter(expires_at__lt=timezone.now()).delete()
        
        try:
            # Find the party code
            party_code = PartyCode.objects.get(code=code.upper())
            return Response({
                'peer_id': party_code.peer_id
            })
        except PartyCode.DoesNotExist:
            return Response(
                {'error': 'Party code not found'}, 
                status=status.HTTP_404_NOT_FOUND
            )
