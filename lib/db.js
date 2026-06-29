const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BOOLEAN_COLUMNS = new Set([
  'signedmou',
  'favoriteemployer',
  'blacklisted',
  'cmuqgraduate',
  'primarycontact',
  'resumebook',
  'eventinvitation',
  'excludefrommailing',
  'arabicspeaker',
  'cmuqalumniatbooth',
  'mustchangepassword',
]);

const IDENTIFIER_CASE_MAP = new Map(Object.entries({
  company: 'Company',
  companyid: 'CompanyID',
  companyname: 'CompanyName',
  dateadded: 'DateAdded',
  industry: 'Industry',
  sector: 'Sector',
  country: 'Country',
  address: 'Address',
  website: 'Website',
  linkedinurl: 'LinkedInURL',
  handshakeurl: 'HandshakeURL',
  signedmou: 'SignedMoU',
  favoriteemployer: 'FavoriteEmployer',
  blacklisted: 'Blacklisted',
  comment: 'Comment',
  createdat: 'CreatedAt',
  updatedat: 'UpdatedAt',
  contact: 'Contact',
  contactid: 'ContactID',
  firstname: 'FirstName',
  lastname: 'LastName',
  jobtitle: 'JobTitle',
  emailaddress: 'EmailAddress',
  workphone: 'WorkPhone',
  mobile: 'Mobile',
  cmuqgraduate: 'CMUQGraduate',
  major: 'Major',
  graduationyear: 'GraduationYear',
  primarycontact: 'PrimaryContact',
  status: 'Status',
  resumebook: 'ResumeBook',
  eventinvitation: 'EventInvitation',
  excludefrommailing: 'ExcludeFromMailing',
  outreachengagement: 'OutreachEngagement',
  outreachengagementid: 'OutreachEngagementID',
  interactiontype: 'InteractionType',
  interactiondate: 'InteractionDate',
  discussionitems: 'DiscussionItems',
  actionplan: 'ActionPlan',
  followupdate: 'FollowUpDate',
  interactionstatus: 'InteractionStatus',
  recruitment: 'Recruitment',
  recruitmentid: 'RecruitmentID',
  dateposted: 'DatePosted',
  opportunitytitle: 'OpportunityTitle',
  duration: 'Duration',
  hiringstartdate: 'HiringStartDate',
  hiringenddate: 'HiringEndDate',
  mode: 'Mode',
  payamount: 'PayAmount',
  targetgroup: 'TargetGroup',
  arabicspeaker: 'ArabicSpeaker',
  hiredstudentalumni: 'HiredStudentAlumni',
  recruitment_opportunitytype: 'Recruitment_OpportunityType',
  type: 'Type',
  recruitment_collectapplications: 'Recruitment_CollectApplications',
  channel: 'Channel',
  recruitment_targetmajors: 'Recruitment_TargetMajors',
  recruitment_classlevel: 'Recruitment_ClassLevel',
  classlevel: 'ClassLevel',
  potentialcollaboration: 'PotentialCollaboration',
  potentialcollaborationid: 'PotentialCollaborationID',
  potentialcollaboration_opportunities: 'PotentialCollaboration_Opportunities',
  opportunitytype: 'OpportunityType',
  hiringfeedback: 'HiringFeedback',
  hiringfeedbackid: 'HiringFeedbackID',
  feedbackprovider: 'FeedbackProvider',
  datereported: 'DateReported',
  hiredstudentname: 'HiredStudentName',
  careerevent: 'CareerEvent',
  careereventid: 'CareerEventID',
  eventname: 'EventName',
  eventdate: 'EventDate',
  registeredstatus: 'RegisteredStatus',
  cmuqalumniatbooth: 'CMUQAlumniAtBooth',
  studentledevent: 'StudentLedEvent',
  studentledeventid: 'StudentLedEventID',
  proposaldate: 'ProposalDate',
  organizationname: 'OrganizationName',
  studentname: 'StudentName',
  studentemail: 'StudentEmail',
  studentphonenumber: 'StudentPhoneNumber',
  collaborationoutcome: 'CollaborationOutcome',
  eventtitle: 'EventTitle',
  academicclassroomengagement: 'AcademicClassroomEngagement',
  engagementid: 'EngagementID',
  engagementtype: 'EngagementType',
  guestspeakername: 'GuestSpeakerName',
  guesttitle: 'GuestTitle',
  email: 'Email',
  phonenumber: 'PhoneNumber',
  facultyname: 'FacultyName',
  coursenumber: 'CourseNumber',
  coursetitle: 'CourseTitle',
  topictheme: 'TopicTheme',
  sessiondate: 'SessionDate',
  sessiontime: 'SessionTime',
  users: 'Users',
  userid: 'UserID',
  username: 'Username',
  passwordhash: 'PasswordHash',
  role: 'Role',
  mustchangepassword: 'MustChangePassword',
  savedreports: 'SavedReports',
  reportid: 'ReportID',
  reportname: 'ReportName',
  entity: 'Entity',
  columns: 'Columns',
  filters: 'Filters',
  sortby: 'SortBy',
  sortorder: 'SortOrder',
  charttype: 'ChartType',
  chartgroupby: 'ChartGroupBy',
  id: 'ID',
}));

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function createPoolConfig() {
  return {
    host: requiredEnv('DB_HOST'),
    port: Number(process.env.DB_PORT || 5432),
    database: requiredEnv('DB_NAME'),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
  };
}

