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

from django.contrib.auth.decorators import login_required
from django.shortcuts import render


# ─────────────────────────────────────────────────────────────────────────────
# Dashboard
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def dashboard(request):
    """Landing page. Full stats and charts added in Step 6."""
    return render(request, 'employers/dashboard.html', {})


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
