#!/usr/bin/env node
// Promote an existing user to admin:  npm --prefix server run make-admin -- someone@example.com
// This is the way to make the first admin: the teacher signs up on the site first, then whoever runs
// the server promotes that account. (Nobody's email is verified at sign-up, so check the account
// below really is theirs — e.g. that they could log in with it.)
// Relative STAR_DB_PATH values are resolved from the directory you run the command in.
import fs from 'node:fs';
import { openDb, DEFAULT_DB_PATH } from '../src/db.js';
import { resolveUserPath } from '../src/lib/paths.js';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email || email.startsWith('-')) {
  console.error('Usage: npm --prefix server run make-admin -- someone@example.com');
  process.exit(1);
}
const dbPath = process.env.STAR_DB_PATH ? resolveUserPath(process.env.STAR_DB_PATH) : DEFAULT_DB_PATH;
if (!fs.existsSync(dbPath)) {
  console.error(`❌ No database at ${dbPath} — is STAR_DB_PATH right? (Run \`npm run import\` to create one.)`);
  process.exit(1);
}
const db = openDb(dbPath);
try {
  const user = db.prepare('SELECT id, email, display_name, role, disabled, created_at, last_login_at FROM users WHERE email = ?').get(email);
  const about = (u) => `${u.email} (#${u.id} "${u.display_name}", signed up ${u.created_at}, last login ${u.last_login_at ?? 'never'})`;
  const disabledNote = (u) => (u.disabled ? ' Note: this account is disabled.' : '');
  if (!user) {
    console.error(`❌ No account with email ${email} in ${dbPath} — they need to sign up first.`);
    process.exitCode = 1;
  } else if (user.role === 'admin') {
    console.log(`👑 ${about(user)} is already an admin.${disabledNote(user)}`);
  } else {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    console.log(`👑 ${about(user)} is now an admin.${disabledNote(user)}`);
  }
} finally {
  db.close();
}
