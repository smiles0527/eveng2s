# Lost Signal — Design Spec

**Date:** 2026-06-09
**Status:** Draft for review

## Context

The `eveng2s` repo already ships a flashcards plugin (a shipped Even Hub G2 app
plus a hosted web deck-builder). This spec defines a **second, independent
plugin**: *Lost Signal*, a real-time-gated narrative idle/strategy game for the
Even Realities G2 glasses.

The design goal, in the user's words: a game that **can't be speedrun**, that
you **play passively throughout the day** rather than sitting down with, and
that is **an actual game** — a real economy, tradeoffs, a tech tree, objectives
and challenges — not just "watch a clock and read text." The glasses are always
on you, so it leans into ambient, glanceable, check-in-when-bored play.

## Concept & design pillars

You wake a long-dormant receiver. Buried in the static is a faint, looping
transmission. Over real days you build **signal**, manage **power**, and
**decode** the message — each decode revealing the next beat of a story. The
monochrome-green G2 display *is* the theme: it literally looks like a signal
terminal.

Four pillars, each tied to a concrete mechanic:

1. **Paced by the wall clock, not by input.** Decodes take real hours; progress
   is computed from elapsed real time on open. You physically cannot rush a
   3-hour decode — so it's un-speedrunnable and spans days/weeks.
2. **Strategy under a hard constraint.** **Power is a capacity budget** — you
   can't run every antenna *and* parallelize decodes *and* keep amplifiers hot.
   Every build is a tradeoff. A branching tech tree you can't fully buy, plus
   objectives and challenges, give direction.
3. **Passive, zero-pressure.** Finished work **banks** — it waits for you, never
   wasted — so there's no "optimal moment" to catch. Open it when bored, collect,
   re-allocate, leave. ~30 seconds, several times a day.
4. **Self-contained.** No network, no accounts, no sound (G2 has no speaker),
   touch-only (no IMU — reliability over cleverness). All state in bridge
   storage; all logic pure and testable.

## Platform constraints (the ones that shape the design)

- **No background execution, no push notifications.** The plugin runs only when
  opened. ⇒ progression is derived from wall-clock timestamps on open (`advance`
  below); while open it ticks live. `Date.now()` is available in app code (it is
  only forbidden inside Workflow scripts).
- **Display 576×288, mono green.** `textContainerUpgrade` is fast & flicker-free;
  `rebuildPageContainer` flickers; images are slow (~0.5–2 s/frame) ⇒ **text-only
  game**. ~400 chars fill a screen. One container has `isEventCapture: 1`.
- **Limited firmware font.** All on-screen text must pass the allow-list in
  `src/core/glyphs.ts` (no em-dashes, smart quotes, `…`, emoji — they silently
  vanish). Bars/pips use supported glyphs (`█ ▒ ● ○`).
- **Input:** single press, double press, swipe up, swipe down (touch only).
- **Persistence:** `bridge.setLocalStorage`/`getLocalStorage` only (chunk large
  values; browser storage is unreliable in the WebView).

## Unified game state & key reconciliations

One `GameState` (in `src/game/types.ts`); each module below operates on its
slice. Per-section TS sketches show only the relevant fields.

```ts
type Building = 'antenna' | 'amplifier' | 'decoder' | 'reactor'
type TechId = string
type DecodeId = string

type Slot =
  | { status: 'idle' }
  | { status: 'running'; def: DecodeId; startMs: number; endMs: number }
  | { status: 'banked'; def: DecodeId; finishedMs: number }

interface GameState {
  // resources
  signal: number                         // flow currency
  fragments: number                      // discrete decoded units
  // buildings (online == owned in v1 — buy refuses anything without power headroom)
  owned: Record<Building, number>
  // decodes — one slot per owned decoder
  slots: Slot[]
  queue: DecodeId[]
  decodesCompleted: number
  // progression
  ownedTech: Set<TechId>
  completedObjectives: Set<string>
  completedChallenges: Set<string>
  seenBeats: Set<string>
  // session tallies (for challenges; not load-bearing)
  session: { decodesThisHour: number; lastDecodeType?: string }
  // time
  lastSeenMs: number                     // epoch ms; offline accrual anchor
}
```

