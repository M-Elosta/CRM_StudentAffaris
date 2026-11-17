'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const { AppError, NotFoundError } = require('../../lib/errors');
const { ROLE_LABELS, assignableRoles, PERMISSIONS: P } = require('../../security/permissions');
const authorize = require('../../security/authorize');
const { parseWith } = require('../../validation/common');
const { createUserSchema, roleChangeSchema } = require('../../validation/users');
const { formState, redirectWithMessage } = require('../render');

const LIST = '/admin/users';
const ROLE_OPTIONS = assignableRoles().map((role) => ({ value: role, label: ROLE_LABELS[role] }));

/** The forms of this page, in the shape the generic record form renders. */
const ADD_FORM = {
  fields: [
    {
      name: 'username',
      label: 'Username',
      control: 'text',
      required: true,
      max: 64,
      hint: 'Letters, numbers, dot, underscore or hyphen.',
    },
    {
      name: 'password',
      label: 'First password',
      control: 'password',
      required: true,
      hint: 'At least 12 characters. Give it to the person in private; they can change it under Account.',
    },
    { name: 'role', label: 'Role', control: 'select', options: ROLE_OPTIONS, required: true },
  ],
};
const ROLE_FORM = {
  fields: [{ name: 'role', label: 'Role', control: 'select', options: ROLE_OPTIONS, required: true, placeholder: '' }],
};

const nameOf = (account) => account.DisplayName || account.Username;

/**
 * /admin/users: accounts with role, status and last sign-in; add an account,
 * change a role, deactivate and reactivate. Needs users:manage; the rules
 * (not your own account, not the last admin) are the users service's.
 * @param {{ services: object }} deps
 */
function createAdminUsersController({ services }) {
  const router = express.Router();
  const users = services.users;

  router.use(LIST, (req, _res, next) => {
    authorize.requirePermission(req.ctx, P.USERS_MANAGE);
    next();
  });

  const targetOf = (req) => {
    if (!/^[1-9]\d{0,9}$/.test(req.params.id)) throw new NotFoundError();
    return users.findAccount(Number(req.params.id));
  };

  const renderForm = (req, res, { status = 200, screen, form, title, action, submitLabel }) =>
    res.status(status).render('records/form.njk', {
      screen,
      form,
      formTitle: title,
      action,
      submitLabel,
      cancelHref: LIST,
      options: {},
      withheld: [],
      hasContact: false,
      returnTo: '',
      breadcrumb: [{ label: 'Users', href: LIST }, { label: title }],
    });

  /** Run an account action; a refusal by the rules comes back to the list as an error message. */
  function act(req, res, action, success) {
    try {
      action();
    } catch (err) {
      if (err instanceof AppError && err.status < 500 && err.status !== 401) {
        return redirectWithMessage(req, res, LIST, err.message, 'error');
      }
      throw err;
    }
    return redirectWithMessage(req, res, LIST, success);
  }

  router.get(
    LIST,
    asyncHandler((req, res) => {
      res.render('admin/users.njk', {
        accounts: users.listAccounts().map((account) => ({
          ...account,
          name: nameOf(account),
          roleLabel: ROLE_LABELS[account.Role] ?? account.Role,
          isSelf: account.UserID === req.user.id,
        })),
      });
    })
  );

  router.get(`${LIST}/new`, (req, res) =>
    renderForm(req, res, {
      screen: ADD_FORM,
      form: formState({ username: '', password: '', role: 'staff' }),
      title: 'Add user',
      action: LIST,
      submitLabel: 'Add user',
    })
  );

  router.post(
    LIST,
    asyncHandler(async (req, res) => {
      const values = {
        username: String(req.body.username ?? '').trim(),
        password: String(req.body.password ?? ''),
        role: String(req.body.role ?? ''),
      };
      const fail = (errors, message) =>
        renderForm(req, res, {
          status: 422,
          screen: ADD_FORM,
          form: formState({ ...values, password: '' }, errors, message),
          title: 'Add user',
          action: LIST,
          submitLabel: 'Add user',
        });
      let account;
      try {
        account = await users.create(parseWith(createUserSchema, values));
      } catch (err) {
        if (err instanceof AppError && err.fields) return fail(err.fields, 'Check the fields marked below.');
        if (err instanceof AppError && err.status === 409) {
          return fail({ username: 'This username is already taken. Choose another.' }, 'The user was not added.');
        }
        throw err;
      }
      return redirectWithMessage(req, res, LIST, `User ${account.Username} added`);
    })
  );

  router.get(
    `${LIST}/:id/role`,
    asyncHandler((req, res) => {
      const account = targetOf(req);
      renderForm(req, res, {
        screen: ROLE_FORM,
        form: formState({ role: account.Role }),
        title: `Change the role of ${nameOf(account)}`,
        action: `${LIST}/${account.UserID}/role`,
        submitLabel: 'Change role',
      });
    })
  );

  router.post(
    `${LIST}/:id/role`,
    asyncHandler((req, res) => {
      const account = targetOf(req);
      return act(
        req,
        res,
        () => users.changeRole(req.user.id, account.UserID, parseWith(roleChangeSchema, req.body).role),
        `${nameOf(account)} is now ${ROLE_LABELS[req.body.role] ?? 'changed'}`
      );
    })
  );

  router.post(
    `${LIST}/:id/deactivate`,
    asyncHandler((req, res) => {
      const account = targetOf(req);
      return act(
        req,
        res,
        () => users.deactivate(req.user.id, account.UserID),
        `${nameOf(account)} deactivated and signed out`
      );
    })
  );

  router.post(
    `${LIST}/:id/reactivate`,
    asyncHandler((req, res) => {
      const account = targetOf(req);
      return act(req, res, () => users.reactivate(req.user.id, account.UserID), `${nameOf(account)} can sign in again`);
    })
  );

  return router;
}

module.exports = { createAdminUsersController };
