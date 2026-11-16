'use strict';

const { createRecordService } = require('./record-service');

/**
 * Contacts: the generic record service plus the rule that a contact of a
 * blacklisted employer is always Non-mailable, on create and on every edit.
 * @param {object} deps  as for createRecordService
 */
function createContactsService(deps) {
  return createRecordService({
    ...deps,
    hooks: {
      beforeWrite(values, { company }) {
        if (company?.Blacklisted) values.Status = 'Non-mailable';
      },
      describeRemoval(contact) {
        return { message: 'Contact deleted', name: `${contact.FirstName} ${contact.LastName}` };
      },
    },
  });
}

module.exports = { createContactsService };
