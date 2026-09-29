// The pristine record of each hosted game: what upstream shipped, file by file, so G4 (check-manifest) can prove that
// games/<id>/ is upstream's tree — up to the media exception — WITHOUT READING GIT HISTORY.
//
//   node tools/pristine.mjs --check [<id>...]     every record well-formed and equal to its own tree id (no games read)
//   node tools/pristine.mjs --write <id>...       record games/<id>/ AS IT IS ON DISK — only while it is still upstream's
//                                                 bytes, i.e. right after the import and BEFORE tools/media.mjs runs
//                                                 (tools/add-game.mjs calls this at exactly that point)
//   node tools/pristine.mjs --write <id> --from <dir>
//                                                 record from a checkout of the upstream commit instead (a RE-PIN: after
//                                                 a pull, games/<id>/ still holds the processed media of every file the
//                                                 pull did not touch, so its disk is not upstream's tree). The commit
//                                                 recorded is manifests/<id>.json's upstream.commit — update that first.
//
// ⚖ R12/R13 (user, 2026-09-29): the split imports a history-free tree, and nothing in the new repositories may need the
// old one to exist. G4 used to find each game's `git-subtree` squash commit in the history and diff its tree against
// `HEAD:games/<id>`; the squash commits do not survive the import. So the squash's content is RECORDED, once, here:
// games-pristine/<id>.json holds the upstream commit, the upstream TREE ID (git's own hash of the directory — anyone
// holding the upstream repository can check it: `git rev-parse <commit>^{tree}`), and every file's git blob id. The
// record is self-authenticating: `treeIdOf(files)` must equal `upstream.tree`, so a hand-edited listing is a RED.
// The 175 records that existed at the split were generated from the squash commits (their `recorded` block says where);
// a game added later is recorded from disk by `--write` before its media is processed.
//
// Reads files only — no git at all — so it works the same when games/ is a directory of this repository and when it
// is a submodule (S2). `node:` builtins only: the CI `fast` job installs nothing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const PRISTINE_DIR = 'games-pristine';
const HEX40 = /^[0-9a-f]{40}$/;
const MODES = new Set(['100644', '100755', '120000']);

/** git's blob id of `buf` (sha1 of "blob <len>\0" + bytes). */
export const blobId = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

/** An entry as the record spells it: "<blob>" for a 100644 file, "<mode> <blob>" otherwise. */
export const entry = (mode, blob) => (mode === '100644' ? blob : `${mode} ${blob}`);
export const parseEntry = (e) => { const p = e.split(' '); return p.length === 1 ? { mode: '100644', blob: p[0] } : { mode: p[0], blob: p[1] }; };

/**
 * git's tree id of a flat listing {<posix path>: entry} — the same id `git rev-parse <commit>^{tree}` prints for the
 * same files. Entries sort by name, a directory's name compared with a trailing '/' (git's order).
 */
export function treeIdOf(files) {
  const root = new Map();
  for (const [rel, e] of Object.entries(files)) {
    const parts = rel.split('/');
    let dir = root;
    for (const d of parts.slice(0, -1)) { if (!dir.has(d + '/')) dir.set(d + '/', new Map()); dir = dir.get(d + '/'); }
    dir.set(parts[parts.length - 1], parseEntry(e));
  }
  const hash = (dir) => {
    const items = [...dir.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const body = Buffer.concat(items.map(([k, v]) => {
      const isDir = v instanceof Map;
      const name = isDir ? k.slice(0, -1) : k;
      const id = isDir ? hash(v) : v.blob;
      return Buffer.concat([Buffer.from(`${isDir ? '40000' : v.mode} ${name}\0`), Buffer.from(id, 'hex')]);
    }));
    return crypto.createHash('sha1').update(`tree ${body.length}\0`).update(body).digest('hex');
  };
  return hash(root);
}

/** The listing of a directory on disk, as a record spells it. `.git` (a file or a directory) is not the game's. */
export function listDisk(dir) {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = path.join(dir, r);
      if (e.isSymbolicLink()) out[r] = entry('120000', blobId(Buffer.from(fs.readlinkSync(p))));
      else if (e.isDirectory()) walk(r);
      else if (e.isFile()) out[r] = entry(fs.statSync(p).mode & 0o111 ? '100755' : '100644', blobId(fs.readFileSync(p)));
    }
  };
  walk('');
  return out;
}

/** What differs between a recorded listing and a live one: [{status: A|D|M|T, rel}], sorted (git diff-tree's letters). */
export function diffListings(recorded, live) {
  const out = [];
  for (const [rel, e] of Object.entries(live)) {
    if (!(rel in recorded)) { out.push({ status: 'A', rel }); continue; }
    if (recorded[rel] === e) continue;
    const a = parseEntry(recorded[rel]), b = parseEntry(e);
    out.push({ status: (a.mode === '120000') !== (b.mode === '120000') ? 'T' : 'M', rel });
  }
  for (const rel of Object.keys(recorded)) if (!(rel in live)) out.push({ status: 'D', rel });
  return out.sort((x, y) => (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0));
}

