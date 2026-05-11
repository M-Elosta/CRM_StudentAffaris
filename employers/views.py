"""
Views for the ERO Hub.

Every view requires login via @login_required.
The only public page is /login/ (handled in ero_hub/urls.py).
"""

import json
from datetime import date, timedelta

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q
from django.db.models.functions import TruncMonth
from django.shortcuts import get_object_or_404, redirect, render

from .export import companies_to_excel, companies_to_csv
from .filters import CompanyFilter, ContactFilter
from .forms import (
    CompanyForm, ContactForm, QuickContactForm,
    InteractionForm, QuickInteractionForm, QuickInternshipForm,
)
from .models import Company, Contact, Interaction, Event, InternshipRecord


# ─────────────────────────────────────────────────────────────────────────────
# Dashboard
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def dashboard(request):
    today = date.today()

    total_companies  = Company.objects.count()
    active_partners  = Company.objects.filter(signed_mou=True, is_blacklisted=False).count()
    total_contacts   = Contact.objects.count()
    interactions_this_month = Interaction.objects.filter(
        date__year=today.year, date__month=today.month,
    ).count()
    pending_followups = Interaction.objects.filter(
        follow_up_needed=True,
    ).filter(
        Q(follow_up_date__isnull=True) | Q(follow_up_date__lte=today)
    ).count()

    industry_qs = (
        Company.objects.exclude(industry__isnull=True).exclude(industry='')
        .values('industry').annotate(count=Count('id')).order_by('-count')
    )
    sector_qs = (
        Company.objects.exclude(sector__isnull=True).exclude(sector='')
        .values('sector').annotate(count=Count('id')).order_by('-count')
    )

    twelve_months_ago = today.replace(day=1) - timedelta(days=335)
    monthly_qs = (
        Interaction.objects.filter(date__gte=twelve_months_ago)
        .annotate(month=TruncMonth('date'))
        .values('month').annotate(count=Count('id')).order_by('month')
    )
    month_map = {r['month'].strftime('%Y-%m'): r['count'] for r in monthly_qs}
    timeline_labels, timeline_data = [], []
    for i in range(11, -1, -1):
        m = (today.replace(day=1) - timedelta(days=i * 30))
        timeline_labels.append(m.strftime('%b %Y'))
        timeline_data.append(month_map.get(m.strftime('%Y-%m'), 0))

    top_companies_qs = (
        Company.objects.annotate(interaction_count=Count('interactions'))
        .filter(interaction_count__gt=0).order_by('-interaction_count')[:10]
    )

    recent_interactions = (
        Interaction.objects.select_related('company', 'contact').order_by('-date')[:15]
    )
    upcoming_followups = (
        Interaction.objects.select_related('company', 'contact')
        .filter(follow_up_needed=True, follow_up_date__isnull=False)
        .filter(follow_up_date__gte=today, follow_up_date__lte=today + timedelta(days=14))
        .order_by('follow_up_date')
    )

    return render(request, 'employers/dashboard.html', {
        'total_companies':         total_companies,
        'active_partners':         active_partners,
        'total_contacts':          total_contacts,
        'interactions_this_month': interactions_this_month,
        'pending_followups':       pending_followups,
        'industry_labels': json.dumps([r['industry'] for r in industry_qs]),
        'industry_data':   json.dumps([r['count']    for r in industry_qs]),
        'sector_labels':   json.dumps([r['sector']   for r in sector_qs]),
        'sector_data':     json.dumps([r['count']    for r in sector_qs]),
        'timeline_labels': json.dumps(timeline_labels),
        'timeline_data':   json.dumps(timeline_data),
        'top_co_labels':   json.dumps([c.name              for c in top_companies_qs]),
        'top_co_data':     json.dumps([c.interaction_count for c in top_companies_qs]),
        'recent_interactions': recent_interactions,
        'upcoming_followups':  upcoming_followups,
        'today': today,
    })


