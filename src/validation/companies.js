'use strict';

const { z } = require('zod');
const v = require('./common');
const { SECTORS } = require('../domain/enums');

/** Body of POST /api/companies and PUT /api/companies/:id. */
const bodySchema = z.object({
  CompanyName: v.requiredText('Company name'),
  DateAdded: v.optionalIsoDate('Date added'),
  Industry: v.requiredText('Industry'),
  Sector: v.enumOf('Sector', SECTORS),
  Country: v.requiredText('Country'),
  Address: v.optionalText('Address'),
  Website: v.optionalHttpUrl('Website', { max: 255 }),
  LinkedInURL: v.optionalHttpUrl('LinkedIn URL', { max: 255 }),
  HandshakeURL: v.optionalHttpUrl('Handshake URL', { max: 255 }),
  SignedMoU: v.booleanFlag(),
  FavoriteEmployer: v.booleanFlag(),
  Blacklisted: v.booleanFlag(),
  Comment: v.optionalText('Comment', { max: 2000 }),
});

/** Query of GET /api/companies. */
const listQuerySchema = z.object({
  search: v.optionalText('Search', { max: 100 }),
});

module.exports = { bodySchema, listQuerySchema };
