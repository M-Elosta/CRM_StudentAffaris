"""
Views for the ERO Hub.

Every view requires login — use @login_required on function views and
LoginRequiredMixin on class-based views. The only public page is /login/.

Build plan:
  Step 5  — dashboard stub, placeholder stubs for all navbar URLs
  Step 6  — full dashboard with stats + charts
  Step 7  — company list, detail, add/edit forms
  Step 8  — contact list, interaction form
  Step 9  — reports + export
  Step 10 — web CSV import (preview + confirm)
"""

import json
from collections import defaultdict
from datetime import date, timedelta

from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q
from django.db.models.functions import TruncMonth
from django.shortcuts import render
from django.utils import timezone

from .models import Company, Contact, Interaction


# ─────────────────────────────────────────────────────────────────────────────
# Dashboard
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def dashboard(request):
    """
    Landing page with summary cards, four Chart.js charts, and activity tables.
    All queries are kept simple and readable — no raw SQL.
    """
    today = date.today()

    # ── Summary cards ─────────────────────────────────────────────────────────
    total_companies = Company.objects.count()

    # Active partner = signed MoU AND not blacklisted.
    active_partners = Company.objects.filter(signed_mou=True, is_blacklisted=False).count()

    total_contacts = Contact.objects.count()

    interactions_this_month = Interaction.objects.filter(
        date__year=today.year,
        date__month=today.month,
    ).count()

    # Pending follow-up = follow_up_needed AND (no date set OR date is today or past).
    pending_followups = Interaction.objects.filter(
        follow_up_needed=True,
    ).filter(
        Q(follow_up_date__isnull=True) | Q(follow_up_date__lte=today)
    ).count()

    # ── Chart 1: Companies by Industry (horizontal bar) ───────────────────────
    industry_qs = (
        Company.objects.exclude(industry__isnull=True).exclude(industry='')
        .values('industry').annotate(count=Count('id')).order_by('-count')
    )
    industry_labels = [r['industry'] for r in industry_qs]
    industry_data   = [r['count']    for r in industry_qs]

    # ── Chart 2: Companies by Sector (doughnut) ───────────────────────────────
    sector_qs = (
        Company.objects.exclude(sector__isnull=True).exclude(sector='')
        .values('sector').annotate(count=Count('id')).order_by('-count')
    )
    sector_labels = [r['sector'] for r in sector_qs]
    sector_data   = [r['count']  for r in sector_qs]

    # ── Chart 3: Interactions over time — last 12 months (line) ───────────────
    twelve_months_ago = today.replace(day=1) - timedelta(days=335)
    monthly_qs = (
        Interaction.objects.filter(date__gte=twelve_months_ago)
        .annotate(month=TruncMonth('date'))
        .values('month').annotate(count=Count('id')).order_by('month')
    )
    # Build a complete 12-month sequence so months with 0 interactions appear.
    month_map = {r['month'].strftime('%Y-%m'): r['count'] for r in monthly_qs}
    timeline_labels, timeline_data = [], []
    for i in range(11, -1, -1):
        # Walk backwards from this month to 11 months ago.
        m = (today.replace(day=1) - timedelta(days=i * 30))
        key = m.strftime('%Y-%m')
        label = m.strftime('%b %Y')
        timeline_labels.append(label)
        timeline_data.append(month_map.get(key, 0))

    # ── Chart 4: Top 10 companies by interaction count (horizontal bar) ───────
    top_companies_qs = (
        Company.objects.annotate(interaction_count=Count('interactions'))
        .filter(interaction_count__gt=0)
        .order_by('-interaction_count')[:10]
    )
    top_co_labels = [c.name for c in top_companies_qs]
    top_co_data   = [c.interaction_count for c in top_companies_qs]

    # ── Recent activity ───────────────────────────────────────────────────────
    recent_interactions = (
        Interaction.objects.select_related('company', 'contact')
        .order_by('-date')[:15]
    )

    upcoming_followups = (
        Interaction.objects.select_related('company', 'contact')
        .filter(follow_up_needed=True, follow_up_date__isnull=False)
        .filter(follow_up_date__gte=today, follow_up_date__lte=today + timedelta(days=14))
        .order_by('follow_up_date')
    )

    context = {
        # Cards
        'total_companies':        total_companies,
        'active_partners':        active_partners,
        'total_contacts':         total_contacts,
        'interactions_this_month': interactions_this_month,
        'pending_followups':      pending_followups,
        # Chart data — serialised to JSON so the template can pass them to Chart.js
        'industry_labels': json.dumps(industry_labels),
        'industry_data':   json.dumps(industry_data),
        'sector_labels':   json.dumps(sector_labels),
        'sector_data':     json.dumps(sector_data),
        'timeline_labels': json.dumps(timeline_labels),
        'timeline_data':   json.dumps(timeline_data),
        'top_co_labels':   json.dumps(top_co_labels),
        'top_co_data':     json.dumps(top_co_data),
        # Tables
        'recent_interactions':  recent_interactions,
        'upcoming_followups':   upcoming_followups,
        'today': today,
    }
    return render(request, 'employers/dashboard.html', context)


# ─────────────────────────────────────────────────────────────────────────────
# Company views  (full implementation in Step 7)
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def company_list(request):
    return render(request, 'employers/company_list.html', {})


@login_required
def company_detail(request, pk):
    return render(request, 'employers/company_detail.html', {})


@login_required
def company_add(request):
    return render(request, 'employers/company_form.html', {})


@login_required
def company_edit(request, pk):
    return render(request, 'employers/company_form.html', {})


@login_required
def company_delete(request, pk):
    return render(request, 'employers/company_confirm_delete.html', {})


# ─────────────────────────────────────────────────────────────────────────────
# Contact views  (full implementation in Step 8)
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def contact_list(request):
    return render(request, 'employers/contact_list.html', {})


@login_required
def contact_add(request, company_pk):
    return render(request, 'employers/contact_form.html', {})


@login_required
def contact_edit(request, pk):
    return render(request, 'employers/contact_form.html', {})


# ─────────────────────────────────────────────────────────────────────────────
# Interaction views  (full implementation in Step 8)
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def interaction_add(request):
    return render(request, 'employers/interaction_form.html', {})


@login_required
def interaction_add_for_company(request, company_pk):
    return render(request, 'employers/interaction_form.html', {})


# ─────────────────────────────────────────────────────────────────────────────
# Reports  (full implementation in Step 9)
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def report(request):
    return render(request, 'employers/report.html', {})


# ─────────────────────────────────────────────────────────────────────────────
# CSV Import  (full implementation in Step 10)
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def import_csv(request):
    return render(request, 'employers/import_csv.html', {})


@login_required
def import_preview(request):
    return render(request, 'employers/import_preview.html', {})
