# G2 Flashcards — Design Spec

**Date:** 2026-06-08
**Status:** Draft for review

## Context

`eveng2s` is currently a hello-world Even Hub G2 plugin (a single text page). We
want a first *real* app: a spaced-repetition flashcard reviewer you wear on the
glasses, with no-code card management on the phone.

The G2 is a heads-up display, not a phone — 576×288, 16 greens, ~400 chars a
screen, a few gestures, a head IMU, and persistent storage via the app bridge.
Flashcard review fits it well: short text per card, hands-free grading, deck
state in `localStorage`, and a scheduling algorithm (SM-2) that's a good fit.

**Goal:** add cards by pasting/typing on the phone; review due cards hands-free
on the glasses; schedule with SM-2. All code authored as part of this build.

## One web app, two screens (split by launch source)

The plugin is a single web app loaded in the Even App's Flutter WebView. It
decides which UI to render from the launch source (`bridge.onLaunchSource`):

- **`appMenu`** (opened from the phone) → render the **phone authoring UI** as
  normal DOM/CSS.
- **`glassesMenu`** (opened from the glasses) → run the **glasses review flow**
  via bridge containers.

Same code, same storage, two entry points. `main.ts` is a thin router: it awaits
the bridge, registers the launch-source listener as early as possible (the host
pushes it once after load), and mounts the matching screen. If no launch source
arrives within a short timeout (e.g. plain browser dev), default to the phone
authoring UI so the app is still developable in a browser. The full set of
bridge/launch failure paths is specified in **Error handling & failure states**.

## Phone authoring screen (DOM, `appMenu`)

Styled to the Even design tokens (see `everything-evenhub:design-guidelines` —
`--color-bg`, `--color-surface`, `--color-text`, accent `#FEF991`; FK Grotesk
Neue; 4/8px spacing grid). Never use glasses-green `#3CFA44` in phone UI.

Components:

1. **Deck selector** — a dropdown of existing decks + a "New deck…" action
   (prompts for a name). The selected deck is the active deck for both add and
   review.
2. **Bulk paste box** — a textarea. One card per line, `front | back`. The
   parser is lenient: accepts `|` **or** a Tab as the separator (so a two-column
   spreadsheet selection pastes cleanly). Blank lines and lines without a
   separator are skipped (with a small "N skipped" note). **Save** appends the
   parsed cards to the active deck (new cards get fresh SM-2 state).
3. **Quick-add form** — two inputs (front, back) + **Add** for single cards.
4. **Card list** — every card in the active deck, each row showing front/back, a
   delete (✕) control, a due/scheduling badge, and a **glyph-warning badge** for
   cards containing characters the glasses font can't render (see Font & glyph
   validation).

Both write paths (paste, quick-add) run **glyph validation** at save time and
surface unsupported characters inline. State reads/writes go through the storage
layer; saves are debounced and serialized (one bridge write at a time).

## Data model & storage

```ts
type Grade = 'again' | 'good' | 'easy'   // → SM-2 q = 2 | 4 | 5

interface Card {
  id: string          // crypto.randomUUID()
  front: string
  back: string
  ef: number          // ease factor, starts 2.5, floor 1.3
  interval: number    // days until next review
  reps: number        // consecutive successful reps
  due: number         // local-day index when next due (see Time & due dates);
                      // new cards due = today
}

interface Deck {
  id: string          // crypto.randomUUID() — stable, never changes
  name: string        // human display name; may contain spaces/./unicode, renamable
  cards: Card[]
}

// Lightweight directory of decks (no card payloads)
interface DeckMeta { id: string; name: string }

// Every stored blob is wrapped so its shape can evolve.
interface Envelope<T> { schemaVersion: number; data: T }
```

### Why id-based keys

Keys must never embed user-controlled text. A name with spaces, `.`, unicode, or
a leading digit can collide with another deck's chunk keys (`A.b` vs `A` + `.b`),
become unreachable, or orphan its chunks on rename. So **all storage keys are
derived from an opaque `deckId`** (`crypto.randomUUID()`, generated once in
`createDeck`); the display `name` is just a field inside the payload and can
change freely without touching any key.

### Key scheme

| Key | Holds |
|-----|-------|
| `flashcards.index` | `Envelope<DeckMeta[]>` — the deck directory (id + name per deck) |
| `flashcards.active` | `Envelope<string>` — active `deckId` (`""` data ⇒ none) |
| `flashcards.deck.<deckId>._n` | `Envelope<number>` — chunk count (**written last**) |
| `flashcards.deck.<deckId>.<i>` | raw chunk string `i ∈ [0, n)` — slice of the serialized `Envelope<Deck>` JSON |

