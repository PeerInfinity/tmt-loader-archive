#!/usr/bin/env node
// C1 — the shared purchase-CURRENCY reader (generated, scored per-game data) and the per-game data FORMAT rider.
//
//   node tools/harness/gates-c1.mjs --part 1..7 [--no-summary] [--no-write] [--assert] [--pool N] [--repeat N]
//
// Part 1  THE READER'S ACCURACY on a BOUNDED, NAMED sample: both engine families, ptr, the three games with the most
//         foreign-currency buyables, and a random dozen with a RECORDED seed. The instrument agreement matrix (the regex
//         pick and the trace candidates, each against the rollback's truth) from `games-data/`, plus two measurements
//         only a boot can make: the trace's PURITY (hashGame before/after tracing every canAfford) and the UPGRADES
//         (the engine's declared currency against a rollback buy through the engine's own buyUpgrade).
// Part 2  THE ROSTER COVERAGE (one field / several / none; price / requirement / unknown) against the probe's control
//         (1739 buyables; 1209 one field, 610 of them foreign; 97 several; 431 none; 2 with no buy) — and how many of
//         the probe's 431 "none" the second decrement pattern recovers (a roster boot, pattern only).
// Part 3  FRESHNESS: `tools/currency-data.mjs --check` (the whole roster regenerated and compared) and
//         `--check-index`; `tools/auto-tables.mjs --check` and `--provenance`.
// Part 4  INERTNESS to the hash: the opening (fresh → M12, pinned 6718 / `82eee26f947b2b2e`) and the shipped table
//         from `all/M15.json` over 21,000 ticks (§41: M16 17058 … M25 35778, 37048 / `6e0e67d4b2836e8e`), each WITH the
//         generated data (twice) and with `--no-currency` (the behaviour before C1).
// Part 5  THE CONSUMERS: the planner's `buy` rows at M24 name the real currencies; a BOOSTER reserve on
//         `buyables:t` over the whole stretch `all/M10.json` → M16 (report, not decide: no table entry changes).
// Part 6  THE SCHEMA LEGS: `loader/auto-tables.test.mjs` + `loader/currency.test.mjs`, one row per test — an unknown key,
//         an unknown version, a missing provenance record, a non-ancestor commit, each failing BY NAME.
// Part 7  RETIRED by R3c Part 0 (the table it swept is deleted) — was THE RIDER (⚖ 13d.2): Something Tree's two INTERVAL literals against the target-driven rules, S01–S05, twice.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { REPO, GAMES, parseArgs, writeJSON, headCommit, treeDirty, entryOnly, PRE_F1 } from './lib.mjs';
import { appendSection } from './summary.mjs';
import { runCells } from './sweep.mjs';
entryOnly(import.meta.url);

// ⛔ EVERY FLAG THIS FILE READS IS DECLARED, and `--assert` is a BOOLEAN (an undeclared one was inert for a day, R3b-1).
const a = parseArgs(process.argv.slice(2), ['no-summary', 'no-write', 'assert']);
const KNOWN = new Set(['_', 'part', 'no-summary', 'no-write', 'assert', 'pool', 'repeat']);
for (const k of Object.keys(a)) if (!KNOWN.has(k)) { console.error(`REFUSED: unknown flag --${k}`); process.exit(2); }
const PART = String(a.part || '1');
// ⚖ F1: this gate PREDATES F1. Its PINNED parts name the configuration they measured (lib.mjs PRE_F1 — no passive
// yield, the old derived default — appended to every leg by run.mjs via TMT_NAMED_CONFIG), and every part resumes from
// the fixtures it was written against, preserved byte-for-byte under snapshots/ptr/pre-f1/ (all/ is F1's fresh chain).
if (['4'].includes(PART)) process.env.TMT_NAMED_CONFIG = PRE_F1;
const POOL = Number(a.pool || 4), REPEAT = Number(a.repeat || 2);
const commit = headCommit(), dirty = treeDirty();
const rows = [];
const row = (r) => { rows.push(r); console.log(`${r.ok ? 'GREEN' : 'RED  '} ${r.gate} ${r.id} ${String(r.notes || '').slice(0, 400)}`); };
// ⛔ THE FLOOR EACH PART MUST REACH (`--assert`), counted from what each part EMITS.
// 1: 18 sample games (6 named + a dozen) + purity + upgrades + accuracy verdict · 2: coverage, control, recovery, verdict · 3: four + verdict
// 4: four legs + verdict · 5: planner rows, four stretch cells, verdict · 6: fifteen tests + verdict · 7: eleven cells + verdict
const ROWS = { 1: 21, 2: 4, 3: 5, 4: 5, 5: 6, 6: 17 };   // 7: RETIRED by R3c Part 0 (see RETIRED below). 6: 16 → 17 at S1T
// (2026-09-29): auto-tables.test.mjs gained "every commit a shipped table cites is in the frozen list" (R12/R13).

const DATA = path.join(REPO, 'games-data');
const readData = (id) => JSON.parse(fs.readFileSync(path.join(DATA, id + '.json'), 'utf8'));
const withData = () => JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8')).games;
const entries = (d) => Object.entries(d.buyables).flatMap(([l, v]) => Object.entries(v).map(([id, e]) => ({ l, id, ...e })));
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

