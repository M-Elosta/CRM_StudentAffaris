'use strict';

const { z } = require('zod');
const v = require('./common');
const { ENGAGEMENT_TYPES } = require('../domain/enums');

/** Body of POST /api/academic and PUT /api/academic/:id. */
const bodySchema = z.object({
  CompanyID: v.positiveId('Employer'),
  ContactID: v.positiveId('Contact'),
  EngagementType: v.enumOf('Engagement type', ENGAGEMENT_TYPES),
  GuestSpeakerName: v.requiredText('Guest speaker name'),
  GuestTitle: v.requiredText('Guest title'),
  Email: v.optionalEmail('Email address'),
  PhoneNumber: v.optionalText('Phone number', { max: 50 }),
  FacultyName: v.requiredText('Faculty name'),
  CourseNumber: v.requiredText('Course number', { max: 50 }),
  CourseTitle: v.requiredText('Course title'),
  TopicTheme: v.requiredText('Topic or theme'),
  SessionDate: v.isoDate('Session date'),
  SessionTime: v.timeOfDay('Session time'),
  Comment: v.optionalText('Comment', { max: 2000 }),
});

/** Query of GET /api/academic. */
const listQuerySchema = z.object({
  engagementType: v.optionalText('Engagement type', { max: 100 }),
  ...v.dateRangeQuery(),
});

module.exports = { bodySchema, listQuerySchema };
