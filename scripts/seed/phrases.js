'use strict';

/**
 * Text fragments for the demo seed: discussion notes, action plans, posting
 * titles, events, courses and comments. Tokens in braces are filled in by
 * scripts/seed-demo.js: {major}, {term} (e.g. "Spring 2026") and {n}.
 */

const OUTREACH_DISCUSSIONS = {
  Call: [
    'Introductory call about hiring {major} students for {term} internships.',
    'Checked in on the status of the {term} internship cohort; {n} offers expected.',
    'Discussed participation in the upcoming career fair and booth requirements.',
    'Follow-up call on the resume book shared last month; shortlist of {n} candidates in progress.',
    'Clarified visa and sponsorship requirements for international students.',
    'Asked about graduate programme timelines for {major} seniors.',
    'Discussed a possible guest lecture for a {major} course next semester.',
    'مكالمة لمتابعة فرص التدريب الصيفي للطلاب القطريين في تخصص {major}.',
    'Call to confirm attendance at the employer networking evening. تم تأكيد الحضور مبدئياً.',
    "Reviewed feedback from last summer's interns; manager very satisfied.",
  ],
  Meeting: [
    'Meeting with the HR team to plan {term} recruitment; interested in {n} {major} students.',
    'Discussed a memorandum of understanding covering internships and guest speakers.',
    'Planning meeting for a sponsored hackathon on smart-city data.',
    'Reviewed hiring outcomes for last year and agreed on targets for {term}.',
    'Met with the new University Relations lead; walked through the employer engagement menu.',
    'Workshop planning: CV clinic and mock interviews for {major} juniors.',
    'اجتماع لمناقشة برنامج الإرشاد المهني للطالبات وخطة الفصل القادم.',
    'Discussed research collaboration with faculty in {major}. الاتفاق على اجتماع متابعة.',
    'Agreed on a timeline for posting {term} roles on Handshake.',
    'Met to discuss sponsorship of a student-led conference.',
  ],
  'Company Visit': [
    'Office tour with {n} students followed by a Q&A with recent graduates.',
    'Site visit to the operations centre; discussed {major} internship rotations.',
    'Visited the innovation lab and met the engineering leadership team.',
    'Toured the new headquarters; agreed to host a job-shadowing day in {term}.',
    'زيارة ميدانية لمقر الشركة مع مجموعة من الطلاب والتعرف على بيئة العمل.',
    'Visit to review the internship workspace and supervision arrangements.',
  ],
};

const ACTION_PLANS = [
  'Send the latest resume book extract for {major}.',
  'Share the career fair registration link and booth options.',
  'Draft MoU and send to legal for review.',
  'Introduce the contact to the relevant faculty member.',
  'Prepare a shortlist of {n} candidates.',
  'Book a room for the information session.',
  'Send thank-you note and summary of next steps.',
  'Confirm internship start dates and supervisor details.',
  'إرسال قائمة المرشحين المؤهلين قبل نهاية الشهر.',
  'متابعة توقيع مذكرة التفاهم مع الإدارة القانونية.',
  'Schedule follow-up meeting with the hiring manager.',
  'Collect feedback from students who attended.',
];

/** Typical durations per opportunity type; null means the field is left empty. */
const DURATIONS = {
  Internship: ['6 weeks', '8 weeks', '10 weeks', '3 months'],
  'Part-time Job': ['3 months', '6 months'],
  'Full-time Job': ['Permanent'],
  'Graduate Program': ['12 months', '18 months'],
  'Summer Research Program': ['8 weeks', '10 weeks'],
  'Training Program': ['6 weeks', '3 months'],
  'Mentorship Program': ['6 months'],
  Fellowship: ['6 months', '12 months'],
  'Competition/Hackathon': [null],
  Volunteering: ['6 weeks', '3 months'],
  Others: [null, '1 week'],
};