function child(args, { timeoutMs = 600e3 } = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}
async function drive(id, script, extra = []) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c1-')), 'r.json');
  await child([path.join(REPO, 'tools/harness/run.mjs'), id, '--ticks', '0', '--planner', '--planner-script', path.join(REPO, 'tools/harness', script), '--random-seed', '1', '--json', f, ...extra]);
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { ok: false, error: 'no result' }; }
}

// ---- Part 1 ---------------------------------------------------------------------------------------------------------
// The sample. The named five: ptr (2.2.1) and something (2.7) are the two engine families' references; the three
// with the most FOREIGN-currency buyables by the probe (universal-reconstruction 37, excavation-tree 22,
// the-factoree 21 — plague is the outlier and is sampled separately below, so the headline never rests on it). The
// dozen is drawn from `games-data/index.json` with a seeded shuffle; the seed is printed in every row.
const SEED = 20260921;
function dozen() {
  const named = new Set(NAMED);
  const pool0 = withData().filter((g) => !named.has(g)).sort();
  let s = SEED >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  for (let i = pool0.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool0[i], pool0[j]] = [pool0[j], pool0[i]]; }
  return pool0.slice(0, 12);
}
const NAMED = ['ptr', 'something', 'universal-reconstruction', 'excavation-tree', 'the-factoree', 'plague-tree-vorona-cirus-treesease'];
function matrix(es) {
  const m = { buyables: es.length, scored: 0, price: 0, requirement: 0, regexRight: 0, regexWrong: 0, regexNone: 0, traceHas: 0, bothRight: 0, abstain: 0, abstainPickExists: 0 };
  for (const e of es) {
    if (!e.scored) { m.abstain++; if (e.pick !== undefined) m.abstainPickExists++; continue; }
    m.scored++; m[e.cost]++;
    const rx = (e.by || []).includes('regex'), tr = (e.by || []).includes('trace');
    if (rx) m.regexRight++; else if (e.pick === undefined) m.regexNone++; else m.regexWrong++;
    if (tr) m.traceHas++;
    if (rx && tr) m.bothRight++;
  }
  return m;
}
async function part1() {
  const games = [...NAMED, ...dozen()];
  const drives = await pool(games, POOL, (id) => drive(id, 'currency-sample.js'));
  const tot = matrix([]); let impure = [], upg = { agree: 0, contradicted: 0, 'nothing-fell': 0, unscorable: 0 }, contra = [], unWhy = {};
  games.forEach((id, i) => {
    const d = readData(id), es = entries(d), m = matrix(es), r = drives[i], ps = r.plannerScript || {};
    for (const k in m) tot[k] += m[k];
    const moved = (ps.purity && ps.purity.moved) || null;
    if (moved && moved.length) impure.push(`${id}: ${moved.join(',')}`);
    const u = (ps.upgrades && ps.upgrades.counts) || { agree: 0, contradicted: 0, 'nothing-fell': 0, unscorable: 0 };
    for (const k in u) upg[k] += u[k];
    for (const x of ((ps.upgrades && ps.upgrades.contradicted) || [])) contra.push(`${id} ${x.layer}/${x.id}: ${x.verdict}, declared ${x.declared}, fell ${JSON.stringify(x.fell)}`);
    for (const [w, n] of Object.entries((ps.upgrades && ps.upgrades.unscorableWhy) || {})) unWhy[w] = (unWhy[w] || 0) + n;
    const wrong = es.filter((e) => e.scored && !(e.by || []).includes('regex') && e.pick !== undefined).slice(0, 3).map((e) => `${e.l}/${e.id} pick ${JSON.stringify(e.pick)} truth ${JSON.stringify(e.pays)}`);
    const family = JSON.parse(fs.readFileSync(path.join(REPO, 'manifests', id + '.json'), 'utf8')).engine.tmtNum;
    row({ gate: `C1-1 sample ${NAMED.includes(id) ? 'NAMED' : `seed ${SEED}`}`, id, leg: `TMT ${family}; states ${d.states.join(' + ')}${d.seeds.length > 1 ? `; seeds ${d.seeds.join(',')}` : ''}`,
      ok: !!r.ok && !!ps.purity && !!(ps.upgrades && ps.upgrades.counts), ticks: 0, gameSeconds: null, diff: null, hash: ps.purity ? ps.purity.after : null,
      notes: `${m.buyables} buyables: SCORED ${m.scored} (price ${m.price}, requirement ${m.requirement}) · abstained ${m.abstain} (${m.abstainPickExists} with a regex pick left UNPROMOTED); regex vs truth: right ${m.regexRight}, wrong ${m.regexWrong}, none ${m.regexNone}; truth inside the trace candidates ${m.traceHas}/${m.scored}; both instruments right ${m.bothRight}; trace purity: ${moved ? (moved.length ? 'MOVED ' + moved.length : 'hashGame unmoved') : 'not measured'}; upgrades ${JSON.stringify(u)}${wrong.length ? '; regex WRONG e.g. ' + wrong.join(' | ') : ''}` });
  });
  row({ gate: 'C1-1 PURITY: tracing canAfford moves no game', id: `${games.length} games`, leg: 'hashGame before/after tracing every buyable', ok: drives.every((r) => r.plannerScript && r.plannerScript.purity) && !impure.length, ticks: 0,
    notes: impure.length ? `IMPURE: ${impure.join(' | ')}` : `0 of ${games.length} games moved; each buyable traced OUTSIDE any excursion` });
  row({ gate: 'C1-1 UPGRADES: the declared currency against the rollback', id: `${games.length} games`, leg: 'buyUpgrade on a rolled-back copy', ok: upg.agree > 0,
    notes: `${JSON.stringify(upg)}${contra.length ? `; CONTRADICTED / NOTHING FELL: ${contra.slice(0, 8).join(' | ')}` : '; no declaration contradicted where scorable'}; unscorable because: ${Object.entries(unWhy).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([w, n]) => `${w} ×${n}`).join('; ')}` });
  const acc = tot.regexRight + tot.regexWrong ? (100 * tot.regexRight / (tot.regexRight + tot.regexWrong)).toFixed(1) : '—';
  row({ gate: 'C1-1 VERDICT: the instrument agreement matrix over the sample', id: `${games.length} games`, leg: `seed ${SEED}; dozen ${dozen().join(', ')}`, ok: tot.scored > 0,
    notes: `${tot.buyables} buyables, ${tot.scored} scored by the rollback (${(100 * tot.scored / tot.buyables).toFixed(1)} %), ${tot.abstain} abstain; the regex pick where it names something: ${acc} % right (${tot.regexRight} right, ${tot.regexWrong} wrong), and it named nothing for ${tot.regexNone} scored buyables; the truth lay inside the trace candidates for ${tot.traceHas} of ${tot.scored}; BOTH cheap instruments right for ${tot.bothRight}` });
}

