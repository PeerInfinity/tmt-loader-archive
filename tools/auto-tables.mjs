#!/usr/bin/env node
// C1 (§40-R ruling B) — the per-game automation tables as DATA with a published schema, checked.
//
//   node tools/auto-tables.mjs [--check | --write] [--provenance] [--json out.json]
//
//   --check       (the default) the schema file `schemas/games-auto.schema.json` equals the one generated from the
//                 loader's own TABLE_SCHEMA, and every `games-auto/<id>.json` validates against it with the loader's
//                 own `schemaErrors` — ONE schema, ONE validator: both are extracted from `loader/tmt-auto.js`
//                 between its `<table-schema>` markers and run here exactly as the loader runs them at load.
//                 Also: the set of tables equals the set of manifests whose `auto` field names one, and each table's
//                 `id` is its file name. No git history needed: the fast CI job runs this.
//   --write       regenerate the schema file from the loader (after changing TABLE_SCHEMA).
//   --provenance  THE PROVENANCE GATE: every `policies` / `gates` / `keep` entry, and every `unlockOrder` list, has a
//                 provenance record; every measured record's `commit` is in the FROZEN COMMIT LIST
//                 (`tools/harness/recorded/provenance-commits.json`) and its `gate` appears in
//                 `tools/harness/results/SUMMARY.md` (a row whose first cell begins with the id) — or the record
//                 names the CI `run` whose job output holds the rows, for a gate that writes none to SUMMARY. Records
//                 marked `unverified` are LISTED, never failed and never given an invented gate id. Reads no git.
//   --add-commit <sha>  add a loader commit to the frozen list (sha, date, subject), for a NEW record that cites it.
//                 Run in a clone that has the commit: it must be an ancestor of HEAD there. The only git this tool asks.
// ⚖ R12/R13 (user, 2026-09-29): this gate asked `git merge-base --is-ancestor` of every record's commit, so it needed
// the full history — and after the split the cited commits exist only in tmt-loader-archive, which nothing in the new
// repositories may need. The 9 commits the 16 records cited were FROZEN once, from the history (sha, date, subject);
// the gate checks membership in that list, and a new record's commit is added with --add-commit when it is written.
// ⛔ EVERY FLAG IS DECLARED; an unknown one is a hard error.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_FILE = path.join(REPO, 'schemas/games-auto.schema.json');
const BOOL = new Set(['check', 'write', 'provenance', 'help']);
const VALUED = new Set(['json', 'repo', 'add-commit']);