**Three reconciliation decisions** (resolving where the subsystem drafts
overlapped):

1. **Power is derived, not stored.** `powerCap` and `powerUsed` are computed
   from `owned` counts + running decodes + tech, never persisted. Starting a
   decode is gated on *headroom*, not on decrementing a stored power number.
   (This replaces the "free-power counter" framing; same behavior, one source of
   truth.)
2. **Signal rate is derived.** `signalPerSec(state, mods)` is recomputed from
   buildings + modifiers. Offline accrual uses the rate as of the saved state
   (buildings can't change while away), so `rate × elapsed` is exact.
3. **Tech/objective effects flow through one fold.** A pure `applyEffects` over
   `ownedTech` + claimed objective rewards yields a `Modifiers` object
   (`signalMult`, `decodeTimeMult`, `powerCapAdd`, `buildCostMult`, unlocks,
   `parallelDecodes`). Every economy/decode function takes `mods` as a
   parameter. Order-independent (product of mults, sum of adds, union of
   unlocks), so acquisition order never matters.

---

## Economy & resources

The numeric spine. All pure, time-free logic in `src/game/economy.ts`; functions
take state (+ `mods`) and return numbers or a new state — no clock, no I/O.

| Resource | Kind | Produced by | Spent on |
|----------|------|-------------|----------|
| **signal** | flow currency (accrues/sec) | antennas × amplifier mult | buildings (main sink), some tech |
| **power** | **capacity budget** (derived) | reactors + tech raise the *cap* | occupied by every online building + running decode |
| **fragments** | discrete count | decodes | tech tree + story |

**Why power-as-capacity is the game.** Signal alone is "wait longer." Power is a
*simultaneity budget* you never burn down — each building/decode occupies it
while running, and the sum must stay ≤ cap. Since cap is small early and only
grows via the steep reactor curve, you're always over-subscribed: more raw signal
(antennas) vs. more multiplier (amplifiers) vs. more decode throughput (decoders)
vs. relaxing the ceiling itself (reactors). That tension is the strategy. Power
is **occupancy, not drain** — turning something off frees it instantly; the only
failure mode is "no headroom to start another," never a brownout.

### Production & power

```
signalPerSec = onlineAntennas * ANTENNA_BASE_RATE * (1 + AMP_BONUS)^amplifiers * mods.signalMult
powerCap     = REACTOR_BASE_CAP + reactors * REACTOR_CAP_PER + mods.powerCapAdd
powerUsed    = antennas*POWER.antenna + amplifiers*POWER.amplifier + runningDecodes*POWER.decoder
headroom     = powerCap - powerUsed                 // a buy/decode-start must keep this >= 0
```

Amplifiers compound multiplicatively, so a *balanced* build beats spamming one
type — but only if you have headroom to keep both classes online, tying
production straight back to the constraint.

### Cost curves

```
costOf(building, owned, mods) = round(BASE[building] * RATE[building]^owned * mods.buildCostMult)
```

The *n*-th unit (0-indexed) costs `BASE · RATE^n`; the first costs exactly `BASE`.
Geometric growth self-throttles each class.

### Balancing table (starting values — placeholders, tune in playtest)

| Building | Base cost | Rate | Power draw | Effect |
|----------|----------:|-----:|-----------:|--------|
| **antenna** | 15 | 1.15 | 1 (online) | +`ANTENNA_BASE_RATE` (1.0) signal/s |
| **amplifier** | 100 | 1.30 | 2 (online) | ×1.25 total signal (compounding) |
| **decoder** | 200 | 1.25 | 3 (only while a decode runs) | +1 decode slot |
| **reactor** | 500 | 1.50 | 0 | +5 power cap |

Other constants: `ANTENNA_BASE_RATE=1.0`, `AMP_BONUS=0.25`, `REACTOR_BASE_CAP=5`,
`REACTOR_CAP_PER=5`. Opening cap of 5 forces the first reactor decision within the
first session; the steep reactor curve (500, 750, 1125, …) + geometric building
costs + real-time decode gates stretch the arc to days. All tunables live as
exported `const` lookup tables so retuning is a one-file edit; tests assert
*behavior* (first unit = BASE, `buy` deducts exactly `costOf`, `used ≤ cap`), not
magic numbers.

### Pure API (`src/game/economy.ts`)

```ts
export function signalPerSec(s: GameState, mods: Modifiers): number
export function powerCap(s: GameState, mods: Modifiers): number
export function powerUsed(s: GameState): number          // counts running decodes
export function powerHeadroom(s: GameState, mods: Modifiers): number
export function costOf(b: Building, owned: number, mods: Modifiers): number
export function canAfford(s: GameState, b: Building, mods: Modifiers): boolean   // signal AND headroom
export function buy(s: GameState, b: Building, mods: Modifiers): GameState        // pure; same ref if unaffordable
```

`buy` returns a **new** state (or the same reference if unaffordable — a cheap
`===` test), deducting exactly `costOf` and incrementing `owned`. Reactor (power
draw 0) is never power-blocked.

---

## Time-gated decodes & real-clock progression

The mechanic that paces by wall clock. The whole model is one pure reducer,
`advance(state, now)`, in `src/game/progression.ts` (composed by `engine.ts`).

### The decode

A **decode** is the core time-gated action. Starting one requires a free decoder
slot, power headroom for `POWER.decoder`, and `signalCost` (spent at start). It
runs for a real `durationMs` (scaled by `mods.decodeTimeMult`), then yields
`fragmentYield` and may carry a `beatId`.

```ts
interface DecodeDef {
  id: DecodeId
  durationMs: number          // wall-clock; scaled by mods.decodeTimeMult at start
  signalCost: number
  fragmentYield: number
  beatId?: string             // opaque here; narrative module interprets
  autoRestart?: boolean       // re-queue self on completion if affordable (unlocked via tech)
}
```

**Banking rule (the reason no-notifications is painless):** a finished decode
transitions `running → banked` and waits *indefinitely*. Its fragments credit
when collected (or, under `autoRestart`, when `advance` processes it). Whether you
open the app 2 minutes or 2 weeks late, the result is identical — **no
missed-moment penalty, no wasted time.** Auto-restart is a convenience layer, not
a requirement.

### `advance(state, now)` — offline & live, one function

```ts
interface AdvanceEvent { kind: 'decodeCompleted'; def: DecodeId; atMs: number; beatId?: string }
interface AdvanceResult { state: GameState; events: AdvanceEvent[] }

export function advance(state: GameState, now: number, mods: Modifiers): AdvanceResult
```

It (1) credits signal for `elapsed = max(0, now − lastSeenMs)` at the current
derived rate; (2) completes every slot whose `endMs ≤ now`, looping so a short
decode that would finish many times across a long gap completes many times — each
restart re-based at the previous `endMs` so completion timestamps and the event
list stay chronological; (3) sets `lastSeenMs = now` once at the end (idempotent:
a second call with the same `now` is a no-op). Returns the new state + an ordered
event list the caller replays (toasts; beat ids handed to the narrative module).

Termination is guaranteed because each (auto-)restart spends `signalCost > 0` or
finds none affordable; a `MAX_STEPS` guard backstops a hypothetical 0-cost def.

### Live ticking & persistence

`lastSeenMs` is the only persisted time field. On open/`FOREGROUND_ENTER`, run one
catch-up `advance(state, Date.now())`. While open, a ~1 s interval calls the
*same* `advance` for live countdowns — the interval is only a refresh cadence,
never the accrual mechanism (a throttled tick self-heals: the next `advance` sees
a larger elapsed). On `FOREGROUND_EXIT`/`beforeunload`, a final `advance` + flush.

### Edge cases

| Case | Handling |
|------|----------|
| Clock moved backwards | `elapsed = max(0, …)` ⇒ 0 accrual, no completions; `lastSeenMs` still updates. Absolute `endMs` means a decode never un-completes. |
| Enormous gap (weeks) | Just compute it — accrual is one multiply (optionally clamped to a soft `signalCap`), completions bounded by resources + `MAX_STEPS`. Long absence is rewarded, not punished (banking). |
| Many completions in one gap | The loop drains them, re-basing each restart at its `endMs`. |
| First-ever open / missing `lastSeenMs` | New game seeds `lastSeenMs = Date.now()` before first `advance` (first elapsed = 0). A missing field on a loaded blob ⇒ seed to `now`, **never** epoch 0 (which would credit ~56 years). |

### Duration tuning (escalating gates = the arc)

| Act | Example decode | Duration | Role |
|-----|----------------|---------:|------|
| Prologue | First contact | 1 min | teach the loop, instant payoff |
| Act I | Triangulate source | 15 min | session-length |
| Act I→II | Decrypt header | 1 hr | first "set it and leave" |
| Act II | Reassemble log | 6 hr | a workday away → banked on return |
| Act II→III | Decode broadcast | 12 hr | overnight; "wake up to progress" |
| Act III | Full signal lock | 24 hr | daily ritual; finale over a week+ |

The only lever to go faster is owning more **decoders** (parallel) or buying
decode-speed tech — both gated by fragments from prior (also-gated) decodes. There
is nothing to grind; the timers are wall-clock.

---

## Progression: tech tree, objectives & challenges

What turns the loop into a *strategy game*. Pure, data-driven; the shared effect
model lets economy, objectives, and (v2) events/prestige all speak one language.

### Shared effects

```ts
type Effect =
  | { kind: 'signalMult'; value: number }
  | { kind: 'decodeTimeMult'; value: number }   // <1 = faster
  | { kind: 'powerCapAdd'; value: number }
  | { kind: 'buildCostMult'; value: number }    // <1 = cheaper
  | { kind: 'unlockBuilding'; id: Building }
  | { kind: 'unlockDecode'; id: DecodeId }
  | { kind: 'unlockFeature'; id: string }       // 'autoRestart' | 'techTree' | …
  | { kind: 'parallelDecodeAdd'; value: number }
  | { kind: 'unlockTech'; id: TechId }          // adds an otherwise-unreachable node

interface Modifiers {
  signalMult: number; decodeTimeMult: number; powerCapAdd: number
  buildCostMult: number; unlocked: Set<string>; parallelDecodes: number
}
export function applyEffects(effects: Effect[]): Modifiers   // order-independent fold
```

The engine builds `mods = applyEffects(effectsOf(ownedTech) + rewardsOf(completedObjectives))`
each tick and threads it into every economy/decode function.

### Tech tree (`src/game/tech.ts`)

Data-driven DAG; cost in fragments (primary) + optional signal; effects from the
union above. **Three branches with distinct identities**, roots cheap and depth
super-linear so by mid-game you've committed to one path:

- **Throughput** — raw signal (multipliers, the Dish building).
- **Efficiency** — power & cost reduction, auto-restart (force-multiplier).
- **Decryption** — decode speed, parallelism, corrupted-fragment decoding.

```ts
interface TechNode { id: TechId; name: string; branch: 'throughput'|'efficiency'|'decryption'
  cost: { fragments: number; signal?: number }; prereqs: TechId[]; effects: Effect[]; desc: string }
```

Sample nodes (≈10 across branches): `t.gain1` (+25% signal), `t.gain2`
(+40%, needs t.gain1), `t.array` (unlock Dish); `e.reactor1` (+2 cap),
`e.frugal` (−15% build cost), `e.auto` (unlock autoRestart); `d.fast1` (−20%
decode time), `d.phaselock` (decryption timing node — **referenced by story beat
"how-far"**), `d.parallel` (+1 slot), `d.corrupt` (unlock corrupted decode),
`d.fast2` (−40% + 1 slot, needs d.parallel + d.corrupt — a convergence node).
Load-time dev assert: prereq ids resolve, graph acyclic, ids unique (fail loud in
dev, as flashcards fails loud on bad container config).

### Objectives & challenges

Same evaluator shape; pure predicate over `GameState`, fire-once, latching
(monotone — once earned, never un-earned), persisted as completed sets.

```ts
interface Objective { id: string; name: string
  condition: (s: GameState, derived: { signalPerSec: number }) => boolean
  reward: { effects?: Effect[]; fragments?: number }; desc: string }

export function newlyCompleted(defs: Objective[], s, completed: ReadonlySet<string>): Objective[]
```

- **Objectives** (milestones) pace the opening & teach mechanics: "reach 100
  signal/s → +1 cap", "own 10 antennas → unlock amplifier", "build a reactor →
  reveal the tech tree" (the soft tutorial — you meet the power constraint before
  the branching decision).
