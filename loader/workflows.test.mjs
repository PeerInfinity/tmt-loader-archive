// Properties of the CI workflows that no run of them would tell you about in time — or that a run would tell you
// about only by looking GREEN.
//
// ⛔ THE INVERSION THESE TESTS LIVE UNDER. A CI change that runs LESS looks faster and greener. A job whose `needs:`
// is dropped starts spending ten runners on red units; a job that quietly gains an `if:` stops running and reports
// nothing, which renders identically to a pass; a gate moved out of a workflow leaves no trace at all in that
// workflow's output. None of those is visible in a run's own result, so they are asserted here.
//
// ⚖ User ruling, 2026-09-18: the Pages deploy stops happening on every push. That ruling lives in one place — the
// absence of a `push:` trigger in .github/workflows/pages.yml — and the way it gets undone is not malice but
// convenience: someone wants the site current after a merge and adds four lines. By the time anyone notices, the
// ruling has been silently reversed for weeks. So it is asserted here instead of remembered.
//
// The second property is the same hazard wearing the other hat: the sweep runs on every push, so if IT ever grew a
// deploy step, push-deploys-the-site would be back with a different file name on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const wf = (n) => fs.readFileSync(path.join(REPO, '.github/workflows', n), 'utf8');

/** The workflow's jobs as {name: body}, by indentation. No YAML dependency, as above. */
function jobs(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  assert.ok(start >= 0, 'the workflow has no `jobs:` block');
  const out = {};
  let name = null, body = [];
  for (const l of lines.slice(start + 1)) {
    const m = /^ {2}([a-zA-Z_][\w-]*):\s*$/.exec(l);
    if (m) { if (name) out[name] = body.join('\n'); name = m[1]; body = []; continue; }
    if (/^\S/.test(l) && l.trim()) break;
    if (name) body.push(l);
  }
  if (name) out[name] = body.join('\n');
  return out;
}

/** The job names a job lists in `needs:` (scalar or list form). */
function needs(body) {
  const one = /^\s{4}needs:\s*([\w-]+)\s*$/m.exec(body);
  if (one) return [one[1]];
  const inline = /^\s{4}needs:\s*\[([^\]]*)\]/m.exec(body);
  if (inline) return inline[1].split(',').map((x) => x.trim()).filter(Boolean);
  const block = /^\s{4}needs:\s*\n((?:\s{6}-\s*[\w-]+\s*\n)+)/m.exec(body);
  if (block) return [...block[1].matchAll(/-\s*([\w-]+)/g)].map((m) => m[1]);
  return [];
}

/** The keys of the top-level `on:` block, by indentation. No YAML dependency, and this file has no reason to be exotic. */
function triggers(text) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^on:\s*$/.test(l) || /^on:\s*\S/.test(l));
  assert.ok(i >= 0, 'the workflow has no `on:` block at all');
  const inline = /^on:\s*(\S.*)$/.exec(lines[i]);
  if (inline) return inline[1].replace(/[[\],]/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (/^\S/.test(l)) break;                       // back to column 0: the block ended
    const m = /^ {2}(\w[\w-]*):/.exec(l);           // exactly one level in
    if (m) out.push(m[1]);
  }
  return out;
}

test('pages.yml deploys ONLY on workflow_dispatch — never on a push', () => {
  const t = triggers(wf('pages.yml'));
  assert.deepEqual(t, ['workflow_dispatch'],
    `the Pages deploy is manual by ⚖ user ruling (2026-09-18); this workflow now triggers on ${t.join(', ')}`);
});

test('the sweep does not publish', () => {
  const s = wf('sweep.yml');
  for (const forbidden of ['deploy-pages', 'upload-pages-artifact', 'configure-pages']) {
    // a mention inside a comment is how this file explains itself; a `uses:` is the thing that would deploy
    const uses = s.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l) && l.includes(forbidden));
    assert.deepEqual(uses, [], `sweep.yml runs ${forbidden} — that puts the deploy back on every push`);
  }
});

