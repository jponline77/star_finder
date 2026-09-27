// Regression tests: signup enumeration limiter, current-password brute force, admin password
// resets (must-change gate, expiry, reuse, self-reset), deleting content with others' comments.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  makeTestApp, client, signup, signupAdmin, seedFixture, soloBody, PASSWORD,
} from './helpers.js';

describe('signup: "already exists" answers are rate limited', () => {
  test('after STAR_SIGNUP_CONFLICT_LIMIT duplicate-email signups from one IP, signups answer 429', async () => {
    const t = makeTestApp({ env: { STAR_SIGNUP_CONFLICT_LIMIT: '3' } });
    try {
      for (let i = 0; i < 3; i++) await signup(t.app, { email: `known${i}@school.ca` });
      const c = client(t.app);
      // new emails and validation errors don't count
      assert.equal((await c.post('/api/auth/signup', { email: 'new1@school.ca', password: PASSWORD, displayName: 'New One' })).status, 201);
      assert.equal((await c.post('/api/auth/signup', { email: 'bad', password: 'x', displayName: 'x' })).status, 400);
      for (let i = 0; i < 3; i++) {
        const res = await c.post('/api/auth/signup', { email: `known${i}@school.ca`, password: PASSWORD, displayName: 'Guesser' });
        assert.equal(res.status, 409, `attempt ${i + 1}`);
      }
      const probe = await c.post('/api/auth/signup', { email: 'known0@school.ca', password: PASSWORD, displayName: 'Guesser' });
      assert.equal(probe.status, 429);
      const fresh = await c.post('/api/auth/signup', { email: 'new2@school.ca', password: PASSWORD, displayName: 'New Two' });
      assert.equal(fresh.status, 429, 'blocked for this IP whether or not the email exists — the answer reveals nothing');
    } finally {
      t.cleanup();
    }
  });
});

describe('changing your password', () => {
  test('wrong current passwords are rate limited per account (a borrowed session can\'t brute-force it)', async () => {
    const t = makeTestApp({ env: { STAR_LOGIN_LIMIT: '3' } });
    try {
      const u = await signup(t.app);
      // renaming yourself never counts
      for (let i = 0; i < 5; i++) assert.equal((await u.put('/api/auth/me', { displayName: `Name ${i}` })).status, 200);
      for (let i = 0; i < 3; i++) {
        const res = await u.put('/api/auth/me', { currentPassword: `guess-${i}-xxxx`, newPassword: 'new-password-1' });
        assert.equal(res.status, 400);
      }
      const blocked = await u.put('/api/auth/me', { currentPassword: PASSWORD, newPassword: 'new-password-1' });
      assert.equal(blocked.status, 429, 'even the right password is refused once the limit is hit');
      assert.equal((await client(t.app).post('/api/auth/login', { email: u.user.email, password: PASSWORD })).status, 200, 'password unchanged');
      // a different account is unaffected
      const v = await signup(t.app);
      assert.equal((await v.put('/api/auth/me', { currentPassword: PASSWORD, newPassword: 'new-password-2' })).status, 200);
    } finally {
      t.cleanup();
    }
  });

  test('an over-long current password is just "incorrect" (never hashed)', async () => {
    const t = makeTestApp();
    try {
      const u = await signup(t.app);
      const res = await u.put('/api/auth/me', { currentPassword: 'x'.repeat(50_000), newPassword: 'new-password-1' });
      assert.equal(res.status, 400);
      assert.ok(res.body.details.currentPassword);
    } finally {
      t.cleanup();
    }
  });

  test('the new password must differ from the current one', async () => {
    const t = makeTestApp();
    try {
      const u = await signup(t.app);
      const res = await u.put('/api/auth/me', { currentPassword: PASSWORD, newPassword: PASSWORD });
      assert.equal(res.status, 400);
      assert.ok(res.body.details.newPassword);
    } finally {
      t.cleanup();
    }
  });
});

