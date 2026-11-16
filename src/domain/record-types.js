'use strict';

/**
 * One declarative definition per record type exposed under /api/<path>.
 *
 * These definitions are the only source of table and column names that the
 * generic repository interpolates into SQL; nothing from a request ever is.
 *
 * - path            URL segment under /api
 * - table, idColumn the database table and its primary key
 * - label           human name of one record, used in messages
 * - idLabel         how the :id parameter is named in validation messages
 * - notFoundMessage error sent when the record does not exist (kept as the API has always sent it)
 * - importEntity    the entity name the import screen uses for this type
 * - columns         writable columns, in insert order
 * - todayDefaults   date columns that default to today (office time zone) when left empty
 * - references      which of CompanyID / ContactID the record points to
 * - children        child tables replaced as a whole with the parent; field is the API array name
 * - list            the read query: alias, selected columns, joins, default order and filters
 *   filters: { param, match: 'equals' | 'contains' | 'from' | 'to', column | columns }
 *   withheldColumns (optional): joined columns that carry a sensitive value under another
 *   name (e.g. a contact's email joined as ContactEmail). They are withheld, like the
 *   record type's own SENSITIVE_FIELDS, from users who may not read sensitive data.
 *   Today the only joined columns are CompanyName and ContactName, which are not sensitive.
 */

const contactName = "co.FirstName || ' ' || co.LastName AS ContactName";

/** Company and contact joins shared by the activity record types. */
function companyAndContactJoins(alias) {
  return [`JOIN Company c ON ${alias}.CompanyID = c.CompanyID`, `JOIN Contact co ON ${alias}.ContactID = co.ContactID`];
}

function dateRangeFilters(column) {
  return [
    { param: 'from', match: 'from', column },
    { param: 'to', match: 'to', column },
  ];
}