function castSqliteDateCall(value) {
  const trimmed = value.trim();
  if (/^'now'$/i.test(trimmed)) return 'CURRENT_DATE';
  return `CAST(${trimmed} AS date)`;
}

function replaceDateCalls(sql) {
  let result = '';
  for (let i = 0; i < sql.length; i += 1) {
    if (sql.slice(i, i + 5).toLowerCase() !== 'date(') {
      result += sql[i];
      continue;
    }

    const start = i + 5;
    let depth = 1;
    let j = start;
    let inSingle = false;
    while (j < sql.length && depth > 0) {
      const ch = sql[j];
      if (ch === "'" && sql[j - 1] !== '\\') {
        inSingle = !inSingle;
      } else if (!inSingle && ch === '(') {
        depth += 1;
      } else if (!inSingle && ch === ')') {
        depth -= 1;
      }
      j += 1;
    }

    const inner = sql.slice(start, j - 1);
    const parts = inner.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 1) {
      result += castSqliteDateCall(parts[0]);
    } else if (parts.length === 2 && /^'now'$/i.test(parts[0])) {
      result += `(CURRENT_DATE + ${parts[1]}::interval)`;
    } else {
      result += `CAST(${inner} AS date)`;
    }
    i = j - 1;
  }
  return result;
}

function replaceQuestionPlaceholders(sql) {
  let index = 0;
  let result = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'" && !inDouble && sql[i - 1] !== '\\') {
      inSingle = !inSingle;
      result += ch;
      continue;
    }
    if (ch === '"' && !inSingle && sql[i - 1] !== '\\') {
      inDouble = !inDouble;
      result += ch;
      continue;
    }
    if (ch === '?' && !inSingle && !inDouble) {
      index += 1;
      result += `$${index}`;
      continue;
    }
    result += ch;
  }

  return result;
}

function replaceBooleanComparisons(sql) {
  let result = sql;
  for (const column of BOOLEAN_COLUMNS) {
    const patternBase = `((?:\\b\\w+\\.)?${column})`;
    result = result.replace(new RegExp(`${patternBase}\\s*=\\s*1\\b`, 'gi'), '$1 = TRUE');
    result = result.replace(new RegExp(`${patternBase}\\s*=\\s*0\\b`, 'gi'), '$1 = FALSE');
    result = result.replace(new RegExp(`${patternBase}\\s*!=\\s*1\\b`, 'gi'), '$1 != TRUE');
    result = result.replace(new RegExp(`${patternBase}\\s*!=\\s*0\\b`, 'gi'), '$1 != FALSE');
  }
  return result;
}

function translateSql(sql) {
  return replaceQuestionPlaceholders(
    replaceBooleanComparisons(
      replaceDateCalls(
        sql
          .replace(/datetime\(\s*'now'\s*\)/gi, 'NOW()')
          .replace(/CAST\s*\(\s*julianday\(([^)]+)\)\s*-\s*julianday\(\s*'now'\s*\)\s+AS\s+INTEGER\s*\)/gi, 'CAST(($1::date - CURRENT_DATE) AS INTEGER)')
          .replace(/julianday\(([^)]+)\)\s*-\s*julianday\(\s*'now'\s*\)/gi, '($1::date - CURRENT_DATE)')
          .replace(/strftime\(\s*'%Y-%m'\s*,\s*([^)]+?)\s*\)/gi, "to_char($1, 'YYYY-MM')")
          .replace(/GROUP_CONCAT\(\s*DISTINCT\s+([^)]+?)\s*\)/gi, "STRING_AGG(DISTINCT $1, ',')")
      )
    )
  );
}