// ⛔ THE F1 MEASUREMENT MATRIX LIVES IN ITS OWN WORKFLOW, and these pins are what stop it drifting back.
// It used to sit in `sweep.yml` gated on the event being a dispatch. That cost real work twice: `sweep.yml` is
// `concurrency: sweep-<ref>` with `cancel-in-progress`, and a dispatch and a PUSH on `main` share that group, so a
// push killed a campaign in flight — run 35646386975 (34 measurement jobs succeeded, 7 cancelled) and 35636667015
// (16 / 4). An input fixed a different half of the problem and not that one.
// ⚠ Each assertion below covers a way the split can silently undo itself: a measurement job reappearing in the
// sweep (a push can kill it again), the new workflow gaining a push trigger (~5.5 runner-hours per push), or
// `f1-rows` — the cheap `maxRow` GATE — following the measurements out of the sweep and ceasing to gate anything.
// ⚖ The standing rule (2026-09-22): a sharded TABLE a planner quotes lives in the measurement workflow; only a row
// that must HOLD stays in the sweep. These are the tables — F1's matrix, R3b-2's `ptr` table, R3c's rung sweep, C1c's buying table.
const MEASUREMENT_JOBS = ['f1-cells', 'f1-fixtures', 'f1-groups', 'f1-merge',
  'r3b2-table', 'r3b2-table-merge', 'r3c-rung', 'r3c-rung-merge', 'c1c-buy'];
// ⛔ The GATES that must stay on every push, named so a later move has to argue with this list rather than slip
// past it: the assertive halves of the same arcs (a pinned mark, a hash, an inertness), and the cheap F1 gate.
const PUSH_GATES = ['f1-rows', 'r3b2-rule', 'r3b2-inert', 'r3c-mark', 'r3c-mark-merge', 'r3c-fixtures', 'r3c-fixtures-m27', 'v6-page', 'c1c-cap', 'c1c-inert'];

test('every measurement job lives ONLY in measurements.yml', () => {
  const inSweep = Object.keys(jobs(wf('sweep.yml')));
  const inM = Object.keys(jobs(wf('measurements.yml')));
  for (const j of MEASUREMENT_JOBS) {
    assert.ok(inM.includes(j), `${j} is missing from measurements.yml`);
    assert.ok(!inSweep.includes(j), `${j} is back in sweep.yml — a push can cancel it, and every push pays for it`);
  }
  assert.deepEqual(inM.sort(), [...MEASUREMENT_JOBS].sort(), 'measurements.yml holds exactly the tables');
});

test('the ASSERTIVE jobs stay in the sweep, on every push', () => {
  const J = jobs(wf('sweep.yml'));
  const inM = Object.keys(jobs(wf('measurements.yml')));
  for (const j of PUSH_GATES) {
    assert.ok(J[j], `${j} left sweep.yml — a gate that does not run on a push gates nothing`);
    assert.ok(!inM.includes(j), `${j} is in the measurement workflow; it asserts, so it belongs on every push`);
  }
});

test('measurements.yml is DISPATCH-ONLY and has its own concurrency group', () => {
  const s = wf('measurements.yml');
  assert.deepEqual(triggers(s), ['workflow_dispatch'], 'it must never run on a push — F1 alone is ~5.5 runner-hours');
  const g = /^concurrency:\n\s+group:\s*(\S.*)$/m.exec(s);
  assert.ok(g, 'measurements.yml declares no concurrency group');
  assert.doesNotMatch(g[1], /^sweep-/, 'it must NOT share the sweep group — that is the bug it was split out of');
});

