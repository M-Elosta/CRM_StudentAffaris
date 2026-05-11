"""
Management command: import_csv

Usage:
  python manage.py import_csv --file data/Company.csv --type company
  python manage.py import_csv --file data/Company.csv --type company --dry-run
  python manage.py import_csv --file data/Company.csv --type company --update

Flags:
  --file      Path to the CSV file (required)
  --type      Data type to import: 'company' (more types easy to add — see HANDLERS)
  --dry-run   Validate and report without saving anything to the database
  --update    If a duplicate is found (by name), update the existing record
              instead of skipping it. Never overwrites a good value with blank.

Adding a new import type (e.g. 'contact'):
  1. Add a CONTACT_COLUMN_MAP dict below following the same pattern.
  2. Write a handle_contact_row(row_data, warnings, row_num) function.
  3. Add an entry to HANDLERS at the bottom of this file.
  That's it — the main pipeline picks it up automatically.
"""

import re
from datetime import date

import pandas as pd
from dateutil import parser as dateutil_parser
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from employers.models import Company


# ─────────────────────────────────────────────────────────────────────────────
# Column maps — normalised CSV header → model field name.
# Keys are lowercase, underscored versions of whatever header the CSV might use.
# Add entries here whenever a new CSV variant uses different column names.
# ─────────────────────────────────────────────────────────────────────────────

COMPANY_COLUMN_MAP = {
    'sequence':          'sequence',
    'seq':               'sequence',
    'company_name':      'name',
    'company':           'name',
    'name':              'name',
    'date_added':        'date_added',
    'date':              'date_added',
    'added':             'date_added',
    'industry':          'industry',
    'sector':            'sector',
    'country':           'country',
    'address':           'address',
    'website':           'website',
    'site':              'website',
    'linkedin_url':      'linkedin_url',
    'linkedin':          'linkedin_url',
    'handshake_url':     'handshake_url',
    'handshake':         'handshake_url',
    'signed_mou':        'signed_mou',
    'mou':               'signed_mou',
    'favorite_employer': 'is_favorite',
    'favorite':          'is_favorite',
    'is_favorite':       'is_favorite',
    'blacklisted':       'is_blacklisted',
    'is_blacklisted':    'is_blacklisted',
    'black_listed':      'is_blacklisted',
    'comments':          'comments',
    'notes':             'comments',
    'comment':           'comments',
}

# Maximum lengths matching the model field definitions.
COMPANY_MAX_LENGTHS = {
    'name':          255,
    'industry':      100,
    'sector':        100,
    'country':       100,
    'website':       500,
    'linkedin_url':  500,
    'handshake_url': 500,
}

# Fields that should be parsed as booleans.
COMPANY_BOOL_FIELDS = {'signed_mou', 'is_favorite', 'is_blacklisted'}

# Fields that should be parsed as dates.
COMPANY_DATE_FIELDS = {'date_added'}

# Fields that should be parsed as URLs.
COMPANY_URL_FIELDS = {'website', 'linkedin_url', 'handshake_url'}

# Fields that should be parsed as integers.
COMPANY_INT_FIELDS = {'sequence'}


# ─────────────────────────────────────────────────────────────────────────────
# Cleaning helpers
# ─────────────────────────────────────────────────────────────────────────────

def _normalise_header(raw: str) -> str:
    """
    Strip whitespace/BOM, lowercase, replace any non-alphanumeric run with '_'.
    'Company Name' → 'company_name',  ' LinkedIn URL ' → 'linkedin_url'
    """
    s = raw.strip().lstrip('﻿').lower()
    s = re.sub(r'[^a-z0-9]+', '_', s).strip('_')
    return s


def _parse_bool(value, field_name, row_num, warnings) -> bool:
    """
    Accept TRUE/FALSE, Yes/No, Y/N, 1/0 in any case.
    Anything unrecognised → False with a warning.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(int(value))
    if isinstance(value, str):
        v = value.strip().lower()
        if v in ('true', 'yes', 'y', '1'):
            return True
        if v in ('false', 'no', 'n', '0', ''):
            return False
    warnings.append(f"Row {row_num}: Unrecognised boolean '{value}' for '{field_name}', defaulting to False")
    return False


def _parse_date(value, field_name, row_num, warnings):
    """
    Try to parse a date using dateutil, which handles most common formats:
    MM/DD/YY, MM/DD/YYYY, YYYY-MM-DD, DD-MMM-YYYY, etc.
    Returns a date object or None on failure.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if not s:
        return None
    try:
        # dayfirst=False: treat ambiguous dates like 02/03/25 as MM/DD/YY (US format).
        return dateutil_parser.parse(s, dayfirst=False).date()
    except (ValueError, OverflowError):
        warnings.append(f"Row {row_num}: Could not parse date '{s}' for '{field_name}', set to blank")
        return None


