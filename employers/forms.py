"""
Forms for the ERO Hub.

Design principles (per spec):
- Minimal required fields — only what's truly essential.
- Smart defaults: date fields default to today, country defaults to Qatar.
- Dropdowns for all known-choice fields.
- URL fields auto-fix missing scheme on clean.
- Save / Save & Add Another / Save & Continue Editing buttons handled in views.
"""

import datetime

from django import forms
from django.core.exceptions import ValidationError

from .models import (
    Company, Contact, Interaction, Event, InternshipRecord,
    INDUSTRY_CHOICES, SECTOR_CHOICES, INTERACTION_TYPE_CHOICES,
    EVENT_TYPE_CHOICES, SEMESTER_CHOICES,
)

# Bootstrap class helpers
_input   = {'class': 'form-control'}
_select  = {'class': 'form-select'}
_check   = {'class': 'form-check-input'}
_textarea = {'class': 'form-control', 'rows': 3}


def _fix_url(url):
    """Prepend https:// if a URL value looks like a domain but has no scheme."""
    if url and not url.startswith(('http://', 'https://')):
        return 'https://' + url
    return url


# ─────────────────────────────────────────────────────────────────────────────
class CompanyForm(forms.ModelForm):

    class Meta:
        model  = Company
        fields = [
            'name', 'industry', 'sector', 'country', 'address', 'date_added',
            'website', 'linkedin_url', 'handshake_url',
            'signed_mou', 'is_favorite', 'is_blacklisted',
            'comments', 'sequence',
        ]
        widgets = {
            'name':         forms.TextInput(attrs={**_input, 'autofocus': True}),
            'industry':     forms.Select(choices=[('', '— Select —')] + INDUSTRY_CHOICES, attrs=_select),
            'sector':       forms.Select(choices=[('', '— Select —')] + SECTOR_CHOICES,   attrs=_select),
            'country':      forms.TextInput(attrs={**_input, 'list': 'country-list'}),
            'address':      forms.Textarea(attrs={**_textarea}),
            'date_added':   forms.DateInput(attrs={**_input, 'type': 'date'}),
            'website':      forms.URLInput(attrs={**_input, 'placeholder': 'https://example.com'}),
            'linkedin_url': forms.URLInput(attrs={**_input, 'placeholder': 'https://linkedin.com/company/…'}),
            'handshake_url':forms.URLInput(attrs={**_input, 'placeholder': 'https://app.joinhandshake.com/…'}),
            'signed_mou':   forms.CheckboxInput(attrs=_check),
            'is_favorite':  forms.CheckboxInput(attrs=_check),
            'is_blacklisted': forms.CheckboxInput(attrs=_check),
            'comments':     forms.Textarea(attrs={**_textarea, 'rows': 4}),
            'sequence':     forms.NumberInput(attrs=_input),
        }
        labels = {
            'signed_mou':   'Signed MoU',
            'is_favorite':  'Favorite Employer',
            'is_blacklisted': 'Blacklisted',
            'linkedin_url': 'LinkedIn URL',
            'handshake_url': 'Handshake URL',
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Only name is required; everything else is optional.
        for field in self.fields:
            if field != 'name':
                self.fields[field].required = False
        # Default date_added to today for new records.
        if not self.instance.pk:
            self.fields['date_added'].initial = datetime.date.today()
            self.fields['country'].initial = 'Qatar'

    def clean_website(self):
        return _fix_url(self.cleaned_data.get('website')) or None

    def clean_linkedin_url(self):
        return _fix_url(self.cleaned_data.get('linkedin_url')) or None

    def clean_handshake_url(self):
        return _fix_url(self.cleaned_data.get('handshake_url')) or None


# ─────────────────────────────────────────────────────────────────────────────
class ContactForm(forms.ModelForm):

    class Meta:
        model  = Contact
        fields = [
            'first_name', 'last_name', 'job_title', 'email', 'phone',
            'is_primary', 'is_blacklisted', 'available_for_presentations', 'is_alumni',
            'notes',
        ]
        widgets = {
            'first_name': forms.TextInput(attrs={**_input, 'autofocus': True}),
            'last_name':  forms.TextInput(attrs=_input),
            'job_title':  forms.TextInput(attrs=_input),
            'email':      forms.EmailInput(attrs=_input),
            'phone':      forms.TextInput(attrs={**_input, 'placeholder': '+974 …'}),
            'is_primary':               forms.CheckboxInput(attrs=_check),
            'is_blacklisted':           forms.CheckboxInput(attrs=_check),
            'available_for_presentations': forms.CheckboxInput(attrs=_check),
            'is_alumni':                forms.CheckboxInput(attrs=_check),
            'notes': forms.Textarea(attrs=_textarea),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields:
            if field != 'first_name':
                self.fields[field].required = False


# Quick-add contact — minimal fields shown inline on company detail page.
class QuickContactForm(forms.ModelForm):
    class Meta:
        model  = Contact
        fields = ['first_name', 'last_name', 'job_title', 'email', 'phone']
        widgets = {
            'first_name': forms.TextInput(attrs={**_input, 'placeholder': 'First name *'}),
            'last_name':  forms.TextInput(attrs={**_input, 'placeholder': 'Last name'}),
            'job_title':  forms.TextInput(attrs={**_input, 'placeholder': 'Job title'}),
            'email':      forms.EmailInput(attrs={**_input, 'placeholder': 'Email'}),
            'phone':      forms.TextInput(attrs={**_input, 'placeholder': 'Phone'}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields:
            if field != 'first_name':
                self.fields[field].required = False


# ─────────────────────────────────────────────────────────────────────────────
class InteractionForm(forms.ModelForm):

    class Meta:
        model  = Interaction
        fields = [
            'company', 'contact', 'interaction_type', 'date', 'summary',
            'follow_up_needed', 'follow_up_date', 'follow_up_notes',
        ]
        widgets = {
            'company':  forms.Select(attrs={**_select, 'id': 'id_company'}),
            'contact':  forms.Select(attrs={**_select, 'id': 'id_contact'}),
            'interaction_type': forms.Select(attrs=_select),
            'date':     forms.DateInput(attrs={**_input, 'type': 'date'}),
            'summary':  forms.Textarea(attrs={
                **_textarea, 'rows': 4,
                'placeholder': 'What happened? What was discussed?',
            }),
            'follow_up_needed': forms.CheckboxInput(attrs=_check),
            'follow_up_date':   forms.DateInput(attrs={**_input, 'type': 'date'}),
            'follow_up_notes':  forms.Textarea(attrs=_textarea),
        }

    def __init__(self, *args, company=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['contact'].required = False
        self.fields['follow_up_date'].required = False
        self.fields['follow_up_notes'].required = False

        # Default date to today.
        if not self.instance.pk:
            self.fields['date'].initial = datetime.date.today()

        # If a company is pre-selected, lock it and filter contacts.
        if company:
            self.fields['company'].initial  = company
            self.fields['company'].queryset = Company.objects.filter(pk=company.pk)
            self.fields['contact'].queryset = Contact.objects.filter(company=company)
        else:
            self.fields['contact'].queryset = Contact.objects.select_related('company').all()

        # Add empty option to contact dropdown.
        self.fields['contact'].empty_label = '— No specific contact —'


# Quick-log interaction shown inline on company detail page.
class QuickInteractionForm(forms.ModelForm):
    class Meta:
        model  = Interaction
        fields = ['interaction_type', 'date', 'summary', 'contact']
        widgets = {
            'interaction_type': forms.Select(attrs=_select),
            'date':    forms.DateInput(attrs={**_input, 'type': 'date'}),
            'summary': forms.Textarea(attrs={**_textarea, 'rows': 2, 'placeholder': 'What happened?'}),
            'contact': forms.Select(attrs=_select),
        }

    def __init__(self, *args, company=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['date'].initial   = datetime.date.today()
        self.fields['contact'].required = False
        self.fields['contact'].empty_label = '— No specific contact —'
        if company:
            self.fields['contact'].queryset = Contact.objects.filter(company=company)
        else:
            self.fields['contact'].queryset = Contact.objects.none()


# ─────────────────────────────────────────────────────────────────────────────
class QuickInternshipForm(forms.ModelForm):
    class Meta:
        model  = InternshipRecord
        fields = ['year', 'semester', 'student_count', 'program']
        widgets = {
            'year':          forms.NumberInput(attrs={**_input, 'min': 2000, 'max': 2100}),
            'semester':      forms.Select(attrs=_select),
            'student_count': forms.NumberInput(attrs={**_input, 'min': 0}),
            'program':       forms.TextInput(attrs={**_input, 'placeholder': 'e.g. CS, Business'}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['year'].initial = datetime.date.today().year
        self.fields['semester'].required   = False
        self.fields['program'].required    = False


# ─────────────────────────────────────────────────────────────────────────────
class EventForm(forms.ModelForm):
    class Meta:
        model  = Event
        fields = ['name', 'event_type', 'date', 'location', 'description', 'companies']
        widgets = {
            'name':        forms.TextInput(attrs={**_input, 'autofocus': True}),
            'event_type':  forms.Select(attrs=_select),
            'date':        forms.DateInput(attrs={**_input, 'type': 'date'}),
            'location':    forms.TextInput(attrs=_input),
            'description': forms.Textarea(attrs=_textarea),
            'companies':   forms.SelectMultiple(attrs={
                'class': 'form-select', 'size': '8',
                'id': 'id_companies_select',
            }),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['location'].required    = False
        self.fields['description'].required = False
        self.fields['companies'].required   = False
        if not self.instance.pk:
            self.fields['date'].initial = datetime.date.today()
