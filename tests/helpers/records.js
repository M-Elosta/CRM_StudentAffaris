'use strict';

/**
 * The nine record types exposed under /api/<path>, with what the CRUD and
 * role suites need to exercise each one generically.
 *
 * payload(refs) returns a minimal valid create body. refs holds the ids of a
 * company and a contact that already exist.
 */

const { post, today } = require('./app');

const RECORD_TYPES = [
  {
    name: 'company',
    path: 'companies',
    idField: 'CompanyID',
    table: 'Company',
    payload: () => ({
      CompanyName: 'Acme Analytics',
      Industry: 'Technology',
      Sector: 'Private',
      Country: 'Qatar',
    }),
    requiredField: 'CompanyName',
    enumField: { field: 'Sector', invalid: 'Corporate' },
    change: { field: 'Industry', value: 'Consulting' },
  },
  {
    name: 'contact',
    path: 'contacts',
    idField: 'ContactID',
    table: 'Contact',
    payload: ({ companyId }) => ({
      CompanyID: companyId,
      FirstName: 'Layla',
      LastName: 'Haddad',
      EmailAddress: 'layla.haddad@example.com',
      Status: 'Mailable',
    }),
    requiredField: 'LastName',
    enumField: { field: 'Status', invalid: 'Maybe' },
    change: { field: 'FirstName', value: 'Leila' },
  },
  {
    name: 'outreach record',
    path: 'outreach',
    idField: 'OutreachEngagementID',
    table: 'OutreachEngagement',
    payload: ({ companyId, contactId }) => ({
      CompanyID: companyId,
      ContactID: contactId,
      InteractionType: 'Call',
      InteractionDate: today(),
      DiscussionItems: 'Summer internship pipeline',
      InteractionStatus: 'In-progress',
    }),
    requiredField: 'DiscussionItems',
    enumField: { field: 'InteractionType', invalid: 'Telegram' },
    change: { field: 'DiscussionItems', value: 'Graduate hiring plans' },
  },
  {
    name: 'recruitment posting',
    path: 'recruitment',
    idField: 'RecruitmentID',
    table: 'Recruitment',
    payload: ({ companyId, contactId }) => ({
      CompanyID: companyId,
      ContactID: contactId,
      OpportunityTitle: 'Data Analyst Intern',
      Mode: 'Onsite',
      Status: 'Paid',
      TargetGroup: 'Open to all',
      OpportunityTypes: ['Internship'],
      TargetMajors: ['CS'],
      ClassLevels: ['Junior'],
      CollectApplications: ['Handshake'],
    }),
    requiredField: 'OpportunityTitle',
    enumField: { field: 'Mode', invalid: 'Underwater' },
    change: { field: 'OpportunityTitle', value: 'Data Engineer Intern' },
  },
  {
    name: 'career event',
    path: 'career-events',
    idField: 'CareerEventID',
    table: 'CareerEvent',
    payload: ({ companyId, contactId }) => ({
      CompanyID: companyId,
      ContactID: contactId,
      EventName: 'Fall Career Fair',
      EventDate: today(),
      RegisteredStatus: 'Attended',
    }),
    requiredField: 'EventName',
    enumField: { field: 'RegisteredStatus', invalid: 'Maybe' },
    change: { field: 'EventName', value: 'Spring Career Fair' },
  },
  {
    name: 'potential collaboration',
    path: 'collaboration',
    idField: 'PotentialCollaborationID',
    table: 'PotentialCollaboration',
    payload: ({ companyId }) => ({
      CompanyID: companyId,
      Comment: 'Interested in guest lectures',
      Opportunities: ['Guest Lecture'],
    }),
    requiredField: 'CompanyID',
    enumField: null, // no enumerated fields
    change: { field: 'Comment', value: 'Also open to mentorship' },
  },
  {
    name: 'academic engagement',
    path: 'academic',
    idField: 'EngagementID',
    table: 'AcademicClassroomEngagement',
    payload: ({ companyId, contactId }) => ({
      CompanyID: companyId,
      ContactID: contactId,
      EngagementType: 'Guest Lecture',
      GuestSpeakerName: 'Omar Farouk',
      GuestTitle: 'Chief Data Officer',
      FacultyName: 'Dr. Sara Malik',
      CourseNumber: '15-112',
      CourseTitle: 'Fundamentals of Programming',
      TopicTheme: 'Data in industry',
      SessionDate: today(),
      SessionTime: '10:00',
    }),
    requiredField: 'GuestSpeakerName',
    enumField: { field: 'EngagementType', invalid: 'Karaoke' },
    change: { field: 'TopicTheme', value: 'Careers in analytics' },
  },
  {
    name: 'student-led event',
    path: 'student-events',
    idField: 'StudentLedEventID',
    table: 'StudentLedEvent',
    payload: ({ companyId, contactId }) => ({
      CompanyID: companyId,
      ContactID: contactId,
      ProposalDate: today(),
      OrganizationName: 'ACM Student Chapter',
      StudentName: 'Noor Khalil',
      StudentEmail: 'noor.khalil@example.edu',
      StudentPhoneNumber: '+974 5555 0000',
      CollaborationOutcome: 'Pending',
    }),
    requiredField: 'StudentName',
    enumField: { field: 'CollaborationOutcome', invalid: 'Abandoned' },
    change: { field: 'OrganizationName', value: 'Women in Tech' },
  },
  {
    name: 'hiring feedback entry',
    path: 'hiring-feedback',
    idField: 'HiringFeedbackID',
    table: 'HiringFeedback',
    payload: ({ companyId, contactId }) => ({
      CompanyID: companyId,
      ContactID: contactId,
      FeedbackProvider: 'Company',
      HiredStudentAlumni: 'Yes',
      DateReported: today(),
    }),
    requiredField: 'DateReported',
    enumField: { field: 'FeedbackProvider', invalid: 'Rumour' },
    change: { field: 'Comment', value: 'Hired two interns' },
  },
];

