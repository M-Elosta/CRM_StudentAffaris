'use strict';

/**
 * One declarative description per record type: what its list shows, how it
 * can be filtered and sorted, and what its form asks for. The generic list,
 * detail and form templates render every record type from these, so nine
 * record types look and behave the same.
 *
 * Screen
 *   recordType      key of src/domain/record-types.js (database names stay there)
 *   base            URL of the record pages: base/new, base/:id, base/:id/edit
 *   listPath, tab   where the list lives when it is not `base` (events share one page)
 *   singular, plural, title    the words the interface uses
 *   idField         primary key column
 *   nameOf(record)  how one record is named in headings and messages
 *   columns         list columns: { label, field, type, sort?, col?, ... }
 *                   type: text | date | badge | number | link | tags | bool
 *                   link columns: href(row) gives the target
 *   filters         toolbar selects: { param, label, options }; hidden: true accepts the
 *                   parameter from the URL without showing a control
 *   sorts           sort key -> label (keys must exist in the record type's page.sorts)
 *   defaultSort     [key, dir]
 *   fields          form fields: { name, label, control, required?, options?, hint?, full?, max?,
 *                   default? (value of a new record), defaultToday? (a new record starts on today) }
 *                   control: text | textarea | select | date | time | email | url | tel | number |
 *                   checkbox | checkboxes | employer | contact
 */

const E = require('../domain/enums');
const { recordTypeByPath } = require('../domain/record-types');

const opts = (values) => values.map((value) => ({ value, label: value }));
const personName = (first, last) => [first, last].filter(Boolean).join(' ');

const employerColumn = {
  label: 'Employer',
  field: 'CompanyName',
  type: 'link',
  sort: 'employer',
  col: 'col--md',
  href: (row) => `/employers/${row.CompanyID}`,
};
const contactColumn = {
  label: 'Contact',
  field: 'ContactName',
  type: 'link',
  sort: 'contact',
  col: 'col--md',
  href: (row) => `/contacts/${row.ContactID}`,
};
const employerField = { name: 'CompanyID', label: 'Employer', control: 'employer', required: true };
const contactField = {
  name: 'ContactID',
  label: 'Contact',
  control: 'contact',
  required: true,
  hint: 'The contacts of the chosen employer.',
};
const notesField = (label = 'Comment') => ({ name: 'Comment', label, control: 'textarea', full: true, max: 2000 });