// ---- Part 2 ---------------------------------------------------------------------------------------------------------
// ⛔ FROZEN: the probe's control over the roster it measured (171 games). Never re-pinned — it is the only thing that
// can tell "the reader changed" from "the roster changed" on those games.
// ⚖ Q7 (tmt-queue-1): its SCOPE is frozen with it — the 103 games that had buyables on that roster, exactly
// `games-data/index.json` at c43a0e7e3 (the last commit before the four new games' data). It used to be "every game
// not in the dated set", which a 176th game would have silently joined, turning a frozen control into a roster pin.
const PROBE = { buyables: 1739, one: 1209, foreign: 610, several: 97, none: 431, nobuy: 2, games: [
  '1-clicker', 'a-tree-for-sure', 'an-operation-tree', 'arc-tree', 'arctree', 'bsed-tree', 'coffee-shop',
  'collection-of-everything', 'create-incremental', 'devourer-of-flies', 'distance-incremental', 'excavation-tree',
  'falling-mountain-s-alterprestige', 'function-of-time', 'gooby-cat-tree', 'layer-tree', 'level-tree',
  'my-experience-tree-rebuilt', 'plague-tree-vorona-cirus-treesease', 'prestige-tree-ng',
  'prestige-tree-rewritten-unsoftcapped4', 'ptr', 'reali-tree', 'sheep-incremental', 'small-layers-tree', 'something',
  'sorbet-s-convolution-mainframe', 'the-abc-tree', 'the-algebra-tree', 'the-atomic-tree', 'the-broken-tree',
  'the-christmas-tree', 'the-chronicle-tree', 'the-cookie-tree-thepasswordispasswor', 'the-cultree', 'the-danus-tree',
  'the-dingus-tree', 'the-doors-tree', 'the-dotree', 'the-dressy-tree', 'the-earth-tree', 'the-element-tree',
  'the-elemental-tree', 'the-energy-factory', 'the-exp-tree', 'the-exponential-tree', 'the-extended-tree',
  'the-factoree', 'the-function-of-time-tree', 'the-fysc-tree', 'the-galactic-tree', 'the-game-tree',
  'the-gaming-tree', 'the-genesis-tree', 'the-greek-tree', 'the-h2o-tree', 'the-hyperdimensions-tree',
  'the-hyperoperator-tree', 'the-incrementreeverse', 'the-infinity-tree', 'the-layered-tree', 'the-leveling-tree',
  'the-lime-upgrade-tree', 'the-loop-tree', 'the-low-taper-fade-tree', 'the-mana-tree', 'the-mechanic-tree',
  'the-melge-tree', 'the-mining-tree', 'the-mj-tree', 'the-necromantree', 'the-nova-tree', 'the-number-tree',
  'the-numbruh-tree', 'the-omega-tree', 'the-ore-tree', 'the-periodic-table-tree', 'the-point-tree', 'the-pp-tree',
  'the-primordial-tree', 'the-pro-tree', 'the-question-tree', 'the-reset-tree', 'the-rpg-tree',
  'the-shenanigans-tree-rewritten', 'the-stardust-tree', 'the-tearonq-i-have-no-creative-names', 'the-territory-tree',
  'the-testy-tree', 'the-tree-emipiplu', 'the-tree-higamezyt', 'the-tree-of-existence-and-reality', 'the-tube-tree',
  'the-universal-tree', 'the-universal-tree-voidcons0le-is-dumb', 'the-upgrade-tree', 'the-weight-tree',
  'ultimate-prestige-tree', 'universal-expansion', 'universal-reconstruction', 'weakling-tree',
  'yet-another-challenge-tree-adventure', 'zavrsni-rad',
] };
// ⚖ 2026-09-22 (tmt-forks-1): the games added since get their OWN dated control beside it, from the same probe
// (NewDocs/plans/tmt/probes/buyable-currency-from-buy-source.js over these ids; the same run reproduced PROBE exactly
// over the other 171), and each set is compared against its own games — neither overwrites the other.
// ⚠ Both the probe and the reader skipped a buyable with a NON-NUMERIC id (`isNaN(id)`) when this was measured:
// the-collab-tree-lun4-r's eight word-id buyables (`feed`, `FasterTimeI`, …) are in neither count, so this agreement is
// not coverage of them.
const PROBE_2026_09_22 = { games: ['the-wall-tree', 'the-cosmic-tree', 'the-classic-tree', 'the-collab-tree-lun4-r'],
  buyables: 217, one: 171, foreign: 85, several: 42, none: 4, nobuy: 0 };