test('sweep.yml keeps `f1-rows` on every push, and carries no f1 input any more', () => {
  const s = wf('sweep.yml');
  const J = jobs(s);
  assert.ok(J['f1-rows'], 'f1-rows is gone — the cheap maxRow gate must stay in the sweep');
  assert.doesNotMatch(J['f1-rows'], /^\s{4}if:/m, 'f1-rows must not be gated: it runs on every push');
  assert.doesNotMatch(s, /inputs\.f1/, 'the `f1` input is back; the split removed the need for it and its `== \'true\'` trap');
});

test('the sweep runs on push and on dispatch', () => {
  assert.deepEqual(triggers(wf('sweep.yml')).sort(), ['push', 'workflow_dispatch']);
});

test('the shard matrix and the SHARDS the runner is told about are the same number', () => {
  // They are two literals in one file, and a mismatch would not surface until a run: `--shard 11/10` throws, and
  // `--expect 10` against 12 shards refuses. Both are correct refusals and both cost a full CI run to discover.
  const s = wf('sweep.yml');
  const n = Number(/^\s*SHARDS:\s*'(\d+)'/m.exec(s)[1]);
  const matrix = /^\s*shard: \[([^\]]+)\]/m.exec(s)[1].split(',').map((x) => Number(x.trim()));
  assert.deepEqual(matrix, Array.from({ length: n }, (_, i) => i + 1),
    `SHARDS is ${n} but the matrix is [${matrix.join(', ')}]`);
});

test('the merge job cannot be skipped by a failing shard, and does not fire on a cancelled run', () => {
  // A bare `needs: shard` means one red shard silently skips the roster assertion — the exact shape of "a dead
  // shard reads as green" this whole arrangement exists to prevent. So the job needs a condition.
  //
  // ⚠ But NOT `always()`, which is true even when the RUN WAS CANCELLED. With `cancel-in-progress`, a newer push
  // cancels this run's shards mid-flight; an `always()` merge would then find them missing and report a RED that
  // means nothing, on the one gate whose value is that a red means something. `!cancelled()` gives both.
  const s = wf('sweep.yml');
  const merge = s.slice(s.indexOf('\n  merge:'));
  const cond = /^\s{4}if: (.+)$/m.exec(merge);
  assert.ok(cond, 'the merge job has no `if:` at all — a failing shard would skip the roster assertion');
  assert.match(cond[1], /!cancelled\(\)/, `the merge job's condition is \`${cond[1]}\``);
  assert.doesNotMatch(cond[1], /\balways\(\)/, 'always() fires on a cancelled run and would report a false missing shard');
  assert.match(merge, /needs: shard/);
  assert.doesNotMatch(merge, /continue-on-error:\s*true/, 'the merge is the verdict; it may not be advisory');
});

// ---------------------------------------------------------------------------------------------------------------
// U2g: the rest of the battery moved into CI. What it is easy to undo, asserted.
// ---------------------------------------------------------------------------------------------------------------

test('every expensive job in the sweep is GATED by the fast one', () => {
  // The fast job is the unit tests, the roster doc, the declined list and the figures census: seconds, no browser.
  // Its entire value is that nothing else starts when it is red. A `needs:` dropped for convenience — "my change
  // does not touch the units" — spends ten runners plus three more to discover what three seconds already knew,
  // and nothing about the resulting run would look wrong.
  const j = jobs(wf('sweep.yml'));
  assert.ok(j.fast, 'sweep.yml has no `fast` job at all');
  for (const name of ['shard', 'g1', 'anchors', 'options']) {
    assert.ok(j[name], `sweep.yml has no \`${name}\` job`);
    assert.deepEqual(needs(j[name]), ['fast'], `the ${name} job does not wait for the fast checks`);
  }
  // …and the merge is gated transitively, through the matrix, which is the one correct way for it to be skipped
  assert.deepEqual(needs(j.merge), ['shard']);
});

