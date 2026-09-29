// The S1 gates (the derived automation core; tmt-automation-plan §8). Appends one section to results/SUMMARY.md.
//   node gates-s1.mjs --part 1|1s|2|2s-p|2s-f|2s-q|2k|3 [--no-summary] [--pool 6]
// Part 1 (S1-1): the off anchors (contract-only page and au excluded), goldens and check-manifest for ptr and something;
// PINNED BEHAVIOUR — the A1-3 / A2-3 / §12d / A2-1 runs under the derived tables restricted to kinds=reset,upgrades,buyables,
// each mark at its SUMMARY tick with the game state equal. `hash` (the full stateJSON) includes player.au, whose
// `clickables` has one key per au button, so it moves with the NUMBER of registered features; the rows therefore chain:
// the commit that recorded a SUMMARY row (3bc12bf for A1-3, 17260e03 for A2) is checked out in a throwaway worktree with
// only the `hashGame` patch (the same state without player.au), reproduces the SUMMARY tick and FULL hash, and hands its
// hashGame to the S1 run, which must equal it at the same tick. Also: the fresh-boot Locked states old vs derived, the
// predicate compiler vs the harness's --until (node and page), and the table-less generality probe (the-omega-tree).
// Part 1s: the §12d stall pair alone (two 9-min-walled detector runs need whole cores). The au tab page checks are
// gates-a1 part 2, run separately (`node gates-a1.mjs --part 2 ptr something`).
// Part 2 (S1-2): the S1 frontier (PTR, every derived kind on, fresh game) with the toggles' yield checks, an informative
// second frontier row, the challenges smoke tests. Parts 2s-p / 2s-f / 2s-q: the reset-policy sweeps. Part 3 (S1-3): parity.
// Node children run through a pool (≤ 8 at once, each ≤ 10 min); every row carries the commit, ticks, gameSeconds, diff, hash.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { REPO, parseArgs, startServer, readManifest, headCommit, treeDirty, writeJSON, entryOnly, SOMETHING_OLD_TABLE, withPreF1, PRE_F1 } from './lib.mjs';
import { runPage } from './page.mjs';
import { checkManifest } from './check-manifest.mjs';
import { nodeIds, compareIds } from './check-goldens.mjs';
entryOnly(import.meta.url);  // a battery, not a library — see lib.mjs

// L1's off-profile anchors (results/SUMMARY.md, L1 section at 56c5e34); the 200×0.05 idle anchor is manifest.headless.idleHash.
const ANCHORS = {
  ptr: { idle1000: '86067be644ce481c', policy1000: '5ce24001caa4f31f' },
  something: { idle1000: '5739997ed0e70447', policy1000: '52ffa8d3c5eaba03' },
};
export const MARKS = {
  a1ptr: [['(i) b and g unlocked', 'player.b.unlocked && player.g.unlocked'], ['(ii) keep-upgrade milestones b0 + g0', "hasMilestone('b',0) && hasMilestone('g',0)"], ['(iii) b.best ≥ 15 and g.best ≥ 15', 'player.b.best.gte(15) && player.g.best.gte(15)']],
  a2ptr: [['(i) one of t/e/s unlocked', 'player.t.unlocked || player.e.unlocked || player.s.unlocked'], ['(ii) t ms 3 or s ms 3 (b.auto / g.auto available)', "hasMilestone('t', 3) || hasMilestone('s', 3)"], ['(iii) t, e and s unlocked', 'player.t.unlocked && player.e.unlocked && player.s.unlocked']],
  a1st: [['(i) first fundamental reset (fundamental.total ≥ 1)', 'player.fundamental.total.gte(1)'], ['(ii) unlock:upg:12', "hasUpgrade('unlock', 12)"]],
  a2st: [['(i) primitive reset ≥ 1 (primitive.total ≥ 1)', 'player.primitive.total.gte(1)'], ['(ii) primitive ms 1 ("10 Numbers")', "hasMilestone('primitive', 1)"], ['(iii) primitive ms 2 ("100,000 Numbers")', "hasMilestone('primitive', 2)"]],
};
const KINDS_PINNED = 'kinds=reset,upgrades,buyables;' + PRE_F1;   // F1: named, see lib.mjs
// R1′: every pinned ptr number was measured with `reset:p interval>=10`, which was the TABLE's default until this slice
// moved it to `gain>=2x` (games-auto/ptr.js; ⚖ 13d.2 + S1-2's sweep). A pin is a measurement of a POLICY's behaviour,
// not of which policy the table happens to name, so the ptr pins now name theirs explicitly and stay comparable to the
// baseline commits (whose tables said the same thing). The baseline side is run WITHOUT the opt, as before — at those
// commits `interval>=10` is the table's own answer.
// R1′ moved FOUR ptr defaults, and three of them are inside the pinned kinds (`reset` and `buyables`), so the A2-3 pin —
// which runs past the point where t / e / s exist — moved with them: measured 8137 instead of 8035 at (iii), while (i)
// 3550 and (ii) 6037 were untouched (the divergence begins where e unlocks third). A pin is a measurement of a
// CONFIGURATION, so the ptr pins now name the whole A2 configuration instead of inheriting it: reset:p interval>=10,
// reset:t / e / s interval>=5, buyables:e buy, buyables:t excluded. With that, they are a regression test of the CODE,
// which is what they are for, and they survive any later table move.
const A2_CONFIG = [
  'policy:reset:p=interval>=10',
  'policy:reset:t=interval>=5',
  'policy:reset:e=interval>=5',
  'policy:reset:s=interval>=5',
  'policy:buyables:e=buy',
  'exclude=buyables:t',
].join(';');
const KINDS_PINNED_PTR = KINDS_PINNED + ';' + A2_CONFIG;
// R3c Part 0: the same rule for Something Tree. Its table was DELETED (⚖ user 2026-09-21), and these four pins compare
// HEAD against BASELINE COMMITS whose table said exactly `SOMETHING_OLD_TABLE` — so the pins name that configuration and
// stay a regression test of the CODE. The baseline side runs WITHOUT the opt, as before (at those commits the table's
// own answer). Measured at R3c: the named configuration reproduces the table's leg byte for byte, full hash included.
const KINDS_PINNED_ST = KINDS_PINNED + ';' + SOMETHING_OLD_TABLE;
// Every pinned SUMMARY row: [ticks, full hash] per mark (A1-3 @ 3bc12bf rows 154–169; A2-3 @ b695e47 rows 243–245;
// A2-3 next stall row 260; A2-1 @ 71da72e rows 187–192), and the commit that reproduces it as it was recorded.
const PINS = [
  { key: 'a1-3-ptr', tag: 'A1-3 ptr', id: 'ptr', pinOpt: KINDS_PINNED_PTR, baseline: '3bc12bf', marks: 'a1ptr', o: { diff: 1, ticks: 14000 }, want: [[1361, 'd76c70bf74ede9ba'], [2360, 'f8a1534d326a4840'], [2936, 'dc00ee1692610100']] },
  { key: 'a2-3-ptr', tag: 'A2-3 ptr', id: 'ptr', pinOpt: KINDS_PINNED_PTR, baseline: '17260e03', marks: 'a2ptr', o: { diff: 1, ticks: 30000, 'wall-ms': 540000 }, want: [[3550, '0513ad9b24806ecc'], [6037, 'f226c34064109dcb'], [8035, '67743dd40de0b570']] },
  { key: 'stall-ptr', tag: '§12d stall ptr', id: 'ptr', pinOpt: KINDS_PINNED_PTR, baseline: '17260e03', marks: 'a2ptr', o: { diff: 1, ticks: 30000, 'marks-continue': true, stall: 3600, 'stall-seen': true, 'wall-ms': 540000 }, stall: { ticks: 14131, hash: '46df73d4545bb4e2', lastProgress: 10531 } },
  { key: 'a1-3-st', tag: 'A1-3 something', id: 'something', pinOpt: KINDS_PINNED_ST, baseline: '3bc12bf', marks: 'a1st', o: { diff: 0.05, ticks: 14000 }, want: [[102, 'bf6f8809a163efd8'], [3733, '0253605cd2e69318']] },
  // diff 1 on Something Tree too: a game that unlocks a layer INSIDE gameLoop shows a one-tick timing difference only at
  // a coarse diff (S1's first derived reset unlocked() read tmp.layerShown: 310 / 400 / 580 here — see tmt-auto.js)
  { key: 'a1-3-st-d1', tag: 'A1-3 something diff 1', id: 'something', pinOpt: KINDS_PINNED_ST, baseline: '3bc12bf', marks: 'a1st', o: { diff: 1, ticks: 3000 }, want: [[6, 'c3444d05fd80bba0'], [308, '86da1eaa518021ad']] },
  { key: 'a2-1-st-d1', tag: 'A2-1 something diff 1', id: 'something', pinOpt: KINDS_PINNED_ST, baseline: '71da72e', marks: 'a2st', o: { diff: 1, ticks: 20000, 'wall-ms': 540000 }, want: [[309, '6da92645ec93a9ab'], [399, '53240faafd36f329'], [579, '30d121d791768aa4']] },
  { key: 'a2-1-st', tag: 'A2-1 something', id: 'something', pinOpt: KINDS_PINNED_ST, baseline: '17260e03', marks: 'a2st', o: { diff: 0.05, ticks: 40000, 'wall-ms': 540000 }, want: [[4163, '0c88dcd6b5a9e1cb'], [5963, '5682500e1f849fb8'], [9563, '449775de97d4af2d']] },
];

