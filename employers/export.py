"""
Export helpers — produce .xlsx or .csv downloads from QuerySets.

Used by:
  - Admin actions (export selected companies)
  - The /reports/ view (export filtered results)

openpyxl is used for Excel so we can apply formatting (bold headers,
auto-width columns). csv is stdlib so no extra package needed for CSV.
"""

import csv
import io
from datetime import date

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
from django.http import HttpResponse


# ── Excel ──────────────────────────────────────────────────────────────────────

def companies_to_excel(queryset):
    """
    Return an HttpResponse that downloads a .xlsx file for the given Company queryset.
    Bold header row, auto-width columns, freeze pane on row 1.
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Companies'

    headers = [
        'Sequence', 'Name', 'Date Added', 'Industry', 'Sector', 'Country',
        'Address', 'Website', 'LinkedIn URL', 'Handshake URL',
        'Signed MoU', 'Favorite', 'Blacklisted', 'Comments',
        'Created At',
    ]

    # Header row — bold, light blue background.
    header_font = Font(bold=True, color='FFFFFF')
    header_fill = PatternFill(start_color='2563EB', end_color='2563EB', fill_type='solid')

    for col_num, header in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center')

    # Data rows
    for row_num, company in enumerate(queryset, start=2):
        ws.cell(row=row_num, column=1,  value=company.sequence)
        ws.cell(row=row_num, column=2,  value=company.name)
        ws.cell(row=row_num, column=3,  value=company.date_added.isoformat() if company.date_added else '')
        ws.cell(row=row_num, column=4,  value=company.industry or '')
        ws.cell(row=row_num, column=5,  value=company.sector or '')
        ws.cell(row=row_num, column=6,  value=company.country or '')
        ws.cell(row=row_num, column=7,  value=company.address or '')
        ws.cell(row=row_num, column=8,  value=company.website or '')
        ws.cell(row=row_num, column=9,  value=company.linkedin_url or '')
        ws.cell(row=row_num, column=10, value=company.handshake_url or '')
        ws.cell(row=row_num, column=11, value='Yes' if company.signed_mou else 'No')
        ws.cell(row=row_num, column=12, value='Yes' if company.is_favorite else 'No')
        ws.cell(row=row_num, column=13, value='Yes' if company.is_blacklisted else 'No')
        ws.cell(row=row_num, column=14, value=company.comments or '')
        ws.cell(row=row_num, column=15, value=company.created_at.strftime('%Y-%m-%d') if company.created_at else '')

    # Auto-width: measure the longest value in each column.
    for col_num in range(1, len(headers) + 1):
        col_letter = get_column_letter(col_num)
        max_len = len(headers[col_num - 1])
        for row_num in range(2, ws.max_row + 1):
            val = ws.cell(row=row_num, column=col_num).value
            if val:
                max_len = max(max_len, len(str(val)))
        # Cap width at 60 so address columns don't blow out the sheet.
        ws.column_dimensions[col_letter].width = min(max_len + 2, 60)

    # Freeze the header row so it stays visible when scrolling.
    ws.freeze_panes = 'A2'

    # Stream the file as an HTTP download.
    today = date.today().isoformat()
    filename = f'companies_{today}.xlsx'
    response = HttpResponse(
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    wb.save(response)
    return response


def companies_to_csv(queryset):
    """
    Return an HttpResponse that downloads a .csv file for the given Company queryset.
    """
    today = date.today().isoformat()
    filename = f'companies_{today}.csv'
    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'

    writer = csv.writer(response)
    writer.writerow([
        'Sequence', 'Name', 'Date Added', 'Industry', 'Sector', 'Country',
        'Address', 'Website', 'LinkedIn URL', 'Handshake URL',
        'Signed MoU', 'Favorite', 'Blacklisted', 'Comments',
    ])
    for company in queryset:
        writer.writerow([
            company.sequence,
            company.name,
            company.date_added.isoformat() if company.date_added else '',
            company.industry or '',
            company.sector or '',
            company.country or '',
            company.address or '',
            company.website or '',
            company.linkedin_url or '',
            company.handshake_url or '',
            'Yes' if company.signed_mou else 'No',
            'Yes' if company.is_favorite else 'No',
            'Yes' if company.is_blacklisted else 'No',
            company.comments or '',
        ])
    return response
