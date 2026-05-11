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
# Reports + Export
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def report(request):
    """
    Multi-filter report page. Filters companies, previews results, exports.
    Reuses CompanyFilter but adds date_added range fields handled manually
    so we don't need a second FilterSet class.
    """
    qs = Company.objects.all()
    f  = CompanyFilter(request.GET, queryset=qs)
    companies = f.qs

    # Date range filtering (layered on top of CompanyFilter).
    date_from = request.GET.get('date_from', '').strip()
    date_to   = request.GET.get('date_to', '').strip()
    if date_from:
        try:
            companies = companies.filter(date_added__gte=date_from)
        except Exception:
            pass
    if date_to:
        try:
            companies = companies.filter(date_added__lte=date_to)
        except Exception:
            pass

    if 'export_excel' in request.GET:
        return companies_to_excel(companies)
    if 'export_csv' in request.GET:
        return companies_to_csv(companies)

    return render(request, 'employers/report.html', {
        'filter':    f,
        'companies': companies[:200],   # cap preview at 200 rows for performance
        'count':     companies.count(),
        'date_from': date_from,
        'date_to':   date_to,
        'has_filters': bool(request.GET),
    })


# ─────────────────────────────────────────────────────────────────────────────
# Web CSV Import — upload → preview → confirm
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def import_csv(request):
    """
    Step 1: Show the upload form and handle the initial file submission.
    On POST, validates the file and type, runs the cleaning pipeline to
    generate a preview, then redirects to the preview page (or re-renders
    with errors).
    """
    import os, uuid
    from django.core.files.storage import default_storage

    error = None

    if request.method == 'POST':
        uploaded = request.FILES.get('csv_file')
        data_type = request.POST.get('data_type', 'company')

        # Validate: must be a .csv file ≤ 50 MB.
        if not uploaded:
            error = 'Please select a CSV file.'
        elif not uploaded.name.lower().endswith('.csv'):
            error = 'Only .csv files are accepted.'
        elif uploaded.size > 52_428_800:
            error = 'File is too large (max 50 MB).'
        else:
            # Save to a temp file in media/imports/.
            os.makedirs(os.path.join('media', 'imports'), exist_ok=True)
            tmp_name = f'imports/{uuid.uuid4().hex}.csv'
            path = default_storage.save(tmp_name, uploaded)
            full_path = default_storage.path(path)

            # Store the path and type in session for the preview step.
            request.session['import_file'] = path
            request.session['import_type'] = data_type
            request.session['import_original_name'] = uploaded.name
            return redirect('import_preview')

    return render(request, 'employers/import_csv.html', {
        'error': error,
        'data_types': [('company', 'Company')],
    })