`<deckId>` is a UUID, so the `.` delimiters are unambiguous. `CHUNK_SIZE ≈
50 000` chars, per the `everything-evenhub:device-features` chunking pattern. The
chunked value is the JSON of the **whole** `Envelope<Deck>` (envelope wraps
before chunking), so a deck's version travels with its bytes. Persistence is
**only** via `bridge.setLocalStorage`/`getLocalStorage` (browser
localStorage/IndexedDB are unreliable in this WebView).

### Versioning & migration

`CURRENT_SCHEMA = 1`. Every write goes through `wrap(data)`; every read through
`unwrap<T>(raw, fallback)`, which parses, runs ordered migrations if stale, and
returns typed `data`.

```ts
const CURRENT_SCHEMA = 1

// Ordered, gap-free: migrations[v-1] upgrades a v→v+1 blob. Append only.
const migrations: Array<(d: any) => any> = [
  // index 0: v1 → v2 lives here when CURRENT_SCHEMA becomes 2
]

function wrap<T>(data: T): string {
  return JSON.stringify({ schemaVersion: CURRENT_SCHEMA, data })
}

// raw is the bridge string; "" ⇒ missing key ⇒ caller supplies fallback.
function unwrap<T>(raw: string, fallback: T): T {
  if (raw === '') return fallback
  const env = JSON.parse(raw) as Envelope<any>
  let v = typeof env.schemaVersion === 'number' ? env.schemaVersion : 1
  let data = 'data' in env ? env.data : env       // tolerate pre-envelope blobs
  while (v < CURRENT_SCHEMA) { data = migrations[v - 1](data); v++ }
  return data as T
}
```

`loadDeck` reassembles chunks into one string then `unwrap<Deck>`; migrated data
is rewritten lazily on the deck's next `saveDeck` (no eager bulk migration).

### storage.ts API

All async; all key off `deckId`; all wrap/unwrap through the envelope. The bridge
is **injected** (or read via a swappable handle) so tests can substitute a mock.

```ts
listDecks(): Promise<DeckMeta[]>                       // unwrap flashcards.index, [] if absent
createDeck(name: string): Promise<DeckMeta>            // mint deckId, append to index, save empty deck
loadDeck(id: string): Promise<Deck | null>            // read _n, join chunks, unwrap → Deck (null if corrupt)
saveDeck(deck: Deck): Promise<boolean>                // wrap+chunk; write chunks THEN _n; sync index name
deleteDeck(id: string): Promise<void>                 // remove chunks+_n, drop from index, clear active if it pointed here
getActiveDeckId(): Promise<string | null>             // unwrap flashcards.active; null if absent/unknown
setActiveDeckId(id: string): Promise<void>            // wrap+write flashcards.active
deleteCard(id: string, cardId: string): Promise<boolean> // loadDeck → filter → saveDeck
```

### Write ordering, partial writes & serialization

- **Serialize + debounce:** at most one bridge write in flight (single-slot
  promise queue); authoring saves are debounced. Concurrent `saveDeck` calls
  collapse to the latest state.
- **Count key written last:** `saveDeck` writes chunks `0..n-1` first, **then**
  `_n`. A crash mid-write leaves a stale/missing `_n`, so a half-written body is
  never read as complete.
- **Half-write detection on load:** `loadDeck` reads `_n`; `""`/`0` ⇒
  empty/absent. If any chunk `i < n` reads back `""`, the deck is corrupt —
  return `null` (caller surfaces the error) rather than parsing a truncated
  envelope. Because `_n` is written last, its presence implies all chunks
  committed.

### Time & due dates (local day)

Scheduling is day-granular, so "today" must mean the user's **local** calendar
day, not a UTC epoch-day. Naive `Math.floor(Date.now()/86_400_000)` counts days
from the Unix epoch in **UTC**: it rolls over at 00:00 UTC, so a user in UTC−5
sees cards flip to "due" at 7 pm local, and a late-night review west of UTC is
already counted as the next day. For a study app that's a visible bug.

**Local-day index** lives in `core/time.ts` (kept out of `scheduler.ts` so the
scheduler stays a pure, time-free function):

