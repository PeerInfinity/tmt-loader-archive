// Runs the L1 gates G1–G4 for every game, then the repo-wide G6, and appends one row per gate to results/SUMMARY.md.
//   node gates.mjs [<id>...] [--only G1,G2,G3,G4,G6] [--no-automation]
// G6/G7 are repo-wide: the roster doc, and manifests/declined.json (a game we declined must not also be hosted).
// G5 is not here: it needs a bare `git clone` served from a sub-path, so it lives in tools/check-pages.mjs. M1
// (the mobile layout) likewise lives in page.mjs --gate mobile, which drives its own phone-sized touch context.
// G6 is repo-wide rather than per-game, so it runs once, after the loop, with no id of its own.
// Automation (?automation=1) is ON by default: G1 loads with the flag, G3's census hash and G2c exclude `au`.
// Every row carries the commit, ticks, gameSeconds, diff and hash of the state it claims.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { REPO, GAMES, parseArgs, startServer, readManifest, headCommit, treeDirty, writeJSON, firstDivergence, entryOnly } from './lib.mjs';
import { runNode } from './run.mjs';
import { runPage } from './page.mjs';
import { parity } from './parity.mjs';
import { upstreamExport } from './upstream-export.mjs';
import { checkManifest } from './check-manifest.mjs';
import { nodeIds, compareIds } from './check-goldens.mjs';
import { checkGamesTable, checkDeclined, checkSelfDeclared, OUT as GAMES_DOC, DECLINED } from '../games-table.mjs';
import { execFileSync } from 'node:child_process';
entryOnly(import.meta.url);  // a battery, not a library — see lib.mjs

const UPSTREAM = { ptr: path.join(os.homedir(), 'CC/Prestige-Tree'), something: path.join(os.homedir(), 'CC/tmt-fork-census/clones/Justcubing97__JC97sSomethingTree') };
const a = parseArgs(process.argv.slice(2), ['no-automation']);
const automation = !a['no-automation'];
const EXCL = automation ? 'au' : undefined;
const ids = a._.length ? a._ : GAMES();
const only = a.only ? new Set(a.only.split(',')) : null;
const want = (g) => !only || only.has(g);
const commit = headCommit(), dirty = treeDirty();
const date = new Date().toISOString().slice(0, 19) + 'Z';
const rows = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tmt-loader-gates-'));
const row = (r) => { rows.push(r); console.log(`${r.ok ? 'GREEN' : 'RED  '} ${r.gate} ${r.id ?? '—'} ${r.leg || ''} ticks=${r.ticks ?? '-'} gs=${r.gameSeconds ?? '-'} diff=${r.diff ?? '-'} hash=${r.hash ?? '-'} ${r.notes || ''}`); };

