# The harness path for long games: ladder, snapshots, diff calibration

> ⛔ **A `gates-*.mjs` file is a battery, not a library.** Its body runs at top level, so importing one — to read a
> constant, say — RUNS it: boot children, and for `gates-h1 --part 1` and `gates-p1a --part 0` a rewrite of the
> committed fixtures under `snapshots/ptr/`. The nine top-level ones call `entryOnly(import.meta.url)` (lib.mjs)
> and refuse to be imported, saying what to do instead; `gates-r1.mjs` does the same by wrapping its body in
> `if (ENTRY)`. Run them; do not import them.

A full game of a Modding Tree fork is days of game time; at diff 1 one Prestige Tree Rewritten game-day is tens of
minutes of wall time in Node. The harness therefore measures a game as a **ladder** of machine-checkable marks, keeps a
**snapshot** at every mark it reaches, and runs each new stretch **from the previous mark's snapshot** at the coarsest
**diff** the calibration allows. Everything here is harness-side: the page, the save format and the automation core's
behaviour are unchanged (the core only gained `tmtLoader.runtimeState()` / `restoreRuntime()`, automation mode only).

## The ladder file

`tools/harness/ladder/<game>.json` — header keys, then one mark per line:

```json
{
  "game": "ptr",
  "plan": "…where the marks come from…",
  "diffRule": "…",
  "helpers": { "hasUpgrade": "games/ptr/js/utils.js:633", … },
  "marks": [
    {"id": "M02", "name": "b and g unlocked", "predicate": "player.b.unlocked && player.g.unlocked", "wall": "…", "source": {"plan": "§3a M02", "digest": ["L1.2"], "reached": "A1-3 (i) …"}, "diff": 1, "diffSource": "H1-3 @… ×1 1361s, ×5 …"},
    …
  ]
}
```

- **`predicate`** is a JS expression over the engine's globals — the same mini-language as `run.mjs --until` / `--marks`
  and the automation table's `gates` (compiled once with `new Function` in the game's global scope). A predicate that
  throws reads as **false** (PTR's `getBuyableAmount` returns a plain `0` for a locked layer, so `.gte(1)` throws until
  the layer unlocks).
- **`source`** carries provenance: the plan row, the walkthrough-digest steps, the SUMMARY row that first reached it.
- **`diff`** is the calibrated diff for the mark (below); `null` until a run has calibrated it.
- Marks are ordered as the walkthrough orders them; a run may reach them out of order (PTR's M10, the native toggles,
  holds before M09 when the `toggles` kind runs).

`gates-h1.mjs --part 1` checks that every predicate compiles and that the helpers exist at the recorded lines.

## Runner flags (`tools/harness/run.mjs`)

| Flag | Meaning |
|---|---|
| `--ladder <file>` | the marks are the ladder's entries after `--from` (exclusive) through `--to` (inclusive; default the last), recorded without stopping; the run stops at the first tick `--to` holds (or a stall / the wall / `--ticks`) |
| `--from <mark>` / `--to <mark>` | the slice |
| `--until-all` | stop when **every** mark of the slice holds instead of when `--to` does |
| `--snapshots <dir>` | at the first tick each mark holds, write `<dir>/<mark>.json` |
| `--from-snapshot <file>` | boot from a snapshot (below); `--from` defaults to its mark and `--diff` to its diff |
| `--no-runtime` | (a control) restore the snapshot's counters but not the memory outside `player` |
| `--predicates <list.json>` | `[[name, "<js>"], …]` compiled and evaluated once after load (`R.predicates`) |
| `--eval "<js>"` | an expression evaluated at the stop, returned as JSON (`R.eval`) |
| `--planner` | load `loader/tmt-planner.js` after `tmt-auto.js` and run nothing (P1a; the page never fetches it) |
| `--planner=auto` \| `--planner=suggest` | also DRIVE it: `planner.beforeTick()` runs **between** ticks and plans one epoch at a time (P1b). `auto` commits the winning configuration of the simple system to the live game; `suggest` plans and logs and commits nothing — the page's Suggest mode, headless. `--planner-mode <m>` is the same switch spelled apart |
| `--planner-opt "k=v;k2=v2"` | the planner's options (`k`, `screenK`, the score weights, the clocks — `docs/planner.md`); an unknown key throws |
| `--planner-ladder <file>` | the ladder JSON becomes `tmtLoader.plannerLadder`, the sticky goal source |
| `--planner-k <n>` / `--knowledge-out` / `--goals-out` | P1a: the producer window, and the dumps written at the stop |
| `--ladder-labels <file>` | (V3, set for you by `--ladder`) the ladder JSON becomes `tmtLoader.ladder`, the PROGRESS TRACKER's label source — an event carries the names of any marks it satisfied. Read by nothing unless the tracker is armed, so a run without `track=1` / `watch=1` is byte-identical |
| `--no-currency` | (C1) boot WITHOUT the generated currency data (`games-data/<id>.json`): every buyable's currency unknown, which is the behaviour before C1 — the control gate C1-4 measures inertness against |
| `--random-seed <n>` | (C1) replace `Math.random` with a SEEDED generator before any game file runs, counting its calls into `R.randomCalls`. The currency generator reads every game under seed 1, and a game that drew any randomness under seeds 1–3 |
| `--rounds-out <file>` | the planner's report at the stop: mode, options, reached / abandoned marks, clocks, divergences and the full round log (`docs/planner.md`, "reading a round log") |

A driven run's one-line result gains `planner: {mode, rounds, commits, divergences, reached, options, wallMs,
measuredGameSeconds}`. A planning round that THROWS stops the run (`failed_at: 'planner'`): a live game left running a
configuration nobody chose is worse than a red row. The planner's own memory — the once-reached marks, the stall clocks,
the committed epoch — rides in `tmtLoader.runtimeState()` with the registry's, so a snapshot carries it and a chained
`--from-snapshot` leg continues the campaign instead of restarting it.

The result (and the one-line summary) gains `ladder: {from, to, reached: [{id, ticks, gameSeconds, hash, hashGame}],
stoppedAt: {ticks, gameSeconds, why}}` with `why` = `to` | `stalled` | `walled` | `ticks`. Long runs keep using
`--stall <game-s> --stall-seen --wall-ms 540000` (one process ≤ 10 min).

## Snapshots

A snapshot is

```
{ mark, commit, dirty, ticks, gameSeconds, diff, hash, hashGame, config: {profile, auto-opt, from},
  player: "<JSON.stringify(player)>",
  runtime: { auto: tmtLoader.runtimeState(), monitor: {seen, bmax, lastTick, lastGs} } }
