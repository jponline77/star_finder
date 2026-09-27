// Relative paths given by the user (STAR_DB_PATH, STAR_UPLOADS_DIR, STAR_MEDIA_DIR, CLI arguments)
// resolve against the directory the user ran the command in. Root scripts run server scripts via
// `npm --prefix server …`, which changes the working directory to server/; npm keeps the original
// directory in INIT_CWD, so `npm start`, `npm run import` and `make-admin` all agree.
import path from 'node:path';

/** The directory the user invoked the command from. */
export function invocationDir(env = process.env) {
  return env.INIT_CWD || process.cwd();
}

/** Resolve `p` (absolute or relative to where the user ran the command). */
export function resolveUserPath(p, env = process.env) {
  return path.resolve(invocationDir(env), p);
}