const browser = await chromium.launch();
const server = await startServer(REPO);
const base = server.url;
try {
  for (const id of ids) {
    const m = readManifest(id);
    if (want('G1')) {
      const out = execFileSync(process.execPath, [path.join(REPO, 'tools/harness/page.mjs'), id, '--gate', 'load', '--base', base, ...(automation ? ['--automation'] : [])], { encoding: 'utf8', cwd: REPO }).split('\n').filter((l) => l.startsWith('{'));
      const r = JSON.parse(out[0]);
      row({ gate: 'G1 load', id, ok: r.ok, ticks: r.ticks, gameSeconds: Math.round(r.ticks * 0.05 * 1e9) / 1e9, diff: 0.05, hash: null,
        notes: `ready ${r.loadMs} ms; ${r.layerNodes} \`#app .treeNode\`; ${r.requests} requests, ${r.blocked} blocked, ${r.failed.length} failed, ${r.pageErrors.length} page errors; keys ${r.keys.map((k) => '`' + k + '`').join(', ')}; other game ${r.other.id}: ${r.other.keys.length} keys in its own prefix, first untouched=${r.firstUntouched}` });
    }
    let straight = {};
    if (want('G2')) {
      for (const leg of ['idle', 'policy']) {
        const r1 = runNode(id, { automation, ticks: 1000, diff: 0.05, leg, 'state-out': path.join(tmp, `${id}-${leg}-1000.json`) });
        const r2 = runNode(id, { automation, ticks: 1000, diff: 0.05, leg });
        straight[leg] = r1;
        row({ gate: 'G2a determinism (node ×2)', id, leg, ok: r1.ok && r2.ok && r1.hash === r2.hash && r1.ticks === r2.ticks, ticks: r1.ticks, gameSeconds: r1.gameSeconds, diff: 0.05, hash: r1.hash, notes: `run2 ${r2.ticks} ticks ${r2.hash}` });
        // save/load in Node: 500, save(), then (i) a fresh boot on the saved storage (the reload) and (ii) loadFrom(player JSON)
        const st = path.join(tmp, `${id}-${leg}-s500.json`), pj = path.join(tmp, `${id}-${leg}-p500.json`);
        const h1 = runNode(id, { automation, ticks: 500, diff: 0.05, leg, save: true, 'save-storage': st, 'player-out': pj });
        const reload = runNode(id, { automation, ticks: 500, diff: 0.05, leg, storage: st });
        const lf = runNode(id, { automation, ticks: 500, diff: 0.05, leg, 'load-from': pj });
        row({ gate: 'G2b save→fresh boot on storage (node)', id, leg, ok: h1.ok && reload.ok && reload.hash === r1.hash, ticks: h1.ticks + reload.ticks, gameSeconds: h1.gameSeconds + reload.gameSeconds, diff: 0.05, hash: reload.hash, notes: `500 (${h1.hash}) + 500 after reload vs 1000 straight ${r1.hash}; saved keys ${h1.storage_keys?.length}` });
        row({ gate: 'G2b save→loadFrom (node)', id, leg, ok: h1.ok && lf.ok && lf.hash === r1.hash, ticks: h1.ticks + lf.ticks, gameSeconds: h1.gameSeconds + lf.gameSeconds, diff: 0.05, hash: lf.hash, notes: `importSave requested reload=${lf.steps?.[0]?.reload_requested}; vs 1000 straight ${r1.hash}` });
        // the same through the page: 500 ticks, player JSON, a FRESH context + loadFrom (a real reload), 500 ticks
        const p1 = await runPage(browser, base, id, { automation, ticks: 500, diff: 0.05, leg, playerOut: path.join(tmp, `${id}-${leg}-page-p500.json`) });
        const p2 = await runPage(browser, base, id, { automation, ticks: 500, diff: 0.05, leg, loadFrom: p1.player });
        row({ gate: 'G2b save→loadFrom (page, reload)', id, leg, ok: p2.hash === r1.hash && p2.pageErrors.length === 0 && p2.blocked === 0 && p2.failed === 0, ticks: p1.ticks + p2.ticks, gameSeconds: p1.gameSeconds + p2.gameSeconds, diff: 0.05, hash: p2.hash, notes: `page 500 ${p1.hash} (node 500 ${h1.hash}); vs node 1000 straight ${r1.hash}` });
      }
      const up = await upstreamExport(id, { upstreamDir: UPSTREAM[id], ticks: 200, diff: 0.05, base, browser, automation });
      row({ gate: 'G2c upstream export → loadFrom', id, leg: 'idle', ok: up.ok, ticks: up.ticks, gameSeconds: up.gameSeconds, diff: 0.05, hash: up.hash,
        notes: `upstream ${up.upstreamHash}; equalRaw=${up.equalRaw} equalCanonical=${up.equalCanonical}${up.keyOrderOnly ? ' (raw differs in KEY ORDER only: the upstream page\'s async modFiles race)' : ''}; exported ${up.exportedBytes} b64 chars${up.exception ? '; ' + up.exception.slice(0, 200) : ''}` });
    }
    if (want('G3')) {
      const idle = runNode(id, { automation, exclude: EXCL, ticks: 200, diff: 0.05 });
      const census = m.headless.idleHash;
      row({ gate: 'G3 idle hash = census', id, leg: 'idle', ok: idle.ok && idle.hash === census.hash && idle.ticks === census.ticks, ticks: idle.ticks, gameSeconds: idle.gameSeconds, diff: 0.05, hash: idle.hash, notes: `census ${census.hash} @ ${census.ticks}×${census.diff}; automation ${automation}${EXCL ? ' (au excluded)' : ''}` });
      for (const [leg, ticks, diff] of [['idle', 1000, 0.05], ['idle', 200, 1.0], ['policy', 1000, 0.05]]) {
        const p = await parity(id, { ticks, diff, leg, base, browser, automation });
        row({ gate: 'G3 parity node≡page', id, leg, ok: p.ok, ticks: p.ticks, gameSeconds: p.gameSeconds, diff, hash: p.node?.hash, notes: p.ok ? `page ${p.page.hash} in ${p.page.ms} ms` : `DIVERGED ${JSON.stringify(p.divergence || p.error).slice(0, 300)}` });
      }
      const mut = await parity(id, { ticks: 200, diff: 0.05, leg: 'idle', base, browser, mutant: true, automation });
      row({ gate: 'G3 parity control (page +1 point, must diverge)', id, leg: 'idle', ok: !mut.ok && !!mut.divergence, ticks: mut.ticks, gameSeconds: mut.gameSeconds, diff: 0.05, hash: mut.page?.hash, notes: `diverged at key "${mut.divergence?.key}"` });
    }
    if (want('G4')) {
      const live = nodeIds(id);
      const golden = JSON.parse(fs.readFileSync(path.join(REPO, `tools/harness/goldens/${id}.ids.json`), 'utf8'));
      const c = compareIds(golden, live);
      const cen = m.census;
      const countsOk = live.counts.ms === cen.milestones && live.counts.upg === cen.upgrades && live.counts.buy === cen.buyables && live.counts.ch === cen.challenges && live.counts.ach === cen.achievements;
      row({ gate: 'G4 goldens', id, ok: c.ok && countsOk, ticks: 0, gameSeconds: 0, diff: null, hash: null, notes: `${live.ids.length} ids, ${Object.keys(live.layers).length} layers; ms ${live.counts.ms} / upg ${live.counts.upg} / buy ${live.counts.buy} / ch ${live.counts.ch} / ach ${live.counts.ach} (census equal=${countsOk})` });
      const cm = checkManifest(id);
      row({ gate: 'G4 check-manifest', id, ok: cm.ok, ticks: 0, gameSeconds: 0, diff: null, hash: null, notes: cm.ok ? `${cm.scripts} scripts, ${cm.modFiles} modFiles, vendor sha256 ok, upstream ${cm.upstreamCommit.slice(0, 7)}, games/${id} pristine${cm.mediaFiles ? ` up to ${cm.mediaFiles} processed media files` : ''}` : JSON.stringify(cm.problems).slice(0, 300) });
    }
  }
  // G6 — repo-wide, and only meaningful over the WHOLE roster, so it does not run for a subset of ids.
  if (want('G6') && !a._.length) {
    const g = checkGamesTable();
    row({ gate: 'G6 games doc', id: null, ok: g.ok, ticks: 0, gameSeconds: 0, diff: null, hash: null,
      notes: g.ok ? `${GAMES_DOC}: ${g.games} games in manifests/index.json, generator built ${g.built}, ${g.listed} listed in that order, file byte-equal to the generator's output`
        : g.problems.join('; ').slice(0, 400) });
    // G6b — every manifest's name/author/version IS the game's own declaration, re-read from its sources. Two games
    // carried `null` for as long as they have been hosted because the emitter's reader looked only in `mod.js`.
    const n = checkSelfDeclared();
    row({ gate: 'G6b manifest = the game\'s own declaration', id: null, ok: n.ok, ticks: 0, gameSeconds: 0, diff: null, hash: null,
      notes: n.ok ? `${n.checked} manifest(s): name, author and version re-read from each game's own modInfo/VERSION${n.undeclared ? `; ${n.undeclared} game(s) declare no name of their own` : ''}`
        : n.problems.join('; ').slice(0, 400) });
    const d = checkDeclined();
    row({ gate: 'G7 declined list', id: null, ok: d.ok, ticks: 0, gameSeconds: 0, diff: null, hash: null,
      notes: d.ok ? `${DECLINED}: ${d.declined} games declined with a reason, none of them hosted`
        : d.problems.join('; ').slice(0, 400) });
  } else if (want('G6')) {
    console.log(`(G6 skipped: it checks ${GAMES_DOC} against the whole roster, and this run named ${a._.length} game(s))`);
  }
} finally {
  await browser.close();
  server.stop();
}