const OPPORTUNITY_TITLES = {
  Internship: [
    'Summer Software Engineering Intern',
    'Data Analytics Intern',
    'Finance Summer Intern',
    'Marketing & Communications Intern',
    'Research Laboratory Intern',
    'Business Operations Intern',
    'Cybersecurity Intern',
    'Supply Chain Intern',
    'Product Design Intern',
    'Policy Research Intern',
    'برنامج التدريب الصيفي للطلاب',
  ],
  'Part-time Job': ['Part-time Research Assistant', 'Part-time Social Media Assistant', 'Part-time Data Analyst'],
  'Full-time Job': [
    'Graduate Software Engineer',
    'Junior Business Analyst',
    'Associate Consultant',
    'Data Engineer',
    'Clinical Research Associate',
    'Financial Analyst',
    'IT Systems Analyst',
    'Project Coordinator',
  ],
  'Graduate Program': [
    'Graduate Leadership Programme',
    'Future Leaders Graduate Scheme',
    'Technology Graduate Rotation',
  ],
  'Summer Research Program': ['Summer Research Fellowship in Genomics', 'Summer Undergraduate Research Placement'],
  'Training Program': ['Cloud Skills Bootcamp', 'Professional Training Programme', 'برنامج التأهيل المهني'],
  'Mentorship Program': ['Women in Leadership Mentorship', 'Alumni Career Mentorship Circle'],
  Fellowship: ['Policy Innovation Fellowship', 'Social Impact Fellowship'],
  'Competition/Hackathon': ['Smart City Hackathon', 'Fintech Innovation Challenge'],
  Volunteering: ['Community Health Volunteer', 'STEM Outreach Volunteer'],
  Others: ['Job Shadowing Week', 'Site Visit & Career Day'],
};

const RECRUITMENT_COMMENTS = [
  'Applications reviewed on a rolling basis.',
  'Preference for students available for the full summer.',
  'Interviews held on campus.',
  'Arabic language skills are an advantage. إجادة اللغة العربية ميزة إضافية.',
  'Two rounds of interviews plus a case exercise.',
  'Housing allowance provided for students from outside Doha.',
];

/**
 * Career events. Past events recur on a fixed calendar day; `yearsBack` 0 is
 * the most recent occurrence on or before the anchor date. Upcoming events
 * are placed `daysAhead` days after the anchor. "{year}" is replaced by the
 * year of the event date.
 */
const CAREER_EVENTS = [
  { name: 'Fall Career Fair {year}', month: 10, day: 14, yearsBack: 0 },
  { name: 'Fall Career Fair {year}', month: 10, day: 14, yearsBack: 1 },
  { name: 'Spring Career Fair {year}', month: 2, day: 18, yearsBack: 0 },
  { name: 'Spring Career Fair {year}', month: 2, day: 18, yearsBack: 1 },
  { name: 'Business & Finance Employer Showcase {year}', month: 11, day: 5, yearsBack: 0 },
  { name: 'Healthcare & Life Sciences Careers Day {year}', month: 4, day: 9, yearsBack: 0 },
  { name: 'Tech Networking Night {year}', daysAhead: 17 },
  { name: 'Graduate Recruitment Showcase {year}', daysAhead: 38 },
];

const CAREER_EVENT_COMMENTS = {
  Attended: [
    'Brought two recruiters and a hiring manager.',
    'Booth near the main entrance; strong student traffic.',
    'Collected over 40 CVs.',
    'Requested a quieter interview room for next time.',
    'حضور مميز وتفاعل كبير من الطلاب.',
  ],
  'No-Show': ['Did not arrive; no notice given.', 'Recruiter unwell on the day.'],
  Cancelled: ['Cancelled two days before the event due to staff travel.', 'تم الإلغاء بسبب تعارض المواعيد.'],
  Registered: ['Registered for the upcoming event.', 'Registration confirmed; booth assigned.'],
};

const FACULTY_NAMES = [
  'Dr. Helena Marsh',
  'Prof. Idris Kaddour',
  'Dr. Samantha Achebe-Ross',
  'Dr. Rashid Benali',
  'Prof. Elaine Strand',
  'Dr. Kamal Haidar',
  'Dr. Mirela Popescu',
  'Prof. Daniel Achterberg',
  'Dr. Noor Elias',
  'Dr. Victor Lundgren',
  'Prof. Amina Sesay',
  'د. سلمى الراشد',
];

const COURSES = [
  ['DEMO-101', 'Introduction to Professional Development'],
  ['DEMO-112', 'Foundations of Programming'],
  ['DEMO-215', 'Data Structures in Practice'],
  ['DEMO-230', 'Information Systems Strategy'],
  ['DEMO-247', 'Cell Biology Laboratory'],
  ['DEMO-301', 'Business Analytics'],
  ['DEMO-318', 'Organisational Behaviour'],
  ['DEMO-326', 'Human-Computer Interaction'],
  ['DEMO-342', 'Corporate Finance'],
  ['DEMO-355', 'Genomics and Society'],
  ['DEMO-410', 'Capstone Project Studio'],
  ['DEMO-428', 'Machine Learning Applications'],
  ['DEMO-436', 'Entrepreneurship and Venture Design'],
  ['DEMO-450', 'Ethics in Technology'],
];

