// The real server process (src/index.js) and the CLI scripts: listen errors, graceful shutdown,
// --production, relative paths (INIT_CWD), make-admin, import, backup.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { openDb } from '../src/db.js';
import { trustProxyWarning } from '../src/app.js';
import { hashPassword } from '../src/lib/auth.js';
import { backup } from '../scripts/backup.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const XLSX = path.join(SERVER_DIR, 'seed', 'star_spreadsheet.xlsx');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'star-proc-'));
}

/** A port nothing is listening on right now. */
async function freePort() {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

/** Run a node script from server/ (like `npm --prefix server run …`), collecting output. */
function run(args, { env = {}, cwd = SERVER_DIR } = {}) {
  const base = { ...process.env };
  delete base.INIT_CWD;
  delete base.NODE_ENV;
  const child = spawn(process.execPath, args, { cwd, env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { stdout: '', stderr: '' };
  child.stdout.on('data', (d) => { out.stdout += d; });
  child.stderr.on('data', (d) => { out.stderr += d; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, ...out })));
  return { child, out, exited };
}

async function waitFor(predicate, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

const serverEnv = (dir, port, extra = {}) => ({
  PORT: String(port), HOST: '127.0.0.1', STAR_DB_PATH: path.join(dir, 'star.db'),
  STAR_UPLOADS_DIR: path.join(dir, 'uploads'), STAR_MEDIA_DIR: path.join(dir, 'media'), ...extra,
});

/** Start src/index.js and wait until it answers /api/health. */
async function startServer(dir, extra = {}, args = []) {
  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    const proc = run(['src/index.js', ...args], { env: serverEnv(dir, port, extra) });
    // Wait for *this* process to say it's listening before probing the port: under a parallel test
    // run another server (e.g. a supertest app) can grab the port freePort() just released, and a
    // /api/health answer from it would otherwise be mistaken for ours.
    let lostPort = false;
    await waitFor(() => {
      if (proc.child.exitCode !== null) {
        if (/already using that port/.test(proc.out.stderr) && attempt < 3) return (lostPort = true);
        throw new Error(`server exited early:\n${proc.out.stdout}${proc.out.stderr}`);
      }
      return /listening on/.test(proc.out.stdout);
    });
    if (lostPort) continue; // someone took the port in between — pick another
    await waitFor(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
      } catch {
        return false;
      }
    });
    return { ...proc, port };
  }
}

const kill = (proc) => {
  if (proc && proc.child.exitCode === null && proc.child.signalCode === null) proc.child.kill('SIGKILL');
};