const a = parseArgs(process.argv.slice(2), ['no-summary']);
// S1T (R12/R13) RECORDER, one-time: `--record <file>` writes what each baseline run produced (the fields the rows read)
// into <file>, merged with what is already there, so the gate can later compare against the recording instead of
// re-running the commit. Removed in the next commit; kept in the archive's history as the regenerator.
const RECORD = a.record ? {} : null;
const projectBase = (b) => ({ ok: b.ok, ...(b.error ? { error: b.error } : {}), ticks: b.ticks, gameSeconds: b.gameSeconds, hash: b.hash, hashGame: b.hashGame,
  marks: b.marks ? Object.fromEntries(Object.entries(b.marks).map(([n, m]) => [n, m ? { ticks: m.ticks, gameSeconds: m.gameSeconds, hash: m.hash, hashGame: m.hashGame } : null])) : null,
  stall: b.stall ? { stalled: b.stall.stalled, walled: b.stall.walled, lastProgress: b.stall.lastProgress ? { ticks: b.stall.lastProgress.ticks } : null } : null,
  featureStates: b.featureStates ?? null });
const PART = String(a.part || '1');
const commit = headCommit(), dirty = treeDirty();
const date = new Date().toISOString().slice(0, 19) + 'Z';
const rows = [];
const row = (r) => { rows.push(r); console.log(`${r.ok ? 'GREEN' : 'RED  '} ${r.gate} ${r.id} ticks=${r.ticks ?? '-'} gs=${r.gameSeconds ?? '-'} diff=${r.diff ?? '-'} hash=${r.hash ?? '-'} ${String(r.notes || '').slice(0, 400)}`); };
const HEADERS = {
  1: 'Reading this section: pinned rows compare TICKS and the game state without player.au (`hashGame`); the full hash includes player.au.clickables (one key per au button), which moves with the number of registered features. Each baseline row re-runs the commit that recorded the SUMMARY row (throwaway worktree, `hashGame` patch only) and must reproduce its tick and FULL hash.',
};

// ---- a pool of run.mjs children (optionally from another checkout) --------------------------------------------------------
const POOL = Number(a.pool || 6);
let running = 0;
const queue = [];
function pump() {
  while (running < POOL && queue.length) {
    const { id, o: o0, root, resolve } = queue.shift();
    // F1: a leg at HEAD names the pre-F1 configuration (no passive yield); a BASELINE tree predates the option
    const o = root === REPO ? withPreF1(o0) : o0;
    running++;
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tmt-loader-s1-')), 'r.json');
    const args = [path.join(root, 'tools/harness/run.mjs'), id, '--json', out];
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined || v === null || v === false) continue;
      if (v === true) args.push(`--${k}`); else args.push(`--${k}`, String(v));
    }
    const c = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    c.on('exit', () => {
      running--;
      try { resolve(JSON.parse(fs.readFileSync(out, 'utf8'))); } catch (e) { resolve({ ok: false, error: `no result: ${err.slice(-400)}` }); }
      pump();
    });
  }
}
const job = (id, o, root = REPO) => new Promise((resolve) => { queue.push({ id, o, root, resolve }); pump(); });
function marksFile(list) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tmt-loader-marks-')), 'marks.json');
  fs.writeFileSync(f, JSON.stringify(list));
  return f;
}
const fmtMark = (m) => (m ? `${m.ticks} ticks / ${m.gameSeconds} s / ${m.hash} (game ${m.hashGame})` : 'NOT MET');
function detailBrief(r) {
  return Object.entries(r.detail || {}).map(([l, o]) => `${l}{${o.unlocked ? '' : 'LOCKED '}pts ${o.points}${o.best ? ' best ' + o.best : ''}; upg [${o.upgrades}]; ms [${o.milestones}]${Object.keys(o.buyables || {}).length ? '; buy ' + JSON.stringify(o.buyables) : ''}; canReset ${o.canReset}${o.canReset ? ' gain ' + o.resetGain : ''}${o.nextAt ? ' nextAt ' + o.nextAt : ''}${o.nextUpgrades?.length ? '; next upg ' + o.nextUpgrades.join(' ') : ''}${o.nextMilestones?.length ? '; next ms ' + o.nextMilestones.join(' | ') : ''}}`).join(' ');
}

