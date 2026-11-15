#!/usr/bin/env node
'use strict';

/**
 * Fill a development database with demonstration data.
 *
 * Every organisation, person, e-mail address, website and phone number is
 * fictional. Websites and e-mail addresses use the reserved .example domain.
 *
 * THIS SCRIPT DELETES EVERY RECORD before inserting the demo set, so it is
 * fenced in:
 *   - it refuses to run in staging or production, and
 *   - it refuses to touch a database that already contains employers unless
 *     --reset is passed.
 *
 *   npm run seed:demo                              seed an empty development database
 *   npm run seed:demo -- --reset                   wipe the development database and reseed
 *   npm run seed:demo -- --anchor=2026-03-01       date everything relative to that day
 *
 * The data is deterministic: the same anchor date always produces the same
 * rows. Without --anchor the anchor is today in Asia/Qatar.
 */

const { loadConfig, loadDotEnv } = require('../src/config');
const { openDatabase } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { createRandom } = require('./seed/random');
const {
  addDays,
  addMonths,
  daysBetween,
  maxDate,
  minDate,
  todayIn,
  weekday,
  toWorkday,
  sampleDate,
  officeTimestamp,
  parseIso,
} = require('./seed/dates');
const vocab = require('./seed/vocab');
const { EMPLOYERS, QATAR_AREAS, EMPLOYER_COMMENTS } = require('./seed/employers');
const people = require('./seed/people');
const text = require('./seed/phrases');

const SEED = 20260214;
const TIME_ZONE = 'Asia/Qatar';
const HISTORY_MONTHS = 30;

const TARGETS = {
  contacts: 240,
  alumniShare: 0.15,
  outreach: 600,
  inProgressShare: 0.25,
  recruitment: 160,
  studentEvents: 40,
  academic: 60,
  hiringFeedback: 70,
  collaborations: 45,
};

/** Every table the seed fills, children first (the order rows are deleted in). */
const DATA_TABLES = [
  'AcademicClassroomEngagement',
  'StudentLedEvent',
  'HiringFeedback',
  'CareerEvent',
  'PotentialCollaboration_Opportunities',
  'PotentialCollaboration',
  'Recruitment_ClassLevel',
  'Recruitment_TargetMajors',
  'Recruitment_CollectApplications',
  'Recruitment_OpportunityType',
  'Recruitment',
  'OutreachEngagement',
  'Contact',
  'Company',
];

const PHONE_FORMATS = {
  Qatar: (n) => `+974 5550 01${pad(n % 100, 2)}`,
  'United Arab Emirates': (n) => `+971 50 555 01${pad(n % 100, 2)}`,
  'Saudi Arabia': (n) => `+966 55 555 01${pad(n % 100, 2)}`,
  'United Kingdom': (n) => `+44 20 7946 0${pad(n % 1000, 3)}`,
  'United States': (n) => `+1 202 555 01${pad(n % 100, 2)}`,
};

const CURRENCIES = { Qatar: 'QAR', 'United Arab Emirates': 'AED', 'Saudi Arabia': 'SAR' };

const ACTIVITY_WEIGHTS = { high: 10, dormant: 2.5, new: 0 };

const OPPORTUNITY_TYPE_WEIGHTS = [
  ['Internship', 40],
  ['Full-time Job', 18],
  ['Graduate Program', 8],
  ['Part-time Job', 6],
  ['Summer Research Program', 6],
  ['Training Program', 5],
  ['Mentorship Program', 4],
  ['Fellowship', 4],
  ['Competition/Hackathon', 3],
  ['Volunteering', 3],
  ['Others', 3],
];

const MAJOR_WEIGHTS = {
  'Computer Science': 30,
  'Information Systems': 22,
  'Business Administration': 25,
  'Biological Sciences': 13,
  'Artificial Intelligence': 6,
  'Computational Biology': 4,
};

const INDUSTRY_MAJORS = {
  Technology: ['Computer Science', 'Artificial Intelligence', 'Information Systems'],
  Telecommunications: ['Computer Science', 'Information Systems'],
  Healthcare: ['Biological Sciences', 'Computational Biology'],
  'Education & Research': ['Biological Sciences', 'Computer Science'],
  'Banking & Finance': ['Business Administration', 'Information Systems'],
  Consulting: ['Business Administration', 'Information Systems'],
};

const LEVELS_BY_TYPE = {
  Internship: ['Sophomore', 'Junior', 'Senior'],
  'Full-time Job': ['Senior', 'Alumni'],
  'Graduate Program': ['Senior', 'Alumni'],
  'Part-time Job': vocab.CLASS_LEVELS,
  'Summer Research Program': ['Freshman', 'Sophomore', 'Junior'],
  'Training Program': ['Junior', 'Senior', 'Alumni'],
  'Mentorship Program': ['Freshman', 'Sophomore', 'Junior'],
  Fellowship: ['Senior', 'Alumni'],
  'Competition/Hackathon': ['Freshman', 'Sophomore', 'Junior', 'Senior'],
  Volunteering: vocab.CLASS_LEVELS,
  Others: vocab.CLASS_LEVELS,
};