const SCREENS = [
  {
    recordType: 'companies',
    base: '/employers',
    singular: 'employer',
    plural: 'employers',
    title: 'Employers',
    idField: 'CompanyID',
    nameOf: (record) => record.CompanyName,
    // The employer list and profile have their own templates; these columns serve search.
    columns: [],
    filters: [],
    sorts: {
      name: 'Employer',
      industry: 'Industry',
      sector: 'Sector',
      country: 'Country',
      lastContact: 'Last contact',
      contacts: 'Contacts',
    },
    defaultSort: ['name', 'asc'],
    fields: [
      { name: 'CompanyName', label: 'Employer name', control: 'text', required: true, full: true },
      { name: 'Industry', label: 'Industry', control: 'text', required: true },
      { name: 'Sector', label: 'Sector', control: 'select', options: opts(E.SECTORS), required: true },
      { name: 'Country', label: 'Country', control: 'text', required: true, max: 255 },
      { name: 'DateAdded', label: 'Date added', control: 'date', hint: 'Today if left empty.' },
      { name: 'Address', label: 'Address', control: 'text', full: true },
      { name: 'Website', label: 'Website', control: 'url', hint: 'Starting with https://' },
      { name: 'LinkedInURL', label: 'LinkedIn page', control: 'url' },
      { name: 'HandshakeURL', label: 'Handshake page', control: 'url' },
      { name: 'SignedMoU', label: 'Signed MoU', control: 'checkbox' },
      { name: 'FavoriteEmployer', label: 'Key partner', control: 'checkbox' },
      {
        name: 'Blacklisted',
        label: 'Do not engage',
        control: 'checkbox',
        hint: 'Every contact at this employer becomes non-mailable.',
      },
      notesField('Notes'),
    ],
  },
  {
    recordType: 'contacts',
    base: '/contacts',
    singular: 'contact',
    plural: 'contacts',
    title: 'Contacts',
    description: 'People at employers: recruiters, managers, alumni.',
    idField: 'ContactID',
    nameOf: (record) => personName(record.FirstName, record.LastName),
    columns: [
      {
        label: 'Name',
        field: 'FullName',
        type: 'link',
        sort: 'name',
        col: 'col--name',
        primary: true,
        value: (row) => personName(row.FirstName, row.LastName),
        href: (row) => `/contacts/${row.ContactID}`,
      },
      { ...employerColumn, col: 'col--name' },
      { label: 'Job title', field: 'JobTitle', type: 'text', sort: 'title', col: 'col--md' },
      { label: 'Email', field: 'EmailAddress', type: 'email', col: 'col--md' },
      {
        label: 'Status',
        field: 'Status',
        type: 'badge',
        sort: 'status',
        col: 'col--sm',
        tones: { Mailable: 'success', 'Non-mailable': '' },
      },
      { label: 'Added', field: 'DateAdded', type: 'date', sort: 'added', col: 'col--sm' },
    ],
    filters: [
      { param: 'status', label: 'Status', all: 'Any status', options: opts(E.CONTACT_STATUSES) },
      {
        param: 'flag',
        label: 'Type',
        all: 'All contacts',
        options: [
          { value: 'primary', label: 'Primary contacts' },
          { value: 'alumni', label: 'CMU-Q alumni' },
          { value: 'resume-book', label: 'Resume book' },
        ],
      },
      { param: 'companyId', type: 'id', hidden: true },
    ],
    sorts: { name: 'Name', employer: 'Employer', title: 'Job title', status: 'Status', added: 'Date added' },
    defaultSort: ['name', 'asc'],
    searchHint: 'Search by name, job title or employer',
    fields: [
      employerField,
      { name: 'FirstName', label: 'First name', control: 'text', required: true },
      { name: 'LastName', label: 'Last name', control: 'text', required: true },
      { name: 'JobTitle', label: 'Job title', control: 'text' },
      { name: 'EmailAddress', label: 'Email address', control: 'email', required: true },
      { name: 'WorkPhone', label: 'Work phone', control: 'tel', max: 50 },
      { name: 'Mobile', label: 'Mobile', control: 'tel', max: 50 },
      { name: 'Country', label: 'Country', control: 'text', max: 100 },
      { name: 'Address', label: 'Address', control: 'text' },
      { name: 'LinkedInURL', label: 'LinkedIn profile', control: 'url' },
      { name: 'HandshakeURL', label: 'Handshake profile', control: 'url' },
      {
        name: 'Status',
        label: 'Mailing status',
        control: 'select',
        options: opts(E.CONTACT_STATUSES),
        placeholder: '',
        default: 'Mailable',
        hint: 'Contacts of a do-not-engage employer are always non-mailable.',
      },
      { name: 'DateAdded', label: 'Date added', control: 'date', hint: 'Today if left empty.' },
      { name: 'Major', label: 'Major (alumni)', control: 'select', options: opts(E.CONTACT_MAJORS) },
      { name: 'GraduationYear', label: 'Graduation year', control: 'number' },
      { name: 'PrimaryContact', label: 'Primary contact for this employer', control: 'checkbox' },
      { name: 'CMUQGraduate', label: 'CMU-Q graduate', control: 'checkbox' },
      { name: 'ResumeBook', label: 'Receives the resume book', control: 'checkbox' },
      { name: 'EventInvitation', label: 'Invite to events', control: 'checkbox' },
      { name: 'ExcludeFromMailing', label: 'Exclude from mailings', control: 'checkbox' },
    ],
  },
  {
    recordType: 'outreach',
    base: '/interactions',
    singular: 'interaction',
    addLabel: 'Log interaction',
    plural: 'interactions',
    title: 'Interactions',
    description: 'Calls, meetings and visits with employers, and what was agreed.',
    idField: 'OutreachEngagementID',
    nameOf: (record) => `${record.InteractionType || 'Interaction'} with ${record.CompanyName || 'employer'}`,
    columns: [
      {
        label: 'Date',
        field: 'InteractionDate',
        type: 'date',
        sort: 'date',
        col: 'col--sm',
        primary: true,
        href: (row) => `/interactions/${row.OutreachEngagementID}`,
      },
      { ...employerColumn, col: 'col--name' },
      contactColumn,
      { label: 'Type', field: 'InteractionType', type: 'text', sort: 'type', col: 'col--sm' },
      { label: 'Discussed', field: 'DiscussionItems', type: 'text', col: 'col--name' },
      { label: 'Follow-up', field: 'FollowUpDate', type: 'date', sort: 'followUp', col: 'col--sm' },
      {
        label: 'Status',
        field: 'InteractionStatus',
        type: 'badge',
        sort: 'status',
        col: 'col--sm',
        tones: { Complete: 'success', 'In-progress': 'info' },
      },
    ],
    filters: [
      { param: 'interactionType', label: 'Type', all: 'All types', options: opts(E.INTERACTION_TYPES) },
      { param: 'interactionStatus', label: 'Status', all: 'Any status', options: opts(E.INTERACTION_STATUSES) },
      { param: 'companyId', type: 'id', hidden: true },
      { param: 'contactId', type: 'id', hidden: true },
      { param: 'from', type: 'date', hidden: true },
      { param: 'to', type: 'date', hidden: true },
    ],
    sorts: {
      date: 'Date',
      employer: 'Employer',
      contact: 'Contact',
      type: 'Type',
      followUp: 'Follow-up date',
      status: 'Status',
    },
    defaultSort: ['date', 'desc'],
    searchHint: 'Search by employer, contact or what was discussed',
    fields: [
      employerField,
      contactField,
      {
        name: 'InteractionType',
        label: 'Type',
        control: 'select',
        options: opts(E.INTERACTION_TYPES),
        required: true,
      },
      { name: 'InteractionDate', label: 'Date', control: 'date', required: true, defaultToday: true },
      { name: 'DiscussionItems', label: 'What was discussed', control: 'textarea', required: true, full: true },
      { name: 'ActionPlan', label: 'Action plan', control: 'textarea', full: true, rows: 3 },
      { name: 'FollowUpDate', label: 'Follow-up date', control: 'date', hint: 'Shows on the follow-ups list.' },
      {
        name: 'InteractionStatus',
        label: 'Status',
        control: 'select',
        options: opts(E.INTERACTION_STATUSES),
        placeholder: '',
        default: 'In-progress',
      },
    ],
  },
  {
    recordType: 'recruitment',
    base: '/postings',
    singular: 'posting',
    plural: 'postings',
    title: 'Postings',
    description: 'Internships, jobs and programmes employers offer to students.',
    idField: 'RecruitmentID',
    nameOf: (record) => record.OpportunityTitle,
    columns: [
      {
        label: 'Opportunity',
        field: 'OpportunityTitle',
        type: 'link',
        sort: 'title',
        col: 'col--name',
        primary: true,
        href: (row) => `/postings/${row.RecruitmentID}`,
      },
      { ...employerColumn, col: 'col--name' },
      { label: 'Posted', field: 'DatePosted', type: 'date', sort: 'posted', col: 'col--sm' },
      { label: 'Mode', field: 'Mode', type: 'text', sort: 'mode', col: 'col--sm' },
      { label: 'Pay', field: 'Status', type: 'text', sort: 'pay', col: 'col--xs' },
      { label: 'Open to', field: 'TargetGroup', type: 'text', sort: 'target', col: 'col--sm' },
      {
        label: 'Hired',
        field: 'HiredStudentAlumni',
        type: 'badge',
        sort: 'hired',
        col: 'col--sm',
        tones: { Yes: 'success', No: '', 'Not Reported': '' },
      },
    ],
    filters: [
      { param: 'mode', label: 'Mode', all: 'All modes', options: opts(E.RECRUITMENT_MODES) },
      { param: 'status', label: 'Pay', all: 'Paid and unpaid', options: opts(E.PAY_STATUSES) },
      { param: 'targetGroup', label: 'Open to', all: 'Anyone', options: opts(E.TARGET_GROUPS) },
      { param: 'companyId', type: 'id', hidden: true },
    ],
    sorts: {
      title: 'Opportunity',
      employer: 'Employer',
      posted: 'Date posted',
      mode: 'Mode',
      pay: 'Pay',
      target: 'Open to',
      hired: 'Hired',
    },
    defaultSort: ['posted', 'desc'],
    searchHint: 'Search by title, employer or country',
    fields: [
      employerField,
      contactField,
      { name: 'OpportunityTitle', label: 'Opportunity title', control: 'text', required: true, full: true },
      {
        name: 'OpportunityTypes',
        label: 'Type of opportunity',
        control: 'checkboxes',
        options: E.OPPORTUNITY_TYPES,
      },
      { name: 'DatePosted', label: 'Date posted', control: 'date', hint: 'Today if left empty.' },
      { name: 'Duration', label: 'Duration', control: 'text', max: 100 },
      { name: 'HiringStartDate', label: 'Hiring starts', control: 'date' },
      { name: 'HiringEndDate', label: 'Hiring ends', control: 'date' },
      { name: 'Country', label: 'Country', control: 'text', max: 100 },
      { name: 'Mode', label: 'Mode', control: 'select', options: opts(E.RECRUITMENT_MODES), required: true },
      { name: 'Status', label: 'Pay', control: 'select', options: opts(E.PAY_STATUSES), required: true },
      { name: 'PayAmount', label: 'Pay amount', control: 'text', max: 100 },
      {
        name: 'TargetGroup',
        label: 'Open to',
        control: 'select',
        options: opts(E.TARGET_GROUPS),
        required: true,
      },
      {
        name: 'HiredStudentAlumni',
        label: 'Student or alumnus hired',
        control: 'select',
        options: opts(E.RECRUITMENT_HIRED_VALUES),
        placeholder: '',
        default: 'Not Reported',
      },
      { name: 'TargetMajors', label: 'Target majors', control: 'checkboxes', options: E.CONTACT_MAJORS },
      { name: 'ClassLevels', label: 'Class levels', control: 'checkboxes', options: E.CLASS_LEVELS },
      {
        name: 'CollectApplications',
        label: 'Applications collected through',
        control: 'checkboxes',
        options: E.APPLICATION_CHANNELS,
      },
      { name: 'ArabicSpeaker', label: 'Arabic speaker required', control: 'checkbox' },
      notesField(),
    ],
  },
  {
    recordType: 'career-events',
    base: '/events/career',
    listPath: '/events',
    tab: 'career',
    tabLabel: 'Career events',
    singular: 'career event',
    plural: 'career events',
    title: 'Events',
    description: 'Career fairs, student-led events and academic engagements.',
    idField: 'CareerEventID',
    nameOf: (record) => record.EventName,
    columns: [
      {
        label: 'Event',
        field: 'EventName',
        type: 'link',
        sort: 'event',
        col: 'col--name',
        primary: true,
        href: (row) => `/events/career/${row.CareerEventID}`,
      },
      { label: 'Date', field: 'EventDate', type: 'date', sort: 'date', col: 'col--sm' },
      { ...employerColumn, col: 'col--name' },
      contactColumn,
      {
        label: 'Registration',
        field: 'RegisteredStatus',
        type: 'badge',
        sort: 'status',
        col: 'col--sm',
        tones: { Attended: 'success', 'No-Show': 'warning', Cancelled: '' },
      },
      { label: 'Alumni at booth', field: 'CMUQAlumniAtBooth', type: 'bool', col: 'col--sm' },
    ],
    filters: [
      {
        param: 'registeredStatus',
        label: 'Registration',
        all: 'Any registration',
        options: opts(E.REGISTERED_STATUSES),
      },
    ],
    sorts: { event: 'Event', date: 'Date', employer: 'Employer', contact: 'Contact', status: 'Registration' },
    defaultSort: ['date', 'desc'],
    searchHint: 'Search by event, employer or contact',
    fields: [
      employerField,
      contactField,
      { name: 'EventName', label: 'Event name', control: 'text', required: true },
      { name: 'EventDate', label: 'Event date', control: 'date', required: true },
      {
        name: 'RegisteredStatus',
        label: 'Registration',
        control: 'select',
        options: opts(E.REGISTERED_STATUSES),
        required: true,
      },
      { name: 'CMUQAlumniAtBooth', label: 'CMU-Q alumni at the booth', control: 'checkbox' },
      notesField(),
    ],
  },
  {
    recordType: 'student-events',
    base: '/events/student-led',
    listPath: '/events',
    tab: 'student-led',
    tabLabel: 'Student-led',
    singular: 'student-led event',
    plural: 'student-led events',
    title: 'Events',
    description: 'Career fairs, student-led events and academic engagements.',
    idField: 'StudentLedEventID',
    nameOf: (record) => record.EventTitle || record.OrganizationName,
    columns: [
      {
        label: 'Organisation',
        field: 'OrganizationName',
        type: 'link',
        sort: 'organization',
        col: 'col--md',
        primary: true,
        href: (row) => `/events/student-led/${row.StudentLedEventID}`,
      },
      { label: 'Event', field: 'EventTitle', type: 'text', sort: 'title', col: 'col--name' },
      { label: 'Proposed', field: 'ProposalDate', type: 'date', sort: 'proposed', col: 'col--sm' },
      { label: 'Event date', field: 'EventDate', type: 'date', sort: 'date', col: 'col--sm' },
      { ...employerColumn, col: 'col--md' },
      { label: 'Student', field: 'StudentName', type: 'text', col: 'col--md' },
      {
        label: 'Outcome',
        field: 'CollaborationOutcome',
        type: 'badge',
        sort: 'outcome',
        col: 'col--sm',
        tones: { Completed: 'success', Pending: 'info' },
      },
    ],
    filters: [
      {
        param: 'collaborationOutcome',
        label: 'Outcome',
        all: 'Any outcome',
        options: opts(E.COLLABORATION_OUTCOMES),
      },
    ],
    sorts: {
      proposed: 'Proposal date',
      organization: 'Organisation',
      title: 'Event',
      employer: 'Employer',
      outcome: 'Outcome',
      date: 'Event date',
    },
    defaultSort: ['proposed', 'desc'],
    searchHint: 'Search by organisation, event or employer',
    fields: [
      employerField,
      contactField,
      { name: 'OrganizationName', label: 'Student organisation', control: 'text', required: true },
      { name: 'ProposalDate', label: 'Proposal date', control: 'date', required: true },
      { name: 'EventTitle', label: 'Event title', control: 'text' },
      { name: 'EventDate', label: 'Event date', control: 'date' },
      { name: 'StudentName', label: 'Student name', control: 'text', required: true },
      { name: 'StudentEmail', label: 'Student email', control: 'email', required: true },
      { name: 'StudentPhoneNumber', label: 'Student phone', control: 'tel', required: true, max: 50 },
      {
        name: 'CollaborationOutcome',
        label: 'Outcome',
        control: 'select',
        options: opts(E.COLLABORATION_OUTCOMES),
        placeholder: '',
        default: 'Pending',
      },
      notesField(),
    ],
  },
  {
    recordType: 'academic',
    base: '/events/academic',
    listPath: '/events',
    tab: 'academic',
    tabLabel: 'Academic',
    singular: 'academic engagement',
    plural: 'academic engagements',
    title: 'Events',
    description: 'Career fairs, student-led events and academic engagements.',
    idField: 'EngagementID',
    nameOf: (record) => `${record.EngagementType}: ${record.CourseNumber} ${record.CourseTitle}`,
    columns: [
      {
        label: 'Date',
        field: 'SessionDate',
        type: 'date',
        sort: 'date',
        col: 'col--sm',
        primary: true,
        href: (row) => `/events/academic/${row.EngagementID}`,
      },
      { label: 'Type', field: 'EngagementType', type: 'text', sort: 'type', col: 'col--md' },
      { label: 'Speaker', field: 'GuestSpeakerName', type: 'text', sort: 'speaker', col: 'col--md' },
      {
        label: 'Course',
        field: 'Course',
        type: 'text',
        sort: 'course',
        col: 'col--name',
        value: (row) => `${row.CourseNumber} ${row.CourseTitle}`,
      },
      { ...employerColumn, col: 'col--md' },
      { label: 'Faculty', field: 'FacultyName', type: 'text', sort: 'faculty', col: 'col--md' },
    ],
    filters: [{ param: 'engagementType', label: 'Type', all: 'All types', options: opts(E.ENGAGEMENT_TYPES) }],
    sorts: {
      date: 'Session date',
      type: 'Type',
      speaker: 'Speaker',
      course: 'Course',
      employer: 'Employer',
      faculty: 'Faculty',
    },
    defaultSort: ['date', 'desc'],
    searchHint: 'Search by speaker, course, topic or employer',
    fields: [
      employerField,
      contactField,
      {
        name: 'EngagementType',
        label: 'Type',
        control: 'select',
        options: opts(E.ENGAGEMENT_TYPES),
        required: true,
      },
      { name: 'TopicTheme', label: 'Topic or theme', control: 'text', required: true },
      { name: 'GuestSpeakerName', label: 'Guest speaker', control: 'text', required: true },
      { name: 'GuestTitle', label: 'Speaker’s job title', control: 'text', required: true },
      { name: 'Email', label: 'Speaker’s email', control: 'email' },
      { name: 'PhoneNumber', label: 'Speaker’s phone', control: 'tel', max: 50 },
      { name: 'FacultyName', label: 'Faculty member', control: 'text', required: true },
      { name: 'CourseNumber', label: 'Course number', control: 'text', required: true, max: 50 },
      { name: 'CourseTitle', label: 'Course title', control: 'text', required: true },
      { name: 'SessionDate', label: 'Session date', control: 'date', required: true },
      { name: 'SessionTime', label: 'Session time', control: 'time', required: true },
      notesField(),
    ],
  },
  {
    recordType: 'hiring-feedback',
    base: '/hiring-outcomes',
    singular: 'hiring outcome',
    plural: 'hiring outcomes',
    title: 'Hiring outcomes',
    description: 'Reports of students and alumni hired by employers.',
    idField: 'HiringFeedbackID',
    nameOf: (record) => `Hiring outcome at ${record.CompanyName || 'employer'}`,
    columns: [
      {
        label: 'Reported',
        field: 'DateReported',
        type: 'date',
        sort: 'date',
        col: 'col--sm',
        primary: true,
        href: (row) => `/hiring-outcomes/${row.HiringFeedbackID}`,
      },
      { ...employerColumn, col: 'col--name' },
      contactColumn,
      { label: 'Reported by', field: 'FeedbackProvider', type: 'text', sort: 'provider', col: 'col--sm' },
      {
        label: 'Hired',
        field: 'HiredStudentAlumni',
        type: 'badge',
        sort: 'hired',
        col: 'col--xs',
        tones: { Yes: 'success', No: '' },
      },
      { label: 'Student', field: 'HiredStudentName', type: 'text', col: 'col--md' },
    ],
    filters: [
      { param: 'feedbackProvider', label: 'Reported by', all: 'Anyone', options: opts(E.FEEDBACK_PROVIDERS) },
      {
        param: 'hiredStudentAlumni',
        label: 'Hired',
        all: 'Hired or not',
        options: opts(E.FEEDBACK_HIRED_VALUES),
      },
    ],
    sorts: { date: 'Date reported', employer: 'Employer', contact: 'Contact', provider: 'Reported by', hired: 'Hired' },
    defaultSort: ['date', 'desc'],
    searchHint: 'Search by employer, contact or student',
    fields: [
      employerField,
      contactField,
      {
        name: 'FeedbackProvider',
        label: 'Reported by',
        control: 'select',
        options: opts(E.FEEDBACK_PROVIDERS),
        required: true,
      },
      {
        name: 'HiredStudentAlumni',
        label: 'Student or alumnus hired',
        control: 'select',
        options: opts(E.FEEDBACK_HIRED_VALUES),
        required: true,
      },
      { name: 'DateReported', label: 'Date reported', control: 'date', required: true },
      { name: 'HiredStudentName', label: 'Name of the person hired', control: 'text' },
      notesField(),
    ],
  },
  {
    recordType: 'collaboration',
    base: '/collaboration-ideas',
    singular: 'collaboration idea',
    plural: 'collaboration ideas',
    title: 'Collaboration ideas',
    description: 'Ways an employer could work with the university, to follow up later.',
    idField: 'PotentialCollaborationID',
    nameOf: (record) => `Collaboration idea for ${record.CompanyName || 'employer'}`,
    columns: [
      {
        ...employerColumn,
        col: 'col--name',
        primary: true,
        href: (row) => `/collaboration-ideas/${row.PotentialCollaborationID}`,
      },
      { label: 'Opportunities', field: 'Opportunities', type: 'tags', col: 'col--name' },
      {
        label: 'Notes',
        field: 'Comment',
        type: 'text',
        col: 'col--name',
      },
      { label: 'Added', field: 'CreatedAt', type: 'date', sort: 'added', col: 'col--sm' },
    ],
    filters: [
      {
        param: 'opportunity',
        label: 'Opportunity',
        all: 'Any opportunity',
        options: opts(E.COLLABORATION_OPPORTUNITIES),
      },
    ],
    sorts: { employer: 'Employer', added: 'Date added', updated: 'Last edited' },
    defaultSort: ['added', 'desc'],
    searchHint: 'Search by employer or notes',
    fields: [
      employerField,
      {
        name: 'Opportunities',
        label: 'Opportunities',
        control: 'checkboxes',
        options: E.COLLABORATION_OPPORTUNITIES,
      },
      notesField('Notes'),
    ],
  },
];

