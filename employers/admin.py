"""
Admin configuration — Dr. Makki's primary daily interface.

Design goals:
  - Every model is searchable and filterable from the list view.
  - Boolean flags can be toggled directly in the list (list_editable).
  - Company page shows contacts, interactions, and internship records inline.
  - Bulk actions cover the most common operations (blacklist, favorite, export).
"""

from django.contrib import admin
from django.utils.html import format_html

from .export import companies_to_excel
from .models import (
    Company, Contact, Interaction, Event, InternshipRecord,
)


# ─────────────────────────────────────────────────────────────────────────────
# Inline classes — shown inside the Company change page.
# ─────────────────────────────────────────────────────────────────────────────

class ContactInline(admin.TabularInline):
    model = Contact
    extra = 0   # Don't show empty rows by default.
    fields = (
        'first_name', 'last_name', 'job_title', 'email', 'phone',
        'is_primary', 'is_blacklisted', 'available_for_presentations', 'is_alumni',
    )
    show_change_link = True   # Link to the full contact change page.


class InternshipRecordInline(admin.TabularInline):
    model = InternshipRecord
    extra = 0
    fields = ('year', 'semester', 'student_count', 'program', 'notes')


class InteractionInline(admin.TabularInline):
    model = Interaction
    extra = 0
    fields = ('date', 'interaction_type', 'summary', 'follow_up_needed', 'follow_up_date')
    readonly_fields = ('date', 'interaction_type', 'summary')
    show_change_link = True
    ordering = ('-date',)

    def get_queryset(self, request):
        # Only show the 10 most recent interactions to keep the page fast.
        qs = super().get_queryset(request)
        return qs[:10]


# ─────────────────────────────────────────────────────────────────────────────
# Custom admin actions
# ─────────────────────────────────────────────────────────────────────────────

@admin.action(description='Mark selected companies as Blacklisted')
def mark_blacklisted(modeladmin, request, queryset):
    queryset.update(is_blacklisted=True)


@admin.action(description='Remove Blacklist from selected companies')
def remove_blacklisted(modeladmin, request, queryset):
    queryset.update(is_blacklisted=False)


@admin.action(description='Mark selected companies as Favorite')
def mark_favorite(modeladmin, request, queryset):
    queryset.update(is_favorite=True)


@admin.action(description='Remove Favorite from selected companies')
def remove_favorite(modeladmin, request, queryset):
    queryset.update(is_favorite=False)


@admin.action(description='Export selected companies to Excel (.xlsx)')
def export_to_excel(modeladmin, request, queryset):
    return companies_to_excel(queryset)


# ─────────────────────────────────────────────────────────────────────────────
# CompanyAdmin
# ─────────────────────────────────────────────────────────────────────────────

@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = (
        'name', 'industry', 'sector', 'country',
        'signed_mou', 'is_favorite', 'is_blacklisted', 'date_added',
    )
    list_filter  = ('industry', 'sector', 'country', 'signed_mou', 'is_favorite', 'is_blacklisted')
    search_fields = ('name', 'industry', 'country', 'address', 'comments')

    # Toggle boolean flags directly from the list without opening each record.
    list_editable = ('signed_mou', 'is_favorite', 'is_blacklisted')
    list_per_page = 25

    # Group the form fields into labelled sections for readability.
    fieldsets = (
        ('Basic Information', {
            'fields': ('sequence', 'name', 'industry', 'sector', 'country', 'address', 'date_added'),
        }),
        ('Links', {
            'fields': ('website', 'linkedin_url', 'handshake_url'),
        }),
        ('Status', {
            'fields': ('signed_mou', 'is_favorite', 'is_blacklisted'),
        }),
        ('Notes', {
            'fields': ('comments',),
        }),
    )

    inlines = [ContactInline, InternshipRecordInline, InteractionInline]
    actions = [mark_blacklisted, remove_blacklisted, mark_favorite, remove_favorite, export_to_excel]


# ─────────────────────────────────────────────────────────────────────────────
# ContactAdmin
# ─────────────────────────────────────────────────────────────────────────────

@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = (
        'full_name_display', 'company', 'job_title', 'email', 'phone',
        'is_primary', 'is_blacklisted', 'available_for_presentations',
    )
    list_filter  = ('is_primary', 'is_blacklisted', 'available_for_presentations', 'is_alumni', 'company')
    search_fields = ('first_name', 'last_name', 'email', 'company__name', 'job_title')
    list_editable = ('is_primary', 'is_blacklisted', 'available_for_presentations')
    list_per_page = 25

    @admin.display(description='Name')
    def full_name_display(self, obj):
        return obj.full_name


# ─────────────────────────────────────────────────────────────────────────────
# InteractionAdmin
# ─────────────────────────────────────────────────────────────────────────────

@admin.register(Interaction)
class InteractionAdmin(admin.ModelAdmin):
    list_display  = ('company', 'contact', 'interaction_type', 'date', 'follow_up_needed', 'follow_up_date')
    list_filter   = ('interaction_type', 'follow_up_needed', 'date')
    search_fields = ('company__name', 'contact__first_name', 'contact__last_name', 'summary')
    date_hierarchy = 'date'
    list_per_page  = 25


# ─────────────────────────────────────────────────────────────────────────────
# EventAdmin
# ─────────────────────────────────────────────────────────────────────────────

@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display  = ('name', 'event_type', 'date', 'location', 'company_count')
    list_filter   = ('event_type', 'date')
    search_fields = ('name', 'description')
    # Nice dual-pane multi-select widget for the many-to-many companies field.
    filter_horizontal = ('companies',)
    list_per_page = 25

    @admin.display(description='# Companies')
    def company_count(self, obj):
        return obj.companies.count()


# ─────────────────────────────────────────────────────────────────────────────
# InternshipRecordAdmin
# ─────────────────────────────────────────────────────────────────────────────

@admin.register(InternshipRecord)
class InternshipRecordAdmin(admin.ModelAdmin):
    list_display  = ('company', 'year', 'semester', 'student_count', 'program')
    list_filter   = ('year', 'semester', 'program')
    search_fields = ('company__name', 'program')
    list_per_page = 25


# ─────────────────────────────────────────────────────────────────────────────
# Admin site branding
# ─────────────────────────────────────────────────────────────────────────────

admin.site.site_header  = 'ERO — Employer Relations Office'
admin.site.site_title   = 'ERO Database'
admin.site.index_title  = 'Welcome to the ERO Database'