```ts
// core/time.ts
export function localDayIndex(d: Date): number {
  // Midnight UTC for the *local* calendar date → divisor is always a whole
  // UTC day, result counts local calendar days.
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}
export const todayLocal = (): number => localDayIndex(new Date())
```

`getFullYear/getMonth/getDate` are local getters, so two `Date`s on the same
local day map to the same integer regardless of wall-clock time. **DST-safe:** a
real local day can be 23 or 25 hours, so dividing a local epoch-ms would drift
across DST transitions; we instead extract calendar fields and rebuild them at
`Date.UTC(...)`, exactly 86.4M ms apart by construction, so consecutive local
dates always yield consecutive integers.

- `due` is a **local-day index**: the day on/after which the card reappears.
- Due check: `isDue = (c, today = todayLocal()) => c.due <= today`.
- Scheduler uses `due = today + interval` (interval is whole days; a local-day
  index plus whole days stays a local-day index), with `today = todayLocal()`.
- "Next due in N days": `min(future dues) - today` in local days (`null` → "—").
- New cards: `due = todayLocal()` (immediately reviewable).
- **Timezone changes (v1):** `due` integers are device-local. After a TZ move,
  cards roll over at the new local midnight (correct going forward); cards
  scheduled before the move can appear due up to ~1 day early/late. Bounded by
  one day, self-corrects on next review — we deliberately do **not** normalize
  across TZ (would require per-card offsets for no real study benefit).

## Font & glyph validation

The G2 renders from a **single LVGL font baked into firmware** — no font
selection, no fallback font, no placeholder glyph. Characters outside the font's
set are **silently skipped**: no error, no tofu box, the character just vanishes.
Flashcard content routinely contains exactly the missing characters — Greek (λ Δ
π), math symbols, em/en dashes, smart quotes, ellipsis, emoji — so a card
authored as `"λ-calculus — basics…"` can reach the glasses as `-calculus
basics`, silently corrupted. v1 must catch this at authoring time.

### What the firmware font actually supports

The only public characterization is the community **even-g2-notes** project
(`https://github.com/nickustinov/even-g2-notes`, `docs/display.md`). Even
Realities doesn't publish the font's coverage, so **treat the notes as
informative, not authoritative — verify on the simulator before relying on any
glyph.** From that source:

- **Supported:** printable ASCII and most of Latin-1 Supplement
  (`U+0020–U+00FF`) *except* five gaps — `¨ ¯ ´ µ ¸`. Accented Latin (`é ñ ü ç`)
  is fine.
- **Supported (curated symbols):** arrows (`← ↑ → ↓ ↔ ⇒`), box-drawing
  (`│ ─ ╭╮╯╰`), blocks (`█ ▇▆▅▄▃▂▁ ▒`), shapes (`● ○ ■ □ ★ ☆ ▲ ▶`), suits
  (`♠ ♣ ♥ ♦`), super/subscripts, a few fractions, `© ® ™ ° † ※ ∞`. These are the
  only safe non-ASCII glyphs — and what the review footer (`●●●○○`, `↓ · ● · ↑`)
  is built from.
- **Confirmed absent:** Greek, math operators, smart quotes `“ ” ‘ ’`, em/en
  dashes `— –`, ellipsis `…`, emoji, dingbats.
- **CJK:** ideographs absent **except fullwidth forms** (`U+FF01–U+FF5E`,
  `U+3000`), a deliberately-supported subset. A Han-only card back renders blank.

**Conservative posture.** Validation is driven by an **explicit allow-list** the
app owns (`src/core/glyphs.ts`), not a denylist of known-bad chars: ASCII
printable + Latin-1 minus the five gaps + the curated symbol set. Everything else
is flagged. False positives (flagging a glyph that actually renders) are cheap to
fix by adding to the list after a simulator check; false negatives (passing a
glyph that vanishes) are the failure we refuse. Each allow-list range carries a
one-line comment citing even-g2-notes.

### Validation function

`src/core/glyphs.ts` — pure, unit-tested:

```ts
export function isSupported(cp: number): boolean
interface UnsupportedChar { char: string; cp: number; index: number }
export function findUnsupported(text: string): UnsupportedChar[]   // [] when clean
interface CardValidation { ok: boolean; front: UnsupportedChar[]; back: UnsupportedChar[] }
export function validateCard(card: Pick<Card, 'front' | 'back'>): CardValidation
```

- Iterate **by codepoint** (`for (const ch of text)`), never by UTF-16 unit, so
  emoji/astral chars are one offender, not two lone surrogates.