test('the fast job runs all its cheap checks — as CHECKS, not inside its own summary', () => {
  // ⚠ The first version of this test asserted only that the command appeared in the job, and a mutant walked
  // straight through it: the summary step at the end of the job reruns `census-figures.mjs` to paste its output
  // into $GITHUB_STEP_SUMMARY, swallowing the exit code with `|| true`. Deleting the real step left the text in
  // place and the test green. A command whose status nothing reads is not a check.
  const j = jobs(wf('sweep.yml'));
  const steps = j.fast.split(/^ {6}- /m).slice(1);
  // `node tools/media.mjs` (assets-1): the media check — a `git subtree pull` restores originals and nothing else sees it
  for (const cmd of ['npm run harness:test', 'node tools/games-table.mjs --check', 'node tools/census-figures.mjs', 'node tools/media.mjs']) {
    const real = steps.filter((st) => st.includes(cmd) && !st.includes('GITHUB_STEP_SUMMARY'));
    assert.ok(real.length >= 1, `the fast job no longer runs \`${cmd}\` as a step whose failure fails the job`);
  }
  assert.doesNotMatch(j.fast, /playwright install/, 'the fast job installed a browser — it is then no longer the fast job');
});

test('G1 in CI carries the SAME roster assertion as the sharded sweep', () => {
  // G1 does not shard (measured: 5 min serial for the roster, against ~90 s of fixed setup a matrix would pay ten
  // times). ⛔ Unsharded is not unasserted: it runs as `--shard 1/1` and the same merge-shards refuses it if the
  // rows do not reconstruct the roster. A gate that quietly enumerated 170 games would otherwise pass.
  const j = jobs(wf('sweep.yml'));
  assert.match(j.g1, /--gate load[^\n]*--shard 1\/1/, 'the G1 job does not record the roster it was assigned');
  assert.match(j.g1, /merge-shards\.mjs shards --expect 1/, 'the G1 job does not assert its coverage');
});

test('every gate run that writes a shard JSON is followed by a merge assertion', () => {
  // Stated as a property rather than per job, so a gate added tomorrow inherits it.
  const j = jobs(wf('sweep.yml'));
  // …either in the job itself (G1, one shard) or in a job downstream of it (the M1 matrix, whose merge is its own
  // job because the shards have to upload their artifacts first). Both are the assertion; neither is optional.
  const merges = (name) => /merge-shards\.mjs/.test(j[name]) || Object.entries(j).some(([n, b]) => needs(b).includes(name) && /merge-shards\.mjs/.test(b));
  const produced = Object.keys(j).filter((n) => /--gate \w+[^\n]*--json/.test(j[n]));
  assert.ok(produced.length >= 2, `only ${produced.length} job(s) run a gate at all — did one get dropped?`);
  for (const name of produced) {
    assert.ok(merges(name), `job \`${name}\` runs a gate into a JSON and nothing ever asserts what it covered`);
  }
});

test('⚖ G5 runs on the DEPLOY and nowhere else', () => {
  // User ruling, 2026-09-18. check-pages.mjs hits the published site; on a push it would certify something the push
  // did not change, because pushes no longer deploy. The two halves of that ruling:
  const pages = wf('pages.yml'), sweep = wf('sweep.yml');
  assert.match(pages, /check-pages\.mjs --live/, 'pages.yml no longer verifies the deploy it just made');
  assert.doesNotMatch(sweep, /check-pages\.mjs/, 'the sweep runs G5 again — it is on the push, where it certifies an unchanged site');
  // and it runs AFTER the deploy, not beside it
  const j = jobs(pages);
  assert.ok(j.verify, 'pages.yml has no verify job');
  assert.deepEqual(needs(j.verify), ['deploy'], 'the verification does not wait for the deploy');
  assert.match(j.verify, /--live "\$URL"/, 'the verification does not run against the deployed URL');
});