// A throwaway worktree at `sha` whose boot.mjs also reports `hashGame` (marks and the final state) — nothing else changes.
const worktrees = [];
function baselineTree(sha) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tmt-loader-baseline-')), sha);
  execFileSync('git', ['-C', REPO, 'worktree', 'add', '--detach', dir, sha], { stdio: 'ignore' });
  worktrees.push(dir);
  const p = path.join(dir, 'tools/harness/boot.mjs');
  let s = fs.readFileSync(p, 'utf8');
  const m1 = '    for (const [n] of MARKS) R.marks[n] = m.hits[n] ? { ticks: m.hits[n].ticks, gameSeconds: m.hits[n].gameSeconds, hash: sha256hex(m.hits[n].json).slice(0, 16) } : null;';
  const m2 = '  R.hook = run(';
  if (!s.includes(m1) || !s.includes(m2)) throw new Error(`baseline ${sha}: boot.mjs does not have the expected marks / hook lines`);
  s = s.replace(m1, "    const exAu = (j) => { const o = JSON.parse(j); delete o.au; return JSON.stringify(o); };\n    for (const [n] of MARKS) R.marks[n] = m.hits[n] ? { ticks: m.hits[n].ticks, gameSeconds: m.hits[n].gameSeconds, hash: sha256hex(m.hits[n].json).slice(0, 16), hashGame: sha256hex(exAu(m.hits[n].json)).slice(0, 16) } : null;");
  s = s.replace(m2, "  R.hashGame = await run(`tmtLoader.hash({ exclude: ['au'] })`, 'hash');\n  R.featureStates = run('(tmtLoader.features || []).map(f => { const s = tmtLoader.featureState(f.id); return [f.id, s.unlocked, s.policy]; })', 'x');\n" + m2);
  // A historical tree cannot boot on modern Node: its boot.mjs installs the shims with
  // `Object.assign(globalThis, shims)`, and Node 21+ defines `navigator` (and `crypto`, `performance`) as
  // GETTER-ONLY accessors, so the assign throws and the BASELINE leg of every pin reads `undefined`. Measured:
  // 34 of 52 rows red on that alone, with the current tree reproducing the recorded game states all along. The
  // same one-line repair as the live boot.mjs (see its comment there), applied to whatever old tree we check out
  // — a baseline is only useful if it still runs.
  const ASSIGN = 'Object.assign(globalThis, shims);';
  if (s.includes(ASSIGN)) {
    s = s.replace(ASSIGN, 'for (const [k, v] of Object.entries(shims)) { try { globalThis[k] = v; } catch { Object.defineProperty(globalThis, k, { value: v, writable: true, enumerable: true, configurable: true }); } }');
  }
  fs.writeFileSync(p, s);
  return dir;
}
function removeTrees() {
  for (const d of worktrees) { try { execFileSync('git', ['-C', REPO, 'worktree', 'remove', '--force', d], { stdio: 'ignore' }); } catch {} }
  try { execFileSync('git', ['-C', REPO, 'worktree', 'prune'], { stdio: 'ignore' }); } catch {}
}

async function offAnchors(tag, id) {
  const m = readManifest(id);
  const census = m.headless.idleHash;
  const legs = [['idle', census.ticks, census.hash], ['idle', 1000, ANCHORS[id].idle1000], ['policy', 1000, ANCHORS[id].policy1000]];
  const rs = await Promise.all(legs.flatMap(([leg, ticks]) => [job(id, { ticks, diff: 0.05, leg, exclude: 'au' }), job(id, { ticks, diff: 0.05, leg, 'no-automation': true })]));
  legs.forEach(([leg, ticks, want], i) => {
    const r = rs[2 * i], q = rs[2 * i + 1];
    row({ gate: `${tag} anchor (automation, exclude au, profile off)`, id, leg, ok: !!r.ok && r.hash === want && r.profile === 'off' && !r.file_errors?.length, ticks: r.ticks, gameSeconds: r.gameSeconds, diff: 0.05, hash: r.hash,
      notes: `L1 anchor ${want}; features registered ${r.features?.length ?? 0}${r.file_errors?.length ? '; FILE ERRORS ' + JSON.stringify(r.file_errors) : ''}` });
    row({ gate: `${tag} anchor (--no-automation, contract only)`, id, leg, ok: !!q.ok && q.hash === want && q.automation === false && !q.features?.length && !q.file_errors?.length, ticks: q.ticks, gameSeconds: q.gameSeconds, diff: 0.05, hash: q.hash,
      notes: `L1 anchor ${want}; automation ${q.automation}; features ${q.features?.length ?? 0}` });
  });
  const live = nodeIds(id);
  const golden = JSON.parse(fs.readFileSync(path.join(REPO, `tools/harness/goldens/${id}.ids.json`), 'utf8'));
  const c = compareIds(golden, live);
  row({ gate: `${tag} check-goldens unchanged`, id, ok: c.ok, ticks: 0, gameSeconds: 0, diff: null, hash: null, notes: `${live.ids.length} ids, ${Object.keys(live.layers).length} layers${c.ok ? '' : ' ' + JSON.stringify(c).slice(0, 300)}` });
  const cm = checkManifest(id);
  row({ gate: `${tag} check-manifest`, id, ok: cm.ok, ticks: 0, gameSeconds: 0, diff: null, hash: null, notes: cm.ok ? `${cm.scripts} scripts, ${cm.modFiles} modFiles, games/${id} pristine${m.auto ? `, auto ${m.auto}` : ''}` : JSON.stringify(cm.problems).slice(0, 300) });
}

