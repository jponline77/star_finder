// /api/lookup/itunes and /api/lookup/wikipedia — server-side lookups with a 1 h in-memory cache.
import { Router } from 'express';
import { HttpError } from '../lib/errors.js';
import { Validator } from '../lib/validate.js';
import { findItunesCandidates } from '../lib/itunes.js';
import { lookupWikipedia } from '../lib/wikipedia.js';
import { fold } from '../lib/text.js';

const first = (x) => (Array.isArray(x) ? x[0] : x);

/** @param {import('../app.js').AppContext} ctx */
export function lookupRouter(ctx) {
  const { cache, limiters } = ctx;
  const r = Router();
  r.use(limiters.lookups);

  r.get('/itunes', async (req, res) => {
    const v = new Validator();
    const title = v.string('title', first(req.query.title), { required: true, max: 120, label: 'Title' });
    const show = v.string('show', first(req.query.show), { required: true, max: 120, label: 'Show' });
    v.check();
    const key = `itunes:${fold(title)}|${fold(show)}`;
    let candidates = cache.get(key);
    if (!candidates) {
      try {
        const found = await findItunesCandidates({ title, show }, ctx.fetchImpl, { top: 8 });
        candidates = found.map((c) => ({
          trackId: c.trackId,
          trackName: c.trackName,
          collectionName: c.collectionName,
          artistName: c.artistName,
          previewUrl: c.previewUrl,
          artworkUrl: c.artworkUrl,
          appleMusicUrl: c.appleMusicUrl,
          durationSeconds: c.durationSeconds,
          score: c.score,
        }));
      } catch (err) {
        ctx.log.warn(`iTunes lookup failed: ${err.message}`);
        throw new HttpError(502, "Couldn't reach Apple Music right now — try again in a bit");
      }
      cache.set(key, candidates);
    }
    res.json({ candidates });
  });

  r.get('/wikipedia', async (req, res) => {
    const v = new Validator();
    const name = v.string('name', first(req.query.name), { required: true, max: 120, label: 'Show name' });
    v.check();
    const key = `wiki:${fold(name)}`;
    let result = cache.get(key);
    if (!result) {
      try {
        result = await lookupWikipedia(name, ctx.fetchImpl);
      } catch (err) {
        ctx.log.warn(`Wikipedia lookup failed: ${err.message}`);
        throw new HttpError(502, "Couldn't reach Wikipedia right now — try again in a bit");
      }
      cache.set(key, result);
    }
    res.json(result);
  });

  return r;
}