test('the deploy verification may not be advisory, and may not skip itself', () => {
  // A check that cannot fail the workflow is decoration, and a check with a condition on it is a check that one
  // day quietly stops running. Both read as a green deploy.
  const j = jobs(wf('pages.yml'));
  assert.doesNotMatch(j.verify, /continue-on-error:\s*true/, 'the deploy verification is advisory — then a red deploy is still a green run');
  const cond = /^\s{4}if: (.+)$/m.exec(j.verify);
  assert.equal(cond, null, `the verify job has a condition on it (\`${cond && cond[1]}\`), so it can skip and report nothing`);
  // the steps that produce the verdict are unconditional too; only the reporting steps may carry `if: always()`
  const verdict = j.verify.split('\n').findIndex((l) => l.includes('check-pages.mjs'));
  assert.ok(verdict > 0);
});

test('the live check is in the file that deploys, and the deploy is in no other file', () => {
  // The pair, stated together: if either half moved, push-deploys-the-site would be back under a different name, or
  // the live check would be running against a site nobody had just published.
  assert.deepEqual(triggers(wf('pages.yml')), ['workflow_dispatch']);
  const deployers = ['pages.yml', 'sweep.yml'].filter((f) => wf(f).split('\n').some((l) => /^\s*-?\s*uses:/.test(l) && /deploy-pages/.test(l)));
  assert.deepEqual(deployers, ['pages.yml']);
  const verifiers = ['pages.yml', 'sweep.yml'].filter((f) => /check-pages\.mjs/.test(wf(f)));
  assert.deepEqual(verifiers, ['pages.yml']);
});

