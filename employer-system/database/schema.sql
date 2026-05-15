-- Employer Relations Data Management System
-- SQLite Schema (adapted from original PostgreSQL-style schema)
-- Run once to initialize the database

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ============================================
-- CORE ENTITIES
-- ============================================

CREATE TABLE IF NOT EXISTS Company (
    CompanyID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyName TEXT NOT NULL,
    DateAdded DATE NOT NULL DEFAULT (date('now')),
    Industry TEXT NOT NULL,
    Sector TEXT NOT NULL CHECK (Sector IN ('Government', 'NGO', 'Private', 'Semi-government', 'Startup')),
    Country TEXT NOT NULL,
    Address TEXT,
    Website TEXT,
    LinkedInURL TEXT,
    HandshakeURL TEXT,
    SignedMoU INTEGER DEFAULT 0,        -- 0/1 boolean
    FavoriteEmployer INTEGER DEFAULT 0,
    Blacklisted INTEGER DEFAULT 0,
    Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now')),
    UpdatedAt DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Contact (
    ContactID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    FirstName TEXT NOT NULL,
    LastName TEXT NOT NULL,
    DateAdded DATE NOT NULL DEFAULT (date('now')),
    JobTitle TEXT,
    EmailAddress TEXT NOT NULL,
    Address TEXT,
    Country TEXT,
    WorkPhone TEXT,
    Mobile TEXT,
    LinkedInURL TEXT,
    HandshakeURL TEXT,
    CMUQGraduate INTEGER DEFAULT 0,
    Major TEXT,
    GraduationYear INTEGER,
    PrimaryContact INTEGER DEFAULT 0,
    Status TEXT NOT NULL DEFAULT 'Mailable' CHECK (Status IN ('Mailable', 'Non-mailable')),
    ResumeBook INTEGER DEFAULT 0,
    EventInvitation INTEGER DEFAULT 0,
    ExcludeFromMailing INTEGER DEFAULT 0,
    CreatedAt DATETIME DEFAULT (datetime('now')),
    UpdatedAt DATETIME DEFAULT (datetime('now'))
);

-- ============================================
-- ENGAGEMENT & TRACKING ENTITIES
-- ============================================

CREATE TABLE IF NOT EXISTS PotentialCollaboration (
    PotentialCollaborationID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now'))
);

-- Junction table for multi-valued collaboration opportunities
CREATE TABLE IF NOT EXISTS PotentialCollaboration_Opportunities (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    PotentialCollaborationID INTEGER NOT NULL REFERENCES PotentialCollaboration(PotentialCollaborationID) ON DELETE CASCADE,
    OpportunityType TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS OutreachEngagement (
    OutreachEngagementID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    ContactID INTEGER NOT NULL REFERENCES Contact(ContactID) ON DELETE CASCADE,
    InteractionType TEXT NOT NULL CHECK (InteractionType IN ('Call', 'Meeting', 'Company Visit')),
    InteractionDate DATE NOT NULL,
    DiscussionItems TEXT NOT NULL,
    ActionPlan TEXT,
    FollowUpDate DATE,
    InteractionStatus TEXT NOT NULL DEFAULT 'In-progress' CHECK (InteractionStatus IN ('Complete', 'In-progress')),
    CreatedAt DATETIME DEFAULT (datetime('now')),
    UpdatedAt DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Recruitment (
    RecruitmentID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    ContactID INTEGER NOT NULL REFERENCES Contact(ContactID) ON DELETE CASCADE,
    DatePosted DATE NOT NULL DEFAULT (date('now')),
    OpportunityTitle TEXT NOT NULL,
    Duration TEXT,
    HiringStartDate DATE,
    HiringEndDate DATE,
    Country TEXT,
    Mode TEXT NOT NULL CHECK (Mode IN ('Onsite', 'Hybrid', 'Remote')),
    Status TEXT NOT NULL CHECK (Status IN ('Paid', 'Unpaid')),
    PayAmount TEXT,
    TargetGroup TEXT NOT NULL CHECK (TargetGroup IN ('Qatari only', 'Open to all')),
    ArabicSpeaker INTEGER DEFAULT 0,
    HiredStudentAlumni TEXT NOT NULL DEFAULT 'Not Reported' CHECK (HiredStudentAlumni IN ('Yes', 'No', 'Not Reported')),
    Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now')),
    UpdatedAt DATETIME DEFAULT (datetime('now'))
);

-- Junction tables for Recruitment multi-valued fields
CREATE TABLE IF NOT EXISTS Recruitment_OpportunityType (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    RecruitmentID INTEGER NOT NULL REFERENCES Recruitment(RecruitmentID) ON DELETE CASCADE,
    Type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Recruitment_CollectApplications (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    RecruitmentID INTEGER NOT NULL REFERENCES Recruitment(RecruitmentID) ON DELETE CASCADE,
    Channel TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Recruitment_TargetMajors (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    RecruitmentID INTEGER NOT NULL REFERENCES Recruitment(RecruitmentID) ON DELETE CASCADE,
    Major TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Recruitment_ClassLevel (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    RecruitmentID INTEGER NOT NULL REFERENCES Recruitment(RecruitmentID) ON DELETE CASCADE,
    ClassLevel TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS HiringFeedback (
    HiringFeedbackID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    ContactID INTEGER NOT NULL REFERENCES Contact(ContactID) ON DELETE CASCADE,
    FeedbackProvider TEXT NOT NULL CHECK (FeedbackProvider IN ('Company', 'Student/Alumni', 'Other')),
    HiredStudentAlumni TEXT NOT NULL CHECK (HiredStudentAlumni IN ('Yes', 'No')),
    DateReported DATE NOT NULL,
    HiredStudentName TEXT,
    Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS CareerEvent (
    CareerEventID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    ContactID INTEGER NOT NULL REFERENCES Contact(ContactID) ON DELETE CASCADE,
    EventName TEXT NOT NULL,
    EventDate DATE NOT NULL,
    RegisteredStatus TEXT NOT NULL CHECK (RegisteredStatus IN ('Attended', 'No-Show', 'Cancelled')),
    CMUQAlumniAtBooth INTEGER DEFAULT 0,
    Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS StudentLedEvent (
    StudentLedEventID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    ContactID INTEGER NOT NULL REFERENCES Contact(ContactID) ON DELETE CASCADE,
    ProposalDate DATE NOT NULL,
    OrganizationName TEXT NOT NULL,
    StudentName TEXT NOT NULL,
    StudentEmail TEXT NOT NULL,
    StudentPhoneNumber TEXT NOT NULL,
    CollaborationOutcome TEXT NOT NULL DEFAULT 'Pending' CHECK (CollaborationOutcome IN ('Completed', 'Pending')),
    EventDate DATE,
    EventTitle TEXT,
    Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS AcademicClassroomEngagement (
    EngagementID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    ContactID INTEGER NOT NULL REFERENCES Contact(ContactID) ON DELETE CASCADE,
    EngagementType TEXT NOT NULL CHECK (
        EngagementType IN (
            'Guest Lecture', 'Panel Discussion', 'Community Project Partnership',
            'Mock Interviews', 'Research Collaboration', 'Competition/Hackathon Sponsorship', 'Other'
        )
    ),
    GuestSpeakerName TEXT NOT NULL,
    GuestTitle TEXT NOT NULL,
    Email TEXT,
    PhoneNumber TEXT,
    FacultyName TEXT NOT NULL,
    CourseNumber TEXT NOT NULL,
    CourseTitle TEXT NOT NULL,
    TopicTheme TEXT NOT NULL,
    SessionDate DATE NOT NULL,
    SessionTime TEXT NOT NULL,  -- SQLite has no TIME type, store as "HH:MM"
    Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now'))
);

-- ============================================
-- INDEXES (for search & filter performance)
-- ============================================

CREATE INDEX IF NOT EXISTS idx_company_name ON Company(CompanyName);
CREATE INDEX IF NOT EXISTS idx_company_country ON Company(Country);
CREATE INDEX IF NOT EXISTS idx_company_blacklisted ON Company(Blacklisted);
CREATE INDEX IF NOT EXISTS idx_company_sector ON Company(Sector);

CREATE INDEX IF NOT EXISTS idx_contact_company ON Contact(CompanyID);
CREATE INDEX IF NOT EXISTS idx_contact_name ON Contact(LastName, FirstName);
CREATE INDEX IF NOT EXISTS idx_contact_email ON Contact(EmailAddress);
CREATE INDEX IF NOT EXISTS idx_contact_status ON Contact(Status);

CREATE INDEX IF NOT EXISTS idx_outreach_date ON OutreachEngagement(InteractionDate);
CREATE INDEX IF NOT EXISTS idx_outreach_followup ON OutreachEngagement(FollowUpDate);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON OutreachEngagement(InteractionStatus);

CREATE INDEX IF NOT EXISTS idx_recruitment_date ON Recruitment(DatePosted);
CREATE INDEX IF NOT EXISTS idx_recruitment_company ON Recruitment(CompanyID);

CREATE INDEX IF NOT EXISTS idx_career_event_date ON CareerEvent(EventDate);
CREATE INDEX IF NOT EXISTS idx_career_event_status ON CareerEvent(RegisteredStatus);

CREATE INDEX IF NOT EXISTS idx_academic_date ON AcademicClassroomEngagement(SessionDate);

-- ============================================
-- TRIGGER: Auto-update blacklist cascade
-- When a company is blacklisted, set all its contacts to Non-mailable
-- ============================================

CREATE TRIGGER IF NOT EXISTS blacklist_cascade_contacts
AFTER UPDATE OF Blacklisted ON Company
WHEN NEW.Blacklisted = 1
BEGIN
    UPDATE Contact SET Status = 'Non-mailable', UpdatedAt = datetime('now')
    WHERE CompanyID = NEW.CompanyID;
END;

-- ============================================
-- TRIGGER: Auto-update UpdatedAt timestamps
-- ============================================

CREATE TRIGGER IF NOT EXISTS company_updated
AFTER UPDATE ON Company
BEGIN
    UPDATE Company SET UpdatedAt = datetime('now') WHERE CompanyID = NEW.CompanyID;
END;

CREATE TRIGGER IF NOT EXISTS contact_updated
AFTER UPDATE ON Contact
BEGIN
    UPDATE Contact SET UpdatedAt = datetime('now') WHERE ContactID = NEW.ContactID;
END;

CREATE TRIGGER IF NOT EXISTS outreach_updated
AFTER UPDATE ON OutreachEngagement
BEGIN
    UPDATE OutreachEngagement SET UpdatedAt = datetime('now') WHERE OutreachEngagementID = NEW.OutreachEngagementID;
END;

CREATE TRIGGER IF NOT EXISTS recruitment_updated
AFTER UPDATE ON Recruitment
BEGIN
    UPDATE Recruitment SET UpdatedAt = datetime('now') WHERE RecruitmentID = NEW.RecruitmentID;
END;

-- ============================================
-- USERS (authentication)
-- ============================================

CREATE TABLE IF NOT EXISTS Users (
    UserID       INTEGER PRIMARY KEY AUTOINCREMENT,
    Username     TEXT UNIQUE NOT NULL,
    PasswordHash TEXT NOT NULL,
    CreatedAt    DATETIME DEFAULT (datetime('now'))
);