const ENGAGEMENT_TOPICS = {
  'Guest Lecture': [
    'Building data platforms at scale',
    'Careers in sustainable finance',
    'From lab bench to clinic: translational research',
    'Product management in a regional startup',
    'Leadership lessons from infrastructure projects',
  ],
  'Panel Discussion': [
    'Women in technology leadership',
    'The future of work in the Gulf',
    'Entrepreneurship after graduation',
    'حلقة نقاش: ريادة الأعمال في قطر',
  ],
  'Community Project Partnership': [
    'Digital literacy programme for local schools',
    'Recycling awareness campaign with student volunteers',
    'Accessible transport mapping project',
  ],
  'Mock Interviews': ['Technical interview practice', 'Case interview practice', 'Behavioural interview clinic'],
  'Research Collaboration': [
    'Air-quality sensor data analysis',
    'Genomic screening pilot study',
    'Arabic natural language processing dataset',
  ],
  'Competition/Hackathon Sponsorship': [
    'Smart mobility hackathon',
    'Fintech case competition',
    'Health-tech design sprint',
  ],
  Other: ['Industry project feedback session', 'Portfolio review day', 'Career story evening'],
};

const SESSION_TIMES = ['08:30', '10:00', '10:30', '11:30', '13:00', '14:30', '16:00'];

const ACADEMIC_COMMENTS = [
  'Students rated the session highly.',
  'Speaker offered to return next semester.',
  'Session recorded for the course page.',
  'تفاعل ممتاز من الطلاب مع المتحدث.',
  'Follow-up internship conversation requested by two students.',
];

const STUDENT_ORGANIZATIONS = [
  'Women in Technology Society',
  'Entrepreneurship Club',
  'Biology Students Association',
  'Data Science Club',
  'Finance & Investment Society',
  'Robotics Club',
  'Model United Nations Society',
  'Sustainability Club',
  'Qatari Culture Club | نادي الثقافة القطرية',
  'Debate Society',
  'Consulting Club',
  'Health Sciences Society',
];

const STUDENT_EVENT_TITLES = [
  'Startup Pitch Night',
  'Careers in Biotech Panel',
  'Finance Case Challenge',
  'Women Leaders Fireside Chat',
  'Sustainability Innovation Forum',
  'AI Ethics Roundtable',
  'Consulting Case Workshop',
  'Robotics Showcase',
  'ليلة ريادة الأعمال',
  'Health Careers Networking Evening',
];

const STUDENT_EVENT_COMMENTS = [
  'Employer provided speakers and refreshments.',
  'Awaiting confirmation of speaker availability.',
  'Around 80 students attended.',
  'بانتظار تأكيد الموعد من الشركة.',
  'Requested a co-branded poster.',
];

const HIRING_COMMENTS = {
  Yes: [
    'Hired after the summer internship.',
    'Offer accepted; start date confirmed.',
    'Converted from intern to full-time analyst.',
    'Student reported the offer through the career office.',
    'تم تعيين الطالب بعد فترة التدريب.',
  ],
  No: [
    'Position filled by an external candidate.',
    'Hiring freeze this cycle.',
    'Candidate declined the offer.',
    'Shortlisted students did not meet the language requirement.',
  ],
};

const COLLABORATION_COMMENTS = [
  'Interested in sponsoring the annual hackathon.',
  'Would like to host a company visit for second-year students.',
  'Exploring a formal MoU covering internships and research.',
  'Open to providing mentors for the women in tech programme.',
  'مهتمون برعاية فعاليات الطلاب والمشاركة في معرض التوظيف.',
  'Can provide guest speakers for business courses.',
  'Proposed a case study on regional logistics for a capstone course.',
  'Discussed scholarships for Qatari students. تمت مناقشة المنح الدراسية.',
];

module.exports = {
  OUTREACH_DISCUSSIONS,
  ACTION_PLANS,
  DURATIONS,
  OPPORTUNITY_TITLES,
  RECRUITMENT_COMMENTS,
  CAREER_EVENTS,
  CAREER_EVENT_COMMENTS,
  FACULTY_NAMES,
  COURSES,
  ENGAGEMENT_TOPICS,
  SESSION_TIMES,
  ACADEMIC_COMMENTS,
  STUDENT_ORGANIZATIONS,
  STUDENT_EVENT_TITLES,
  STUDENT_EVENT_COMMENTS,
  HIRING_COMMENTS,
  COLLABORATION_COMMENTS,
};
