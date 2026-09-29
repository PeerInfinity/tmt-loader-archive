#!/usr/bin/env node
// C1c — the three defects V6 + C1b left (tmt-automation-plan §52–§53).
//
//   node tools/harness/gates-c1c.mjs --part 1..4 [--pool N] [--repeat N] [--no-summary] [--no-write] [--assert]
//
// Part 1  THE NUMBER HELPER BY CAPABILITY. Every game booted (`number-capability.js`): the type the planner resolved
//         (`player.points`' constructor), whether it has every method each planner operation calls, and a numeric
//         BATTERY over exactly those operations — so a library that HAS a method but rounds differently is a finding,
//         not a pass. Plus `the-classic-tree`'s minified constructor (IS the global `Decimal`), and the two games with
//         no global `Decimal` regenerated: `games-data/` before → after, and the regeneration equal to what is committed.
// Part 2  BUYING THE WORD IDS IS A BEHAVIOUR CHANGE — measured (a MEASUREMENT: measurements.yml). Each game whose
//         enumeration changed, fresh, `--profile all`, diff 1, seed 1, over a fixed horizon, at HEAD and at the
//         BEFORE commit (its RECORDING — below): the progress tracker's events per game-second, hashGame, the actions per
//         feature, and which word-id things were bought (the amount / ownership / completions at the end).
// Part 3  INERTNESS where every purchase id is numeric (must HOLD: sweep.yml). ptr's opening (fresh → M12, pinned
//         6862 / cf8df88462606277), ptr all/M15 → M25 (pinned 28260 / dee581e710a1bf53, the F1 chain), Something Tree fresh → S05 — each at HEAD twice and at the
//         BEFORE commit (its RECORDING), marks + end game-second + hashGame equal.
// Part 4  BUTTONS AND FACES (Part 3 of the brief): the `raises` census from the committed data, universal-reconstruction's
//         enumeration at boot (6 faces out, 18 buttons in) and its derive-time finding, and the unit tests
//         (`loader/c1c.test.mjs`), one row each.
// ⛔ THE BEFORE SIDE IS A RECORDING (S1T, 2026-09-29; ⚖ R12/R13 — the split imports a history-free tree and nothing in it
//    may need the old repository). Parts 2 and 3 used to run BEFORE itself in a control worktree (`git worktree add
//    --detach … 4d8ee5a69`, which needed `fetch-depth: 0`). They now read `tools/harness/recorded/c1c-before.json`: what
//    those BEFORE runs produced — the fields the rows read, and nothing else — recorded once at S1T from the worktree
//    runs (twice, byte-equal: the runs are deterministic), by the `--record` flag this file carried at `fb45e525f` (record mode: that side only, no wall).
//    ⚠ WHAT THAT CHANGES: the rows now prove "HEAD equals what BEFORE produced ON THE DAY IT WAS RECORDED", not "HEAD
//    equals what BEFORE's code produces today". The two differ only if something BEFORE's run read has moved since —
//    for part 2, HEAD's `games-data/` (the lift script prepends it on both sides) and `lift-word.js`; for both parts, a
//    game's files under games/ or a ladder / snapshot fixture. A change there that moves HEAD's side now reads as a
//    move against BEFORE; re-record from the archive (`tmt-loader-archive`, the commit above) if it was intended.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { REPO, GAMES, parseArgs, writeJSON, headCommit, treeDirty, entryOnly } from './lib.mjs';
import { appendSection } from './summary.mjs';
entryOnly(import.meta.url);

