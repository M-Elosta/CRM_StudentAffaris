-- Employer Relations Data Management System
-- PostgreSQL Schema
-- Run once to initialize the database

-- ============================================
-- CORE ENTITIES
-- ============================================

CREATE TABLE IF NOT EXISTS company (
    companyid        SERIAL PRIMARY KEY,
    companyname      TEXT NOT NULL,
    dateadded        DATE NOT NULL DEFAULT CURRENT_DATE,
    industry         TEXT NOT NULL,
    sector           TEXT NOT NULL CHECK (sector IN ('Government', 'NGO', 'Private', 'Semi-government', 'Startup')),
    country          TEXT NOT NULL,
    address          TEXT,
    website          TEXT,
    linkedinurl      TEXT,
    handshakeurl     TEXT,
    signedmou        BOOLEAN NOT NULL DEFAULT FALSE,
    favoriteemployer BOOLEAN NOT NULL DEFAULT FALSE,
    blacklisted      BOOLEAN NOT NULL DEFAULT FALSE,
    comment          TEXT,
    createdat        TIMESTAMPTZ DEFAULT NOW(),
    updatedat        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact (
    contactid            SERIAL PRIMARY KEY,
    companyid            INTEGER NOT NULL REFERENCES company(companyid) ON DELETE CASCADE,
    firstname            TEXT NOT NULL,
    lastname             TEXT NOT NULL,
    dateadded            DATE NOT NULL DEFAULT CURRENT_DATE,
    jobtitle             TEXT,
    emailaddress         TEXT NOT NULL,
    address              TEXT,
    country              TEXT,
    workphone            TEXT,
    mobile               TEXT,
    linkedinurl          TEXT,
    handshakeurl         TEXT,
    cmuqgraduate         BOOLEAN NOT NULL DEFAULT FALSE,
    major                TEXT,
    graduationyear       INTEGER,
    primarycontact       BOOLEAN NOT NULL DEFAULT FALSE,
    status               TEXT NOT NULL DEFAULT 'Mailable' CHECK (status IN ('Mailable', 'Non-mailable')),
    resumebook           BOOLEAN NOT NULL DEFAULT FALSE,
    eventinvitation      BOOLEAN NOT NULL DEFAULT FALSE,
    excludefrommailing   BOOLEAN NOT NULL DEFAULT FALSE,
    createdat            TIMESTAMPTZ DEFAULT NOW(),
    updatedat            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ENGAGEMENT & TRACKING ENTITIES
-- ============================================

CREATE TABLE IF NOT EXISTS potentialcollaboration (
    potentialcollaborationid SERIAL PRIMARY KEY,
    companyid                INTEGER NOT NULL REFERENCES company(companyid) ON DELETE CASCADE,
    comment                  TEXT,
    createdat                TIMESTAMPTZ DEFAULT NOW(),
    updatedat                TIMESTAMPTZ DEFAULT NOW()
);

-- Junction table for multi-valued collaboration opportunities
CREATE TABLE IF NOT EXISTS potentialcollaboration_opportunities (
    id                       SERIAL PRIMARY KEY,
    potentialcollaborationid INTEGER NOT NULL REFERENCES potentialcollaboration(potentialcollaborationid) ON DELETE CASCADE,
    opportunitytype          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outreachengagement (
    outreachengagementid SERIAL PRIMARY KEY,
    companyid            INTEGER NOT NULL REFERENCES company(companyid) ON DELETE CASCADE,
    contactid            INTEGER NOT NULL REFERENCES contact(contactid) ON DELETE CASCADE,
    interactiontype      TEXT NOT NULL CHECK (interactiontype IN ('Call', 'Meeting', 'Company Visit')),
    interactiondate      DATE NOT NULL,
    discussionitems      TEXT NOT NULL,
    actionplan           TEXT,
    followupdate         DATE,
    interactionstatus    TEXT NOT NULL DEFAULT 'In-progress' CHECK (interactionstatus IN ('Complete', 'In-progress')),
    createdat            TIMESTAMPTZ DEFAULT NOW(),
    updatedat            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recruitment (
    recruitmentid       SERIAL PRIMARY KEY,
    companyid           INTEGER NOT NULL REFERENCES company(companyid) ON DELETE CASCADE,
    contactid           INTEGER NOT NULL REFERENCES contact(contactid) ON DELETE CASCADE,
    dateposted          DATE NOT NULL DEFAULT CURRENT_DATE,
    opportunitytitle    TEXT NOT NULL,
    duration            TEXT,
    hiringstartdate     DATE,
    hiringenddate       DATE,
    country             TEXT,
    mode                TEXT NOT NULL CHECK (mode IN ('Onsite', 'Hybrid', 'Remote')),
    status              TEXT NOT NULL CHECK (status IN ('Paid', 'Unpaid')),
    payamount           TEXT,
    targetgroup         TEXT NOT NULL CHECK (targetgroup IN ('Qatari only', 'Open to all')),
    arabicspeaker       BOOLEAN NOT NULL DEFAULT FALSE,
    hiredstudentalumni  TEXT NOT NULL DEFAULT 'Not Reported' CHECK (hiredstudentalumni IN ('Yes', 'No', 'Not Reported')),
    comment             TEXT,
    createdat           TIMESTAMPTZ DEFAULT NOW(),
    updatedat           TIMESTAMPTZ DEFAULT NOW()
);

-- Junction tables for Recruitment multi-valued fields
CREATE TABLE IF NOT EXISTS recruitment_opportunitytype (
    id            SERIAL PRIMARY KEY,
    recruitmentid INTEGER NOT NULL REFERENCES recruitment(recruitmentid) ON DELETE CASCADE,
    type          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recruitment_collectapplications (
    id            SERIAL PRIMARY KEY,
    recruitmentid INTEGER NOT NULL REFERENCES recruitment(recruitmentid) ON DELETE CASCADE,
    channel       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recruitment_targetmajors (
    id            SERIAL PRIMARY KEY,
    recruitmentid INTEGER NOT NULL REFERENCES recruitment(recruitmentid) ON DELETE CASCADE,
    major         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recruitment_classlevel (
    id            SERIAL PRIMARY KEY,
    recruitmentid INTEGER NOT NULL REFERENCES recruitment(recruitmentid) ON DELETE CASCADE,
    classlevel    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hiringfeedback (
    hiringfeedbackid   SERIAL PRIMARY KEY,
    companyid          INTEGER NOT NULL REFERENCES company(companyid) ON DELETE CASCADE,
    contactid          INTEGER NOT NULL REFERENCES contact(contactid) ON DELETE CASCADE,
    feedbackprovider   TEXT NOT NULL CHECK (feedbackprovider IN ('Company', 'Student/Alumni', 'Other')),
    hiredstudentalumni TEXT NOT NULL CHECK (hiredstudentalumni IN ('Yes', 'No')),
    datereported       DATE NOT NULL,
    hiredstudentname   TEXT,
    comment            TEXT,
    createdat          TIMESTAMPTZ DEFAULT NOW(),
    updatedat          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS careerevent (
    careereventid     SERIAL PRIMARY KEY,
    companyid         INTEGER NOT NULL REFERENCES company(companyid) ON DELETE CASCADE,
    contactid         INTEGER NOT NULL REFERENCES contact(contactid) ON DELETE CASCADE,
    eventname         TEXT NOT NULL,
    eventdate         DATE NOT NULL,
    registeredstatus  TEXT NOT NULL CHECK (registeredstatus IN ('Attended', 'No-Show', 'Cancelled')),
    cmuqalumniatbooth BOOLEAN NOT NULL DEFAULT FALSE,
    comment           TEXT,
    createdat         TIMESTAMPTZ DEFAULT NOW(),
    updatedat         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studentledevent (
    studentledeventid     SERIAL PRIMARY KEY,
    companyid             INTEGER NOT NULL REFERENCES company(companyid) ON DELETE CASCADE,
    contactid             INTEGER NOT NULL REFERENCES contact(contactid) ON DELETE CASCADE,
    proposaldate          DATE NOT NULL,
    organizationname      TEXT NOT NULL,
    studentname           TEXT NOT NULL,
    studentemail          TEXT NOT NULL,
    studentphonenumber    TEXT NOT NULL,
    collaborationoutcome  TEXT NOT NULL DEFAULT 'Pending' CHECK (collaborationoutcome IN ('Completed', 'Pending')),
    eventdate             DATE,
    eventtitle            TEXT,
    comment               TEXT,
    createdat             TIMESTAMPTZ DEFAULT NOW(),
    updatedat             TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academicclassroomengagement (
    engagementid   SERIAL PRIMARY KEY,
    companyid      INTEGER NOT NULL REFERENCES company(companyid) ON DELETE CASCADE,
    contactid      INTEGER NOT NULL REFERENCES contact(contactid) ON DELETE CASCADE,
    engagementtype TEXT NOT NULL CHECK (
        engagementtype IN (
            'Guest Lecture', 'Panel Discussion', 'Community Project Partnership',
            'Mock Interviews', 'Research Collaboration', 'Competition/Hackathon Sponsorship', 'Other'
        )
    ),
    guestspeakername TEXT NOT NULL,
    guesttitle       TEXT NOT NULL,
    email            TEXT,
    phonenumber      TEXT,
    facultyname      TEXT NOT NULL,
    coursenumber     TEXT NOT NULL,
    coursetitle      TEXT NOT NULL,
    topictheme       TEXT NOT NULL,
    sessiondate      DATE NOT NULL,
    sessiontime      TEXT NOT NULL,
    comment          TEXT,
    createdat        TIMESTAMPTZ DEFAULT NOW(),
    updatedat        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- USERS (authentication)
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    userid             SERIAL PRIMARY KEY,
    username           TEXT UNIQUE NOT NULL,
    passwordhash       TEXT NOT NULL,
    role               TEXT NOT NULL DEFAULT 'admin',
    mustchangepassword BOOLEAN NOT NULL DEFAULT FALSE,
    createdat          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SAVED REPORTS (custom report builder configs)
-- ============================================

CREATE TABLE IF NOT EXISTS savedreports (
    reportid    SERIAL PRIMARY KEY,
    reportname  TEXT NOT NULL,
    entity      TEXT NOT NULL,
    columns     TEXT NOT NULL,
    filters     TEXT NOT NULL,
    sortby      TEXT,
    sortorder   TEXT DEFAULT 'ASC',
    charttype   TEXT,
    chartgroupby TEXT,
    createdat   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES (for search & filter performance)
-- ============================================

CREATE INDEX IF NOT EXISTS idx_company_name       ON company(companyname);
CREATE INDEX IF NOT EXISTS idx_company_country    ON company(country);
CREATE INDEX IF NOT EXISTS idx_company_blacklisted ON company(blacklisted);
CREATE INDEX IF NOT EXISTS idx_company_sector     ON company(sector);

CREATE INDEX IF NOT EXISTS idx_contact_company    ON contact(companyid);
CREATE INDEX IF NOT EXISTS idx_contact_name       ON contact(lastname, firstname);
CREATE INDEX IF NOT EXISTS idx_contact_email      ON contact(emailaddress);
CREATE INDEX IF NOT EXISTS idx_contact_status     ON contact(status);

CREATE INDEX IF NOT EXISTS idx_outreach_date      ON outreachengagement(interactiondate);
CREATE INDEX IF NOT EXISTS idx_outreach_followup  ON outreachengagement(followupdate);
CREATE INDEX IF NOT EXISTS idx_outreach_status    ON outreachengagement(interactionstatus);

CREATE INDEX IF NOT EXISTS idx_recruitment_date   ON recruitment(dateposted);
CREATE INDEX IF NOT EXISTS idx_recruitment_company ON recruitment(companyid);

CREATE INDEX IF NOT EXISTS idx_career_event_date  ON careerevent(eventdate);
CREATE INDEX IF NOT EXISTS idx_career_event_status ON careerevent(registeredstatus);

CREATE INDEX IF NOT EXISTS idx_academic_date      ON academicclassroomengagement(sessiondate);

-- ============================================
-- TRIGGER FUNCTION: Auto-update UpdatedAt timestamps
-- ============================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updatedat = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER FUNCTION: Blacklist cascade
-- When a company is blacklisted, set all its contacts to Non-mailable
-- ============================================

CREATE OR REPLACE FUNCTION blacklist_cascade_contacts()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.blacklisted = TRUE THEN
    UPDATE contact SET status = 'Non-mailable', updatedat = NOW()
    WHERE companyid = NEW.companyid;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS: Apply UpdatedAt on each table
-- ============================================

DROP TRIGGER IF EXISTS blacklist_cascade_contacts ON company;
CREATE TRIGGER blacklist_cascade_contacts
BEFORE UPDATE ON company
FOR EACH ROW EXECUTE FUNCTION blacklist_cascade_contacts();

DROP TRIGGER IF EXISTS company_updated ON company;
CREATE TRIGGER company_updated
BEFORE UPDATE ON company
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS contact_updated ON contact;
CREATE TRIGGER contact_updated
BEFORE UPDATE ON contact
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS outreach_updated ON outreachengagement;
CREATE TRIGGER outreach_updated
BEFORE UPDATE ON outreachengagement
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS recruitment_updated ON recruitment;
CREATE TRIGGER recruitment_updated
BEFORE UPDATE ON recruitment
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS collaboration_updated ON potentialcollaboration;
CREATE TRIGGER collaboration_updated
BEFORE UPDATE ON potentialcollaboration
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS hiring_feedback_updated ON hiringfeedback;
CREATE TRIGGER hiring_feedback_updated
BEFORE UPDATE ON hiringfeedback
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS career_event_updated ON careerevent;
CREATE TRIGGER career_event_updated
BEFORE UPDATE ON careerevent
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS student_event_updated ON studentledevent;
CREATE TRIGGER student_event_updated
BEFORE UPDATE ON studentledevent
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS academic_engagement_updated ON academicclassroomengagement;
CREATE TRIGGER academic_engagement_updated
BEFORE UPDATE ON academicclassroomengagement
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
