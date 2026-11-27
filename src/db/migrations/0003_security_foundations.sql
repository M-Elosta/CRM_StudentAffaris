-- 0003 — Security foundations.
--
-- Additive only: new columns and new tables. No existing row is removed and
-- no existing column changes meaning. The one data change is the role rename
-- viewer -> readonly.
--
--   1. User accounts: identity, status, single sign-on link, lockout, MFA.
--   2. Record tables: who created / changed / deleted, soft delete, version.
--   3. Audit log: append-only, protected by triggers.
--   4. Sessions: stored in the database so access can be revoked at once.
--   5. Settings: retention periods and other values an admin can change.

-- ── 1. User accounts ────────────────────────────────────────────────────────
ALTER TABLE Users ADD COLUMN Email TEXT;
ALTER TABLE Users ADD COLUMN DisplayName TEXT;
ALTER TABLE Users ADD COLUMN AndrewID TEXT;
ALTER TABLE Users ADD COLUMN IsActive INTEGER NOT NULL DEFAULT 1;
-- How the account signs in: 'local' (password), 'oidc' or 'saml'.
ALTER TABLE Users ADD COLUMN AuthProvider TEXT NOT NULL DEFAULT 'local';
-- The identity provider's stable identifier for this person.
ALTER TABLE Users ADD COLUMN ExternalSubject TEXT;
ALTER TABLE Users ADD COLUMN LastLoginAt TEXT;
ALTER TABLE Users ADD COLUMN FailedLoginCount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Users ADD COLUMN LockedUntil TEXT;
ALTER TABLE Users ADD COLUMN PasswordChangedAt TEXT;
-- TOTP secret, encrypted with the application's data key. Never stored in clear.
ALTER TABLE Users ADD COLUMN TotpSecret TEXT;
ALTER TABLE Users ADD COLUMN TotpEnabledAt TEXT;
-- Last accepted TOTP time step, so a code cannot be used twice.
ALTER TABLE Users ADD COLUMN TotpLastStep INTEGER;
ALTER TABLE Users ADD COLUMN UpdatedAt TEXT;
ALTER TABLE Users ADD COLUMN CreatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE Users ADD COLUMN DeactivatedAt TEXT;
ALTER TABLE Users ADD COLUMN DeactivatedBy INTEGER REFERENCES Users(UserID);

-- Roles are now admin, staff, readonly, student_worker.
UPDATE Users SET Role = 'readonly' WHERE Role = 'viewer';
-- Anything unrecognised gets the least privileged role, never more.
UPDATE Users SET Role = 'student_worker' WHERE Role NOT IN ('admin', 'staff', 'readonly', 'student_worker');
UPDATE Users SET UpdatedAt = COALESCE(CreatedAt, datetime('now')) WHERE UpdatedAt IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON Users(lower(Email)) WHERE Email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_andrew_id ON Users(lower(AndrewID)) WHERE AndrewID IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external_subject
  ON Users(AuthProvider, ExternalSubject) WHERE ExternalSubject IS NOT NULL;

-- ── 2. Record tables ────────────────────────────────────────────────────────
-- CreatedBy / UpdatedBy / DeletedBy point at Users. Accounts are therefore
-- deactivated, never deleted. DeletedAt marks a soft-deleted record: hidden
-- from normal views, recoverable from the trash. RowVersion increases by one
-- on every save and is what a save is checked against.

ALTER TABLE Company ADD COLUMN CreatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE Company ADD COLUMN UpdatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE Company ADD COLUMN DeletedAt TEXT;
ALTER TABLE Company ADD COLUMN DeletedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE Company ADD COLUMN RowVersion INTEGER NOT NULL DEFAULT 1;

ALTER TABLE Contact ADD COLUMN CreatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE Contact ADD COLUMN UpdatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE Contact ADD COLUMN DeletedAt TEXT;
ALTER TABLE Contact ADD COLUMN DeletedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE Contact ADD COLUMN RowVersion INTEGER NOT NULL DEFAULT 1;

