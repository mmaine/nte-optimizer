# nte-optimizer

> [!CAUTION]
> **This repository is vibecoded.** Its implementation was written with substantial AI assistance and may contain plausible-looking mistakes, unsafe assumptions, or unreviewed edge cases. Treat it with care: inspect the code, verify outputs, and run the tests before relying on it.

Gear optimizer for *Neverness to Everness*. Static site, no server, no account, and no runtime connection to the game.

It imports a gear snapshot produced by `nte-exporter`, scores the available cartridges and modules, and draws recommended builds directly onto each character's console grid.

## Features

- Single-character optimization with Prydwen targets or custom targets and weights.
- Cartridge set and 2-piece/4-piece bonus selection.
- Arc stats, refinements, conditional-effect controls, and explicit notices for effects the model cannot score.
- Team optimization against one shared item pool without assigning an item twice.
- Console-grid layouts with module placement and enough item detail to find each piece in game.
- Local equipment tracking, Equip/Undo, and import refreshes from game truth.
- Predicted-versus-measured character sheet comparison.
- Hosted build plus a single-file offline build.

All account data stays in the browser. Nothing is uploaded by the app.

## Running locally

```sh
npm ci
npm run dev
```

Useful checks and builds:

```sh
npm test
npm run check:guides
npm run build          # hosted build in dist/
npm run build:single   # standalone dist/nte.html
```

The standalone build works over `file://`. Browser restrictions disable workers, IndexedDB, and bundled artwork there; the app falls back to inline solving and localStorage or memory.

## Model boundaries

This is a stat-target optimizer, not a damage simulator. It has no rotation or ability-multiplier model.

- Targets are floors. Published substat rankings determine their relative weights.
- Timed bonuses are reported but not scored without defensible uptime data.
- Shield strength, enemy resistance, ally-only buffs, and other unsupported quantities are marked unmodellable instead of mapped onto a different stat.
- Level-80 base-stat scaling remains unmeasured, so dependent sheet values are shown as unavailable.
- “Proven” means optimal for one packing and cartridge, not globally optimal across every internal beam-search choice.

## Project layout

| Path | Contents |
|---|---|
| `data-src/` | Source classifications, cartridge bonuses, and guide data. |
| `tools/` | Data validation, generation, benchmarking, and build scripts. |
| `src/domain/` | Pure stat, board, cartridge, Arc, and scoring logic. |
| `src/solver/` | Worker-safe single-character and team solvers. |
| `src/db/` | Import validation and local persistence. |
| `src/ui/` | React interface. |
| `tests/` | Domain, solver, persistence, and integration checks. |

`src/domain/` and `src/solver/` stay free of DOM, storage, and UI imports so the same logic runs in tests, inline, or in a Web Worker.