- `\n` (line breaks in render) and space must pass.

### Where validation runs

On the **phone authoring screen, at save time** (never on the glasses — they're
a passive renderer). Bulk paste validates each parsed card after `parse.ts`;
quick-add validates on blur and Add. Warnings are **inline and specific**: which
card, which field, which characters + codepoints — e.g. `Card "λ-calculus…" —
front: λ (U+03BB), — (U+2014), … (U+2026) won't display.` Saving is **not
blocked** (the user may only care about the back), but flagged cards get a
persistent warning badge in the card list so corruption is a *visible decision*,
not a silent bug.

### Fallback / transliteration

An optional, opt-in **"Fix characters"** action (per-card and bulk) applies a
small conservative map before saving — we never silently rewrite content:

```ts
const TRANSLITERATE: Record<string, string> = {
  '“':'"','”':'"','″':'"', '‘':"'",'’':"'",'′':"'",
  '—':'-','–':'-','−':'-', '…':'...', ' ':' ', 'µ':'u',
  'λ':'lambda','π':'pi','Δ':'delta','α':'alpha','β':'beta',
  'θ':'theta','μ':'mu','Σ':'Sigma','Ω':'Omega',
}
export function transliterate(text: string): string
```

- **Punctuation substitutions are safe and recommended** (smart quotes, dashes,
  ellipsis, nbsp) — meaning-preserving, the most common offenders.
- **Greek → spelled names is deliberately small and judgment-dependent**
  (`λ→"lambda"` reads fine in prose, wrong in `λx.x`). Label the action clearly;
  re-validate after so remaining offenders stay flagged.
- **No guessing:** math operators, emoji, CJK have no faithful ASCII form and are
  absent from the map. After transliteration, `findUnsupported` runs again;
  whatever remains is flagged, never dropped or mangled.

### Edge cases

- **Empty/whitespace-only field** is a separate authoring error.
- **Whole-card unsupported** (Han-only or emoji-only back): warning escalates to
  *"this card will display blank on the glasses"*.
- **CJK:** allow-list permits fullwidth forms, flags ordinary CJK with copy that
  says the font lacks Chinese/Japanese/Korean characters (a firmware limit).
- **Combining marks / ZWJ / variation selectors:** unsupported unless explicitly
  allow-listed; report at the base character's index.
- **Simulator verification step:** before shipping, render a probe card with one
  of each *claimed-supported* symbol on `npm run sim` and confirm each appears;
  promote into the allow-list only after it passes. This is the ground truth
  backstopping the community-sourced ranges.

## Glasses review flow (`glassesMenu`)

State machine: `loading → (front ⇄ back) → done`.

- **loading** — read the active deck, build the due queue (`isDue`), shuffle.
  Empty → `done` with `All caught up ✓  next due in N days`.
- **front** — render `card.front` + footer `●●●○○  3/12` (filled = reviewed this
  session). Flip on swipe or single press.
- **back** — render `card.back` + hint footer `↓ again · ● good · ↑ easy`. Grade
  → `schedule(card, grade, todayLocal())` → persist → advance (or `done`).
- **done** — `Reviewed 12 · again 3 · good 7 · easy 2`. Double-press exits.

### Rendering

One full-screen text container (`containerID: 1`, `containerName: 'card'`,
`isEventCapture: 1`, 576×288, padding 4). `render.ts` builds the `content`
string (body + `\n` spacer + footer); these builders are pure and unit-tested.
Cards are assumed short enough to fit (~400 chars; no scrolling in v1). Re-render
= `textContainerUpgrade` on the same container after the initial
`createStartUpPageContainer`.

### Gesture map

| Side  | Gesture       | Action               |
|-------|---------------|----------------------|
| front | swipe ↑/↓     | flip to back         |
| front | single press  | flip to back         |
| front | double press  | exit (system dialog) |
| back  | swipe ↓       | **Again** (q=2)      |
| back  | single press  | **Good** (q=4)       |
| back  | swipe ↑       | **Easy** (q=5)       |
| back  | double press  | exit (system dialog) |

### Input/lifecycle details (from `everything-evenhub:handle-input`)

- Protobuf zero-omission: read `event.sysEvent.eventType ?? 0` (single press
  arrives as `undefined`).
- Swipes on a text container arrive as `event.textEvent` (1 = up, 2 = down);
  presses as `event.sysEvent` (0 = single, 3 = double).