const ENGAGEMENT_TYPE_WEIGHTS = [
  ['Guest Lecture', 30],
  ['Panel Discussion', 18],
  ['Mock Interviews', 15],
  ['Research Collaboration', 10],
  ['Community Project Partnership', 8],
  ['Competition/Hackathon Sponsorship', 8],
  ['Other', 6],
];

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z]/g, '');
}

function formatAmount(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseArgs(argv) {
  const anchorArg = argv.find((arg) => arg.startsWith('--anchor='));
  const anchor = anchorArg ? anchorArg.slice('--anchor='.length) : todayIn(TIME_ZONE);
  parseIso(anchor);
  return { reset: argv.includes('--reset'), anchor };
}

/**
 * Build the complete demo dataset in memory. Pure function of the anchor
 * date: no database access, no clock, no Math.random().
 */
function buildDataset(anchor) {
  const rng = createRandom(SEED);
  const lastDay = addDays(anchor, -1);
  const historyStart = addMonths(anchor, -HISTORY_MONTHS);
  const anchorYear = Number(anchor.slice(0, 4));

  let phoneCounter = 0;
  const usedEmails = new Set();

  const stamps = (date, touchedChance = 0.2) => {
    const createdDay = minDate(addDays(date, rng.int(0, 2)), lastDay);
    const createdAt = officeTimestamp(rng, createdDay);
    if (createdDay < lastDay && rng.chance(touchedChance)) {
      const updatedDay = sampleDate(rng, addDays(createdDay, 1), lastDay, { trend: 2, workday: false });
      return { CreatedAt: createdAt, UpdatedAt: officeTimestamp(rng, updatedDay) };
    }
    return { CreatedAt: createdAt, UpdatedAt: createdAt };
  };

  const nextPhone = (country) => {
    phoneCounter += 1;
    return PHONE_FORMATS[country](phoneCounter);
  };

  const uniqueEmail = (localPart, domain) => {
    let candidate = `${localPart}@${domain}`;
    for (let n = 2; usedEmails.has(candidate); n += 1) candidate = `${localPart}${n}@${domain}`;
    usedEmails.add(candidate);
    return candidate;
  };

  const nextTerm = (date) => {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    if (month <= 5) return rng.chance(0.6) ? `Summer ${year}` : `Fall ${year}`;
    if (month <= 7) return `Fall ${year}`;
    return rng.chance(0.6) ? `Spring ${year + 1}` : `Summer ${year + 1}`;
  };

  const fill = (template, date) =>
    template
      .replace('{major}', rng.pick(vocab.GRADUATE_MAJORS))
      .replace('{term}', nextTerm(date))
      .replace('{n}', String(rng.int(2, 8)));

  /** An invented person. arabicShare is the chance of an Arabic-script name. */
  const inventPerson = (arabicShare, originBoost = {}) => {
    if (rng.chance(arabicShare)) {
      const [first, firstLatin] = rng.pick(people.ARABIC_FIRST_NAMES);
      const [last, lastLatin] = rng.pick(people.ARABIC_LAST_NAMES);
      return { first, last, firstLatin, lastLatin, arabic: true };
    }
    const origins = Object.entries(people.LATIN_NAMES);
    const [, pool] = rng.weighted(origins, ([key, o]) => o.weight * (originBoost[key] || 1));
    const first = rng.pick(pool.first);
    const last = rng.pick(pool.last);
    return { first, last, firstLatin: first, lastLatin: last, arabic: false };
  };

  const originBoostFor = (country) => {
    if (['United Kingdom', 'United States', 'Germany', 'France', 'Canada'].includes(country)) {
      return { european: 4, northAmerican: 4, gulf: 0.2 };
    }
    if (country === 'India') return { southAsian: 6, gulf: 0.2 };
    if (country === 'Singapore') return { southAsian: 2, filipino: 3, european: 2, gulf: 0.2 };
    return {};
  };

  // ── Employers ──────────────────────────────────────────────────────────────
  const employers = EMPLOYERS.map((def, index) => {
    const activity = def.blacklisted ? 'blacklisted' : def.activity || 'regular';
    let dateAdded;
    if (activity === 'high') dateAdded = sampleDate(rng, historyStart, addMonths(anchor, -22));
    else if (activity === 'dormant') dateAdded = sampleDate(rng, historyStart, addMonths(anchor, -15));
    else if (activity === 'blacklisted') dateAdded = sampleDate(rng, historyStart, addMonths(anchor, -17));
    else if (activity === 'new') dateAdded = sampleDate(rng, addDays(anchor, -45), addDays(anchor, -2));
    else dateAdded = sampleDate(rng, historyStart, addDays(anchor, -60), { trend: 0.3 });

    let activeUntil = lastDay;
    if (activity === 'dormant') activeUntil = addDays(addMonths(anchor, -12), -rng.int(5, 90));
    if (activity === 'blacklisted') activeUntil = addDays(addMonths(anchor, -13), -rng.int(5, 60));

    const weight =
      activity === 'regular' ? 1 + rng.next() * 2.5 : activity === 'blacklisted' ? 1.5 : ACTIVITY_WEIGHTS[activity];

    let address = null;
    if (rng.chance(0.85)) {
      address =
        def.country === 'Qatar'
          ? `Office ${rng.int(101, 2405)}, ${rng.pick(QATAR_AREAS[def.city])}, ${def.city}, Qatar`
          : `Level ${rng.int(2, 30)}, ${def.city}, ${def.country}`;
    }

    const createdAt = officeTimestamp(rng, dateAdded);
    let updatedAt = createdAt;
    if (activity === 'blacklisted') {
      updatedAt = officeTimestamp(rng, activeUntil);
    } else if (addDays(dateAdded, 1) <= lastDay && rng.chance(0.35)) {
      updatedAt = officeTimestamp(rng, sampleDate(rng, maxDate(addDays(dateAdded, 1), addDays(anchor, -120)), lastDay));
    }

    return {
      index,
      def,
      activity,
      weight,
      dateAdded,
      activeUntil,
      domain: `${def.slug}.example`,
      row: {
        CompanyName: def.name,
        DateAdded: dateAdded,
        Industry: def.industry,
        Sector: def.sector,
        Country: def.country,
        Address: address,
        Website: rng.chance(0.92) ? `https://www.${def.slug}.example` : null,
        LinkedInURL: rng.chance(0.25) ? `https://www.linkedin.example/company/${def.slug}` : null,
        HandshakeURL: rng.chance(0.12) ? `https://www.handshake.example/employers/${def.slug}` : null,
        SignedMoU: def.mou ? 1 : 0,
        FavoriteEmployer: def.favorite ? 1 : 0,
        Blacklisted: def.blacklisted ? 1 : 0,
        Comment: def.comment || (rng.chance(0.3) ? rng.pick(EMPLOYER_COMMENTS) : null),
        CreatedAt: createdAt,
        UpdatedAt: updatedAt,
      },
      contacts: [],
    };
  });

  // ── Contacts ───────────────────────────────────────────────────────────────
  const contactRange = { high: [4, 6], regular: [2, 4], dormant: [1, 3], new: [1, 2], blacklisted: [1, 2] };
  const contactCounts = employers.map((e) => rng.int(...contactRange[e.activity]));
  let total = contactCounts.reduce((sum, n) => sum + n, 0);
  while (total !== TARGETS.contacts) {
    const i = rng.int(0, employers.length - 1);
    if (total > TARGETS.contacts && contactCounts[i] > 1 && employers[i].activity !== 'high') {
      contactCounts[i] -= 1;
      total -= 1;
    } else if (total < TARGETS.contacts && contactCounts[i] < 6 && employers[i].activity !== 'new') {
      contactCounts[i] += 1;
      total += 1;
    }
  }

  // Alumni are chosen up front so their share does not drift with the anchor date.
  const contactSlots = employers.flatMap((emp, i) => Array.from({ length: contactCounts[i] }, () => emp));
  const alumniSlots = new Set(
    rng.sample(
      contactSlots.map((emp, slot) => (emp.def.blacklisted ? null : slot)).filter((slot) => slot !== null),
      Math.round(TARGETS.contacts * TARGETS.alumniShare)
    )
  );

  const contacts = [];
  employers.forEach((emp, i) => {
    const boost = originBoostFor(emp.def.country);
    const arabicShare = boost.gulf ? 0.08 : 0.37;
    for (let k = 0; k < contactCounts[i]; k += 1) {
      const primary = k === 0;
      const person = inventPerson(arabicShare, boost);
      const dateAdded = primary ? emp.dateAdded : sampleDate(rng, emp.dateAdded, emp.activeUntil);
      const local = rng.chance(0.25)
        ? `${slugify(person.firstLatin)[0]}.${slugify(person.lastLatin)}`
        : `${slugify(person.firstLatin)}.${slugify(person.lastLatin)}`;
      const email = uniqueEmail(local, emp.domain);

      const alumnus = alumniSlots.has(contacts.length);
      const addedYear = Number(dateAdded.slice(0, 4));
      const gradYear = alumnus ? rng.int(Math.min(anchorYear - 14, addedYear - 1), addedYear - 1) : null;

      let jobTitle;
      if (person.arabic && rng.chance(0.3)) jobTitle = rng.pick(people.ARABIC_JOB_TITLES);
      else if (primary) jobTitle = rng.pick(people.PRIMARY_JOB_TITLES);
      else if (alumnus) jobTitle = rng.pick(people.ALUMNI_JOB_TITLES);
      else jobTitle = rng.pick(people.OTHER_JOB_TITLES);

      let country = emp.def.country;
      if (!PHONE_FORMATS[country] && rng.chance(0.5)) country = 'Qatar';
      const hasPhoneFormat = Boolean(PHONE_FORMATS[country]);

      const { CreatedAt: createdAt, UpdatedAt: updatedAt } = stamps(dateAdded, 0.3);
      const contact = {
        employer: emp,
        dateAdded,
        primary,
        eventInvitation: false,
        row: {
          FirstName: person.first,
          LastName: person.last,
          DateAdded: dateAdded,
          JobTitle: jobTitle,
          EmailAddress: email,
          Address: null,
          Country: country,
          WorkPhone: hasPhoneFormat && rng.chance(0.8) ? nextPhone(country) : null,
          Mobile: hasPhoneFormat && rng.chance(0.45) ? nextPhone(country) : null,
          LinkedInURL: rng.chance(0.2) ? `https://www.linkedin.example/in/${local.replace('.', '-')}` : null,
          HandshakeURL: null,
          CMUQGraduate: alumnus ? 1 : 0,
          Major: alumnus ? rng.pick(vocab.GRADUATE_MAJORS) : null,
          GraduationYear: gradYear,
          PrimaryContact: primary ? 1 : 0,
          Status: emp.def.blacklisted || rng.chance(0.18) ? 'Non-mailable' : 'Mailable',
          ResumeBook: rng.chance(0.25) ? 1 : 0,
          EventInvitation: rng.chance(primary ? 0.7 : 0.35) ? 1 : 0,
          ExcludeFromMailing: rng.chance(0.06) ? 1 : 0,
          CreatedAt: createdAt,
          UpdatedAt: updatedAt,
        },
      };
      contact.eventInvitation = contact.row.EventInvitation === 1;
      emp.contacts.push(contact);
      contacts.push(contact);
    }
  });

  // ── Activity helpers ───────────────────────────────────────────────────────
  const windowFor = (emp, margin) => ({
    from: emp.dateAdded,
    to: emp.activeUntil === lastDay ? lastDay : addDays(emp.activeUntil, -margin),
  });

  const pickEmployer = (predicate = () => true, { margin = 0, extraWeight = 0 } = {}) => {
    const pool = employers.filter((e) => {
      if (e.weight <= 0 || !predicate(e)) return false;
      const w = windowFor(e, margin);
      return w.from <= w.to;
    });
    return rng.weighted(pool, (e) => e.weight + extraWeight);
  };

  const contactAt = (emp, date, preferInvited = false) => {
    const pool = emp.contacts.filter((c) => c.dateAdded <= date);
    return rng.weighted(pool, (c) => (c.primary ? 3 : 1) + (preferInvited && c.eventInvitation ? 2 : 0));
  };

  const byDate = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : a.seq - b.seq);

  // ── Outreach ───────────────────────────────────────────────────────────────
  const outreach = [];
  for (let i = 0; i < TARGETS.outreach; i += 1) {
    const emp = pickEmployer();
    const w = windowFor(emp, 0);
    const date = sampleDate(rng, w.from, w.to, { trend: 1.2 });
    const type = rng.weightedValue([
      ['Call', 40],
      ['Meeting', 40],
      ['Company Visit', 20],
    ]);
    const followUp = rng.chance(0.4) ? minDate(addDays(date, rng.int(7, 30)), lastDay) : null;
    outreach.push({
      seq: i,
      employer: emp,
      contact: contactAt(emp, date),
      date,
      row: {
        InteractionType: type,
        InteractionDate: date,
        DiscussionItems: fill(rng.pick(text.OUTREACH_DISCUSSIONS[type]), date),
        ActionPlan: rng.chance(0.85) ? fill(rng.pick(text.ACTION_PLANS), date) : null,
        FollowUpDate: followUp,
        InteractionStatus: 'Complete',
        ...stamps(date),
      },
    });
  }
  outreach.sort(byDate('date'));

  const openCandidates = outreach.filter((o) => o.date >= addDays(anchor, -240) && o.employer.activeUntil === lastDay);
  const openCount = Math.round(TARGETS.outreach * TARGETS.inProgressShare);
  for (const o of rng.sample(openCandidates, openCount)) {
    const age = daysBetween(o.date, anchor);
    let urgency;
    urgency = rng.weightedValue(
      age > 45
        ? [
            ['overdue', 50],
            ['this-week', 15],
            ['later', 35],
          ]
        : [
            ['overdue', 20],
            ['this-week', 40],
            ['later', 40],
          ]
    );
    if (urgency === 'overdue' && addDays(o.date, 7) > lastDay) urgency = 'this-week';

    let followUp;
    if (urgency === 'overdue') followUp = sampleDate(rng, addDays(o.date, 7), lastDay, { workday: false });
    else if (urgency === 'this-week') followUp = addDays(anchor, rng.int(0, 6));
    else followUp = toWorkday(addDays(anchor, rng.int(8, 75)));

    o.row.InteractionStatus = 'In-progress';
    o.row.FollowUpDate = followUp;
    if (!o.row.ActionPlan) o.row.ActionPlan = fill(rng.pick(text.ACTION_PLANS), o.date);
    const touched = maxDate(o.row.CreatedAt.slice(0, 10), addDays(anchor, -rng.int(1, 20)));
    o.row.UpdatedAt = maxDate(o.row.CreatedAt, officeTimestamp(rng, touched));
  }

  // ── Recruitment ────────────────────────────────────────────────────────────
  const recruitment = [];
  for (let i = 0; i < TARGETS.recruitment; i += 1) {
    const emp = pickEmployer();
    const w = windowFor(emp, 0);
    const posted = sampleDate(rng, w.from, w.to, { trend: 0.8 });
    const primaryType = rng.weightedValue(OPPORTUNITY_TYPE_WEIGHTS);
    const types = [primaryType];
    if (rng.chance(0.2)) {
      const second = rng.weightedValue(OPPORTUNITY_TYPE_WEIGHTS);
      if (second !== primaryType) types.push(second);
    }

    const qatariOnly = emp.def.country === 'Qatar' && rng.chance(0.2);
    let title = rng.pick(text.OPPORTUNITY_TITLES[primaryType]);
    if (/[\u0600-\u06FF]/.test(title) && !qatariOnly) title = text.OPPORTUNITY_TITLES[primaryType][0];

    const unpaidType = ['Volunteering', 'Mentorship Program', 'Competition/Hackathon'].includes(primaryType);
    const paid = !unpaidType && rng.chance(primaryType === 'Others' ? 0.3 : 0.82);
    let payAmount = null;
    if (paid) {
      const currency = CURRENCIES[emp.def.country] || 'USD';
      const monthlyQar =
        primaryType === 'Full-time Job' || primaryType === 'Graduate Program'
          ? rng.int(12, 26) * 1000
          : rng.int(6, 14) * 500;
      const amount = currency === 'USD' ? Math.round(monthlyQar / 3.64 / 50) * 50 : monthlyQar;
      payAmount = `${currency} ${formatAmount(amount)}/month`;
    }

    const majorBoost = INDUSTRY_MAJORS[emp.def.industry] || [];
    const majors = rng
      .weightedSample(vocab.MAJORS, rng.int(1, 3), (m) => MAJOR_WEIGHTS[m] * (majorBoost.includes(m) ? 3 : 1))
      .sort((a, b) => vocab.MAJORS.indexOf(a) - vocab.MAJORS.indexOf(b));
    const levelPool = LEVELS_BY_TYPE[primaryType];
    const levels = rng
      .sample(levelPool, rng.int(1, Math.min(3, levelPool.length)))
      .sort((a, b) => vocab.CLASS_LEVELS.indexOf(a) - vocab.CLASS_LEVELS.indexOf(b));
    const channels = rng.weightedSample(
      vocab.APPLICATION_CHANNELS,
      rng.int(1, 2),
      (c) => ({ Handshake: 45, Email: 25, 'Resume book': 20, Other: 10 })[c]
    );

    const hiringStart = addDays(posted, rng.int(0, 10));
    const hiringEnd = addDays(hiringStart, rng.int(21, 60));

    recruitment.push({
      seq: i,
      employer: emp,
      contact: contactAt(emp, posted),
      date: posted,
      hiringEnd,
      types,
      channels,
      majors,
      levels,
      row: {
        DatePosted: posted,
        OpportunityTitle: title,
        Duration: rng.pick(text.DURATIONS[primaryType]),
        HiringStartDate: hiringStart,
        HiringEndDate: hiringEnd,
        Country: rng.chance(0.9) ? emp.def.country : 'Qatar',
        Mode: rng.weightedValue([
          ['Onsite', 60],
          ['Hybrid', 28],
          ['Remote', 12],
        ]),
        Status: paid ? 'Paid' : 'Unpaid',
        PayAmount: payAmount,
        TargetGroup: qatariOnly ? 'Qatari only' : 'Open to all',
        ArabicSpeaker: qatariOnly || rng.chance(0.15) ? 1 : 0,
        HiredStudentAlumni:
          hiringEnd >= anchor
            ? 'Not Reported'
            : rng.weightedValue([
                ['Yes', 30],
                ['No', 25],
                ['Not Reported', 45],
              ]),
        Comment: rng.chance(0.3) ? rng.pick(text.RECRUITMENT_COMMENTS) : null,
        ...stamps(posted, 0.25),
      },
    });
  }

  // ── Hiring feedback (always after a closed posting) ────────────────────────
  const closedPostings = recruitment.filter((r) => addDays(r.hiringEnd, 1) <= r.employer.activeUntil);
  const hiringFeedback = rng
    .weightedSample(closedPostings, TARGETS.hiringFeedback, (r) => r.employer.weight + 1)
    .map((posting, i) => {
      const emp = posting.employer;
      const reported = sampleDate(
        rng,
        addDays(posting.hiringEnd, 1),
        minDate(addDays(posting.hiringEnd, 90), emp.activeUntil)
      );
      const hired = rng.chance(0.65) ? 'Yes' : 'No';
      if (hired === 'Yes') posting.row.HiredStudentAlumni = 'Yes';
      else if (posting.row.HiredStudentAlumni !== 'Yes') posting.row.HiredStudentAlumni = 'No';
      const student = hired === 'Yes' ? inventPerson(0.35) : null;
      return {
        seq: i,
        employer: emp,
        contact: posting.contact.dateAdded <= reported ? posting.contact : contactAt(emp, reported),
        date: reported,
        row: {
          FeedbackProvider: rng.weightedValue([
            ['Company', 60],
            ['Student/Alumni', 30],
            ['Other', 10],
          ]),
          HiredStudentAlumni: hired,
          DateReported: reported,
          HiredStudentName: student ? `${student.first} ${student.last}` : null,
          Comment: rng.chance(0.6) ? rng.pick(text.HIRING_COMMENTS[hired]) : null,
          ...stamps(reported),
        },
      };
    })
    .sort(byDate('date'));
  recruitment.sort(byDate('date'));

  // ── Career events ──────────────────────────────────────────────────────────
  const pastWorkday = (iso) => {
    const day = weekday(iso);
    return day === 5 ? addDays(iso, -1) : day === 6 ? addDays(iso, -2) : iso;
  };
  const careerEvents = [];
  text.CAREER_EVENTS.map((def) => {
    let date;
    if (def.daysAhead) {
      date = toWorkday(addDays(anchor, def.daysAhead));
    } else {
      const onYear = (y) => `${y}-${pad(def.month, 2)}-${pad(def.day, 2)}`;
      const year = onYear(anchorYear) <= lastDay ? anchorYear : anchorYear - 1;
      date = pastWorkday(onYear(year - def.yearsBack));
    }
    return { name: def.name.replace('{year}', date.slice(0, 4)), date, upcoming: Boolean(def.daysAhead) };
  })
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .forEach((event) => {
      const eligible = employers.filter((e) =>
        event.upcoming
          ? e.activeUntil === lastDay && !e.def.blacklisted
          : e.weight > 0 && e.dateAdded <= addDays(event.date, -7) && event.date <= e.activeUntil
      );
      const size = Math.min(eligible.length, rng.int(12, 35));
      const attendees = rng.weightedSample(eligible, size, (e) => e.weight + 1);
      attendees.sort((a, b) => a.index - b.index);
      for (const emp of attendees) {
        const contact = contactAt(emp, minDate(event.date, lastDay), true);
        const status = event.upcoming
          ? rng.chance(0.9)
            ? 'Attended'
            : 'Cancelled'
          : rng.weightedValue([
              ['Attended', 78],
              ['No-Show', 12],
              ['Cancelled', 10],
            ]);
        const commentKey = event.upcoming && status === 'Attended' ? 'Registered' : status;
        const comment =
          event.upcoming && status === 'Attended'
            ? rng.pick(text.CAREER_EVENT_COMMENTS.Registered)
            : rng.chance(0.35)
              ? rng.pick(text.CAREER_EVENT_COMMENTS[commentKey])
              : null;

        let createdAt;
        let updatedAt;
        if (event.upcoming) {
          const registered = sampleDate(rng, maxDate(contact.dateAdded, addDays(anchor, -30)), lastDay);
          createdAt = officeTimestamp(rng, registered);
          updatedAt = createdAt;
        } else {
          const registered = maxDate(contact.dateAdded, addDays(event.date, -rng.int(5, 30)));
          createdAt = officeTimestamp(rng, registered);
          updatedAt = officeTimestamp(rng, minDate(addDays(event.date, rng.int(0, 3)), lastDay));
          if (updatedAt < createdAt) updatedAt = createdAt;
        }

        careerEvents.push({
          employer: emp,
          contact,
          row: {
            EventName: event.name,
            EventDate: event.date,
            RegisteredStatus: status,
            CMUQAlumniAtBooth: status === 'Attended' && rng.chance(0.25) ? 1 : 0,
            Comment: comment,
            CreatedAt: createdAt,
            UpdatedAt: updatedAt,
          },
        });
      }
    });

  // ── Student-led events ─────────────────────────────────────────────────────
  const studentEvents = [];
  for (let i = 0; i < TARGETS.studentEvents; i += 1) {
    const emp = pickEmployer((e) => !e.def.blacklisted, { margin: 60 });
    const w = windowFor(emp, 60);
    const proposal = sampleDate(rng, w.from, w.to, { trend: 0.8 });
    const student = inventPerson(0.3);
    const local = `${slugify(student.firstLatin)}.${slugify(student.lastLatin)}`;
    let eventDate = toWorkday(addDays(proposal, rng.int(14, 50)));
    let outcome = 'Completed';
    if (eventDate > lastDay || rng.chance(0.15)) {
      outcome = 'Pending';
      eventDate = null;
    }
    const title = outcome === 'Completed' || rng.chance(0.6) ? rng.pick(text.STUDENT_EVENT_TITLES) : null;
    studentEvents.push({
      seq: i,
      employer: emp,
      contact: contactAt(emp, proposal),
      date: proposal,
      row: {
        ProposalDate: proposal,
        OrganizationName: rng.pick(text.STUDENT_ORGANIZATIONS),
        StudentName: `${student.first} ${student.last}`,
        StudentEmail: uniqueEmail(local, 'students.university.example'),
        StudentPhoneNumber: nextPhone('Qatar'),
        CollaborationOutcome: outcome,
        EventDate: eventDate,
        EventTitle: title,
        Comment: rng.chance(0.4) ? rng.pick(text.STUDENT_EVENT_COMMENTS) : null,
        ...stamps(proposal, 0.15),
      },
    });
    const row = studentEvents[studentEvents.length - 1].row;
    if (eventDate) row.UpdatedAt = officeTimestamp(rng, minDate(addDays(eventDate, rng.int(0, 3)), lastDay));
    if (row.UpdatedAt < row.CreatedAt) row.UpdatedAt = row.CreatedAt;
  }
  studentEvents.sort(byDate('date'));

  // ── Academic classroom engagements ─────────────────────────────────────────
  const academic = [];
  for (let i = 0; i < TARGETS.academic; i += 1) {
    const type =
      i < vocab.ENGAGEMENT_TYPES.length ? vocab.ENGAGEMENT_TYPES[i] : rng.weightedValue(ENGAGEMENT_TYPE_WEIGHTS);
    const emp = pickEmployer((e) => !e.def.blacklisted);
    const w = windowFor(emp, 0);
    const session = sampleDate(rng, w.from, w.to, { trend: 0.6 });
    const contact = contactAt(emp, session);
    const [courseNumber, courseTitle] = rng.pick(text.COURSES);
    academic.push({
      seq: i,
      employer: emp,
      contact,
      date: session,
      row: {
        EngagementType: type,
        GuestSpeakerName: `${contact.row.FirstName} ${contact.row.LastName}`,
        GuestTitle: contact.row.JobTitle,
        Email: contact.row.EmailAddress,
        PhoneNumber: contact.row.WorkPhone || contact.row.Mobile,
        FacultyName: rng.pick(text.FACULTY_NAMES),
        CourseNumber: courseNumber,
        CourseTitle: courseTitle,
        TopicTheme: rng.pick(text.ENGAGEMENT_TOPICS[type]),
        SessionDate: session,
        SessionTime: rng.pick(text.SESSION_TIMES),
        Comment: rng.chance(0.4) ? rng.pick(text.ACADEMIC_COMMENTS) : null,
        ...stamps(session),
      },
    });
  }
  academic.sort(byDate('date'));

  // ── Potential collaborations (one per employer) ────────────────────────────
  const collaborations = rng
    .weightedSample(
      employers.filter((e) => e.weight > 0 && !e.def.blacklisted),
      TARGETS.collaborations,
      (e) => e.weight + 1
    )
    .map((emp, i) => {
      const date = sampleDate(rng, emp.dateAdded, emp.activeUntil);
      const opportunities = rng.weightedSample(vocab.COLLAB_OPPS, rng.int(1, 4), (o) => (o === 'Other' ? 1 : 6));
      return {
        seq: i,
        employer: emp,
        date,
        opportunities,
        row: {
          Comment: rng.chance(0.8) ? rng.pick(text.COLLABORATION_COMMENTS) : null,
          ...stamps(date, 0.3),
        },
      };
    })
    .sort(byDate('date'));

  return {
    employers,
    contacts,
    outreach,
    recruitment,
    hiringFeedback,
    careerEvents,
    studentEvents,
    academic,
    collaborations,
  };
}

