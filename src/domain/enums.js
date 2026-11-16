'use strict';

/**
 * The fixed value lists of the schema. Each list matches a CHECK constraint
 * in src/db/migrations/0001_baseline.js exactly.
 */

const freeze = (values) => Object.freeze([...values]);

module.exports = Object.freeze({
  SECTORS: freeze(['Government', 'NGO', 'Private', 'Semi-government', 'Startup']),
  CONTACT_STATUSES: freeze(['Mailable', 'Non-mailable']),
  INTERACTION_TYPES: freeze(['Call', 'Meeting', 'Company Visit']),
  INTERACTION_STATUSES: freeze(['Complete', 'In-progress']),
  RECRUITMENT_MODES: freeze(['Onsite', 'Hybrid', 'Remote']),
  PAY_STATUSES: freeze(['Paid', 'Unpaid']),
  TARGET_GROUPS: freeze(['Qatari only', 'Open to all']),
  RECRUITMENT_HIRED_VALUES: freeze(['Yes', 'No', 'Not Reported']),
  REGISTERED_STATUSES: freeze(['Attended', 'No-Show', 'Cancelled']),
  ENGAGEMENT_TYPES: freeze([
    'Guest Lecture',
    'Panel Discussion',
    'Community Project Partnership',
    'Mock Interviews',
    'Research Collaboration',
    'Competition/Hackathon Sponsorship',
    'Other',
  ]),
  COLLABORATION_OUTCOMES: freeze(['Completed', 'Pending']),
  FEEDBACK_PROVIDERS: freeze(['Company', 'Student/Alumni', 'Other']),
  FEEDBACK_HIRED_VALUES: freeze(['Yes', 'No']),
  /** The roles of src/security/permissions.js, most privileged first. */
  USER_ROLES: freeze(['admin', 'staff', 'readonly', 'student_worker']),
  /** Majors offered by the import template for contacts (not a database constraint). */
  CONTACT_MAJORS: freeze([
    'Computer Science',
    'Information Systems',
    'Biological Sciences',
    'Business Administration',
    'Artificial Intelligence',
    'Computational Biology',
  ]),
  /** Collaboration opportunity types offered by the import template (not a database constraint). */
  COLLABORATION_OPPORTUNITIES: freeze([
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
  ]),
});