- Reserve double-press for `bridge.shutDownPageContainer(1)` (system exit
  dialog). Do **not** unsubscribe/stop IMU before it — the user may cancel.
- Lifecycle: `FOREGROUND_EXIT` (5) flush state; `SYSTEM_EXIT` (7) /
  `ABNORMAL_EXIT` (6) stop IMU, unsubscribe, flush. Mirror with `beforeunload`.

## SM-2 scheduler

`src/core/scheduler.ts` — a pure function, implemented and unit-tested:

```ts
export function schedule(card: Card, grade: Grade, today: number): Card {
  const q = { again: 2, good: 4, easy: 5 }[grade]
  let { ef, interval, reps } = card
  if (q < 3) {
    reps = 0
    interval = 1
  } else {
    if (reps === 0) interval = 1
    else if (reps === 1) interval = 6
    else interval = Math.round(interval * ef)   // uses PRE-update ef
    reps += 1
  }
  ef = Math.max(1.3, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
  return { ...card, ef, interval, reps, due: today + interval }
}

export function newCardState() {
  return { ef: 2.5, interval: 0, reps: 0 }   // due set by caller to todayLocal()
}
```

### SM-2 variant & correctness

This is **textbook SuperMemo SM-2** (Woźniak 1990,
super-memory.com/english/ol/sm2.htm) — *not* Anki's modified SM-2. Deliberate:
SM-2 is a ~10-line pure function with no hidden state, so the scheduler is
transparent, trivially testable, and explainable line-by-line. Anki layers on
learning/relearning step queues, a graduating interval, per-deck ease, and a
fuzz factor — complexity we don't want in v1.

**Honest downsides (accepted for v1):**
- **Aggressive first intervals** `1 → 6 → round(I·EF)` days; no sub-day learning
  phase, so early retention is weaker than Anki's `1m/10m` steps.
- **No learning/relearning steps** — a correct answer goes straight to days; a
  lapse jumps straight back to 1 day.
- **Only 3 of 6 grades used** (`again/good/easy → q = 2/4/5`); we lose
  blackout-vs-near-miss on failures and the `q=3` "hard" pass.

**Mapping consequences.** `q` is never `< 2` (every lapse resets identically) and
never `3`. Per SM-2, any `q < 3` resets `reps→0`, `interval→1` (EF still
updated), so **every `again` fully resets** the sequence. EF deltas: `q=5 →
+0.1`, `q=4 → 0` (good leaves EF unchanged), `q=2 → −0.32`. No grade nudges EF
down *without* resetting (the omitted `q=3` would have, `Δ=−0.14`).

**Correctness subtlety pinned by tests — which EF the interval uses.** Canonical
SM-2 computes the interval with the EF carried from the *previous* review and
updates EF afterward (affecting the *next* review). The code above is consistent:
`interval = round(interval * ef)` runs **before** the `ef = max(1.3, …)`
reassignment. Tests lock this ordering:
- `good, good, good` from a fresh card → third interval `round(6 * 2.5) = 15`
  (EF still 2.5 entering review 3, since `q=4` leaves EF unchanged).
- A card where an EF change *would* be visible (an `easy` pushing EF to 2.6):
  assert the same review's interval used the old EF, with 2.6 only affecting the
  subsequent review. A before/after off-by-one here silently produces
  confidently-wrong schedules — so it gets a dedicated test.

**Future Anki-style upgrade (out of scope v1):** learning/relearning steps; a
"hard" `q=3` grade; explicit graduating/lapse intervals + ease-floor tuning.

### IMU nod/shake detection

Additive grading layered on touch; built only after touch works. **Touch is
always the source of truth** — IMU only ever triggers the same grade handlers,
never blocks or overrides, so flaky motion can't strand the user.

- **Pacing/sampling:** `bridge.imuControl(true, ImuReportPace.P500)`; consume
  `event.sysEvent.imuData {x,y,z}` when `eventType === IMU_DATA_REPORT`. `P100..
  P1000` are **protocol pacing codes, not Hz** — measure the real sample interval
  on the simulator before trusting any ms tunable below.
- **Algorithm:** keep a short FIFO sliding window (drop samples older than
  `windowMs`). **Nod** = one dominant pitch-axis swing (down-then-settle) past
  `nodThreshold` within the window. **Shake** = `≥ shakeMinReversals` yaw-axis
  sign reversals (each excursion past `shakeThreshold`) within the window.
