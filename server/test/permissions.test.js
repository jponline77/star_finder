import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeTestApp, client, signup, signupAdmin, seedFixture, soloBody, MP3 } from './helpers.js';

describe('permissions', () => {
  let t;
  let ids;
  let alice;
  let bob;
  let admin;
  let aliceSong;
  let aliceShow;
  before(async () => {
    t = makeTestApp();
    ids = seedFixture(t.db);
    alice = await signup(t.app, { email: 'alice@example.com', displayName: 'Alice' });
    bob = await signup(t.app, { email: 'bob@example.com', displayName: 'Bob' });
    admin = await signupAdmin(t.app, t.db, { email: 'admin@example.com', displayName: 'Ms Admin' });
    aliceSong = (await alice.post('/api/songs', soloBody({ title: "Alice's Song" }))).body;
    aliceShow = (await alice.post('/api/shows', { name: "Alice's Show" })).body;
  });
  after(() => t.cleanup());

  test('not logged in → 401 "Please log in first" on any write', async () => {
    const anon = client(t.app);
    const checks = [
      anon.post('/api/songs', soloBody()),
      anon.put(`/api/songs/${aliceSong.id}`, soloBody()),
      anon.del(`/api/songs/${aliceSong.id}`),
      anon.post('/api/shows', { name: 'Nope' }),
      anon.put(`/api/shows/${aliceShow.id}`, { name: 'Nope' }),
      anon.del(`/api/shows/${aliceShow.id}`),
      anon.post(`/api/songs/${aliceSong.id}/comments`, { body: 'hi' }),
      anon.upload(`/api/songs/${aliceSong.id}/audio`, MP3, 'a.mp3', 'audio/mpeg'),
    ];
    for (const res of await Promise.all(checks)) {
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'Please log in first');
    }
  });

  test("user B can't edit/delete user A's song → 403", async () => {
    const put = await bob.put(`/api/songs/${aliceSong.id}`, soloBody({ title: 'Hijacked' }));
    assert.equal(put.status, 403);
    assert.equal(put.body.error, 'You can only edit songs you added');
    assert.equal((await bob.del(`/api/songs/${aliceSong.id}`)).status, 403);
    assert.equal((await bob.upload(`/api/songs/${aliceSong.id}/audio`, MP3, 'a.mp3')).status, 403);
    assert.equal((await bob.del(`/api/songs/${aliceSong.id}/audio`)).status, 403);
  });

  test('owner can edit own song', async () => {
    const put = await alice.put(`/api/songs/${aliceSong.id}`, soloBody({ title: "Alice's Song", notes: 'Updated by me' }));
    assert.equal(put.status, 200);
    assert.equal(put.body.notes, 'Updated by me');
  });

  test("regular user can't edit a spreadsheet song; admin can (source stays spreadsheet)", async () => {
    const body = { kind: 'solo', title: 'Stars', showId: ids.lesMis, genre: 'Drama', subGenre: 'Reflective', lengthSeconds: 205, parts: [{ character: 'Javert', vocalRange: 'Baritone' }] };
    const res = await alice.put(`/api/songs/${ids.stars}`, body);
    assert.equal(res.status, 403);
    assert.equal((await alice.del(`/api/songs/${ids.stars}`)).status, 403);
    const ok = await admin.put(`/api/songs/${ids.stars}`, body);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.subGenre, 'Reflective');
    assert.equal(ok.body.source, 'spreadsheet');
    assert.equal(ok.body.createdBy, null);
  });

  test("admin can edit/delete anyone's song", async () => {
    const song = (await bob.post('/api/songs', soloBody({ title: "Bob's Song" }))).body;
    const put = await admin.put(`/api/songs/${song.id}`, soloBody({ title: "Bob's Song (fixed)" }));
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.createdBy, { id: bob.user.id, displayName: 'Bob' }, 'creator unchanged');
    assert.equal((await admin.del(`/api/songs/${song.id}`)).status, 204);
  });

  test("shows: user B can't edit A's show; A and admin can; spreadsheet shows admin-only", async () => {
    const res = await bob.put(`/api/shows/${aliceShow.id}`, { description: 'hacked' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'You can only edit shows you added');
    assert.equal((await bob.del(`/api/shows/${aliceShow.id}`)).status, 403);
    assert.equal((await alice.put(`/api/shows/${aliceShow.id}`, { description: 'Mine!' })).status, 200);
    assert.equal((await admin.put(`/api/shows/${aliceShow.id}`, { year: 2001 })).status, 200);
    assert.equal((await alice.put(`/api/shows/${ids.shrek}`, { year: 2008 })).status, 403);
    const adminEdit = await admin.put(`/api/shows/${ids.shrek}`, { year: 2008 });
    assert.equal(adminEdit.status, 200);
    assert.equal(adminEdit.body.year, 2008);
    assert.equal(adminEdit.body.source, 'spreadsheet');
  });

  test('any logged-in user can add songs and shows', async () => {
    assert.equal((await bob.post('/api/shows', { name: 'Bobs Big Show' })).status, 201);
    assert.equal((await bob.post('/api/songs', soloBody({ title: 'Bob Solo', showName: 'Bobs Big Show' }))).status, 201);
  });

  test('admin endpoints: anonymous 401, non-admin 403 "Admins only"', async () => {
    assert.equal((await request(t.app).get('/api/admin/users')).status, 401);
    const res = await alice.get('/api/admin/users');
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'Admins only');
    assert.equal((await alice.get('/api/admin/comments')).status, 403);
    assert.equal((await alice.patch(`/api/admin/users/${bob.user.id}`, { role: 'admin' })).status, 403);
    assert.equal((await alice.post(`/api/admin/users/${bob.user.id}/reset-password`)).status, 403);
  });

  test('last-admin protection and no self-disable', async () => {
    const demoteSelf = await admin.patch(`/api/admin/users/${admin.user.id}`, { role: 'user' });
    assert.equal(demoteSelf.status, 409);
    const disableSelf = await admin.patch(`/api/admin/users/${admin.user.id}`, { disabled: true });
    assert.equal(disableSelf.status, 409);
    // promote Bob, then the first admin may step down; Bob is then the last admin
    const promote = await admin.patch(`/api/admin/users/${bob.user.id}`, { role: 'admin' });
    assert.equal(promote.status, 200);
    assert.equal(promote.body.role, 'admin');
    const stepDown = await admin.patch(`/api/admin/users/${admin.user.id}`, { role: 'user' });
    assert.equal(stepDown.status, 200);
    const cannot = await bob.patch(`/api/admin/users/${bob.user.id}`, { role: 'user' });
    assert.equal(cannot.status, 409);
    // restore
    assert.equal((await bob.patch(`/api/admin/users/${admin.user.id}`, { role: 'admin' })).status, 200);
    assert.equal((await admin.patch(`/api/admin/users/${bob.user.id}`, { role: 'user' })).status, 200);
  });
});