- **Challenges** (optional, harder, unique rewards): "decode a corrupted fragment
  while ≥500 signal/s → unlock Overdrive (`unlockTech`)", "bank 100 fragments
  while using ≤4 power → Minimalist", "10 decodes in one real hour → Burst".
  `unlockTech` *widens the tree* rather than handing a flat bonus, preserving the
  "you still choose to buy it" agency.

Evaluated every advance/action (cheap booleans); idempotent via the set check, so
a double tick or reload-then-tick can't double-grant.

### v2 roadmap (designed-for, not built)

- **Events:** periodic interference (solar flare → signal ×0.5 1 h; brownout →
  cap −2 30 m) with a reactive choice — *shield* (spend signal to negate) vs
  *ride it out*. A live event is just a timed bucket of `Effect`s folded into
  `Modifiers` — zero new economy math.
- **Prestige ("Realign the array"):** voluntary reset trading progress for
  permanent **realign points** → a global `signalMult` (one more effect in the
  fold). `rpGain = floor(k·sqrt(lifetimeFragments/F0))` (diminishing); resets
  buildings/signal/fragments/tech/objectives, keeps RP + completed challenges.
  Lets a second run blow through the early tree and try a different branch
  identity. Gated behind a progress threshold, confirmable, never accidental.

The v1 systems leave the seams pre-cut (the effect fold, the predicate evaluator,
the versioned envelope), so v2 is additive, not a rewrite.