// ---- Part 1 ----------------------------------------------------------------------------------------------------------
// part 1s: only the §12d stall pair (baseline + S1), so the two 9-min-walled detector runs get whole cores
const noWall = (o) => { const { 'wall-ms': _w, ...rest } = o; return rest; };
// RECORD MODE: the baseline side only, and with NO wall — a wall only ever cuts a run short, and a run cut by machine
// load is not a recording of what the baseline produces
async function recordBaselines(pins, fresh) {
  const trees = {};
  for (const sha of [...new Set(pins.map((p) => p.baseline).concat(fresh ? ['17260e03'] : []))]) trees[sha] = baselineTree(sha);
  const jobs = pins.map((p) => job(p.id, noWall({ profile: 'all', ...p.o, marks: marksFile(MARKS[p.marks]) }), trees[p.baseline]).then((b) => { RECORD[p.key] = projectBase(b); }));
  if (fresh) for (const id of ['ptr', 'something']) jobs.push(job(id, { ticks: 0, diff: 1 }, trees['17260e03']).then((o) => { RECORD[`fresh:${id}`] = projectBase(o); }));
  await Promise.all(jobs);
}
async function part1s() {
  const pins = PINS.filter((p) => p.stall);
  if (RECORD) return recordBaselines(pins, false);
  const tree = baselineTree(pins[0].baseline);
  await pinnedRows(pins.map((p) => {
    const o = { profile: 'all', ...p.o, marks: marksFile(MARKS[p.marks]) };
    return { p, s1: job(p.id, { ...o, 'auto-opt': p.pinOpt || KINDS_PINNED }), base: job(p.id, o, tree) };
  }));
}
async function part1(browser, base) {
  if (RECORD) return recordBaselines(PINS.filter((p) => !p.stall), true);
  const trees = {};
  const pins = PINS.filter((p) => !p.stall);
  for (const sha of [...new Set(pins.map((p) => p.baseline).concat(['17260e03']))]) trees[sha] = baselineTree(sha);
  const runs = pins.map((p) => {
    const mf = marksFile(MARKS[p.marks]);
    const o = { profile: 'all', ...p.o, marks: mf };
    return { p, s1: job(p.id, { ...o, 'auto-opt': p.pinOpt || KINDS_PINNED }), base: job(p.id, o, trees[p.baseline]) };
  });
  // R3c Part 0: the fresh-boot row compares each feature's policy with the 17260e03 TABLE's — a baseline comparison, so
  // Something Tree's side names the deleted table (CI run 35565198991 at `c5df909dc` found this row, not the brief)
  const fresh = ['ptr', 'something'].map((id) => ({ id, s1: job(id, { ticks: 0, diff: 1, ...(id === 'something' ? { 'auto-opt': SOMETHING_OLD_TABLE } : {}) }), old: job(id, { ticks: 0, diff: 1 }, trees['17260e03']) }));
  const omega = job('the-omega-tree', { profile: 'all', diff: 1, ticks: 3000, stall: 3600, 'stall-seen': true, 'wall-ms': 540000 });
  await offAnchors('S1-1', 'ptr');
  await offAnchors('S1-1', 'something');
  await pinnedRows(runs);
  await part1rest(browser, base, fresh, omega);
}
async function pinnedRows(runs) {
  for (const { p, s1, base: bp } of runs) {
    const [r, b] = await Promise.all([s1, bp]);
    if (RECORD) RECORD[p.key] = projectBase(b);
    if (p.want) {
      MARKS[p.marks].forEach(([n], i) => {
        const [wt, wh] = p.want[i];
        const x = r.marks?.[n], y = b.marks?.[n];
        const baseOk = !!b.ok && y && y.ticks === wt && y.hash === wh;
        row({ gate: `S1-1 baseline ${p.tag} ${n} @ ${p.baseline}`, id: p.id, leg: 'profile all', ok: !!baseOk, ticks: y?.ticks, gameSeconds: y?.gameSeconds, diff: p.o.diff, hash: y?.hash,
          notes: `SUMMARY ${wt} ticks / ${wh}; baseline ${fmtMark(y)}${b.error ? '; ' + b.error : ''}` });
        const ok = baseOk && !!r.ok && x && x.ticks === wt && x.hashGame === y.hashGame;
        row({ gate: `S1-1 pinned ${p.tag} ${n} (${p.pinOpt || KINDS_PINNED})`, id: p.id, leg: 'profile all', ok: !!ok, ticks: x?.ticks, gameSeconds: x?.gameSeconds, diff: p.o.diff, hash: x?.hash,
          notes: `game state ${x?.hashGame} vs baseline ${y?.hashGame} — equal ${x?.hashGame === y?.hashGame}; ticks ${x?.ticks} vs SUMMARY ${wt}; features ${r.features?.length}; actions ${JSON.stringify(r.hook?.actions)}${r.error ? '; ' + r.error : ''}` });
      });
    } else {
      const w = p.stall;
      const baseOk = !!b.ok && b.ticks === w.ticks && b.hash === w.hash && b.stall?.lastProgress?.ticks === w.lastProgress && b.stall?.stalled && !b.stall?.walled;
      row({ gate: `S1-1 baseline ${p.tag} @ ${p.baseline}`, id: p.id, leg: 'profile all', ok: baseOk, ticks: b.ticks, gameSeconds: b.gameSeconds, diff: 1, hash: b.hash,
        notes: `SUMMARY stalled ${w.ticks} / ${w.hash} / last progress ${w.lastProgress}; baseline stalled ${b.stall?.stalled} walled ${b.stall?.walled} last progress ${b.stall?.lastProgress?.ticks}; game ${b.hashGame}${b.error ? '; ' + b.error : ''}` });
      const ok = baseOk && !!r.ok && r.ticks === w.ticks && r.hashGame === b.hashGame && r.stall?.lastProgress?.ticks === w.lastProgress && r.stall?.stalled && !r.stall?.walled;
      row({ gate: `S1-1 pinned ${p.tag} (${p.pinOpt || KINDS_PINNED})`, id: p.id, leg: 'profile all', ok, ticks: r.ticks, gameSeconds: r.gameSeconds, diff: 1, hash: r.hash,
        notes: `stalled ${r.stall?.stalled} walled ${r.stall?.walled}; last progress ${r.stall?.lastProgress?.ticks}; game state ${r.hashGame} vs baseline ${b.hashGame} — equal ${r.hashGame === b.hashGame}; marks ${Object.entries(r.marks || {}).map(([n, m]) => `${n}: ${m?.ticks}/${m?.hashGame}`).join(' · ')}; actions ${JSON.stringify(r.hook?.actions)}; state: ${detailBrief(r)}` });
      writeJSON(path.join(REPO, 'tools/harness/results/tmp/s1-1-ptr-stall.json'), r);
    }
  }
}
// The default moves R1′ made deliberately, with the gate that measured each one. A policy change NOT in this table is
// still a RED: the row's job is to catch an UNINTENDED move, and a default that moves without a measurement behind it is
// exactly that (⚖ minimize hardcoding cuts both ways — a table value needs provenance, and so does a change to one).
const INTENDED_WHY = 'plan §14d: R1′-1 (a) / R1′-2.3 / R1′-3';
const INTENDED_MOVES = {
  ptr: {
    'reset:p': 'gain>=2x',                          // S1-2's sweep + P1b control (iii); R1′-3's opening row
    'reset:t': 'always',                            // R1′-2.3: M16 24212 against interval>=5's 24236, constant-free
    'reset:s': 'always',                            // R1′-2.3: M16 24203 against 24236
    'reset:e': 'gain>=2x',                          // R1′-2.3: the only value that reaches M12–M16 at all
    'buyables:e': 'reserve>=next-upgrade',          // R1′-1 (a): the e half of M12
  },
};
async function part1rest(browser, base, fresh, omega) {

  // fresh boot: each old feature's Locked state (unlocked()) vs the derived feature of the same id; the new ids listed
  for (const { id, s1, old } of fresh) {
    const [r, o] = await Promise.all([s1, old]);
    if (RECORD) RECORD[`fresh:${id}`] = projectBase(o);
    const now = Object.fromEntries((r.featureStates || []).map(([fid, u, pol]) => [fid, [u, pol]]));
    const diffs = [], same = [], intended = [];
    for (const [fid, u, pol] of o.featureStates || []) {
      if (!now[fid]) { diffs.push(`${fid} MISSING`); continue; }
      if (now[fid][0] !== u) diffs.push(`${fid} unlocked ${u}→${now[fid][0]}`); else same.push(fid);
      if (now[fid][1] !== pol) (INTENDED_MOVES[id]?.[fid] === now[fid][1] ? intended : diffs).push(`${fid} policy ${pol}→${now[fid][1]}`);
    }
    const oldIds = new Set((o.featureStates || []).map((x) => x[0]));
    const added = (r.featureStates || []).filter(([fid]) => !oldIds.has(fid));
    row({ gate: 'S1-1 fresh boot: Locked/Off per feature, 17260e03 table vs derived', id, ok: !!r.ok && !!o.ok && diffs.length === 0 && o.featureStates?.length > 0, ticks: 0, gameSeconds: 0, diff: null, hash: r.hash,
      notes: `${same.length}/${o.featureStates?.length} old features same unlocked + policy${intended.length ? '; INTENDED (R1′, ' + INTENDED_WHY + ') ' + intended.join(', ') : ''}${diffs.length ? '; DIFFER ' + diffs.join(', ') : ''}; ${added.length} derived features added: unlocked ${added.filter((x) => x[1]).map((x) => x[0]).join(' ') || '—'}; locked ${added.filter((x) => !x[1]).length}; excluded ${JSON.stringify(r.excluded)}; derivation ${JSON.stringify(r.derivation)}` });
  }

  // the predicate compiler (tmtLoader.predicate, new Function) ≡ the harness's --until (vm / page.evaluate) on the same
  // string at every tick: the until predicate is TRUE only if the two disagree; the mark records when the value turned true
  {
    const SRC = "player.p.points.gte(5) && hasUpgrade('p', 11)";
    const until = `tmtLoader.predicate(${JSON.stringify(SRC)})() !== (${SRC})`;
    const n = await job('ptr', { profile: 'all', diff: 1, ticks: 300, until, marks: marksFile([['src', SRC]]), 'marks-continue': true, 'wall-ms': 60000 });
    const pg = await runPage(browser, base, 'ptr', { profile: 'all', ticks: 300, diff: 1, until });
    const probe = await runPage(browser, base, 'ptr', { profile: 'all', ticks: n.marks?.src?.ticks ?? 1, diff: 1, until: null });
    row({ gate: 'S1-1 predicate compiler ≡ --until (node and page)', id: 'ptr', leg: 'profile all', ok: !!n.ok && n.until?.met === false && n.until?.errors === 0 && pg.until?.met === false && !!n.marks?.src && probe.hash === n.marks.src.hash, ticks: n.ticks, gameSeconds: n.gameSeconds, diff: 1, hash: n.hash,
      notes: `"${SRC}": disagreement met — node ${n.until?.met} (errors ${n.until?.errors}), page ${pg.until?.met}, over ${n.ticks} / ${pg.ticks} ticks; the value turned true at ${fmtMark(n.marks?.src)}; page at that tick ${probe.hash}` });
  }

  // generality probe: a game with NO table
  {
    const r = await omega;
    const acts = r.hook?.actions || {};
    row({ gate: 'S1-1 no table: the-omega-tree derived defaults (informative)', id: 'the-omega-tree', leg: 'profile all', ok: !!r.ok && !r.file_errors?.length && r.policy_errors === undefined, ticks: r.ticks, gameSeconds: r.gameSeconds, diff: 1, hash: r.hash,
      notes: `auto ${r.auto ?? 'none'}; features ${r.features?.length} (${JSON.stringify(r.derivation)}); stalled ${r.stall?.stalled} walled ${r.stall?.walled} last progress ${r.stall?.lastProgress?.gameSeconds} s; actions ${JSON.stringify(acts)}; unlocked ${JSON.stringify(r.summary?.unlocked)}; state: ${detailBrief(r)}${r.error ? '; ' + r.error : ''}` });
    writeJSON(path.join(REPO, 'tools/harness/results/tmp/s1-1-omega.json'), r);
  }
}