export const recordPath = (id, root = ROOT) => path.join(root, PRISTINE_DIR, `${id}.json`);
export function readRecord(id, root = ROOT) {
  const f = recordPath(id, root);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

/** A record's own problems (never reads the game): shape, and the listing equal to the tree id it claims. */
export function recordProblems(id, rec) {
  const p = [];
  if (!rec) return [`${PRISTINE_DIR}/${id}.json does not exist`];
  if (rec.id !== id) p.push(`id ${JSON.stringify(rec.id)} is not the file's name`);
  if (!rec.upstream || !HEX40.test(rec.upstream.commit || '') || !HEX40.test(rec.upstream.tree || '')) p.push('upstream.commit and upstream.tree must be 40-hex ids');
  if (!rec.recorded || typeof rec.recorded.from !== 'string') p.push('recorded.from must say where the record came from');
  const files = rec.files;
  if (!files || typeof files !== 'object' || !Object.keys(files).length) return [...p, 'files must be a non-empty object'];
  for (const [rel, e] of Object.entries(files)) {
    const { mode, blob } = parseEntry(String(e));
    if (!MODES.has(mode) || !HEX40.test(blob || '') || rel.startsWith('/') || rel.split('/').some((s) => !s || s === '.' || s === '..')) p.push(`files[${JSON.stringify(rel)}] = ${JSON.stringify(e)} is not "<blob>" / "<mode> <blob>" under a relative path`);
  }
  if (!p.length && treeIdOf(files) !== rec.upstream.tree) p.push(`the listing's tree id ${treeIdOf(files)} is not upstream.tree ${rec.upstream.tree} — the record was edited, or is not the tree it names`);
  return p;
}

/** One record, serialised one file per line (a re-pin's diff reads file by file). */
export function recordText(rec) {
  const { files, ...head } = rec;
  const keys = Object.keys(files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const h = JSON.stringify(head, null, 2).slice(0, -2);
  return `${h},\n  "files": {\n${keys.map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(files[k])}`).join(',\n')}\n  }\n}\n`;
}

/** Records games/<id>/ from disk. The caller vouches that the directory is upstream's `commit`, byte for byte. */
export function writeRecordFromDisk(id, commit, { root = ROOT, gamesDir = path.join(root, 'games'), dirName = id, from, date = new Date().toISOString().slice(0, 10) } = {}) {
  const files = listDisk(path.join(gamesDir, dirName));
  const rec = { id, upstream: { commit, tree: treeIdOf(files) }, recorded: { from: from || `games/${id}/ on disk right after its import, before tools/media.mjs (tools/pristine.mjs --write)`, date } };
  fs.mkdirSync(path.join(root, PRISTINE_DIR), { recursive: true });
  fs.writeFileSync(recordPath(id, root), recordText({ ...rec, files }));
  return rec;
}

async function main() {
  const argv = process.argv.slice(2);
  let from = null;
  const fi = argv.indexOf('--from');
  if (fi >= 0) { from = argv[fi + 1]; argv.splice(fi, 2); if (!from || from.startsWith('--')) { console.error('--from needs a directory'); return 2; } }
  const flags = argv.filter((x) => x.startsWith('--')), ids0 = argv.filter((x) => !x.startsWith('--'));
  const unknown = flags.filter((f) => !['--check', '--write'].includes(f));
  if (unknown.length || flags.length !== 1 || (from && (flags[0] !== '--write' || ids0.length !== 1))) { console.error('usage: node tools/pristine.mjs --check [<id>...] | --write <id>... | --write <id> --from <upstream checkout>'); return 2; }
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/index.json'), 'utf8')).map((g) => g.id);
  if (flags[0] === '--write') {
    if (!ids0.length) { console.error('--write needs the ids to record'); return 2; }
    for (const id of ids0) {
      const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', `${id}.json`), 'utf8'));
      const r = from
        ? writeRecordFromDisk(id, m.upstream.commit, { gamesDir: path.dirname(path.resolve(from)), dirName: path.basename(path.resolve(from)), from: `a checkout of upstream ${m.upstream.commit} (tools/pristine.mjs --write --from)` })
        : writeRecordFromDisk(id, m.upstream.commit);
      console.log(`recorded ${PRISTINE_DIR}/${id}.json: upstream ${r.upstream.commit.slice(0, 9)}, tree ${r.upstream.tree}`);
    }
    return 0;
  }
  const ids = ids0.length ? ids0 : roster;
  let red = 0;
  for (const id of ids) {
    const p = recordProblems(id, readRecord(id));
    if (p.length) { red++; console.log(`RED   ${id}: ${p.join('; ')}`); }
  }
  // the set, both ways: a game without a record, and a record without a game
  const have = fs.existsSync(path.join(ROOT, PRISTINE_DIR)) ? fs.readdirSync(path.join(ROOT, PRISTINE_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  const orphans = ids0.length ? [] : have.filter((x) => !roster.includes(x));
  for (const o of orphans) { red++; console.log(`RED   ${PRISTINE_DIR}/${o}.json names no game in manifests/index.json`); }
  console.log(`pristine records: ${ids.length} checked, ${red} RED`);
  return red ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
