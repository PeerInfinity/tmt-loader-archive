// Gate G4b: the manifest is a PIN, games/<id>/index.html is the source. Parses the live index with
// loader/interpret.mjs and fails on drift from manifest.load.scripts / modFiles / modFilesPrefix / external; also
// checks the vendored files' sha256, that renderOnly ⊆ scripts, and that games/<id>/ is PRISTINE at the upstream
// commit (its files equal the recorded upstream listing games-pristine/<id>.json, which names manifest.upstream.commit;
// tools/pristine.mjs — read from the files, never from git history) — up to the media exception: processed images and audio, modified in place (docs/add-a-game.md; tools/media.mjs).
// load.known (L2b, hand-kept): the declared allowances must EQUAL what the tree contains — missingScripts = the
// index-named local scripts (static and modFiles) absent under games/<id>/; missingAssets = the index-named local
// assets (a relative `src`/`href` in the entry document whose path ends in an asset extension) absent under
// games/<id>/, compared CASE-SENSITIVELY as a web server does; externalHosts = the hosts of absolute http(s) asset URLs
// (image/audio/video/font extension) in index.html and js/** (knownFromTree below).
//   node check-manifest.mjs [<id>...]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { interpret, executionOrder, scriptNames, modFilePaths, LOADER_RE } from '../../loader/interpret.mjs';
import { REPO, GAMES, parseArgs, readManifest, sha256hex, writeJSON } from './lib.mjs';
import { runNode } from './run.mjs';
import { classify } from '../media-lib.mjs';
import { checkMedia } from '../media.mjs';
import { readRecord, recordProblems, listDisk, treeIdOf, diffListings, PRISTINE_DIR } from '../pristine.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a) => [...new Set(a)].sort();

// An absolute http(s) URL in source text; the path must end in an asset extension (query/hash ignored). Excluded, by
// construction: links in text (discord.gg, github.com, wikipedia — no asset extension), extensionless image URLs (stock
// TMT's js/Demo images.beano.com), and the hosts of every manifest load.external URL (vendored or dropped).
const URL_RE = /https?:\/\/[^\s"'`()<>\\,;]+/gi;
const ASSET_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|mp3|ogg|oga|wav|m4a|flac|aac|opus|mp4|webm|woff2?|ttf|otf|eot)$/i;
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.isFile() ? [path.join(dir, e.name)] : [])) : []);

