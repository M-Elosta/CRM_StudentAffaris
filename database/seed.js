const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'employer.db');
if (!fs.existsSync(path.join(__dirname, '..', 'data')))
  fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

const db = new Database(DB_PATH);
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

console.log('Seeding database…');

// Clear all data (order respects FK constraints)
db.exec(`
  DELETE FROM AcademicClassroomEngagement;
  DELETE FROM StudentLedEvent;
  DELETE FROM HiringFeedback;
  DELETE FROM CareerEvent;
  DELETE FROM PotentialCollaboration_Opportunities;
  DELETE FROM PotentialCollaboration;
  DELETE FROM Recruitment_ClassLevel;
  DELETE FROM Recruitment_TargetMajors;
  DELETE FROM Recruitment_CollectApplications;
  DELETE FROM Recruitment_OpportunityType;
  DELETE FROM Recruitment;
  DELETE FROM OutreachEngagement;
  DELETE FROM Contact;
  DELETE FROM Company;
  DELETE FROM sqlite_sequence WHERE name IN (
    'Company','Contact','OutreachEngagement','Recruitment','CareerEvent',
    'HiringFeedback','StudentLedEvent','AcademicClassroomEngagement',
    'PotentialCollaboration'
  );
`);

// ── Companies ──────────────────────────────────────────────────────────────────
const companies = [
  { CompanyName:'Qatar Airways',       Industry:'Aviation',          Sector:'Semi-government', Country:'Qatar',         Website:'https://qatarairways.com',    SignedMoU:1, FavoriteEmployer:1, Blacklisted:0 },
  { CompanyName:'Qatar National Bank', Industry:'Banking & Finance', Sector:'Semi-government', Country:'Qatar',         Website:'https://qnb.com',             SignedMoU:1, FavoriteEmployer:1, Blacklisted:0 },
  { CompanyName:'Ooredoo Qatar',       Industry:'Telecommunications', Sector:'Semi-government',Country:'Qatar',         Website:'https://ooredoo.qa',          SignedMoU:0, FavoriteEmployer:0, Blacklisted:0 },
  { CompanyName:'Qatar Foundation',    Industry:'Education & Research',Sector:'Government',    Country:'Qatar',         Website:'https://qf.org.qa',           SignedMoU:1, FavoriteEmployer:1, Blacklisted:0 },
  { CompanyName:'Sidra Medicine',      Industry:'Healthcare',        Sector:'Government',      Country:'Qatar',         Website:'https://sidra.org',           SignedMoU:0, FavoriteEmployer:1, Blacklisted:0 },
  { CompanyName:'McKinsey & Company',  Industry:'Consulting',        Sector:'Private',         Country:'Qatar',         Website:'https://mckinsey.com',        SignedMoU:0, FavoriteEmployer:1, Blacklisted:0 },
  { CompanyName:'PwC Qatar',           Industry:'Consulting',        Sector:'Private',         Country:'Qatar',         Website:'https://pwc.com/qa',          SignedMoU:0, FavoriteEmployer:0, Blacklisted:0 },
  { CompanyName:'Microsoft Qatar',     Industry:'Technology',        Sector:'Private',         Country:'Qatar',         Website:'https://microsoft.com',       SignedMoU:0, FavoriteEmployer:0, Blacklisted:0 },
  { CompanyName:'Google MENA',         Industry:'Technology',        Sector:'Private',         Country:'UAE',           Website:'https://google.com',          SignedMoU:0, FavoriteEmployer:1, Blacklisted:0 },
  { CompanyName:'Amazon Web Services', Industry:'Technology',        Sector:'Private',         Country:'UAE',           Website:'https://aws.amazon.com',      SignedMoU:0, FavoriteEmployer:0, Blacklisted:0 },
  { CompanyName:'KPMG Qatar',          Industry:'Audit & Tax',       Sector:'Private',         Country:'Qatar',         Website:'https://kpmg.com/qa',         SignedMoU:0, FavoriteEmployer:0, Blacklisted:0 },
  { CompanyName:'Hamad Medical Corp',  Industry:'Healthcare',        Sector:'Government',      Country:'Qatar',         Website:'https://hamad.qa',            SignedMoU:1, FavoriteEmployer:0, Blacklisted:0 },
  { CompanyName:'Careem',              Industry:'Technology',        Sector:'Startup',         Country:'UAE',           Website:'https://careem.com',          SignedMoU:0, FavoriteEmployer:0, Blacklisted:0 },
  { CompanyName:'AlphaTech Solutions', Industry:'Technology',        Sector:'Startup',         Country:'Qatar',         Website:null,                          SignedMoU:0, FavoriteEmployer:0, Blacklisted:1, Comment:'Fraudulent internship offer 2024' },
  { CompanyName:'Gulf Bridge Intl',    Industry:'Telecommunications', Sector:'Private',        Country:'Qatar',         Website:null,                          SignedMoU:0, FavoriteEmployer:0, Blacklisted:1, Comment:'No response after 3 follow-ups' },
];

