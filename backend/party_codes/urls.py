from django.urls import path
from .views import CreatePartyCodeView, LookupPartyCodeView

urlpatterns = [
    path('create/', CreatePartyCodeView.as_view(), name='create_party_code'),
    path('lookup/<str:code>/', LookupPartyCodeView.as_view(), name='lookup_party_code'),
]