export function parseStrict(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${JSON.stringify(a)}`);
    const eq = a.indexOf('=');
    const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (BOOL.has(k)) { if (eq > 0) throw new Error(`--${k} takes no value`); o[k] = true; continue; }
    if (!VALUED.has(k)) throw new Error(`unknown flag --${k} (known: ${[...BOOL, ...VALUED].map((f) => '--' + f).join(' ')})`);
    const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (v === undefined || String(v).startsWith('--')) throw new Error(`--${k} needs a value`);
    o[k] = v;
  }
  if (o.write && o.check) throw new Error('--write and --check are exclusive');
  return o;
}

/** The loader's `<table-schema>` block, run on its own: {TABLE_SCHEMA, TABLE_FORMAT_VERSIONS, schemaErrors}. */
export function loadSchemaBlock(root = REPO) {
  const src = fs.readFileSync(path.join(root, 'loader/tmt-auto.js'), 'utf8');
  const a = src.indexOf('// <table-schema>'), b = src.indexOf('// </table-schema>');
  if (a < 0 || b < a) throw new Error('loader/tmt-auto.js has no <table-schema> … </table-schema> block');
  // eslint-disable-next-line no-new-func
  return new Function(src.slice(a, b) + '\nreturn { TABLE_SCHEMA: TABLE_SCHEMA, TABLE_FORMAT_VERSIONS: TABLE_FORMAT_VERSIONS, schemaErrors: schemaErrors };')();
}
export const schemaText = (S) => JSON.stringify(S, null, 2) + '\n';

export function tableFiles(root = REPO) {
  return fs.readdirSync(path.join(root, 'games-auto')).filter((f) => f.endsWith('.json')).sort();
}

/** The structural check: [{file, ok, errors}] plus the set problems. Pure over `root`. */
export function checkTables(root = REPO) {
  const blk = loadSchemaBlock(root);
  const problems = [];
  const want = schemaText(blk.TABLE_SCHEMA);
  const have = fs.existsSync(path.join(root, 'schemas/games-auto.schema.json')) ? fs.readFileSync(path.join(root, 'schemas/games-auto.schema.json'), 'utf8') : null;
  if (have !== want) problems.push('schemas/games-auto.schema.json is not the schema loader/tmt-auto.js declares (run tools/auto-tables.mjs --write)');
  const rows = [];
  const files = tableFiles(root);
  for (const f of files) {
    let t = null, errors = [];
    try { t = JSON.parse(fs.readFileSync(path.join(root, 'games-auto', f), 'utf8')); } catch (e) { errors.push(`not JSON: ${e.message}`); }
    if (t) {
      errors = blk.schemaErrors(t, blk.TABLE_SCHEMA, f);
      if (t.id !== f.slice(0, -5)) errors.push(`${f}: id ${JSON.stringify(t.id)} is not the file's name`);
    }
    rows.push({ file: f, ok: !errors.length, errors });
  }
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'manifests/index.json'), 'utf8')).map((g) => g.id);
  const declared = roster.filter((id) => JSON.parse(fs.readFileSync(path.join(root, 'manifests', id + '.json'), 'utf8')).auto).map((id) => id + '.json').sort();
  if (JSON.stringify(declared) !== JSON.stringify(files)) problems.push(`games-auto/ holds [${files.join(', ')}] and the manifests declare [${declared.join(', ')}]`);
  return { problems, rows, versions: blk.TABLE_FORMAT_VERSIONS };
}