@login_required
def import_preview(request):
    """
    Step 2: Read the uploaded file, run the cleaning pipeline in dry-run mode,
    and show a preview table with warning badges.
    Step 3: On confirm POST, run the real import.
    """
    import os
    from django.core.files.storage import default_storage
    from .management.commands.import_csv import (
        HANDLERS, _normalise_header, handle_company_row,
    )

    file_path_rel = request.session.get('import_file')
    data_type     = request.session.get('import_type', 'company')
    original_name = request.session.get('import_original_name', 'file.csv')

    if not file_path_rel:
        messages.error(request, 'No file to preview. Please upload again.')
        return redirect('import_csv')

    full_path = default_storage.path(file_path_rel)

    # ── Parse the CSV through the cleaning pipeline ───────────────────────────
    import pandas as pd
    from .management.commands.import_csv import COMPANY_COLUMN_MAP

    preview_rows  = []   # list of {field: {'value': x, 'warn': msg|None}}
    all_warnings  = []
    duplicate_names = []
    total_rows    = 0
    parse_error   = None

    try:
        handler    = HANDLERS[data_type]
        column_map = handler['column_map']

        for encoding in ('utf-8-sig', 'latin-1', 'cp1252'):
            try:
                df = pd.read_csv(full_path, encoding=encoding, dtype=str)
                df = df.dropna(how='all').reset_index(drop=True)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise ValueError('Could not decode file with any supported encoding.')

        total_rows = len(df)

        # Map columns.
        mapped_fields = {}
        for col in df.columns:
            norm = _normalise_header(col)
            mapped_fields[col] = column_map.get(norm)  # None = unknown

        unknown_cols = [c for c, f in mapped_fields.items() if f is None]
        for col in unknown_cols:
            all_warnings.append(f"Column '{col}' not recognised and will be skipped")

        # Process first 20 rows for the preview table.
        from employers.models import Company
        for row_num, (_, row) in enumerate(df.head(20).iterrows(), start=2):
            row_data = {f: row[c] for c, f in mapped_fields.items() if f}
            row_warnings = []
            cleaned = handler['row_handler'](row_data, row_warnings, row_num)
            all_warnings.extend(row_warnings)

            # Check for duplicate.
            name = cleaned.get('name')
            is_dup = bool(name and Company.objects.filter(name__iexact=name).exists())
            if is_dup and name not in duplicate_names:
                duplicate_names.append(name)

            # Build per-cell warning map for badge colouring in template.
            cell_warns = {w.split("'")[1] if "'" in w else '': w for w in row_warnings}
            preview_rows.append({
                'name':        cleaned.get('name', ''),
                'date_added':  cleaned.get('date_added', ''),
                'industry':    cleaned.get('industry', ''),
                'sector':      cleaned.get('sector', ''),
                'country':     cleaned.get('country', ''),
                'signed_mou':  cleaned.get('signed_mou', False),
                'is_duplicate': is_dup,
                'row_warnings': row_warnings,
            })

    except Exception as exc:
        parse_error = str(exc)

    # ── Confirm: run the real import ──────────────────────────────────────────
    if request.method == 'POST' and 'confirm' in request.POST:
        from django.core.management import call_command
        from io import StringIO
        import sys

        update = request.POST.get('update_dupes') == '1'
        try:
            from .management.commands.import_csv import (
                Command as ImportCommand,
            )
            from django.db import transaction

            cmd = ImportCommand()
            cmd.stdout = cmd.stderr = open(os.devnull, 'w')

            handler_obj = HANDLERS[data_type]
            col_map     = handler_obj['column_map']

            for encoding in ('utf-8-sig', 'latin-1', 'cp1252'):
                try:
                    df2 = pd.read_csv(full_path, encoding=encoding, dtype=str)
                    df2 = df2.dropna(how='all').reset_index(drop=True)
                    break
                except UnicodeDecodeError:
                    continue

            mapped2 = {col: col_map.get(_normalise_header(col)) for col in df2.columns}
            counts  = {'created': 0, 'updated': 0, 'skipped': 0, 'error': 0}
            warn2   = []

            with transaction.atomic():
                for row_num, (_, row) in enumerate(df2.iterrows(), start=2):
                    row_data = {f: row[c] for c, f in mapped2.items() if f}
                    try:
                        cleaned2 = handler_obj['row_handler'](row_data, warn2, row_num)
                        result, _ = handler_obj['db_handler'](cleaned2, update, False, warn2, row_num)
                        counts[result] += 1
                    except Exception as e:
                        counts['error'] += 1
                        warn2.append(f'Row {row_num}: {e}')

            # Clean up temp file.
            default_storage.delete(file_path_rel)
            del request.session['import_file']
            del request.session['import_type']
            del request.session['import_original_name']

            messages.success(
                request,
                f'Import complete: {counts["created"]} created, '
                f'{counts["updated"]} updated, {counts["skipped"]} skipped, '
                f'{counts["error"]} errors.'
            )
            return redirect('company_list')

        except Exception as exc:
            messages.error(request, f'Import failed: {exc}')
            return redirect('import_csv')

    # Cancel: discard temp file.
    if request.method == 'POST' and 'cancel' in request.POST:
        try:
            default_storage.delete(file_path_rel)
        except Exception:
            pass
        for k in ('import_file', 'import_type', 'import_original_name'):
            request.session.pop(k, None)
        messages.info(request, 'Import cancelled.')
        return redirect('import_csv')

    return render(request, 'employers/import_preview.html', {
        'original_name':   original_name,
        'data_type':       data_type,
        'total_rows':      total_rows,
        'preview_rows':    preview_rows,
        'all_warnings':    all_warnings,
        'duplicate_names': duplicate_names,
        'parse_error':     parse_error,
    })