const RECORD_TYPES = Object.freeze([
  {
    path: 'companies',
    table: 'Company',
    idColumn: 'CompanyID',
    label: 'Company',
    idLabel: 'Company ID',
    notFoundMessage: 'Company not found',
    importEntity: 'Company',
    columns: [
      'CompanyName',
      'DateAdded',
      'Industry',
      'Sector',
      'Country',
      'Address',
      'Website',
      'LinkedInURL',
      'HandshakeURL',
      'SignedMoU',
      'FavoriteEmployer',
      'Blacklisted',
      'Comment',
    ],
    todayDefaults: ['DateAdded'],
    references: { company: false, contact: false },
    children: [],
    list: {
      alias: 'c',
      select: 'c.*',
      joins: [],
      orderBy: 'c.CompanyName ASC',
      filters: [{ param: 'search', match: 'contains', columns: ['c.CompanyName', 'c.Country'] }],
    },
  },
  {
    path: 'contacts',
    table: 'Contact',
    idColumn: 'ContactID',
    label: 'Contact',
    idLabel: 'Contact ID',
    notFoundMessage: 'Contact not found',
    importEntity: 'Contact',
    columns: [
      'CompanyID',
      'FirstName',
      'LastName',
      'DateAdded',
      'JobTitle',
      'EmailAddress',
      'Address',
      'Country',
      'WorkPhone',
      'Mobile',
      'LinkedInURL',
      'HandshakeURL',
      'CMUQGraduate',
      'Major',
      'GraduationYear',
      'PrimaryContact',
      'Status',
      'ResumeBook',
      'EventInvitation',
      'ExcludeFromMailing',
    ],
    todayDefaults: ['DateAdded'],
    references: { company: true, contact: false },
    children: [],
    list: {
      alias: 'ct',
      select: 'ct.*, c.CompanyName',
      joins: ['JOIN Company c ON ct.CompanyID = c.CompanyID'],
      orderBy: 'ct.LastName ASC, ct.FirstName ASC',
      filters: [
        { param: 'search', match: 'contains', columns: ['ct.FirstName', 'ct.LastName', 'ct.EmailAddress'] },
        { param: 'companyId', match: 'equals', column: 'ct.CompanyID' },
        { param: 'status', match: 'equals', column: 'ct.Status' },
      ],
    },
  },
  {
    path: 'outreach',
    table: 'OutreachEngagement',
    idColumn: 'OutreachEngagementID',
    label: 'Outreach record',
    idLabel: 'Outreach record ID',
    notFoundMessage: 'Record not found',
    importEntity: 'Outreach',
    columns: [
      'CompanyID',
      'ContactID',
      'InteractionType',
      'InteractionDate',
      'DiscussionItems',
      'ActionPlan',
      'FollowUpDate',
      'InteractionStatus',
    ],
    todayDefaults: [],
    references: { company: true, contact: true },
    children: [],
    list: {
      alias: 'o',
      select: `o.*, c.CompanyName, ${contactName}`,
      joins: companyAndContactJoins('o'),
      orderBy: 'o.InteractionDate DESC',
      filters: [
        { param: 'companyId', match: 'equals', column: 'o.CompanyID' },
        { param: 'contactId', match: 'equals', column: 'o.ContactID' },
        { param: 'interactionType', match: 'equals', column: 'o.InteractionType' },
        { param: 'interactionStatus', match: 'equals', column: 'o.InteractionStatus' },
        ...dateRangeFilters('o.InteractionDate'),
      ],
    },
  },
  {
    path: 'recruitment',
    table: 'Recruitment',
    idColumn: 'RecruitmentID',
    label: 'Recruitment posting',
    idLabel: 'Recruitment ID',
    notFoundMessage: 'Record not found',
    importEntity: 'Recruitment',
    columns: [
      'CompanyID',
      'ContactID',
      'DatePosted',
      'OpportunityTitle',
      'Duration',
      'HiringStartDate',
      'HiringEndDate',
      'Country',
      'Mode',
      'Status',
      'PayAmount',
      'TargetGroup',
      'ArabicSpeaker',
      'HiredStudentAlumni',
      'Comment',
    ],
    todayDefaults: ['DatePosted'],
    references: { company: true, contact: true },
    children: [
      { field: 'OpportunityTypes', table: 'Recruitment_OpportunityType', column: 'Type' },
      { field: 'CollectApplications', table: 'Recruitment_CollectApplications', column: 'Channel' },
      { field: 'TargetMajors', table: 'Recruitment_TargetMajors', column: 'Major' },
      { field: 'ClassLevels', table: 'Recruitment_ClassLevel', column: 'ClassLevel' },
    ],
    list: {
      alias: 'r',
      select: `r.*, c.CompanyName, ${contactName}`,
      joins: companyAndContactJoins('r'),
      orderBy: 'r.DatePosted DESC',
      filters: [
        { param: 'companyId', match: 'equals', column: 'r.CompanyID' },
        { param: 'mode', match: 'equals', column: 'r.Mode' },
        { param: 'status', match: 'equals', column: 'r.Status' },
        { param: 'targetGroup', match: 'equals', column: 'r.TargetGroup' },
        ...dateRangeFilters('r.DatePosted'),
      ],
    },
  },
  {
    path: 'career-events',
    table: 'CareerEvent',
    idColumn: 'CareerEventID',
    label: 'Career event',
    idLabel: 'Career event ID',
    notFoundMessage: 'Not found',
    importEntity: 'Career Event',
    columns: ['CompanyID', 'ContactID', 'EventName', 'EventDate', 'RegisteredStatus', 'CMUQAlumniAtBooth', 'Comment'],
    todayDefaults: [],
    references: { company: true, contact: true },
    children: [],
    list: {
      alias: 'e',
      select: `e.*, c.CompanyName, ${contactName}`,
      joins: companyAndContactJoins('e'),
      orderBy: 'e.EventDate DESC',
      filters: [
        { param: 'eventName', match: 'contains', columns: ['e.EventName'] },
        { param: 'registeredStatus', match: 'equals', column: 'e.RegisteredStatus' },
        ...dateRangeFilters('e.EventDate'),
      ],
    },
  },
  {
    path: 'collaboration',
    table: 'PotentialCollaboration',
    idColumn: 'PotentialCollaborationID',
    label: 'Potential collaboration',
    idLabel: 'Potential collaboration ID',
    notFoundMessage: 'Not found',
    importEntity: 'Potential Collaboration',
    columns: ['CompanyID', 'Comment'],
    todayDefaults: [],
    references: { company: true, contact: false },
    children: [{ field: 'Opportunities', table: 'PotentialCollaboration_Opportunities', column: 'OpportunityType' }],
    list: {
      alias: 'p',
      select: 'p.*, c.CompanyName',
      joins: ['JOIN Company c ON p.CompanyID = c.CompanyID'],
      orderBy: 'p.CreatedAt DESC',
      filters: [],
    },
  },
  {
    path: 'academic',
    table: 'AcademicClassroomEngagement',
    idColumn: 'EngagementID',
    label: 'Academic engagement',
    idLabel: 'Academic engagement ID',
    notFoundMessage: 'Not found',
    importEntity: 'Academic Engagement',
    columns: [
      'CompanyID',
      'ContactID',
      'EngagementType',
      'GuestSpeakerName',
      'GuestTitle',
      'Email',
      'PhoneNumber',
      'FacultyName',
      'CourseNumber',
      'CourseTitle',
      'TopicTheme',
      'SessionDate',
      'SessionTime',
      'Comment',
    ],
    todayDefaults: [],
    references: { company: true, contact: true },
    children: [],
    list: {
      alias: 'a',
      select: `a.*, c.CompanyName, ${contactName}`,
      joins: companyAndContactJoins('a'),
      orderBy: 'a.SessionDate DESC',
      filters: [
        { param: 'engagementType', match: 'equals', column: 'a.EngagementType' },
        ...dateRangeFilters('a.SessionDate'),
      ],
    },
  },
  {
    path: 'student-events',
    table: 'StudentLedEvent',
    idColumn: 'StudentLedEventID',
    label: 'Student-led event',
    idLabel: 'Student event ID',
    notFoundMessage: 'Not found',
    importEntity: 'Student-Led Event',
    columns: [
      'CompanyID',
      'ContactID',
      'ProposalDate',
      'OrganizationName',
      'StudentName',
      'StudentEmail',
      'StudentPhoneNumber',
      'CollaborationOutcome',
      'EventDate',
      'EventTitle',
      'Comment',
    ],
    todayDefaults: [],
    references: { company: true, contact: true },
    children: [],
    list: {
      alias: 's',
      select: `s.*, c.CompanyName, ${contactName}`,
      joins: companyAndContactJoins('s'),
      orderBy: 's.ProposalDate DESC',
      filters: [
        { param: 'collaborationOutcome', match: 'equals', column: 's.CollaborationOutcome' },
        ...dateRangeFilters('s.ProposalDate'),
      ],
    },
  },
  {
    path: 'hiring-feedback',
    table: 'HiringFeedback',
    idColumn: 'HiringFeedbackID',
    label: 'Hiring feedback entry',
    idLabel: 'Hiring feedback ID',
    notFoundMessage: 'Not found',
    importEntity: 'Hiring Feedback',
    columns: [
      'CompanyID',
      'ContactID',
      'FeedbackProvider',
      'HiredStudentAlumni',
      'DateReported',
      'HiredStudentName',
      'Comment',
    ],
    todayDefaults: [],
    references: { company: true, contact: true },
    children: [],
    list: {
      alias: 'h',
      select: `h.*, c.CompanyName, ${contactName}`,
      joins: companyAndContactJoins('h'),
      orderBy: 'h.DateReported DESC',
      filters: [
        { param: 'feedbackProvider', match: 'equals', column: 'h.FeedbackProvider' },
        { param: 'hiredStudentAlumni', match: 'equals', column: 'h.HiredStudentAlumni' },
        ...dateRangeFilters('h.DateReported'),
      ],
    },
  },
]);

const BY_PATH = new Map(RECORD_TYPES.map((definition) => [definition.path, definition]));
const BY_IMPORT_ENTITY = new Map(RECORD_TYPES.map((definition) => [definition.importEntity, definition]));

/** The definition for an API path such as 'career-events'. Throws for an unknown path. */
function recordTypeByPath(path) {
  const definition = BY_PATH.get(path);
  if (!definition) throw new Error(`Unknown record type: ${path}`);
  return definition;
}

/** The definition for an import entity name such as 'Career Event', or undefined. */
function recordTypeByImportEntity(entity) {
  return BY_IMPORT_ENTITY.get(entity);
}

/** The entity names the import screen offers, in display order. */
const IMPORT_ENTITIES = Object.freeze(RECORD_TYPES.map((definition) => definition.importEntity));

module.exports = { RECORD_TYPES, IMPORT_ENTITIES, recordTypeByPath, recordTypeByImportEntity };
