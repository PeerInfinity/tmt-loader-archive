// C1 (§40-R ruling B) — the per-game tables as JSON with a PUBLISHED schema, and provenance as a GATE.
//
// Each leg names what it fails and the message it must fail BY NAME: an unknown key, an unknown version, a missing
// provenance record, a provenance commit that is not in the frozen commit list (R12/R13: it used to be "not an ancestor
// of HEAD", which needed the history). Two runners share one schema and one
// validator (`tools/auto-tables.mjs` extracts the loader's `<table-schema>` block), so every leg is asked of BOTH:
// the CI tool, and the loader at load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchemaBlock, checkTables, checkProvenance, parseStrict, schemaText, summaryLabels, gateInSummary, frozenCommits, tableFiles } from '../tools/auto-tables.mjs';
import { parseStrict as parseCurrency } from '../tools/currency-data.mjs';
import { bootStub, Decimal } from './stub-engine.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blk = loadSchemaBlock();
const ptr = JSON.parse(fs.readFileSync(path.join(REPO, 'games-auto/ptr.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

test('the shipped tables validate, the published schema is the loader\'s, and the key list is read off the schema', () => {
  const c = checkTables();
  assert.deepEqual(c.problems, []);
  // R3c Part 0: ONE shipped table (Something Tree's was deleted — ⚖ user 2026-09-21); an empty directory is a failure
  assert.ok(c.rows.length >= 1 && c.rows.every((r) => r.ok), JSON.stringify(c.rows.filter((r) => !r.ok)));
  assert.equal(fs.readFileSync(path.join(REPO, 'schemas/games-auto.schema.json'), 'utf8'), schemaText(blk.TABLE_SCHEMA));
  const src = fs.readFileSync(path.join(REPO, 'loader/tmt-auto.js'), 'utf8');
  assert.match(src, /var TABLE_KEYS = Object\.keys\(TABLE_SCHEMA\.properties\);/, 'the loader keeps a SECOND key list');
  assert.ok(!fs.readdirSync(path.join(REPO, 'games-auto')).includes('schema.json'), 'a schema beside the tables would be read as a game called "schema"');
});

// ---- the four failures, each BY NAME, each in both runners -------------------------------------------------------
const stubGame = () => ({ a: { name: 'alpha', row: 1, type: 'normal', layerShown: () => true, startData: () => ({ unlocked: true, points: new Decimal(0) }),
  tmtStubTemp(tmp) { const t = tmp.a || (tmp.a = {}); t.type = 'normal'; t.canReset = false; t.autoPrestige = false; t.resetGain = new Decimal(0); t.baseAmount = new Decimal(0); t.requires = new Decimal(1); t.nextAt = new Decimal(1); } } });
const loaderRefuses = (table) => { try { bootStub(stubGame(), { autoTable: table }); return null; } catch (e) { return String(e && e.message); } };

test('an UNKNOWN KEY fails by name — in the CI validator and in the loader', () => {
  const t = clone(ptr); t.polices = {};   // the typo is the point
  assert.ok(blk.schemaErrors(t, blk.TABLE_SCHEMA, 'ptr.json').some((e) => /unknown key "polices"/.test(e)));
  assert.match(loaderRefuses({ polices: {} }) || '', /unknown key "polices"/);
});

test('an UNKNOWN VERSION fails by name — and so does a table that states none', () => {
  const t = clone(ptr); t.formatVersion = 2;
  assert.ok(blk.schemaErrors(t, blk.TABLE_SCHEMA, 'ptr.json').some((e) => /formatVersion: 2 is not one of \[1\]/.test(e)));
  assert.match(loaderRefuses({ formatVersion: 2, policies: {} }) || '', /formatVersion 2 is not one this loader reads/);
  assert.match(loaderRefuses({ formatVersion: null, policies: {} }) || '', /no formatVersion/);
  assert.equal(loaderRefuses({ formatVersion: 1, policies: {} }), null, 'the CONTROL: version 1 loads');
});

test('a MALFORMED provenance record fails the schema (a record is structured, not a line of prose)', () => {
  const t = clone(ptr); t.provenance['reset:p'] = 'R1′ (SUMMARY gate R1′-2.3): a sentence';
  assert.ok(blk.schemaErrors(t, blk.TABLE_SCHEMA, 'ptr.json').some((e) => /provenance\.reset:p: matches no allowed form/.test(e)));
});

const labels = summaryLabels();
const always = () => true;
test('the provenance gate is GREEN on the shipped ptr table, and its two anchors are real', () => {
  const r = checkProvenance(ptr, { labels, known: always });
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.bad, []);
  assert.ok(gateInSummary('R1′-2.3', labels) && gateInSummary('A1-3', labels), 'the SUMMARY label reader found nothing');
  assert.ok(!gateInSummary('R1′-2.2', labels), 'R1′-2.2 — the id ptr.js cited for `buyables:e` — is in no SUMMARY row; the gate must not find it');
});

test('a MISSING provenance record fails by name — for a policy, a gate, a keep and an unlockOrder list', () => {
  for (const k of ['reset:p', 'challenges:h', 'reset:b', 'unlockOrder:1']) {
    const t = clone(ptr); delete t.provenance[k];
    assert.ok(checkProvenance(t, { labels, known: always }).missing.includes(k), `deleting ${k}'s record was not noticed`);
  }
});

test('a provenance commit NOT IN THE FROZEN LIST fails by name, and so does a gate id no SUMMARY row carries', () => {
  const t = clone(ptr);
  const bad = checkProvenance(t, { labels, known: (c) => c !== t.provenance['reset:e'].commit });
  assert.ok(bad.bad.some((b) => b.startsWith('reset:e: commit') && /not in the frozen commit list/.test(b)), JSON.stringify(bad.bad));
  const u = clone(ptr); u.provenance['reset:e'].gate = 'R1′-2.2';
  assert.ok(checkProvenance(u, { labels, known: always }).bad.some((b) => /reset:e: gate "R1′-2\.2" appears in no/.test(b)));
});

test('an UNVERIFIED record is listed, never failed — and never carries an invented gate id', () => {
  // R3c Part 0: the two shipped `unverified` records were Something Tree's, and its table is deleted — the leg now
  // CONSTRUCTS them on a copy of ptr's table (the record form is still frozen in the schema and still legal)
  const st = clone(ptr);
  st.policies['reset:unlock'] = 'always'; st.policies['buyables:fundamental'] = 'buyMax';
  st.provenance['reset:unlock'] = { unverified: true, note: 'constructed: no row measures this entry' };
  st.provenance['buyables:fundamental'] = { unverified: true, note: 'constructed: no row measures this entry' };
  const r = checkProvenance(st, { labels, known: always });
  assert.deepEqual(r.bad, []);
  assert.equal(r.unverified.length, 2);
  const t = clone(st); t.provenance['reset:unlock'].gate = 'A1';
  assert.ok(blk.schemaErrors(t, blk.TABLE_SCHEMA, 'something.json').length, 'an unverified record that also names a gate passed the schema');
});

test('both tools DECLARE every flag — an unknown one is a hard error, not an inert switch', () => {
  assert.throws(() => parseStrict(['--assert']), /unknown flag --assert/);
  assert.throws(() => parseCurrency(['--assert']), /unknown flag --assert/);
  assert.throws(() => parseCurrency(['--check', '--write']), /exclusive/);
  assert.deepEqual(parseCurrency(['--check', '--shard', '2/3']), { check: true, shard: '2/3' });
});

test('every commit a shipped table cites is in the frozen list, and every entry names the commit it is keyed by (R12/R13)', () => {
  const frozen = frozenCommits(REPO);
  const cited = [];
  for (const f of tableFiles(REPO)) {
    const t = JSON.parse(fs.readFileSync(path.join(REPO, 'games-auto', f), 'utf8'));
    for (const v of Object.values(t.provenance || {})) for (const r of [].concat(v)) if (r.commit) cited.push(r.commit);
  }
  assert.ok(cited.length > 0, 'no table cites a commit — the check would be vacuous');
  assert.deepEqual(cited.filter((c) => !Object.hasOwn(frozen, c)), []);
  for (const [k, e] of Object.entries(frozen)) assert.ok(/^[0-9a-f]{40}$/.test(e.commit) && e.commit.startsWith(k) && e.date && e.subject, k);
  const r = checkProvenance(JSON.parse(fs.readFileSync(path.join(REPO, 'games-auto/ptr.json'), 'utf8')), { labels, known: (c) => Object.hasOwn(frozen, c) });
  assert.deepEqual(r.bad, []);
});