// ⛔ C1b (brief `tmt-auto-20`, Q8): THE READER NOW READS WORD-ID BUYABLES, and the two controls above did not measure
// them — so each is held to what it MEASURED: the NUMERIC-id buyables of its own games. Both are UNEDITED; the same
// fixed probe (`tools/harness/probe-buyable-currency.js`, the NewDocs probe with the `isNaN` skip dropped and a `word`
// tally) reproduced both exactly on numeric ids at C1b over all 175 games (1739 / 1209 / 610 / 97 / 431 / 2 and
// 217 / 171 / 85 / 42 / 4 / 0), which is the evidence the split is the old scope and not a new one.
// The WORD-id buyables get their OWN dated control, from that probe, over the five games that have any (all 175 booted;
// no other game has a word-id object in `buyables`). Named `_WORD` because it was recorded the same day as the one above.
const PROBE_2026_09_22_WORD = { games: ['collection-of-everything', 'the-collab-tree-lun4-r', 'the-gaming-tree', 'the-hyperoperator-tree', 'universal-reconstruction'],
  buyables: 63, one: 37, foreign: 10, several: 4, none: 22, nobuy: 0 };
const isWord = (id) => isNaN(id);
async function part2() {
  const ids = withData();
  const all = ids.flatMap((id) => entries(readData(id)).map((e) => ({ game: id, ...e })));
  // Each control is compared on ITS OWN games, and only those. A game neither probe measured is OUTSIDE the claim —
  // counted and named in the notes, never folded into either side — and a control game that has vanished from the
  // data is RED (its count falls), never skipped.
  const frozen = new Set(PROBE.games), added = new Set(PROBE_2026_09_22.games), worded = new Set(PROBE_2026_09_22_WORD.games);
  // the two numeric-id controls on their own games' NUMERIC ids; the word-id control on ITS games' word ids — and a
  // word-id entry on any game outside that list is outside every claim, counted and named, never folded in
  const nOld = all.filter((e) => frozen.has(e.game) && !isWord(e.id)).length, nNew = all.filter((e) => added.has(e.game) && !isWord(e.id)).length;
  const nWord = all.filter((e) => worded.has(e.game) && isWord(e.id)).length;
  const strayWord = [...new Set(all.filter((e) => isWord(e.id) && !worded.has(e.game)).map((e) => e.game))];
  const missing = [...frozen, ...added, ...worded].filter((g) => !ids.includes(g));
  const outside = ids.filter((g) => !frozen.has(g) && !added.has(g));
  const controlsOk = nOld === PROBE.buyables && nNew === PROBE_2026_09_22.buyables && nWord === PROBE_2026_09_22_WORD.buyables && !missing.length;
  const controls = `frozen control ${PROBE.buyables} vs the reader ${nOld} (numeric ids) on its ${PROBE.games.length} games; dated control 2026-09-22 ${PROBE_2026_09_22.buyables} vs ${nNew} (numeric ids) on its ${PROBE_2026_09_22.games.length}; dated WORD-id control 2026-09-22 ${PROBE_2026_09_22_WORD.buyables} vs ${nWord} on its ${PROBE_2026_09_22_WORD.games.length}; ${outside.length} with data under no numeric control${outside.length ? ` (${outside.join(', ')})` : ''}; ${strayWord.length} with word ids under no control${strayWord.length ? ` (${strayWord.join(', ')})` : ''}${missing.length ? `; ⛔ control games with NO data: ${missing.join(', ')}` : ''}`;
  const c = { buyables: all.length, one: 0, own: 0, foreign: 0, several: 0, none: 0, price: 0, requirement: 0, unknown: 0 };
  for (const e of all) {
    c[e.cost]++;
    if (!e.scored) { c.none++; continue; }
    if (Array.isArray(e.pays)) { c.several++; continue; }
    c.one++; if (e.pays === `player.${e.l}.points`) c.own++; else c.foreign++;
  }
  const out = {}; for (const e of all) out[e.game] = (out[e.game] || 0) + (e.scored && !Array.isArray(e.pays) && e.pays !== `player.${e.l}.points` ? 1 : 0);
  const noPlague = { foreign: c.foreign - (out['plague-tree-vorona-cirus-treesease'] || 0), one: c.one - entries(readData('plague-tree-vorona-cirus-treesease')).filter((e) => e.scored && !Array.isArray(e.pays)).length };
  row({ gate: 'C1-2 COVERAGE over the roster (the rollback\'s answers)', id: `${ids.length} games`, leg: 'games-data/*.json', ok: controlsOk, ticks: 0,
    notes: `${controls}; ${c.buyables} buyables: ONE field ${c.one} (own ${c.own}, FOREIGN ${c.foreign} in ${Object.values(out).filter(Boolean).length} games; without plague ${noPlague.foreign} of ${noPlague.one} = ${(100 * noPlague.foreign / noPlague.one).toFixed(1)} %) · SEVERAL ${c.several} · ABSTAIN ${c.none}; price ${c.price} / requirement ${c.requirement} / unknown ${c.unknown}` });
  row({ gate: 'C1-2 against the probe\'s control (a regex, not a truth)', id: `${ids.length} games`, leg: 'probes/buyable-currency-from-buy-source', ok: controlsOk,
    notes: `probe (frozen, 171 games): ${PROBE.buyables} buyables, one field ${PROBE.one} (foreign ${PROBE.foreign}), several ${PROBE.several}, none ${PROBE.none}, no buy ${PROBE.nobuy}; probe (2026-09-22, ${PROBE_2026_09_22.games.length} games): ${PROBE_2026_09_22.buyables}, one ${PROBE_2026_09_22.one} (foreign ${PROBE_2026_09_22.foreign}), several ${PROBE_2026_09_22.several}, none ${PROBE_2026_09_22.none}, no buy ${PROBE_2026_09_22.nobuy}; probe (2026-09-22 WORD ids, ${PROBE_2026_09_22_WORD.games.length} games): ${PROBE_2026_09_22_WORD.buyables}, one ${PROBE_2026_09_22_WORD.one} (foreign ${PROBE_2026_09_22_WORD.foreign}), several ${PROBE_2026_09_22_WORD.several}, none ${PROBE_2026_09_22_WORD.none}, no buy ${PROBE_2026_09_22_WORD.nobuy}. The reader: one ${c.one}, several ${c.several}, abstain ${c.none}. The differences are the rollback's: a regex pick is not an answer until a buy confirms it, a field the regex misses is found by the fall, and a requirement (compared, never subtracted) is its own kind` });
  const drives = await pool(ids, Math.max(POOL, 6), (id) => drive(id, 'currency-regex.js'));
  // ⚠ C1b: this row's comparison with the frozen probe's 431 is over NUMERIC ids, which is what that probe measured; the
  // word-id buyables the drive now also returns are counted beside it, not inside it.
  let dec = 0, ext = 0, probeNone = 0, recovered = 0, byHow = {}, failed = [], noneScored = 0, noneForeign = 0, wordN = 0, wordNone = 0;
  drives.forEach((r, i) => {
    const ps = r.plannerScript;
    if (!ps || !ps.patterns) { failed.push(ids[i]); return; }
    const D0 = readData(ids[i]).buyables;
    for (const p of ps.patterns) {
      if (!p.found) continue;
      if (isWord(p.id)) { wordN++; if (!p.found.some((d) => d.how === 'assign-sub')) wordNone++; continue; }
      const decOnly = p.found.filter((d) => d.how === 'assign-sub');
      if (decOnly.length) dec++;
      else {
        probeNone++;
        const e = D0[p.layer] && D0[p.layer][p.id];
        if (e && e.scored) { noneScored++; if (!Array.isArray(e.pays) && e.pays !== `player.${p.layer}.points`) noneForeign++; }
        if (p.found.some((d) => d.path)) { recovered++; for (const d of p.found) byHow[d.how] = (byHow[d.how] || 0) + 1; }
      }
      if (p.found.some((d) => d.path)) ext++;
    }
  });
  row({ gate: 'C1-2 the SECOND decrement pattern: the probe\'s "none" recovered', id: `${ids.length} games`, leg: 'alias / `-=` / addPoints(…, negative)', ok: !failed.length, ticks: 0,
    notes: `the probe's pattern alone finds a decrement in ${dec} buyables and none in ${probeNone} (the probe: ${PROBE.none}); the second pattern recovers ${recovered} of those (${JSON.stringify(byHow)}), leaving ${probeNone - recovered} with no decrement any pattern reads. ⛔ THE ROLLBACK scores ${noneScored} of the ${probeNone} (${noneForeign} of them FOREIGN) — the currency is spent somewhere no source pattern reaches (a helper, a computed key), and the fall finds it — so the honest unknowns among them are ${probeNone - noneScored}, not ${PROBE.none}. (${probeNone} not ${PROBE.none}: this reader strips comments first, and the probe counted ${probeNone - PROBE.none} commented-out decrements as real — measured: arctree lab 21/22/31 and arc-tree lab 22/31 carry the line //player.light.points = player.light.points.sub(cost.fo);) Word ids (C1b), apart: ${wordN} with a buy(), ${wordNone} with no assign-sub decrement (the WORD control's probe: ${PROBE_2026_09_22_WORD.none} none).${failed.length ? `; FAILED to boot: ${failed.join(', ')}` : ''}` });
  row({ gate: 'C1-2 VERDICT', id: '—', ok: rows.every((r) => r.ok), notes: `${rows.filter((r) => r.ok).length}/${rows.length}` });
}