describe('server process', () => {
  test('port already in use → a clear error and a non-zero exit (not "listening" + exit 0)', async () => {
    const dir = tmpDir();
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    let proc;
    try {
      proc = run(['src/index.js'], { env: serverEnv(dir, blocker.address().port) });
      const res = await proc.exited;
      assert.equal(res.code, 1);
      assert.match(res.stderr, /another program is already using that port/);
      assert.doesNotMatch(res.stdout, /listening on/);
    } finally {
      kill(proc);
      await new Promise((resolve) => blocker.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('SIGTERM with nothing in flight: exits 0 and closes the database (no WAL left behind)', async () => {
    const dir = tmpDir();
    let proc;
    try {
      proc = await startServer(dir);
      const signup = await fetch(`http://127.0.0.1:${proc.port}/api/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'star-song-finder' },
        body: JSON.stringify({ email: 'wal@example.com', password: 'password-123', displayName: 'Wal' }),
      });
      assert.equal(signup.status, 201);
      assert.ok(fs.existsSync(path.join(dir, 'star.db-wal')), 'WAL in use while running');
      proc.child.kill('SIGTERM');
      const res = await proc.exited;
      assert.equal(res.code, 0, res.stderr);
      assert.match(res.stdout, /Stopped cleanly/);
      assert.ok(!fs.existsSync(path.join(dir, 'star.db-wal')), 'db.close() checkpointed and removed the WAL');
    } finally {
      kill(proc);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('SIGTERM waits for in-flight requests up to STAR_SHUTDOWN_GRACE_MS, then force-closes with exit 1', async () => {
    const dir = tmpDir();
    let proc;
    let socket;
    try {
      proc = await startServer(dir, { STAR_SHUTDOWN_GRACE_MS: '400' });
      // A request whose body never finishes arriving (like a slow upload).
      socket = net.connect(proc.port, '127.0.0.1');
      await new Promise((resolve) => socket.on('connect', resolve));
      socket.on('error', () => {});
      socket.write('POST /api/auth/login HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nX-Requested-With: star-song-finder\r\nContent-Length: 500\r\n\r\n{"email":');
      await new Promise((r) => setTimeout(r, 100));
      const t0 = Date.now();
      proc.child.kill('SIGTERM');
      const res = await proc.exited;
      assert.equal(res.code, 1);
      assert.ok(Date.now() - t0 >= 350, 'waited for the grace period');
      assert.match(res.stderr, /still open after 0\.4s/);
    } finally {
      socket?.destroy();
      kill(proc);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--production works without NODE_ENV (Windows-friendly `npm start`)', async () => {
    const dir = tmpDir();
    let proc;
    try {
      proc = await startServer(dir, {}, ['--production']);
      assert.match(proc.out.stdout, /\(production\)/);
    } finally {
      kill(proc);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('relative STAR_* paths resolve from where the command was run (INIT_CWD), not server/', async () => {
    const dir = tmpDir();
    let proc;
    try {
      proc = await startServer(dir, { INIT_CWD: dir, STAR_DB_PATH: 'data/relative.db', STAR_UPLOADS_DIR: 'up', STAR_MEDIA_DIR: 'med' });
      assert.ok(fs.existsSync(path.join(dir, 'data', 'relative.db')));
      assert.ok(fs.existsSync(path.join(dir, 'up', 'audio')));
      assert.ok(!fs.existsSync(path.join(SERVER_DIR, 'data', 'relative.db')));
      assert.match(proc.out.stdout, new RegExp(`database: ${path.join(dir, 'data', 'relative.db').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    } finally {
      kill(proc);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('startup warns when TRUST_PROXY is on but the port is reachable from anywhere', () => {
    assert.match(trustProxyWarning('true', undefined, 3001), /HOST=127\.0\.0\.1/);
    assert.match(trustProxyWarning('1', '0.0.0.0', 3001), /0\.0\.0\.0/);
    assert.equal(trustProxyWarning('true', '127.0.0.1', 3001), null);
    assert.equal(trustProxyWarning(undefined, undefined, 3001), null);
  });
});

describe('CLI scripts', () => {
  test('make-admin promotes an existing account, shows who it is, and uses paths relative to where it was run', async () => {
    const dir = tmpDir();
    try {
      const db = openDb(path.join(dir, 'star.db'));
      db.prepare("INSERT INTO users (email, display_name, password_hash) VALUES ('teacher@school.ca', 'Ms Smith', ?)").run(await hashPassword('x-password-1'));
      db.close();
      const ok = await run(['scripts/make-admin.js', 'Teacher@School.ca'], { env: { INIT_CWD: dir, STAR_DB_PATH: 'star.db' } }).exited;
      assert.equal(ok.code, 0, ok.stderr);
      assert.match(ok.stdout, /"Ms Smith", signed up .* is now an admin/);
      const check = openDb(path.join(dir, 'star.db'));
      assert.equal(check.prepare("SELECT role FROM users WHERE email = 'teacher@school.ca'").get().role, 'admin');
      check.close();
      const missing = await run(['scripts/make-admin.js', 'nobody@school.ca'], { env: { INIT_CWD: dir, STAR_DB_PATH: 'star.db' } }).exited;
      assert.equal(missing.code, 1);
      assert.match(missing.stderr, /need to sign up first/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('`npm run import -- incoming/new.xlsx` finds the file relative to where it was run; a wrong file fails loudly', async () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(path.join(dir, 'incoming'));
      fs.mkdirSync(path.join(dir, 'seed'));
      fs.copyFileSync(XLSX, path.join(dir, 'incoming', 'new.xlsx'));
      const env = { INIT_CWD: dir };
      const args = ['scripts/import-xlsx.js', '--db', 'star.db', '--seed-dir', 'seed', '--media-dir', 'media', '--uploads-dir', 'uploads', '--quiet'];
      const ok = await run([...args, 'incoming/new.xlsx'], { env }).exited;
      assert.equal(ok.code, 0, ok.stderr);
      assert.match(ok.stdout, new RegExp(`Import complete → ${path.join(dir, 'star.db').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Solos').addRow(['Song']);
      wb.addWorksheet('Duets').addRow(['Song']);
      await wb.xlsx.writeFile(path.join(dir, 'incoming', 'export.xlsx'));
      const bad = await run([...args, 'incoming/export.xlsx'], { env }).exited;
      assert.equal(bad.code, 1);
      assert.match(bad.stderr, /❌ .*downloaded from the website/);
      const db = openDb(path.join(dir, 'star.db'));
      assert.equal(db.prepare('SELECT count(*) AS n FROM songs').get().n, 122, 'nothing deleted');
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('backup: a consistent copy of the live database plus the uploads folder', async () => {
    const dir = tmpDir();
    try {
      const dbPath = path.join(dir, 'data', 'star.db');
      const db = openDb(dbPath); // stays open (WAL mode, like a running server)
      db.prepare("INSERT INTO shows (name, slug) VALUES ('Backup Show', 'backup-show')").run();
      const uploadsDir = path.join(dir, 'uploads');
      fs.mkdirSync(path.join(uploadsDir, 'audio'), { recursive: true });
      fs.mkdirSync(path.join(uploadsDir, '.incoming'), { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, 'audio', 'a.mp3'), 'x');
      fs.writeFileSync(path.join(uploadsDir, '.incoming', 'half.part'), 'x');
      const out = await backup({ dbPath, uploadsDir, destRoot: path.join(dir, 'backups'), now: new Date('2026-09-27T10:00:00Z') });
      db.close();
      assert.equal(out.dir, path.join(dir, 'backups', 'star-2026-09-27T10-00-00Z'));
      assert.equal(out.files, 1);
      assert.ok(fs.existsSync(path.join(out.dir, 'uploads', 'audio', 'a.mp3')));
      assert.ok(!fs.existsSync(path.join(out.dir, 'uploads', '.incoming')), 'unfinished uploads are skipped');
      const copy = openDb(out.dbFile);
      assert.equal(copy.prepare("SELECT count(*) AS n FROM shows WHERE name = 'Backup Show'").get().n, 1);
      copy.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