// ---- Part 2 ----------------------------------------------------------------------------------------------------------
MARKS.frontier = [
  ["t ms 3", "hasMilestone('t', 3)"],
  ["s ms 3", "hasMilestone('s', 3)"],
  ["player.b.auto === true", 'player.b.auto === true'],
  ["player.g.auto === true", 'player.g.auto === true'],
  ...MARKS.a2ptr,
];
const FRONTIER_O = { profile: 'all', diff: 1, ticks: 100000, 'marks-continue': true, stall: 3600, 'stall-seen': true, 'wall-ms': 540000 };
// the planner's addendum (2026-09-15, from the walkthrough digest): Space Buildings highest-first, Enhancers saving for e upgrades
const FRONTIER_ALT = 'policy:buyables:s=highest-first;policy:buyables:e=buy-unless-saving';
function frontierRow(tag, r) {
  const M = r.marks || {};
  const at = (n) => M[n]?.ticks;
  const yieldRow = (auto, reset, ms) => {
    const m = M[auto];
    if (!m) return `${auto} NOT MET`;
    const before = m.actions?.[reset] ?? 0, after = r.hook?.actions?.[reset] ?? 0;
    return `${auto} at ${m.ticks} (${ms} at ${at(ms)}: +${m.ticks - at(ms)} tick); ${reset} ${before} at that tick → ${after} at the end (stopped growing: ${before === after})`;
  };
  const okYield = (auto, reset, ms) => !M[auto] || (M[auto].ticks - at(ms) <= 1 && (M[auto].actions?.[reset] ?? 0) === (r.hook?.actions?.[reset] ?? 0));
  const ok = !!r.ok && r.hook?.doubles === 0 && okYield('player.b.auto === true', 'reset:b', 't ms 3') && okYield('player.g.auto === true', 'reset:g', 's ms 3');
  row({ gate: tag, id: 'ptr', leg: 'profile all', ok, ticks: r.ticks, gameSeconds: r.gameSeconds, diff: 1, hash: r.hash,
    notes: `stalled ${r.stall?.stalled}, wall-bounded ${r.stall?.walled}; LAST PROGRESS ${r.stall?.lastProgress?.ticks} (${r.stall?.lastProgress?.gameSeconds} s); game state ${r.hashGame}; doubles ${r.hook?.doubles}; ${yieldRow('player.g.auto === true', 'reset:g', 's ms 3')}; ${yieldRow('player.b.auto === true', 'reset:b', 't ms 3')}; marks ${Object.entries(M).map(([n, m]) => `${n}: ${m ? m.ticks : 'NOT MET'}`).join(' · ')}; points ${r.summary?.points}; actions ${JSON.stringify(r.hook?.actions)}; challenges ${JSON.stringify(r.hook?.challenges)}; state: ${detailBrief(r)}${r.error ? '; ' + r.error : ''}` });
}
// Challenges smoke: (a) a fork whose first challenge is reachable from a fresh game (The Challenge Tree, TMT 2.6.6.2:
// cp 11 "1. Pointer", goal 32 points, unlocked from the start); (b) and (c) unit-drives on PTR (2.2.1, h 11 "Upgrade Desert",
// goal 1e1325 points) and Something Tree (2.7, arithmetic 11 "Beginner's Demise", goal 1e130 Fundamentality), whose challenge
// layers no run reaches inside a wall: a real snapshot edited to (A) unlock the layer (PTR: h.unlocked; Something Tree
// re-derives arithmetic.unlocked from unlock upgrade 13 every tick, unlock.js:422) and the challenge (arithmetic upg 17), 100
// ticks — the feature enters; then (B) that run's player with the goal currency set past the goal, 100 ticks — it completes.
const tmpFile = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tmt-loader-s1-ch-')), name);
async function unitDrive(id, layer, ch, editA, editB) {
  const snap = tmpFile('snap.json'), pa = tmpFile('a.json'), pb = tmpFile('b.json'), ra = tmpFile('ra.json');
  const s0 = await job(id, { ticks: 20, diff: 1, 'player-out': snap });
  const P = JSON.parse(fs.readFileSync(snap, 'utf8'));
  editA(P);
  fs.writeFileSync(pa, JSON.stringify(P));
  const opt = `kinds=challenges;policy:challenges:${layer}=sequential`;
  const A = await job(id, { profile: 'all', diff: 1, ticks: 100, 'load-from': pa, 'auto-opt': opt, 'player-out': ra });
  const PA = A.ok ? JSON.parse(fs.readFileSync(ra, 'utf8')) : null;
  if (PA) { editB(PA); fs.writeFileSync(pb, JSON.stringify(PA)); }
  const rb = tmpFile('rb.json');
  const B = PA ? await job(id, { profile: 'all', diff: 1, ticks: 100, 'load-from': pb, 'auto-opt': opt, 'player-out': rb }) : { ok: false, error: 'stage A failed' };
  const PB = B.ok ? JSON.parse(fs.readFileSync(rb, 'utf8')) : null;
  const fid = `challenges:${layer}`;
  const chA = A.hook?.challenges?.[fid], chB = B.hook?.challenges?.[fid];
  const ok = !!s0.ok && !!A.ok && !!B.ok && chA?.enter === 1 && chA?.exit === 0 && String(PA?.[layer]?.activeChallenge) === String(ch)
    && chB?.exit >= 1 && Number(PB?.[layer]?.challenges?.[ch]) === 1;
  row({ gate: `S1-2 challenges smoke (unit-drive, ${id} ${layer} ${ch})`, id, leg: `kinds=challenges, sequential`, ok, ticks: (A.ticks ?? 0) + (B.ticks ?? 0), gameSeconds: (A.gameSeconds ?? 0) + (B.gameSeconds ?? 0), diff: 1, hash: B.hash,
    notes: `A (snapshot @20 ticks, edited): enters ${chA?.enter} exits ${chA?.exit}, activeChallenge ${PA?.[layer]?.activeChallenge}, completions ${JSON.stringify(PA?.[layer]?.challenges?.[ch])}; B (A's player, goal currency past the goal): enters ${chB?.enter} exits ${chB?.exit}, completions ${ch}: ${JSON.stringify(PB?.[layer]?.challenges?.[ch])}, activeChallenge now ${PB?.[layer]?.activeChallenge}; errors ${[s0.error, A.error, B.error].filter(Boolean).join(' / ') || 'none'}` });
}
async function part2() {
  const mf = marksFile(MARKS.frontier);
  const f1 = job('ptr', { ...FRONTIER_O, marks: mf });
  const f2 = job('ptr', { ...FRONTIER_O, marks: mf, 'auto-opt': FRONTIER_ALT });
  // (a) a real run
  const ctMarks = marksFile([['cp 11 entered', "player.cp.activeChallenge == 11"], ['cp 11 completed', "hasChallenge('cp', 11)"]]);
  const ct = job('the-challenge-tree', { profile: 'all', diff: 0.05, ticks: 20000, marks: ctMarks, 'wall-ms': 300000, 'auto-opt': 'policy:challenges:cp=sequential' });
  await unitDrive('ptr', 'h', 11, (P) => { P.h.unlocked = true; }, (P) => { P.points = '1e1400'; });
  await unitDrive('something', 'arithmetic', 11, (P) => { P.unlock.upgrades = (P.unlock.upgrades || []).concat([13]); P.arithmetic.unlocked = true; P.arithmetic.upgrades = (P.arithmetic.upgrades || []).concat([17]); }, (P) => { P.fundamental.points = '1e140'; });
  {
    const r = await ct;
    const m = r.marks || {};
    row({ gate: 'S1-2 challenges smoke (a real run: the-challenge-tree cp 11, TMT 2.6.6.2)', id: 'the-challenge-tree', leg: 'profile all, challenges:cp sequential', ok: !!r.ok && !!m['cp 11 entered'] && !!m['cp 11 completed'], ticks: r.ticks, gameSeconds: r.gameSeconds, diff: 0.05, hash: r.hash,
      notes: `entered ${fmtMark(m['cp 11 entered'])}; completed ${fmtMark(m['cp 11 completed'])}; challenges ${JSON.stringify(r.hook?.challenges)}; actions ${JSON.stringify(r.hook?.actions)}; features ${r.features?.length}${r.error ? '; ' + r.error : ''}` });
  }
  const r1 = await f1;
  frontierRow('S1-2 S1 FRONTIER: ptr, every derived kind on (profile all), fresh game (monotone detector, 3600 game-s, 9-min wall)', r1);
  writeJSON(path.join(REPO, 'tools/harness/results/tmp/s1-2-ptr-frontier.json'), r1);
  const r2 = await f2;
  frontierRow(`S1-2 frontier, informative: ${FRONTIER_ALT}`, r2);
  writeJSON(path.join(REPO, 'tools/harness/results/tmp/s1-2-ptr-frontier-alt.json'), r2);
}