# ─────────────────────────────────────────────────────────────────────────────
# Company — List
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def company_list(request):
    qs      = Company.objects.all()
    f       = CompanyFilter(request.GET, queryset=qs)
    companies = f.qs

    # Excel export for the currently filtered set.
    if 'export_excel' in request.GET:
        return companies_to_excel(companies)
    if 'export_csv' in request.GET:
        return companies_to_csv(companies)

    return render(request, 'employers/company_list.html', {
        'filter':    f,
        'companies': companies,
        'count':     companies.count(),
    })


# ─────────────────────────────────────────────────────────────────────────────
# Company — Detail
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def company_detail(request, pk):
    company = get_object_or_404(Company, pk=pk)

    # Quick-add contact (POST from inline form on detail page).
    if request.method == 'POST' and 'quick_contact' in request.POST:
        qc_form = QuickContactForm(request.POST)
        if qc_form.is_valid():
            contact = qc_form.save(commit=False)
            contact.company = company
            contact.save()
            messages.success(request, f'Contact "{contact.full_name}" added.')
            return redirect('company_detail', pk=pk)
    else:
        qc_form = QuickContactForm()

    # Quick-log interaction (POST from inline form on detail page).
    if request.method == 'POST' and 'quick_interaction' in request.POST:
        qi_form = QuickInteractionForm(request.POST, company=company)
        if qi_form.is_valid():
            interaction = qi_form.save(commit=False)
            interaction.company = company
            interaction.save()
            messages.success(request, 'Interaction logged.')
            return redirect('company_detail', pk=pk)
    else:
        qi_form = QuickInteractionForm(company=company)

    # Quick-add internship record.
    if request.method == 'POST' and 'quick_internship' in request.POST:
        qir_form = QuickInternshipForm(request.POST)
        if qir_form.is_valid():
            record = qir_form.save(commit=False)
            record.company = company
            try:
                record.save()
                messages.success(request, 'Internship record added.')
            except Exception:
                messages.error(request, 'A record for that year/semester/program already exists.')
            return redirect('company_detail', pk=pk)
    else:
        qir_form = QuickInternshipForm()

    return render(request, 'employers/company_detail.html', {
        'company':      company,
        'contacts':     company.contacts.all(),
        'interactions': company.interactions.order_by('-date')[:20],
        'internships':  company.internship_records.order_by('-year'),
        'events':       company.events.order_by('-date'),
        'qc_form':      qc_form,
        'qi_form':      qi_form,
        'qir_form':     qir_form,
        'today':        date.today(),
    })


# ─────────────────────────────────────────────────────────────────────────────
# Company — Add / Edit
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def company_add(request):
    if request.method == 'POST':
        form = CompanyForm(request.POST)
        if form.is_valid():
            company = form.save()
            messages.success(request, f'Company "{company.name}" saved successfully.')

            if 'save_add_another' in request.POST:
                return redirect('company_add')
            if 'save_continue' in request.POST:
                return redirect('company_edit', pk=company.pk)
            return redirect('company_detail', pk=company.pk)
    else:
        form = CompanyForm()

    return render(request, 'employers/company_form.html', {
        'form':  form,
        'title': 'Add Company',
    })


@login_required
def company_edit(request, pk):
    company = get_object_or_404(Company, pk=pk)
    if request.method == 'POST':
        form = CompanyForm(request.POST, instance=company)
        if form.is_valid():
            company = form.save()
            messages.success(request, f'Company "{company.name}" updated.')

            if 'save_add_another' in request.POST:
                return redirect('company_add')
            if 'save_continue' in request.POST:
                return redirect('company_edit', pk=company.pk)
            return redirect('company_detail', pk=company.pk)
    else:
        form = CompanyForm(instance=company)

    return render(request, 'employers/company_form.html', {
        'form':    form,
        'company': company,
        'title':   f'Edit — {company.name}',
    })


# ─────────────────────────────────────────────────────────────────────────────
# Company — Delete
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def company_delete(request, pk):
    company = get_object_or_404(Company, pk=pk)
    if request.method == 'POST':
        name = company.name
        company.delete()
        messages.success(request, f'Company "{name}" and all related records deleted.')
        return redirect('company_list')

    return render(request, 'employers/company_confirm_delete.html', {
        'company':           company,
        'contact_count':     company.contacts.count(),
        'interaction_count': company.interactions.count(),
        'internship_count':  company.internship_records.count(),
    })