ALTER TABLE OutreachEngagement ADD COLUMN CreatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE OutreachEngagement ADD COLUMN UpdatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE OutreachEngagement ADD COLUMN DeletedAt TEXT;
ALTER TABLE OutreachEngagement ADD COLUMN DeletedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE OutreachEngagement ADD COLUMN RowVersion INTEGER NOT NULL DEFAULT 1;

ALTER TABLE Recruitment ADD COLUMN CreatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE Recruitment ADD COLUMN UpdatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE Recruitment ADD COLUMN DeletedAt TEXT;
ALTER TABLE Recruitment ADD COLUMN DeletedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE Recruitment ADD COLUMN RowVersion INTEGER NOT NULL DEFAULT 1;

ALTER TABLE CareerEvent ADD COLUMN CreatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE CareerEvent ADD COLUMN UpdatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE CareerEvent ADD COLUMN DeletedAt TEXT;
ALTER TABLE CareerEvent ADD COLUMN DeletedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE CareerEvent ADD COLUMN RowVersion INTEGER NOT NULL DEFAULT 1;

ALTER TABLE StudentLedEvent ADD COLUMN CreatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE StudentLedEvent ADD COLUMN UpdatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE StudentLedEvent ADD COLUMN DeletedAt TEXT;
ALTER TABLE StudentLedEvent ADD COLUMN DeletedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE StudentLedEvent ADD COLUMN RowVersion INTEGER NOT NULL DEFAULT 1;

ALTER TABLE AcademicClassroomEngagement ADD COLUMN CreatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE AcademicClassroomEngagement ADD COLUMN UpdatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE AcademicClassroomEngagement ADD COLUMN DeletedAt TEXT;
ALTER TABLE AcademicClassroomEngagement ADD COLUMN DeletedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE AcademicClassroomEngagement ADD COLUMN RowVersion INTEGER NOT NULL DEFAULT 1;

ALTER TABLE HiringFeedback ADD COLUMN CreatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE HiringFeedback ADD COLUMN UpdatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE HiringFeedback ADD COLUMN DeletedAt TEXT;
ALTER TABLE HiringFeedback ADD COLUMN DeletedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE HiringFeedback ADD COLUMN RowVersion INTEGER NOT NULL DEFAULT 1;

ALTER TABLE PotentialCollaboration ADD COLUMN CreatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE PotentialCollaboration ADD COLUMN UpdatedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE PotentialCollaboration ADD COLUMN DeletedAt TEXT;
ALTER TABLE PotentialCollaboration ADD COLUMN DeletedBy INTEGER REFERENCES Users(UserID);
ALTER TABLE PotentialCollaboration ADD COLUMN RowVersion INTEGER NOT NULL DEFAULT 1;

-- Normal views only read live records, so these indexes cover that case.
CREATE INDEX IF NOT EXISTS idx_company_live ON Company(CompanyName) WHERE DeletedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_contact_live ON Contact(CompanyID) WHERE DeletedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_outreach_live ON OutreachEngagement(CompanyID, InteractionDate) WHERE DeletedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_recruitment_live ON Recruitment(CompanyID, DatePosted) WHERE DeletedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_career_event_live ON CareerEvent(CompanyID, EventDate) WHERE DeletedAt IS NULL;

