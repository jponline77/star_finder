import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeTestApp, client, signup, signupAdmin, seedFixture, soloBody, PASSWORD } from './helpers.js';

describe('comments', () => {
  let t;
  let ids;
  let alice;
  let bob;
  let admin;
  before(async () => {
    t = makeTestApp();
    ids = seedFixture(t.db);
    alice = await signup(t.app, { displayName: 'Alice' });
    bob = await signup(t.app, { displayName: 'Bob' });
    admin = await signupAdmin(t.app, t.db, { email: 'teacher@example.com', displayName: 'Teacher' });
  });
  after(() => t.cleanup());

  test('GET is public and empty at first; POST requires login', async () => {
    const res = await request(t.app).get(`/api/songs/${ids.onMyOwn}/comments`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { comments: [] });
    const anon = await client(t.app).post(`/api/songs/${ids.onMyOwn}/comments`, { body: 'Hi' });
    assert.equal(anon.status, 401);
    assert.equal((await request(t.app).get('/api/songs/99999/comments')).status, 404);
  });

  test('POST → 201 Comment shape; oldest first; commentCount on Song and Show', async () => {
    const a = await alice.post(`/api/songs/${ids.onMyOwn}/comments`, { body: '  Great for sopranos!  ', tag: 'tip' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.deepEqual(Object.keys(a.body).sort(), ['author', 'body', 'createdAt', 'edited', 'id', 'tag', 'target', 'updatedAt']);
    assert.equal(a.body.body, 'Great for sopranos!');
    assert.equal(a.body.tag, 'tip');
    assert.deepEqual(a.body.author, { id: alice.user.id, displayName: 'Alice', role: 'user' });
    assert.deepEqual(a.body.target, { type: 'song', id: ids.onMyOwn, title: 'On My Own' });
    assert.equal(a.body.edited, false);
    const b = await bob.post(`/api/songs/${ids.onMyOwn}/comments`, { body: 'I performed this last year' });
    assert.equal(b.body.tag, 'general');
    const list = await request(t.app).get(`/api/songs/${ids.onMyOwn}/comments`);
    assert.deepEqual(list.body.comments.map((c) => c.author.displayName), ['Alice', 'Bob']);
    const song = await request(t.app).get(`/api/songs/${ids.onMyOwn}`);
    assert.equal(song.body.commentCount, 2);

    const sc = await alice.post('/api/shows/les-miserables/comments', { body: 'Such a classic', tag: 'general' });
    assert.equal(sc.status, 201);
    assert.equal(sc.body.target.type, 'show');
    assert.equal(sc.body.target.id, ids.lesMis);
    assert.equal(sc.body.target.title, 'Les Misérables');
    const byId = await request(t.app).get(`/api/shows/${ids.lesMis}/comments`);
    assert.equal(byId.body.comments.length, 1);
    const shows = await request(t.app).get('/api/shows');
    assert.equal(shows.body.shows.find((s) => s.id === ids.lesMis).commentCount, 1);
    const detail = await request(t.app).get('/api/shows/les-miserables');
    assert.equal(detail.body.commentCount, 1);
  });

  test('validation: empty, too long, bad tag', async () => {
    assert.equal((await alice.post(`/api/songs/${ids.stars}/comments`, { body: '   ' })).status, 400);
    assert.equal((await alice.post(`/api/songs/${ids.stars}/comments`, { body: 'x'.repeat(1001) })).status, 400);
    assert.equal((await alice.post(`/api/songs/${ids.stars}/comments`, { body: 'x'.repeat(1000) })).status, 201);
    const bad = await alice.post(`/api/songs/${ids.stars}/comments`, { body: 'ok', tag: 'spam' });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.details.tag);
  });

  test('author can edit (edited=true) and delete; others 403; admin can edit/delete any', async () => {
    const c = (await alice.post(`/api/songs/${ids.corn}/comments`, { body: 'First draft', tag: 'question' })).body;
    const edit = await alice.patch(`/api/comments/${c.id}`, { body: 'Second draft' });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.body, 'Second draft');
    assert.equal(edit.body.tag, 'question');
    assert.equal(edit.body.edited, true);

    const bobEdit = await bob.patch(`/api/comments/${c.id}`, { body: 'Hacked' });
    assert.equal(bobEdit.status, 403);
    assert.equal((await bob.del(`/api/comments/${c.id}`)).status, 403);

    const adminEdit = await admin.patch(`/api/comments/${c.id}`, { tag: 'tip' });
    assert.equal(adminEdit.status, 200);
    assert.equal(adminEdit.body.tag, 'tip');
    assert.equal(adminEdit.body.author.displayName, 'Alice', 'author unchanged');

    assert.equal((await admin.del(`/api/comments/${c.id}`)).status, 204);
    assert.equal((await alice.del(`/api/comments/${c.id}`)).status, 404);

    const own = (await bob.post(`/api/songs/${ids.corn}/comments`, { body: 'Mine' })).body;
    assert.equal((await bob.del(`/api/comments/${own.id}`)).status, 204);
    assert.equal((await client(t.app).del(`/api/comments/${own.id}`)).status, 401);
  });

  test('admin comment shows author role admin', async () => {
    const c = await admin.post(`/api/songs/${ids.corn}/comments`, { body: 'Remember: 6:00 limit!', tag: 'tip' });
    assert.equal(c.body.author.role, 'admin');
  });

  test('comments are removed with their song (only an admin may delete a song with other people\'s comments)', async () => {
    const s = (await alice.post('/api/songs', soloBody({ title: 'Short-lived' }))).body;
    await alice.post(`/api/songs/${s.id}/comments`, { body: 'my own note' });
    await bob.post(`/api/songs/${s.id}/comments`, { body: 'hello' });
    const refused = await alice.del(`/api/songs/${s.id}`);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /1 comment from other people/);
    assert.equal(t.db.prepare('SELECT count(*) AS n FROM comments WHERE song_id = ?').get(s.id).n, 2, "Bob's comment survives");
    assert.equal((await admin.del(`/api/songs/${s.id}`)).status, 204);
    assert.equal(t.db.prepare('SELECT count(*) AS n FROM comments WHERE song_id = ?').get(s.id).n, 0);
    // with only your own comments, you can delete your song yourself
    const s2 = (await alice.post('/api/songs', soloBody({ title: 'Also short-lived' }))).body;
    await alice.post(`/api/songs/${s2.id}/comments`, { body: 'just me' });
    assert.equal((await alice.del(`/api/songs/${s2.id}`)).status, 204);
    assert.equal(t.db.prepare('SELECT count(*) AS n FROM comments WHERE song_id = ?').get(s2.id).n, 0);
  });

  test('GET /api/admin/comments → newest first, limit', async () => {
    const res = await admin.get('/api/admin/comments?limit=2');
    assert.equal(res.status, 200);
    assert.equal(res.body.comments.length, 2);
    const all = await admin.get('/api/admin/comments');
    const times = all.body.comments.map((c) => c.createdAt);
    assert.deepEqual([...times].sort().reverse(), times);
    assert.equal((await admin.get('/api/admin/comments?limit=0')).status, 400);
  });

  test('GET /api/me/contributions', async () => {
    const carol = await signup(t.app, { displayName: 'Carol' });
    const song = (await carol.post('/api/songs', soloBody({ title: 'Carol Song', showName: 'Carol Show' }))).body;
    await carol.post(`/api/songs/${song.id}/comments`, { body: 'my own comment' });
    const res = await carol.get('/api/me/contributions');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.songs.map((s) => s.title), ['Carol Song']);
    assert.deepEqual(res.body.shows.map((s) => s.name), ['Carol Show']);
    assert.deepEqual(res.body.comments.map((c) => c.body), ['my own comment']);
    assert.equal((await request(t.app).get('/api/me/contributions')).status, 401);
  });
});