// ⛔ EVERY FLAG THIS FILE READS IS DECLARED, and the booleans are booleans (an undeclared flag takes the NEXT token).
const a = parseArgs(process.argv.slice(2), ['no-summary', 'no-write', 'assert']);
const KNOWN = new Set(['_', 'part', 'pool', 'repeat', 'no-summary', 'no-write', 'assert']);
for (const k of Object.keys(a)) if (!KNOWN.has(k)) { console.error(`REFUSED: unknown flag --${k}`); process.exit(2); }
const PART = String(a.part || '1');
const POOL = Number(a.pool || 4), REPEAT = Number(a.repeat || 2);
const commit = headCommit(), dirty = treeDirty();
const rows = [];
const row = (r) => { rows.push(r); console.log(`${r.ok ? 'GREEN' : 'RED  '} ${r.gate} ${r.id} ${String(r.notes || '').slice(0, 600)}`); };
// ⛔ THE ROW COUNT EACH PART MUST EMIT (`--assert`): 1: matrix, battery, alias, two games, verdict · 2: seven games +
// verdict (each game: a fresh leg and a LIFTED leg) · 3: three legs + verdict · 4: raises census, UR enumeration, nine unit tests, verdict
const ROWS = { 1: 6, 2: 15, 3: 4, 4: 12 };

/** The commit BEFORE C1c — main at the brief's writing (`tmt-auto-21`), the last with `numIds` and the `Decimal` helper. */
const BEFORE = '4d8ee5a69';
/** BEFORE's recorded runs: {<part>:<leg>: {ok, ticks, gameSeconds, hashGame, marks, eval, hook, wallMs}}. A leg with no
 *  recording is a RED row (ok: false), never a skip. */
const RECORDING = 'tools/harness/recorded/c1c-before.json';
const recorded = (() => { let r = null; return (key) => { r ??= JSON.parse(fs.readFileSync(path.join(REPO, RECORDING), 'utf8')).results; return r[key] ?? { ok: false, error: `no recording for ${key} in ${RECORDING}` }; }; })();

function child(args, { cwd = REPO, timeoutMs = 600e3 } = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
/** One run.mjs child IN `root` (HEAD = REPO, or the control tree); its JSON result, or {ok:false}. */
async function runAt(root, id, flags) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c1c-')), 'r.json');
  const args = [path.join(root, 'tools/harness/run.mjs'), id, '--json', f];
  for (const [k, v] of Object.entries(flags)) { if (v === true) args.push(`--${k}`); else args.push(`--${k}`, String(v)); }
  const t0 = Date.now();
  const r = await child(args, { cwd: root });
  let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { j = { ok: false, error: r.out.slice(-400) }; }
  j.wallMs = Date.now() - t0;
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
  return j;
}
const markSec = (r) => Object.fromEntries(Object.entries(r.marks || {}).map(([k, m]) => [k, m ? m.gameSeconds : null]));
const agree = (x, y) => !!x && !!y && x.ok !== false && y.ok !== false && x.gameSeconds === y.gameSeconds && x.hashGame === y.hashGame && JSON.stringify(markSec(x)) === JSON.stringify(markSec(y));

