"""
Database models for the ERO (Employer Relations Office) Hub.

Design principles:
- Nearly every field is nullable/blank so messy CSV imports never crash.
- Only fields explicitly marked REQUIRED are non-nullable.
- Adding a new field = one line here + makemigrations + migrate. Nothing else.
- __str__ methods are chosen to be human-readable in dropdowns and admin lists.
"""

from django.db import models


# ─────────────────────────────────────────────────────────────────────────────
# Choices — defined as module-level tuples so they can be referenced from
# forms, admin, and the import command without importing the whole model.
# ─────────────────────────────────────────────────────────────────────────────

INDUSTRY_CHOICES = [
    ('Tech', 'Tech'),
    ('Finance', 'Finance'),
    ('Healthcare', 'Healthcare'),
    ('Construction', 'Construction'),
    ('Education', 'Education'),
    ('Energy', 'Energy'),
    ('Consulting', 'Consulting'),
    ('Hospitality', 'Hospitality'),
    ('Telecommunications', 'Telecommunications'),
    ('Media', 'Media'),
    ('Other', 'Other'),
]

SECTOR_CHOICES = [
    ('Private', 'Private'),
    ('Semi-Government', 'Semi-Government'),
    ('Government', 'Government'),
    ('NGO', 'NGO'),
    ('Other', 'Other'),
]

INTERACTION_TYPE_CHOICES = [
    ('Email', 'Email'),
    ('Phone Call', 'Phone Call'),
    ('Meeting', 'Meeting'),
    ('Site Visit', 'Site Visit'),
    ('Workshop', 'Workshop'),
    ('Career Fair', 'Career Fair'),
    ('LinkedIn', 'LinkedIn'),
    ('Handshake', 'Handshake'),
    ('Other', 'Other'),
]

EVENT_TYPE_CHOICES = [
    ('Workshop', 'Workshop'),
    ('Information Session', 'Information Session'),
    ('Career Fair', 'Career Fair'),
    ('Networking Event', 'Networking Event'),
    ('Panel', 'Panel'),
    ('Other', 'Other'),
]

SEMESTER_CHOICES = [
    ('Spring', 'Spring'),
    ('Summer', 'Summer'),
    ('Fall', 'Fall'),
]


# ─────────────────────────────────────────────────────────────────────────────
class Company(models.Model):
    """
    Central model. Every other record links back to a company.

    is_blacklisted companies are excluded from outreach and event invitations.
    signed_mou means a Memorandum of Understanding has been signed.
    """

    # Original row number from the source spreadsheet — useful for traceability.
    sequence = models.IntegerField(null=True, blank=True)

    # REQUIRED — the unique identifier for a company.
    name = models.CharField(max_length=255, unique=True)

    date_added   = models.DateField(null=True, blank=True)
    industry     = models.CharField(max_length=100, blank=True, null=True, choices=INDUSTRY_CHOICES)
    sector       = models.CharField(max_length=100, blank=True, null=True, choices=SECTOR_CHOICES)
    country      = models.CharField(max_length=100, blank=True, null=True)
    address      = models.TextField(blank=True, null=True)

    website       = models.URLField(max_length=500, blank=True, null=True)
    linkedin_url  = models.URLField(max_length=500, blank=True, null=True)
    handshake_url = models.URLField(max_length=500, blank=True, null=True)

    signed_mou     = models.BooleanField(default=False)
    is_favorite    = models.BooleanField(default=False)
    is_blacklisted = models.BooleanField(default=False)

    comments = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Company'
        verbose_name_plural = 'Companies'

    def __str__(self):
        return self.name