-- ── 3. Audit log ────────────────────────────────────────────────────────────
-- One row per event: who did what to which record, and when. ActorUserID has
-- no foreign key on purpose: the log must survive any change to other tables.
-- The actor's name and role are copied in as they were at the time.
CREATE TABLE IF NOT EXISTS AuditLog (
    AuditID      INTEGER PRIMARY KEY AUTOINCREMENT,
    OccurredAt   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ActorUserID  INTEGER,
    ActorName    TEXT NOT NULL,
    ActorRole    TEXT,
    -- create, update, delete, restore, purge, view_sensitive, export, import,
    -- merge, login, login_failed, logout, user_create, user_update,
    -- user_deactivate, user_reactivate, settings_change, privacy_export,
    -- privacy_erase, audit_purge
    Action       TEXT NOT NULL,
    EntityType   TEXT,
    EntityID     INTEGER,
    -- What the record was called at the time, e.g. the employer name.
    EntityLabel  TEXT,
    -- JSON object: { "Field": [before, after], ... } for changed fields only.
    Changes      TEXT,
    -- JSON object with context: filters of an export, number of rows, reason.
    Details      TEXT,
    RequestID    TEXT,
    IPAddress    TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON AuditLog(EntityType, EntityID, AuditID);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON AuditLog(ActorUserID, AuditID);
CREATE INDEX IF NOT EXISTS idx_audit_action ON AuditLog(Action, AuditID);
CREATE INDEX IF NOT EXISTS idx_audit_time ON AuditLog(OccurredAt);

-- The single row of this table is the only way to loosen the protection
-- below, and only for two purposes: removing entries older than the retention
-- period, and blanking personal data about one person after an erasure
-- request. Both are done by the application inside one transaction that sets
-- the value, does the work, clears the value and writes its own audit entry.
CREATE TABLE IF NOT EXISTS AuditMaintenance (
    ID               INTEGER PRIMARY KEY CHECK (ID = 1),
    PurgeBefore      TEXT,
    RedactEntityType TEXT,
    RedactEntityID   INTEGER
);
INSERT OR IGNORE INTO AuditMaintenance (ID) VALUES (1);

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON AuditLog
WHEN NOT EXISTS (
    SELECT 1 FROM AuditMaintenance
    WHERE PurgeBefore IS NOT NULL AND OLD.OccurredAt < PurgeBefore
)
BEGIN
    SELECT RAISE(ABORT, 'The audit log is append-only: entries cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON AuditLog
WHEN NOT EXISTS (
        SELECT 1 FROM AuditMaintenance
        WHERE RedactEntityType IS NOT NULL
          AND RedactEntityType = OLD.EntityType
          AND RedactEntityID = OLD.EntityID
     )
     -- Even during an erasure, only the three free-text columns may change.
     OR NEW.AuditID IS NOT OLD.AuditID
     OR NEW.OccurredAt IS NOT OLD.OccurredAt
     OR NEW.ActorUserID IS NOT OLD.ActorUserID
     OR NEW.ActorName IS NOT OLD.ActorName
     OR NEW.ActorRole IS NOT OLD.ActorRole
     OR NEW.Action IS NOT OLD.Action
     OR NEW.EntityType IS NOT OLD.EntityType
     OR NEW.EntityID IS NOT OLD.EntityID
     OR NEW.RequestID IS NOT OLD.RequestID
     OR NEW.IPAddress IS NOT OLD.IPAddress
BEGIN
    SELECT RAISE(ABORT, 'The audit log is append-only: entries cannot be changed');
END;

-- ── 4. Sessions ─────────────────────────────────────────────────────────────
-- SessionHash is the SHA-256 of the session identifier, so a copy of the
-- database (a backup, for instance) cannot be used to take over a session.
-- Times are milliseconds since the Unix epoch.
CREATE TABLE IF NOT EXISTS Sessions (
    SessionHash TEXT PRIMARY KEY,
    UserID      INTEGER REFERENCES Users(UserID) ON DELETE CASCADE,
    Data        TEXT NOT NULL,
    CreatedAt   INTEGER NOT NULL,
    LastSeenAt  INTEGER NOT NULL,
    ExpiresAt   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON Sessions(UserID);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON Sessions(ExpiresAt);

-- ── 5. Settings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Settings (
    Key       TEXT PRIMARY KEY,
    Value     TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UpdatedBy INTEGER REFERENCES Users(UserID)
);

-- Data retention defaults (days). An admin can change them in Settings.
INSERT OR IGNORE INTO Settings (Key, Value) VALUES
    ('retention.trash_days', '90'),           -- soft-deleted records are purged after this
    ('retention.audit_log_days', '1095'),     -- audit entries are kept this long (3 years)
    ('retention.inactive_contact_days', '1825'), -- contacts untouched this long are listed for review (5 years)
    ('retention.session_idle_minutes', '30'),
    ('relationship.dormant_days', '180');     -- an employer with no activity this long counts as dormant
