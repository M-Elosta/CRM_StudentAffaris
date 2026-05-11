"""
Django settings for the ERO (Employer Relations Office) Hub.

Reads configuration from a .env file in the project root so secrets
never live in source code. Falls back to safe defaults for development.
"""

import os
from pathlib import Path

# ── Base directory (the folder containing manage.py) ──────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent

# ── Read .env file ─────────────────────────────────────────────────────────────
# Simple key=value parser — no extra packages needed.
_env_path = BASE_DIR / '.env'
if _env_path.exists():
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _key, _, _val = _line.partition('=')
                os.environ.setdefault(_key.strip(), _val.strip())

# ── Security ───────────────────────────────────────────────────────────────────
SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY is not set. Copy .env.example to .env and set a value."
    )

# DEBUG defaults True so first-time setup works out of the box.
# Set DEBUG=False in .env before sharing with anyone outside localhost.
DEBUG = os.environ.get('DEBUG', 'True').lower() in ('true', '1', 'yes')

# Only serve to localhost — this app is not meant to be exposed to a network.
ALLOWED_HOSTS = ['localhost', '127.0.0.1']

# ── Installed apps ─────────────────────────────────────────────────────────────
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third-party
    'django_filters',
    # Our app
    'employers',
]

# ── Middleware ─────────────────────────────────────────────────────────────────
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'ero_hub.urls'

# ── Templates ──────────────────────────────────────────────────────────────────
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        # Look for templates inside each app's templates/ folder.
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'ero_hub.wsgi.application'

# ── Database — SQLite, stored in the project root ─────────────────────────────
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

# ── Password validation ────────────────────────────────────────────────────────
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ── Internationalisation ───────────────────────────────────────────────────────
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Qatar'
USE_I18N = True
USE_TZ = True

# ── Static files ───────────────────────────────────────────────────────────────
# Served from each app's static/ folder during development.
STATIC_URL = '/static/'
# Where `collectstatic` would gather files for production (not used locally).
STATIC_ROOT = BASE_DIR / 'staticfiles'

# ── Media files — temporary CSV uploads land here ─────────────────────────────
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# ── Authentication ─────────────────────────────────────────────────────────────
# After login, land on the dashboard. After logout, go to login page.
LOGIN_URL = '/login/'
LOGIN_REDIRECT_URL = '/'
LOGOUT_REDIRECT_URL = '/login/'

# ── Misc ───────────────────────────────────────────────────────────────────────
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# File upload limits — used in the CSV import view.
DATA_UPLOAD_MAX_MEMORY_SIZE = 52428800   # 50 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 52428800   # 50 MB