function coerceBooleanValue(value) {
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return value;
}

function splitCsv(value) {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function coerceParamsForStatement(sql, params) {
  const next = [...params];
  const insertMatch = sql.match(/insert\s+into\s+[a-z_][\w]*\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\)/i);
  if (insertMatch) {
    const columns = splitCsv(insertMatch[1]);
    const values = splitCsv(insertMatch[2]);
    let paramIndex = 0;
    values.forEach((value, idx) => {
      const placeholderCount = (value.match(/\?/g) || []).length;
      if (placeholderCount === 1 && columns[idx] && BOOLEAN_COLUMNS.has(columns[idx].replace(/"/g, '').toLowerCase())) {
        next[paramIndex] = coerceBooleanValue(next[paramIndex]);
      }
      paramIndex += placeholderCount;
    });
    return next;
  }

  const updateMatch = sql.match(/update\s+[a-z_][\w]*\s+set\s+([\s\S]*?)\s+where\b/i);
  if (updateMatch) {
    const assignments = splitCsv(updateMatch[1]);
    let paramIndex = 0;
    assignments.forEach((assignment) => {
      const placeholderCount = (assignment.match(/\?/g) || []).length;
      const [column] = assignment.split('=');
      if (placeholderCount === 1 && column && BOOLEAN_COLUMNS.has(column.replace(/"/g, '').trim().split('.').pop().toLowerCase())) {
        next[paramIndex] = coerceBooleanValue(next[paramIndex]);
      }
      paramIndex += placeholderCount;
    });
  }

  return next;
}

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function mapRow(row) {
  if (!row) return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => ([
    IDENTIFIER_CASE_MAP.get(key) || key,
    normalizeValue(value),
  ])));
}

function firstRowId(row) {
  if (!row) return undefined;
  const [firstKey] = Object.keys(row);
  return firstKey ? row[firstKey] : undefined;
}

class PgCompatDb {
  constructor(queryable, { release = null } = {}) {
    this.queryable = queryable;
    this.release = release;
  }

  prepare(sql) {
    return {
      get: async (...params) => {
        const result = await this.query(sql, params);
        return mapRow(result.rows[0]);
      },
      all: async (...params) => {
        const result = await this.query(sql, params);
        return result.rows.map(mapRow);
      },
      run: async (...params) => {
        const result = await this.query(sql, params, { runMode: true });
        const row = mapRow(result.rows[0]);
        return {
          changes: result.rowCount || 0,
          lastInsertRowid: firstRowId(row),
        };
      },
    };
  }

  async query(sql, params = [], { runMode = false } = {}) {
    const preparedParams = coerceParamsForStatement(sql, params);
    let translatedSql = translateSql(sql);

    if (runMode && /^\s*insert\b/i.test(sql) && !/\breturning\b/i.test(sql)) {
      translatedSql += ' RETURNING *';
    }

    return this.queryable.query(translatedSql, preparedParams);
  }

  async exec(sql) {
    return this.queryable.query(translateSql(sql));
  }

  async withTransaction(work) {
    if (this.release) {
      await this.exec('BEGIN');
      try {
        const result = await work(this);
        await this.exec('COMMIT');
        return result;
      } catch (error) {
        await this.exec('ROLLBACK');
        throw error;
      }
    }

    const client = await this.queryable.connect();
    const txDb = new PgCompatDb(client, { release: () => client.release() });
    try {
      await txDb.exec('BEGIN');
      const result = await work(txDb);
      await txDb.exec('COMMIT');
      return result;
    } catch (error) {
      await txDb.exec('ROLLBACK');
      throw error;
    } finally {
      txDb.release();
    }
  }

  async close() {
    if (typeof this.queryable.end === 'function') {
      await this.queryable.end();
    }
  }
}

async function loadSchema(db) {
  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  await db.exec(fs.readFileSync(schemaPath, 'utf8'));
}

function createDatabase() {
  return new PgCompatDb(new Pool(createPoolConfig()));
}

module.exports = {
  BOOLEAN_COLUMNS,
  PgCompatDb,
  createDatabase,
  createPoolConfig,
  loadSchema,
  mapRow,
  translateSql,
};