/** SUMMARY row labels: the first cell of every table row. */
export function summaryLabels(root = REPO) {
  const t = fs.readFileSync(path.join(root, 'tools/harness/results/SUMMARY.md'), 'utf8');
  return t.split('\n').filter((l) => l.startsWith('| ')).map((l) => l.split('|')[1].trim());
}
export function gateInSummary(gate, labels) { return labels.some((l) => l === gate || l.startsWith(gate + ' ') || l.startsWith(gate + ':')); }
export const COMMITS_FILE = 'tools/harness/recorded/provenance-commits.json';
/** The frozen commit list: {<sha as cited>: {commit, date, subject}}. */
export function frozenCommits(root = REPO) {
  const f = path.join(root, COMMITS_FILE);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).commits || {} : {};
}
/** Adds `sha` to the frozen list — resolved and ancestor-checked in THIS clone (the one place git is asked). */
function addCommit(sha, root) {
  const git = (...x) => execFileSync('git', ['-C', root, ...x], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const full = git('rev-parse', '--verify', `${sha}^{commit}`);
  try { git('merge-base', '--is-ancestor', full, 'HEAD'); } catch { throw new Error(`${sha} is not an ancestor of HEAD in ${root}`); }
  const [date, subject] = git('log', '-1', '--format=%cs%x09%s', full).split('\t');
  const f = path.join(root, COMMITS_FILE);
  const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  doc.commits[sha] = { commit: full, date, subject };
  doc.commits = Object.fromEntries(Object.entries(doc.commits).sort(([x], [y]) => (x < y ? -1 : 1)));
  fs.writeFileSync(f, JSON.stringify(doc, null, 2) + '\n');
  return doc.commits[sha];
}

/** The provenance gate over one parsed table: {missing, bad, unverified, records}. `known` (is this commit in the frozen
 *  list) is injectable for tests. */
export function checkProvenance(table, { labels, known }) {
  const prov = table.provenance || {};
  const need = new Set([...Object.keys(table.policies || {}), ...Object.keys(table.gates || {}), ...Object.keys(table.keep || {})]);
  (table.unlockOrder || []).forEach((_, i) => need.add(`unlockOrder:${i}`));
  const missing = [...need].filter((k) => !prov[k]).sort();
  const bad = [], unverified = [];
  let records = 0;
  for (const [k, v] of Object.entries(prov)) {
    for (const r of [].concat(v)) {
      records++;
      if (r.unverified) { unverified.push(`${k}: ${r.note}`); continue; }
      if (!known(r.commit)) bad.push(`${k}: commit ${r.commit} is not in the frozen commit list ${COMMITS_FILE} (add it with --add-commit)`);
      if (!r.run && !gateInSummary(r.gate, labels)) bad.push(`${k}: gate ${JSON.stringify(r.gate)} appears in no results/SUMMARY.md row (and the record names no CI run)`);
    }
  }
  return { missing, bad, unverified, records };
}

async function main() {
  const A = parseStrict(process.argv.slice(2));
  const root = A.repo ? path.resolve(A.repo) : REPO;
  if (A.help) { process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n') + '\n'); return 0; }
  if (A.write) {
    fs.mkdirSync(path.dirname(SCHEMA_FILE), { recursive: true });
    fs.writeFileSync(path.join(root, 'schemas/games-auto.schema.json'), schemaText(loadSchemaBlock(root).TABLE_SCHEMA));
    console.log('wrote schemas/games-auto.schema.json');
  }
  if (A['add-commit']) { const e = addCommit(A['add-commit'], root); console.log(`added ${A['add-commit']} to ${COMMITS_FILE}: ${e.date} ${e.subject}`); return 0; }
  const out = {};
  if (A.provenance) {
    const labels = summaryLabels(root);
    const frozen = frozenCommits(root);
    // an entry must name the commit it is keyed by (a hand edit that re-keys one is a RED, not a silent pass)
    const badList = Object.entries(frozen).filter(([k, e]) => !e || typeof e.commit !== 'string' || !e.commit.startsWith(k) || !/^[0-9a-f]{40}$/.test(e.commit));
    for (const [k] of badList) console.log(`RED   ${COMMITS_FILE}: the entry ${k} does not name a 40-hex commit that begins with its key`);
    const res = tableFiles(root).map((f) => ({ file: f, ...checkProvenance(JSON.parse(fs.readFileSync(path.join(root, 'games-auto', f), 'utf8')), { labels, known: (c) => Object.hasOwn(frozen, c) && !badList.some(([k]) => k === c) }) }));
    let red = 0;
    for (const r of res) {
      const ok = !r.missing.length && !r.bad.length;
      if (!ok) red++;
      console.log(`${ok ? 'GREEN' : 'RED  '} ${r.file}: ${r.records} records; missing ${r.missing.length ? r.missing.join(', ') : 'none'}; bad ${r.bad.length ? r.bad.join(' | ') : 'none'}; unverified ${r.unverified.length}`);
      for (const u of r.unverified) console.log(`      UNVERIFIED ${r.file} ${u}`);
    }
    red += badList.length;
    console.log(`AUTO-TABLES PROVENANCE — ${res.length} tables, ${red} RED`);
    out.provenance = res;
    if (A.json) fs.writeFileSync(A.json, JSON.stringify(out, null, 1) + '\n');
    return red ? 1 : 0;
  }
  const c = checkTables(root);
  for (const r of c.rows) console.log(`${r.ok ? 'GREEN' : 'RED  '} games-auto/${r.file}${r.ok ? '' : ': ' + r.errors.join('; ')}`);
  for (const p of c.problems) console.log(`RED   ${p}`);
  const red = c.rows.filter((r) => !r.ok).length + c.problems.length;
  console.log(`AUTO-TABLES CHECK — ${c.rows.length} tables against formatVersion ${c.versions.join(', ')}, ${red} RED`);
  out.check = c;
  if (A.json) fs.writeFileSync(A.json, JSON.stringify(out, null, 1) + '\n');
  return red ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => process.exit(c), (e) => { console.error('auto-tables: ' + e.message); process.exit(2); });
}