// ---- Part 3 ---------------------------------------------------------------------------------------------------------
// ⚖ Q7 (tmt-queue-1, 2026-09-22): the ROSTER is derived, the MEASURED outcomes stay pinned. The digits here were
// `171 … 103` and reddened a check that had regenerated every game with 0 stale the day the roster became 175 (CI run
// 35781867043). N is `manifests/index.json` (GAMES()), so "N given" still fails a tool that enumerates anything else and
// "N read" still fails one boot that did not come up; the with-buyables count is the COMMITTED index — a regeneration
// that loses a game's buyables disagrees with it. `0 failed` and `0 stale` are the claim itself and are never derived.
async function part3() {
  const N = GAMES().length, B = withData().length;
  const legs = [
    ['C1-3 currency-data --check (the whole roster regenerated)', ['tools/currency-data.mjs', '--check', '--jobs', String(Math.max(POOL, 4))], new RegExp(`CURRENCY-DATA CHECK — ${N} games given, ${N} read, 0 failed, ${B} with buyables, 0 stale`)],
    ['C1-3 currency-data --check-index', ['tools/currency-data.mjs', '--check-index'], /CURRENCY-INDEX OK/],
    ['C1-3 auto-tables --check (schema file + every table)', ['tools/auto-tables.mjs', '--check'], /AUTO-TABLES CHECK — \d+ tables against formatVersion 1, 0 RED/],
    ['C1-3 auto-tables --provenance (every entry, every commit, every gate)', ['tools/auto-tables.mjs', '--provenance'], /AUTO-TABLES PROVENANCE — \d+ tables, 0 RED/],
  ];
  for (const [gate, args, want] of legs) {
    const r = await child(args.map((x, i) => (i === 0 ? path.join(REPO, x) : x)));
    const verdict = r.out.split('\n').filter((l) => /CURRENCY-|AUTO-TABLES|STALE|RED|UNVERIFIED|FAILED/.test(l)).slice(-6).join(' ⏎ ');
    row({ gate, id: '—', leg: args.slice(1).join(' '), ok: r.code === 0 && want.test(r.out), ticks: 0, notes: `exit ${r.code}; ${verdict}` });
  }
  row({ gate: 'C1-3 VERDICT', id: '—', ok: rows.every((r) => r.ok), notes: `${rows.filter((r) => r.ok).length}/${rows.length}` });
}