/**
 * Record types whose routes do not validate the enumerated field themselves
 * and leave it to the database CHECK constraint, which surfaces as a 500.
 * Keyed by path; the value is the todo reason.
 */
const ENUM_NOT_VALIDATED = {
  recruitment: 'recruitment route does not validate Mode/Status/TargetGroup; the CHECK constraint fails with 500',
  'career-events': 'career-events route does not validate RegisteredStatus; the CHECK constraint fails with 500',
  academic: 'academic route does not validate EngagementType; the CHECK constraint fails with 500',
  'student-events': 'student-events route does not validate CollaborationOutcome; the CHECK constraint fails with 500',
  'hiring-feedback': 'hiring-feedback route does not validate FeedbackProvider; the CHECK constraint fails with 500',
};

/** Prefix a record type name with the right indefinite article, for test names. */
function an(name) {
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

/** Create a company and a contact through the API and return their ids. */
async function createRefs(agent, suffix = '') {
  const company = await post(agent, '/api/companies', {
    CompanyName: `Reference Company${suffix}`,
    Industry: 'Energy',
    Sector: 'Semi-government',
    Country: 'Qatar',
  });
  if (company.status !== 201) throw new Error(`Could not create company: ${JSON.stringify(company.body)}`);
  const contact = await post(agent, '/api/contacts', {
    CompanyID: company.body.CompanyID,
    FirstName: 'Reference',
    LastName: `Contact${suffix}`,
    EmailAddress: `reference${suffix.replace(/\W/g, '')}@example.com`,
    Status: 'Mailable',
  });
  if (contact.status !== 201) throw new Error(`Could not create contact: ${JSON.stringify(contact.body)}`);
  return { companyId: company.body.CompanyID, contactId: contact.body.ContactID };
}

/** Create one record of the given type through the API and return the response body. */
async function createRecord(agent, type, refs) {
  const res = await post(agent, `/api/${type.path}`, type.payload(refs));
  if (res.status !== 201) throw new Error(`Could not create ${type.name}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Create one record of every type, plus a blacklisted and a favourite employer. */
async function seedEverything(agent) {
  const refs = await createRefs(agent, ' Seed');
  for (const type of RECORD_TYPES) {
    if (type.path === 'companies' || type.path === 'contacts') continue;
    await createRecord(agent, type, refs);
  }
  await post(agent, '/api/companies', {
    CompanyName: 'Blacklisted Ltd',
    Industry: 'Mining',
    Sector: 'Private',
    Country: 'Oman',
    Blacklisted: true,
  });
  await post(agent, '/api/companies', {
    CompanyName: 'Favourite Partner',
    Industry: 'Banking',
    Sector: 'Government',
    Country: 'Qatar',
    FavoriteEmployer: true,
    SignedMoU: true,
  });
  await post(agent, '/api/contacts', {
    CompanyID: refs.companyId,
    FirstName: 'Alumna',
    LastName: 'Primary',
    EmailAddress: 'alumna@example.com',
    CMUQGraduate: true,
    PrimaryContact: true,
    ResumeBook: true,
    EventInvitation: true,
    Major: 'Computer Science',
    GraduationYear: 2020,
  });
  await post(agent, '/api/outreach', {
    CompanyID: refs.companyId,
    ContactID: refs.contactId,
    InteractionType: 'Meeting',
    InteractionDate: '2024-10-15',
    DiscussionItems: 'Last year meeting',
    FollowUpDate: '2099-01-01',
    InteractionStatus: 'In-progress',
  });
  return refs;
}

module.exports = { RECORD_TYPES, ENUM_NOT_VALIDATED, an, createRefs, createRecord, seedEverything };
