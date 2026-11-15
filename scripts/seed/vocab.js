'use strict';

/**
 * Value lists the application offers in its forms and groups by in its
 * filters and charts. They are copied exactly from the UI and routes:
 *   - public/js/recruitment.js     OPP_TYPES, COLLECT_CH, MAJORS, CLASS_LEVELS
 *   - public/pages/contacts.html   graduate majors
 *   - src/routes/import.js         COLLAB_OPPS
 *   - src/db/migrations            CHECK constraints
 */

const SECTORS = ['Government', 'NGO', 'Private', 'Semi-government', 'Startup'];

const OPPORTUNITY_TYPES = [
  'Internship',
  'Part-time Job',
  'Full-time Job',
  'Graduate Program',
  'Summer Research Program',
  'Training Program',
  'Mentorship Program',
  'Fellowship',
  'Competition/Hackathon',
  'Volunteering',
  'Others',
];

const APPLICATION_CHANNELS = ['Resume book', 'Handshake', 'Email', 'Other'];

/** All majors offered for recruitment targeting. */
const MAJORS = [
  'Computer Science',
  'Information Systems',
  'Biological Sciences',
  'Business Administration',
  'Artificial Intelligence',
  'Computational Biology',
];

/** The four degree programmes alumni contacts graduated from. */
const GRADUATE_MAJORS = ['Computer Science', 'Information Systems', 'Biological Sciences', 'Business Administration'];

const CLASS_LEVELS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Alumni'];

const COLLAB_OPPS = [
  'Intern/Graduate Hiring',
  'Career Events',
  'Mentorship Programs',
  'Mock Interviews',
  'Guest Speakers/Panelists',
  'Workshops/Training Sessions',
  'Company/Site Visits',
  'Community Project Partnership',
  'Student-Led Events',
  'Case Studies',
  'Research Partnership',
  'Competition/Hackathon Sponsorship',
  'Student Sponsorship',
  'MoU Signing',
  'Other',
];

const ENGAGEMENT_TYPES = [
  'Guest Lecture',
  'Panel Discussion',
  'Community Project Partnership',
  'Mock Interviews',
  'Research Collaboration',
  'Competition/Hackathon Sponsorship',
  'Other',
];

const INTERACTION_TYPES = ['Call', 'Meeting', 'Company Visit'];

const FEEDBACK_PROVIDERS = ['Company', 'Student/Alumni', 'Other'];

module.exports = {
  SECTORS,
  OPPORTUNITY_TYPES,
  APPLICATION_CHANNELS,
  MAJORS,
  GRADUATE_MAJORS,
  CLASS_LEVELS,
  COLLAB_OPPS,
  ENGAGEMENT_TYPES,
  INTERACTION_TYPES,
  FEEDBACK_PROVIDERS,
};
