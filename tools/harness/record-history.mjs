#!/usr/bin/env node
// S1T (R12/R13) ONE-TIME RECORDER — reads the loader's git HISTORY once and writes what the history-free gates compare
// against. Removed from the tree in the commit after the records land (nothing in the new repositories may need the old
// history); the archive keeps it at the commit that added it, as the way to regenerate the records.
//
//   node tools/harness/record-history.mjs pristine      games-pristine/<id>.json from each game's git-subtree squash
//   node tools/harness/record-history.mjs provenance    tools/harness/recorded/provenance-commits.json
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, GAMES } from './lib.mjs';
import { treeIdOf, listDisk, entry, recordText, recordPath, PRISTINE_DIR } from '../pristine.mjs';

const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 256 << 20 }).trim();
const HEAD = git('rev-parse', 'HEAD');
const RECORDER = git('log', '-1', '--format=%h', '--', 'tools/harness/record-history.mjs') || '(uncommitted)';
const today = new Date().toISOString().slice(0, 10);
const what = process.argv[2];

if (what === 'pristine') {
  fs.mkdirSync(path.join(REPO, PRISTINE_DIR), { recursive: true });
  let n = 0, files = 0;
  for (const id of GAMES()) {
    const body = git('log', '--format=%H%x09%b', `--grep=^git-subtree-dir: games/${id}$`, '-n', '1');
    const split = (body.match(/git-subtree-split: ([0-9a-f]{40})/) || [])[1];
    const squash = git('log', '--format=%H', `--grep=^Squashed 'games/${id}/' content from commit`, '-n', '1');
    if (!split || !squash) throw new Error(`${id}: no subtree squash in the history (split ${split}, squash ${squash})`);
    const tree = git('rev-parse', `${squash}^{tree}`);
    const listing = {};
    const raw = execFileSync('git', ['-C', REPO, 'ls-tree', '-r', '-z', tree], { encoding: 'utf8', maxBuffer: 256 << 20 }).split('\0').filter(Boolean);
    for (const line of raw) { const [meta, rel] = line.split('\t'); const [mode, type, blob] = meta.split(' '); if (type !== 'blob') throw new Error(`${id}: ${rel} is a ${type}`); listing[rel] = entry(mode, blob); }
    // the recording must BE the tree it names, and the disk hashing must be git's: both checked here, once
    if (treeIdOf(listing) !== tree) throw new Error(`${id}: treeIdOf(listing) ${treeIdOf(listing)} ≠ the squash tree ${tree}`);
    const head = git('rev-parse', `HEAD:games/${id}`);
    const disk = treeIdOf(listDisk(path.join(REPO, 'games', id)));
    if (disk !== head) throw new Error(`${id}: the disk's tree id ${disk} ≠ HEAD:games/${id} ${head} (a dirty tree, or the hashing is wrong)`);
    const rec = { id, upstream: { commit: split, tree }, recorded: { from: `the git-subtree squash commit ${squash} (loader history at ${HEAD.slice(0, 9)})`, by: `tools/harness/record-history.mjs pristine at ${RECORDER} (in tmt-loader-archive)`, date: today }, files: listing };
    fs.writeFileSync(recordPath(id, REPO), recordText(rec));
    n++; files += Object.keys(listing).length;
  }
  console.log(`recorded ${n} games, ${files} files; every listing hashes to its squash tree, and every disk tree to HEAD:games/<id>`);
} else if (what === 'provenance') {
  const cited = new Map();
  for (const f of fs.readdirSync(path.join(REPO, 'games-auto')).filter((x) => x.endsWith('.json')).sort()) {
    const t = JSON.parse(fs.readFileSync(path.join(REPO, 'games-auto', f), 'utf8'));
    for (const [k, v] of Object.entries(t.provenance || {})) for (const r of [].concat(v)) if (r.commit) (cited.get(r.commit) || cited.set(r.commit, []).get(r.commit)).push(`${f}:${k}`);
  }
  const commits = {};
  for (const c of [...cited.keys()].sort()) {
    const full = git('rev-parse', '--verify', `${c}^{commit}`);
    execFileSync('git', ['-C', REPO, 'merge-base', '--is-ancestor', full, 'HEAD']);  // throws if not
    const [date, subject] = git('log', '-1', '--format=%cs%x09%s', full).split('\t');
    commits[c] = { commit: full, date, subject };
  }
  const out = { about: 'The loader commits that games-auto/*.json provenance records cite, frozen: `auto-tables.mjs --provenance` checks a record\'s commit against THIS list, never against git history (R12/R13 — the tree is imported without history). Add a commit with `node tools/auto-tables.mjs --add-commit <sha>` (it must be an ancestor of HEAD in the clone you run it in).',
    recorded: { from: `the loader history at ${HEAD.slice(0, 9)}; every commit an ancestor of it`, by: `tools/harness/record-history.mjs provenance at ${RECORDER} (in tmt-loader-archive)`, date: today }, commits };
  fs.mkdirSync(path.join(REPO, 'tools/harness/recorded'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'tools/harness/recorded/provenance-commits.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`recorded ${Object.keys(commits).length} commits cited by ${[...cited.values()].flat().length} records`);
} else { console.error('usage: record-history.mjs pristine | provenance'); process.exit(2); }
