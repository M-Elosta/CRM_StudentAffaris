'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

const { buildApp, loginAs, post, ORIGIN } = require('../helpers/app');

const COMPANY = { CompanyName: 'Origin Test Co', Industry: 'Tech', Sector: 'Private', Country: 'Qatar' };

describe('Security middleware', () => {
  let ctx;
  let admin;

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');
  });

  after(() => ctx.close());

  const companyCount = () => ctx.db.prepare('SELECT COUNT(*) AS n FROM Company').get().n;

  describe('trusted origin', () => {
    it('blocks a write without an Origin header with 403', async () => {
      const before = companyCount();
      const res = await admin.post('/api/companies').send(COMPANY);
      assert.equal(res.status, 403);
      assert.equal(typeof res.body.error, 'string');
      assert.equal(companyCount(), before);
    });

    it('blocks a write from another origin with 403', async () => {
      const before = companyCount();
      const res = await admin.post('/api/companies').set('Origin', 'http://evil.test').send(COMPANY);
      assert.equal(res.status, 403);
      assert.equal(companyCount(), before);
    });

    it('blocks a write whose Origin only shares a prefix with the app origin', async () => {
      const res = await admin.post('/api/companies').set('Origin', 'http://crm.test.evil.test').send(COMPANY);
      assert.equal(res.status, 403);
    });

    it('blocks PUT, PATCH and DELETE without an Origin header', async () => {
      assert.equal((await admin.put('/api/companies/1').send(COMPANY)).status, 403);
      assert.equal((await admin.patch('/api/users/1/role').send({ role: 'readonly' })).status, 403);
      assert.equal((await admin.delete('/api/companies/1')).status, 403);
    });

    it('blocks a login attempt from another origin', async () => {
      const res = await supertest(ctx.app)
        .post('/api/auth/login')
        .set('Origin', 'http://evil.test')
        .send({ username: 'admin-user', password: 'whatever-password' });
      assert.equal(res.status, 403);
    });

    it('lets a write with the app origin through', async () => {
      const res = await admin.post('/api/companies').set('Origin', ORIGIN).send(COMPANY);
      assert.equal(res.status, 201);
    });

    it('accepts a same-origin Referer when no Origin header is sent', async () => {
      const res = await admin
        .post('/api/companies')
        .set('Referer', `${ORIGIN}/pages/companies.html`)
        .send({ ...COMPANY, CompanyName: 'Referer Co' });
      assert.equal(res.status, 201);
    });

    it('does not require an Origin header for reads', async () => {
      assert.equal((await admin.get('/api/companies')).status, 200);
    });
  });

  describe('poisoned keys', () => {
    it('rejects a body with a __proto__ key with 400', async () => {
      const res = await admin
        .post('/api/companies')
        .set('Origin', ORIGIN)
        .set('Content-Type', 'application/json')
        .send('{"CompanyName":"P","Industry":"X","Sector":"Private","Country":"Q","__proto__":{"isAdmin":true}}');
      assert.equal(res.status, 400);
      assert.equal(typeof res.body.error, 'string');
      assert.equal({}.isAdmin, undefined);
    });

    it('rejects a body with a nested constructor key with 400', async () => {
      const res = await admin
        .post('/api/companies')
        .set('Origin', ORIGIN)
        .set('Content-Type', 'application/json')
        .send(
          '{"CompanyName":"P","Industry":"X","Sector":"Private","Country":"Q","Comment":{"constructor":{"prototype":{}}}}'
        );
      assert.equal(res.status, 400);
    });

    it('rejects a poisoned key inside an array with 400', async () => {
      const res = await admin
        .post('/api/import/validate')
        .set('Origin', ORIGIN)
        .set('Content-Type', 'application/json')
        .send('{"entity":"Company","mapping":{},"rows":[{"__proto__":{"x":1}}]}');
      assert.equal(res.status, 400);
    });

    it('rejects a query string with a prototype key with 400', async () => {
      // The query parser already drops __proto__ and constructor; prototype reaches the guard.
      const res = await admin.get('/api/companies?search[prototype]=1');
      assert.equal(res.status, 400);
    });

    it('ignores a __proto__ key in the query string without polluting objects', async () => {
      const res = await admin.get('/api/companies?__proto__[polluted]=1');
      assert.ok(res.status === 200 || res.status === 400);
      assert.equal({}.polluted, undefined);
    });
  });

  describe('request bodies', () => {
    it('rejects an oversized JSON body with 413 and a JSON error', async () => {
      const res = await admin
        .post('/api/companies')
        .set('Origin', ORIGIN)
        .send({ ...COMPANY, Comment: 'x'.repeat(1.5 * 1024 * 1024) });
      assert.equal(res.status, 413);
      assert.match(res.headers['content-type'], /json/);
      assert.equal(typeof res.body.error, 'string');
    });

    it('rejects malformed JSON with 400 and a JSON error', async () => {
      const res = await admin
        .post('/api/companies')
        .set('Origin', ORIGIN)
        .set('Content-Type', 'application/json')
        .send('{"CompanyName": ');
      assert.equal(res.status, 400);
      assert.match(res.headers['content-type'], /json/);
    });
  });

  describe('headers', () => {
    it('sets a Content-Security-Policy that forbids framing', async () => {
      const res = await supertest(ctx.app).get('/login.html');
      const csp = res.headers['content-security-policy'];
      assert.ok(csp, 'Content-Security-Policy header');
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /object-src 'none'/);
    });

    it('sets X-Content-Type-Options, X-Frame-Options and Referrer-Policy', async () => {
      const res = await supertest(ctx.app).get('/login.html');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.match(res.headers['x-frame-options'] || '', /SAMEORIGIN|DENY/i);
      assert.equal(res.headers['referrer-policy'], 'no-referrer');
    });

    it('sets security headers on API responses too', async () => {
      const res = await admin.get('/api/companies');
      assert.ok(res.headers['content-security-policy']);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    });

    it('does not advertise the framework', async () => {
      const res = await supertest(ctx.app).get('/login.html');
      assert.equal(res.headers['x-powered-by'], undefined);
    });

    it('does not send HSTS outside production-like environments', async () => {
      const res = await supertest(ctx.app).get('/login.html');
      assert.equal(res.headers['strict-transport-security'], undefined);
    });
  });

  describe('health check and unknown routes', () => {
    it('/healthz is public, uncached and reports ok', async () => {
      const res = await supertest(ctx.app).get('/healthz');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { status: 'ok' });
      assert.equal(res.headers['cache-control'], 'no-store');
    });

    it('/healthz reports 503 when the database is unavailable', async () => {
      const broken = await buildApp();
      broken.db.close();
      const res = await supertest(broken.app).get('/healthz');
      assert.equal(res.status, 503);
      assert.deepEqual(res.body, { status: 'unavailable' });
    });

    it('an unknown API route returns 404 JSON for a signed-in user', async () => {
      const res = await admin.get('/api/does-not-exist');
      assert.equal(res.status, 404);
      assert.match(res.headers['content-type'], /json/);
    });

    it('server errors do not leak details to the client', async () => {
      // A foreign key failure is currently an unhandled database error.
      const res = await post(admin, '/api/contacts', {
        CompanyID: 999999,
        FirstName: 'A',
        LastName: 'B',
        EmailAddress: 'a@example.com',
      });
      if (res.status === 500) {
        assert.doesNotMatch(JSON.stringify(res.body), /SQLITE|FOREIGN KEY|constraint/i);
      }
    });
  });
});
