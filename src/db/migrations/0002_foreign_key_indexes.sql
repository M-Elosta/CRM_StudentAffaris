-- 0002 — Indexes on foreign key columns.
--
-- Additive only. Without these, loading an employer profile or deleting a
-- parent row scans every activity table in full.

CREATE INDEX IF NOT EXISTS idx_outreach_company ON OutreachEngagement(CompanyID);
CREATE INDEX IF NOT EXISTS idx_outreach_contact ON OutreachEngagement(ContactID);

CREATE INDEX IF NOT EXISTS idx_recruitment_contact ON Recruitment(ContactID);
CREATE INDEX IF NOT EXISTS idx_recruitment_type_recruitment ON Recruitment_OpportunityType(RecruitmentID);
CREATE INDEX IF NOT EXISTS idx_recruitment_channel_recruitment ON Recruitment_CollectApplications(RecruitmentID);
CREATE INDEX IF NOT EXISTS idx_recruitment_major_recruitment ON Recruitment_TargetMajors(RecruitmentID);
CREATE INDEX IF NOT EXISTS idx_recruitment_level_recruitment ON Recruitment_ClassLevel(RecruitmentID);

CREATE INDEX IF NOT EXISTS idx_career_event_company ON CareerEvent(CompanyID);
CREATE INDEX IF NOT EXISTS idx_career_event_contact ON CareerEvent(ContactID);

CREATE INDEX IF NOT EXISTS idx_hiring_feedback_company ON HiringFeedback(CompanyID);
CREATE INDEX IF NOT EXISTS idx_hiring_feedback_contact ON HiringFeedback(ContactID);
CREATE INDEX IF NOT EXISTS idx_hiring_feedback_date ON HiringFeedback(DateReported);

CREATE INDEX IF NOT EXISTS idx_student_event_company ON StudentLedEvent(CompanyID);
CREATE INDEX IF NOT EXISTS idx_student_event_contact ON StudentLedEvent(ContactID);
CREATE INDEX IF NOT EXISTS idx_student_event_proposal ON StudentLedEvent(ProposalDate);

CREATE INDEX IF NOT EXISTS idx_academic_company ON AcademicClassroomEngagement(CompanyID);
CREATE INDEX IF NOT EXISTS idx_academic_contact ON AcademicClassroomEngagement(ContactID);

CREATE INDEX IF NOT EXISTS idx_collaboration_company ON PotentialCollaboration(CompanyID);
CREATE INDEX IF NOT EXISTS idx_collaboration_opportunity_parent ON PotentialCollaboration_Opportunities(PotentialCollaborationID);