const insertCompany = db.prepare(`
  INSERT INTO Company (CompanyName,DateAdded,Industry,Sector,Country,Website,SignedMoU,FavoriteEmployer,Blacklisted,Comment)
  VALUES (?,date('now','-'||(abs(random())%365)||' days'),?,?,?,?,?,?,?,?)`);

const companyIds = [];
for (const c of companies) {
  const info = insertCompany.run(c.CompanyName, c.Industry, c.Sector, c.Country, c.Website||null, c.SignedMoU, c.FavoriteEmployer, c.Blacklisted, c.Comment||null);
  companyIds.push(info.lastInsertRowid);
}

// ── Contacts ───────────────────────────────────────────────────────────────────
const contacts = [
  { ci:0, FirstName:'Ahmed',     LastName:'Al-Sayed',    Email:'ahmed.alsayed@qatarairways.com',    JobTitle:'Talent Acquisition Manager',  Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:1, CMUQGraduate:0 },
  { ci:0, FirstName:'Fatima',    LastName:'Al-Rashid',   Email:'f.rashid@qatarairways.com',          JobTitle:'HR Business Partner',         Status:'Mailable',     PrimaryContact:0, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
  { ci:1, FirstName:'Mohammed',  LastName:'Al-Kuwari',   Email:'m.kuwari@qnb.com.qa',               JobTitle:'Head of Campus Relations',    Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:1, CMUQGraduate:1, Major:'Business Administration', GraduationYear:2018 },
  { ci:1, FirstName:'Sara',      LastName:'Hassan',      Email:'sara.hassan@qnb.com.qa',            JobTitle:'Graduate Programme Manager',  Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:1, CMUQGraduate:0 },
  { ci:2, FirstName:'Khalid',    LastName:'Al-Emadi',    Email:'k.emadi@ooredoo.qa',                JobTitle:'Internship Coordinator',      Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
  { ci:3, FirstName:'Nour',      LastName:'Al-Khulaifi', Email:'nour.khulaifi@qf.org.qa',           JobTitle:'Research Partnerships Lead',  Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:1, CMUQGraduate:1, Major:'Computer Science', GraduationYear:2020 },
  { ci:4, FirstName:'Dr. Layla', LastName:'Mahmoud',     Email:'l.mahmoud@sidra.org',               JobTitle:'Research Director',           Status:'Mailable',     PrimaryContact:1, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
  { ci:5, FirstName:'James',     LastName:'Carter',      Email:'j.carter@mckinsey.com',             JobTitle:'Partner',                     Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
  { ci:6, FirstName:'Aisha',     LastName:'Al-Mannai',   Email:'a.mannai@pwc.com',                  JobTitle:'Assurance Director',          Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:1, CMUQGraduate:1, Major:'Business Administration', GraduationYear:2017 },
  { ci:7, FirstName:'David',     LastName:'Kim',         Email:'d.kim@microsoft.com',               JobTitle:'University Relations Manager',Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
  { ci:8, FirstName:'Priya',     LastName:'Sharma',      Email:'p.sharma@google.com',               JobTitle:'Campus Lead MENA',            Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:1, CMUQGraduate:0 },
  { ci:9, FirstName:'Omar',      LastName:'Al-Farsi',    Email:'o.farsi@aws.amazon.com',            JobTitle:'Solutions Architect',         Status:'Mailable',     PrimaryContact:1, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
  { ci:10,FirstName:'Reem',      LastName:'Al-Thani',    Email:'r.thani@kpmg.com',                  JobTitle:'Audit Manager',               Status:'Non-mailable', PrimaryContact:1, EventInvitation:0, ResumeBook:0, CMUQGraduate:0, ExcludeFromMailing:1 },
  { ci:11,FirstName:'Hassan',    LastName:'Jaber',        Email:'h.jaber@hamad.qa',                  JobTitle:'HR Director',                 Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
  { ci:12,FirstName:'Mariam',    LastName:'Al-Dosari',   Email:'m.dosari@careem.com',               JobTitle:'Engineering Recruiter',       Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:1, CMUQGraduate:1, Major:'Computer Science', GraduationYear:2021 },
  // Extra contacts
  { ci:0, FirstName:'Yousef',    LastName:'Alnuaimi',    Email:'y.alnuaimi@qatarairways.com',       JobTitle:'Training Coordinator',        Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:1, CMUQGraduate:0 },
  { ci:3, FirstName:'Tamara',    LastName:'Obeid',       Email:'t.obeid@qf.org.qa',                 JobTitle:'Innovation Manager',          Status:'Mailable',     PrimaryContact:0, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
  { ci:5, FirstName:'Alex',      LastName:'Moreau',      Email:'a.moreau@mckinsey.com',             JobTitle:'Senior Consultant',           Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
  { ci:1, FirstName:'Hessa',     LastName:'Al-Mulla',    Email:'h.mulla@qnb.com.qa',               JobTitle:'Compliance Officer',          Status:'Non-mailable', PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
  { ci:4, FirstName:'Tarek',     LastName:'Mansour',     Email:'t.mansour@sidra.org',              JobTitle:'Clinical Research Coord.',    Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:1, Major:'Biological Sciences', GraduationYear:2019 },
  { ci:7, FirstName:'Linda',     LastName:'Chen',        Email:'l.chen@microsoft.com',              JobTitle:'Sr. Software Engineer',       Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
  { ci:6, FirstName:'Rawda',     LastName:'Al-Suwaidi',  Email:'r.suwaidi@pwc.com',                JobTitle:'Tax Consultant',              Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:1, CMUQGraduate:1, Major:'Business Administration', GraduationYear:2022 },
  { ci:11,FirstName:'Nadia',     LastName:'Saleh',       Email:'n.saleh@hamad.qa',                  JobTitle:'Nursing Manager',             Status:'Mailable',     PrimaryContact:0, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
  { ci:8, FirstName:'Rania',     LastName:'Qasim',       Email:'r.qasim@google.com',               JobTitle:'Developer Advocate',          Status:'Mailable',     PrimaryContact:0, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
  { ci:2, FirstName:'Faisal',    LastName:'Al-Qahtani',  Email:'f.qahtani@ooredoo.qa',             JobTitle:'Network Engineer',            Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
  { ci:12,FirstName:'Ziad',      LastName:'Habib',       Email:'z.habib@careem.com',               JobTitle:'Product Manager',             Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:1, CMUQGraduate:1, Major:'Information Systems', GraduationYear:2023 },
  { ci:9, FirstName:'Grace',     LastName:'Okonkwo',     Email:'g.okonkwo@aws.amazon.com',         JobTitle:'Cloud Architect',             Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
  { ci:10,FirstName:'Khalil',    LastName:'Badawi',      Email:'k.badawi@kpmg.com',                JobTitle:'IT Audit Manager',            Status:'Mailable',     PrimaryContact:0, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
  { ci:3, FirstName:'Dina',      LastName:'Al-Jaber',    Email:'d.jaber@qf.org.qa',               JobTitle:'Education Programme Mgr.',    Status:'Mailable',     PrimaryContact:0, EventInvitation:1, ResumeBook:1, CMUQGraduate:0 },
  { ci:5, FirstName:'Patrick',   LastName:'O\'Brien',    Email:'p.obrien@mckinsey.com',            JobTitle:'Associate',                   Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:1, Major:'Business Administration', GraduationYear:2023 },
];

const insertContact = db.prepare(`
  INSERT INTO Contact (CompanyID,FirstName,LastName,DateAdded,JobTitle,EmailAddress,Status,PrimaryContact,EventInvitation,ResumeBook,ExcludeFromMailing,CMUQGraduate,Major,GraduationYear)
  VALUES (?,?,?,date('now','-'||(abs(random())%300)||' days'),?,?,?,?,?,?,?,?,?,?)`);

const contactIds = [];
for (const c of contacts) {
  const info = insertContact.run(
    companyIds[c.ci], c.FirstName, c.LastName, c.JobTitle||null, c.Email,
    c.Status, c.PrimaryContact?1:0, c.EventInvitation?1:0, c.ResumeBook?1:0,
    c.ExcludeFromMailing?1:0, c.CMUQGraduate?1:0, c.Major||null, c.GraduationYear||null
  );
  contactIds.push(info.lastInsertRowid);
}

// ── Outreach ───────────────────────────────────────────────────────────────────
const outreachData = [
  { ci:0, coi:0, type:'Meeting', date:'2025-09-10', discussion:'Discussed summer internship programme for 2026. Qatar Airways wants to recruit 3 CS and 2 BA students.', action:'Send internship programme details and student profiles.', followUp:'2025-10-01', status:'In-progress' },
  { ci:1, coi:2, type:'Call',    date:'2025-09-15', discussion:'QNB interested in expanding graduate programme to include CMU-Q students.', action:'Arrange campus visit for October.', followUp:'2025-09-30', status:'In-progress' },
  { ci:3, coi:5, type:'Meeting', date:'2025-10-02', discussion:'Qatar Foundation keen on research collaboration for AI and biotech projects.', action:'Share list of faculty research projects.', followUp:'2025-10-20', status:'In-progress' },
  { ci:5, coi:7, type:'Company Visit', date:'2025-08-20', discussion:'Visited McKinsey Doha office. Discussed case competition sponsorship.', action:'Follow up on sponsorship proposal.', followUp:'2024-09-01', status:'Complete' },
  { ci:4, coi:6, type:'Call',    date:'2025-10-05', discussion:'Sidra interested in hiring biology students for summer research positions.', action:'Send research programme flyer.', followUp:'2025-10-25', status:'In-progress' },
  { ci:8, coi:10, type:'Meeting', date:'2025-09-25', discussion:'Google MENA interested in hosting a technical workshop on campus.', action:'Coordinate with Student Affairs on venue.', followUp:'2025-10-15', status:'In-progress' },
  { ci:6, coi:8, type:'Call',    date:'2025-10-08', discussion:'PwC wants to participate in Fall Career Fair. Requested student resume book.', action:'Send resume book extract and booth details.', followUp:'2025-10-18', status:'Complete' },
  { ci:7, coi:9, type:'Meeting', date:'2025-08-05', discussion:'Microsoft discussed Azure certification programme for students.', action:'Connect with IT department.', followUp:'2024-08-30', status:'Complete' },
  { ci:11,coi:13, type:'Call',   date:'2025-10-10', discussion:'HMC interested in medical internship programme for biomedical students.', action:'Prepare internship agreement draft.', followUp:'2025-11-01', status:'In-progress' },
  { ci:2, coi:4, type:'Company Visit', date:'2025-09-18', discussion:'Tour of Ooredoo HQ. Discussed co-op programme and IS student recruitment.', action:'None needed — send thank you note.', followUp:null, status:'Complete' },
];

const insertOutreach = db.prepare(`
  INSERT INTO OutreachEngagement (CompanyID,ContactID,InteractionType,InteractionDate,DiscussionItems,ActionPlan,FollowUpDate,InteractionStatus)
  VALUES (?,?,?,?,?,?,?,?)`);

for (const o of outreachData) {
  insertOutreach.run(companyIds[o.ci], contactIds[o.coi], o.type, o.date, o.discussion, o.action||null, o.followUp||null, o.status);
}

// ── Recruitment ────────────────────────────────────────────────────────────────
const recruitments = [
  { ci:0, coi:0, title:'Summer Internship 2026',       mode:'Onsite', status:'Paid',   target:'Open to all', types:['Internship'],              majors:['Computer Science','Business Administration'], levels:['Junior','Senior'],           date:'2025-09-01', hired:'Not Reported', payAmount:'QAR 5,000/month' },
  { ci:1, coi:2, title:'QNB Graduate Programme 2026',  mode:'Onsite', status:'Paid',   target:'Qatari only', types:['Graduate Program'],         majors:['Business Administration'],                   levels:['Senior','Alumni'],           date:'2025-08-15', hired:'Yes', payAmount:'QAR 12,000/month' },
  { ci:4, coi:6, title:'Research Summer 2026',         mode:'Onsite', status:'Paid',   target:'Open to all', types:['Summer Research Program'],  majors:['Biological Sciences','Computer Science'],    levels:['Sophomore','Junior'],        date:'2025-10-01', hired:'Not Reported', payAmount:'QAR 4,000/month' },
  { ci:5, coi:7, title:'Business Analyst Internship',  mode:'Hybrid', status:'Paid',   target:'Open to all', types:['Internship','Fellowship'],  majors:['Business Administration','Information Systems'],levels:['Junior','Senior'],        date:'2025-09-20', hired:'No',  payAmount:'QAR 6,000/month' },
  { ci:8, coi:10,title:'STEP Internship MENA',         mode:'Remote', status:'Paid',   target:'Open to all', types:['Internship'],              majors:['Computer Science'],                          levels:['Sophomore','Junior','Senior'],date:'2025-07-01', hired:'Yes', payAmount:'USD 3,500/month' },
  { ci:2, coi:4, title:'Co-op Network Engineering',    mode:'Onsite', status:'Paid',   target:'Open to all', types:['Internship','Training Program'],majors:['Computer Science','Information Systems'],levels:['Junior'],               date:'2025-10-05', hired:'Not Reported', payAmount:'QAR 4,500/month' },
  { ci:12,coi:14,title:'Product Management Intern',    mode:'Hybrid', status:'Unpaid', target:'Open to all', types:['Internship'],              majors:['Information Systems','Business Administration'],levels:['Junior','Senior'],      date:'2025-09-10', hired:'Not Reported', payAmount:null },
  { ci:11,coi:13,title:'Medical Research Volunteer',   mode:'Onsite', status:'Unpaid', target:'Open to all', types:['Volunteering'],            majors:['Biological Sciences'],                       levels:['Freshman','Sophomore'],      date:'2025-10-08', hired:'Not Reported', payAmount:null },
];

const insertRecruit = db.prepare(`INSERT INTO Recruitment (CompanyID,ContactID,DatePosted,OpportunityTitle,Mode,Status,TargetGroup,ArabicSpeaker,HiredStudentAlumni,PayAmount) VALUES (?,?,?,?,?,?,?,0,?,?)`);
const insertOppType = db.prepare(`INSERT INTO Recruitment_OpportunityType (RecruitmentID,Type) VALUES (?,?)`);
const insertCollect = db.prepare(`INSERT INTO Recruitment_CollectApplications (RecruitmentID,Channel) VALUES (?,?)`);
const insertMajor   = db.prepare(`INSERT INTO Recruitment_TargetMajors (RecruitmentID,Major) VALUES (?,?)`);
const insertLevel   = db.prepare(`INSERT INTO Recruitment_ClassLevel (RecruitmentID,ClassLevel) VALUES (?,?)`);

for (const r of recruitments) {
  const info = insertRecruit.run(companyIds[r.ci], contactIds[r.coi], r.date, r.title, r.mode, r.status, r.target, r.hired, r.payAmount||null);
  const rid  = info.lastInsertRowid;
  for (const t of r.types)  insertOppType.run(rid, t);
  insertCollect.run(rid, 'Handshake');
  for (const m of r.majors) insertMajor.run(rid, m);
  for (const l of r.levels) insertLevel.run(rid, l);
}

// ── Career Events ──────────────────────────────────────────────────────────────
const events = [
  { ci:0, coi:0,  name:'Fall Career Fair 2025',          date:'2025-10-15', status:'Attended',   alumni:1 },
  { ci:1, coi:2,  name:'Fall Career Fair 2025',          date:'2025-10-15', status:'Attended',   alumni:0 },
  { ci:6, coi:8,  name:'Fall Career Fair 2025',          date:'2025-10-15', status:'Attended',   alumni:1 },
  { ci:8, coi:10, name:'Fall Career Fair 2025',          date:'2025-10-15', status:'No-Show',    alumni:0 },
  { ci:5, coi:7,  name:'Consulting Info Session',        date:'2025-09-22', status:'Attended',   alumni:0 },
  { ci:4, coi:6,  name:'Healthcare Careers Panel',       date:'2025-09-18', status:'Attended',   alumni:0 },
  { ci:11,coi:13, name:'Healthcare Careers Panel',       date:'2025-09-18', status:'Cancelled',  alumni:0 },
  { ci:7, coi:9,  name:'Tech Industry Night',            date:'2025-08-28', status:'Attended',   alumni:1 },
  { ci:2, coi:4,  name:'Tech Industry Night',            date:'2025-08-28', status:'No-Show',    alumni:0 },
  { ci:3, coi:5,  name:'Research & Innovation Showcase', date:'2025-10-08', status:'Attended',   alumni:0 },
];

const insertEvent = db.prepare(`INSERT INTO CareerEvent (CompanyID,ContactID,EventName,EventDate,RegisteredStatus,CMUQAlumniAtBooth) VALUES (?,?,?,?,?,?)`);
for (const e of events) insertEvent.run(companyIds[e.ci], contactIds[e.coi], e.name, e.date, e.status, e.alumni);

// ── Academic Engagements ───────────────────────────────────────────────────────
const academic = [
  { ci:5, coi:7,  type:'Guest Lecture',    speaker:'James Carter',       title:'Partner',                 faculty:'Prof. R. Krishnan', course:'73-100', courseTitle:'Principles of Management', topic:'Strategy Consulting in Emerging Markets', date:'2025-09-30', time:'10:00' },
  { ci:8, coi:10, type:'Panel Discussion', speaker:'Priya Sharma',       title:'Campus Lead MENA',         faculty:'Prof. A. Jacobs',   course:'15-110', courseTitle:'Principles of Computing',  topic:'Women in Tech & Building a Career at Google', date:'2025-10-07', time:'14:00' },
  { ci:4, coi:6,  type:'Research Collaboration', speaker:'Dr. Layla Mahmoud', title:'Research Director',   faculty:'Prof. M. El-Deeb',  course:'03-121', courseTitle:'Modern Biology',           topic:'Precision Medicine & AI in Clinical Research', date:'2025-10-14', time:'11:00' },
];

const insertAcademic = db.prepare(`INSERT INTO AcademicClassroomEngagement (CompanyID,ContactID,EngagementType,GuestSpeakerName,GuestTitle,FacultyName,CourseNumber,CourseTitle,TopicTheme,SessionDate,SessionTime) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
for (const a of academic) insertAcademic.run(companyIds[a.ci], contactIds[a.coi], a.type, a.speaker, a.title, a.faculty, a.course, a.courseTitle, a.topic, a.date, a.time);

// ── Student-Led Events ─────────────────────────────────────────────────────────
const studentEvents = [
  { ci:5, coi:7,  proposal:'2025-09-05', org:'CMU-Q Consulting Club', student:'Ali Hassan',     email:'ali@cmu.edu.qa', phone:'+97466001001', outcome:'Completed', eventDate:'2025-10-02', title:'Case Competition Workshop' },
  { ci:0, coi:0,  proposal:'2025-09-12', org:'CMU-Q Business Society', student:'Moza Al-Ali',  email:'moza@cmu.edu.qa', phone:'+97466001002', outcome:'Pending',   eventDate:null,          title:null },
  { ci:8, coi:10, proposal:'2025-10-01', org:'CMU-Q Tech Club',        student:'Rami Safi',    email:'rami@cmu.edu.qa', phone:'+97466001003', outcome:'Pending',   eventDate:null,          title:'Google Hackathon Prep Session' },
];

const insertSE = db.prepare(`INSERT INTO StudentLedEvent (CompanyID,ContactID,ProposalDate,OrganizationName,StudentName,StudentEmail,StudentPhoneNumber,CollaborationOutcome,EventDate,EventTitle) VALUES (?,?,?,?,?,?,?,?,?,?)`);
for (const s of studentEvents) insertSE.run(companyIds[s.ci], contactIds[s.coi], s.proposal, s.org, s.student, s.email, s.phone, s.outcome, s.eventDate||null, s.title||null);

// ── Hiring Feedback ────────────────────────────────────────────────────────────
const hiringFeedback = [
  { ci:1, coi:2,  provider:'Company',         hired:'Yes', date:'2025-09-20', studentName:'Khalid Al-Mubarak' },
  { ci:8, coi:10, provider:'Student/Alumni',  hired:'Yes', date:'2025-08-15', studentName:'Sara Al-Shammari' },
  { ci:5, coi:7,  provider:'Company',         hired:'No',  date:'2025-09-25', studentName:null },
  { ci:0, coi:0,  provider:'Company',         hired:'Yes', date:'2025-07-01', studentName:'Noura Al-Rashdan' },
];

const insertHF = db.prepare(`INSERT INTO HiringFeedback (CompanyID,ContactID,FeedbackProvider,HiredStudentAlumni,DateReported,HiredStudentName) VALUES (?,?,?,?,?,?)`);
for (const h of hiringFeedback) insertHF.run(companyIds[h.ci], contactIds[h.coi], h.provider, h.hired, h.date, h.studentName||null);

// ── Potential Collaborations ───────────────────────────────────────────────────
const collabs = [
  { ci:3, opps:['Intern/Graduate Hiring','Guest Speakers/Panelists','Research Partnership','Competition/Hackathon Sponsorship'],   comment:'Strong QF relationship — prioritise.' },
  { ci:0, opps:['Intern/Graduate Hiring','Career Events','MoU Signing'],                                                           comment:'Explore expanded MoU for co-ops.' },
  { ci:5, opps:['Mock Interviews','Guest Speakers/Panelists','Case Studies'],                                                      comment:'McKinsey open to case competition sponsorship.' },
  { ci:8, opps:['Workshops/Training Sessions','Competition/Hackathon Sponsorship','Intern/Graduate Hiring'],                       comment:'Google STEP programme interest confirmed.' },
  { ci:4, opps:['Research Partnership','Intern/Graduate Hiring','Community Project Partnership'],                                  comment:'Sidra wants to co-publish research with faculty.' },
];

const insertCollab = db.prepare(`INSERT INTO PotentialCollaboration (CompanyID,Comment) VALUES (?,?)`);
const insertOpp    = db.prepare(`INSERT INTO PotentialCollaboration_Opportunities (PotentialCollaborationID,OpportunityType) VALUES (?,?)`);
for (const c of collabs) {
  const info = insertCollab.run(companyIds[c.ci], c.comment||null);
  for (const o of c.opps) insertOpp.run(info.lastInsertRowid, o);
}

// ── Summary ────────────────────────────────────────────────────────────────────
const counts = {
  companies:  db.prepare('SELECT COUNT(*) AS n FROM Company').get().n,
  contacts:   db.prepare('SELECT COUNT(*) AS n FROM Contact').get().n,
  outreach:   db.prepare('SELECT COUNT(*) AS n FROM OutreachEngagement').get().n,
  recruitment:db.prepare('SELECT COUNT(*) AS n FROM Recruitment').get().n,
  events:     db.prepare('SELECT COUNT(*) AS n FROM CareerEvent').get().n,
  academic:   db.prepare('SELECT COUNT(*) AS n FROM AcademicClassroomEngagement').get().n,
  students:   db.prepare('SELECT COUNT(*) AS n FROM StudentLedEvent').get().n,
  hiring:     db.prepare('SELECT COUNT(*) AS n FROM HiringFeedback').get().n,
  collabs:    db.prepare('SELECT COUNT(*) AS n FROM PotentialCollaboration').get().n,
};

console.log('\nSeed complete:');
Object.entries(counts).forEach(([k, v]) => console.log(`  ${k.padEnd(12)}: ${v}`));
db.close();
