'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const { z } = require('zod');

const {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  validationErrorFromZod,
} = require('../../src/lib/errors');
const { asyncHandler } = require('../../src/lib/async-handler');
const { createErrorHandler } = require('../../src/middleware/errors');
const { createSilentLogger } = require('../helpers/app');

describe('lib/errors', () => {
  it('gives each error class its HTTP status and name', () => {
    const cases = [
      [new ValidationError('bad'), 400, 'ValidationError'],
      [new UnauthorizedError('who?'), 401, 'UnauthorizedError'],
      [new ForbiddenError('no'), 403, 'ForbiddenError'],
      [new NotFoundError('gone'), 404, 'NotFoundError'],
      [new ConflictError('stale'), 409, 'ConflictError'],
    ];
    for (const [err, status, name] of cases) {
      assert.ok(err instanceof AppError);
      assert.ok(err instanceof Error);
      assert.equal(err.status, status);
      assert.equal(err.name, name);
    }
    assert.equal(new NotFoundError().message, 'Not found');
  });

  it('keeps per-field messages on a ValidationError', () => {
    const err = new ValidationError('Email address is not valid', { EmailAddress: 'Email address is not valid' });
    assert.deepEqual(err.fields, { EmailAddress: 'Email address is not valid' });
    assert.equal(new ValidationError('plain').fields, undefined);
  });

  it('converts a zod error into one message plus a message per field', () => {
    const schema = z.object({
      Name: z.string({ error: 'Name is required' }),
      Tags: z.array(z.string({ error: 'Tags must contain only text' })),
    });
    const result = schema.safeParse({ Tags: ['ok', 3, 4] });
    const err = validationErrorFromZod(result.error);
    assert.ok(err instanceof ValidationError);
    assert.equal(err.message, 'Name is required');
    assert.deepEqual(err.fields, { Name: 'Name is required', Tags: 'Tags must contain only text' });
  });
});

describe('error middleware', () => {
  function appThatThrows(error) {
    const logger = createSilentLogger();
    const app = express();
    app.get(
      '/sync',
      asyncHandler(() => {
        throw error;
      })
    );
    app.get(
      '/async',
      asyncHandler(async () => {
        await Promise.resolve();
        throw error;
      })
    );
    app.use(createErrorHandler(logger));
    return { app, logger };
  }

  it('sends an AppError with its status and message, from sync and async handlers', async () => {
    const { app } = appThatThrows(new ConflictError('Please reload'));
    for (const url of ['/sync', '/async']) {
      const res = await supertest(app).get(url);
      assert.equal(res.status, 409);
      assert.deepEqual(res.body, { error: 'Please reload' });
    }
  });

  it('includes the fields of a ValidationError', async () => {
    const { app } = appThatThrows(new ValidationError('Sector is wrong', { Sector: 'Sector is wrong' }));
    const res = await supertest(app).get('/sync');
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Sector is wrong', fields: { Sector: 'Sector is wrong' } });
  });

  it('maps a raw ZodError to 400 with fields', async () => {
    const zodError = z
      .object({ Email: z.email({ error: 'Email address is not valid' }) })
      .safeParse({ Email: 'x' }).error;
    const { app } = appThatThrows(zodError);
    const res = await supertest(app).get('/async');
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: 'Email address is not valid',
      fields: { Email: 'Email address is not valid' },
    });
  });

  it('hides unexpected errors behind a generic message and logs them', async () => {
    const { app, logger } = appThatThrows(new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed'));
    const res = await supertest(app).get('/async');
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /SQLITE|FOREIGN KEY/);
    assert.equal(typeof res.body.error, 'string');
    assert.equal(logger.entries.error.length, 1);
  });

  it('treats an AppError with a 5xx status as unexpected', async () => {
    const { app } = appThatThrows(new AppError('internal detail', { status: 503 }));
    const res = await supertest(app).get('/sync');
    assert.equal(res.status, 500);
    assert.doesNotMatch(res.body.error, /internal detail/);
  });

  it('still honours a plain error carrying a 4xx statusCode', async () => {
    const err = new Error('Unsupported field in request payload');
    err.statusCode = 400;
    const { app } = appThatThrows(err);
    const res = await supertest(app).get('/sync');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Unsupported field in request payload');
  });
});