- **Axis assumption (must validate):** nod → pitch, shake → yaw. Which of
  `{x,y,z}` is pitch/yaw and the sign convention aren't documented — capture a
  deliberate nod/shake on the simulator and inspect which channel moves. Treat
  the axis mapping as config, not a baked constant.

```ts
const IMU_GESTURE_CONFIG = {
  windowMs: 400,
  nodAxis: 'y',          // ASSUMPTION: pitch — validate on hardware
  shakeAxis: 'x',        // ASSUMPTION: yaw   — validate on hardware
  nodThreshold: 0.6,     // min pitch-swing magnitude (raw imuData units)
  shakeThreshold: 0.5,   // min per-excursion yaw magnitude
  shakeMinReversals: 2,
  refractoryMs: 600,     // debounce: ignore gestures after a fire
}
```

- **Refractory period** after any detection: clear the window, ignore IMU until
  it elapses, so one physical gesture fires once and the settle-back can't
  re-trigger.
- **Gating:** active **only on `back`**; ignored on `front`/`done`. `nod ↓ →
  good`, `shake ↔ → again`. Ambiguous/weak motion (neither clears threshold, or
  both fire) → do nothing, wait for touch.
- **Calibration:** defaults bias toward false-negatives (a missed nod just means
  tap; a phantom grade is worse). Validate axes, measure the real rate, and
  retune via `everything-evenhub:simulator-automation` and hardware before
  loosening.

## Error handling & failure states

Every bridge call shares one flaky BLE link, storage is the only persistence,
and the glasses render *only* through a successful `createStartUpPageContainer`.
Two cross-cutting rules: **all bridge calls are serialized and timeout-wrapped**
(awaited, never concurrent, raced against ~4 s; a timeout = the failing return);
and **never advance state on an unconfirmed write** (a grade is committed only
once its `saveDeck` resolves true).

### 1. Storage write failure — `setLocalStorage`/`saveDeck` returns false (or times out)

- **Retry:** one serialized retry after ~250 ms backoff; still false → surface,
  don't loop.
- **Phone:** inline error on the affected control (paste: banner above the
  textarea "Couldn't save — tap Save to retry"; quick-add: error under inputs).
  **Never clear the textarea/inputs** — text is preserved for one-tap retry. No
  optimistic insert into the card list.
- **Glasses:** the graded card stays in the due queue, the session does **not**
  advance, and the hint footer is replaced by `⚠ save failed — tap to retry`.
  Recovery re-runs the persist on the **original** card (re-`schedule`, idempotent
  — pure function applied to the un-mutated card, so EF/interval don't
  double-step) → success reverts the footer and advances. On exit, attempt one
  final flush; if it fails, drop the in-memory grade (card stays due — safe,
  re-review is idempotent).

### 2. Storage read failure / corruption

Distinguish **missing** from **corrupt**:

| Case | Detection | Treat as |
|------|-----------|----------|
| Missing | `_n` reads `""` (no `0`-chunk) | empty/absent deck — normal |
| Truncated | `_n`=N but chunk `i<N` reads `""` | corrupt |
| Parse error | reassembled `JSON.parse` throws | corrupt |
| Shape error | parses but not a `Deck` (no `cards`) | corrupt |

- **Never crash:** `loadDeck`/`listDecks`/`getActiveDeckId` wrap reads in
  try/catch + shape-validate; corrupt ⇒ return empty deck / `[]` / `null` and
  `console.error`. **Do not auto-overwrite** a corrupt key on load (preserve
  recoverable data); it's replaced only on the user's next explicit save.
- **Phone:** non-destructive "Couldn't load this deck — it may be corrupted" on
  that row; index corruption falls back to no decks + "New deck…".
- **Glasses:** corrupt active deck ⇒ treat as no due cards ⇒ `done`/empty screen
  reading `Couldn't load deck`. Never blank or hung.

### 3. `createStartUpPageContainer` returns non-zero

The **bootstrap** call — until it succeeds once there's no container to render
into, so even an error message needs a successful create with short text.

| Code | Likely cause here | Handling |
|------|-------------------|----------|
| 2 oversize / 3 OOM | card `content` too long | **truncate to ~400 chars + `…` and retry once** (card body is the only variable-size input) |
| 1 invalid | container-config bug (bad id/name, 0 or ≥2 `isEventCapture`) — not data | **fail loud in dev** (throw + log payload); prod falls through to the minimal error screen |

