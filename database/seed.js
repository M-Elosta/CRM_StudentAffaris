const { createDatabase, loadSchema } = require('../lib/db');

function randomDaysAgo(maxDays) {
  const days = Math.floor(Math.random() * maxDays);
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function main() {
  const db = createDatabase();
  await loadSchema(db);

  console.log('Seeding database…');

  await db.exec(`
    TRUNCATE TABLE
      academicclassroomengagement,
      studentledevent,
      hiringfeedback,
      careerevent,
      potentialcollaboration_opportunities,
      potentialcollaboration,
      recruitment_classlevel,
      recruitment_targetmajors,
      recruitment_collectapplications,
      recruitment_opportunitytype,
      recruitment,
      outreachengagement,
      contact,
      company
    RESTART IDENTITY CASCADE
  `);

  const companies = [
    { CompanyName:'Qatar Airways',       Industry:'Aviation',            Sector:'Semi-government', Country:'Qatar', Website:'https://qatarairways.com', SignedMoU:1, FavoriteEmployer:1, Blacklisted:0 },
    { CompanyName:'Qatar National Bank', Industry:'Banking & Finance',   Sector:'Semi-government', Country:'Qatar', Website:'https://qnb.com', SignedMoU:1, FavoriteEmployer:1, Blacklisted:0 },
    { CompanyName:'Ooredoo Qatar',       Industry:'Telecommunications',  Sector:'Semi-government', Country:'Qatar', Website:'https://ooredoo.qa', SignedMoU:0, FavoriteEmployer:0, Blacklisted:0 },
    { CompanyName:'Qatar Foundation',    Industry:'Education & Research',Sector:'Government',      Country:'Qatar', Website:'https://qf.org.qa', SignedMoU:1, FavoriteEmployer:1, Blacklisted:0 },
    { CompanyName:'Sidra Medicine',      Industry:'Healthcare',          Sector:'Government',      Country:'Qatar', Website:'https://sidra.org', SignedMoU:0, FavoriteEmployer:1, Blacklisted:0 },
    { CompanyName:'McKinsey & Company',  Industry:'Consulting',          Sector:'Private',         Country:'Qatar', Website:'https://mckinsey.com', SignedMoU:0, FavoriteEmployer:1, Blacklisted:0 },
    { CompanyName:'PwC Qatar',           Industry:'Consulting',          Sector:'Private',         Country:'Qatar', Website:'https://pwc.com/qa', SignedMoU:0, FavoriteEmployer:0, Blacklisted:0 },
    { CompanyName:'Microsoft Qatar',     Industry:'Technology',          Sector:'Private',         Country:'Qatar', Website:'https://microsoft.com', SignedMoU:0, FavoriteEmployer:0, Blacklisted:0 },
    { CompanyName:'Google MENA',         Industry:'Technology',          Sector:'Private',         Country:'UAE',   Website:'https://google.com', SignedMoU:0, FavoriteEmployer:1, Blacklisted:0 },
    { CompanyName:'Amazon Web Services', Industry:'Technology',          Sector:'Private',         Country:'UAE',   Website:'https://aws.amazon.com', SignedMoU:0, FavoriteEmployer:0, Blacklisted:0 },
    { CompanyName:'KPMG Qatar',          Industry:'Audit & Tax',         Sector:'Private',         Country:'Qatar', Website:'https://kpmg.com/qa', SignedMoU:0, FavoriteEmployer:0, Blacklisted:0 },
    { CompanyName:'Hamad Medical Corp',  Industry:'Healthcare',          Sector:'Government',      Country:'Qatar', Website:'https://hamad.qa', SignedMoU:1, FavoriteEmployer:0, Blacklisted:0 },
    { CompanyName:'Careem',              Industry:'Technology',          Sector:'Startup',         Country:'UAE',   Website:'https://careem.com', SignedMoU:0, FavoriteEmployer:0, Blacklisted:0 },
    { CompanyName:'AlphaTech Solutions', Industry:'Technology',          Sector:'Startup',         Country:'Qatar', Website:null, Blacklisted:1, FavoriteEmployer:0, SignedMoU:0, Comment:'Fraudulent internship offer 2024' },
    { CompanyName:'Gulf Bridge Intl',    Industry:'Telecommunications',  Sector:'Private',         Country:'Qatar', Website:null, Blacklisted:1, FavoriteEmployer:0, SignedMoU:0, Comment:'No response after 3 follow-ups' },
  ];

  const contacts = [
    { ci:0, FirstName:'Ahmed',     LastName:'Al-Sayed',    Email:'ahmed.alsayed@qatarairways.com', JobTitle:'Talent Acquisition Manager',   Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:1, CMUQGraduate:0 },
    { ci:0, FirstName:'Fatima',    LastName:'Al-Rashid',   Email:'f.rashid@qatarairways.com',       JobTitle:'HR Business Partner',          Status:'Mailable',     PrimaryContact:0, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
    { ci:1, FirstName:'Mohammed',  LastName:'Al-Kuwari',   Email:'m.kuwari@qnb.com.qa',             JobTitle:'Head of Campus Relations',     Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:1, CMUQGraduate:1, Major:'Business Administration', GraduationYear:2018 },
    { ci:1, FirstName:'Sara',      LastName:'Hassan',      Email:'sara.hassan@qnb.com.qa',          JobTitle:'Graduate Programme Manager',   Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:1, CMUQGraduate:0 },
    { ci:2, FirstName:'Khalid',    LastName:'Al-Emadi',    Email:'k.emadi@ooredoo.qa',              JobTitle:'Internship Coordinator',       Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
    { ci:3, FirstName:'Nour',      LastName:'Al-Khulaifi', Email:'nour.khulaifi@qf.org.qa',         JobTitle:'Research Partnerships Lead',   Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:1, CMUQGraduate:1, Major:'Computer Science', GraduationYear:2020 },
    { ci:4, FirstName:'Dr. Layla', LastName:'Mahmoud',     Email:'l.mahmoud@sidra.org',             JobTitle:'Research Director',            Status:'Mailable',     PrimaryContact:1, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
    { ci:5, FirstName:'James',     LastName:'Carter',      Email:'j.carter@mckinsey.com',           JobTitle:'Partner',                      Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
    { ci:6, FirstName:'Aisha',     LastName:'Al-Mannai',   Email:'a.mannai@pwc.com',                JobTitle:'Assurance Director',           Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:1, CMUQGraduate:1, Major:'Business Administration', GraduationYear:2017 },
    { ci:7, FirstName:'David',     LastName:'Kim',         Email:'d.kim@microsoft.com',             JobTitle:'University Relations Manager', Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
    { ci:8, FirstName:'Priya',     LastName:'Sharma',      Email:'p.sharma@google.com',             JobTitle:'Campus Lead MENA',             Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:1, CMUQGraduate:0 },
    { ci:9, FirstName:'Omar',      LastName:'Al-Farsi',    Email:'o.farsi@aws.amazon.com',          JobTitle:'Solutions Architect',          Status:'Mailable',     PrimaryContact:1, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
    { ci:10,FirstName:'Reem',      LastName:'Al-Thani',    Email:'r.thani@kpmg.com',                JobTitle:'Audit Manager',                Status:'Non-mailable', PrimaryContact:1, EventInvitation:0, ResumeBook:0, CMUQGraduate:0, ExcludeFromMailing:1 },
    { ci:11,FirstName:'Hassan',    LastName:'Jaber',       Email:'h.jaber@hamad.qa',                JobTitle:'HR Director',                  Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
    { ci:12,FirstName:'Mariam',    LastName:'Al-Dosari',   Email:'m.dosari@careem.com',             JobTitle:'Engineering Recruiter',        Status:'Mailable',     PrimaryContact:1, EventInvitation:1, ResumeBook:1, CMUQGraduate:1, Major:'Computer Science', GraduationYear:2021 },
    { ci:0, FirstName:'Yousef',    LastName:'Alnuaimi',    Email:'y.alnuaimi@qatarairways.com',     JobTitle:'Training Coordinator',         Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:1, CMUQGraduate:0 },
    { ci:3, FirstName:'Tamara',    LastName:'Obeid',       Email:'t.obeid@qf.org.qa',               JobTitle:'Innovation Manager',           Status:'Mailable',     PrimaryContact:0, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
    { ci:5, FirstName:'Alex',      LastName:'Moreau',      Email:'a.moreau@mckinsey.com',           JobTitle:'Senior Consultant',            Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
    { ci:1, FirstName:'Hessa',     LastName:'Al-Mulla',    Email:'h.mulla@qnb.com.qa',              JobTitle:'Compliance Officer',           Status:'Non-mailable', PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
    { ci:4, FirstName:'Tarek',     LastName:'Mansour',     Email:'t.mansour@sidra.org',             JobTitle:'Clinical Research Coord.',     Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:1, Major:'Biological Sciences', GraduationYear:2019 },
    { ci:7, FirstName:'Linda',     LastName:'Chen',        Email:'l.chen@microsoft.com',            JobTitle:'Sr. Software Engineer',        Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
    { ci:6, FirstName:'Rawda',     LastName:'Al-Suwaidi',  Email:'r.suwaidi@pwc.com',               JobTitle:'Tax Consultant',               Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:1, CMUQGraduate:1, Major:'Business Administration', GraduationYear:2022 },
    { ci:11,FirstName:'Nadia',     LastName:'Saleh',       Email:'n.saleh@hamad.qa',                JobTitle:'Nursing Manager',              Status:'Mailable',     PrimaryContact:0, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
    { ci:8, FirstName:'Rania',     LastName:'Qasim',       Email:'r.qasim@google.com',              JobTitle:'Developer Advocate',           Status:'Mailable',     PrimaryContact:0, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
    { ci:2, FirstName:'Faisal',    LastName:'Al-Qahtani',  Email:'f.qahtani@ooredoo.qa',            JobTitle:'Network Engineer',             Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
    { ci:12,FirstName:'Ziad',      LastName:'Habib',       Email:'z.habib@careem.com',              JobTitle:'Product Manager',              Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:1, CMUQGraduate:1, Major:'Information Systems', GraduationYear:2023 },
    { ci:9, FirstName:'Grace',     LastName:'Okonkwo',     Email:'g.okonkwo@aws.amazon.com',        JobTitle:'Cloud Architect',              Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:0 },
    { ci:10,FirstName:'Khalil',    LastName:'Badawi',      Email:'k.badawi@kpmg.com',               JobTitle:'IT Audit Manager',             Status:'Mailable',     PrimaryContact:0, EventInvitation:1, ResumeBook:0, CMUQGraduate:0 },
    { ci:3, FirstName:'Dina',      LastName:'Al-Jaber',    Email:'d.jaber@qf.org.qa',               JobTitle:'Education Programme Mgr.',     Status:'Mailable',     PrimaryContact:0, EventInvitation:1, ResumeBook:1, CMUQGraduate:0 },
    { ci:5, FirstName:'Patrick',   LastName:'O\'Brien',    Email:'p.obrien@mckinsey.com',           JobTitle:'Associate',                    Status:'Mailable',     PrimaryContact:0, EventInvitation:0, ResumeBook:0, CMUQGraduate:1, Major:'Business Administration', GraduationYear:2023 },
  ];

  const outreachData = [
    { ci:0, coi:0, type:'Meeting', date:'2025-09-10', discussion:'Discussed summer internship programme for 2026. Qatar Airways wants to recruit 3 CS and 2 BA students.', action:'Send internship programme details and student profiles.', followUp:'2025-10-01', status:'In-progress' },
    { ci:1, coi:2, type:'Call', date:'2025-09-15', discussion:'QNB interested in expanding graduate programme to include CMU-Q students.', action:'Arrange campus visit for October.', followUp:'2025-09-30', status:'In-progress' },
    { ci:3, coi:5, type:'Meeting', date:'2025-10-02', discussion:'Qatar Foundation keen on research collaboration for AI and biotech projects.', action:'Share list of faculty research projects.', followUp:'2025-10-20', status:'In-progress' },
    { ci:5, coi:7, type:'Company Visit', date:'2025-08-20', discussion:'Visited McKinsey Doha office. Discussed case competition sponsorship.', action:'Follow up on sponsorship proposal.', followUp:'2024-09-01', status:'Complete' },
    { ci:4, coi:6, type:'Call', date:'2025-10-05', discussion:'Sidra interested in hiring biology students for summer research positions.', action:'Send research programme flyer.', followUp:'2025-10-25', status:'In-progress' },
    { ci:8, coi:10, type:'Meeting', date:'2025-09-25', discussion:'Google MENA interested in hosting a technical workshop on campus.', action:'Coordinate with Student Affairs on venue.', followUp:'2025-10-15', status:'In-progress' },
    { ci:6, coi:8, type:'Call', date:'2025-10-08', discussion:'PwC wants to participate in Fall Career Fair. Requested student resume book.', action:'Send resume book extract and booth details.', followUp:'2025-10-18', status:'Complete' },
    { ci:7, coi:9, type:'Meeting', date:'2025-08-05', discussion:'Microsoft discussed Azure certification programme for students.', action:'Connect with IT department.', followUp:'2024-08-30', status:'Complete' },
    { ci:11,coi:13, type:'Call', date:'2025-10-10', discussion:'HMC interested in medical internship programme for biomedical students.', action:'Prepare internship agreement draft.', followUp:'2025-11-01', status:'In-progress' },
    { ci:2, coi:4, type:'Company Visit', date:'2025-09-18', discussion:'Tour of Ooredoo HQ. Discussed co-op programme and IS student recruitment.', action:'None needed — send thank you note.', followUp:null, status:'Complete' },
  ];

  const recruitments = [
    { ci:0, coi:0, title:'Summer Internship 2026',      mode:'Onsite', status:'Paid',   target:'Open to all', types:['Internship'], majors:['Computer Science','Business Administration'], levels:['Junior','Senior'], date:'2025-09-01', hired:'Not Reported', payAmount:'QAR 5,000/month' },
    { ci:1, coi:2, title:'QNB Graduate Programme 2026', mode:'Onsite', status:'Paid',   target:'Qatari only', types:['Graduate Program'], majors:['Business Administration'], levels:['Senior','Alumni'], date:'2025-08-15', hired:'Yes', payAmount:'QAR 12,000/month' },
    { ci:4, coi:6, title:'Research Summer 2026',        mode:'Onsite', status:'Paid',   target:'Open to all', types:['Summer Research Program'], majors:['Biological Sciences','Computer Science'], levels:['Sophomore','Junior'], date:'2025-10-01', hired:'Not Reported', payAmount:'QAR 4,000/month' },
    { ci:5, coi:7, title:'Business Analyst Internship', mode:'Hybrid', status:'Paid',   target:'Open to all', types:['Internship','Fellowship'], majors:['Business Administration','Information Systems'], levels:['Junior','Senior'], date:'2025-09-20', hired:'No', payAmount:'QAR 6,000/month' },
    { ci:8, coi:10,title:'STEP Internship MENA',        mode:'Remote', status:'Paid',   target:'Open to all', types:['Internship'], majors:['Computer Science'], levels:['Sophomore','Junior','Senior'], date:'2025-07-01', hired:'Yes', payAmount:'USD 3,500/month' },
    { ci:2, coi:4, title:'Co-op Network Engineering',   mode:'Onsite', status:'Paid',   target:'Open to all', types:['Internship','Training Program'], majors:['Computer Science','Information Systems'], levels:['Junior'], date:'2025-10-05', hired:'Not Reported', payAmount:'QAR 4,500/month' },
    { ci:12,coi:14,title:'Product Management Intern',   mode:'Hybrid', status:'Unpaid', target:'Open to all', types:['Internship'], majors:['Information Systems','Business Administration'], levels:['Junior','Senior'], date:'2025-09-10', hired:'Not Reported', payAmount:null },
    { ci:11,coi:13,title:'Medical Research Volunteer',  mode:'Onsite', status:'Unpaid', target:'Open to all', types:['Volunteering'], majors:['Biological Sciences'], levels:['Freshman','Sophomore'], date:'2025-10-08', hired:'Not Reported', payAmount:null },
  ];

  const events = [
    { ci:0, coi:0,  name:'Fall Career Fair 2025',          date:'2025-10-15', status:'Attended',  alumni:1 },
    { ci:1, coi:2,  name:'Fall Career Fair 2025',          date:'2025-10-15', status:'Attended',  alumni:0 },
    { ci:6, coi:8,  name:'Fall Career Fair 2025',          date:'2025-10-15', status:'Attended',  alumni:1 },
    { ci:8, coi:10, name:'Fall Career Fair 2025',          date:'2025-10-15', status:'No-Show',   alumni:0 },
    { ci:5, coi:7,  name:'Consulting Info Session',        date:'2025-09-22', status:'Attended',  alumni:0 },
    { ci:4, coi:6,  name:'Healthcare Careers Panel',       date:'2025-09-18', status:'Attended',  alumni:0 },
    { ci:11,coi:13, name:'Healthcare Careers Panel',       date:'2025-09-18', status:'Cancelled', alumni:0 },
    { ci:7, coi:9,  name:'Tech Industry Night',            date:'2025-08-28', status:'Attended',  alumni:1 },
    { ci:2, coi:4,  name:'Tech Industry Night',            date:'2025-08-28', status:'No-Show',   alumni:0 },
    { ci:3, coi:5,  name:'Research & Innovation Showcase', date:'2025-10-08', status:'Attended',  alumni:0 },
  ];

  const academic = [
    { ci:5, coi:7,  type:'Guest Lecture', speaker:'James Carter', title:'Partner', faculty:'Prof. R. Krishnan', course:'73-100', courseTitle:'Principles of Management', topic:'Strategy Consulting in Emerging Markets', date:'2025-09-30', time:'10:00' },
    { ci:8, coi:10, type:'Panel Discussion', speaker:'Priya Sharma', title:'Campus Lead MENA', faculty:'Prof. A. Jacobs', course:'15-110', courseTitle:'Principles of Computing', topic:'Women in Tech & Building a Career at Google', date:'2025-10-07', time:'14:00' },
    { ci:4, coi:6,  type:'Research Collaboration', speaker:'Dr. Layla Mahmoud', title:'Research Director', faculty:'Prof. M. El-Deeb', course:'03-121', courseTitle:'Modern Biology', topic:'Precision Medicine & AI in Clinical Research', date:'2025-10-14', time:'11:00' },
  ];

  const studentEvents = [
    { ci:5, coi:7,  proposal:'2025-09-05', org:'CMU-Q Consulting Club', student:'Ali Hassan', email:'ali@cmu.edu.qa', phone:'+97466001001', outcome:'Completed', eventDate:'2025-10-02', title:'Case Competition Workshop' },
    { ci:0, coi:0,  proposal:'2025-09-12', org:'CMU-Q Business Society', student:'Moza Al-Ali', email:'moza@cmu.edu.qa', phone:'+97466001002', outcome:'Pending', eventDate:null, title:null },
    { ci:8, coi:10, proposal:'2025-10-01', org:'CMU-Q Tech Club', student:'Rami Safi', email:'rami@cmu.edu.qa', phone:'+97466001003', outcome:'Pending', eventDate:null, title:'Google Hackathon Prep Session' },
  ];

  const hiringFeedback = [
    { ci:1, coi:2,  provider:'Company',        hired:'Yes', date:'2025-09-20', studentName:'Khalid Al-Mubarak' },
    { ci:8, coi:10, provider:'Student/Alumni', hired:'Yes', date:'2025-08-15', studentName:'Sara Al-Shammari' },
    { ci:5, coi:7,  provider:'Company',        hired:'No',  date:'2025-09-25', studentName:null },
    { ci:0, coi:0,  provider:'Company',        hired:'Yes', date:'2025-07-01', studentName:'Noura Al-Rashdan' },
  ];

  const collabs = [
    { ci:3, opps:['Intern/Graduate Hiring','Guest Speakers/Panelists','Research Partnership','Competition/Hackathon Sponsorship'], comment:'Strong QF relationship — prioritise.' },
    { ci:0, opps:['Intern/Graduate Hiring','Career Events','MoU Signing'], comment:'Explore expanded MoU for co-ops.' },
    { ci:5, opps:['Mock Interviews','Guest Speakers/Panelists','Case Studies'], comment:'McKinsey open to case competition sponsorship.' },
    { ci:8, opps:['Workshops/Training Sessions','Competition/Hackathon Sponsorship','Intern/Graduate Hiring'], comment:'Google STEP programme interest confirmed.' },
    { ci:4, opps:['Research Partnership','Intern/Graduate Hiring','Community Project Partnership'], comment:'Sidra wants to co-publish research with faculty.' },
  ];

  const insertCompany = db.prepare(`
    INSERT INTO Company (CompanyName, DateAdded, Industry, Sector, Country, Website, SignedMoU, FavoriteEmployer, Blacklisted, Comment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const companyIds = [];
  for (const company of companies) {
    const info = await insertCompany.run(
      company.CompanyName,
      randomDaysAgo(365),
      company.Industry,
      company.Sector,
      company.Country,
      company.Website || null,
      company.SignedMoU,
      company.FavoriteEmployer,
      company.Blacklisted,
      company.Comment || null,
    );
    companyIds.push(info.lastInsertRowid);
  }

  const insertContact = db.prepare(`
    INSERT INTO Contact (CompanyID, FirstName, LastName, DateAdded, JobTitle, EmailAddress, Status, PrimaryContact, EventInvitation, ResumeBook, ExcludeFromMailing, CMUQGraduate, Major, GraduationYear)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const contactIds = [];
  for (const contact of contacts) {
    const info = await insertContact.run(
      companyIds[contact.ci],
      contact.FirstName,
      contact.LastName,
      randomDaysAgo(300),
      contact.JobTitle || null,
      contact.Email,
      contact.Status,
      contact.PrimaryContact ? 1 : 0,
      contact.EventInvitation ? 1 : 0,
      contact.ResumeBook ? 1 : 0,
      contact.ExcludeFromMailing ? 1 : 0,
      contact.CMUQGraduate ? 1 : 0,
      contact.Major || null,
      contact.GraduationYear || null,
    );
    contactIds.push(info.lastInsertRowid);
  }

  const insertOutreach = db.prepare(`
    INSERT INTO OutreachEngagement (CompanyID, ContactID, InteractionType, InteractionDate, DiscussionItems, ActionPlan, FollowUpDate, InteractionStatus)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const outreach of outreachData) {
    await insertOutreach.run(companyIds[outreach.ci], contactIds[outreach.coi], outreach.type, outreach.date, outreach.discussion, outreach.action || null, outreach.followUp || null, outreach.status);
  }

  const insertRecruit = db.prepare(`
    INSERT INTO Recruitment (CompanyID, ContactID, DatePosted, OpportunityTitle, Mode, Status, TargetGroup, ArabicSpeaker, HiredStudentAlumni, PayAmount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOppType = db.prepare('INSERT INTO Recruitment_OpportunityType (RecruitmentID, Type) VALUES (?, ?)');
  const insertCollect = db.prepare('INSERT INTO Recruitment_CollectApplications (RecruitmentID, Channel) VALUES (?, ?)');
  const insertMajor = db.prepare('INSERT INTO Recruitment_TargetMajors (RecruitmentID, Major) VALUES (?, ?)');
  const insertLevel = db.prepare('INSERT INTO Recruitment_ClassLevel (RecruitmentID, ClassLevel) VALUES (?, ?)');
  for (const recruitment of recruitments) {
    const info = await insertRecruit.run(companyIds[recruitment.ci], contactIds[recruitment.coi], recruitment.date, recruitment.title, recruitment.mode, recruitment.status, recruitment.target, 0, recruitment.hired, recruitment.payAmount || null);
    const id = info.lastInsertRowid;
    for (const type of recruitment.types) await insertOppType.run(id, type);
    await insertCollect.run(id, 'Handshake');
    for (const major of recruitment.majors) await insertMajor.run(id, major);
    for (const level of recruitment.levels) await insertLevel.run(id, level);
  }

  const insertEvent = db.prepare('INSERT INTO CareerEvent (CompanyID, ContactID, EventName, EventDate, RegisteredStatus, CMUQAlumniAtBooth) VALUES (?, ?, ?, ?, ?, ?)');
  for (const event of events) {
    await insertEvent.run(companyIds[event.ci], contactIds[event.coi], event.name, event.date, event.status, event.alumni);
  }

  const insertAcademic = db.prepare('INSERT INTO AcademicClassroomEngagement (CompanyID, ContactID, EngagementType, GuestSpeakerName, GuestTitle, FacultyName, CourseNumber, CourseTitle, TopicTheme, SessionDate, SessionTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const engagement of academic) {
    await insertAcademic.run(companyIds[engagement.ci], contactIds[engagement.coi], engagement.type, engagement.speaker, engagement.title, engagement.faculty, engagement.course, engagement.courseTitle, engagement.topic, engagement.date, engagement.time);
  }

  const insertStudentEvent = db.prepare('INSERT INTO StudentLedEvent (CompanyID, ContactID, ProposalDate, OrganizationName, StudentName, StudentEmail, StudentPhoneNumber, CollaborationOutcome, EventDate, EventTitle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const event of studentEvents) {
    await insertStudentEvent.run(companyIds[event.ci], contactIds[event.coi], event.proposal, event.org, event.student, event.email, event.phone, event.outcome, event.eventDate || null, event.title || null);
  }

  const insertHiring = db.prepare('INSERT INTO HiringFeedback (CompanyID, ContactID, FeedbackProvider, HiredStudentAlumni, DateReported, HiredStudentName) VALUES (?, ?, ?, ?, ?, ?)');
  for (const feedback of hiringFeedback) {
    await insertHiring.run(companyIds[feedback.ci], contactIds[feedback.coi], feedback.provider, feedback.hired, feedback.date, feedback.studentName || null);
  }

  const insertCollab = db.prepare('INSERT INTO PotentialCollaboration (CompanyID, Comment) VALUES (?, ?)');
  const insertCollabOpp = db.prepare('INSERT INTO PotentialCollaboration_Opportunities (PotentialCollaborationID, OpportunityType) VALUES (?, ?)');
  for (const collab of collabs) {
    const info = await insertCollab.run(companyIds[collab.ci], collab.comment || null);
    for (const opp of collab.opps) {
      await insertCollabOpp.run(info.lastInsertRowid, opp);
    }
  }

  const counts = {
    companies:   (await db.prepare('SELECT COUNT(*) AS n FROM Company').get()).n,
    contacts:    (await db.prepare('SELECT COUNT(*) AS n FROM Contact').get()).n,
    outreach:    (await db.prepare('SELECT COUNT(*) AS n FROM OutreachEngagement').get()).n,
    recruitment: (await db.prepare('SELECT COUNT(*) AS n FROM Recruitment').get()).n,
    events:      (await db.prepare('SELECT COUNT(*) AS n FROM CareerEvent').get()).n,
    academic:    (await db.prepare('SELECT COUNT(*) AS n FROM AcademicClassroomEngagement').get()).n,
    students:    (await db.prepare('SELECT COUNT(*) AS n FROM StudentLedEvent').get()).n,
    hiring:      (await db.prepare('SELECT COUNT(*) AS n FROM HiringFeedback').get()).n,
    collabs:     (await db.prepare('SELECT COUNT(*) AS n FROM PotentialCollaboration').get()).n,
  };

  console.log('\nSeed complete:');
  Object.entries(counts).forEach(([key, value]) => console.log(`  ${key.padEnd(12)}: ${value}`));
  await db.close();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
