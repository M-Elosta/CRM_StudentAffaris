# ERO Database — Employer Relations Office

A local web application for managing company relationships, contacts, interactions, events, and internship records at the CMU-Q Employer Relations Office.

---

## First-Time Setup (one time only)

1. **Make sure Python 3.10+ is installed** on your computer.

2. **Open a terminal**
   - Windows: search for "Command Prompt" or "PowerShell"
   - Mac: open the "Terminal" app

3. **Navigate to this project folder:**
   ```
   cd path/to/CRM_StudentAffaris
   ```

4. **Create a virtual environment:**
   ```
   python -m venv venv
   ```

5. **Activate it:**
   - Windows: `venv\Scripts\activate`
   - Mac/Linux: `source venv/bin/activate`

6. **Install dependencies:**
   ```
   pip install -r requirements.txt
   ```

7. **Set up the database:**
   ```
   python manage.py migrate
   ```

8. **Create your login:**
   ```
   python manage.py createsuperuser
   ```
   Follow the prompts to choose a username and password.

9. **(Optional) Load sample data:**
   ```
   python manage.py import_csv --file data/Company.csv --type company
   ```

---

## Running the App (every time)

1. Open a terminal, navigate to the project folder.

2. Activate the environment:
   - Windows: `venv\Scripts\activate`
   - Mac/Linux: `source venv/bin/activate`

3. Start the server:
   ```
   python manage.py runserver
   ```

4. Open your browser to: **http://localhost:8000**

5. Log in with the username and password you created.

---

## Importing Data

### From the website:
1. Click **Import CSV** in the navigation bar.
2. Upload your file and select the data type.
3. Review the preview — warnings are highlighted in yellow.
4. Click **Confirm Import**.

### From the command line:
```
# Import (skip duplicates)
python manage.py import_csv --file path/to/file.csv --type company

# Preview without saving anything
python manage.py import_csv --file path/to/file.csv --type company --dry-run

# Import and update existing records if a duplicate name is found
python manage.py import_csv --file path/to/file.csv --type company --update
```

---

## Backing Up Your Data

Your entire database is stored in a single file: **`db.sqlite3`**

To back up: copy `db.sqlite3` to a USB drive, Google Drive, or any safe location.

To restore: replace `db.sqlite3` with your backup copy, then restart the server.

**Recommended:** back up weekly, or before any large import.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "SECRET_KEY is not set" | Make sure `.env` file exists in the project folder. Copy `.env.example` to `.env` and set a key. |
| Can't log in | Run `python manage.py createsuperuser` to create a new account. |
| Page won't load | Make sure the server is running (`python manage.py runserver`). |
| Import fails | Try the `--dry-run` flag first to see what errors appear. |
| Database seems wrong | Restore from your `db.sqlite3` backup. |

---

## For IT Staff — Technical Notes

- **Framework:** Django 5.2, Python 3.11+
- **Database:** SQLite (`db.sqlite3` in project root)
- **Port:** 8000 (change with `python manage.py runserver 0.0.0.0:8080`)
- **Static files:** All CSS/JS bundled locally — no internet required to run the app
- **Adding a new model field:** Add to `employers/models.py`, run `makemigrations` + `migrate`
- **Adding a CSV column mapping:** Add one entry to `COMPANY_COLUMN_MAP` in `employers/management/commands/import_csv.py`
- **Logs:** Django logs to stdout when running with `runserver`