describe('admin password resets', () => {
  async function resetStudent(t) {
    const ids = seedFixture(t.db);
    const admin = await signupAdmin(t.app, t.db, { email: 'teacher@school.ca' });
    const student = await signup(t.app, { email: 'kid@school.ca' });
    const song = (await student.post('/api/songs', soloBody({ title: 'Kid Song' }))).body;
    const reset = await admin.post(`/api/admin/users/${student.user.id}/reset-password`);
    assert.equal(reset.status, 200);
    const c = client(t.app);
    const login = await c.post('/api/auth/login', { email: 'kid@school.ca', password: reset.body.temporaryPassword });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.mustChangePassword, true);
    return { ids, admin, student, song, reset: reset.body, c };
  }

  test('with a temporary password you can read and change your password — nothing else', async () => {
    const t = makeTestApp();
    try {
      const { ids, song, reset, c } = await resetStudent(t);
      assert.match(reset.expiresAt, /^\d{4}-\d\d-\d\dT/);
      const blocked = [
        await c.post(`/api/songs/${ids.stars}/comments`, { body: 'hi' }),
        await c.put(`/api/songs/${song.id}`, soloBody({ title: 'Kid Song' })),
        await c.del(`/api/songs/${song.id}`),
        await c.post('/api/shows', { name: 'New Show' }),
      ];
      for (const res of blocked) {
        assert.equal(res.status, 403);
        assert.equal(res.body.error, 'Please choose a new password first');
        assert.equal(res.body.code, 'MUST_CHANGE_PASSWORD');
      }
      assert.equal((await c.put('/api/auth/me', { displayName: 'Only A Rename' })).status, 200, 'PUT /api/auth/me is allowed');
      assert.equal((await c.get(`/api/songs/${song.id}`)).status, 200, 'reading still works');
      assert.equal((await c.get('/api/me/contributions')).status, 200);
      // reusing the temporary password isn't a change
      const same = await c.put('/api/auth/me', { currentPassword: reset.temporaryPassword, newPassword: reset.temporaryPassword });
      assert.equal(same.status, 400);
      const changed = await c.put('/api/auth/me', { currentPassword: reset.temporaryPassword, newPassword: 'my-own-secret-1' });
      assert.equal(changed.status, 200);
      assert.equal(changed.body.user.mustChangePassword, false);
      assert.equal((await c.post(`/api/songs/${ids.stars}/comments`, { body: 'hi' })).status, 201);
      assert.equal(t.db.prepare('SELECT temp_password_expires_at AS e FROM users WHERE email = ?').get('kid@school.ca').e, null);
    } finally {
      t.cleanup();
    }
  });

  test('an unused temporary password expires (and so do sessions made with it)', async () => {
    const t = makeTestApp();
    try {
      const { reset, c } = await resetStudent(t);
      t.db.prepare("UPDATE users SET temp_password_expires_at = '2000-01-01T00:00:00.000Z' WHERE email = ?").run('kid@school.ca');
      assert.equal((await c.get('/api/auth/me')).body.user, null, 'the existing session stops working');
      const login = await client(t.app).post('/api/auth/login', { email: 'kid@school.ca', password: reset.temporaryPassword });
      assert.equal(login.status, 403);
      assert.match(login.body.error, /expired/);
      const wrong = await client(t.app).post('/api/auth/login', { email: 'kid@school.ca', password: 'not-the-temp-pw' });
      assert.equal(wrong.status, 401, "a wrong password doesn't reveal the account state");
    } finally {
      t.cleanup();
    }
  });

  test("an admin can't reset their own password from the Admin page", async () => {
    const t = makeTestApp();
    try {
      const admin = await signupAdmin(t.app, t.db);
      const res = await admin.post(`/api/admin/users/${admin.user.id}/reset-password`);
      assert.equal(res.status, 409);
      assert.equal(res.body.error, 'Change your own password in My stuff');
      assert.equal((await admin.get('/api/auth/me')).body.user.id, admin.user.id, 'still logged in');
      assert.equal((await client(t.app).post('/api/auth/login', { email: admin.user.email, password: PASSWORD })).status, 200);
    } finally {
      t.cleanup();
    }
  });
});

describe("deleting your own show doesn't delete other people's comments", () => {
  test('owner → 409 while others have commented; admin may delete (comments go with it)', async () => {
    const t = makeTestApp();
    try {
      const alice = await signup(t.app, { displayName: 'Alice' });
      const carol = await signup(t.app, { displayName: 'Carol' });
      const admin = await signupAdmin(t.app, t.db);
      const show = (await alice.post('/api/shows', { name: 'Alice Show' })).body;
      await alice.post(`/api/shows/${show.id}/comments`, { body: 'my own note' });
      await carol.post(`/api/shows/${show.id}/comments`, { body: 'Carol was here' });
      const refused = await alice.del(`/api/shows/${show.id}`);
      assert.equal(refused.status, 409);
      assert.match(refused.body.error, /comment from other people/);
      assert.equal((await carol.get('/api/me/contributions')).body.comments.length, 1);
      assert.equal((await admin.del(`/api/shows/${show.id}`)).status, 204);
      assert.equal((await carol.get('/api/me/contributions')).body.comments.length, 0);
      // with only your own comments you can delete it yourself
      const mine = (await alice.post('/api/shows', { name: 'Alice Show 2' })).body;
      await alice.post(`/api/shows/${mine.id}/comments`, { body: 'just me' });
      assert.equal((await alice.del(`/api/shows/${mine.id}`)).status, 204);
      assert.equal((await request(t.app).get(`/api/shows/${mine.id}`)).status, 404);
    } finally {
      t.cleanup();
    }
  });
});