// ---- Part 4 ---------------------------------------------------------------------------------------------------------
const PTR_LADDER = path.join(REPO, 'tools/harness/ladder/ptr.json');
const SNAP = (m) => path.join(REPO, 'tools/harness/snapshots/ptr/pre-f1', m + '.json');   // F1: see above
const OPEN = { diff: 1, ticks: 8000, 'wall-ms': 900000, ladder: PTR_LADDER, to: 'M12', stall: 1000000 };
const L15 = { diff: 1, ticks: 21000, 'wall-ms': 900000, ladder: PTR_LADDER, to: 'M26', 'from-snapshot': SNAP('M15'), 'marks-continue': true, stall: 1000000 };
// ⛔ RE-RECORDED BY R3c PART 1, AS DATA: the dead-member rule's default reading moved to `high-act` (gate R3c-1, CI run
// 35566730632 — the same leg, the same horizon, twice equal): M25 35778 → 35613 and the end 6e0e67d4b2836e8e →
// 3602cc81c88ebd17; M16–M24 UNMOVED. This part's claim — the generated data is INERT against `--no-currency` — is a
// comparison inside the run and does not move.
const PIN15 = { M16: 17058, M17: 23492, M18: 25598, M19: 25937, M20: 26612, M21: 28058, M22: 30618, M23: 30683, M24: 30736, M25: 35613 };
const END15 = { gs: 37048, hashGame: '3602cc81c88ebd17' };
async function part4() {
  const run = (flags, repeat, stop) => runCells({ id: 'ptr', cells: [{ label: '', opt: '' }], flags: Object.entries(flags), pool: POOL, repeat, stop });
  const [od, on, ld, ln] = await Promise.all([run(OPEN, REPEAT, 'M12'), run({ ...OPEN, 'no-currency': true }, 1, 'M12'), run(L15, REPEAT, null), run({ ...L15, 'no-currency': true }, 1, null)]);
  const o = od[0], o0 = on[0], l = ld[0], l0 = ln[0];
  row({ gate: 'C1-4 INERTNESS the opening — WITH the generated data', id: 'ptr', leg: 'fresh → M12, diff 1, profile all', ok: !!o.ok && o.marks.M12 === 6718 && o.hashGame === '82eee26f947b2b2e' && (REPEAT < 2 || o.twiceEqual === true),
    ticks: o.ticks, gameSeconds: o.gameSeconds, diff: 1, hash: o.hashGame, notes: `M12 ${o.marks.M12} (pinned 6718 / 82eee26f947b2b2e); twice equal ${o.twiceEqual}` });
  row({ gate: 'C1-4 INERTNESS the opening — --no-currency (before C1)', id: 'ptr', leg: 'the control', ok: !!o0.ok && o0.hashGame === o.hashGame && o0.gameSeconds === o.gameSeconds,
    ticks: o0.ticks, gameSeconds: o0.gameSeconds, diff: 1, hash: o0.hashGame, notes: `equal to the run with data: ${o0.hashGame === o.hashGame}` });
  const pinned = Object.entries(PIN15).every(([m, s]) => l.marks[m] === s);
  row({ gate: 'C1-4 INERTNESS M15 → 37048 — WITH the generated data', id: 'ptr', leg: 'all/M15.json + 21,000 ticks, the shipped table', ok: !!l.ok && pinned && l.gameSeconds === END15.gs && l.hashGame === END15.hashGame && (REPEAT < 2 || l.twiceEqual === true),
    ticks: l.ticks, gameSeconds: l.gameSeconds, diff: 1, hash: l.hashGame, notes: `${Object.keys(PIN15).map((m) => `${m} ${l.marks[m] ?? '—'}`).join(' · ')} (§41's pins: ${pinned ? 'all equal' : 'MOVED'}); end ${l.gameSeconds} / ${l.hashGame} (pinned ${END15.gs} / ${END15.hashGame}, R3c); twice equal ${l.twiceEqual}` });
  row({ gate: 'C1-4 INERTNESS M15 → 37048 — --no-currency (before C1)', id: 'ptr', leg: 'the control', ok: !!l0.ok && l0.hashGame === l.hashGame && l0.gameSeconds === l.gameSeconds,
    ticks: l0.ticks, gameSeconds: l0.gameSeconds, diff: 1, hash: l0.hashGame, notes: `equal to the run with data: ${l0.hashGame === l.hashGame}` });
  row({ gate: 'C1-4 VERDICT: an unknown currency is today\'s behaviour, and ptr\'s table sets no foreign reserve', id: 'ptr', ok: rows.every((r) => r.ok), notes: `${rows.filter((r) => r.ok).length}/${rows.length}` });
}

