'use strict';

const { z } = require('zod');
const v = require('./common');
const { CONTACT_STATUSES } = require('../domain/enums');

/** Body of POST /api/contacts and PUT /api/contacts/:id. */
const bodySchema = z.object({
  CompanyID: v.positiveId('Employer'),
  FirstName: v.requiredText('First name'),
  LastName: v.requiredText('Last name'),
  DateAdded: v.optionalIsoDate('Date added'),
  JobTitle: v.optionalText('Job title'),
  EmailAddress: v.email('Email address'),
  Address: v.optionalText('Address'),
  Country: v.optionalText('Country', { max: 100 }),
  WorkPhone: v.optionalText('Work phone', { max: 50 }),
  Mobile: v.optionalText('Mobile', { max: 50 }),
  LinkedInURL: v.optionalHttpUrl('LinkedIn URL', { max: 255 }),
  HandshakeURL: v.optionalHttpUrl('Handshake URL', { max: 255 }),
  CMUQGraduate: v.booleanFlag(),
  Major: v.optionalText('Major', { max: 100 }),
  GraduationYear: v.optionalPositiveId('Graduation year'),
  PrimaryContact: v.booleanFlag(),
  Status: v.optionalEnumOf('Status', CONTACT_STATUSES, 'Mailable'),
  ResumeBook: v.booleanFlag(),
  EventInvitation: v.booleanFlag(),
  ExcludeFromMailing: v.booleanFlag(),
});

/** Query of GET /api/contacts. */
const listQuerySchema = z.object({
  search: v.optionalText('Search', { max: 100 }),
  companyId: v.optionalPositiveId('Employer'),
  status: v.optionalEnumOf('Status', CONTACT_STATUSES),
});

module.exports = { bodySchema, listQuerySchema };
