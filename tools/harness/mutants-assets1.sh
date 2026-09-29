#!/usr/bin/env bash
# assets-1 mutants — each must turn its gate RED. Runs in a THROWAWAY worktree at HEAD (mutants there may commit),
# so the tree you run it from is never touched; the worktree is removed at the end.
#   tools/harness/mutants-assets1.sh            (needs the repo's .venv with Pillow for M1, Playwright for M3)
# M1 the encoder DOWNSCALES              → media.mjs --write refuses (DIMENSIONS CHANGED), originals restored
# M2 a `git subtree pull` restores an image and an audio original (committed) → media.mjs RED, check-manifest RED
# M6 the pristine RECORD is edited (one blob id)  → check-manifest `games pristine (record)` RED (its tree id moves)
# M3 an audio stub is a 404 instead      → G1 (page.mjs --gate load) RED
# M4 a CODE file / a LICENCE is edited   → check-manifest `games pristine` RED (the exception is media only)
# M5 the CI media step is deleted        → loader/workflows.test.mjs RED
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd)
WT=$(mktemp -d "${TMPDIR:-/tmp}/assets1-mutants-XXXXXX")
git -C "$REPO" worktree add --detach -q "$WT" HEAD
ln -s "$REPO/node_modules" "$WT/node_modules"
export TMT_PYTHON="${TMT_PYTHON:-$REPO/.venv/bin/python3}"
cd "$WT"
git config user.name "assets1 mutants"; git config user.email "mutants@localhost"
pass=0; fail=0
verdict() { if [ "$2" = red ]; then echo "KILLED  $1"; pass=$((pass+1)); else echo "SURVIVED $1 — $3"; fail=$((fail+1)); fi; }
original() { # <id> <rel> → an UNPROCESSED stand-in for upstream's original: an image re-saved in its own extension's
  # format at its own pixel size (Pillow), an audio file that is not the stub. ⚖ R12/R13 (2026-09-29): this read the
  # original bytes out of the git-subtree squash commit, which a history-free import does not have. What M1 and M2 need
  # is a RAW file where a processed one was — not upstream's exact bytes — so the stand-in tests the same thing.
  "$TMT_PYTHON" - "games/$1/$2" <<'PY'
import sys
from PIL import Image
p = sys.argv[1]
ext = p.rsplit('.', 1)[-1].lower()
if ext in ('png', 'gif', 'jpg', 'jpeg'):
    im = Image.open(p); im.load()
    fmt = {'png': 'PNG', 'gif': 'GIF', 'jpg': 'JPEG', 'jpeg': 'JPEG'}[ext]
    (im.convert('RGB') if fmt == 'JPEG' else im).save(p, format=fmt)
else:
    open(p, 'wb').write(b'RIFF' + bytes(60))  # an audio file that is not the silent stub
PY
}

# M1 — downscale
for f in discord.png options_wheel.png remove.png resources/genericParticle.png; do original the-danus-tree "$f"; done
out=$(TMT_MEDIA_MUTANT=downscale node tools/media.mjs --write --jobs 1 the-danus-tree 2>&1); st=$?
restored=$(git status --porcelain games/the-danus-tree | wc -l)
if [ $st -ne 0 ] && grep -q "DIMENSIONS CHANGED" <<<"$out" && [ "$restored" = 4 ]; then verdict "M1 downscale (exit $st, 4 originals left in place, not a halved WebP)" red; else verdict M1 green "exit $st, $restored files differ: $out"; fi
git checkout -q HEAD -- games/the-danus-tree

# M2 — a subtree pull restores originals (COMMITTED, as a pull would)
original ptr images/achs/11.png; original the-jax-tree resources/song/layer1.ogg
git commit -qam "mutant: a pull restored two originals"
node tools/media.mjs ptr the-jax-tree > m2.txt 2>&1; st=$?
cm=$(node tools/harness/check-manifest.mjs ptr 2>&1 | tail -1)
if [ $st -ne 0 ] && grep -q "ptr/images/achs/11.png" m2.txt && grep -q "the-jax-tree/resources/song/layer1.ogg" m2.txt; then verdict "M2a media check names both restored originals (exit $st)" red; else verdict M2a green "$(tail -3 m2.txt)"; fi
if grep -q "ptr=RED" <<<"$cm" && node tools/harness/check-manifest.mjs ptr 2>/dev/null | grep -q '"games pristine (media)"'; then verdict "M2b check-manifest ptr RED on games pristine (media)" red; else verdict M2b green "$cm"; fi
git reset -q --hard HEAD~1

# M3 — a stub that is a 404 (sorbet requests its only sound at load: `let sounds = [new Audio("Sounds/TouchGoop.ogg")]`)
git rm -q games/sorbet-s-convolution-mainframe/Sounds/TouchGoop.ogg
node tools/harness/page.mjs sorbet-s-convolution-mainframe --gate load > m3.txt 2>&1; st=$?
if [ $st -ne 0 ] && grep -qi "TouchGoop" m3.txt; then verdict "M3 G1 RED on the 404 (exit $st)" red; else verdict M3 green "exit $st: $(tail -3 m3.txt)"; fi
git reset -q --hard HEAD

# M4 — the exception is MEDIA ONLY: a code edit and a licence edit are each `games pristine`
echo "// mutant" >> games/ptr/js/mod.js; git commit -qam "mutant: a code edit"
if node tools/harness/check-manifest.mjs ptr 2>/dev/null | grep -q '"notMedia":\[{"status":"M","rel":"js/mod.js"}'; then verdict "M4a code edit → games pristine (notMedia js/mod.js)" red; else verdict M4a green "$(node tools/harness/check-manifest.mjs ptr 2>&1 | tail -2)"; fi
git reset -q --hard HEAD~1
echo "mutant" >> games/ptr/LICENSE; git commit -qam "mutant: a licence edit"
if node tools/harness/check-manifest.mjs ptr 2>/dev/null | grep -q '"rel":"LICENSE"'; then verdict "M4b licence edit → games pristine (notMedia LICENSE)" red; else verdict M4b green "$(node tools/harness/check-manifest.mjs ptr 2>&1 | tail -2)"; fi
git reset -q --hard HEAD~1

# M6 — the record is edited: one file's blob id changed (to the id of the processed bytes, the likeliest "fix")
python3 - <<'PY'
import json, re
p = 'games-pristine/ptr.json'; s = open(p).read()
m = re.search(r'"js/mod.js": "([0-9a-f]{40})"', s); assert m
open(p, 'w').write(s.replace(m.group(1), '0' * 40))
PY
if node tools/harness/check-manifest.mjs ptr 2>/dev/null | grep -q '"games pristine (record)"'; then verdict "M6 record edited → games pristine (record)" red; else verdict M6 green "$(node tools/harness/check-manifest.mjs ptr 2>&1 | tail -2)"; fi
git checkout -q HEAD -- games-pristine

# M5 — the CI step deleted
python3 - <<'EOF'
p='.github/workflows/sweep.yml'; s=open(p).read()
i=s.index('      - name: Media — every image WebP'); j=s.index('\n\n', i)
open(p,'w').write(s[:i]+s[j+2:])
EOF
if ! node --test loader/workflows.test.mjs > m5.txt 2>&1 && grep -q "node tools/media.mjs" m5.txt; then verdict "M5 CI media step deleted → workflows.test RED" red; else verdict M5 green "$(grep -E '^# (pass|fail)' m5.txt)"; fi
git checkout -q HEAD -- .github

cd "$REPO"
git worktree remove --force "$WT"
echo "mutants-assets1: $pass killed, $fail survived"
[ $fail -eq 0 ]
