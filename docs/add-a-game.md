# Adding a game

One command does it, from a checkout of [tmt-fork-census](https://github.com/PeerInfinity/tmt-fork-census) beside this
repository (`--census <dir>` or `TMT_CENSUS` otherwise; the census is a dev-time dependency of the tool only — the page
and the harness never import it):

```
node tools/add-game.mjs <owner/repo> --dry-run          # id, SHA, license verdicts and the manifest; no git
node tools/add-game.mjs <owner/repo> [<owner/repo>...]  # add, then gate
```

A game must have a census row (booted, with its shallow clone under `clones/`). Options: `--id <id>` and
`--sha <full sha>` override the defaults for a single target; `--tag <text>` prefixes the SUMMARY gate names;
`--au-check` also opens the game with `?automation=1` and checks that the empty `au` tab renders; `--json <out>`.
It prints one JSON line per game: `{id, repo, rank, sha, license, added, media, gates: {checkManifest, media, idleHash, goldens, load}}`
(plus `skipped`, `detail`, `idCollision`, `error` where they apply).

## What it does

1. **Preflight** (every target first; no git operation):
   - **id** = the census row's `mod_name` lower-cased, every run of non-alphanumerics → `-`, trimmed. A mod name
     written in a non-Latin script slugs to the empty string (墙树, 层级树 — both in the census top 100), so the id
     falls back to the **repository name**, then the **owner**: a GitHub repo name and owner are always ASCII, so
     one of them always slugs, and every candidate is data the census already holds — no transliteration table and
     no per-game knowledge. The run reports `idFrom` whenever the id did not come from the mod name. It collides
     with an existing `manifests/<id>.json`, the same slug of an existing manifest's `name`, or an id produced
     earlier in the same run → `-<owner>` is appended (`idCollision` reports it; this is per RUN, so a batch must
     go in as ONE invocation or two candidates can claim the same id; e.g. `prestige-tree-rewritten-unsoftcapped4`
     beside `ptr`). An id that still fails `^[a-z0-9-]+$` is refused (pass `--id`). A repo already in the loader
     (matched on `upstream.repo`) keeps its id and is not added again; `--dry-run` then reports whether the emitted
     manifest reproduces the committed one.
   - **Manifest**: `scripts/manifest.mjs <owner/repo> --id <id>` from the census, into a temp file; `load.vendor` is
     filled from the vendored files the existing manifests already pin (sha256 re-checked against `vendor/`); a `vendor`
     URL no manifest pins **stops the run** before any git operation (vendor it by hand: fetch into
     `vendor/<lib>-<version>.min.js`, check it is JavaScript, record `{path, sha256}` in a manifest); `patches: []`;
     no `auto` (a game without a per-game table still gets the registry and an empty `au` tab under `?automation=1`).
2. **Subtree** (the working tree must have no tracked changes — `git subtree add` refuses them):
   ```
   git remote add -f <id>-upstream https://github.com/<owner>/<repo>.git
   git remote set-url --push <id>-upstream no-push
   git subtree add --prefix=games/<id> <full sha> --squash
   diff -r -x .git games/<id> <census clone>                # must be empty, else abort and report — never patch
   ```
   then **the media exception** — images to WebP, audio to the silent stub, same filenames — as its own commit
   `media(<id>): …` on top of the squash ([below](#media-the-one-exception-to-pristine)).
3. **Manifest + index**: `manifests/<id>.json`, and `{id, name, repo}` appended to `manifests/index.json` (the picker's
   roster; `repo` = `upstream.repo`, what the census joins on).
4. **Gates** (rows appended to `tools/harness/results/SUMMARY.md`; a red gate keeps the subtree, which is pristine and
   licensed, and is recorded as `RED: <message>`):
   - `check-manifest` — the pin vs the live `index.html`, vendor sha256, `games/<id>` pristine at the squash up to
     processed media files modified in place;
   - **media processed**: every in-scope image WebP, every audio file the stub (`tools/media.mjs <id>`);
   - **idle hash**: `run.mjs <id> --ticks 200 --diff 0.05 --no-automation` = `manifest.headless.idleHash.hash` (the
     census's). A game the census marks nondeterministic is run twice and recorded `nondeterministic`, not failed;
   - **goldens**: `tools/harness/goldens/<id>.ids.json` written, counts = `manifest.census`;
   - **G1 load**: `page.mjs <id> --gate load` on the plain page — 0 non-localhost requests, 0 failed, 0 page errors,
     ≥ 1 `#app .treeNode`, 0 `au` nodes — except what the manifest's hand-kept `load.known` declares (docs/manifest.md).
     A new game that is red only because its index names a missing script, its own timers throw before `load()`, or it
     hotlinks images: re-run `check-manifest <id>` with `"known": {}` in `load`, copy the drift it reports into the block
     (plus an `errorsBeforeReady` reason if needed), and re-run the gates. `add-game.mjs` keeps an existing `known`.

5. **The generated currency data**: `node tools/currency-data.mjs --write --ids <the added ids>` — `games-data/<id>.json`
   for each added game that has buyables, and `games-data/index.json` (docs/automation.md, "The currency reader").
   `add-game.mjs` runs it at the end of phase 3, after the manifests exist (it boots each game from its manifest), and
   records a `C1 currency data written` row. It touches only the games it names. Before it did, every import
   reddened C1's freshness check on the first CI run (`STALE <id>: no file, and the game has buyables`).
   ⚠ **THIS STEP HAS NEVER RUN INSIDE `add-game.mjs`.** It was wired in on 2026-09-22 (tmt-forks-1) AFTER that
   slice's games were imported, and a re-add of a present game is skipped by design, so nothing could drive it.
   The four games' data was generated by running the same command by hand. `loader/addgame.test.mjs` holds the
   step's SHAPE (it exists, runs after the manifests are written, and passes `--write --ids` with the added ids);
   whether it WORKS is first known on the next import. If that import's C1 is red, suspect this step before the
   game — and delete this note once an import has run it green.

6. **The roster doc**: [games.md](games.md), regenerated from `manifests/` — `add-game.mjs` does this itself, at the
   end of phase 3, and records a G6 row for it. Doing it by hand is `node tools/games-table.mjs`. Gate G6 holds the
   doc to `manifests/index.json` (every game, once, in that order), so a game added without it is a red gate:
   `node tools/games-table.mjs --check`, or `gates.mjs --only G6`.

**When a game is not worth hosting**, record it in `manifests/declined.json` — `{repo, short, reason}`, where `short` is a label of 24 characters or less for the census table cell and `reason` is the full account — rather than only
in a commit message. The judgement belongs here, where the attempt was made and the evidence is, and the census
joins that file at the pinned commit to fill its `why not hosted` column (tmt-fork-census, stage 6). Gate **G7**
keeps it honest: every declined repo must carry a reason, appear once, and **not** be hosted — the thing that rots
is an entry left behind after someone fixes the game and adds it (one emitter fix unblocked five in an afternoon).

## Size: no limit, one advisory

⚖ **User ruling, 2026-09-22** — verbatim: *"now that we have the compression working, we don't need to impose a size
limit on the repositories. But let's still do a quick check to see if any of them are more than 10 MB after
compression."*

**There is no size limit.** A game is never declined for its size. What remains is an **advisory**, read AFTER the media
step: a game's tracked bytes under `games/<id>/` at HEAD, and a game over **10 MB** is named in the slice's report so
someone can look at why. It gates nothing. The measurement, one line:

```
git ls-tree -r -l HEAD games/ | awk '{split($5,p,"/"); s[p[2]]+=$4} END {for (g in s) printf "%d %s\n", s[g], g}' | sort -rn | head
```

Measured 2026-09-22 (tmt-forks-1), over all 175 games after compression: **none is over 10 MB**; the largest is
`the-classic-tree` at 9.67 MB, and it is large for its **code** (8.7 MB of JS across 293 files, which the media step
does not touch), not its media. `games/` totals 116.60 MB. The five games declined for size alone, before → after:

| repo | id | before | after | |
|---|---|---|---|---|
| `hanlaosan1/The-Wall-Tree` | `the-wall-tree` | 70.83 MB | 0.84 MB | hosted |
| `thecuttlefish123213/The-Cosmic-Tree` | `the-cosmic-tree` | 37.23 MB | 1.71 MB | hosted (declares one `missingAssets`, [manifest.md](manifest.md)) |
| `jakub791/The-Collab-Tree` | — | 23.7 MB | — | **declined again, for the real reason**: its own pristine page crashes in `load()` (`manifests/declined.json`) |
| `certainjellyfish9204/The-Modding-Tree` | `the-classic-tree` | 17.17 MB | 9.67 MB | hosted — the largest game on the roster |
| `Lun4-R/The-Collab-Tree` | `the-collab-tree-lun4-r` | 15.73 MB | 0.47 MB | hosted |

⚠ **The old rule was false when it was written — do not reinstate it from the old declined entries.** They said *"over
the 10 MB checkout limit this loader hosts to … largest hosted 5.8 MB"*, written 2026-09-17. `the-periodic-table-tree`
(50.13 MB) and `the-rainbow-void-tree` (27.67 MB) had been hosted since 2026-09-14, three days earlier; the "limit"
was never applied to the roster it claimed to describe. Both are now 1.78 MB and 0.83 MB. (Git HISTORY still carries
every original, since the squash is upstream's bytes; a clone is larger than a checkout, and the Pages deploy
excludes `.git`, [harness.md](harness.md).)

**When a gate is red**, `node tools/harness/triage.mjs <id>...` runs check-manifest and the load gate over a batch
and says what kind each red is, with the evidence beside it: which files reference an external host, which script
the index names that the repo does not ship, and — read out of `tmtLoader.pageErrors` — the FILENAME and count of
every before-ready error. It writes nothing, deliberately: `load.known` is hand-kept because a declaration is a
person saying "yes, this game really does that". A version that wrote them declared `missingScripts: ["js/null"]`
for `1-clicker`, a path that came from a bug in our own modFiles handling — which would have turned our defect into
an accepted quirk of that game. Triage now flags a "missing" script whose name appears in neither the index nor
`modFiles` as exactly that: a path we derived, to be fixed rather than declared.

Commit what the tool leaves uncommitted (`manifests/`, `tools/harness/goldens/`, `games-data/`, `docs/games.md`, `SUMMARY.md`) on top
of its subtree commits. For several games, pass them in one call:
all subtrees go in first, then the manifests and gates, so one commit covers the batch.

⚖ **G5 is no longer part of adding a game** (2026-09-18). `tools/check-pages.mjs` now runs on the DEPLOY
(`.github/workflows/pages.yml`, after the site is published), against the live URL, where it can check the one thing
a local clone cannot: that what is being served is this commit. Run it locally only when you are changing the loader's
own path handling — `node tools/check-pages.mjs` still does the bare-clone-at-a-sub-path form. ⚠ A new game reaches
the published site when someone publishes: `gh workflow run pages.yml --ref main`.

⚠ **A new game moves the roster figures**, and `node tools/census-figures.mjs` (CI's fast job, seconds) will refuse
the push until the counts in `docs/mobile.md` are re-measured against the new roster. That is deliberate: every "N of 171"
in that document is stale the moment the roster grows, and three of them shipped wrong before anything checked.

> **S1T (2026-09-29, ⚖ R12/R13) — the pristine RECORD.** `check-manifest` no longer finds the subtree squash in the
> history (the repository split imports a tree without history). Each game has `games-pristine/<id>.json`: the upstream
> commit, the upstream tree id, and every file's git blob id, generated from the squash commits for the 175 games
> hosted at the split. `add-game.mjs` now writes it in phase 2, right after the `diff -r` and BEFORE the media step —
> the one moment `games/<id>/` is upstream's bytes — and it lands uncommitted with the manifest. For a RE-PIN, record
> from a checkout of the new upstream commit, not from `games/<id>/` (whose untouched media is still processed):
> `node tools/pristine.mjs --write <id> --from <checkout>`, after updating `manifests/<id>.json`'s `upstream.commit`.
> The media rule below is unchanged; "the squash" in it now reads "the record". docs/harness.md, "No gate reads git
> history".

## Media: the one exception to pristine

⚖ **User ruling, 2026-09-22** — verbatim: *"All of the repos are MIT licensed. I'll want to set up a script to automate
the process of compressing the image files while importing the repos. And I'll want a way to run the tool on the repos
that have already been imported. I'll want to keep the filenames the same, so that we don't have to change code. Image
quality isn't important for these images, let's go with maximum compression. And for now, let's drop the audio
entirely. Either that or replacing the audio files with small silent stub files."*

⛔ **THE EXCEPTION IS NARROW.** The arc's oldest rule is that nothing under `games/<id>/` is ever edited. This ruling
lifts it for **media files only**: images (`.png .gif .jpg .jpeg`) and audio (`.mp3 .wav .ogg`). **Never code, never
markup, never a stylesheet, never a licence** — `LICENSE*` / `COPYING*` are out of scope whatever their extension (MIT
permits modification and requires the notice kept). `.svg` (vector), `.ico` and files that are already `.webp` are out
of scope too. It is not a licence to patch a game; a game that needs a code change still stops and records why
(below). `check-manifest.mjs` enforces the boundary: the tree may differ from the subtree squash only by
**modifications in place of in-scope media files that are processed** — one changed byte of anything else is
`games pristine`, RED, as before.

**What happens to a file** (`tools/media.mjs`, the encoder `tools/media-encode.py`):

- **Image → WebP bytes under the ORIGINAL filename, at the SAME pixel size.** Lossy quality 0 (alpha quality 0, method
  6); for a still, lossless is tried too and the smaller wins. Browsers decode an image by its content, not its
  declared type: WebP bytes under `Nitrogen.gif`, served as `image/gif` by `http.server` (as by GitHub Pages), render
  at 1280×602 in Chromium, Firefox and WebKit. ⛔ **Never downscaled** — an `<img>` with no width renders at its
  intrinsic size, so a smaller image is a LAYOUT change, which the ruling did not authorise. `--write` reads every
  written file back and REFUSES (restoring every original of that game) one whose header size moved; an animation must
  keep its total duration and loop count (the frame count may fall: identical consecutive frames are merged, their
  durations summed). A file WebP cannot make smaller, or a JPEG whose EXIF rotates it (orientation 2–8 — WebP would
  drop the tag), is SKIPPED and listed in `games-media/skipped.json` with the sha256 of the bytes left.
- **Audio → a silent stub under the ORIGINAL filename**: MPEG-1 Layer III frames under `.mp3`, an 8 kHz mono 8-bit
  WAV under `.wav` and `.ogg`, **1 s** long (`STUB_SECONDS`). Stubs, not deletion: a deleted file is a 404, which
  reds G1 on every affected game and throws in a game whose audio code does not handle a failed load; a stub keeps
  every request succeeding and every code path identical except that it is silent.

**Processed is decided by CONTENT, with no ledger**: an image whose bytes begin `RIFF….WEBP` is done, whatever its
extension; an audio file byte-identical to its extension's stub is done. So the tool is idempotent — a second run
changes nothing and never re-encodes lossy on lossy.

**At import**: `add-game.mjs` runs it right after the `diff -r` against the census clone (which compares the
originals), and commits it as its OWN commit, `media(<id>): …`, on top of the subtree squash — the squash stays
upstream's bytes, and the compression is a separate commit you can review or revert. The gates then include
`media processed`.

**Retroactively, or after an update**:

```
python3 -m venv .venv && .venv/bin/pip install -r tools/media-requirements.txt   # once: Pillow 12.3.0
node tools/media.mjs --write [<id>...]        # process (all games by default; --jobs N)
node tools/media.mjs [<id>...]                # the CHECK: node: builtins only, no Python — exit 1 names each raw file
```

⚠ **RE-RUN IT AFTER EVERY `git subtree pull`.** A pull restores the original of every media file upstream touched,
and the game still works, so nothing but the check notices. The check runs in CI's fast job (`node tools/media.mjs`,
beside `loader/media.test.mjs`), and `check-manifest` reds `games pristine (media)` on the same file — so an update
that skips the re-run is a red push, not a quietly larger download. Commit the re-run separately from the pull, for
the same reason as at import.

⚠ **Why Pillow and not `sharp`** (measured 2026-09-22): `sharp` 0.34.5's bundled libvips carries an advisory on the
GIF loader (GHSA-f88m-g3jw-g9cj) and the fixed 0.35.x needs Node ≥ 20, where this repo pins 18.20.6; every Pillow
before 12.3.0 carries the 2026-07-20 advisories. The encoder refuses an older Pillow and opens files with
`formats=['PNG','GIF','JPEG','WEBP']`, so no other decoder is reachable whatever a file's bytes claim. Both reach the
same size on the worst file (Nitrogen.gif: `sharp` `minSize` 0.32 MB, Pillow 0.26 MB at method 6).

**Measured on the retrofit** (2026-09-22, `node tools/media.mjs --write` over all 171 games; commit `media(retrofit)`):

| type | files | games | before | after |
|---|---|---|---|---|
| `.gif` | 9 | 1 | 47.71 MB | 0.72 MB |
| `.png` | 1,420 (+2 already WebP bytes) | 171 | 28.62 MB | 1.06 MB |
| `.jpg` / `.jpeg` | 27 | 6 | 1.59 MB | 0.12 MB |
| `.mp3` | 26 | 3 | 26.43 MB | 0.10 MB |
| `.ogg` | 15 | 4 | 1.63 MB | 0.12 MB |
| `.wav` | 2 | 2 | 2.52 MB | 0.02 MB |
| **tracked `games/`** | 1,499 modified | 171 | **210.27 MB** | **103.92 MB** |

Of the 76.02 MB saved on images, 46.99 MB (62 %) is `the-periodic-table-tree`'s nine GIFs and 27.56 MB (36 %) the
PNGs. 0 files skipped (so `games-media/skipped.json` does not exist); a second `--write` changes nothing.

The witnesses, all local and all for the record:
- `tools/harness/media-dims.mjs` — every one of the 1,458 in-scope images loaded by a real engine from `http.server`,
  before (the tree at `3d9c61e67`) and after: **naturalWidth × naturalHeight identical for 1,458 of 1,458 in
  Chromium, Firefox and WebKit**, 0 decode failures. It found the one thing the header check could not: a blank
  100×100 PNG encoded (lossless, default) to 28 bytes that WebKit REJECTS while the other two decode it; lossless now
  runs with `exact=True` and that file is 30 bytes that all three decode.
- `tools/harness/media-audio.mjs` — the stubs inside the six games that ship audio, through each game's own code
  (`the-rainbow-void-tree`'s music player over three songs plus three `playSound` effects; `the-jax-tree`'s layered
  music over all four tracks; `the-danus-tree`'s `.wav` and `.ogg`; sorbet's `playSound`; the two `.mp3` one-shots),
  6 s each, Chromium / Firefox / WebKit: **every element loads, 0 media errors, 0 page errors, each one-shot fires
  `ended` exactly once, and the two looping tracks restart silently about once a second** (1 s stubs, `loop = true`).
  No game in the roster listens for `ended` (measured: zero `onended` / `'ended'` under `games/`), so a stub cannot
  advance a playlist. The same probe on the ORIGINAL tree is the control: there, `the-danus-tree`'s `tp.wav` fails to
  decode in Playwright's Chromium — it is an MP4 under a `.wav` name, and that build has no proprietary codecs — so the
  stub fixed a load error rather than causing one. `the-jax-tree`'s one aborted request is its own track switch, in
  both trees.
- `tools/harness/mutants-assets1.sh` (a throwaway worktree; 7 of 7 killed): the encoder DOWNSCALING (the tool refuses
  with `DIMENSIONS CHANGED` and leaves every original in place); a `git subtree pull` restoring one image and one audio
  original, committed (`media.mjs` names both, `check-manifest` reds `games pristine (media)`); an audio file that is
  a 404 instead of a stub (G1 RED on `sorbet-s-convolution-mainframe`, which requests its sound at load); a CODE edit
  and a LICENCE edit (`check-manifest` reds `games pristine`, `notMedia` — the exception is media only); the CI step
  deleted (`loader/workflows.test.mjs` RED).

## By hand, when the tool cannot

- If the Node boot needs a stub the manifest lacks, `run.mjs` re-spawns with it (≤ 12) and reports
  `respawn_prestubs`; add those to `headless.prestubs`. If a field of `player` drifts between two identical runs, add it
  to `headless.stateMask` and say why in the commit.
- If the game cannot load without a patch: stop and record why before patching anything under `games/<id>/`. The
  media exception above does not cover it — media files only, never code or markup.
- Optional for a game with unusual markup: add it to `loader/interpret.test.mjs` (`node --test loader/`).