# ─────────────────────────────────────────────────────────────────────────────
class Contact(models.Model):
    """
    A person at a company. A company can have many contacts.

    Expandability note: the real dataset may have more boolean flags than
    listed here (e.g. 'open_to_mentoring', 'attended_last_fair'). To add one:
      1. Add a BooleanField below with default=False.
      2. Run: python manage.py makemigrations && python manage.py migrate
      3. It will appear in the admin automatically.
      4. To filter by it: add one line in filters.py.
      5. To import it from CSV: add one entry in CONTACT_COLUMN_MAP in import_csv.py.
    """

    # REQUIRED — every contact must belong to a company.
    company = models.ForeignKey(
        Company,
        on_delete=models.CASCADE,
        related_name='contacts',
    )

    # REQUIRED — at minimum we need a first name.
    first_name = models.CharField(max_length=100)
    last_name  = models.CharField(max_length=100, blank=True, null=True)

    job_title = models.CharField(max_length=200, blank=True, null=True)
    email     = models.EmailField(blank=True, null=True)
    # CharField not PhoneField — handles any phone format without validation headaches.
    phone     = models.CharField(max_length=50, blank=True, null=True)

    # Status / role flags — easy to extend, see docstring above.
    is_primary                = models.BooleanField(default=False)
    is_blacklisted            = models.BooleanField(default=False)
    available_for_presentations = models.BooleanField(default=False)
    is_alumni                 = models.BooleanField(default=False)

    notes = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['company__name', 'last_name', 'first_name']
        verbose_name = 'Contact'

    def __str__(self):
        last = f' {self.last_name}' if self.last_name else ''
        return f'{self.first_name}{last} ({self.company.name})'

    @property
    def full_name(self):
        last = f' {self.last_name}' if self.last_name else ''
        return f'{self.first_name}{last}'


# ─────────────────────────────────────────────────────────────────────────────
class Interaction(models.Model):
    """
    Every engagement logged — meeting, email, phone call, site visit, etc.
    Links to a company (required) and optionally a specific contact.
    """

    # REQUIRED — what company was this with?
    company = models.ForeignKey(
        Company,
        on_delete=models.CASCADE,
        related_name='interactions',
    )

    # Optional — sometimes the interaction is general, not with a named person.
    contact = models.ForeignKey(
        Contact,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='interactions',
    )

    # REQUIRED
    interaction_type = models.CharField(
        max_length=50,
        choices=INTERACTION_TYPE_CHOICES,
    )
    date    = models.DateField()
    summary = models.TextField()

    follow_up_needed = models.BooleanField(default=False)
    follow_up_date   = models.DateField(null=True, blank=True)
    follow_up_notes  = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date']
        verbose_name = 'Interaction'

    def __str__(self):
        return f'{self.interaction_type} — {self.company.name} ({self.date})'


# ─────────────────────────────────────────────────────────────────────────────
class Event(models.Model):
    """
    Career fairs, workshops, info sessions, networking events.
    Many companies can participate in one event.
    """

    name       = models.CharField(max_length=255)
    event_type = models.CharField(max_length=50, choices=EVENT_TYPE_CHOICES)
    date       = models.DateField()
    location   = models.CharField(max_length=255, blank=True, null=True)
    description = models.TextField(blank=True, null=True)

    # A company can attend many events; an event can have many companies.
    companies = models.ManyToManyField(
        Company,
        blank=True,
        related_name='events',
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date']
        verbose_name = 'Event'

    def __str__(self):
        return f'{self.name} ({self.date})'


# ─────────────────────────────────────────────────────────────────────────────
class InternshipRecord(models.Model):
    """
    How many students a company hired, per year and semester.
    unique_together prevents duplicate entries for the same company/year/semester/program.
    """

    # REQUIRED
    company = models.ForeignKey(
        Company,
        on_delete=models.CASCADE,
        related_name='internship_records',
    )
    year = models.IntegerField()

    semester      = models.CharField(max_length=20, blank=True, null=True, choices=SEMESTER_CHOICES)
    student_count = models.PositiveIntegerField(default=0)
    # e.g. CS, Business, IS, InfoSys
    program       = models.CharField(max_length=100, blank=True, null=True)
    notes         = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-year', 'company__name']
        verbose_name = 'Internship Record'
        # Prevents logging the same company/year/semester/program twice.
        unique_together = [['company', 'year', 'semester', 'program']]

    def __str__(self):
        sem = f' {self.semester}' if self.semester else ''
        return f'{self.company.name} — {self.year}{sem} ({self.student_count} students)'
