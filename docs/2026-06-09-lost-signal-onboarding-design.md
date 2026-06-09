# Lost Signal — Onboarding & Clarity Spec

**Date:** 2026-06-09
**Status:** Draft for review
**Builds on:** `docs/2026-06-09-lost-signal-design.md` (v1). This is a v1.1
clarity pass — additive, no mechanics change.

## Context

Playtesting surfaced that a new player doesn't know **what to do**. Three
distinct stall points:

1. **First action** — you land on the Status screen ("RECEIVER IDLE") with no
   cue that the goal is to *decode a signal* or that step one is to start one.
2. **Controls** — that swipe cycles the five views, press opens a list, and
   double-press backs out is left to be inferred from a one-line footer hint.
3. **"What now?" mid-game** — signal piles up but it's unclear whether to build,
   research, or decode next. The objectives system that's meant to guide this is
   buried in a tab.

**Goal:** make the next action obvious at every stage, reusing systems already
built (the modal renderer, the objectives, the pure reducer/render split). No
new views, no mechanics changes.

## Design

Three additive pieces.

### 1. First-run intro card — fixes (1) + (2)

A one-time modal shown on first launch, dismissed with a press. Reuses the exact
story-beat modal path (full-screen capture container, `tap to continue`).

```
+--------------------------------------+
|              LOST SIGNAL             |
|                                      |
|  A dead receiver stirs. Something is |
|  transmitting in the static.         |
|  Build signal. Decode the message.   |
|                                      |
|  ↑↓ move   ● open/confirm   ●● back  |
|           ● press to begin           |
+--------------------------------------+
```

Gated by a persisted `seenIntro` flag so it shows exactly once (including once
for existing saves, via a migration). ASCII-only, glyph-safe.

### 2. Persistent "Next:" line on the Status screen — fixes (3) (and reinforces 1)

The Status body surfaces the first uncompleted **objective** as a standing
instruction. It walks the opening on its own and updates as the player
progresses — no new content, it's the objectives we already shipped:

```
SIG 6  +1/s                       PWR █▒▒▒ 1/5
              RECEIVER IDLE
   Next: start your first decode          <- nextObjective().goal
   Swipe to Decode, press to listen       <- idle hint (#3)
   Fragments 0    Antennas 1
Status ●○○○○               ↑↓ views  ● open
```

Progression: "start your first decode" → "build 10 antennas" → "reach 100
signal/s" → … When every objective is done, the line is hidden.

### 3. Clearer idle copy — fixes (1)

When no decode is running, the Status body explicitly states how to start
("Swipe to Decode, press to listen") instead of the dead-end "no decode
running."

## Changes (all additive, reusing existing patterns)

| Area | Change |
|------|--------|
| `types.ts` | `GameState` gains `seenIntro: boolean` |
| `engine.ts` | `newGame()` sets `seenIntro: false` |
| `save.ts` | `CURRENT_SCHEMA` 2 → 3; `migrations[1]` defaults `seenIntro: false` so existing saves show the intro once |
| `objectives.ts` | each `Objective` gains a short imperative `goal` string ("Start your first decode", "Build 10 antennas", …); `Objective` type adds `goal: string` |
| `selectors.ts` | `nextObjective(s): Objective \| null` — first objective not in `completedObjectives` |
| `render.ts` | new `renderIntro(): string` (full-screen card); `renderStatus(s, d, nextGoal)` adds the "Next:" line + the clearer idle hint |
| `reducer.ts` | intro modal: while `!game.seenIntro` (and no beat queued), input is captured; `select`/`back` set `seenIntro = true` + persist. Mirrors the beat-modal branch |
| `main.ts` | `zonesFor`: render the intro when `!game.seenIntro`; pass `nextObjective(game)?.goal ?? null` to `renderStatus` |

**Modal ordering:** intro (first run only) → story beats → normal views. On a
fresh game the intro shows first; dismissing it lands on Status with the "Next:"
line already pointing at the first decode.

## Testing

- `selectors.nextObjective` — returns the first incomplete objective; `null`
  when all complete; skips completed ones in order. (pure unit)
- `objectives` — every objective has a non-empty `goal`. (pure unit)
- `reducer` — when `!seenIntro`, a `select` sets `seenIntro` + emits persist and
  swipes are swallowed; once seen, normal nav resumes. (pure unit)
- `render` — `renderIntro` and the new `renderStatus` output are glyph-safe
  (`findUnsupported` === []); Status shows "Next: …" when a goal is passed and
  omits it when `null`. (pure unit)
- `save` — a v2 blob migrates to v3 with `seenIntro: false`. (mock-bridge unit)
- **Simulator** — first launch shows the intro; press → Status with the "Next:"
  line; the line updates after completing an objective. (automation E2E)

## Scope

In: the three pieces above. Out (unchanged from v1): mechanics, economy, tech,
beats content, the other views. No new permission, no network. This is a v1.1
that can ship in the same `.ehpk` (bump `game.app.json` to 0.1.1 when packaging).

## Build order

`types` + `objectives.goal` + `selectors.nextObjective` (pure, test-first) →
`save` migration → `render` (intro + status) → `reducer` intro modal → `main`
wiring → simulator verify → repack.