// Sweeps (diff 1, objective = game-seconds to the existing marks; defaults in the tables do not change in S1). Each value
// once, the candidate table-less default (gain>=2x) twice (equal). A value that never reaches ends on the monotone
// detector (3600 game-s) or the wall.
const SWEEPS = {
  '2s-p': { id: 'ptr', feature: 'reset:p', marks: 'a1ptr', ticks: 14000, values: ['interval>=10', 'gain>=2x', 'gain>=4x', 'unlocks-purchase', 'always'], def: 'interval>=10', note: 'A1-3 at diff 1: 1361 / 2360 / 2936' },
  '2s-f': { id: 'something', feature: 'reset:fundamental', marks: 'a1st', ticks: 14000, values: ['interval>=5', 'gain>=2x', 'gain>=4x', 'unlocks-purchase', 'always'], def: 'interval>=5', base: SOMETHING_OLD_TABLE, note: 'A1-3 at diff 1: (i) 6, (ii) 308' },
  '2s-q': { id: 'something', feature: 'reset:primitive', marks: 'a2st', ticks: 20000, values: ['interval>=90', 'gain>=2x', 'gain>=4x', 'unlocks-purchase'], def: 'interval>=90', base: SOMETHING_OLD_TABLE, note: 'A2-1 at diff 1: 309 / 399 / 579' },
};
const TABLELESS = 'gain>=2x';
// R3c Part 0: a Something Tree sweep varies ONE feature against the rest of the table it was measured beside; that
// table is deleted, so the sweep names it (`base`, the later `policy:` key wins) — otherwise every value would move.
async function part2s(key) {
  const S = SWEEPS[key];
  const M = MARKS[S.marks], mf = marksFile(M);
  const o = { profile: 'all', diff: 1, ticks: S.ticks, marks: mf, stall: 3600, 'stall-seen': true, 'wall-ms': 540000 };
  const vals = [...S.values, TABLELESS];
  const rs = vals.map((v) => [v, job(S.id, { ...o, 'auto-opt': `${S.base ? S.base + ';' : ''}policy:${S.feature}=${v}` })]);
  const done = [];
  for (const [v, p] of rs) done.push([v, await p]);
  const gs = (m) => (m ? m.gameSeconds : null);
  const fmt = (r) => M.map(([n]) => gs(r.marks?.[n]) ?? 'NOT MET').join(' / ');
  const twice = done.filter(([v]) => v === TABLELESS);
  const equal = twice.length === 2 && JSON.stringify(twice[0][1].marks) === JSON.stringify(twice[1][1].marks) && twice[0][1].hash === twice[1][1].hash && twice[0][1].ticks === twice[1][1].ticks;
  done.forEach(([v, r], i) => {
    const second = v === TABLELESS && i === done.length - 1;
    row({ gate: `S1-2 sweep ${S.feature} ${v}${v === S.def ? ' (table default)' : ''}${v === TABLELESS ? (second ? ' — second run (table-less default candidate)' : ' (table-less default candidate)') : ''}`, id: S.id, leg: 'profile all', ok: !!r.ok && (!second || equal), ticks: r.ticks, gameSeconds: r.gameSeconds, diff: 1, hash: r.hash,
      notes: `game-s to ${M.map(([n]) => n).join(' / ')}: ${fmt(r)} (${S.note}); ${second ? `equal to the first ${equal}; ` : ''}ended: ${r.stall?.stalled ? 'stalled' : r.stall?.walled ? 'wall-bounded' : 'all marks met'} (last progress ${r.stall?.lastProgress?.gameSeconds} s); ${S.feature} ${r.hook?.actions?.[S.feature] ?? 0}${r.error ? '; ' + r.error : ''}` });
  });
}

