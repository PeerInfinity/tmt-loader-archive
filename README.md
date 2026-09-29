# tmt-loader

**▶ Choose a game to play: <https://peerinfinity.github.io/tmt-fork-census/>** — the TMT fork census lists, ranks and
describes the games, and its **▶ loader** and **▶ mobile** links open each one here.

A collection of incremental games built on [The Modding Tree](https://github.com/Acamaeda/The-Modding-Tree) (TMT),
playable in the browser with nothing to install — including many whose own page no longer works. Each one runs
**on the engine version it was written for**, from a copy of its author's repository.

**AI disclosure.** The code, the documentation and the harness in this repository were AI-generated (Claude Code sessions directed by PeerInfinity, who set the questions and reviewed the output). Every gate number is produced by the harness in `tools/` and can be regenerated.

## Playing

Pick a game on the [census](https://peerinfinity.github.io/tmt-fork-census/) and follow its **▶ loader** link (or
**▶ mobile** on a phone). Not sure where to start? [Prestige Tree Rewritten](https://peerinfinity.github.io/tmt-loader/?mod=ptr)
is the classic. Every hosted game, with a direct link, is also listed in [docs/games.md](docs/games.md).

**Your progress** is saved automatically, in your browser only and separately for each game — two games never share
a save. To back a save up or move it to another device, use the game's own *Export* and *Import* buttons in its
options; to start over, use its *HARD RESET*.

To get back to the list of games from inside a game, use **← All games** at the bottom of the game's options (the
**tmt-loader** section); it opens the census. It saves the game first if the game's autosave is on.

## What you can turn on

The loader can add three things to any game. All of them are **off** until you turn them on, and none of them
changes the game itself:

| option | what it gives you |
|---|---|
| **Mobile layout** | one column with large buttons, for a phone: the tree first, then the layer you open at full width. The games themselves have no phone layout at all. Includes the nav bar. |
| **Nav bar** | a bar along the bottom of the screen. Its *Layers* button lists every layer as a card, grouped by tree row, with its reset button, its counters and a button for everything you can buy there. Useful on a desktop too. |
| **Automation tools** | an extra *AU* tab that can reset layers and buy upgrades and buyables for you. Every feature starts off and you choose which to turn on; it only presses the game's own buttons. |

**To turn one on:** open any game, open its options (the game's settings button) and use the **tmt-loader** buttons
at the bottom. The page reloads, and the choice is remembered in this browser for every game.

**Or by link:** add `&mobile=1`, `&navbar=1` or `&automation=1` to a game's address — for example
<https://peerinfinity.github.io/tmt-loader/?mod=ptr&mobile=1>. A link always wins over the remembered choice, so it is
the way to share a game with an option on (or, with `=0`, off).

## Where the games come from

The games were chosen with the **[TMT fork census](https://peerinfinity.github.io/tmt-fork-census/)** — see it for
how, and for the games that are not hosted here. Each game belongs to its author and keeps its own licence and
credits.

## For the authors of these games

This is an early, low-priority side project, and it may change a lot or be taken down.

Right now the loader keeps a copy of each game it hosts in this repository, pinned at the commit it was copied from.
Each copy keeps the game's own license files and credits, and the game list links back to the author's repository.

**If one of these is your game and you'd like it removed, [open an issue](https://github.com/PeerInfinity/tmt-loader/issues)
and I'll take it down.** No explanation needed.

I plan to rework this so it stores no copies at all. The loader would load each game straight from its author's own
repository, and authors could add the optional extras (mobile layout, automation tools) to their own game's page with a
script tag. Feedback on that plan is welcome in the issues, including "please don't".

## For developers

How the loader works, how to run it locally, the test harness and how to add a game are in
**[docs/developers.md](docs/developers.md)**. The detailed records:

| document | what is in it |
|---|---|
| [docs/games.md](docs/games.md) | the roster — every game, with play and mobile links |
| [docs/contract.md](docs/contract.md) | `window.tmtLoader`, the one interface a runner talks to, and the per-engine differences behind it |
| [docs/manifest.md](docs/manifest.md) | what a `manifests/<id>.json` declares, and which parts are pins the gates check |
| [docs/add-a-game.md](docs/add-a-game.md) | adding a game: subtree, manifest, vendoring, gates |
| [docs/harness.md](docs/harness.md) | the Node harness and the page runner, ladders and snapshots |
| [docs/automation.md](docs/automation.md) | `?automation=1` — the feature registry, policies and the per-game tables |
| [docs/planner.md](docs/planner.md) | the planner built on top of the automation registry |
| [docs/mobile.md](docs/mobile.md) | `?mobile=1` and `?navbar=1` — the mobile layout, the nav bar, the layer list, and their gate |
| [docs/options.md](docs/options.md) | the Options section — the three opt-ins as buttons, the remembered preference, and gate O1 |
| [`tools/harness/results/SUMMARY.md`](tools/harness/results/SUMMARY.md) | every gate run, with the state hashes it measured |

## License

MIT (`LICENSE`) for the loader and harness. The games under `games/` carry their own licenses.