// ---- Part 1 ---------------------------------------------------------------------------------------------------------
// The two games with NO global `Decimal` (the planner's census, §53-R), BEFORE and AFTER. Before = `games-data/` at
// BEFORE (every buyable abstained: "the reader threw: Decimal is not defined"). After = what this slice committed.
const NODEC = {
  'the-hyperoperator-tree': { before: { buyables: 20, scored: 0 }, after: { buyables: 20, scored: 20, own: 14, foreign: 6, several: 0 } },
  'the-pro-tree': { before: { buyables: 34, scored: 0 }, after: { buyables: 34, scored: 27, own: 14, foreign: 13, several: 0 } },
};
async function part1() {
  const ids = GAMES();
  const res = await pool(ids, POOL, async (id) => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c1c-n-')), 'r.json');
    await child([path.join(REPO, 'tools/harness/run.mjs'), id, '--ticks', '0', '--planner', '--planner-script', path.join(REPO, 'tools/harness/number-capability.js'), '--json', f]);
    let j = null; try { j = JSON.parse(fs.readFileSync(f, 'utf8')).plannerScript; } catch {}
    return { id, r: j && !j.error ? j : null, error: j && j.error };
  });
  const failed = res.filter((x) => !x.r).map((x) => x.id);
  const byType = {}, byBattery = {}, missing = [];
  for (const { id, r } of res) {
    if (!r) continue;
    const t = r.type || '(unresolved)';
    (byType[t] || (byType[t] = [])).push(id);
    const miss = Object.entries(r.numbers.ops).filter(([, o]) => o.missing.length).map(([op, o]) => `${op}: ${o.missing.join(',')}`);
    if (!r.numbers.resolved || miss.length) missing.push(`${id} (${miss.join('; ') || 'unresolved'})`);
    const sig = JSON.stringify(r.battery);
    (byBattery[sig] || (byBattery[sig] = { types: new Set(), games: [] })).games.push(id);
    byBattery[sig].types.add(t);
  }
  const typeLine = Object.entries(byType).sort((x, y) => y[1].length - x[1].length).map(([t, g]) => `${t} ${g.length}${g.length <= 3 ? ` (${g.join(', ')})` : ''}`).join(' · ');
  row({ gate: 'C1c-1 CAPABILITY — every game\'s number type has every method each planner operation calls (read / probe / plan)', id: `${ids.length} games`,
    ok: !failed.length && !missing.length && res.length === ids.length, ticks: 0,
    notes: `types by player.points' constructor: ${typeLine}; ${missing.length} lacking a method${missing.length ? ': ' + missing.join(' | ') : ''}; ${failed.length} failed to boot${failed.length ? ': ' + failed.join(', ') : ''}` });
  // the battery: one answer per library, and WHERE they differ — a method that exists but rounds differently
  const sigs = Object.entries(byBattery).sort((x, y) => y[1].games.length - x[1].games.length);
  const base = sigs.length ? JSON.parse(sigs[0][0]) : {};
  const diffs = sigs.slice(1).map(([s, v]) => { const b = JSON.parse(s); return `${[...v.types].join('/')} (${v.games.length}: ${v.games.slice(0, 3).join(', ')}${v.games.length > 3 ? ', …' : ''}) differs on ${Object.keys(b).filter((k) => b[k] !== base[k]).map((k) => `${k} ${b[k]} vs ${base[k]}`).join('; ')}`; });
  row({ gate: 'C1c-1 BATTERY — the planner\'s operations, one answer per library (report: a difference is a finding, not a failure)', id: `${sigs.length} distinct answers`,
    ok: sigs.length > 0, ticks: 0, notes: `the majority answer (${sigs.length ? [...sigs[0][1].types].join('/') : '—'}, ${sigs.length ? sigs[0][1].games.length : 0} games) is the reference; ${diffs.join(' || ') || 'no library differs'}` });
  const classic = res.find((x) => x.id === 'the-classic-tree');
  const cr = classic && classic.r;
  row({ gate: 'C1c-1 the-classic-tree\'s minified constructor IS the global `Decimal` (so it was never affected)', id: 'the-classic-tree',
    ok: !!cr && cr.globals.Decimal === 'is the type' && cr.numbers.resolved, ticks: 0, notes: cr ? `constructor name ${JSON.stringify(cr.type)}; global Decimal: ${cr.globals.Decimal}; its games-data never threw (it abstained on nothing for this reason before C1c)` : 'no result' });
  for (const [id, want] of Object.entries(NODEC)) {
    const d = JSON.parse(fs.readFileSync(path.join(REPO, 'games-data', id + '.json'), 'utf8'));
    const s = d.summary;
    const chk = await child([path.join(REPO, 'tools/currency-data.mjs'), '--check', '--ids', id, '--jobs', '1']);
    const fresh = chk.code === 0;
    const own = res.find((x) => x.id === id);
    const pinned = Object.entries(want.after).every(([k, v]) => s[k] === v);
    row({ gate: 'C1c-1 NO global `Decimal`: games-data before → after, and the regeneration equals the committed file', id,
      ok: pinned && fresh && !!own && !!own.r && own.r.globals.Decimal === 'absent', ticks: 0,
      notes: `type ${own && own.r ? own.r.type : '—'} (global Decimal ${own && own.r ? own.r.globals.Decimal : '—'}); before (${BEFORE}): ${want.before.buyables} buyables, ${want.before.scored} scored — every one "the reader threw: Decimal is not defined"; after: ${s.buyables} buyables, ${s.scored} scored (own ${s.own}, foreign ${s.foreign}, several ${s.several}; price ${s.price}, requirement ${s.requirement}, unknown ${s.unknown}); --check ${fresh ? 'fresh' : 'STALE'} (${chk.out.trim().split('\n').pop().slice(0, 160)})` });
  }
  row({ gate: 'C1c-1 VERDICT', id: '—', ok: rows.every((r) => r.ok), notes: `${rows.filter((r) => r.ok).length}/${rows.length}` });
}