// Part 2k (informative): the generic kind order (plan §5b: purchases first, the reset last) against the tables'
// reset-first order, on the pinned marks at diff 1 — the basis for the derivation's generic default.
const GENERIC_KIND_ORDER = 'toggles,upgrades,buyables,challenges,clickables,reset';
async function part2k() {
  const sets = [['ptr', 'a1ptr', 14000, '1361 / 2360 / 2936'], ['something', 'a1st', 3000, '6 / 308'], ['something', 'a2st', 20000, '309 / 399 / 579']];
  const rs = sets.map(([id, mk, ticks]) => {
    const o = { profile: 'all', diff: 1, ticks, marks: marksFile(MARKS[mk]), stall: 3600, 'stall-seen': true, 'wall-ms': 540000 };
    // R3c Part 0: "the table's reset-first order" on Something Tree is the deleted table, named; its kindOrder is
    // overridden by the later key on the generic leg
    const base = id === 'something' ? SOMETHING_OLD_TABLE : null;
    return [job(id, base ? { ...o, 'auto-opt': base } : o), job(id, { ...o, 'auto-opt': `${base ? base + ';' : ''}kindOrder=${GENERIC_KIND_ORDER}` })];
  });
  for (let i = 0; i < sets.length; i++) {
    const [id, mk, , summary] = sets[i];
    const [t, g] = await Promise.all(rs[i]);
    const fmt = (r) => MARKS[mk].map(([n]) => r.marks?.[n]?.gameSeconds ?? 'NOT MET').join(' / ');
    row({ gate: `S1-2k kind order: generic (${GENERIC_KIND_ORDER}) vs the table's reset-first`, id, leg: `profile all, marks ${mk}`, ok: !!t.ok && !!g.ok, ticks: g.ticks, gameSeconds: g.gameSeconds, diff: 1, hash: g.hash,
      notes: `game-s to ${MARKS[mk].map(([n]) => n).join(' / ')}: generic ${fmt(g)} vs table order ${fmt(t)} (SUMMARY ${summary}); generic ended ${g.stall?.stalled ? 'stalled' : g.stall?.walled ? 'wall-bounded' : 'all marks met'}; actions generic ${JSON.stringify(g.hook?.actions)}` });
  }
}

