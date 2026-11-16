'use strict';

const { can, canAccessRecord, PERMISSIONS: P } = require('../security/permissions');
const { roleLabelOf } = require('../security/authorize');
const { csrfTokenFor } = require('./csrf');
const { takeFlash } = require('./flash');

const readable = (type) => (user) => canAccessRecord(user, P.RECORD_READ, type);

/**
 * The sidebar, in display order. `allowed(user)` decides whether the item is
 * shown at all, so a role only sees what it may open.
 */
const NAV = [
  {
    heading: '',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', allowed: () => true },
      {
        href: '/follow-ups',
        label: 'Follow-ups',
        icon: 'tasks',
        allowed: readable('outreach'),
        count: 'overdueFollowUps',
        countLabel: 'overdue',
      },
    ],
  },
  {
    heading: 'Relationships',
    items: [
      { href: '/employers', label: 'Employers', icon: 'building', allowed: readable('companies') },
      { href: '/contacts', label: 'Contacts', icon: 'users', allowed: readable('contacts') },
      { href: '/interactions', label: 'Interactions', icon: 'interactions', allowed: readable('outreach') },
    ],
  },
  {
    heading: 'Opportunities',
    items: [
      { href: '/postings', label: 'Postings', icon: 'briefcase', allowed: readable('recruitment') },
      {
        href: '/events',
        label: 'Events',
        icon: 'calendar',
        allowed: (user) => ['career-events', 'student-events', 'academic'].some((type) => readable(type)(user)),
      },
      { href: '/hiring-outcomes', label: 'Hiring outcomes', icon: 'outcomes', allowed: readable('hiring-feedback') },
      {
        href: '/collaboration-ideas',
        label: 'Collaboration ideas',
        icon: 'opportunities',
        allowed: readable('collaboration'),
      },
    ],
  },
  {
    heading: 'Insights',
    items: [{ href: '/reports', label: 'Reports', icon: 'reports', allowed: (user) => can(user, P.REPORTS_VIEW) }],
  },
  {
    heading: 'Admin',
    items: [{ href: '/admin/users', label: 'Users', icon: 'shield', allowed: (user) => can(user, P.USERS_MANAGE) }],
  },
];

/** Whether the navigation item at href is visible to the user (used to guard pages too). */
function navAllows(user, href) {
  for (const group of NAV) {
    const item = group.items.find((candidate) => candidate.href === href);
    if (item) return item.allowed(user);
  }
  return false;
}

/**
 * The navigation groups for a user, with the current item marked.
 * @param {object} user
 * @param {string} currentPath
 * @param {Record<string, number>} counts
 */
function buildNav(user, currentPath, counts = {}) {
  return NAV.map((group) => ({
    heading: group.heading,
    items: group.items
      .filter((item) => item.allowed(user))
      .map((item) => ({
        href: item.href,
        label: item.label,
        icon: item.icon,
        count: item.count ? counts[item.count] || 0 : 0,
        countLabel: item.countLabel,
        current: currentPath === item.href || currentPath.startsWith(`${item.href}/`),
      })),
  })).filter((group) => group.items.length);
}

/**
 * Per-request locals of every rendered page: the signed-in user, the
 * navigation, the CSRF token, one-time messages, the asset version and the
 * session timing used by the expiry warning.
 * @param {object} deps
 * @param {object} deps.config
 * @param {string} deps.assetVersion
 * @param {{ overdueCount: (ctx: object) => number }} deps.followUps
 */
function createLocals({ config, assetVersion, followUps }) {
  const idleSeconds = config.sessionIdleMinutes * 60;
  const warnSeconds = Math.min(120, Math.floor(idleSeconds / 4));

  return function webLocals(req, res, next) {
    const locals = res.locals;
    locals.assetVersion = assetVersion;
    locals.csrfToken = csrfTokenFor(req);
    locals.session = { idleSeconds, warnSeconds };
    locals.currentPath = req.path;
    // Read lazily so a redirect never consumes a message meant for the next page.
    Object.defineProperty(locals, 'flash', {
      configurable: true,
      enumerable: true,
      get() {
        const value = takeFlash(req);
        Object.defineProperty(locals, 'flash', { value, configurable: true, enumerable: true, writable: true });
        return value;
      },
    });

    const user = req.user;
    if (user) {
      locals.currentUser = {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        roleLabel: roleLabelOf(user),
      };
      Object.defineProperty(locals, 'nav', {
        configurable: true,
        enumerable: true,
        get() {
          const counts = canAccessRecord(user, P.RECORD_READ, 'outreach')
            ? { overdueFollowUps: followUps.overdueCount(req.ctx) }
            : {};
          const value = buildNav(user, req.path, counts);
          Object.defineProperty(locals, 'nav', { value, configurable: true, enumerable: true, writable: true });
          return value;
        },
      });
    } else {
      locals.currentUser = null;
      locals.nav = [];
    }
    next();
  };
}

module.exports = { createLocals, buildNav, navAllows, NAV };
