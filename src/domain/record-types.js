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
 *   filters: { param, match: 'equals' | 'contains' | 'from' | 'to' | 'choice', column | columns | choices }
 *   A 'choice' filter maps each allowed value to a fixed SQL condition ({ sql, args?(options) });
 *   any other value is ignored. Filters the JSON API does not accept (q, sector, region, status,
 *   view, flag, opportunity) are only reachable from the server-rendered list screens.
 *   page: what the paged list screens add to the read query:
 *     with           a common table expression placed before the query (optional), with
 *     withArgs       its parameters, from the options ({ today })
 *     select, joins  extra selected columns and joins (optional)
 *     sorts          the sortable columns: key -> { columns, text } (text sorts use COLLATE NOCASE)
 *     defaultSort    [key, 'asc' | 'desc'], used for a missing or unknown sort key
 *   withheldColumns (optional): joined columns that carry a sensitive value under another
 *   name (e.g. a contact's email joined as ContactEmail). They are withheld, like the
 *   record type's own SENSITIVE_FIELDS, from users who may not read sensitive data.
 *   Today the only joined columns are CompanyName and ContactName, which are not sensitive.
 *   live: the conditions that keep records in the Trash out of every read (src/domain/live.js):
 *   the record's own DeletedAt, and its employer's for a record that belongs to one. The
 *   repository adds them to every query unless the caller asks for deleted records explicitly.
 *   ContactName carries " (deleted)" when the contact is in the Trash.
 */

const { LAST_ACTIVITY_CTE, DORMANT_AFTER_DAYS } = require('./activity');
const { COLLABORATION_OPPORTUNITIES } = require('./enums');
const { addDaysToIsoDate } = require('../lib/dates');
const { notDeleted, contactNameSql } = require('./live');

const contactName = `${contactNameSql('co')} AS ContactName`;
const contactNameExpr = "(co.FirstName || ' ' || co.LastName)";

/** Countries of the Gulf Cooperation Council other than Qatar, lower case, as stored names vary. */
const GCC_COUNTRIES =
  "('saudi arabia', 'kingdom of saudi arabia', 'ksa', 'united arab emirates', 'uae', 'kuwait', 'bahrain', 'oman')";
const countryOf = 'lower(trim(c.Country))';

/** No activity since the dormancy cutoff (or none at all, and added before it). Needs the last_activity join. */
const DORMANT_SQL = 'COALESCE(la.LastContactAt, c.DateAdded, c.CreatedAt) < ?';
const dormantCutoff = ({ today }) => [addDaysToIsoDate(today, -DORMANT_AFTER_DAYS)];

/** Employer status choices of the list screen; each is a fixed condition. */
const COMPANY_STATUS_CHOICES = {
  active: { sql: `(c.Blacklisted = 0 AND NOT ${DORMANT_SQL})`, args: dormantCutoff },
  dormant: { sql: `(c.Blacklisted = 0 AND ${DORMANT_SQL})`, args: dormantCutoff },
  'do-not-engage': { sql: 'c.Blacklisted = 1' },
  'key-partner': { sql: 'c.FavoriteEmployer = 1' },
  mou: { sql: 'c.SignedMoU = 1' },
};

/** Company and contact joins shared by the activity record types. */
function companyAndContactJoins(alias) {
  return [`JOIN Company c ON ${alias}.CompanyID = c.CompanyID`, `JOIN Contact co ON ${alias}.ContactID = co.ContactID`];
}

/** The live conditions of a record (alias) that belongs to an employer joined as c. */
const liveUnderEmployer = (alias) => [notDeleted(alias), notDeleted('c')];

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
      live: [notDeleted('c')],
      orderBy: 'c.CompanyName ASC',
      filters: [
        { param: 'search', match: 'contains', columns: ['c.CompanyName', 'c.Country'] },
        { param: 'q', match: 'contains', columns: ['c.CompanyName', 'c.Industry', 'c.Country'] },
        { param: 'sector', match: 'equals', column: 'c.Sector' },
        {
          param: 'region',
          match: 'choice',
          choices: {
            qatar: { sql: `${countryOf} = 'qatar'` },
            gcc: { sql: `${countryOf} IN ${GCC_COUNTRIES}` },
            international: {
              sql: `(c.Country IS NULL OR (${countryOf} <> 'qatar' AND ${countryOf} NOT IN ${GCC_COUNTRIES}))`,
            },
          },
        },
        { param: 'status', match: 'choice', choices: COMPANY_STATUS_CHOICES },
        { param: 'view', match: 'choice', choices: COMPANY_STATUS_CHOICES },
      ],
      page: {
        with: LAST_ACTIVITY_CTE,
        withArgs: ({ today }) => [today],
        select:
          ', la.LastContactAt AS lastContactAt, (SELECT COUNT(*) FROM Contact x WHERE x.CompanyID = c.CompanyID AND x.DeletedAt IS NULL) AS contactCount',
        joins: ['LEFT JOIN last_activity la ON la.CompanyID = c.CompanyID'],
        sorts: {
          name: { columns: ['c.CompanyName'], text: true },
          industry: { columns: ['c.Industry'], text: true },
          sector: { columns: ['c.Sector'], text: true },
          country: { columns: ['c.Country'], text: true },
          lastContact: { columns: ['la.LastContactAt'] },
          contacts: { columns: ['contactCount'] },
          added: { columns: ['c.DateAdded'] },
        },
        defaultSort: ['name', 'asc'],
      },
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
      live: liveUnderEmployer('ct'),
      orderBy: 'ct.LastName ASC, ct.FirstName ASC',
      filters: [
        { param: 'search', match: 'contains', columns: ['ct.FirstName', 'ct.LastName', 'ct.EmailAddress'] },
        { param: 'companyId', match: 'equals', column: 'ct.CompanyID' },
        { param: 'status', match: 'equals', column: 'ct.Status' },
        {
          param: 'q',
          match: 'contains',
          columns: [
            'ct.FirstName',
            'ct.LastName',
            "(ct.FirstName || ' ' || ct.LastName)",
            'ct.JobTitle',
            'ct.EmailAddress',
            'c.CompanyName',
          ],
        },
        {
          param: 'flag',
          match: 'choice',
          choices: {
            primary: { sql: 'ct.PrimaryContact = 1' },
            alumni: { sql: 'ct.CMUQGraduate = 1' },
            'resume-book': { sql: 'ct.ResumeBook = 1' },
          },
        },
      ],
      page: {
        sorts: {
          name: { columns: ['ct.LastName', 'ct.FirstName'], text: true },
          employer: { columns: ['c.CompanyName'], text: true },
          title: { columns: ['ct.JobTitle'], text: true },
          status: { columns: ['ct.Status'], text: true },
          added: { columns: ['ct.DateAdded'] },
        },
        defaultSort: ['name', 'asc'],
      },
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
      live: liveUnderEmployer('o'),
      orderBy: 'o.InteractionDate DESC',
      filters: [
        { param: 'companyId', match: 'equals', column: 'o.CompanyID' },
        { param: 'contactId', match: 'equals', column: 'o.ContactID' },
        { param: 'interactionType', match: 'equals', column: 'o.InteractionType' },
        { param: 'interactionStatus', match: 'equals', column: 'o.InteractionStatus' },
        ...dateRangeFilters('o.InteractionDate'),
        {
          param: 'q',
          match: 'contains',
          columns: ['c.CompanyName', contactNameExpr, 'o.DiscussionItems', 'o.ActionPlan'],
        },
      ],
      page: {
        sorts: {
          date: { columns: ['o.InteractionDate'] },
          employer: { columns: ['c.CompanyName'], text: true },
          contact: { columns: ['co.LastName', 'co.FirstName'], text: true },
          type: { columns: ['o.InteractionType'], text: true },
          followUp: { columns: ['o.FollowUpDate'] },
          status: { columns: ['o.InteractionStatus'], text: true },
        },
        defaultSort: ['date', 'desc'],
      },
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
      live: liveUnderEmployer('r'),
      orderBy: 'r.DatePosted DESC',
      filters: [
        { param: 'companyId', match: 'equals', column: 'r.CompanyID' },
        { param: 'mode', match: 'equals', column: 'r.Mode' },
        { param: 'status', match: 'equals', column: 'r.Status' },
        { param: 'targetGroup', match: 'equals', column: 'r.TargetGroup' },
        ...dateRangeFilters('r.DatePosted'),
        { param: 'q', match: 'contains', columns: ['r.OpportunityTitle', 'c.CompanyName', 'r.Country'] },
      ],
      page: {
        sorts: {
          title: { columns: ['r.OpportunityTitle'], text: true },
          employer: { columns: ['c.CompanyName'], text: true },
          posted: { columns: ['r.DatePosted'] },
          mode: { columns: ['r.Mode'], text: true },
          pay: { columns: ['r.Status'], text: true },
          target: { columns: ['r.TargetGroup'], text: true },
          hired: { columns: ['r.HiredStudentAlumni'], text: true },
        },
        defaultSort: ['posted', 'desc'],
      },
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
      live: liveUnderEmployer('e'),
      orderBy: 'e.EventDate DESC',
      filters: [
        { param: 'eventName', match: 'contains', columns: ['e.EventName'] },
        { param: 'registeredStatus', match: 'equals', column: 'e.RegisteredStatus' },
        ...dateRangeFilters('e.EventDate'),
        { param: 'q', match: 'contains', columns: ['e.EventName', 'c.CompanyName', contactNameExpr] },
      ],
      page: {
        sorts: {
          event: { columns: ['e.EventName'], text: true },
          date: { columns: ['e.EventDate'] },
          employer: { columns: ['c.CompanyName'], text: true },
          contact: { columns: ['co.LastName', 'co.FirstName'], text: true },
          status: { columns: ['e.RegisteredStatus'], text: true },
        },
        defaultSort: ['date', 'desc'],
      },
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
      live: liveUnderEmployer('p'),
      orderBy: 'p.CreatedAt DESC',
      filters: [
        { param: 'q', match: 'contains', columns: ['c.CompanyName', 'p.Comment'] },
        {
          param: 'opportunity',
          match: 'choice',
          choices: Object.fromEntries(
            COLLABORATION_OPPORTUNITIES.map((type) => [
              type,
              {
                sql: `EXISTS (SELECT 1 FROM PotentialCollaboration_Opportunities po
                  WHERE po.PotentialCollaborationID = p.PotentialCollaborationID AND po.OpportunityType = ?)`,
                args: () => [type],
              },
            ])
          ),
        },
      ],
      page: {
        sorts: {
          employer: { columns: ['c.CompanyName'], text: true },
          added: { columns: ['p.CreatedAt'] },
          updated: { columns: ['p.UpdatedAt'] },
        },
        defaultSort: ['added', 'desc'],
      },
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
      live: liveUnderEmployer('a'),
      orderBy: 'a.SessionDate DESC',
      filters: [
        { param: 'engagementType', match: 'equals', column: 'a.EngagementType' },
        ...dateRangeFilters('a.SessionDate'),
        {
          param: 'q',
          match: 'contains',
          columns: [
            'a.GuestSpeakerName',
            'a.CourseNumber',
            'a.CourseTitle',
            'a.TopicTheme',
            'a.FacultyName',
            'c.CompanyName',
          ],
        },
      ],
      page: {
        sorts: {
          date: { columns: ['a.SessionDate', 'a.SessionTime'] },
          type: { columns: ['a.EngagementType'], text: true },
          speaker: { columns: ['a.GuestSpeakerName'], text: true },
          course: { columns: ['a.CourseNumber'], text: true },
          employer: { columns: ['c.CompanyName'], text: true },
          faculty: { columns: ['a.FacultyName'], text: true },
        },
        defaultSort: ['date', 'desc'],
      },
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
      live: liveUnderEmployer('s'),
      orderBy: 's.ProposalDate DESC',
      filters: [
        { param: 'collaborationOutcome', match: 'equals', column: 's.CollaborationOutcome' },
        ...dateRangeFilters('s.ProposalDate'),
        {
          param: 'q',
          match: 'contains',
          columns: ['s.OrganizationName', 's.EventTitle', 's.StudentName', 'c.CompanyName'],
        },
      ],
      page: {
        sorts: {
          proposed: { columns: ['s.ProposalDate'] },
          organization: { columns: ['s.OrganizationName'], text: true },
          title: { columns: ['s.EventTitle'], text: true },
          employer: { columns: ['c.CompanyName'], text: true },
          outcome: { columns: ['s.CollaborationOutcome'], text: true },
          date: { columns: ['s.EventDate'] },
        },
        defaultSort: ['proposed', 'desc'],
      },
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
      live: liveUnderEmployer('h'),
      orderBy: 'h.DateReported DESC',
      filters: [
        { param: 'feedbackProvider', match: 'equals', column: 'h.FeedbackProvider' },
        { param: 'hiredStudentAlumni', match: 'equals', column: 'h.HiredStudentAlumni' },
        ...dateRangeFilters('h.DateReported'),
        {
          param: 'q',
          match: 'contains',
          columns: ['c.CompanyName', contactNameExpr, 'h.HiredStudentName', 'h.Comment'],
        },
      ],
      page: {
        sorts: {
          date: { columns: ['h.DateReported'] },
          employer: { columns: ['c.CompanyName'], text: true },
          contact: { columns: ['co.LastName', 'co.FirstName'], text: true },
          provider: { columns: ['h.FeedbackProvider'], text: true },
          hired: { columns: ['h.HiredStudentAlumni'], text: true },
        },
        defaultSort: ['date', 'desc'],
      },
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