# ─────────────────────────────────────────────────────────────────────────────
# Contact — List
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def contact_list(request):
    qs = Contact.objects.select_related('company').all()
    f  = ContactFilter(request.GET, queryset=qs)
    return render(request, 'employers/contact_list.html', {
        'filter':   f,
        'contacts': f.qs,
        'count':    f.qs.count(),
    })


# ─────────────────────────────────────────────────────────────────────────────
# Contact — Add / Edit  (always in context of a company)
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def contact_add(request, company_pk):
    company = get_object_or_404(Company, pk=company_pk)
    if request.method == 'POST':
        form = ContactForm(request.POST)
        if form.is_valid():
            contact = form.save(commit=False)
            contact.company = company
            contact.save()
            messages.success(request, f'Contact "{contact.full_name}" added to {company.name}.')

            if 'save_add_another' in request.POST:
                return redirect('contact_add', company_pk=company_pk)
            return redirect('company_detail', pk=company_pk)
    else:
        form = ContactForm()

    return render(request, 'employers/contact_form.html', {
        'form':    form,
        'company': company,
        'title':   f'Add Contact — {company.name}',
    })


@login_required
def contact_edit(request, pk):
    contact = get_object_or_404(Contact, pk=pk)
    company = contact.company
    if request.method == 'POST':
        form = ContactForm(request.POST, instance=contact)
        if form.is_valid():
            contact = form.save()
            messages.success(request, f'Contact "{contact.full_name}" updated.')
            if 'save_continue' in request.POST:
                return redirect('contact_edit', pk=contact.pk)
            return redirect('company_detail', pk=company.pk)
    else:
        form = ContactForm(instance=contact)

    return render(request, 'employers/contact_form.html', {
        'form':    form,
        'company': company,
        'contact': contact,
        'title':   f'Edit — {contact.full_name}',
    })


# ─────────────────────────────────────────────────────────────────────────────
# Interaction — Add
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def interaction_add(request):
    """Add an interaction from the navbar — company selected via dropdown."""
    if request.method == 'POST':
        form = InteractionForm(request.POST)
        if form.is_valid():
            interaction = form.save()
            messages.success(request, 'Interaction logged.')
            if 'save_add_another' in request.POST:
                return redirect('interaction_add')
            return redirect('company_detail', pk=interaction.company.pk)
    else:
        form = InteractionForm()

    return render(request, 'employers/interaction_form.html', {
        'form':  form,
        'title': 'Log Interaction',
        # Pass all companies + their contacts as JSON for the JS contact filter.
        'contacts_json': _contacts_by_company_json(),
    })


@login_required
def interaction_add_for_company(request, company_pk):
    """Add an interaction from a company detail page — company pre-filled."""
    company = get_object_or_404(Company, pk=company_pk)
    if request.method == 'POST':
        form = InteractionForm(request.POST, company=company)
        if form.is_valid():
            interaction = form.save()
            messages.success(request, 'Interaction logged.')
            if 'save_add_another' in request.POST:
                return redirect('interaction_add_for_company', company_pk=company_pk)
            return redirect('company_detail', pk=company_pk)
    else:
        form = InteractionForm(company=company)

    return render(request, 'employers/interaction_form.html', {
        'form':    form,
        'company': company,
        'title':   f'Log Interaction — {company.name}',
        'contacts_json': _contacts_by_company_json(),
    })


def _contacts_by_company_json():
    """
    Return a JSON dict mapping company_id → list of {id, name} contacts.
    Used by the interaction form to filter the contact dropdown via JS.
    """
    result = {}
    for c in Contact.objects.select_related('company').all():
        key = str(c.company_id)
        result.setdefault(key, []).append({'id': c.pk, 'name': c.full_name})
    return json.dumps(result)


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