```

taken **after** the mark's tick (the same state the mark's `hashGame` hashes). `runtime.auto` is the automation core's
memory outside `player`: each interval reset's `lastReset` (compared with `player.timePlayed`; undefined after a re-boot,
so the policy would fire at once), the loop counter and per-layer ran-at marks of the double-call check, and the hook
statistics (action counts continue). Since P1b it also carries, **only when they are not empty**, the runtime
`policies` set with `setPolicy` (otherwise an excursion's policy change would leak past the restore, and a chained
process would drop the configuration the planner committed), the runtime `enabled` overrides, and `extra.planner` —
whatever a later layer registered with `tmtLoader.registerRuntime`. A run that uses none of them writes exactly the
record it wrote before, so every committed snapshot stays valid. `runtime.monitor` is the stall detector's seen-set, buyable maxima and last-progress
point, so a resumed run stalls where the uninterrupted one does.

⛔ **The detector's RULE now lives in the core, and the monitor is held to it** (V3). `--stall-seen`'s rule — progress
is something NEW EVER HELD: an unlock, an upgrade, a milestone, an achievement, a challenge completion, or a buyable
above its own run maximum — is `tmtLoader.progress()` (`docs/automation.md`), and `gates-v3 --part 1` compares the two
event for event on ptr and on something: the seen-set, the buyable maxima and the TICK the last progress landed on.
⚠ **`MONITOR_SRC`'s own text is deliberately NOT replaced**: it has to go on reproducing every committed
`stall.lastProgress` pin (`gates-p1a --part 0`'s **10531** among them) and a resumed run restores its memory from a
snapshot an older build wrote. Two implementations of one rule, with a gate that compares them, is the honest form of
"one definition" while the second copy is load-bearing for pins a slice may not move.

⚠ **One MEASURED difference, and each is right about a different question.** The monitor is seeded from a snapshot's
own `runtime.monitor`, so it CONTINUES the memory of the run that wrote the fixture; the core's tracker arms when it
is switched on and seeds from the save in front of it. Resuming `all/M16.json` gives identical seen-sets (107 = 107)
and DIFFERENT buyable maxima over 8 keys — a buyable the original run once held and a reset took away is above the
snapshot's live value. `gates-v3 --part 1` therefore compares them on FRESH legs.
⚠ **The tracker's own memory rides in `runtime.auto`** (`progress` and `watch` blocks) and, like every V1/V2 block,
appears ONLY when it has something to say — so a run with the tracker off writes exactly the record it wrote before
V3 and every committed snapshot stays valid (`gates-v3 --part 2` asserts the record's KEY SET, not just its values). `dirty` ignores `tools/harness/snapshots` and
`tools/harness/results`.

⚠ **Something Tree's fixtures (`snapshots/something/all/S01–S05`) were written under an automation table that R3c
DELETED** (⚖ user 2026-09-21). They are kept byte-unchanged, and their configuration is now NAMED rather than
implied: `--auto-opt "$SOMETHING_OLD_TABLE"` (`tools/harness/lib.mjs`) reproduces every one of them — `hashGame` and full
hash — from a fresh game. The derived defaults reach S01 only (6 game-s, `hashGame` `4d99d54bf4f3181d` against the
fixture's `2fc43f3274a79fb0`), so there is no derived S02–S05 to record; a leg resumed from one of these fixtures
without that opt continues the STATE under the derived defaults, which is what their consumers (`gates-p1a`,
`gates-p1b`) want of a starting point.

`--from-snapshot` boots through the existing `--load-from` path — one child calls the game's own
`importSave(btoa(player), true)` (`tmtLoader.loadFrom`), a fresh child boots on the storage that wrote — then restores
`runtime` and sets `tmtLoader.ticks` / `gameSeconds` to the snapshot's counts, so **ticks and game-seconds continue**. The
importing child registers the same features as the run (same `--auto-opt`), so even the full hash (which includes
`player.au.clickables`, one key per au button) round-trips. Marks compare **`hashGame`** (the state without `player.au`)
across any change to the feature set.

**A snapshot of the STOP.** `run.mjs --stop-snapshot <dir> [--stop-snapshot-name <name>]` writes the same record at the
run's stop (a stall, the wall, `--ticks`) instead of at a mark — the fixture a run that ends nowhere near a ladder mark
leaves behind. `tools/harness/snapshots/ptr/frontier/STALL.json` is the S1 frontier stall taken that way (gate
`gates-p1a --part 0` writes it and requires it to reproduce §10a.4: 14131 ticks, hash `63f28e099536a119`).

⚠ **A resume is byte-faithful in `player`, not necessarily in `tmp`.** `tmp` is not a pure function of `player`:
2.2.1's `getNextAt` reads `tmp[layer].nextAt` and `tmp[layer].baseAmount` (game.js:36-52), so it is self-referential
and has more than one fixed point. Measured at the frontier: `tmp.b.nextAt` is `2.33e276` in the uninterrupted run and
`9.85e167` after a resume at a byte-identical `player`. H1-2's resume fidelity (M02 / M07 → M09 land on the same tick
and `hashGame`) is a measurement of those states, not a general guarantee; a rung that resumes deep in a run should
re-measure the stretch it depends on. See `docs/planner.md`.

**Fixtures.** Snapshots of the marks the tables reach are committed under `tools/harness/snapshots/<game>/<set>/`:
for PTR, `pinned/` (`--auto-opt kinds=reset,upgrades,buyables` plus the A2 policy set, the configuration every pinned
number was measured in — a pin is a measurement of a CONFIGURATION, so it names one rather than inheriting whatever the
table says today), `all/` (every derived kind, the configuration rungs continue from — **M01–M10 were measured under the
A2 policies and M11–M16 under R1′'s table**, which is in each snapshot's `config`) and `frontier/` (the S1 stall itself,
which R1′ walked through: M11 14745 · M12 14909 · M13 14132 · M14 14879 · M15 16048 · M16 24179, and M17 holds at M16);
for Something Tree, `all/` (S01–S05, profile all, every kind — each lands on the A2-1 tick and `hashGame`). A PTR
`player` is ~11 KB, a snapshot ~15–18 KB. Measured fidelity (H1-2): a resume lands on every later mark at the same tick, game-second and
`hashGame` as the fresh run, and reproduces the frontier stall's tick and full hash; without `runtime` (the control) it
lands one tick early where an interval reset was mid-interval.

## Diff calibration

The engine's `gameLoop(diff)` is not linear in diff: a coarse diff reaches a mark at a different game-second (resets and
purchases happen at most once per tick; a layer unlocked inside `gameLoop` shows a one-tick class of difference). The
rule: for diffs {1, 5, 20, 60}, two fresh runs each to the ladder's calibrated range; **a diff is usable for a mark when
both runs' game-seconds at the mark are within 2 % of diff 1's** (hashes differ at a coarse diff — the criterion is the
mark's timing). The ladder records the coarsest usable diff per mark (`diff`, with the measurement in `diffSource`);
marks no calibration reached stay `null` and are filled by the rung that first reaches them, by the same rule. Diff 1 is
the reference, not ground truth (Something Tree's A2-1 (i) is 208 s at diff 0.05 and 309 s at diff 1). Node ≡ page parity
stays at diff 0.05 and is untouched by any of this. `gates-h1.mjs --part 3` runs it (and records wall-clock per run and
the box load); `--part 3v` re-runs the ladder at each mark's recorded diff.

## THE TICK POLICY (F1) — what `diff 1` may decide, and what it may not

⛔ **The page runs at `diff 0.05`; every ladder number and every ranking before F1 was scored at `diff 1`**, and H1
(above) compared `diff 1` only against COARSER ticks. F1 compared it against the page's own tick on the SAME
configuration (the ladder's: `passiveYield=off`), every cell twice equal — gate `gates-f1 --part 0` / `--part 1`, CI
run 35637460884 at `3069ee2`. **It is NOT a constant factor, and it is not even on one side of 1:**

| stretch (resumed from the committed fixture, or fresh) | ticks at 0.05 | stretch length at 0.05 ÷ at 1, per mark | CI wall, 2 runs in parallel (`diff 1` / `0.05`) |
|---|---|---|---|
| early — `all/M04` → M08 | 13,615 | M05 0.453 · M06 0.429 · M07 0.428 · M08 **0.247** | 39 s / 113 s |
| row 2 — `all/M15` → M16 | 3,083 | M16 **0.153** | 7 s / 46 s |
| row 3 — `all/M22` → M24 | 4,732 | M23 **2.84** · M24 **2.005** — SLOWER at the page's tick | 2 s / 51 s |
| the opening — fresh → M12 | 46,199 | M12 0.344 (2309.95 against 6718) | 96 s / 394 s |
| the long row-3 stretch — `all/M15` → M25, the yield ON at both ticks | 181,176 | M25 0.445 (9058.8 against 20335) | 131 s / 767 s |

⇒ **THE RULE THE ARC ADOPTS (F1):**
1. **`diff 1` stays the ruler for REACHABILITY and for REGRESSIONS** — a pin, a fixture, a "does the leg still reach
   M25" row. It is fast, deterministic and the whole ladder was built on it.
2. **NO DEFAULT MOVES WITHOUT A REAL-TICK ROW.** Anything that trades an ACTION against a TICK of income — a reset
   against passive generation, a throttle, a ratio — is scored at `diff 0.05`. The yield itself is the example: SLOWER
   at `diff 1` on every stretch (M08 5381 → 5491, M12 6718 → 6862, M16 17058 → 17197, M25 35613 → 36383) and FASTER
   at the page's tick on every one (M08 3309.75 → 3205.95, M12 2309.95 → 2021.75, M16 16202.15 → 16108.95, M24
   30854.6 → 30787.35) — and on the long row-3 stretch it is the difference between reaching H12 and not: with the
   yield OFF at `diff 0.05`, `all/M15` does NOT reach M25 inside 21,000 game-seconds (107,091 `p` resets and 11,013
   `e` resets), while the yield reaches it at 25106.8. A ranking made at `diff 1` is not evidence about the page.
3. **Fitting it in the wall.** A local process gets ≤ 10 minutes: the early, row-2 and row-3 stretches above fit
   (locally, four processes side by side, 218–514 s); the opening and the long row-3 stretch do NOT, and run in CI,
   one cell per job (`gates-f1 --cell <key>` / `--group <g>`, `--wall-ms 5400000` under a 100-minute job; the merge
   `--part m` refuses a missing cell by name). ⚖ **Those jobs are MANUAL** (`workflow_dispatch` only, user 2026-09-21): a
   measurement table costs ~5.5 runner-hours and re-measures a known answer on every push; run it from the Actions tab
   when a default is being re-decided. `f1-rows` (the `maxRow` gate) is the F1 job that runs on every push.

   ⛔ **BUT "MANUAL" DOES NOT MEAN "ONLY WHEN SOMEONE WANTS F1" — ANY DISPATCH OF `sweep.yml` STARTS THEM**, including
   a slice dispatching the sweep at its own branch to get M1 and G1. The gate is
   `if: ${{ github.event_name == 'workflow_dispatch' }}`, which cannot tell "run the roster on my branch" from
   "re-decide a reset default". MEASURED 2026-09-22: `tmt-assets-1`, a media-compression slice that changes no
   automation code at all, dispatched the sweep for M1/G1 and started the whole F1 matrix with it — about 5.5
   runner-hours of measurement to answer a question nothing in that slice asked.

   **So, until the workflow takes an input for it:**
   · **Dispatching the sweep on a branch is how you get M1 and G1, and it is correct** — do not stop doing it.
   · ⚠ **Then look at the run and CANCEL the F1 jobs** unless your slice is re-deciding a reset default. Cancelling
     them does NOT invalidate the rest: read each job's own conclusion, because the RUN will then be marked
     `cancelled` while `units`, both `G1 load` jobs and `merge + roster assertion` still say `success`. That is the
     evidence; the run's own verdict is not.
   · **A slice needs F1 only if it changes what a reset DECIDES** — a default, a strategy, a rule the tables encode.
     A UI, media, docs or harness change does not, however large its diff.
   ⚖ **SHIPPED 2026-09-22 — it lives in `.github/workflows/measurements.yml`, and this is how you run it:**

       gh workflow run measurements.yml --ref <branch>  # every sharded TABLE, F1's matrix among them
       gh workflow run sweep.yml --ref <branch>         # M1 + G1 on a branch; no measurement runs

   ⚖ **THE STANDING RULE that file now carries** (automation arc, 2026-09-22): **a sharded TABLE a planner quotes
   goes in the measurement workflow; only a row that must HOLD goes in `sweep.yml`.** A measurement's rows pass on
   *"the cell completed, twice equal"* and its verdict is labelled *"(report)"*; a gate asserts a pinned mark, a
   hash, an inertness or a constructed behaviour. Moved on that reading: F1's matrix, **R3b-2's `ptr` table** (21
   min/push) and **R3c's rung sweep** (23 min/push) — 44 of the 194 successful runner-minutes a push used to spend.
   Staying, because they assert: `f1-rows`, `r3b2-rule`, `r3b2-inert`, `r3c-mark` + merge, `r3c-fixtures` +
   `-m27` (the leg that caught the boot truncation), the R3b row-cycle parts, C1, V1–V5, and M1.

   ⛔ **A SEPARATE FILE, NOT JUST A FLAG, AND THE REASON IS CONCURRENCY.** `sweep.yml` is
   `concurrency: sweep-${{ github.ref }}` with `cancel-in-progress`, and a dispatch on `main` and a PUSH to `main`
   share that group — so a push KILLED a campaign in flight. Measured: run 35646386975 (34 measurement jobs
   succeeded, **7 cancelled**) and 35636667015 (16 succeeded, **4 cancelled**). A dispatch input could not fix that;
   only a different concurrency group can. `f1.yml` has its own, and keeps `cancel-in-progress` — a second dispatch
   superseding a first is a choice someone made, a push killing a campaign is not.
   `f1-rows`, the cheap `maxRow` GATE, stays in `sweep.yml` and runs on every push. ⚠ **A planner who cannot find this switch will quote a STALE 0.05 row instead of measuring one** —
   the tick policy says no default moves without a 0.05 row, and that row comes from exactly these jobs.
   ⛔ `inputs.f1` is a BOOLEAN, so never write `inputs.f1 == 'true'`: GitHub compares a boolean to a string by
   casting the string to a number, making the test always false and the jobs silently unreachable.
   `loader/workflows.test.mjs` pins the input, each job's use of it, that the comparison form is NOT used, and that
   `f1-rows` stays ungated. A longer stretch CHAINS with `--stop-snapshot` + `--from-snapshot`,
   and ⚠ a resumed leg is credited the offline time of its boot: compare resumed with resumed, from the same fixture.
4. ⚠ **The ladder's `diff` fields are H1's COARSE-tick calibration (1 / 5 / 20 / 60 against 1) and say nothing about
   0.05.** They remain what they were: the coarsest diff a mark's timing survives within 2 % of `diff 1`.

## How a rung uses it

```
node tools/harness/run.mjs ptr --profile all --ladder tools/harness/ladder/ptr.json \
  --from-snapshot tools/harness/snapshots/ptr/all/M09.json --to M16 \
  --diff <the ladder's diff for the marks> --stall 3600 --stall-seen --wall-ms 540000 \
  --snapshots tools/harness/snapshots/ptr/all --json out.json
