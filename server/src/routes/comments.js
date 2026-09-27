// Comments on songs and shows (SPEC §5b). Mounted at /api.
import { Router } from 'express';
import { notFound, forbidden } from '../lib/errors.js';
import { Validator, parseId } from '../lib/validate.js';
import { COMMENT_TAGS } from '../lib/vocab.js';
import { requireUser } from '../middleware.js';
import { listComments, getComment, getCommentRow, getSongRow, findShowRow } from '../repo.js';
import { nowIso } from '../db.js';

/** @param {import('../app.js').AppContext} ctx */
export function commentsRouter(ctx) {
  const { db, limiters } = ctx;
  const r = Router();

  const songTarget = (req) => {
    const id = parseId(req.params.id);
    const row = id ? getSongRow(db, id) : null;
    if (!row) throw notFound('Song not found');
    return row;
  };
  const showTarget = (req) => {
    const row = findShowRow(db, req.params.idOrSlug);
    if (!row) throw notFound('Show not found');
    return row;
  };

  function parseNew(body) {
    const v = new Validator();
    const text = v.string('body', body?.body, { required: true, min: 1, max: 1000, multiline: true, label: 'Comment' });
    const tag = v.oneOf('tag', body?.tag, COMMENT_TAGS, { defaultValue: 'general', label: 'Tag' });
    v.check();
    return { text, tag };
  }

  function insert(userId, { songId = null, showId = null }, { text, tag }) {
    const now = nowIso();
    const id = db
      .prepare('INSERT INTO comments (song_id, show_id, user_id, body, tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(songId, showId, userId, text, tag, now, now).lastInsertRowid;
    return getComment(db, Number(id));
  }

  r.get('/songs/:id/comments', (req, res) => {
    const song = songTarget(req);
    res.json({ comments: listComments(db, { songId: song.id }) });
  });

  r.post('/songs/:id/comments', requireUser, limiters.comments, (req, res) => {
    const song = songTarget(req);
    res.status(201).json(insert(req.user.id, { songId: song.id }, parseNew(req.body)));
  });

  r.get('/shows/:idOrSlug/comments', (req, res) => {
    const show = showTarget(req);
    res.json({ comments: listComments(db, { showId: show.id }) });
  });

  r.post('/shows/:idOrSlug/comments', requireUser, limiters.comments, (req, res) => {
    const show = showTarget(req);
    res.status(201).json(insert(req.user.id, { showId: show.id }, parseNew(req.body)));
  });

  function loadOwn(req, verb) {
    const id = parseId(req.params.id);
    const row = id ? getCommentRow(db, id) : null;
    if (!row) throw notFound('Comment not found');
    if (req.user.role !== 'admin' && row.user_id !== req.user.id) throw forbidden(`You can only ${verb} your own comments`);
    return row;
  }

  r.patch('/comments/:id', requireUser, limiters.comments, (req, res) => {
    const row = loadOwn(req, 'edit');
    const body = req.body ?? {};
    const v = new Validator();
    const text = body.body !== undefined
      ? v.string('body', body.body, { required: true, min: 1, max: 1000, multiline: true, label: 'Comment' })
      : row.body;
    const tag = body.tag !== undefined ? v.oneOf('tag', body.tag, COMMENT_TAGS, { required: true, label: 'Tag' }) : row.tag;
    v.check();
    if (text !== row.body || tag !== row.tag) {
      let now = nowIso();
      if (now <= row.created_at) now = new Date(Date.parse(row.created_at) + 1).toISOString();
      db.prepare('UPDATE comments SET body = ?, tag = ?, updated_at = ? WHERE id = ?').run(text, tag, now, row.id);
    }
    res.json(getComment(db, row.id));
  });

  r.delete('/comments/:id', requireUser, (req, res) => {
    const row = loadOwn(req, 'delete');
    db.prepare('DELETE FROM comments WHERE id = ?').run(row.id);
    res.status(204).end();
  });

  return r;
}
