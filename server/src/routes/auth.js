// /api/auth — signup, login, logout, me (SPEC §5a).
import { Router } from 'express';
import { HttpError, badRequest } from '../lib/errors.js';
import { Validator, normalizeEmail, validateDisplayName, validatePassword } from '../lib/validate.js';
import {
  hashPassword, verifyPassword, dummyHash, createSession, setSessionCookie, clearSessionCookie, tempPasswordExpired,
} from '../lib/auth.js';
import { requireUser } from '../middleware.js';
import { toUser, getUserRow, getUserRowByEmail } from '../repo.js';
import { nowIso } from '../db.js';

const LOGIN_FAILED = 'Email or password is incorrect';
const ACCOUNT_DISABLED = 'This account has been disabled — talk to your teacher';
const TEMP_PASSWORD_EXPIRED = 'Your temporary password has expired — ask your teacher for a new one';
const WRONG_CURRENT = 'Your current password is incorrect';

const wantsPasswordChange = (body) => body && body.newPassword !== undefined && body.newPassword !== null && body.newPassword !== '';

/** @param {import('../app.js').AppContext} ctx */
export function authRouter(ctx) {
  const { db, limiters } = ctx;
  const r = Router();

  // Only failed "already exists" answers count toward signupConflicts (it slows email enumeration).
  r.post('/signup', limiters.signup, limiters.signupConflicts, async (req, res) => {
    const body = req.body ?? {};
    const v = new Validator();
    const email = normalizeEmail(v, body.email);
    const password = validatePassword(v, body.password);
    const displayName = validateDisplayName(v, body.displayName);
    v.check();
    if (getUserRowByEmail(db, email)) throw new HttpError(409, 'An account with that email already exists', { email: 'An account with that email already exists' });
    const hash = await hashPassword(password);
    // Always a regular user: nobody has proven they own this email address, so being listed in
    // STAR_ADMIN_EMAILS must not make the account an admin (see applyAdminEmails / make-admin).
    let id;
    try {
      id = db
        .prepare("INSERT INTO users (email, display_name, password_hash, role, last_login_at) VALUES (?, ?, ?, 'user', ?)")
        .run(email, displayName, hash, nowIso()).lastInsertRowid;
    } catch (err) {
      if (String(err?.code).startsWith('SQLITE_CONSTRAINT')) throw new HttpError(409, 'An account with that email already exists', { email: 'An account with that email already exists' });
      throw err;
    }
    const token = createSession(db, Number(id));
    setSessionCookie(req, res, token);
    res.status(201).json({ user: toUser(getUserRow(db, Number(id))) });
  });

  r.post('/login', limiters.login, async (req, res) => {
    const body = req.body ?? {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
      const details = {};
      if (!email) details.email = 'Email is required';
      if (!password) details.password = 'Password is required';
      throw badRequest('Please enter your email and password', details);
    }
    if (password.length > 200 || email.length > 254) {
      await verifyPassword('x', await dummyHash());
      throw new HttpError(401, LOGIN_FAILED);
    }
    const user = getUserRowByEmail(db, email);
    const ok = await verifyPassword(password, user ? user.password_hash : await dummyHash());
    if (!user || !ok) throw new HttpError(401, LOGIN_FAILED);
    if (user.disabled) throw new HttpError(403, ACCOUNT_DISABLED);
    if (tempPasswordExpired(user)) throw new HttpError(403, TEMP_PASSWORD_EXPIRED);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
    const token = createSession(db, user.id);
    setSessionCookie(req, res, token);
    res.json({ user: toUser(getUserRow(db, user.id)) });
  });

  r.post('/logout', (req, res) => {
    if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    clearSessionCookie(req, res);
    res.status(204).end();
  });

  r.get('/me', (req, res) => {
    res.json({ user: req.user ? toUser(req.user) : null });
  });

  // Failed current-password checks are rate limited per account like logins (a borrowed session
  // must not be able to guess the password at the general write rate).
  const passwordCheckLimit = (req, res, next) => (wantsPasswordChange(req.body) ? limiters.passwordCheck(req, res, next) : next());

  r.put('/me', requireUser, passwordCheckLimit, async (req, res) => {
    const body = req.body ?? {};
    const v = new Validator();
    const updates = {};
    if (body.displayName !== undefined) updates.displayName = validateDisplayName(v, body.displayName);
    let newHash = null;
    if (wantsPasswordChange(body)) {
      const newPassword = validatePassword(v, body.newPassword, 'newPassword');
      if (typeof body.currentPassword !== 'string' || body.currentPassword === '') {
        v.error('currentPassword', 'Enter your current password to change it');
      } else if (newPassword !== null && newPassword === body.currentPassword) {
        // e.g. keeping the temporary password an admin read out in class
        v.error('newPassword', 'Choose a new password that is different from your current one');
      }
      v.check();
      const ok = body.currentPassword.length <= 200 && await verifyPassword(body.currentPassword, req.user.password_hash);
      if (!ok) {
        res.locals.failedPasswordCheck = true;
        throw badRequest(WRONG_CURRENT, { currentPassword: WRONG_CURRENT });
      }
      newHash = await hashPassword(newPassword);
    }
    v.check();
    db.transaction(() => {
      if (updates.displayName) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(updates.displayName, req.user.id);
      if (newHash) {
        db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, temp_password_expires_at = NULL WHERE id = ?').run(newHash, req.user.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.sessionHash);
      }
    })();
    res.json({ user: toUser(getUserRow(db, req.user.id)) });
  });

  return r;
}