```

1. Start from the committed snapshot of the last mark reached (`--from-snapshot <prev mark>`), in the configuration the
   rung changes (`--auto-opt`, or the table itself).
2. Run `--ladder --to <next mark>`; a sweep varies one policy and compares game-seconds to the next mark.
3. When a new mark is reached, commit its snapshot (the fixture the next rung starts from), calibrate its `diff` if it is
   `null`, and print the ladder with `node tools/harness/ladder-summary.mjs [--append]`.
4. A change to the core or a table re-checks the earlier fixtures by resuming from them: the marks after must land at
   the recorded tick and `hashGame` (or the change is a finding, not a re-record).

⚠ **AND EVERY FIXTURE WRITTEN MOVES A SELECTOR, not just the readers that name it.** `deepestSnapshot()` picks the
file with the MOST TICKS across `snapshots/<id>/{frontier,all,pinned}/`, and `tools/harness/page.mjs` and
`tools/harness/cost-layerlist.mjs` both open ptr at whatever that is — so a new deepest fixture changes which SAVE
the M1 page sweep and the layerlist cost sweep measure, and any figure taken from them is owed a re-measurement.
(`shardCost()` is the exception: a measured cost in `tools/harness/shard-costs.json` takes precedence, and `ptr` has
one.) A rung that writes fixtures therefore owes a LIST — by name AND by selector — of what reads them; R1′, R2, V4
and R3a each carry one in their as-built.

⛔ **R3b-2 MOVED IT AGAIN: `snapshots/ptr/all/M25.json` (35,778 ticks) is now ptr's deepest fixture**, past
`all/M24.json`'s 30,736. It is H12 "Speed Demon" completed, written by an uninterrupted leg from `all/M15.json`
under the row cycle this slice turned on. The THREE readers, by name and by selector:

| reader | what it selects | what moves |
|---|---|---|
| `tools/harness/page.mjs:1929` | `deepestSnapshot('ptr')` → the save the M1 page sweep opens ptr at | the DETECTED and progress rows/cards the UI arc records in `docs/mobile.md` — owed a re-measurement at this head |
| `tools/harness/cost-layerlist.mjs:323` | the same call, unless `--fresh-only` | the layer-list cost figures |
| `tools/harness/lib.mjs:191` (`shardCost`) | the same save's `player`, to count unlocked layers | ⚠ NOTHING here: a MEASURED cost in `tools/harness/shard-costs.json` takes precedence and `ptr` has one, so the estimate is not consulted |

⚠ `M25.json` unlocks the same seventeen layers as `M24.json`, so even the `shardCost` estimate would not have
moved — but that is a fact about this fixture, not about the selector, and the next one to land owes its own check.

⛔ **R3c MOVED IT AGAIN, AND FOUND A FOURTH READER.** `snapshots/ptr/all/M27.json` (40,905 ticks — H21 "Out of Room"
complete) is ptr's deepest fixture, and `all/M25.json` was RE-RECORDED (35,778 → 35,613 ticks: the dead-member
rule's default reading moved to `high-act`). Both were written TWICE by CI (`gates-r3c --part 2f`, job
`r3c-fixtures`), uninterrupted from `all/M15.json`, and committed from the run whose twin agreed; M16–M24 were
rewritten by the same leg and are the SAME state as the committed files. The readers, by name and by selector:

| reader | what it selects | what moves |
|---|---|---|
| `tools/harness/page.mjs:1991` | `deepestSnapshot('ptr')` (most TICKS) → the save the M1 page sweep opens ptr at | the UI arc's DETECTED and progress rows/cards in `docs/mobile.md` — owed a re-measurement; NOT edited by R3c |
| `tools/harness/cost-layerlist.mjs:323` | the same call, unless `--fresh-only` | the layer-list cost figures |
| `tools/harness/lib.mjs:191` (`shardCost`) | the same save's `player` | nothing: `ptr` has a measured cost in `shard-costs.json` |
| ⚠ `tools/currency-data.mjs:55` (`snapshotOf`) | the highest `all/M<n>.json` by MARK NUMBER (not ticks) | `games-data/ptr.json`, which `--check` refuses when stale — regenerated at R3c: only each entry's `from` moved (`all/M25` → `all/M27`), every `pays` / `cost` and every count unchanged |

⚠ Two selectors, two orders: `deepestSnapshot` sorts by ticks and `snapshotOf` by mark number. They agree today; a
mark reached OUT of ladder order (M26 is reached after M27) makes them disagree the day its fixture lands.

⛔ **F1 REGENERATED `all/` AS ONE CHAIN FROM A FRESH GAME, AND MOVED THE SELECTORS AGAIN.** Until F1 the ladder's
absolute numbers were chained from MIXED-AGE fixtures — M01–M10 written under the A2 policies, M11–M16 under R1′'s
table, M16–M27 resumed from `all/M15.json` (~8,000 game-s of legacy at M15, found by the milestone-suppression arc).
F1's `gates-f1 --part fix` runs the shipped table + the passive yield + the derived `gain>=2x|stall>=5x/5` from a
FRESH game at `diff 1`, 100,000 ticks, TWICE in CI, and commits the 27 fixtures its twins wrote byte-equal: M12
14909 → **6862**, M15 16048 → **8168**, M22 30618 → **23262**, M25 35613 → **28260**, M27 40905 → **33546**, M26
83707 → **76931** (every mark, old → new, in the fixture commit and plan §48). The OLD files are kept byte-for-byte
under **`snapshots/ptr/pre-f1/`** — a fixture is a measurement of a configuration — and every gate written before F1
resumes from THEM and names the pre-F1 configuration on its pinned parts (`run.mjs` appends `TMT_NAMED_CONFIG` = `lib.mjs`
`PRE_F1` to the leg's `--auto-opt`; a key the leg names itself wins), so each of their pins reproduces to the hash.

| reader | what it selects | after F1 |
|---|---|---|
| `tools/harness/page.mjs` | `deepestSnapshot('ptr')` (most TICKS over `frontier/`, `all/`, `pinned/`) | `all/M26.json` (76,931 ticks) — the UI arc's DETECTED / progress figures in `docs/mobile.md` are owed a re-measurement (not edited here) |
| `tools/harness/cost-layerlist.mjs` | the same call, unless `--fresh-only` | the layer-list cost figures move with it |
| `tools/harness/lib.mjs` `shardCost` | the same save | nothing: `ptr` has a measured cost in `shard-costs.json` |
| `tools/currency-data.mjs` `snapshotOf` | the highest `all/M<n>` by MARK NUMBER | `all/M27` — `games-data/ptr.json` regenerated: **0 changed** |
| `tools/harness/shots-v5.mjs` | `all/M22.json` by name | the new M22 (a screenshot tool, run by hand) |
| gates v1–v5, c1, r3, r3b, r3b2, r3c 0/1, h1, p1a, p1b, and `gates-f1`'s resumed stretches | `pre-f1/` by name | nothing — they read the fixtures they were measured from |
| `gates-r3c --part 2 / 2f`, `gates-f1 --part fix`, `gates-r2 --part 2`, `gates-v4 --part fix`, `gates-r3 --part 4` | `all/` by name | the fixture WRITERS and the shipped rung: they continue from the new chain (r3c part 2's horizon 66048 → 58168) |

⚠ In the new chain several predicates hold OUT OF LADDER ORDER (noted since R3c): M10 5939 < M09 6451, M13 4492 before
M11, M14 = M11 (6815), M26 after M27. The ladder's `diff` fields are H1's coarse-tick calibration and are unchanged.
⚠ A HARNESS TRAP carried from the milestone arc, not fixed here (not in F1's path): with `--until` AND marks together,
`boot.mjs:347` does not record a mark that first holds ON THE STOPPING TICK.

## Scoring a DEFAULT: over WHOLE STRETCHES, never from the fixture the old default wrote (R2)

⛔ **A fixture bakes in the policy that produced it, and a layer UNLOCKS ON ITS FIRST RESET.** The two together make
"resume from the last fixture and compare" the WRONG instrument for choosing a default, and it took a measured
7,121 game-seconds to notice. `snapshots/ptr/all/M16.json` was written under `reset:q = gain>=2x`, which on an empty
purse is `gain >= 0`: it fired the instant one quirk existed, unlocked `q` early, and let a row-3 reset wipe row 2
before row 2 was finished. Every cell V2 and V3 scored "from `all/M16`" was therefore scored from a state the winning
default would never reach — and the winning default reaches M16 itself at **17058** rather than 24179.

The rule that replaces it:

1. **Score a candidate default over a whole stretch**, from the last fixture the candidate cannot have moved
   (`all/M15.json` for a row-3 default — row 3 has not acted by then), through the last mark of the rung, with the
   earlier marks as COLUMNS of that same run rather than as starting points.
2. **Add the opening as a second leg.** A fresh game to M12 is where a rule that waits too long shows up as a
   deadlock rather than as a slower number: `gain>=2x-unit` on `reset:p` is zero resets in 8,000 game-seconds.
3. **Add a second GAME as the generality control**, with its own table unchanged, so "the derived default moved and
   nobody noticed on the other 170 games" is a row rather than an assumption.
4. **Every cell twice, and a cell whose two runs disagree on the marks, the end game-second or the end `hashGame` is
   RED.** Game-seconds are deterministic; wall time is not.
5. **Regenerate every fixture the move moves, and say OLD → NEW** — tick and `hashGame`, per file — and make every pin
   that inherited the old default NAME its configuration (§14d.2 item 14) instead of inheriting whatever the table
   says today.

⚠ **A PREDICATE PASSED THROUGH `--auto-opt` MAY NOT CONTAIN A SEMICOLON**, and V4 measured it rather than assuming
it: `--auto-opt` and `?autoOpt=` split their string on `;`, so a `while:` / `until:` cell carrying one is cut in half
and the halves are read as two unrelated options. The symptom is
`option while:reset:q — not a JavaScript expression — Unexpected token ')'`, which correctly names the option and
says nothing about the semicolon. Write the predicate as a single expression (`&&` / `||` / `?:`, no `var`, no
statement) — a player typing into the tab is unaffected, because a saved predicate never goes through an option
string.

⚠ **AND A `--vary` CELL MAY NOT CONTAIN A VERTICAL BAR** — R3a's own trap, the same shape one level up.
`sweep.mjs` splits an axis's values on `|`, which is also the MODIFIER separator in a policy string and the `||`
of every predicate anyone would write. So `--vary "policy:challenges:h=sequential|give-up@0.1/30/2x"` is two cells,
neither of which is a policy, and `--vary "while:<id>=a || b"` is two halves of one predicate. A value carrying a
bar goes in `--opt` (which is passed through verbatim) or in a battery's own cell list — `gates-r3.mjs` runs its
cells that way for exactly this reason.

`tools/harness/sweep.mjs` runs that shape: **`--vary` may be repeated** (each occurrence is an AXIS, and the cells are
their cross product) and **`--repeat N`** runs every cell N times and reports `twiceEqual`. Every line carries
`ticks_ms` and the box's 1-minute load at the start and end of its own child, because a full pool changes ms/tick and
never changes game-seconds. It exports `runCells()` for a gate battery to drive directly (`gates-r2.mjs`), and it is
ENTRY-guarded, so importing it does not start a sweep. **One cell per process**: an L1 leg is ~14,000 ticks at 13–19
ms/tick on a quiet box and 40–45 ms/tick with six children on eight cores.

## The currency generator (`tools/currency-data.mjs`, C1)

`games-data/<id>.json` is GENERATED — which field each buyable really pays in, scored by a rollback buy
(docs/automation.md, "The currency reader") — and never edited by hand.

```
node tools/currency-data.mjs [--write | --check] [--ids a,b] [--shard i/N] [--jobs N] [--json out.json]
node tools/currency-data.mjs --check-index
```

- `--write` (the default) boots every game in `manifests/index.json` with `--planner --planner-script
  tools/harness/currency-read.js --ticks 0 --random-seed 1` and writes one file per game with buyables, plus the index.
  A game with an `all/M*` snapshot is also read at its deepest one; a buyable scored in both states must agree, or it
  abstains. A game that drew randomness is re-read under seeds 2 and 3, and an entry the seeds disagree on abstains.
- `--check` regenerates in memory and compares, naming each STALE game; exit 1 on any. ⛔ This is what keeps the data
  fresh by construction: a change to the reader, the loader or a game that moves any answer fails CI until the data
  is regenerated and committed with it. `--check-index` (no boot) checks only that the index names the files.
- Every flag is DECLARED: an unknown one exits 2 (`unknown flag --assert`).
- Cost, measured on this box: **~60–80 s for the whole roster at `--jobs 6–8`** (171 boots; 11 games drew randomness
  and were read three times). No process is near the 10-minute wall; `--shard i/N` exists for CI if it ever is.

**Which keys it enumerates (C1b, Q8, brief `tmt-auto-20`).** Every key of `layers[l].buyables` whose value is a
non-null, non-array OBJECT (`isBuyableDef`, `loader/tmt-planner.js`) — the reader, its purity pass, both
`gates-c1` drives (`currency-sample.js`, `currency-regex.js`) and the probe mirror all use that one rule. Until C1b
they also required a NUMERIC id and skipped 63 word-id buyables over 5 games; the regeneration added exactly those 63
entries (and moved only those five files' `summary` lines otherwise): universal-reconstruction 24,
the-hyperoperator-tree 14, the-gaming-tree 12, the-collab-tree-lun4-r 8, collection-of-everything 5 — 30 scored (19
own points, 7 foreign, 4 several), 33 abstaining. ⚠ 14 of those abstentions are a PRE-EXISTING reader defect, not a
word-id one: every buyable of `the-hyperoperator-tree` (numeric ids too) abstains with *"the reader threw: Decimal is
not defined"* — the game ships ExpantaNum and `tmt-planner.js`'s `D()` assumes `Decimal` (the same shape
`tmt-auto.js` fixed for itself with `NUMBER` in U2g).

**The probe controls in `gates-c1 --part 2` — each held to what it MEASURED.** The frozen `PROBE` (103 games) and
`PROBE_2026_09_22` (4 games) were measured by a probe that skipped word ids, so each is now compared with the reader's
NUMERIC-id entries on its own games; neither is edited. The probe itself is mirrored as
`tools/harness/probe-buyable-currency.js` (the NewDocs original with the `isNaN` skip dropped and a `word` tally) and,
run over all 175 games at C1b, reproduced both numeric controls to the digit (1739 / 1209 / 610 / 97 / 431 / 2 and
217 / 171 / 85 / 42 / 4 / 0). The word ids have their OWN dated control, `PROBE_2026_09_22_WORD` (5 games: 63
buyables; the probe's regex finds one field for 37 — own 27, foreign 10 — several for 4, none for 22), against the
reader's word-id entries on those games: **63 = 63**. Q7's rule holds: the roster is derived, the measurement pinned —
a word-id entry on a game outside that list is named as outside every claim, never folded in.

`tools/auto-tables.mjs` is its authored-data counterpart: `--check` (the schema file equals the loader's, every
`games-auto/<id>.json` validates with the loader's own validator), `--write` (regenerate the schema file), and
`--provenance` (the provenance GATE — every entry has a record, every commit is an ancestor of HEAD, every gate is a
SUMMARY row or a named CI run). docs/automation.md, "The data table".

> **S1T (2026-09-29, ⚖ R12/R13):** "every commit is an ancestor of HEAD" is now "every commit is in the FROZEN list
> `tools/harness/recorded/provenance-commits.json`" — the gate reads no git. A new record's commit is added with
> `node tools/auto-tables.mjs --add-commit <sha>`. See "No gate reads git history" at the end of this file.

## What runs where

⚖ Until U2g (2026-09-18) CI held exactly one gate — the M1 mobile sweep — and every other check ran on one box, in
one session, when somebody remembered. What that costs is on the record: `buyUpgrade` turned out to be an alias two
games do not define, so a chip press bought nothing on them for two slices, and it survived because **no gate ever
drove a chip**. ⛔ A check nobody runs is not a check.

| check | where it runs now | cost |
|---|---|---|
| unit tests (`npm run harness:test`) | CI, the **fast** job — and everything else `needs:` it | **305 tests**, no browser — RE-MEASURED by C1c (`tmt-auto-21`) on its final tree, which added nine (`loader/c1c.test.mjs`: the planner's number type with no global `Decimal`, the trace not recording the resolution, an operation abstaining BY NAME for a missing method, a `player.points` that is not a number object; the purchase enumeration's order, the display-only guard, a word-id buyable bought; a BUTTON judged by the amount it raises, and with no data judged as before) and changed none of the count elsewhere (`workflows.test.mjs` pins `c1c-buy` as a measurement and `c1c-cap` / `c1c-inert` as push gates in its existing tests); V6 + C1b (`tmt-auto-20`) measured **296** on its final tree, which added NONE (the 11 since assets-1's 285 came in with the trees it started from; its new pin is a name in `workflows.test.mjs`'s `PUSH_GATES`, not a test); assets-1 measured **285** on its tree, which added six (`loader/media.test.mjs`: the media scope, header sizes, the stubs' bytes, the dimension assertion, raw/processed/skip on a scratch tree, and the committed roster) and changed none elsewhere; F1 measured **279** on its final tree, which added twelve (`loader/passive.test.mjs`: the passive yield, its threshold / unlock wall / off-switch / value types / cycle exit, the `resetDefault` / `sinceReset` / `fallbackFires` levers, the stall fallback firing on a PATIENT rule, and the `maxRow` repair) and changed none of the count elsewhere (three assertions in `strategies.test.mjs` / `watch.test.mjs` now read or name the new derived default); the tree F1 started from measured **267** (R3c's 262 plus the UI arc's U13 and two gate fixes); R3c measured 262 on its final tree, which added four (`loader/cycle.test.mjs`: the `turnMark` readings) and changed none elsewhere; C1 measured 258 on its final tree, which added sixteen (`loader/auto-tables.test.mjs` nine: the schema and the provenance gate, each failure by name; `loader/currency.test.mjs` six: the currency consumers; `loader/workflows.test.mjs` one: the C1 jobs) and changed none elsewhere; R3b-2 measured 242 on its final tree, which added five (`loader/cycle.test.mjs`, the dead-member rule) and changed none elsewhere; V5 measured 237, which added eleven (`loader/retry.test.mjs`, the RETRY conditions) and changed none of the count elsewhere (one existing row of `loader/strategies.test.mjs` now draws its refusal per TYPE, because a `predicate` accepts `banana`); R3b-1 re-measured 226 and added twenty-four (`loader/cycle.test.mjs`, the ROW CYCLE) on top of R3a's seventeen (`loader/challenges.test.mjs`, the challenge give-up rule) on top of V4's twenty (`loader/controls.test.mjs`); ⚠ the number V4 wrote here was **180** and the tree it was written on measured **185**, which is the drift this row exists to catch; R2 read 160 and added two (⚠ it read `46 tests`, then `75`, then `82`, then `138`, then `158`, every one of them stale — a count in prose that no gate reads. It had drifted by fifty-two before U7 re-read it, and by twenty again between U7 and the U8 merge. ⛔ RE-MEASURE IT AT EVERY MERGE: this row is the standing example of a count conflict that must not be resolved by picking a branch's number — U3 merged 75-vs-60 and the merged tree measured 79) |
| G6 roster doc + G7 declined list (`games-table.mjs --check`) | CI, the fast job | 0.13 s |
| media — every image WebP, every audio file the stub (`media.mjs`, no `--write`) | CI, the fast job | ~1 s; see "The media gate" below |
| C1 the tables' schema + the currency index (`auto-tables.mjs --check`, `currency-data.mjs --check-index`) | CI, the fast job | < 1 s |
| C1 the currency data regenerated + the provenance gate + the reader's accuracy (`gates-c1 --part 3, 1, 2, 6`) | CI, `c1-data` (full history) | ~70 s for the regeneration locally, ~2 min per boot pass |
| C1 inertness (`gates-c1 --part 4`) and the consumers + rider (`--part 5, 7`) | CI, `c1-inert` / `c1-consumers` | the M15 → 37048 legs dominate |
| roster FIGURES census (`census-figures.mjs`) | CI, the fast job | 1.2 s |
| M1 mobile sweep (`--gate mobile`) | CI, ten shards + a merge | ~3 min end to end; 32–46 min locally |
| G1 load (`--gate load`), plain **and** `?automation=1` | CI, two unsharded jobs | 5 min each, serial, locally |
| S1 part 1 — the automation anchors | CI, its own job beside the matrix | 52 checks, 197 s locally |
| G5 (`check-pages.mjs`) | **the deploy**, `pages.yml`, after the site is published | ~100 s+ |
| O1 options (`--gate options`) | a slice, on a bounded set; not sharded | ~19 page loads per game, ~1 min/game locally |
| A1 part 2 — the `au` tab's own page checks, including the U4 arming flow and the U16 PLAYER view | CI, the `a1` job — over a set DERIVED from `games-auto/` plus the table-less control, never typed | ~14 rows per game, ~3 min for two locally |
| the M1 sweep on a bounded local set | a slice, before it pushes | minutes |

⚠ The numbers above are local wall clock on one workstation unless they say CI; CI runs this kind of work about
**2.3× faster** than that box. They are here to explain the SHAPE of the workflow (what shards, what does not), not
as a scoreboard — the authoritative number is a run.

**Measured in CI**, first green run of the new arrangement (`1769f1e59`, 2026-09-19): **3 m 51 s end to end** for
the whole battery, against 3 m 03 s for the M1 sweep alone before it. The fast job is **14 s**; the merge 14 s; the
ten M1 shards 132–187 s; **G1 plain 178 s and G1 automation 176 s**; the anchors job 183 s. ⚠ Read the G1 numbers
against the shards: **one unsharded G1 job costs what ONE shard of M1 costs**, because ~90 s of it is checkout,
`npm ci` and the Playwright install. That is the whole argument against sharding it, and it is now a measurement
rather than an extrapolation.

⛔ **Everything in `sweep.yml` past the fast job is gated on it.** Three seconds of unit tests decide whether
thirteen runners start. `loader/workflows.test.mjs` asserts the `needs:`, because the way that gets undone is a
convenience edit by someone whose change "does not touch the units".

> **S1T (2026-09-29):** the `c1-data` row's "(full history)" no longer holds — every job checks out at depth 1 now, and
> `workflows.test.mjs` refuses a `fetch-depth: 0`. The fast job also runs `node tools/pristine.mjs --check` (< 1 s).

### The PLAYER view has its own row, and the vacuity question belongs to the RUN (U16)

U16 put the feature ids, the rule codes, the table / derived / alternative comparisons and the measurement notes
behind a *show developer details* switch that starts **off**. Three legs turn it on — `gates-a1` part 2's
render ≡ headless comparison, `gates-v3` part 5's provenance-inertness check and `gates-v4` part 6's
find-the-block-by-id — because each compares exactly the things the switch hides. That is the right fix for those
three, and it left the view a player actually sees asserted by **nothing**.

`gates-a1 --part 2` therefore emits a SECOND row per game, `A1-2 … PLAYER view (developer details off, 390 px)`.
It runs first, on the same boot, before the switch is touched, and it starts RED (`NOT RUN`) so that a throw before
the pass leaves a row rather than a silence. The block no longer names its own id, so
`button.tmtl-onoff[data-fid]` is the hook; the block is its sibling.

Three things about it are easy to get wrong, and all three were measured getting it wrong first:

- **Compare like with like.** A locked or excluded row draws one collapsed line and no provenance at all, so
  "every table note is replaced" has to count the rows that DRAW A BLOCK, not every row `explain()` returns. The
  first cut compared 4 drawn lines against 11 notes and went red on a view rendering perfectly.
- **A per-game non-vacuity clause is wrong for a game with nothing to exercise it.** `ptr` carries 4 notes on its 6
  drawn rows; `something` carries 0 on its 5 — a legitimate zero, which a `> 0` clause turned red. What has to be
  true is that SOME game in the run exercised it, so that is one run-level row emitted after the loop, and a run
  where nothing exercised it says so instead of passing quietly.
- **⛔ A run-level row must carry `runLevel: true`, and `--assert` must filter it out.** `gateCoverage` places
  every row by its game id and asks whether every game is present and whether they all ran the same battery. A row
  whose id is the RUN's (`ptr+something`) is neither: unfiltered, it reads as a row for a game the run was never
  given AND as an unequal per-game count, and CI **refuses a correct run**. Its verdict is not lost — the process
  exit is over every row.

Mutants, all four killed, each on its intended check (`results/` screenshots are written either way):
one feature dropped from the list entirely; the raw rule code appended to the strategy line with NO `.tmtl-dev`
div; the `now:` line drawn with an empty reason; the feature id appended to the title. The middle two are shaped to
leak WITHOUT tripping the `.tmtl-dev` count, so each isolates the check it targets — a mutant that trips two
checks tells you less than one that trips the one you meant.

### The media gate (`tools/media.mjs`, assets-1)

⚖ The user's 2026-09-22 ruling lets this repo change ONE kind of file under `games/<id>/`: media — images re-encoded
as WebP at the same pixel size, audio replaced by a silent stub, both under the original filename
([add-a-game.md](add-a-game.md), "Media: the one exception to pristine"). A `git subtree pull` restores the original
of every media file upstream touched, and the game still works — so nothing a game-driving gate can see would notice
the compression quietly disappearing. Two gates do:

- **`node tools/media.mjs`** in the fast job (`node:` builtins only, no Python): exit 1 naming every in-scope image
  that is not WebP bytes and every audio file that is not byte-identical to its stub, plus any declared skip
  (`games-media/skipped.json`) whose bytes moved or that the tree no longer has. `loader/media.test.mjs` runs the
  same check over the committed roster and drives each red on a scratch tree; `loader/workflows.test.mjs` holds the
  step in place as a real check.
- **`check-manifest`'s `games pristine`** now admits a difference from the subtree squash made only of in-place
  modifications of processed media files — so a restored original is `games pristine (media)` RED there too, and a
  changed byte of code, markup or a licence is still plain `games pristine`.

  > **S1T (2026-09-29):** "the subtree squash" is now its RECORDING, `games-pristine/<id>.json` — the rule is unchanged.

The fix for a red is `node tools/media.mjs --write <id>` (Pillow in `.venv`), committed on its own. Mutants:
`tools/harness/mutants-assets1.sh` (7 of 7 killed; add-a-game.md lists them).

### G1 does not shard, and that is a measurement

`--gate load` over the whole roster is **5 min 00 s** serial locally (171/171 green, 1.75 s/game, measured
2026-09-18 at `61c7e2ba8`), and the `?automation=1` page is **5 min 07 s**. At CI's ~2.3× that is 2–3 minutes of
sweep against roughly **90 s per job** of fixed checkout + `npm ci` + Playwright install. Ten shards would pay that
90 s ten times to save two minutes of wall clock: a matrix that costs more setup than it saves is a worse answer
that merely looks busier. M1 shards because it is ten times more expensive per game, not because sharding is what
one does.

⛔ **Unsharded is not unasserted.** The G1 jobs run as `--shard 1/1`, so each records the roster it was assigned and
the same `merge-shards.mjs` refuses the run if the rows do not reconstruct it. A gate that quietly enumerated 170
games fails there exactly as a dead shard does in the matrix.

⚠ **The two G1 dimensions are two jobs, not one run.** `--gate load` defaults to the PLAIN page; `gates.mjs` runs G1
with `?automation=1`, where the loader also installs the automation core. They are different pages, a conflated run
could not say which one broke — and the first full run of the automation one found a real defect on two games
(`loader/tmt-auto.js` assumed every fork calls its big-number type `Decimal`; `the-hyperoperator-tree` ships
ExpantaNum and `the-pro-tree` ships OmegaNum, so `onload load()` died on both while the plain page was green).

⛔ **AN UNPAIRED `net::ERR_ABORTED` IS NOT A LOAD FAILURE** (2026-09-21). Playwright reports a request the
browser CANCELLED through the same `requestfailed` event as one that failed, so both land in `pw.failed` and
`judgeLoad` judged them alike. The roster says they are not alike: over the G1 artifact of a green run, **all 16
aborts are the browser's SECOND record of a real HTTP failure on the SAME URL** (the-pro-tree 10,
the-question-tree 2, the-game-tree 2, the-periodic-tree 2) and **zero stand alone**. An abort that stands alone
does not appear in a green run — it appears when a request is still in flight as a leg tears the page down.
`the-rainbow-void-tree` reddened a run that way on `audio/elevatorMusic1.mp3`, which at **3.3 MB** is the largest
request those pages make and so the likeliest to be caught mid-flight.

So `judgeLoad` now declassifies an abort ONLY when no other failure record names the same URL, and reports it as
`abortedAlone` rather than dropping it. ⚠ A PAIRED abort is judged exactly as before — it is a 404 wearing a
second hat, and rescuing it would hide a real missing file. **Replayed over the 342 G1 rows of the green run at
`57a0d8c3e`, the new rule changes ZERO verdicts**; `loader/loadverdict.test.mjs` holds the two cases apart.

## The full sweep runs in CI, sharded (`--shard i/N`)

Every UI slice owes a full `--gate mobile` sweep over all 171 games. Locally that is one machine held for around
three quarters of an hour (measured 2026-09-18: ~16 s/game, ~46 min for the roster — U2b's visibility rules pushed it
up by adding four in-page probe evaluations and two forced rebuilds per game). `.github/workflows/sweep.yml` runs it
on every push to `main` across ten runners instead, so a slice can verify a **bounded local set** — `ptr`, `something`,
and whatever its own change can actually be seen on — and let CI own the roster.

### Running one shard locally

```
node tools/harness/page.mjs --gate mobile --shard 3/10 --dry-run          # which games is shard 3? (no browser)
node tools/harness/page.mjs --gate mobile --shard 3/10 --json shards/m1-3.json
node tools/harness/merge-shards.mjs shards --expect 10                    # the verdict
```

`i/N` is **one-based**, like Playwright's own `--shard=1/10`. The slice is a pure function of the roster and `N`, so
`--shard 3/10` here and shard 3 in CI are the same games — verified across machines, not assumed: `--dry-run` locally
reproduces exactly the roster CI's shards 1, 5 and 10 recorded being assigned. `--shard` also works with an explicit roster
(`page.mjs a b c --gate mobile --shard 1/3`), which is how the arrangement is tested without a full sweep.

### What the merge asserts, and why it is not optional

⛔ **A shard that dies before running anything reads as GREEN.** `npm ci` falls over, the runner is reclaimed, the
checkout times out — the shard produces no rows, and an absence of failures is indistinguishable from a pass. Worse,
the incentive runs backwards: a sharding bug that silently drops games makes the whole run **faster and greener**.
Speed is not evidence here and neither is an exit code.

So every shard records the roster it was **assigned** alongside the rows it produced, and `merge-shards.mjs` refuses
the run unless those reconstruct the roster. Four independent refusals:

1. every shard index `1..N` present exactly once, all shards agreeing on `N`;
2. every shard reporting the same `commit` — a shard built from another tree is not part of this answer;
3. each shard's rows covering exactly its own assigned roster, which is what catches a shard that started, ran four
   games and died (its file exists, its rows are green, and its job may well have exited 0);
4. the union of the rows covering the full roster **exactly once** — nothing missing, nothing twice.

A hung game is covered by the same mechanism rather than a special case: the gate has no per-game timeout, so a
shard that hangs is killed by the job's `timeout-minutes` and produces no JSON — which the merge reports as a missing
shard, naming every game that shard was assigned. ⚠ That is the *only* thing standing between a hang and a green run,
so do not raise `timeout-minutes` past the point where a stuck shard would outlive the run.

It exits 1 naming the ids. `loader/shard.test.mjs` drives it: nine shards out of ten, a shard truncated mid-slice, a
commit mismatch, an empty matrix. Those tests were written against deliberately broken versions of the merge and the
partition, and each mutant turns them red — which is the only reason to believe they mean anything.

⚠ **An abstention must survive sharding.** `the-periodic-table-tree` and five others do not repeat their own hash, so
the M1 state leg abstains on them rather than reaching a verdict. A shard boundary must never promote that to a pass
or a failure; the merge carries it through and reports the count.

### Interleaved, not chunked

`assignShards` is longest-processing-time-first: heaviest game to the lightest shard so far, ties to the lowest index.
When every cost is equal that degenerates to plain round-robin over the id-sorted roster, so interleaving is the floor
and the cost model can only improve on it.

⚠ **Two cost models have been wrong here, and the second one is the interesting one.**

The first was *cost ∝ views*. Only `ptr` and `something` have deep snapshots, so only they are swept at every tab that
save can open — 20 and 14 views against everyone else's 1 — which looks like 20× the work. It is not: most of a game's
cost is fixed (three boots for the state leg and its control, the navbar-only leg's paired control, the layers legs),
and an extra view costs about 0.94 s. That model put one shard on a single game.

The second was `12 s + 1 s × (views − 1)`, which replaced it. The first green CI run (171 games, `a665c24`, 2026-09-18)
measured what no view count can see — **the dominant term is how expensive the game itself is to boot and tick**:

| game | views | CI wall |
|---|---|---|
| `the-gaming-tree` | 1 | 53.4 s |
| `the-point-tree` | 1 | 47.2 s |
| `plague-tree-vorona-cirus-treesease` | 1 | 41.1 s |
| `ptr` | 20 | 14.6 s |
| `something` | 14 | 10.2 s |
| *median / mean / fastest* | 1 | *3.3 s / 4.8 s / 1.6 s* |

`ptr` is not in the top three. The spread between the median game and the slowest is 30×, and "it averages out over
the ~17 games a shard holds" — which this document claimed before that run — came out **false**: the shards ran 47 s
to 157 s, a ×3.33 spread.

So `shardCost` consults a **measured table**, `tools/harness/shard-costs.json`, and falls back to the view estimate for
a game nobody has timed yet. Regenerate it after a green sweep:

```
node tools/harness/merge-shards.mjs shards --expect 10 --write-costs tools/harness/shard-costs.json
```

It refuses to write from a run that did not cover the roster — a partial run's timings would teach the next run to
balance against games nobody timed.

⚠ **Do not read the in-sample number as the result.** The table predicts ×1.02 on the run it was built from; the very
next run came out **×2.22** — better than the ×3.33 it replaced, and nowhere near the prediction. The gap is not a
modelling failure, it is the runners. Measured across the two runs, the SAME game's wall clock moves by 0.57× to
1.93× (median 1.05, quartiles 0.94 and 1.37), and an oracle given run 2's own timings in advance would have scored
×1.02 on run 2 — a number no table written beforehand can reach. **×2 is roughly the floor for a static cost table
here**, and chasing it further is chasing noise. Measured: ×3.33 without the table, then ×2.22, ×1.90 and ×2.21 over
the first three runs with it. (These are not kept up to date per run — they are the evidence for the floor, not a
scoreboard.)

⚠ **Nothing about coverage depends on any of this.** The table will go stale, a new game will not be in it, and
neither matters: `assignShards` partitions the roster exactly once whatever the costs are, asserted over
N ∈ {1, 2, 3, 7, 10, 17, 170, 171, 200} in `loader/shard.test.mjs`. **A bad cost model makes CI slower; it cannot make
it wrong.**

### What CI is, and is not

⚖ **Report-only, not a required check** (2026-09-18), until the sweep has a few green runs behind it. Nothing in branch
protection references it; a red is a red X on the commit and blocks nothing.

Measured over the first four green runs (171 games, 10 shards each): **3 m 43 s**, 3 m 01 s, 3 m 08 s and 3 m 03 s
end to end, against **32.5 minutes** for the same sweep locally (mean 11.4 s/game — ⚠ not the ~50 s/game this arc was
briefed at). Each shard job was 97–197 s, of which roughly 90 s is checkout, `npm ci` and the Playwright install
— so the sweep itself is the smaller half of a shard's wall clock, and pushing past 10 shards buys little.

⚠ If you see a RED on `the-periodic-table-tree`'s state leg, **investigate it — do not re-run.** That leg used to
return a false RED about 7.9 % of sweeps, which on a per-push job is a red roughly weekly for no reason; `e3ba99c74`
took it to ~1 in 80,000 by demanding four further plain draws before it will say MOVED. A red there is now a finding.

CI pins Node to the version the local sweep runs (`NODE_VERSION` in the workflow), because the merged output is
compared against a local full sweep's verdicts and a different engine is a variable nobody wants in that comparison.

**CI and a local sweep agree, measured.** The merged output of both CI runs was compared against a full local
unsharded sweep at the same code: the roster is an **identical set** of 171, and `ok`, `inertOk`, `geometryOk`,
`navOk`, `bothOk`, `navbarOnlyOk`, `layersOk`, `rulesOk`, `ready`, the per-game view count and the per-game chip
count are **identical on every game**. The state leg abstained on the same six either way, and nothing reported
MOVED. The shard assignment is identical across machines too: `--shard i/10 --dry-run` locally reproduces byte for
byte the rosters CI's shards recorded being assigned.

### The roster FIGURES have a gate of their own

⛔ **Three wrong roster figures shipped in this arc, by two different authors, and no gate could have caught any of
them.** The sweep drives games; a number quoted in prose has nothing behind it. All three had one cause —
`sorbet-s-convolution-mainframe` keeps its engine under `Javascript/`, not `js/`, so a glob bounded to `js/` drops
one game and produces a count that is too low by exactly one, which reads like a finding about a holdout rather than
like a bug in the sweep. One of them even survived a disagreement between two sessions: each explained the mismatch
instead of re-running the census unbounded, and the explanation was true and still hid the error.

`node tools/census-figures.mjs` is the mechanism. It enumerates games from `manifests/index.json` — **never from a
directory glob** — reads each game's sources, and REFUSES a game whose sources it could not find rather than counting
it as zero. Then it reads the figures back out of the prose that quotes them (`docs/mobile.md`, `docs/games.md`) and
fails when the two disagree, including when the sentence has been reworded past the anchor: a claim that stopped
being checked must not look like a claim that passed.

⚠ **A figure without its scope is not a figure**, so each claim names one: `subtree` (every `*.js` under
`games/<id>/`, which is what the published static counts mean, and which sees `Old Code/` and `js/Demo/` that the
loader never loads), `loaded` (only what the manifest says the loader loads), and `js` — the historical bug, kept
only so `loader/census.test.mjs` can drive the gate bounded to it and watch it refuse by name.

```
node tools/census-figures.mjs             # measure, check the docs, exit 1 on drift
node tools/census-figures.mjs --bound js  # the bug, on purpose: REFUSED, naming sorbet-s-convolution-mainframe
```

### Publishing is a separate, manual workflow — and the deploy is now checked

⚖ **User ruling, 2026-09-18: the Pages deploy no longer happens on every push.** The repo was on `build_type: legacy`
with source `{branch: main, path: /}`, so every push republished the site; it is now `build_type: workflow`, and
`.github/workflows/pages.yml` is `workflow_dispatch` only. **To publish: `gh workflow run pages.yml --ref main`.**

WHAT is served did not change — the legacy build served the branch's tracked tree from the repo root, and the workflow
stages `git archive HEAD`, which is exactly that. Only WHEN moved. The artifact is 242 MB over 12,864 files, 128 MiB
compressed, against a 1 GB Pages limit; excluding `.git` (210 MB) is what keeps it there.

⛔ Do not add a `push:` trigger to `pages.yml`, and do not let `sweep.yml` deploy. `loader/workflows.test.mjs` asserts
both, because the way a ruling like this gets undone is not malice but convenience.

⚖ **G5 moved onto the deploy (2026-09-18).** `tools/check-pages.mjs` used to be a thing a session ran by hand before
pushing. It is now the `verify` job of `pages.yml`, after the deploy, in a new `--live` form — for two reasons. On a
push it would certify something the push did not change, since pushes no longer deploy. And nothing verified a
manual publish at all: the deploy job going green says the ARTIFACT uploaded, and U2h still had to fetch the URL by
hand to see whether the site was serving. **A deploy that succeeds and serves the previous tree is the failure with
no witness.**

```
node tools/check-pages.mjs                              # the CLONE form: a bare clone, served at a sub-path, locally
node tools/check-pages.mjs --live https://…/tmt-loader/ # the DEPLOY form: the published site
```

The live form checks what only it can: it GETs a set of tracked files from the site and compares them **byte for
byte with `git show HEAD:<path>`**, and it WAITS — polling up to five minutes — for those bytes to become this
commit's, reporting how long settling took. "The deploy had not propagated yet" is then a measured wait instead of a
flaky red. It then runs the picker checks over the whole roster (one page load naming all 171 games and their
metadata) and G1 over a NAMED three-game sample: `ptr` (the deepest), `sorbet-s-convolution-mainframe` (the game
every bounded sweep in this repo has dropped at least once) and `the-modding-tree` (the stock engine). ⚠ It cannot
check "the clone is unmodified" or "the repo is clean" — there is no clone — and it prints those as SKIPPED rather
than letting them pass silently.

> **U15 (2026-09-23):** the picker is gone — ⚖ the user ruled that the loader's home page is a short explanation and a
> link to the census, which is where the games are listed. G5's three picker steps are replaced by three home-page
> steps (ready with no error; fetches nothing but `index.html` and `loader/` modules; links the census), so the
> paragraph above no longer describes a whole-roster check. The roster is held by G6 and the sweep.

## No gate reads git history (S1T, 2026-09-29)

⚖ **R12 (user, 2026-09-29):** the repository split starts from two EMPTY repositories and imports only today's tree —
no history — and *"redesign the tests to work with the new system"*. **R13 (user, same day):** *"I don't want the new
repo to have anything that requires the old repo to still exist."* So no gate may resolve, fetch, check out or
ancestor-check a commit of the old history, in CI or locally; a historical sha may appear in a record as TEXT (where
it came from), never as something that must resolve.

S0 measured four gate families that did (tmt-repo-split-plan, "S0 — as measured", P1). Each now reads a committed
record, generated ONCE at S1T from the history while it existed:

| gate | read from history before | reads now | regenerate |
|---|---|---|---|
| G4 `check-manifest` `games pristine` (and `add-game`, `gates.mjs`, `gates-a1`, `gates-s1`, `gates-l2b`, `triage`) | each game's `git-subtree` squash commit (`log --grep`), its tree against `HEAD:games/<id>`, `status -- games/<id>` | `games-pristine/<id>.json` — the upstream commit, the upstream tree id, and every file's git blob id — against the FILES (`tools/pristine.mjs` hashes them as git does, `node:` builtins only); the working-tree check is `git -C games status -- <id>`, which reads the same whether games/ is a directory or a submodule | a new game: `add-game.mjs` writes it (`pristine.mjs --write <id>`) after the import, before media; a re-pin: `pristine.mjs --write <id> --from <upstream checkout>` |
| `auto-tables --provenance` (C1-3) | `git merge-base --is-ancestor <record's commit> HEAD` | the frozen list `tools/harness/recorded/provenance-commits.json` (sha, date, subject) | a new cited commit: `auto-tables.mjs --add-commit <sha>` (the one place it asks git, about THIS repository) |
| `gates-c1c` parts 2, 3 (`c1c-buy`, `c1c-inert`; `mutants-c1c.sh` m3) | a control worktree at `4d8ee5a69` | `tools/harness/recorded/c1c-before.json` | from the archive, at the recorder commit it names |
| `gates-s1` part 1, 1s (`anchors`) | throwaway worktrees at `3bc12bf`, `17260e03`, `71da72e` | `tools/harness/recorded/s1-baselines.json` | from the archive, at the recorder commit it names |
| `mutants-assets1.sh` M1, M2 | `git show <squash>:<file>` for an original | an UNPROCESSED stand-in (the image re-saved in its own format at its own size; audio that is not the stub) — the mutants need a raw file, not upstream's exact bytes; a new M6 edits a record | — |

