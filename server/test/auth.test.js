import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeTestApp, client, signup, signupAdmin, CSRF, PASSWORD, silentLogger } from './helpers.js';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword, parseCookies, hashToken } from '../src/lib/auth.js';

describe('password hashing', () => {
  test('scrypt format and verify', async () => {
    const h = await hashPassword('s3cret-pass');
    assert.match(h, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.equal(await verifyPassword('s3cret-pass', h), true);
    assert.equal(await verifyPassword('wrong-pass', h), false);
    assert.equal(await verifyPassword('x', 'garbage'), false);
  });

  test('cookie parser', () => {
    assert.deepEqual(parseCookies('a=1; star_sid=abc%3D; b="q"'), { a: '1', star_sid: 'abc=', b: 'q' });
    assert.deepEqual(parseCookies(undefined), {});
  });
});

describe('auth endpoints', () => {
  let t;
  before(() => {
    t = makeTestApp({ env: { STAR_ADMIN_EMAILS: 'Boss@Example.com, other@example.com' } });
  });
  after(() => t.cleanup());

  test('signup → 201 with user + HttpOnly SameSite=Lax cookie; /me returns the user', async () => {
    const c = client(t.app);
    const res = await c.post('/api/auth/signup', { email: '  Alice@Example.COM ', password: PASSWORD, displayName: '  Alice  ' });
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.body.user).sort(), ['createdAt', 'displayName', 'email', 'festivalSlug', 'id', 'mustChangePassword', 'role']);
    assert.equal(res.body.user.email, 'alice@example.com');
    assert.equal(res.body.user.displayName, 'Alice');
    assert.equal(res.body.user.role, 'user');
    assert.equal(res.body.user.mustChangePassword, false);
    assert.equal(res.body.user.festivalSlug, null);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('star_sid='));
    assert.ok(cookie, 'session cookie set');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=2592000/);
    assert.doesNotMatch(cookie, /Secure/i, 'no Secure flag over plain http');
    // DB stores only the sha256 of the token
    const token = cookie.split(';')[0].split('=')[1];
    const row = t.db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(decodeURIComponent(token)));
    assert.ok(row);
    assert.equal(t.db.prepare('SELECT count(*) AS n FROM sessions WHERE token_hash = ?').get(token).n, 0);
    const me = await c.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'alice@example.com');
  });

  test('/me without session → { user: null }', async () => {
    const res = await request(t.app).get('/api/auth/me');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { user: null });
  });

  test('signup validation → 400 with details', async () => {
    const c = client(t.app);
    const res = await c.post('/api/auth/signup', { email: 'not-an-email', password: 'short', displayName: 'x' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
    assert.ok(res.body.details.email);
    assert.ok(res.body.details.password);
    assert.ok(res.body.details.displayName);
    const r2 = await c.post('/api/auth/signup', { email: 'ok@example.com', password: PASSWORD, displayName: 'me@example.com' });
    assert.equal(r2.status, 400);
    assert.ok(r2.body.details.displayName);
    const r3 = await c.post('/api/auth/signup', { email: 'ok2@example.com', password: PASSWORD, displayName: 'visit www.spam.com' });
    assert.equal(r3.status, 400);
    const r4 = await c.post('/api/auth/signup', { email: 'ok3@example.com', password: 'x'.repeat(201), displayName: 'Okay Name' });
    assert.equal(r4.status, 400);
  });

  test('duplicate email (any case) → 409', async () => {
    await signup(t.app, { email: 'dup@example.com' });
    const res = await client(t.app).post('/api/auth/signup', { email: 'DUP@example.com', password: PASSWORD, displayName: 'Dupe' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'An account with that email already exists');
  });

  test('login: wrong password and unknown email give the same generic 401', async () => {
    await signup(t.app, { email: 'bob@example.com' });
    const c = client(t.app);
    const wrong = await c.post('/api/auth/login', { email: 'bob@example.com', password: 'nope-nope-nope' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, 'Email or password is incorrect');
    const unknown = await c.post('/api/auth/login', { email: 'nobody@example.com', password: 'nope-nope-nope' });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, 'Email or password is incorrect');
    const ok = await c.post('/api/auth/login', { email: ' BOB@example.com ', password: PASSWORD });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.email, 'bob@example.com');
    assert.ok(ok.headers['set-cookie'].some((x) => x.startsWith('star_sid=')));
    const row = t.db.prepare('SELECT last_login_at FROM users WHERE email = ?').get('bob@example.com');
    assert.ok(row.last_login_at);
  });

  test('logout → 204, clears cookie and deletes the session row', async () => {
    const c = await signup(t.app);
    const before = t.db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ?').get(c.user.id).n;
    assert.equal(before, 1);
    const res = await c.post('/api/auth/logout');
    assert.equal(res.status, 204);
    assert.ok(res.headers['set-cookie'].some((x) => x.startsWith('star_sid=;')));
    assert.equal(t.db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ?').get(c.user.id).n, 0);
    const me = await c.get('/api/auth/me');
    assert.equal(me.body.user, null);
  });

  test('disabled account → 403 on login and existing sessions stop working', async () => {
    const c = await signup(t.app, { email: 'carol@example.com' });
    t.db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(c.user.id);
    const me = await c.get('/api/auth/me');
    assert.equal(me.body.user, null);
    const res = await client(t.app).post('/api/auth/login', { email: 'carol@example.com', password: PASSWORD });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'This account has been disabled — talk to your teacher');
    // wrong password on a disabled account still says 401 (doesn't reveal the account state)
    const wrong = await client(t.app).post('/api/auth/login', { email: 'carol@example.com', password: 'bad-password' });
    assert.equal(wrong.status, 401);
  });

  test('STAR_ADMIN_EMAILS never makes a new signup an admin (nobody has proven they own the address)', async () => {
    const c = await signup(t.app, { email: 'Boss@example.com' });
    assert.equal(c.user.role, 'user');
    assert.equal((await c.get('/api/admin/users')).status, 403);
    // …and logging in again doesn't promote it either
    const again = await client(t.app).post('/api/auth/login', { email: 'boss@example.com', password: PASSWORD });
    assert.equal(again.status, 200);
    assert.equal(again.body.user.role, 'user');
  });
  test('CSRF: non-GET /api without X-Requested-With → 403', async () => {
    const c = await signup(t.app);
    const res = await c.agent.post('/api/songs').send({ kind: 'solo' });
    assert.equal(res.status, 403);
    const res2 = await request(t.app).post('/api/auth/login').send({ email: 'bob@example.com', password: PASSWORD });
    assert.equal(res2.status, 403);
    const res3 = await c.agent.post('/api/auth/logout').set('X-Requested-With', 'XMLHttpRequest');
    assert.equal(res3.status, 403);
    const me = await c.get('/api/auth/me');
    assert.ok(me.body.user, 'still logged in');
  });

  test('JSON writes require Content-Type: application/json → 415', async () => {
    const res = await request(t.app).post('/api/auth/login').set(CSRF).set('Content-Type', 'text/plain').send('email=a&password=b');
    assert.equal(res.status, 415);
    const form = await request(t.app).post('/api/auth/login').set(CSRF).type('form').send({ email: 'a@b.co', password: 'x' });
    assert.equal(form.status, 415);
  });

  test('malformed JSON → 400', async () => {
    const res = await request(t.app).post('/api/auth/login').set(CSRF).set('Content-Type', 'application/json').send('{"email":');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('PUT /me: display name, password change revokes other sessions', async () => {
    const a = await signup(t.app, { email: 'dana@example.com' });
    const b = client(t.app);
    const login = await b.post('/api/auth/login', { email: 'dana@example.com', password: PASSWORD });
    assert.equal(login.status, 200);

    const rename = await a.put('/api/auth/me', { displayName: 'Dana D' });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.user.displayName, 'Dana D');

    const noCurrent = await a.put('/api/auth/me', { newPassword: 'another-pass-1' });
    assert.equal(noCurrent.status, 400);
    assert.ok(noCurrent.body.details.currentPassword);
    const badCurrent = await a.put('/api/auth/me', { currentPassword: 'wrong-wrong', newPassword: 'another-pass-1' });
    assert.equal(badCurrent.status, 400);
    assert.ok(badCurrent.body.details.currentPassword);

    const ok = await a.put('/api/auth/me', { currentPassword: PASSWORD, newPassword: 'another-pass-1' });
    assert.equal(ok.status, 200);
    assert.equal((await a.get('/api/auth/me')).body.user.email, 'dana@example.com', 'current session survives');
    assert.equal((await b.get('/api/auth/me')).body.user, null, 'other session revoked');
    assert.equal((await client(t.app).post('/api/auth/login', { email: 'dana@example.com', password: PASSWORD })).status, 401);
    assert.equal((await client(t.app).post('/api/auth/login', { email: 'dana@example.com', password: 'another-pass-1' })).status, 200);
  });

  test('PUT /me requires login', async () => {
    const res = await client(t.app).put('/api/auth/me', { displayName: 'Nope' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Please log in first');
  });

  test('expired sessions are not accepted', async () => {
    const c = await signup(t.app);
    t.db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").run(c.user.id);
    assert.equal((await c.get('/api/auth/me')).body.user, null);
  });
});

describe('secure cookie behind a TLS proxy', () => {
  test('TRUST_PROXY + X-Forwarded-Proto: https → Secure cookie', async () => {
    const t = makeTestApp({ env: { TRUST_PROXY: '1' } });
    try {
      const res = await request(t.app)
        .post('/api/auth/signup')
        .set(CSRF)
        .set('X-Forwarded-Proto', 'https')
        .send({ email: 'sec@example.com', password: PASSWORD, displayName: 'Secure Sam' });
      assert.equal(res.status, 201);
      const cookie = res.headers['set-cookie'].find((c) => c.startsWith('star_sid='));
      assert.match(cookie, /; Secure/i);
    } finally {
      t.cleanup();
    }
  });

  test('without TRUST_PROXY, X-Forwarded-Proto is ignored', async () => {
    const t = makeTestApp();
    try {
      const res = await request(t.app)
        .post('/api/auth/signup')
        .set(CSRF)
        .set('X-Forwarded-Proto', 'https')
        .send({ email: 'sec2@example.com', password: PASSWORD, displayName: 'Plain Pat' });
      const cookie = res.headers['set-cookie'].find((c) => c.startsWith('star_sid='));
      assert.doesNotMatch(cookie, /Secure/i);
    } finally {
      t.cleanup();
    }
  });
});

describe('login rate limit', () => {
  test('10 failed attempts per IP+email per 15 min, then 429', async () => {
    const t = makeTestApp({ env: { STAR_LOGIN_LIMIT: '' } });
    try {
      await signup(t.app, { email: 'eve@example.com' });
      const c = client(t.app);
      for (let i = 0; i < 10; i++) {
        const r = await c.post('/api/auth/login', { email: 'eve@example.com', password: `wrong-${i}-xxxx` });
        assert.equal(r.status, 401, `attempt ${i + 1}`);
      }
      const blocked = await c.post('/api/auth/login', { email: 'eve@example.com', password: PASSWORD });
      assert.equal(blocked.status, 429);
      assert.ok(blocked.body.error);
      // a different email from the same IP is not blocked
      const other = await c.post('/api/auth/login', { email: 'someone-else@example.com', password: 'whatever-123' });
      assert.equal(other.status, 401);
    } finally {
      t.cleanup();
    }
  });

  test('successful logins do not count toward the limit', async () => {
    const t = makeTestApp();
    try {
      await signup(t.app, { email: 'frank@example.com' });
      const c = client(t.app);
      for (let i = 0; i < 12; i++) {
        const r = await c.post('/api/auth/login', { email: 'frank@example.com', password: PASSWORD });
        assert.equal(r.status, 200);
      }
    } finally {
      t.cleanup();
    }
  });
});

describe('STAR_ADMIN_EMAILS (startup promotion of accounts that already existed)', () => {
  const startApp = (t, emails, logger = silentLogger) =>
    createApp({ db: t.db, uploadsDir: t.uploadsDir, mediaDir: t.mediaDir, env: { STAR_ADMIN_EMAILS: emails }, logger });
  const roleOf = (t, email) => t.db.prepare('SELECT role FROM users WHERE email = ?').get(email).role;

  test('the teacher signs up first, then the email is listed → promoted at the next start', async () => {
    const t = makeTestApp();
    try {
      await signup(t.app, { email: 'teacher@school.ca' });
      const infos = [];
      const app2 = startApp(t, 'Teacher@School.ca', { ...silentLogger, info: (m) => infos.push(m) });
      app2.locals.close();
      assert.equal(roleOf(t, 'teacher@school.ca'), 'admin');
      assert.ok(infos.some((m) => /teacher@school\.ca/.test(m) && /now an admin/.test(m)), 'promotion is logged');
    } finally {
      t.cleanup();
    }
  });

  test('pre-registration: an account created AFTER the email was listed is never promoted automatically', async () => {
    const t = makeTestApp();
    try {
      // The server starts with the teacher's email listed before the teacher has an account…
      const app1 = startApp(t, 'ms.smith@school.ca');
      // …and a student registers that address first, with their own password.
      const squatter = await signup(app1, { email: 'Ms.Smith@school.ca', password: 'attackerpw1' });
      assert.equal(squatter.user.role, 'user');
      assert.equal((await squatter.get('/api/admin/users')).status, 403);
      const login = await client(app1).post('/api/auth/login', { email: 'ms.smith@school.ca', password: 'attackerpw1' });
      assert.equal(login.body.user.role, 'user', 'login does not promote');
      app1.locals.close();
      // Restarting with the same list still doesn't promote it — and says why.
      const warnings = [];
      const app2 = startApp(t, 'ms.smith@school.ca', { ...silentLogger, warn: (m) => warnings.push(m) });
      app2.locals.close();
      assert.equal(roleOf(t, 'ms.smith@school.ca'), 'user');
      assert.ok(warnings.some((m) => /NOT promoting/.test(m) && /make-admin/.test(m)));
      // Removing the email and listing it again later starts a new window: the (now existing)
      // account is the one the operator is vouching for.
      startApp(t, '').locals.close();
      startApp(t, 'ms.smith@school.ca').locals.close();
      assert.equal(roleOf(t, 'ms.smith@school.ca'), 'admin');
    } finally {
      t.cleanup();
    }
  });

  test('an admin listed in STAR_ADMIN_EMAILS can\'t be demoted from the Admin page (it would come back at restart)', async () => {
    const t = makeTestApp();
    try {
      const listed = await signup(t.app, { email: 'listed@example.com' });
      await signupAdmin(t.app, t.db, { email: 'other-admin@example.com' });
      const app2 = startApp(t, 'listed@example.com');
      try {
        assert.equal(roleOf(t, 'listed@example.com'), 'admin');
        const admin = client(app2);
        assert.equal((await admin.post('/api/auth/login', { email: 'other-admin@example.com', password: PASSWORD })).status, 200);
        const res = await admin.patch(`/api/admin/users/${listed.user.id}`, { role: 'user' });
        assert.equal(res.status, 409);
        assert.match(res.body.error, /STAR_ADMIN_EMAILS/);
        assert.equal(roleOf(t, 'listed@example.com'), 'admin');
        // disabling still works (that's how to lock out a compromised listed account)
        const dis = await admin.patch(`/api/admin/users/${listed.user.id}`, { disabled: true });
        assert.equal(dis.status, 200);
        assert.equal(dis.body.disabled, true);
      } finally {
        app2.locals.close();
      }
    } finally {
      t.cleanup();
    }
  });
});
