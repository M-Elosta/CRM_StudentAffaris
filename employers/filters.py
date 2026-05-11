"""
django-filter FilterSets.

Adding a new filter = one new field here. The view and template pick it up
automatically because they iterate over the form fields.
"""

import django_filters
from django import forms
from django.db.models import Q

from .models import Company, Contact, INDUSTRY_CHOICES, SECTOR_CHOICES

# Prepend blank "All" option to choice lists used in ChoiceFilter.
_INDUSTRY_CHOICES = [('', 'All Industries')] + INDUSTRY_CHOICES
_SECTOR_CHOICES   = [('', 'All Sectors')]    + SECTOR_CHOICES
_BOOL_CHOICES     = [('', 'Any'), ('true', 'Yes'), ('false', 'No')]


class CompanyFilter(django_filters.FilterSet):
    # Free-text search across name, industry, and country.
    search = django_filters.CharFilter(
        method='filter_search',
        label='Search',
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Search name, industry, country…',
        }),
    )
    industry = django_filters.ChoiceFilter(
        choices=_INDUSTRY_CHOICES,
        label='Industry',
        widget=forms.Select(choices=_INDUSTRY_CHOICES, attrs={'class': 'form-select'}),
    )
    sector = django_filters.ChoiceFilter(
        choices=_SECTOR_CHOICES,
        label='Sector',
        widget=forms.Select(choices=_SECTOR_CHOICES, attrs={'class': 'form-select'}),
    )
    signed_mou = django_filters.BooleanFilter(
        label='Signed MoU',
        widget=forms.Select(choices=_BOOL_CHOICES, attrs={'class': 'form-select'}),
    )
    is_favorite = django_filters.BooleanFilter(
        label='Favorite',
        widget=forms.Select(choices=_BOOL_CHOICES, attrs={'class': 'form-select'}),
    )
    is_blacklisted = django_filters.BooleanFilter(
        label='Blacklisted',
        widget=forms.Select(choices=_BOOL_CHOICES, attrs={'class': 'form-select'}),
    )

    class Meta:
        model  = Company
        fields = ['search', 'industry', 'sector', 'signed_mou', 'is_favorite', 'is_blacklisted']

    def filter_search(self, queryset, name, value):
        if not value:
            return queryset
        return queryset.filter(
            Q(name__icontains=value) |
            Q(industry__icontains=value) |
            Q(country__icontains=value)
        )


class ContactFilter(django_filters.FilterSet):
    search = django_filters.CharFilter(
        method='filter_search',
        label='Search',
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Search name, email, company…',
        }),
    )
    is_primary = django_filters.BooleanFilter(
        label='Primary Contact',
        widget=forms.Select(choices=_BOOL_CHOICES, attrs={'class': 'form-select'}),
    )
    is_blacklisted = django_filters.BooleanFilter(
        label='Blacklisted',
        widget=forms.Select(choices=_BOOL_CHOICES, attrs={'class': 'form-select'}),
    )
    available_for_presentations = django_filters.BooleanFilter(
        label='Available for Presentations',
        widget=forms.Select(choices=_BOOL_CHOICES, attrs={'class': 'form-select'}),
    )

    class Meta:
        model  = Contact
        fields = ['search', 'is_primary', 'is_blacklisted', 'available_for_presentations']

    def filter_search(self, queryset, name, value):
        if not value:
            return queryset
        return queryset.filter(
            Q(first_name__icontains=value) |
            Q(last_name__icontains=value) |
            Q(email__icontains=value) |
            Q(company__name__icontains=value)
        )