/** Check every screen against its record type, so a typo fails at start-up rather than on a page. */
for (const screen of SCREENS) {
  const definition = recordTypeByPath(screen.recordType);
  const sortable = definition.list.page?.sorts ?? {};
  for (const key of Object.keys(screen.sorts)) {
    if (!Object.hasOwn(sortable, key)) throw new Error(`Screen ${screen.base}: unknown sort "${key}"`);
  }
  for (const column of screen.columns) {
    if (column.sort && !Object.hasOwn(screen.sorts, column.sort)) {
      throw new Error(`Screen ${screen.base}: column sort "${column.sort}" has no label`);
    }
  }
  const params = new Set(definition.list.filters.map((filter) => filter.param));
  for (const filter of screen.filters) {
    if (!params.has(filter.param)) throw new Error(`Screen ${screen.base}: unknown filter "${filter.param}"`);
  }
  const writable = new Set([...definition.columns, ...definition.children.map((child) => child.field)]);
  for (const field of screen.fields) {
    if (!writable.has(field.name)) throw new Error(`Screen ${screen.base}: unknown field "${field.name}"`);
  }
  screen.definition = definition;
}

const BY_TYPE = new Map(SCREENS.map((screen) => [screen.recordType, screen]));

/** The screen of a record type, e.g. screenFor('outreach'). */
function screenFor(recordType) {
  const screen = BY_TYPE.get(recordType);
  if (!screen) throw new Error(`No screen for ${recordType}`);
  return screen;
}

/** The three record types shown as tabs of /events. */
const EVENT_SCREENS = SCREENS.filter((screen) => screen.listPath === '/events');

module.exports = { SCREENS, EVENT_SCREENS, screenFor };