def _parse_url(value, field_name, row_num, warnings):
    """
    Return a clean URL string, or None if the value is empty/invalid.
    If it looks like a URL but is missing the scheme, prepend https://.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    if not s:
        return None
    # Looks like it's meant to be a URL (has a dot and no spaces) but lacks scheme.
    if not s.startswith(('http://', 'https://')):
        if '.' in s and ' ' not in s:
            s = 'https://' + s
        else:
            warnings.append(f"Row {row_num}: '{s}' doesn't look like a URL for '{field_name}', set to blank")
            return None
    return s


def _parse_int(value, field_name, row_num, warnings):
    """Parse an integer field; return None on failure."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        return int(float(str(value).strip()))
    except (ValueError, TypeError):
        warnings.append(f"Row {row_num}: Could not parse integer '{value}' for '{field_name}', set to blank")
        return None


def _clean_string(value, field_name, max_lengths, row_num, warnings):
    """
    Strip whitespace from a string. Truncate if too long. Return None for blanks.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    if not s:
        return None
    max_len = max_lengths.get(field_name)
    if max_len and len(s) > max_len:
        warnings.append(
            f"Row {row_num}: Value for '{field_name}' truncated from {len(s)} to {max_len} chars"
        )
        s = s[:max_len]
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Row handler for Company
# ─────────────────────────────────────────────────────────────────────────────

def handle_company_row(mapped_row: dict, warnings: list, row_num: int) -> dict:
    """
    Clean a single row of mapped company data.
    Returns a dict of field→value ready to pass to Company(**data).
    """
    cleaned = {}

    for field, raw_value in mapped_row.items():
        if field in COMPANY_BOOL_FIELDS:
            cleaned[field] = _parse_bool(raw_value, field, row_num, warnings)
        elif field in COMPANY_DATE_FIELDS:
            cleaned[field] = _parse_date(raw_value, field, row_num, warnings)
        elif field in COMPANY_URL_FIELDS:
            cleaned[field] = _parse_url(raw_value, field, row_num, warnings)
        elif field in COMPANY_INT_FIELDS:
            cleaned[field] = _parse_int(raw_value, field, row_num, warnings)
        else:
            cleaned[field] = _clean_string(raw_value, field, COMPANY_MAX_LENGTHS, row_num, warnings)

    return cleaned


def import_company(cleaned: dict, update: bool, dry_run: bool, warnings: list, row_num: int):
    """
    Save or update a Company record.
    Returns ('created'|'updated'|'skipped', company_name_str).
    """
    name = cleaned.get('name')
    if not name:
        warnings.append(f"Row {row_num}: Skipped — 'name' is required but missing or blank")
        return 'skipped', '(no name)'

    # Duplicate check is case-insensitive.
    existing = Company.objects.filter(name__iexact=name).first()

    if existing:
        if not update:
            return 'skipped', name

        if not dry_run:
            # Update only fields that have a real value — never overwrite good data with blank.
            for field, value in cleaned.items():
                if value not in (None, '', False) or field in COMPANY_BOOL_FIELDS:
                    setattr(existing, field, value)
            existing.save()
        return 'updated', name
    else:
        if not dry_run:
            Company.objects.create(**cleaned)
        return 'created', name


# ─────────────────────────────────────────────────────────────────────────────
# Handler registry — add new types here
# ─────────────────────────────────────────────────────────────────────────────

HANDLERS = {
    'company': {
        'column_map':  COMPANY_COLUMN_MAP,
        'row_handler': handle_company_row,
        'db_handler':  import_company,
        'label':       'Company',
    },
    # To add contact import:
    # 'contact': {
    #     'column_map':  CONTACT_COLUMN_MAP,
    #     'row_handler': handle_contact_row,
    #     'db_handler':  import_contact,
    #     'label':       'Contact',
    # },
}


# ─────────────────────────────────────────────────────────────────────────────
# Management command
# ─────────────────────────────────────────────────────────────────────────────

class Command(BaseCommand):
    help = 'Import data from a CSV file into the ERO database.'

    def add_arguments(self, parser):
        parser.add_argument('--file',    required=True,  help='Path to the CSV file')
        parser.add_argument('--type',    required=True,  choices=list(HANDLERS.keys()),
                            help='Data type: ' + ', '.join(HANDLERS.keys()))
        parser.add_argument('--dry-run', action='store_true',
                            help='Validate and report without saving anything')
        parser.add_argument('--update',  action='store_true',
                            help='Update existing records instead of skipping duplicates')

    def handle(self, *args, **options):
        file_path = options['file']
        data_type = options['type']
        dry_run   = options['dry_run']
        update    = options['update']

        handler = HANDLERS[data_type]

        # ── 1. Read CSV ───────────────────────────────────────────────────────
        df = self._read_csv(file_path)
        total_rows = len(df)

        # ── 2. Normalise headers ──────────────────────────────────────────────
        column_map   = handler['column_map']
        norm_columns = {}     # original header → normalised key
        mapped_fields = {}    # normalised key → model field name (or None if unknown)

        for col in df.columns:
            norm = _normalise_header(col)
            norm_columns[col] = norm
            if norm in column_map:
                mapped_fields[col] = column_map[norm]
            else:
                mapped_fields[col] = None   # will be skipped with a warning

        # Warn once per unrecognised column (not once per row).
        unknown_cols = [c for c, f in mapped_fields.items() if f is None]
        warnings = []
        for col in unknown_cols:
            warnings.append(f"Column '{col}' not recognised and will be skipped")
            self.stdout.write(self.style.WARNING(f"  Warning: Column '{col}' not recognised and will be skipped"))

        # ── 3. Process rows ───────────────────────────────────────────────────
        counts = {'created': 0, 'updated': 0, 'skipped': 0, 'error': 0}

        try:
            with transaction.atomic():
                for row_num, (_, row) in enumerate(df.iterrows(), start=2):
                    # Build a dict keyed by model field name, skipping unknown columns.
                    row_data = {}
                    for col, field in mapped_fields.items():
                        if field is not None:
                            row_data[field] = row[col]

                    # Clean the row.
                    try:
                        cleaned = handler['row_handler'](row_data, warnings, row_num)
                        result, label = handler['db_handler'](cleaned, update, dry_run, warnings, row_num)
                        counts[result] += 1
                        if result == 'skipped':
                            self.stdout.write(f"  Skipped duplicate: {label}")
                    except Exception as exc:
                        counts['error'] += 1
                        warnings.append(f"Row {row_num}: Unexpected error — {exc}")
                        self.stdout.write(self.style.ERROR(f"  Error on row {row_num}: {exc}"))

                # If dry_run, roll back everything — no changes saved.
                if dry_run:
                    transaction.set_rollback(True)

        except Exception as exc:
            raise CommandError(f"Import aborted due to fatal error: {exc}")

        # ── 4. Final report ───────────────────────────────────────────────────
        self._print_report(file_path, data_type, dry_run, total_rows, counts, warnings)

    # ── helpers ───────────────────────────────────────────────────────────────

    def _read_csv(self, file_path: str) -> pd.DataFrame:
        """
        Try encodings in order: utf-8-sig (handles BOM), latin-1, cp1252.
        Drop completely empty rows after loading.
        """
        for encoding in ('utf-8-sig', 'latin-1', 'cp1252'):
            try:
                df = pd.read_csv(file_path, encoding=encoding, dtype=str)
                df = df.dropna(how='all')       # remove rows that are entirely empty
                df = df.reset_index(drop=True)
                self.stdout.write(f"  Read {len(df)} rows (encoding: {encoding})")
                return df
            except UnicodeDecodeError:
                continue
            except FileNotFoundError:
                raise CommandError(f"File not found: {file_path}")

        raise CommandError(f"Could not read '{file_path}' with any supported encoding (utf-8-sig, latin-1, cp1252)")

    def _print_report(self, file_path, data_type, dry_run, total_rows, counts, warnings):
        dry_tag = '  [DRY RUN — nothing was saved]' if dry_run else ''
        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS('=== Import Complete ===' + dry_tag))
        self.stdout.write(f"  File:                  {file_path}")
        self.stdout.write(f"  Type:                  {data_type}")
        self.stdout.write(f"  Total rows in CSV:     {total_rows}")
        self.stdout.write(self.style.SUCCESS(
            f"  Successfully created:  {counts['created']}"
        ))
        if counts['updated']:
            self.stdout.write(self.style.SUCCESS(
                f"  Updated (duplicates):  {counts['updated']}"
            ))
        self.stdout.write(f"  Skipped (duplicates):  {counts['skipped']}")
        if counts['error']:
            self.stdout.write(self.style.ERROR(f"  Errors:                {counts['error']}"))
        self.stdout.write(f"  Warnings:              {len(warnings)}")
        for w in warnings:
            self.stdout.write(f"    - {w}")