// A relative asset reference in markup: `src="…"` / `href="…"`, no scheme, not protocol-relative, not a data: URI, and
// not ROOT-absolute (`/favicon.ico` names the site's root, not the game's directory — the-challenge-tree has one).
// Comments are stripped first: zavrsni-rad names a `discord.png` it does not ship inside `<!-- … -->`, which no browser
// requests — the first version of this scan read it and would have reddened a game that loads cleanly.
const ATTR_RE = /\b(?:src|href)\s*=\s*(["'])([^"']*)\1/gi;
/** Does `rel` exist under `root` with EXACTLY this case? `fs.existsSync` answers for the disk, and a case-insensitive
 *  disk (Windows, macOS) would say yes to `mNote.png` when only `mnote.png` is there — the very defect this finds. */
function existsExact(root, rel) {
  let dir = root;
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return false;  // normalised away above; a path that still climbs is not the game's
    let names; try { names = fs.readdirSync(dir); } catch { return false; }
    if (!names.includes(part)) return false;
    dir = path.join(dir, part);
  }
  return true;
}
/** The entry document's own local asset references that the tree does not hold (sorted, manifest-relative). */
export function missingAssetsOf(root, entry = 'index.html') {
  const html = fs.readFileSync(path.join(root, entry), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  for (const m of html.matchAll(ATTR_RE)) {
    const raw = m[2].trim();
    if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('/') || raw.startsWith('#')) continue;
    let rel; try { rel = decodeURI(raw.split(/[?#]/)[0]); } catch { continue; }
    rel = path.posix.normalize(path.posix.join(path.posix.dirname(entry), rel)).replace(/^\.\//, '');
    if (!ASSET_EXT_RE.test(rel) || rel.startsWith('../')) continue;
    if (!existsExact(root, rel)) out.push(rel);
  }
  return sorted(out);
}

/** What load.known must equal, measured from the tree: {missingScripts, missingAssets, externalHosts, hostFiles}. */
export function knownFromTree(id, m, plan, modFiles) {
  const root = path.join(REPO, 'games', id);
  const { static: statics, slot } = executionOrder(plan);
  // loader.js is not in the list: the loader fetches its source (a loader input, never skipped)
  const named = [...statics.filter((x) => x.src != null && !x.vendor).map((x) => x.src), ...modFilePaths(slot, modFiles)];
  const missingScripts = sorted(named.filter((f) => !fs.existsSync(path.join(root, f))));
  const excluded = new Set(Object.keys(m.load.external || {}).map((u) => { try { return new URL(u.startsWith('//') ? `https:${u}` : u).hostname; } catch { return null; } }));
  const hostFiles = {};
  for (const f of [path.join(root, m.entry || 'index.html'), ...walk(path.join(root, 'js'))]) {
    const text = fs.readFileSync(f, 'latin1');
    for (const u of text.match(URL_RE) || []) {
      let url; try { url = new URL(u); } catch { continue; }
      if (!ASSET_EXT_RE.test(url.pathname) || excluded.has(url.hostname)) continue;
      (hostFiles[url.hostname] ||= new Set()).add(path.relative(root, f));
    }
  }
  const missingAssets = missingAssetsOf(root, m.entry || 'index.html');
  return { missingScripts, missingAssets, externalHosts: sorted(Object.keys(hostFiles)), hostFiles: Object.fromEntries(Object.entries(hostFiles).map(([h, fs_]) => [h, [...fs_].sort()])) };
}

export function checkManifest(id, { boot = true } = {}) {
  const m = readManifest(id);
  const root = path.join(REPO, 'games', id);
  const problems = [];
  const html = fs.readFileSync(path.join(root, m.entry || 'index.html'), 'utf8');
  let plan = interpret(html, m);
  const slot0 = executionOrder(plan).slot;
  if (slot0) plan = interpret(html, m, { loaderSource: fs.readFileSync(path.join(root, slot0.loader), 'utf8') });
  const { slot } = executionOrder(plan);

  // scripts: the pin lists loader.js where the plan has the slot
  const liveScripts = scriptNames(plan).map((s) => (s === '<modFiles>' ? slot.loader : s));
  if (!same(liveScripts, m.load.scripts)) problems.push({ field: 'load.scripts', manifest: m.load.scripts, live: liveScripts });
  const liveExternal = {};
  for (const s of plan.scripts) if (s.vendor) liveExternal[s.vendor.url] = 'vendor';
  for (const l of plan.links) if (l.external) liveExternal[l.external] = l.verdict;
  for (const u of plan.dropped) liveExternal[u] = 'drop';
  if (!same(Object.keys(liveExternal).sort(), Object.keys(m.load.external).sort())) problems.push({ field: 'load.external', manifest: m.load.external, live: liveExternal });
  if ((slot ? slot.prefix : null) !== (m.load.modFilesPrefix ?? null) && !(slot == null && !m.load.modFiles.length)) problems.push({ field: 'load.modFilesPrefix', manifest: m.load.modFilesPrefix, live: slot && slot.prefix });
  for (const r of m.load.renderOnly) if (!m.load.scripts.includes(r)) problems.push({ field: 'load.renderOnly', notInScripts: r });
  if (m.load.scripts.some((s) => LOADER_RE.test(s)) !== !!slot) problems.push({ field: 'loader.js', manifestHasLoader: !slot, live: !!slot });

  // vendor: every 'vendor' external has a path whose bytes match the pinned sha256
  const vendor = {};
  for (const [url, verdict] of Object.entries(m.load.external)) {
    if (verdict !== 'vendor') continue;
    const v = m.load.vendor[url];
    if (!v || !v.path) { problems.push({ field: 'load.vendor', url, error: 'no path' }); continue; }
    const f = path.join(REPO, v.path);
    const sha = fs.existsSync(f) ? sha256hex(fs.readFileSync(f)) : null;
    vendor[v.path] = sha;
    if (sha !== v.sha256) problems.push({ field: 'load.vendor', url, path: v.path, manifest: v.sha256, live: sha });
  }

  // modFiles: read from the live modInfo in a Node boot
  let modFiles = null;
  if (boot) {
    const r = runNode(id, { ticks: 0 });
    if (!r.ok) problems.push({ field: 'boot', error: `${r.failed_at}: ${r.error}` });
    modFiles = r.modFiles ?? [];
    if (!same(modFiles, m.load.modFiles)) problems.push({ field: 'load.modFiles', manifest: m.load.modFiles, live: modFiles });
    // a missing file the manifest declares in load.known.missingScripts is the game's (checked for equality below)
    const declaredMissing = new Set(m.load.known?.missingScripts || []);
    const fileErrors = (r.file_errors || []).filter((e) => !(e.error === 'missing' && declaredMissing.has(e.file)));
    if (fileErrors.length) problems.push({ field: 'boot.file_errors', live: fileErrors });
  }

  // load.known: optional, hand-kept; every key is checked against the tree (equality, never a count)
  const tree = knownFromTree(id, m, plan, modFiles ?? m.load.modFiles);
  const known = m.load.known;
  if (known !== undefined) {
    const keys = ['missingScripts', 'missingAssets', 'errorsBeforeReady', 'externalHosts'];
    if (known === null || typeof known !== 'object' || Array.isArray(known)) problems.push({ field: 'load.known', error: 'must be an object' });
    else {
      for (const k of Object.keys(known)) if (!keys.includes(k)) problems.push({ field: `load.known.${k}`, error: 'unknown key' });
      if ('errorsBeforeReady' in known && !(typeof known.errorsBeforeReady === 'string' && known.errorsBeforeReady.trim())) problems.push({ field: 'load.known.errorsBeforeReady', error: 'a non-empty reason string, or absent' });
      for (const k of ['missingScripts', 'missingAssets', 'externalHosts']) if (k in known && !(Array.isArray(known[k]) && known[k].every((x) => typeof x === 'string'))) problems.push({ field: `load.known.${k}`, error: 'an array of strings, or absent' });
    }
  }
  for (const k of ['missingScripts', 'missingAssets', 'externalHosts']) {
    const declared = sorted((known && Array.isArray(known[k]) && known[k]) || []);
    if (!same(declared, tree[k])) problems.push({ field: `load.known.${k}`, drift: true, manifest: declared, live: tree[k], declaredNotInTree: declared.filter((x) => !tree[k].includes(x)), inTreeNotDeclared: tree[k].filter((x) => !declared.includes(x)), ...(k === 'externalHosts' ? { files: tree.hostFiles } : {}) });
  }

  // pristine: games/<id>/ ON DISK == the recorded upstream listing (games-pristine/<id>.json), which names the upstream
  // commit. ⚖ R12/R13 (2026-09-29): this used to read the git-subtree squash commit out of the HISTORY and diff its tree
  // against `HEAD:games/<id>`; a history-free import has no squash, and through a submodule `HEAD:games/<id>` does not
  // resolve. The record holds what the squash held (every file's blob id, and the tree id it hashes to), and the tree is
  // read from the FILES — no git object is ever looked up, so both layouts (games/ a directory of this repo, or a
  // submodule) read the same. S1T's equivalence: this verdict equals the squash-based one on all 175 games.
  const rec = readRecord(id, REPO);
  const recProblems = recordProblems(id, rec);
  const live = fs.existsSync(root) ? listDisk(root) : {};
  const treeNow = Object.keys(live).length ? treeIdOf(live) : null;
  const upstreamCommit = rec?.upstream?.commit ?? null;
  if (recProblems.length) problems.push({ field: 'games pristine (record)', record: `${PRISTINE_DIR}/${id}.json`, errors: recProblems.slice(0, 20) });
  else if (upstreamCommit !== m.upstream.commit) problems.push({ field: 'upstream.commit', manifest: m.upstream.commit, recorded: upstreamCommit });
  // ⚖ the media exception (user, 2026-09-22; docs/add-a-game.md): the tree may differ from upstream's in MEDIA FILES
  // ONLY — each a modification in place (same path; nothing added, deleted or renamed) of an in-scope image or audio
  // file that is now processed. Anything else — one byte of code, markup or a licence — is still `games pristine`.
  let media = null;
  if (!recProblems.length && treeNow !== rec.upstream.tree) {
    const changed = diffListings(rec.files, live);
    const notMedia = changed.filter((c) => c.status !== 'M' || !classify(c.rel));
    if (notMedia.length) problems.push({ field: 'games pristine', treeNow, treeUpstream: rec.upstream.tree, notMedia: notMedia.slice(0, 20) });
    else { const mc = checkMedia([id]); if (!mc.ok) problems.push({ field: 'games pristine (media)', raw: mc.problems.slice(0, 20) }); }
    media = changed.length;
  }
  // the working tree against its own commit — in whichever repository holds games/ (`git -C games`: the outer repo while
  // games/ is a directory, the submodule once it is one). Skipped, and said so, where there is no git at all.
  let dirty = null;
  try { dirty = execFileSync('git', ['-C', path.join(REPO, 'games'), 'status', '--porcelain', '--', id], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { dirty = null; }
  if (dirty) problems.push({ field: 'games pristine (working tree)', dirty });
  // headless.idleHash.census — RETIRED with Q6 (2026-09-22). It recorded the census's hash beside ours where the two
  // disagreed; its one instance (the-collab-tree-lun4-r, `cheese.cycle`) was the census boot pre-clearing
  // `player.offTime`, fixed at the census, and the block and its tool (census-hash-diff.mjs) went with it. A block
  // that reappears is refused rather than silently carried: a new disagreement is a census bug to fix at the census.
  if (m.headless && m.headless.idleHash && m.headless.idleHash.census !== undefined) problems.push({ field: 'headless.idleHash.census', error: 'retired (Q6): fix the census boot instead of annotating the manifest' });
  if ((m.patches || []).length) problems.push({ field: 'patches', note: 'L1 expects none', live: m.patches });
  // auto (A1; C1): optional per-game automation table, a JSON DOCUMENT outside the subtree prefix (games-auto/<id>.json),
  // fetched by the page and validated by the loader against its own schema (docs/automation.md, "The table (measured defaults)")
  if (m.auto !== undefined) {
    if (typeof m.auto !== 'string' || m.auto !== `games-auto/${id}.json`) problems.push({ field: 'auto', error: `must be "games-auto/${id}.json"`, live: m.auto });
    else if (!fs.existsSync(path.join(REPO, m.auto))) problems.push({ field: 'auto', error: 'file missing', live: m.auto });
  }

  return { id, ok: problems.length === 0, known: known ?? null, knownTree: { missingScripts: tree.missingScripts, missingAssets: tree.missingAssets, externalHosts: tree.externalHosts }, mediaFiles: media, scripts: liveScripts.length, modFiles: modFiles && modFiles.length, external: liveExternal, vendor, upstreamCommit, tree: treeNow, gitStatus: dirty === null ? 'no git' : 'read', problems };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const ids = a._.length ? a._ : GAMES();
  const rows = ids.map((id) => checkManifest(id));
  for (const r of rows) console.log(JSON.stringify(r));
  console.log(`check-manifest: ${rows.map((r) => `${r.id}=${r.ok ? 'GREEN' : 'RED'}`).join(' ')}`);
  if (a.json) writeJSON(a.json, rows);
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(2); });
