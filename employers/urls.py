"""
URL patterns for the employers app.

All views are login-protected (enforced in views.py via @login_required).
"""

from django.urls import path
from . import views

urlpatterns = [
    # ── Dashboard ────────────────────────────────────────────────────────────
    path('', views.dashboard, name='dashboard'),

    # ── Companies ────────────────────────────────────────────────────────────
    path('companies/',                  views.company_list,   name='company_list'),
    path('companies/add/',              views.company_add,    name='company_add'),
    path('companies/<int:pk>/',         views.company_detail, name='company_detail'),
    path('companies/<int:pk>/edit/',    views.company_edit,   name='company_edit'),
    path('companies/<int:pk>/delete/',  views.company_delete, name='company_delete'),

    # ── Contacts ─────────────────────────────────────────────────────────────
    path('contacts/',                                views.contact_list, name='contact_list'),
    path('companies/<int:company_pk>/contacts/add/', views.contact_add,  name='contact_add'),
    path('contacts/<int:pk>/edit/',                  views.contact_edit, name='contact_edit'),

    # ── Interactions ─────────────────────────────────────────────────────────
    path('interactions/add/',                              views.interaction_add,             name='interaction_add'),
    path('companies/<int:company_pk>/interactions/add/',   views.interaction_add_for_company, name='interaction_add_for_company'),

    # ── Reports ──────────────────────────────────────────────────────────────
    path('reports/', views.report, name='report'),

    # ── CSV Import ───────────────────────────────────────────────────────────
    path('import/',         views.import_csv,     name='import_csv'),
    path('import/preview/', views.import_preview, name='import_preview'),
]