/** Prepared INSERT for a table, taking a plain object whose keys are the column names. */
function inserter(db, table, columns) {
  const stmt = db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`
  );
  return (values) => Number(stmt.run(values).lastInsertRowid);
}

function writeDataset(db, data) {
  const insertCompany = inserter(db, 'Company', Object.keys(data.employers[0].row));
  for (const emp of data.employers) emp.id = insertCompany(emp.row);

  const insertContact = inserter(db, 'Contact', ['CompanyID', ...Object.keys(data.contacts[0].row)]);
  for (const c of data.contacts) c.id = insertContact({ CompanyID: c.employer.id, ...c.row });

  const withParents = (item) => ({ CompanyID: item.employer.id, ContactID: item.contact.id, ...item.row });
  const insertRows = (table, items) => {
    const insert = inserter(db, table, ['CompanyID', 'ContactID', ...Object.keys(items[0].row)]);
    for (const item of items) item.id = insert(withParents(item));
  };

  insertRows('OutreachEngagement', data.outreach);
  insertRows('Recruitment', data.recruitment);

  const insertType = db.prepare('INSERT INTO Recruitment_OpportunityType (RecruitmentID, Type) VALUES (?, ?)');
  const insertChannel = db.prepare(
    'INSERT INTO Recruitment_CollectApplications (RecruitmentID, Channel) VALUES (?, ?)'
  );
  const insertMajor = db.prepare('INSERT INTO Recruitment_TargetMajors (RecruitmentID, Major) VALUES (?, ?)');
  const insertLevel = db.prepare('INSERT INTO Recruitment_ClassLevel (RecruitmentID, ClassLevel) VALUES (?, ?)');
  for (const r of data.recruitment) {
    for (const t of r.types) insertType.run(r.id, t);
    for (const ch of r.channels) insertChannel.run(r.id, ch);
    for (const m of r.majors) insertMajor.run(r.id, m);
    for (const l of r.levels) insertLevel.run(r.id, l);
  }

  insertRows('HiringFeedback', data.hiringFeedback);
  insertRows('CareerEvent', data.careerEvents);
  insertRows('StudentLedEvent', data.studentEvents);
  insertRows('AcademicClassroomEngagement', data.academic);

  const insertCollab = inserter(db, 'PotentialCollaboration', ['CompanyID', 'Comment', 'CreatedAt', 'UpdatedAt']);
  const insertOpportunity = db.prepare(
    'INSERT INTO PotentialCollaboration_Opportunities (PotentialCollaborationID, OpportunityType) VALUES (?, ?)'
  );
  for (const c of data.collaborations) {
    const id = insertCollab({ CompanyID: c.employer.id, ...c.row });
    for (const o of c.opportunities) insertOpportunity.run(id, o);
  }
}

const ACTIVITY_TABLES = [
  ['OutreachEngagement', 'InteractionDate'],
  ['Recruitment', 'DatePosted'],
  ['HiringFeedback', 'DateReported'],
  ['CareerEvent', null],
  ['StudentLedEvent', 'ProposalDate'],
  ['AcademicClassroomEngagement', 'SessionDate'],
];

const LINK_COLUMNS = [
  ['Company', 'CompanyID', ['Website', 'LinkedInURL', 'HandshakeURL']],
  ['Contact', 'ContactID', ['EmailAddress', 'LinkedInURL', 'HandshakeURL']],
  ['StudentLedEvent', 'StudentLedEventID', ['StudentEmail']],
  ['AcademicClassroomEngagement', 'EngagementID', ['Email']],
];

/** Verify the seeded data. Returns a list of problems (empty when everything is in order). */
function selfCheck(db) {
  const problems = [];

  for (const [table, idColumn, columns] of LINK_COLUMNS) {
    for (const column of columns) {
      const rows = db
        .prepare(`SELECT ${idColumn} AS id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`)
        .all();
      for (const { id, value } of rows) {
        if (!value.endsWith('.example') && !value.includes('.example/')) {
          problems.push(`${table}.${column} #${id} is not a .example address: ${value}`);
        }
      }
    }
  }

  for (const v of db.pragma('foreign_key_check')) {
    problems.push(`Foreign key violation in ${v.table} row ${v.rowid} (references ${v.parent})`);
  }

  for (const r of db
    .prepare('SELECT CompanyID, SUM(PrimaryContact = 1) AS n FROM Contact GROUP BY CompanyID HAVING n <> 1')
    .all()) {
    problems.push(`Employer #${r.CompanyID} has ${r.n} primary contacts (expected exactly 1)`);
  }

  for (const r of db
    .prepare(
      `SELECT co.ContactID FROM Contact co JOIN Company c ON c.CompanyID = co.CompanyID
       WHERE c.Blacklisted = 1 AND co.Status = 'Mailable'`
    )
    .all()) {
    problems.push(`Contact #${r.ContactID} belongs to a blacklisted employer but is Mailable`);
  }

  for (const [table, dateColumn] of ACTIVITY_TABLES) {
    const mismatched = db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${table} a JOIN Contact co ON co.ContactID = a.ContactID WHERE co.CompanyID <> a.CompanyID`
      )
      .get().n;
    if (mismatched) problems.push(`${table}: ${mismatched} row(s) whose contact belongs to another employer`);
    if (dateColumn) {
      const early = db
        .prepare(
          `SELECT COUNT(*) AS n FROM ${table} a JOIN Company c ON c.CompanyID = a.CompanyID WHERE a.${dateColumn} < c.DateAdded`
        )
        .get().n;
      if (early) problems.push(`${table}: ${early} row(s) dated before the employer was added`);
    }
  }

  return problems;
}

function printSummary(db, anchor) {
  console.log(`\nDemo data seeded (anchor date ${anchor}):\n`);
  const width = Math.max(...DATA_TABLES.map((t) => t.length));
  console.log(`  ${'Table'.padEnd(width)}  Rows`);
  console.log(`  ${'-'.repeat(width)}  ----`);
  for (const table of DATA_TABLES.slice().reverse()) {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    console.log(`  ${table.padEnd(width)}  ${String(n).padStart(4)}`);
  }
  console.log(
    '\nAll organisations, people, e-mail addresses, websites and phone numbers are fictional demonstration data.'
  );
}

async function main() {
  loadDotEnv();
  const config = loadConfig();

  if (config.isProductionLike) {
    throw new Error(
      `Refusing to run in "${config.env}". Demo data is for development only and this script deletes all records.`
    );
  }

  const { reset, anchor } = parseArgs(process.argv.slice(2));

  const db = openDatabase(config.databasePath);
  await migrate(db, { logger: { info() {}, warn() {} } });

  const existing = db.prepare('SELECT COUNT(*) AS n FROM Company').get().n;
  if (existing > 0 && !reset) {
    db.close();
    throw new Error(
      `${config.databasePath} already contains ${existing} employer(s). Nothing was changed. ` +
        'Run "npm run seed:demo -- --reset" to delete everything in this development database and reseed.'
    );
  }

  console.log('Seeding database…');
  const data = buildDataset(anchor);

  try {
    db.transaction(() => {
      for (const table of DATA_TABLES) db.prepare(`DELETE FROM ${table}`).run();
      db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${DATA_TABLES.map(() => '?').join(', ')})`).run(
        ...DATA_TABLES
      );

      writeDataset(db, data);

      const problems = selfCheck(db);
      if (problems.length) {
        throw new Error(
          `Self-check failed; nothing was saved.\n  - ${problems.slice(0, 20).join('\n  - ')}` +
            (problems.length > 20 ? `\n  … and ${problems.length - 20} more` : '')
        );
      }
    })();
    printSummary(db, anchor);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`Seed failed: ${err.message}`);
  process.exit(1);
});