describe('comment rate limit', () => {
  test('20 comment writes per minute per user, then 429', async () => {
    const t = makeTestApp({ env: { STAR_COMMENT_LIMIT: '' } });
    try {
      const ids = seedFixture(t.db);
      const u = await signup(t.app);
      for (let i = 0; i < 20; i++) {
        const r = await u.post(`/api/songs/${ids.stars}/comments`, { body: `comment ${i}` });
        assert.equal(r.status, 201);
      }
      const blocked = await u.post(`/api/songs/${ids.stars}/comments`, { body: 'one more' });
      assert.equal(blocked.status, 429);
      const other = await signup(t.app);
      assert.equal((await other.post(`/api/songs/${ids.stars}/comments`, { body: 'different user' })).status, 201);
    } finally {
      t.cleanup();
    }
  });
});

describe('admin users', () => {
  let t;
  let admin;
  let student;
  before(async () => {
    t = makeTestApp();
    admin = await signupAdmin(t.app, t.db, { email: 'head@example.com', displayName: 'Head' });
    student = await signup(t.app, { email: 'student@example.com', displayName: 'Student' });
    await student.post('/api/songs', soloBody({ title: 'Student Song', showName: 'Student Show' }));
  });
  after(() => t.cleanup());

  test('GET /api/admin/users lists users with emails and counts (never hashes)', async () => {
    const res = await admin.get('/api/admin/users');
    assert.equal(res.status, 200);
    const s = res.body.users.find((u) => u.email === 'student@example.com');
    assert.deepEqual(Object.keys(s).sort(), ['commentCount', 'createdAt', 'disabled', 'displayName', 'email', 'festivalSlug', 'id', 'lastLoginAt', 'mustChangePassword', 'role', 'showCount', 'songCount']);
    assert.equal(s.songCount, 1);
    assert.equal(s.showCount, 1);
    assert.equal(s.commentCount, 0);
    assert.equal(s.disabled, false);
    assert.doesNotMatch(JSON.stringify(res.body), /scrypt|password_hash/);
  });

  test('PATCH role / disabled; disabling revokes sessions and blocks login', async () => {
    const promote = await admin.patch(`/api/admin/users/${student.user.id}`, { role: 'admin' });
    assert.equal(promote.status, 200);
    assert.equal(promote.body.role, 'admin');
    assert.equal((await admin.patch(`/api/admin/users/${student.user.id}`, { role: 'user' })).body.role, 'user');
    assert.equal((await admin.patch(`/api/admin/users/${student.user.id}`, { role: 'superuser' })).status, 400);
    assert.equal((await admin.patch(`/api/admin/users/${student.user.id}`, { disabled: 'yes' })).status, 400);
    assert.equal((await admin.patch('/api/admin/users/99999', { disabled: true })).status, 404);

    const dis = await admin.patch(`/api/admin/users/${student.user.id}`, { disabled: true });
    assert.equal(dis.status, 200);
    assert.equal(dis.body.disabled, true);
    assert.equal((await student.get('/api/auth/me')).body.user, null);
    const login = await client(t.app).post('/api/auth/login', { email: 'student@example.com', password: PASSWORD });
    assert.equal(login.status, 403);
    // their songs stay
    const songs = await request(t.app).get('/api/songs?q=student%20song');
    assert.equal(songs.body.total, 1);
    const en = await admin.patch(`/api/admin/users/${student.user.id}`, { disabled: false });
    assert.equal(en.body.disabled, false);
  });

  test('reset-password → temporary password, must change, sessions revoked', async () => {
    const s2 = client(t.app);
    assert.equal((await s2.post('/api/auth/login', { email: 'student@example.com', password: PASSWORD })).status, 200);
    const res = await admin.post(`/api/admin/users/${student.user.id}/reset-password`);
    assert.equal(res.status, 200);
    const temp = res.body.temporaryPassword;
    assert.match(temp, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    assert.equal((await s2.get('/api/auth/me')).body.user, null, 'sessions revoked');
    assert.equal((await client(t.app).post('/api/auth/login', { email: 'student@example.com', password: PASSWORD })).status, 401);
    const c = client(t.app);
    const login = await c.post('/api/auth/login', { email: 'student@example.com', password: temp });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.mustChangePassword, true);
    const change = await c.put('/api/auth/me', { currentPassword: temp, newPassword: 'brand-new-pass' });
    assert.equal(change.status, 200);
    assert.equal(change.body.user.mustChangePassword, false);
  });
});