- **Minimal error screen:** a hardcoded known-good single-container payload with
  tiny static `content` (`⚠ Display error\nDouble-tap to exit`), `containerID:1`,
  `isEventCapture:1`; short text is within limits so it returns 0. Double-press →
  `shutDownPageContainer(1)`. If even this fails, `console.error` +
  `shutDownPageContainer(0)` so the user isn't stranded on black.

### 4. `textContainerUpgrade` returns false

Stale screen if left. **One retry**; still false → fall back to
`rebuildPageContainer` (full redraw, brief flicker acceptable vs stale). Still
false → minimal error screen (§3). Dev builds assert id/name match the created
container (the common silent cause).

### 5. Empty states (normal, not errors — no warning styling)

| Surface | Condition | Shown |
|---------|-----------|-------|
| Phone | no decks | selector shows only "New deck…"; add disabled, hint "Create a deck to add cards" |
| Phone | deck, 0 cards | empty list, "No cards yet — paste or add above" |
| Glasses | deck empty | `done`: `Deck empty\nAdd cards on phone` |
| Glasses | 0 due today | `done`: `All caught up ✓\nnext due in N days` |
| Glasses | no active deck | treat as empty deck (no crash) |

### 6. Bridge never ready / wrong launch source

- **Detection:** race `waitForEvenAppBridge()` against ~5 s; race `onLaunchSource`
  (fires exactly once, may never arrive) against ~1–2 s.
- **Waiting:** show "Connecting…" (phone: line/spinner; glasses: minimal
  container) — never a blank screen.
- **Bridge resolves, no launch source in time:** default to **phone authoring
  UI** (correct dev-browser path, safe prod default).
- **`waitForEvenAppBridge` times out entirely:** assume plain-browser dev — mount
  phone UI with a non-blocking banner "Bridge unavailable — running in
  browser/dev mode"; storage calls are stubbed to an **in-memory map** so the
  authoring UI still round-trips.
- **`glassesMenu` then bridge drops (`ABNORMAL_EXIT`):** stop IMU, unsubscribe,
  flush; OS reclaims the page. No reconnect UI in v1.
- **Unknown launch source:** log + fall back to phone UI (can't strand a user on
  a broken glasses flow).

## File structure

```
src/
  core/
    types.ts            # Card, Deck, DeckMeta, Grade, Envelope
    time.ts             # localDayIndex, todayLocal
    glyphs.ts           # allow-list, findUnsupported, validateCard, transliterate
    parse.ts            # bulk-paste parser (| or Tab) → { cards, skipped }
    scheduler.ts        # SM-2 (pure) + newCardState
    scheduler.test.ts
    parse.test.ts
    glyphs.test.ts
    storage.ts          # deck/index load+save over injected bridge (chunked, versioned)
    storage.test.ts     # mock-bridge round-trip/chunk/migration tests
  glasses/
    review.ts           # bridge glue: subscribe → normalize → reduce → effects
    reducer.ts          # pure reduce(state, event) → { state, effects }  (testable)
    reducer.test.ts
    render.ts           # pure container/footer string builders
    render.test.ts
    imu.ts              # nod/shake detection over IMU stream (additive)
  phone/
    authoring.ts        # DOM UI: selector, paste box, quick-add, list, glyph warnings
    authoring.css       # Even design tokens
  main.ts               # launch-source router → phone or glasses
index.html              # hosts the app; empty body, script entry
```

Tooling: add `vitest` (+ `npm test`). Keep the existing Vite/TS setup.

## Testing

Two tiers: **unit tests** for `src/core/*` and the pure glasses logic
(`reducer.ts`, `render.ts`), and **manual/simulator** verification for layers
that need the real bridge/DOM.

### Test runner

`vitest` dev dependency; `*.test.ts` colocated. `"test": "vitest run"`,
`"test:watch": "vitest"`. Environment per-area via a file-top directive
(`// @vitest-environment node` for `core`/pure logic; `jsdom` only if we add DOM
tests). The bridge global is never touched in unit tests — storage injects a
mock.

### `parse.ts`

| Input | Expectation |
|-------|-------------|
| `a \| b` / `a⇥b` (Tab) | one trimmed card; `skipped:0` |
| mixed `\|`/Tab lines | each split by its own separator |
| no separator | not emitted; `skipped++` |
| `  a  \|  b  ` | trimmed to `a`/`b` |
| `a \| b \| c` | split on **first** only → back = `b \| c` |
| blank/whitespace lines | skipped, **not** counted |
| `''` | `{ cards:[], skipped:0 }` |
| CRLF vs LF | both → correct cards; trailing `\r` stripped |
| empty front or back | skip + count (a card needs both); test both |