Each record names what it was generated from and by what (`recorded.from` / `recorded.by`). The recorders
(`tools/harness/record-history.mjs`, and the `--record` flags of `gates-c1c` / `gates-s1`) were committed, run, and then
deleted in the same slice: the archive keeps them at the commit each record names, and the imported tree does not
carry code that needs the old history.

⚠ **Two of these change what the gate PROVES**, and say so in their own headers:

- **`gates-c1c` and `gates-s1` compare HEAD against a RECORDING of the old commit's run**, not against the old code run
  today. Before recording, every recorded run was made TWICE and the two recordings compared equal (the runs are
  deterministic). The rows go red on the same code defects as before; what they no longer notice is a move in
  something the OLD run read — a game's files, a ladder or snapshot fixture, HEAD's `games-data/` (c1c part 2's lift
  script prepends it on both sides), the runtime. A `baseline` row of gates-s1 now checks the recording against
  SUMMARY, so it reds only if the recording is edited.
- **G4 compares the working tree's FILES with the record**, where it compared the committed tree with the squash and
  then asked `git status` about the rest. The two are equivalent on a clean checkout — measured at S1T on all 175
  games: the same verdict, the same 1,732 processed media files, and the same tree id per game (`listDisk` hashes to
  `HEAD:games/<id>` on every one). A record is self-authenticating: its listing must hash to the tree id it names, so a
  hand edit of one blob id reds `games pristine (record)`.

`workflows.test.mjs` refuses a `fetch-depth: 0` in any workflow: one coming back is the first sign a gate reaches for
history again.