// ---- Part 5 ---------------------------------------------------------------------------------------------------------
const L10 = { diff: 1, ticks: 12000, 'wall-ms': 900000, ladder: PTR_LADDER, to: 'M16', 'from-snapshot': SNAP('M10'), stall: 1000000,
  eval: '({b: String(player.b.points), bBest: String(player.b.best), tCaps: String(player.t.buyables[11]), te: String(player.t.energy), tUpg: player.t.upgrades.slice(), bUpg: player.b.upgrades.slice(), sb: String(player.sb.points)})' };
const M10TO16 = ['M11', 'M12', 'M13', 'M14', 'M15', 'M16'];
async function part5() {
  const kf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c1k-')), 'k.json');
  await child([path.join(REPO, 'tools/harness/run.mjs'), 'ptr', '--planner', '--from-snapshot', SNAP('M24'), '--ticks', '0', '--knowledge-out', kf, '--json', kf + '.run']);
  let K = null; try { K = JSON.parse(fs.readFileSync(kf, 'utf8')); } catch {}
  const buys = K ? K.goals.filter((g) => g.kind === 'buy') : [];
  const want = { 'buy:t:11': 'player.b.points', 'buy:s:11': 'player.g.power', 'buy:s:12': 'player.g.power', 'buy:s:13': 'player.g.power', 'buy:s:14': 'player.g.power', 'buy:s:15': 'player.g.power' };
  const okBuys = Object.entries(want).every(([id, dim]) => buys.some((g) => g.id === id && g.dimension === dim));
  row({ gate: 'C1-5 the planner\'s buy rows at M24 name the REAL currency', id: 'ptr', leg: 'run.mjs --planner --from-snapshot all/M24.json --knowledge-out', ok: buys.length === 8 && okBuys,
    ticks: 0, notes: buys.map((g) => `${g.id} → ${g.dimension}`).join(' · ') });
  const cells = [
    { label: '', opt: '', note: 'the shipped table: `buyables:t` is the derived `buy`' },
    { label: 'policy:buyables:t=reserve>=next-upgrade', opt: 'policy:buyables:t=reserve>=next-upgrade', note: 'the BOOSTER reserve: the next b upgrade\'s cost, in Boosters — what the reader makes possible' },
    { label: 'exclude=buyables:t', opt: 'exclude=buyables:t', note: 'R1′\'s lifted exclusion, as the reference it was measured against' },
  ];
  const lines = await runCells({ id: 'ptr', cells, flags: Object.entries(L10), pool: POOL, repeat: REPEAT, stop: 'M16' });
  const nc = (await runCells({ id: 'ptr', cells: [cells[1]], flags: Object.entries({ ...L10, 'no-currency': true }), pool: POOL, repeat: 1, stop: 'M16' }))[0];
  const text = (l) => `${M10TO16.map((m) => `${m} ${l.marks[m] ?? '—'}`).join(' · ')}; end ${l.gameSeconds}; ${l.eval ? `boosters ${l.eval.b} (best ${l.eval.bBest}), Extra Time Capsules ${l.eval.tCaps}, TE ${String(l.eval.te).slice(0, 9)}, t upg [${l.eval.tUpg}], b upg [${l.eval.bUpg}], SB ${l.eval.sb}` : ''}`;
  lines.forEach((l, i) => row({ gate: `C1-5 booster reserve, all/M10 → M16 — ${cells[i].label || 'the table as it ships (control)'}`, id: 'ptr', leg: 'diff 1, profile all, 12000 ticks, stop at M16',
    ok: !!l.ok && (REPEAT < 2 || l.twiceEqual === true), ticks: l.ticks, gameSeconds: l.gameSeconds, diff: 1, hash: l.hashGame, notes: `${text(l)}; twice equal ${l.twiceEqual}; ${cells[i].note}` }));
  row({ gate: 'C1-5 booster reserve, all/M10 → M16 — the same reserve with --no-currency', id: 'ptr', leg: 'the reserve reads t\'s OWN points (before C1)', ok: !!nc.ok,
    ticks: nc.ticks, gameSeconds: nc.gameSeconds, diff: 1, hash: nc.hashGame, notes: `${text(nc)} — the row that shows what the reader changes: equal to the control? ${nc.hashGame === lines[0].hashGame}` });
  row({ gate: 'C1-5 VERDICT (report, not decide — no table entry changes here)', id: 'ptr', ok: rows.every((r) => r.ok), notes: `${rows.filter((r) => r.ok).length}/${rows.length}` });
}