// ---- Part 2 ---------------------------------------------------------------------------------------------------------
// ⚖ The games whose purchase enumeration CHANGED (measured at boot over the roster, §53): five with word-id buyables,
// the one with word-id challenges, and the one numeric game whose button the `raises` rule touches.
const P2 = ['universal-reconstruction', 'the-hyperoperator-tree', 'the-gaming-tree', 'the-collab-tree-lun4-r', 'collection-of-everything', 'yet-another-challenge-tree-adventure', 'the-factoree'];
// ⚠ MEASURED FIRST: from fresh, NO word-id thing is bought on any of the seven in 7200 game-s at diff 1, nor on
// Lun4-R / collection-of-everything in a game-WEEK at diff 60 — so the fresh leg says "organic play is unchanged",
// and the LIFTED leg (the reader's own lift on the live state, `lift-word.js`, 600 ticks) is what exercises buying.
const HORIZON = 3600, LIFT_TICKS = 600;
// which word-id things are held at the end — enumerated by SHAPE, never by name
const EVAL_WORD = "(function(){var o={};for(var l in layers){var L=layers[l];if(!L||L.tmtLoaderLayer||!player[l])continue;['upgrades','buyables','challenges'].forEach(function(g){var G=L[g];if(!G||typeof G!=='object')return;for(var k in G){if(!isNaN(k)||!G[k]||typeof G[k]!=='object'||Array.isArray(G[k]))continue;var v=g==='upgrades'?((player[l].upgrades||[]).map(String).indexOf(k)>=0?1:0):g==='buyables'?String(player[l].buyables[k]):Number(player[l].challenges&&player[l].challenges[k]||0);if(v&&v!=='0')o[l+'.'+g+'.'+k]=v;}});}return {events:tmtLoader.progress().total,word:o,f13:player.f&&player.f.buyables&&player.f.buyables[13]!==undefined?String(player.f.buyables[13]):null};})()";
const P2FLAGS = { diff: 1, profile: 'all', ticks: HORIZON, 'random-seed': 1, 'auto-opt': 'track=1', stall: 1e9, 'wall-ms': 570000, eval: EVAL_WORD };
/** The lift script for one game: `lift-word.js` with HEAD's generated data prepended, so both sides lift the same. */
function liftScript(id) {
  const f = path.join(REPO, 'games-data', id + '.json');
  const data = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : 'null';
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c1c-l-')), `lift-${id}.js`);
  fs.writeFileSync(out, `var LIFT_DATA = ${data.trim()};\n` + fs.readFileSync(path.join(REPO, 'tools/harness/lift-word.js'), 'utf8'));
  return out;
}
async function part2() {
  const jobs = [];
  const flagsOf = (id, kind) => (kind === 'fresh' ? P2FLAGS : { ...P2FLAGS, ticks: LIFT_TICKS, planner: true, 'planner-script': liftScript(id) });
  for (const kind of ['fresh', 'lifted']) for (const id of P2) for (let k = 0; k < REPEAT; k++) jobs.push({ id, kind, side: 'after', k });
  const out = await pool(jobs, POOL, async (j) => ({ ...j, r: await runAt(REPO, j.id, flagsOf(j.id, j.kind)) }));
  const actions = (r) => Object.entries(r.hook?.actions || {}).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  for (const kind of ['fresh', 'lifted']) for (const id of P2) {
    const af = out.filter((x) => x.id === id && x.kind === kind && x.side === 'after').map((x) => x.r), bf = recorded(`part2:${kind}:${id}`);
    const H = kind === 'fresh' ? HORIZON : LIFT_TICKS;
    const A = af[0], twice = af.every((r) => agree(r, A));
    const ev = (r) => (r.eval && r.eval.events != null ? r.eval.events : null);
    const rate = (r) => (ev(r) == null ? '—' : Math.round((ev(r) / H) * 10000) / 10000);
    const same = agree(A, bf);
    const lift = A.plannerScript && !A.plannerScript.error ? `lifted ${A.plannerScript.lifted.length} (skipped ${A.plannerScript.skipped.length}${A.plannerScript.skipped.length ? ': ' + A.plannerScript.skipped.slice(0, 6).join('; ') : ''}); ` : '';
    row({ gate: kind === 'fresh' ? `C1c-2 BEFORE → AFTER, fresh ${H} game-s, profile all, diff 1, seed 1` : `C1c-2 BEFORE → AFTER, LIFTED (lift-word.js on the fresh boot), ${H} game-s, profile all, diff 1, seed 1`, id,
      ok: A.ok !== false && bf.ok !== false && twice && A.gameSeconds === H && bf.gameSeconds === H, ticks: A.ticks, gameSeconds: A.gameSeconds, diff: 1, hash: A.hashGame,
      notes: `${lift}events/game-s ${rate(bf)} → ${rate(A)} (${ev(bf)} → ${ev(A)}); hashGame ${bf.hashGame} → ${A.hashGame} (${same ? 'UNMOVED' : 'MOVED'}); word-id things held at the end: before ${JSON.stringify(bf.eval?.word || {})} → after ${JSON.stringify(A.eval?.word || {})}${A.eval?.f13 != null ? `; f 13's slot ${bf.eval?.f13} → ${A.eval.f13}` : ''}; actions before [${actions(bf)}] → after [${actions(A)}]; after twice equal ${twice}; wall ${Math.round(A.wallMs / 1000)}s (BEFORE ${Math.round(bf.wallMs / 1000)}s when recorded)` });
  }
  row({ gate: 'C1c-2 VERDICT (a measurement: every leg ran, twice equal at HEAD; the table is the finding)', id: '—', ok: rows.every((r) => r.ok), notes: `${rows.filter((r) => r.ok).length}/${rows.length}` });
}

// ---- Part 3 ---------------------------------------------------------------------------------------------------------
const PTR_LADDER = path.join('tools/harness/ladder/ptr.json');
const S_LADDER = path.join('tools/harness/ladder/something.json');
const LEGS = [
  { key: 'O', id: 'ptr', name: 'ptr\'s opening — fresh → M12', flags: { diff: 1, profile: 'all', ticks: 8000, 'wall-ms': 570000, ladder: PTR_LADDER, to: 'M12', stall: 1e6 }, pin: { mark: 'M12', gs: 6862, hashGame: 'cf8df88462606277' } },
  { key: 'L', id: 'ptr', name: 'ptr all/M15 → M25 (the F1 chain\'s fixture)', flags: { diff: 1, profile: 'all', ticks: 21000, 'wall-ms': 570000, ladder: PTR_LADDER, to: 'M25', stall: 1e6, 'from-snapshot': 'tools/harness/snapshots/ptr/all/M15.json' }, pin: { mark: 'M25', gs: 28260, hashGame: 'dee581e710a1bf53' } },
  { key: 'S', id: 'something', name: 'Something Tree fresh → S05 (no table)', flags: { diff: 1, profile: 'all', ticks: 3000, 'wall-ms': 570000, ladder: S_LADDER, to: 'S05', stall: 1e6 } },
];
// ⚠ MEASURED: under a pool of 4 the long leg (20,092 ticks) ran 572 s and was cut by its wall 132 game-s short of
// M25 — so this part runs at most THREE children at once (one per leg), whatever --pool says.
async function part3() {
  const jobs = [];
  for (const L of LEGS) for (let k = 0; k < REPEAT; k++) jobs.push({ L, side: 'after', k });
  const out = await pool(jobs, Math.min(POOL, 3), async (j) => ({ ...j, r: await runAt(REPO, j.L.id, j.L.flags) }));
  for (const L of LEGS) {
    const af = out.filter((x) => x.L === L && x.side === 'after').map((x) => x.r), bf = recorded(`part3:${L.key}`);
    const A = af[0], twice = af.every((r) => agree(r, A)), same = agree(A, bf);
    const ms = markSec(A);
    const pinOk = !L.pin || (ms[L.pin.mark] === L.pin.gs && A.hashGame === L.pin.hashGame);
    row({ gate: `C1c-3 INERTNESS — ${L.name}: HEAD ≡ ${BEFORE} (marks, end game-second, hashGame)`, id: L.id, ok: A.ok !== false && twice && same && pinOk,
      ticks: A.ticks, gameSeconds: A.gameSeconds, diff: 1, hash: A.hashGame,
      notes: `${Object.entries(ms).map(([k, v]) => `${k} ${v}`).join(' · ')}; end ${A.gameSeconds} / ${A.hashGame}; before (recorded) ${bf.gameSeconds} / ${bf.hashGame} — ${same ? 'EQUAL' : 'DIFFERENT'}${L.pin ? `; pinned ${L.pin.mark} ${L.pin.gs} / ${L.pin.hashGame}: ${pinOk ? 'held' : 'MOVED'}` : ''}; twice equal ${twice}; wall ${Math.round(A.wallMs / 1000)}s` });
  }
  row({ gate: 'C1c-3 VERDICT: where every purchase id is numeric, nothing moved', id: '—', ok: rows.every((r) => r.ok), notes: `${rows.filter((r) => r.ok).length}/${rows.length}` });
}

// ---- Part 4 ---------------------------------------------------------------------------------------------------------
async function part4() {
  // (a) the `raises` census over the committed data: exactly the buttons the reader's rollback found
  const idx = JSON.parse(fs.readFileSync(path.join(REPO, 'games-data/index.json'), 'utf8')).games;
  const raises = [];
  for (const g of idx) {
    const d = JSON.parse(fs.readFileSync(path.join(REPO, 'games-data', g + '.json'), 'utf8'));
    for (const [l, bs] of Object.entries(d.buyables)) for (const [id, e] of Object.entries(bs)) if (e.raises !== undefined) raises.push(`${g} ${l}.${id}→${e.raises}`);
  }
  const ur = raises.filter((x) => x.startsWith('universal-reconstruction ')), other = raises.filter((x) => !x.startsWith('universal-reconstruction '));
  row({ gate: 'C1c-4 BUTTONS in the generated data — a buyable whose purchase raises ANOTHER buyable (`raises`)', id: `${idx.length} games`,
    ok: ur.length === 18 && ur.every((x) => /\.(\w+)(Buy|BuyNext|BuyMax)→\1$/.test(x)) && other.length === 1 && other[0] === 'the-factoree f.21→13', ticks: 0,
    notes: `${raises.length} (${ur.length} universal-reconstruction: every <face>Buy / BuyNext / BuyMax raises its own face; ${other.join(', ')})` });
  // (b) universal-reconstruction at boot: the enumeration leaves the 6 faces out and takes the 18 buttons; the features
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c1c-u-')), 'r.json');
  await child([path.join(REPO, 'tools/harness/run.mjs'), 'universal-reconstruction', '--ticks', '0', '--json', f, '--eval',
    '({declared: Object.keys(layers.timecube.buyables).filter(function (k) { return tmtLoader.isObjectDef(layers.timecube.buyables[k]); }), ids: tmtLoader.purchaseIds(layers.timecube.buyables), faces: Object.keys(layers.timecube.buyables).filter(function (k) { var v = layers.timecube.buyables[k]; return v && typeof v === "object" && v.canAfford === false; }), feats: tmtLoader.explain().map(function (r) { return r.id; }).filter(function (x) { return /:timecube$/.test(x); })})']);
  let e = null; try { e = JSON.parse(fs.readFileSync(f, 'utf8')).eval; } catch {}
  const faceIn = e ? e.faces.filter((x) => e.ids.includes(x)) : ['no result'];
  row({ gate: 'C1c-4 FACES and BUTTONS — universal-reconstruction\'s `timecube` at boot', id: 'universal-reconstruction',
    ok: !!e && e.declared.length === 24 && e.faces.length === 6 && !faceIn.length && e.ids.length === 18 && !e.feats.includes('buyables:timecube'), ticks: 0,
    notes: e ? `${e.declared.length} declared objects; faces (canAfford: false, a constant) ${e.faces.join(', ')} — ${faceIn.length ? 'ADMITTED: ' + faceIn.join(', ') : 'none enumerated'}; purchaseIds ${e.ids.length} (the buttons); timecube features [${e.feats.join(', ')}] — ⚠ no buyables:timecube: the game builds these buyables in its OWN setupLayer at load, after the automation derives its features, so nothing here buys them (before or after)` : 'no result' });
  // (c) the unit tests
  const r = await child(['--test', path.join(REPO, 'loader/c1c.test.mjs')]);
  const tests = [...r.out.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map((m) => ({ ok: m[1] === 'ok', name: m[2] }));
  for (const t of tests) row({ gate: `C1c-4 ${t.name}`, id: 'stub', ok: t.ok, ticks: 0, notes: t.ok ? 'passed' : 'FAILED' });
  row({ gate: 'C1c-4 VERDICT', id: '—', ok: r.code === 0 && tests.length === ROWS[4] - 3 && rows.every((x) => x.ok), notes: `exit ${r.code}; ${tests.filter((t) => t.ok).length}/${tests.length} tests; ${rows.filter((x) => x.ok).length}/${rows.length} rows` });
}

const PARTS = { 1: part1, 2: part2, 3: part3, 4: part4 };
if (!PARTS[PART]) { console.error(`no part ${PART}`); process.exit(2); }
await PARTS[PART]();
const red = rows.filter((r) => !r.ok).length;
const verdict = `C1c part ${PART}: rows ${rows.length}/${ROWS[PART]} expected, ${red} RED`;
console.log(`\nVERDICT: ${verdict}`);
const TITLES = { 1: 'the number helper by capability', 2: 'buying the word ids — before → after', 3: 'inertness where every id is numeric', 4: 'buttons and faces; the unit tests' };
if (!a['no-write']) {
  writeJSON(path.join(REPO, `tools/harness/results/gates-c1c-part${PART}.json`), { gate: `C1c part ${PART}`, commit, dirty, rows });
  if (!a['no-summary']) appendSection({ title: `Gate C1c part ${PART} — ${TITLES[PART]} (\`node tools/harness/gates-c1c.mjs --part ${PART}\`)`, commit, dirty, rows });
}
if (a.assert && (red > 0 || rows.length !== ROWS[PART])) { console.error(`REFUSED: ${verdict}`); process.exit(1); }