// A run that measured nothing is not a green run, and must not leave an empty section behind claiming "0/0 green".
// Easy to hit now that a gate can decline to run (G6 under a named subset), and `[].every()` is true.
if (rows.length === 0) {
  console.error(`gates: NO GATE RAN${only ? ` (--only ${a.only})` : ''}${a._.length ? ` for ${a._.join(', ')}` : ''} — nothing measured, nothing recorded`);
  process.exit(1);
}

const SUMMARY = path.join(REPO, 'tools/harness/results/SUMMARY.md');
if (!fs.existsSync(SUMMARY)) fs.writeFileSync(SUMMARY, `# Gate results\n\nOne section per \`node tools/harness/gates.mjs\` run (newest last). Every state claim carries ticks, gameSeconds, diff and\nthe 16-hex sha256 of \`tmtLoader.stateJSON()\`. Commit = the loader HEAD the run measured.\n`);
const cell = (v) => (v === null || v === undefined ? '—' : String(v).replace(/\|/g, '\\|'));
let md = `\n## ${date} — gates.mjs, automation ${automation ? 'ON' : 'OFF'} — commit \`${commit}\`${dirty ? ' (tree DIRTY)' : ''} — ${rows.filter((r) => r.ok).length}/${rows.length} green\n\n| gate | game | leg | ticks | gameSeconds | diff | hash | result | notes |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${cell(r.gate)} | ${cell(r.id)} | ${cell(r.leg)} | ${cell(r.ticks)} | ${cell(r.gameSeconds)} | ${cell(r.diff)} | ${r.hash ? '`' + r.hash + '`' : '—'} | ${r.ok ? 'GREEN' : '**RED**'} | ${cell(r.notes)} |\n`;
fs.appendFileSync(SUMMARY, md);
writeJSON(path.join(REPO, 'tools/harness/results/tmp/gates-last.json'), { date, commit, dirty, rows });
console.log(`gates: ${rows.filter((r) => r.ok).length}/${rows.length} green → ${path.relative(REPO, SUMMARY)}`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);
