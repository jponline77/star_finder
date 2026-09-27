import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeTestApp, signup, signupAdmin, seedFixture, soloBody } from './helpers.js';

test('public payloads never contain user emails or password hashes', async () => {
  const t = makeTestApp();
  try {
    const ids = seedFixture(t.db);
    const emails = ['secret-alice@example.com', 'secret-bob@example.com', 'secret-admin@example.com'];
    const [alice, bob, admin] = [
      await signup(t.app, { email: emails[0], displayName: 'Alice' }),
      await signup(t.app, { email: emails[1], displayName: 'Bob' }),
      await signupAdmin(t.app, t.db, { email: emails[2], displayName: 'Admin' }),
    ];
    const song = (await alice.post('/api/songs', soloBody({ title: 'Private Test', showName: 'Private Show' }))).body;
    await bob.post(`/api/songs/${song.id}/comments`, { body: 'Nice one' });
    await admin.post('/api/shows/private-show/comments', { body: 'Approved', tag: 'tip' });
    await alice.post(`/api/songs/${ids.corn}/comments`, { body: 'Corny!', tag: 'performed' });

    const urls = [
      '/api/songs', `/api/songs/${song.id}`, `/api/songs/${ids.corn}`, '/api/shows', '/api/shows/private-show',
      `/api/songs/${song.id}/comments`, '/api/shows/private-show/comments', `/api/songs/${ids.corn}/comments`,
      '/api/meta', '/api/stats',
    ];
    for (const url of urls) {
      for (const agent of [request(t.app), alice.agent, admin.agent]) {
        const res = await agent.get(url);
        assert.equal(res.status, 200, url);
        const json = JSON.stringify(res.body);
        for (const e of emails) assert.ok(!json.includes(e), `${url} leaks ${e}`);
        assert.ok(!json.includes('@'), `${url} contains '@'`);
        assert.ok(!/scrypt|password/i.test(json), `${url} leaks password data`);
      }
    }
    // contributions (own) and the admin moderation feed carry no emails either
    for (const [agent, url] of [[alice.agent, '/api/me/contributions'], [admin.agent, '/api/admin/comments']]) {
      const json = JSON.stringify((await agent.get(url)).body);
      assert.ok(!json.includes('@'), `${url} contains '@'`);
    }
    // /api/auth/me shows only your own email
    const me = await bob.get('/api/auth/me');
    assert.equal(me.body.user.email, emails[1]);
    assert.ok(!JSON.stringify(me.body).includes(emails[0]));
    assert.ok(!JSON.stringify(me.body).includes('scrypt'));
  } finally {
    t.cleanup();
  }
});
