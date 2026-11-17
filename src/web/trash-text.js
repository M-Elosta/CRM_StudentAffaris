'use strict';

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * What is hidden together with an employer in the Trash, e.g.
 * "with 3 contacts and 12 activities". Empty when there is nothing.
 * @param {number} contacts
 * @param {number} activities
 * @param {string} [lead]  the word before the counts
 */
function hiddenText(contacts, activities, lead = 'with') {
  const parts = [];
  if (contacts) parts.push(plural(contacts, 'contact', 'contacts'));
  if (activities) parts.push(plural(activities, 'activity', 'activities'));
  return parts.length ? `${lead} ${parts.join(' and ')}` : '';
}

module.exports = { hiddenText };