---

## Narrative system & story beats

The story makes idle progress *mean* something. Beats are short, glyph-safe text
cards that interrupt at fixed progress thresholds, shown once, never repeated. v1
is strictly **linear** — you advance the story by playing, not by choosing.

```ts
type BeatTrigger =
  | { kind: 'decodesCompleted'; n: number }
  | { kind: 'signalRate'; value: number }
  | { kind: 'tech'; nodeId: TechId }          // must reference a real tech node

interface StoryBeat { id: string; index: number; trigger: BeatTrigger; title?: string; body: string }
```

**Firing:** `pendingBeats(state, snap)` walks beats in `index` order; a beat is
pending iff unseen and its trigger is met, and the scan **breaks** at the first
unseen beat whose trigger is *not* met (linear gate). Crossing several thresholds
during one offline gap queues every now-eligible beat in order. Display as a modal
full-screen card; **tap to continue** marks `id` seen (keyed on id, not index, so
later content edits can't un-see a beat) and persists per-dismissal. State = one
`seenBeats` set in the save blob.

**Glyph safety:** beat text is ASCII-only (`"..."` not `…`, straight quotes, `-`
not `—`); a required unit test asserts every bundled beat passes
`findUnsupported` and the structural invariants (unique gap-free `index`, unique
`id`, body ≤ 200 chars). Content is a frozen `as const` array compiled into the
build (offline, type-checked, glyph-tested); later authorable via the existing
file-import/web-builder pipeline (a future "story pack" validated by the same
glyph check).

### The "Lost Signal" outline (8 beats — ASCII-safe)

| # | id | trigger | title | body (abridged) |
|---|----|---------|-------|-----------------|
| 0 | first-contact | decodesCompleted ≥ 1 | CARRIER FOUND | "Static. Then, under it, a pulse. Steady. Too regular for noise. Something is still transmitting on a dead band." |
| 1 | the-loop | decodesCompleted ≥ 3 | IT REPEATS | "The same burst, over and over. A loop... First fragment: '. . . IF YOU CAN HEAR . . .'" |
| 2 | a-voice | signalRate ≥ 50 | A VOICE | "Not a beacon. A person. '...if you can hear this, the relay held. I am still here. I think.'" |
| 3 | her-name | decodesCompleted ≥ 8 | KESS | "A name surfaces: KESS. A station log, a launch, then silence. 'The others slept and did not wake. I kept the signal up.'" |
| 4 | how-far | tech `d.phaselock` | THE DELAY | "Phase-lock resolves the timing. The delay is enormous. This crossed a gulf, and has been crossing it a very long time." |
| 5 | not-a-call | decodesCompleted ≥ 15 | NOT A DISTRESS CALL | "'I am not asking for rescue. There is no rescue. I am asking you to remember that we were here.'" |
| 6 | the-coords | signalRate ≥ 250 | COORDINATES | "Buried in the carrier: a position. Yours. The loop was aimed. It was pointed at you. It was waiting." |
| 7 | still-here | decodesCompleted ≥ 25 | REPLY? | "'You are listening now. I can feel the lock. So tell me - are you still out there too?' [ the receiver can transmit ]" |

Arc: noise → pattern → a person → who she was → how impossibly far → her true
intent (witness, not rescue) → the turn (the signal sought *you*) → a v1
cliffhanger (transmit capability — the hook for a v2 two-way arc). Each beat lands
on a *different kind* of progress, so it never reads as one bar ticking up. (Note:
beat 4's `d.phaselock` is the canonical decryption tech node added to the tree.)

---

## UI, rendering & input

Reuses the flashcard primitives wholesale: the three-zone render pattern, the
pixel-layout helpers (`src/glasses/layout.ts`), the quiescence debounce
(`input-gate.ts`), and the pure `reduce(state, event) → {state, effects}` machine.
**Hot-path rule: a tick / cursor move / number change is always a
`textContainerUpgrade`; `rebuildPageContainer` fires only when the container set
changes (view switch, entering/leaving a beat card).**

### Views & navigation

Six views: **Status/HQ** (signal+rate, power bar, active decode + countdown),
**Build**, **Tech**, **Decode** (pick target), **Objectives**, and the modal
**Story beat** card.

Recommended nav — **swipe-cycled tab ring + press-to-act + double-press = back
one level:**

| Context | Swipe ↓ / ↑ | Single press | Double press |
|---------|-------------|--------------|--------------|
| Browsing a view | next / prev view (ring) | enter list (focus cursor) | exit dialog |
| Focused in a list | cursor down / up | act (build / research / start decode) | back to browsing |
| Story beat (modal) | page if multi-page | acknowledge / dismiss | acknowledge (never exit) |

Double-press pops one nav level; popping past the top raises
`shutDownPageContainer(1)`. A live beat swallows `back` as acknowledge, so a
reflexive double-press can't quit. Touch only (no IMU). Lists are rendered as
**text rows with a `>` cursor** (not native list containers, which can't update
in place) so cursoring is flicker-free.

### Layout (reuse flashcard `ZONES`)

Header 576×40 (vitals via `justify` — `SIG / rate` left, `PWR bar used/cap`
right), body 576×208 (`isEventCapture`), footer 576×40 (tab indicator + context
hints). Story beats reuse the welcome pattern: single full-screen capture
container.

```
+--------------------------------------------------------------+
| SIG 12.4k  +84/s                          PWR ███████▒▒▒ 7/10 |
+--------------------------------------------------------------+
|                  DECODING: Orbital Relay                     |
|                  ██████████████▒▒▒▒▒▒  02:14 left            |
|                  Fragments  3      Antennas  2               |
+--------------------------------------------------------------+
| ● Status  ○ ○ ○ ○                    ↑↓ views   ● open       |
+--------------------------------------------------------------+
```

### Widgets & formatting (glyph-safe)

Bars: `█` (filled) + `▒` (empty) — both allow-listed (note `━` is *not* in
`glyphs.ts`; box-drawing `─│╭╮╯╰` reserved for dividers). Pips/tabs: `●`/`○`.
A pure `fmt(n)` → `1.2k / 34.5k / 3.4M`; countdowns `mm:ss` / `h:mm:ss`. A
dev/test guard runs `findUnsupported` over every produced zone string.

### Input & lifecycle (glue, mirrors `review.ts`)

`createInputGate` collapses burst swipes (gestures gated; the ~1 s tick is not).
Map `textEvent` 1/2 → nav up/down, `sysEvent` 0 → select, `sysEvent` 3 → back
(read `eventType ?? 0` for the protobuf-zero case). `FOREGROUND_ENTER` → catch-up
`advance` then re-render; `FOREGROUND_EXIT` → persist + pause tick; `SYSTEM_EXIT`/
`ABNORMAL_EXIT` → flush + cleanup. A pure **reducer** (`reduce(state, event, now)
→ {state, effects}`) owns nav + game actions so all UI logic is unit-testable;
`main.ts` glue stays thin (normalize input, run the tick, interpret
`persist`/`exitDialog`/`rebuild`/`cleanup` effects, diff-then-upgrade zones).

---

## Architecture

**A separate Even Hub plugin in the same repo**, beside flashcards. Independent
build/package/version; shares code at the module layer.

| Concern | Flashcards (existing) | Lost Signal (new) |
|---|---|---|
| Entry | `index.html` → `src/main.ts` | `game.html` → `src/game/main.ts` |
| Vite config | `vite.config.ts` | `vite.game.config.ts` (mirrors `vite.web.config.ts`) |
| Output | `dist/` | `dist-game/` (gitignored) |
| Manifest / id | `app.json` / `com.smiles0527.flashcards` | `game.app.json` / `com.smiles0527.lostsignal` |
| Package | `g2-flashcards.ehpk` | `lost-signal.ehpk` |

Separate plugin (not a mode flag) because the game shares no domain data with
flashcards; folding it in would bloat both `.ehpk`s and tie their versions. Reuse
is at the module layer instead.

**Shared code (imported, not copied):** `src/core/glyphs` (validate all authored
strings), `src/core/time` (local-day for any daily challenges), `src/glasses/
layout` + `input-gate`. The generic envelope/chunk helpers in `storage.ts` move
to a small `src/core/envelope.ts` (`wrap`/`unwrap`/`migrations`/`chunkRead`/
`chunkWrite`/serialize-queue) consumed by both flashcards `storage.ts` and the
game's `save.ts` — a behavior-preserving refactor covered by existing
`storage.test.ts`. `tsconfig` `include` already covers `src/` (so `src/game/`),
no change needed.

### Modules (`src/game/`) — pure engine vs glue

| Module | Kind | Responsibility |
|---|---|---|
| `types.ts` | pure | `GameState`, `Building`, `TechNode`, `Objective`, `StoryBeat`, `Slot`, `Effect`/`Modifiers`, `Envelope<GameState>` |
| `effects.ts` | pure/testable | `applyEffects` fold → `Modifiers` |
| `economy.ts` | pure/testable | production, costs, power model, `buy` |
| `progression.ts` | pure/testable | decode lifecycle + `advance(state, now, mods)` (accrual + completions) |
| `tech.ts` | pure/testable | tech DAG, `canResearch`/`research`, effect lookup |
| `objectives.ts` | pure/testable | objective + challenge defs + `newlyCompleted` |
| `beats.ts` | pure/testable | ordered beats + `pendingBeats`; glyph-validated content |
| `engine.ts` | pure/testable | composes one tick: `mods = applyEffects(...)` → `advance` → objectives → beats |
| `save.ts` | glue-ish/testable | versioned+chunked single blob over an **injected** bridge |
| `reducer.ts` | pure/testable | nav + action state machine `reduce(state, event, now)` |
| `render.ts` | pure/testable | view string builders via `layout` |
| `main.ts` | glue/manual | bridge, ~1 s tick loop, lifecycle — the only clock/bridge reader |

## Save / persistence

One `GameState` → `JSON.stringify` → `{schemaVersion, data}` envelope → chunked
across `lostsignal.save.<i>` keys + `lostsignal.save._n` (chunk count, **written
last**) — the flashcards storage discipline for a single blob.

```ts
const CURRENT_SCHEMA = 1
export interface GameStore {
  load(): Promise<GameState | null>        // chunkRead → unwrap → migrate; null if absent/corrupt
  save(state: GameState): Promise<boolean> // stamp lastSeenMs → wrap → chunk; chunks THEN _n; serialized+debounced
}
export function createGameStore(bridge: StorageBridge, opts?: { chunkSize?: number }): GameStore
```

`load` tolerates missing (`""`/`0` → fresh game), detects truncation (a `""` mid
chunk → `null`, don't parse a torn blob), unwraps pre-envelope blobs as v1, and
runs ordered `migrations`. `save` stamps `lastSeenMs`, uses the single-slot
serialize queue (≤1 write in flight). **Write triggers:** debounced after
meaningful actions; immediate flush on `FOREGROUND_EXIT` / `SYSTEM_EXIT` /
`beforeunload` (no background to flush later). Ticks mutate in-memory only; a
crash loses at most a few seconds of idle accrual, which `lastSeenMs`
reconstructs on next open.

## Testing

Two tiers, same as flashcards: **pure logic → vitest ~full coverage; glue →
manual + simulator automation + Playwright.** Correctness risk is entirely in the
engine, so coverage there is exhaustive.

- **`advance` (the heart):** offline gap completes exactly N decodes (incl. the
  `now === endMs` inclusive boundary and the remainder carried into the re-based
  next decode); `now ≤ lastSeenMs` clamps to 0 (no negative resources, no
  un-completing); accrual = `rate × elapsed`; composability (`advance(s,t1)` then
  `advance(_,t2)` == `advance(s,t2)`); power-capped accrual uses the throttled
  rate.
- **`economy`/`tech`/`objectives`/`beats`/`effects`:** behavior assertions (first
  unit = BASE; `buy` deducts exactly; prereq gating; latching fire-once;
  order-independent fold; every beat glyph-clean + structural invariants).
- **`save` (mock bridge — reuse `makeMockBridge()`):** chunk round-trip incl.
  `chunkSize`/`chunkSize+1` boundaries; count-key-last / partial-write → `null`;
  migration (pre-envelope + old-shape → upgraded, re-serialized with current
  schema); missing → `null`.
- **`reducer`/`render`:** pure nav/view assertions; glyph-safe output.
- **Glue (`main.ts`):** simulator `--automation-port` (screenshots/console/input)
  + a `scripts/verify-game.mjs` Playwright harness (mirrors `verify-phone.mjs`)
  pointed at `game.html`; plus an end-to-end offline-accrual check (save, reopen
  after a gap / stubbed past `lastSeenMs`, confirm catch-up matches pure
  `advance`); plus a glyph probe rendering authored beats on the simulator.

## Scope (v1 / v2)

**v1 (ships):** signal/power/fragments; the power-budget constraint; 4 buildables
with geometric curves; a small branching tech tree (2–3 meaningful branch
choices); objectives + challenges; time-gated decodes via pure `advance`; ~8
linear story beats; offline accrual + live ticking; versioned chunked save.

**v2 (deferred, designed-for):** timed events; prestige; authorable story packs.

**YAGNI-trimmed (not v1):** sound (no G2 audio path); >4 buildables / sprawling
tree before the loop is proven; multiple save slots / cloud / leaderboards;
background-push progress (impossible on-platform); branching/non-linear story.

## Packaging

```json
{
  "package_id": "com.smiles0527.lostsignal",
  "edition": "202601",
  "name": "Lost Signal",
  "version": "0.1.0",
  "min_app_version": "2.0.0",
  "min_sdk_version": "0.0.10",
  "entrypoint": "index.html",
  "permissions": [],
  "supported_languages": ["en"]
}
```

Valid against the schema (lowercase reverse-domain id with 3 letter-initial
segments — `lostsignal`, no hyphen; name 11 ≤ 20 chars; empty `permissions` — no
network, no CORS surface). **Entrypoint caveat:** `entrypoint` is resolved
relative to `dist-game/` and must match the emitted HTML name — set the Vite
Rollup input so `game.html` emits as `dist-game/index.html` (matching flashcards),
or set `entrypoint` to whatever Vite writes; confirm before packing.

Build + pack:

```bash
npm run build:game                                        # tsc + vite --config vite.game.config.ts → dist-game/
npx evenhub pack game.app.json dist-game -o lost-signal.ehpk
```

New `package.json` scripts (flashcards untouched): `dev:game`
(`vite --config vite.game.config.ts`), `build:game`
(`tsc && vite build --config vite.game.config.ts`), `sim:game`
(`evenhub-simulator http://localhost:5175`), `pack:game`
(`evenhub pack game.app.json dist-game -o lost-signal.ehpk`). Gitignore
`dist-game/` and `lost-signal.ehpk`.

## Build order (for the implementation plan)

Dependency-ordered, each step test-first where pure: `types` + `effects` →
`economy` → `progression`/`advance` → `tech` → `objectives` → `beats` → `engine`
(compose) → `save` (+ envelope refactor) → `reducer` → `render` → `main` glue +
entry/config → simulator/Playwright E2E → packaging.