test('⛔ every piped step declares `shell: bash` — or the pipe eats the verdict', () => {
  // MEASURED, 2026-09-19, and it had been true since the merge job was written. GitHub's default shell is
  // `bash -e {0}`: a pipeline's exit status is its LAST command, so `merge-shards.mjs … | tee merge.txt` reports
  // `tee`'s 0 and the step SUCCEEDS while the merge is printing "MERGE REFUSED — no shard files were found at all".
  // The one job whose entire purpose is to refuse a matrix that covered nothing could not fail. It surfaced only
  // because the fast gate was driven red: the matrix was skipped, no artifact existed, and the merge went green.
  //
  // `shell: bash` is `bash --noprofile --norc -eo pipefail`, which restores the refusal. The rule is stated for
  // EVERY piped step, including the summary ones that end in `|| true`, so there is no exception to argue about.
  for (const file of ['sweep.yml', 'pages.yml']) {
    const j = jobs(wf(file));
    for (const [name, body] of Object.entries(j)) {
      for (const step of body.split(/^ {6}- /m).slice(1)) {
        // a single `|` followed by a command — NOT `||` (which is a fallback, not a pipeline) and not the YAML
        // block scalar `run: |`
        const piped = step.split('\n').filter((l) => /(^|[^|])\|(?!\|)\s*[a-z]/.test(l) && !/run:\s*\|-?\s*$/.test(l) && !/^\s*#/.test(l));
        if (!piped.length) continue;
        assert.match(step, /^\s*shell: bash\b/m,
          `${file} job \`${name}\`: a step pipes (${piped[0].trim().slice(0, 60)}…) without \`shell: bash\`, so a failure on the left of the pipe reports success`);
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// V1: `gates-a1 --part 2` — the au TAB's own gate — joins CI. It ran nowhere before, which is why the properties
// that keep it honest are asserted here rather than left to whoever reads the YAML next.
// ---------------------------------------------------------------------------------------------------------------

test('the au tab has its own job, gated by the fast one', () => {
  const j = jobs(wf('sweep.yml'));
  assert.ok(j.a1, 'sweep.yml has no `a1` job — `gates-a1 --part 2` is back to running nowhere');
  assert.deepEqual(needs(j.a1), ['fast']);
  assert.match(j.a1, /gates-a1\.mjs --part 2/, 'the a1 job does not run part 2');
  assert.doesNotMatch(j.a1, /continue-on-error:\s*true/, 'the a1 job is advisory — then a red au tab is still a green run');
});

test('⛔ the a1 job DERIVES its game set and does not type ids', () => {
  // The gate's subject is "a game with an automation table". `games-auto/` is that set, and a third table added
  // tomorrow has to join the job by existing. A typed list is a roster that silently stops covering what it names.
  const j = jobs(wf('sweep.yml'));
  const run = j.a1.split(/^ {6}- /m).find((st) => st.includes('gates-a1.mjs --part 2'));
  assert.match(run, /ls games-auto\//, 'the a1 job no longer derives its set from games-auto/');
  for (const id of ['ptr', 'something']) {
    assert.doesNotMatch(run, new RegExp(`--part 2[^\\n]*\\b${id}\\b`), `the a1 job names \`${id}\` on its command line instead of deriving it`);
  }
  assert.match(run, /test -n "\$SET"/, 'an empty derivation would run the gate over NO games and exit 0');
  // R3c Part 0: the TABLE-LESS control joins by its ROLE, read from lib.mjs — not typed on the command line
  assert.match(run, /m\.TABLELESS_CONTROL/, 'the a1 job no longer adds the table-less control');
  assert.match(run, /SET="\$SET\$CONTROL"/, 'the a1 job reads the control and then drops it');
});

// ---------------------------------------------------------------------------------------------------------------
// V1's reason battery in CI. Two jobs, and the properties that keep them honest.
// ---------------------------------------------------------------------------------------------------------------

test('the V1 reason battery runs in CI, both halves, gated by the fast job', () => {
  const j = jobs(wf('sweep.yml'));
  for (const name of ['v1-node', 'v1-page']) {
    assert.ok(j[name], `sweep.yml has no \`${name}\` job — gates-v1 is back to running only when someone remembers`);
    assert.deepEqual(needs(j[name]), ['fast'], `the ${name} job does not wait for the fast checks`);
    assert.doesNotMatch(j[name], /continue-on-error:\s*true/, `the ${name} job is advisory — then a red reason battery is still a green run`);
  }
  // every part is actually driven somewhere, and each exactly once: a part quietly dropped leaves no trace in a run
  const both = j['v1-node'] + j['v1-page'];
  for (const part of ['1', '2', '3', '3p', '4']) {
    const runs = [...both.matchAll(new RegExp(`--part ${part.replace('p', 'p')}(?![\\dp])`, 'g'))].length;
    assert.equal(runs, 1, `\`--part ${part}\` is driven ${runs} time(s) in CI`);
  }
});

test('⛔ every V1 part in CI asserts its ROW COUNT, not just that nothing failed', () => {
  // `gates-v1` already exits 1 on a red row. That does not catch the battery that stopped part-way: it prints
  // fewer rows, and fewer rows is fewer reds. Same inversion as the a1 job's `--assert`.
  const j = jobs(wf('sweep.yml'));
  for (const name of ['v1-node', 'v1-page']) {
    const steps = j[name].split(/^ {6}- /m).slice(1).filter((st) => st.includes('gates-v1.mjs'));
    assert.ok(steps.length >= 2, `the ${name} job runs only ${steps.length} part(s)`);
    for (const st of steps) {
      assert.match(st, /--assert\b/, `a gates-v1 step in ${name} does not assert its coverage`);
      assert.match(st, /set -o pipefail/, `a gates-v1 step in ${name} pipes into tee without pipefail`);
    }
  }
});

test('⚠ the headless half does NOT install a browser — that is the reason it is its own job', () => {
  // Parts 1–3 import the playwright package and never launch it. If this job ever grows a browser install, the
  // split has stopped paying for itself and should be folded back into one job rather than left costing double.
  // ⚠ COMMENTS DO NOT COUNT — the job's own comment SAYS "no `playwright install`", and a naive match on the job
  // body is satisfied by that sentence. The same trap the fast job's census step already carries: what is asserted
  // has to be the line that RUNS.
  const j = jobs(wf('sweep.yml'));
  const cmds = (body) => body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(cmds(j['v1-node']), /playwright install/, 'the headless V1 job installs a browser it never launches');
  assert.match(cmds(j['v1-page']), /playwright install/, 'the page V1 job has no browser');
});

test('⛔ NO job checks out the history — no gate may need it (⚖ R12/R13, S1T)', () => {
  // The a1 job used to assert `fetch-depth: 0` HERE, because its check-manifest row searched the history for each
  // game's subtree-squash commit (measured RED at depth 1 in production, run 35458073272); c1-data (the provenance
  // gate's `merge-base --is-ancestor`), c1c-inert / c1c-buy (a worktree at the commit before C1c) and anchors (worktrees
  // at the S1 baselines) needed it too. The split imports a history-free tree (R12) and nothing in it may need the old
  // repository (R13), so each of those now reads a committed recording — and a `fetch-depth: 0` coming back is the
  // first sign that a gate reaches for history again. This asserts the line that RUNS (comments stripped).
  for (const f of ['sweep.yml', 'measurements.yml', 'pages.yml']) {
    const live = wf(f).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(live, /fetch-depth:\s*0\b/, `${f} checks out the whole history again — which gate reads it?`);
  }
  const j = jobs(wf('sweep.yml'));
  const steps = j.fast.split(/^ {6}- /m).slice(1);
  assert.ok(steps.some((st) => st.includes('node tools/pristine.mjs --check') && !st.includes('GITHUB_STEP_SUMMARY')), 'the fast job no longer checks the pristine records');
});

test('⛔ the a1 job asks the gate to prove what it COVERED, not just that nothing failed', () => {
  // `gates-a1` already exits 1 on a red row. That is the half that does not catch a battery which booted one game
  // and threw inside the second: it prints `12/24 green`, every row it produced is green, and it is smaller,
  // faster and greener than a full run. `--assert` is the other half.
  const j = jobs(wf('sweep.yml'));
  assert.match(j.a1, /--assert\b/, 'the a1 job does not assert its coverage — fewer games is fewer rows is fewer reds');
  assert.match(j.a1, /set -o pipefail/, 'the gate is piped into tee without pipefail, so the refusal is lost');
});

test('⛔ C1: the fast job checks the tables\' schema and the currency index as STEPS, and three C1 jobs run the battery', () => {
  const j = jobs(wf('sweep.yml'));
  const steps = j.fast.split(/^ {6}- /m).slice(1);
  for (const cmd of ['node tools/auto-tables.mjs --check', 'node tools/currency-data.mjs --check-index']) {
    assert.ok(steps.some((st) => st.includes(cmd) && !st.includes('GITHUB_STEP_SUMMARY')), `the fast job no longer runs \`${cmd}\` as a step`);
  }
  // R3c Part 0: part 7 (Something Tree's interval rider) is RETIRED — the table it swept is deleted — and `--part 7`
  // REFUSES, so a job still running it would be RED rather than vacuous; the row below asserts it is gone.
  const want = { 'c1-data': [3, 1, 2, 6], 'c1-inert': [4], 'c1-consumers': [5] };
  for (const [name, parts] of Object.entries(want)) {
    assert.ok(j[name], `sweep.yml has no \`${name}\` job`);
    assert.deepEqual(needs(j[name]), ['fast'], `the ${name} job does not wait for the fast checks`);
    for (const p of parts) assert.match(j[name], new RegExp(`gates-c1\\.mjs --part ${p} [^\\n]*--assert`), `${name} does not run part ${p} with --assert`);
  }
  assert.doesNotMatch(j['c1-consumers'], /gates-c1\.mjs --part 7 /, 'the retired part 7 is still a CI step');
  // (the provenance gate used to need the whole history here — `merge-base --is-ancestor`; it reads the frozen commit
  // list now, and the history-free test above holds every job to depth 1)
});
