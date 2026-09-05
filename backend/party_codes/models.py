from django.db import models
import secrets
import string
from datetime import timedelta
from django.utils import timezone

class PartyCode(models.Model):
    # max_length=8 so the collision-fallback 8-char code can actually be stored.
    code = models.CharField(max_length=8, unique=True)
    peer_id = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    
    def save(self, *args, **kwargs):
        # Set expiration to 2 hours from creation if not set
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(hours=2)
        super().save(*args, **kwargs)
    
    @classmethod
    def generate_unique_code(cls):
        """Generate a unique 6-character alphanumeric code"""
        # Exclude similar-looking characters (I, O, 0, 1, etc.)
        characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        
        # Try up to 10 times to generate a unique code.
        # secrets.choice is used because these codes act as capability
        # tokens - a predictable PRNG would let attackers guess them.
        for _ in range(10):
            code = ''.join(secrets.choice(characters) for _ in range(6))
            if not cls.objects.filter(code=code).exists():
                return code
        
        # If we couldn't generate a unique code after 10 attempts,
        # add more characters
        return ''.join(secrets.choice(characters) for _ in range(8))