Assert new cards carry fresh `newCardState()` (+ `due = todayLocal()` when set by
the caller) and `skipped` counts only separator-less non-blank lines.

### `storage.ts` (mock bridge)

Inject an in-memory Map for the bridge:

```ts
function makeMockBridge() {
  const store = new Map<string, string>()
  return { store, bridge: {
    async setLocalStorage(k: string, v: string) { store.set(k, v) },
    async getLocalStorage(k: string) { return store.get(k) ?? '' },
  }}
}
```

Cases: round-trip `saveDeck`→`loadDeck` deep-equal; **chunk boundary** (force
small `CHUNK_SIZE`; deck JSON > CHUNK_SIZE spans multiple keys and reassembles
exactly — include sizes at `CHUNK_SIZE` and `CHUNK_SIZE+1`); **count-key-last /
partial write** (pre-seed 3 chunks + `_n=2` ⇒ `loadDeck` reads `_n` chunks,
ignores orphan, no crash; a clean save makes trailing chunks unreachable);
**missing key** (`loadDeck(unknownId)` ⇒ null/empty, `listDecks()` ⇒ `[]`,
`getActiveDeckId()` ⇒ null); **schemaVersion migration** (seed a pre-envelope /
old-shape blob ⇒ `loadDeck` migrates filling `newCardState()` defaults ⇒ next
`saveDeck` persists the upgraded envelope — assert both migrated result and
re-serialized form); **index add/remove** (createDeck appends, deleteDeck
removes, no dup names); **deleteCard** (removes one, others' SM-2 state intact,
no-op for unknown id).

### `scheduler.ts`

As specified above: `again` resets `reps→0`/`interval→1`; `good` steps `1 → 6 →
round(6·ef)`; `ef` floor 1.3 under repeated `again`; `easy` raises `ef` above
2.5; `due === today + interval`; purity (input unmutated); and the **EF-ordering**
tests from *SM-2 variant & correctness*.

### Pure-logic boundary

| Module | Testable how |
|--------|--------------|
| `core/parse`, `core/scheduler`, `core/time`, `core/glyphs` | unit (node) — pure |
| `core/storage` | unit (node, mock bridge) — I/O isolated behind injection |
| `glasses/render`, `glasses/reducer` | unit (node) — pure builders / pure state machine |
| `glasses/review` glue, `glasses/imu`, `phone/authoring` | manual/simulator |

**Reducer extraction:** `review.ts` is split so the state machine is a pure
`reduce(state, event) → { state, effects? }` (`event` = `flip | grade(...) |
exit | lifecycle`; `state` = `loading|front|back|done` + queue/session
counters). The thin bridge wrapper only normalizes raw `textEvent`/`sysEvent`
into events, calls `reduce`, and runs effects (render, persist, IMU). The whole
`front ⇄ back → done` machine, due-queue construction, and session tally become
unit-testable with no bridge — that machine is where review bugs hide.

### End-to-end / manual (simulator)

- **Phone:** open `localhost:5173` (defaults to `appMenu`). Create a deck, paste
  several `front | back` lines, Save; card list updates, "N skipped" matches
  malformed/blank lines, glyph badges appear for bad characters, reload re-loads
  (persistence).
- **Glasses:** `npm run dev` then `npm run sim` (Vite first). front → flip →
  grade → next via touch; a graded card's `due` advances and it leaves the queue;
  double-press opens the exit dialog.
- **IMU bonus:** with simulator IMU/automation, nod = Good, shake = Again, and
  touch still grades when IMU idle.
- **Glyph probe:** render a card with one of each claimed-supported symbol;
  confirm each appears (promote/demote the allow-list accordingly).
- **End-to-end:** add on phone → review on glasses → re-open later same day shows
  remaining due; next day shows only newly-due.

### Coverage intent

Core logic + pure glasses logic (`parse`, `scheduler`, `time`, `glyphs`,
`storage`, `render`, `reducer`) target ~full branch coverage — these carry the
correctness risk. UI glue (`phone/authoring`, `glasses/review`, `glasses/imu`) is
verified by manual + simulator runs.

## Out of scope for v1

Anki/CSV file import; deck rename UI; long-card scrolling; images on cards; the
"Hard" (q=3) grade; cross-device/cross-timezone sync beyond what the bridge
persists; undo of a grade.