// ---- Part 3 ----------------------------------------------------------------------------------------------------------
// Node ≡ page with the derived tables: ptr at A2-3 (i)'s tick under profile all; something at A2-1 (ii)'s tick under
// profile all; something 1000×0.05 idle at profile off (§11e.12: on 2.7 an extra updateTemp() between ticks moves
// player — node and page equal here means nothing S1 added calls it). The L1 battery is gates.mjs, run separately.
async function part3(browser, base) {
  const { parity, classifyDifferences } = await import('./parity.mjs');
  // The ptr row runs the A2 configuration (KINDS_PINNED_PTR's policy set without the kinds restriction): bit-equality
  // is a claim about the CODE, and it must not move when a table default does.
  for (const [id, ticks, diff, profile, autoOpt] of [['ptr', 3550, 1, 'all', A2_CONFIG], ['something', 5963, 0.05, 'all', null], ['something', 1000, 0.05, 'off', null]]) {
    const p = await parity(id, { ticks, diff, leg: 'idle', base, browser, profile, autoOpt });
    const same = JSON.stringify(p.node?.hook) === JSON.stringify(p.page?.hook);
    row({ gate: `S1-3 parity node≡page, profile ${profile}, derived table${autoOpt ? ' (the A2 policy set, named)' : ''}`, id, leg: `idle, profile ${profile}`, ok: !!p.ok && same, ticks: p.ticks, gameSeconds: p.gameSeconds, diff, hash: p.node?.hash,
      notes: p.ok ? `page ${p.page.hash} in ${p.page.ms} ms; hookStats equal ${same}; hooked ${p.node?.hook?.hooked?.length}; actions ${JSON.stringify(p.node?.hook?.actions)}` : `DIVERGED ${JSON.stringify(p.divergence || p.error).slice(0, 300)}` });
  }
  // R1′: ptr at the SHIPPED table is not bit-equal past ~3400 ticks — `player.points` differs by ONE ULP
  // (5.661628996916917e108 vs …18e108 at 3550, reproduced twice; equal at 3200 and 3400). The cause is the game's own
  // arithmetic, not the automation: once row 2's space buildings are live the formulas use fractional `Decimal.pow`,
  // whose mantissa goes through V8's transcendentals, and those are not bit-identical between Node's V8 and Chromium's.
  // The claim this row makes is therefore NOT "equal" but "equal in BEHAVIOUR": every difference is a relative 1e-15
  // rounding difference in a number, the tick and game-second counts agree, and the hook statistics are identical. A
  // page that played the game differently would put a `real` difference in the list and red the row.
  {
    const p = await parity('ptr', { ticks: 3550, diff: 1, leg: 'idle', base, browser, profile: 'all' });
    const same = JSON.stringify(p.node?.hook) === JSON.stringify(p.page?.hook);
    const cls = p.nodeJson ? classifyDifferences(p.nodeJson, p.pageJson) : { ulp: [], real: [] };
    const ok = !!p.node && !!p.page && p.node.ticks === p.page.ticks && p.node.gameSeconds === p.page.gameSeconds && same && cls.real.length === 0;
    row({ gate: 'S1-3 parity node≡page at the SHIPPED table: every difference is one ULP, not behaviour', id: 'ptr', leg: 'idle, profile all, no --auto-opt', ok, ticks: p.ticks, gameSeconds: p.gameSeconds, diff: 1, hash: p.node?.hash,
      notes: `${p.ok ? 'bit-equal' : 'NOT bit-equal'}; differences: ${cls.ulp.length} ULP (rel ≤ 1e-15), ${cls.real.length} real${cls.ulp.length ? ' — ' + cls.ulp.slice(0, 4).map((d) => `${d.path} ${d.a} vs ${d.b}`).join(', ') : ''}${cls.real.length ? ' — REAL: ' + cls.real.slice(0, 4).map((d) => `${d.path} ${d.a} vs ${d.b}`).join(', ') : ''}; ticks ${p.node?.ticks}/${p.page?.ticks}, game-s ${p.node?.gameSeconds}/${p.page?.gameSeconds}; hookStats equal ${same}; page ${p.page?.hash} in ${p.page?.ms} ms` });
  }
}

const browser = await chromium.launch();
const server = await startServer(REPO);
const base = server.url;
try {
  if (PART === '1') await part1(browser, base);
  else if (PART === '1s') await part1s();
  else if (PART === '2') await part2();
  else if (PART === '3') await part3(browser, base);
  else if (PART === '2k') await part2k();
  else if (SWEEPS[PART]) await part2s(PART);
  else throw new Error(`no part ${PART}`);
} finally {
  await browser.close();
  server.stop();
  removeTrees();
  if (RECORD) {
    const prev = fs.existsSync(a.record) ? JSON.parse(fs.readFileSync(a.record, 'utf8')) : {};
    fs.writeFileSync(a.record, JSON.stringify({ ...prev, ...RECORD }, null, 1) + '\n');
    console.log(`recorded ${Object.keys(RECORD).length} baseline result(s) → ${a.record}`);
  }
}

const SUMMARY = path.join(REPO, 'tools/harness/results/SUMMARY.md');
const cell = (v) => (v === null || v === undefined ? '—' : String(v).replace(/\|/g, '\\|'));
let md = `\n## ${date} — S1 part ${PART} (\`node tools/harness/gates-s1.mjs --part ${PART}\`) — commit \`${commit}\`${dirty ? ' (tree DIRTY)' : ''} — ${rows.filter((r) => r.ok).length}/${rows.length} green\n\n${HEADERS[PART] ? HEADERS[PART] + '\n\n' : ''}| gate | game | leg | ticks | gameSeconds | diff | hash | result | notes |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${cell(r.gate)} | ${r.id} | ${cell(r.leg)} | ${cell(r.ticks)} | ${cell(r.gameSeconds)} | ${cell(r.diff)} | ${r.hash ? '`' + r.hash + '`' : '—'} | ${r.ok ? 'GREEN' : '**RED**'} | ${cell(r.notes)} |\n`;
if (!a['no-summary']) fs.appendFileSync(SUMMARY, md);
writeJSON(path.join(REPO, `tools/harness/results/tmp/gates-s1-part${PART}-last.json`), { date, commit, dirty, rows });
console.log(`gates-s1 part ${PART}: ${rows.filter((r) => r.ok).length}/${rows.length} green`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);