// ---- Part 6 ---------------------------------------------------------------------------------------------------------
async function part6() {
  const r = await child(['--test', path.join(REPO, 'loader/auto-tables.test.mjs'), path.join(REPO, 'loader/currency.test.mjs')]);
  const tests = [...r.out.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map((m) => ({ ok: m[1] === 'ok', name: m[2] }));
  for (const t of tests) row({ gate: `C1-6 ${t.name}`, id: 'stub + the shipped tables', ok: t.ok, ticks: 0, notes: t.ok ? 'passed' : 'FAILED' });
  row({ gate: 'C1-6 VERDICT', id: '—', ok: r.code === 0 && tests.length === ROWS[6] - 1 && tests.every((t) => t.ok), notes: `exit ${r.code}; ${tests.filter((t) => t.ok).length}/${tests.length} tests` });
}

// ---- Part 7 — RETIRED by R3c Part 0 -------------------------------------------------------------------------------
// The rider swept Something Tree's two INTERVAL table entries (`reset:fundamental interval>=5`, `reset:primitive
// interval>=90`) against five target-driven rules. ⚖ User, 2026-09-21: "We can discard the Something Tree data" →
// DELETE ITS AUTOMATION TABLE — so neither entry exists and a sweep "against the table as it ships" would compare the
// derived defaults with themselves and go GREEN for nothing. Retired, not emptied: `--part 7` REFUSES by name. Its
// twelve rows stay in results/SUMMARY.md as the record of what the entries measured (the `rate-peak@0/0` finding
// included), and the CI step that ran it is gone from the `c1-consumers` job.
const RETIRED = { 7: 'the Something Tree interval rider — RETIRED by R3c Part 0: games-auto/something.json is deleted (⚖ user 2026-09-21), so the entries it swept no longer exist; its rows in results/SUMMARY.md are the record' };

const PARTS = { 1: part1, 2: part2, 3: part3, 4: part4, 5: part5, 6: part6 };
if (RETIRED[PART]) { console.error(`REFUSED: part ${PART} is ${RETIRED[PART]}`); process.exit(2); }
if (!PARTS[PART]) { console.error(`no part ${PART}`); process.exit(2); }
await PARTS[PART]();
const red = rows.filter((r) => !r.ok).length;
const verdict = `C1 part ${PART}: rows ${rows.length}/${ROWS[PART]} expected, ${red} RED`;
console.log(`\nVERDICT: ${verdict}`);
const TITLES = { 1: 'the reader\'s accuracy on a named sample', 2: 'the roster coverage', 3: 'freshness', 4: 'inertness', 5: 'the consumers', 6: 'the schema legs', 7: 'the Something Tree interval rider' };
if (!a['no-write']) {
  writeJSON(path.join(REPO, `tools/harness/results/gates-c1-part${PART}.json`), { gate: `C1 part ${PART}`, commit, dirty, rows });
  if (!a['no-summary']) appendSection({ title: `Gate C1 part ${PART} — ${TITLES[PART]} (\`node tools/harness/gates-c1.mjs --part ${PART}\`)`, commit, dirty, rows });
}
if (a.assert && (red > 0 || rows.length !== ROWS[PART])) { console.error(`REFUSED: ${verdict}`); process.exit(1); }
