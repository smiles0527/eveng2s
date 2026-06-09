// Lost Signal — pure view rendering. String builders only: no bridge, no DOM,
// no Date.now. Each view returns three zone strings (header/body/footer) laid
// out for the 576x288 mono-green display via the shared pixel-layout helpers.
//
// Every string produced here MUST pass `findUnsupported` (src/core/glyphs.ts):
// bars are block `█`/`▒`, pips are `●`/`○`, arrows `↑↓→`; no `━`, em-dash, or
// `…`. A dogfood test asserts this across a representative state.

import { centerBlock, centerLine, justify } from '../glasses/layout'
import { costOf, POWER } from './economy'
import { decodeById } from './decodes'
import type {
  Building,
  DecodeDef,
  Derived,
  GameState,
  Modifiers,
  Slot,
  StoryBeat,
  TechNode,
} from './types'

export interface Zones {
  header: string
  body: string
  footer: string
}

// ── geometry (matches the flashcard ZONES: three stacked zones over 576x288) ──

const PAD = 4
const SCREEN = { w: 576, h: 288 }
const HEADER_H = 40
const FOOTER_H = 40
const BODY_H = SCREEN.h - HEADER_H - FOOTER_H // 208

const innerW = (w: number) => w - 2 * PAD
const innerH = (h: number) => h - 2 * PAD

const BAR_W = innerW(SCREEN.w) // 568 — header/footer/list rows
const BODY_W = innerW(SCREEN.w) // 568
const BODY_INNER_H = innerH(BODY_H) // 200
const SCREEN_W = innerW(SCREEN.w)
const SCREEN_H = innerH(SCREEN.h)

// Width of the power bar in the header (per design mockup: PWR <8 cells> used/cap).
const PWR_BAR_W = 8
// Width of the active-decode progress bar in the Status body.
const PROGRESS_BAR_W = 18

// The five swipe-cycled views, in ring order (design doc "Views & navigation").
const VIEW_COUNT = 5
type ViewIndex = 0 | 1 | 2 | 3 | 4 // Status, Build, Tech, Decode, Objectives

// ── number & widget formatting ───────────────────────────────────────────────

/** Compact number: <1000 as a rounded integer, else 1.2k / 34.5k / 3.4M / 1.2B
 *  with one decimal, trailing `.0` trimmed. Negatives keep their sign. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const neg = n < 0
  const abs = Math.abs(n)
  let out: string
  if (abs < 1000) {
    out = String(Math.round(abs))
  } else {
    const units: Array<[number, string]> = [
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'k'],
    ]
    const [div, suffix] = units.find(([d]) => abs >= d)!
    out = trimDecimal((abs / div).toFixed(1)) + suffix
  }
  return neg ? `-${out}` : out
}

/** '1.0' -> '1', '1.2' -> '1.2'. Only trims a `.0` tail, never other digits. */
function trimDecimal(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** A glyph-safe progress bar: `█`*filled + `▒`*empty, filled = round(ratio*width)
 *  with the ratio clamped to [0,1]. Guards a non-positive max (renders empty)
 *  so it never produces NaN or a negative repeat count. */
export function bar(value: number, max: number, width: number): string {
  const w = Math.max(0, Math.floor(width))
  let ratio = max > 0 ? value / max : 0
  if (!Number.isFinite(ratio) || ratio < 0) ratio = 0
  if (ratio > 1) ratio = 1
  const filled = Math.min(w, Math.max(0, Math.round(ratio * w)))
  return '█'.repeat(filled) + '▒'.repeat(w - filled)
}

/** Whole seconds -> `mm:ss` (under an hour) or `h:mm:ss` (an hour or more).
 *  Minutes/seconds are zero-padded; the hour field is not. Clamps negatives. */
function clock(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

// ── shared chrome ─────────────────────────────────────────────────────────────

/** Header used by every view except the beat card: SIG + rate on the left,
 *  PWR bar + used/cap on the right. */
function header(s: GameState, d: Derived): string {
  const left = `SIG ${fmt(s.signal)}  +${fmt(d.signalPerSec)}/s`
  const used = Math.round(d.powerUsed)
  const cap = Math.round(d.powerCap)
  const right = `PWR ${bar(used, cap, PWR_BAR_W)} ${used}/${cap}`
  return justify(left, right, BAR_W)
}

/** `●` for the active view, `○` for the rest, plus the view label on the left. */
function tabs(active: ViewIndex, label: string): string {
  let pips = ''
  for (let i = 0; i < VIEW_COUNT; i++) pips += i === active ? '●' : '○'
  return `${label} ${pips}`
}

const HINT_BROWSE = '↑↓ views  ● open'
const HINT_FOCUSED = '↑↓ move  ● act  ●● back'

/** Footer = tab indicator (left) + gesture hint (right). `focused` picks the
 *  list-navigation hint over the view-cycling hint. */
function footer(active: ViewIndex, label: string, focused: boolean): string {
  return justify(tabs(active, label), focused ? HINT_FOCUSED : HINT_BROWSE, BAR_W)
}

/** One left-aligned list row: a fixed 2-char cursor gutter (`> ` / `  `, so the
 *  name column never shifts) folded into the left token, with `right` pushed to
 *  the edge by `justify` across the full inner width. The name is char-capped so
 *  a pathological label can't blow past the ~568px line (the firmware font is
 *  proportional; 40 chars sits comfortably inside, leaving room for the right
 *  column which `justify` keeps a one-space margin from the edge). */
function row(name: string, right: string, selected: boolean): string {
  const cursor = selected ? '> ' : '  '
  return justify(cursor + clamp(name, 40), right, BAR_W)
}

function clamp(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1) + '.'
}

function rowsBlock(lines: string[]): string {
  return lines.length ? lines.join('\n') : centerLine('(nothing here)', BODY_W)
}

// ── views ─────────────────────────────────────────────────────────────────────

/** Status / HQ: vitals header, the active decode (name + progress + remaining)
 *  or an idle line, then a couple of resource counts. */
export function renderStatus(s: GameState, d: Derived, nextGoal: string | null = null): Zones {
  const lines: string[] = []
  const active = s.slots.find((x): x is Extract<Slot, { status: 'running' }> => x.status === 'running')
  const banked = s.slots.filter((x) => x.status === 'banked').length

  if (active) {
    const total = Math.max(1, active.endMs - active.startMs)
    const elapsed = Math.min(total, Math.max(0, s.lastSeenMs - active.startMs))
    const remainingS = Math.ceil((total - elapsed) / 1000)
    lines.push(`DECODING ${decodeName(active.def)}`)
    lines.push(`${bar(elapsed, total, PROGRESS_BAR_W)}  ${clock(remainingS)} left`)
  } else {
    lines.push('RECEIVER IDLE')
    lines.push('Swipe to Decode, press to listen') // tells a new player how to start
  }
  if (nextGoal) lines.push(`Next: ${nextGoal}`)
  lines.push('')
  lines.push(`Fragments ${fmt(s.fragments)}   Banked ${banked}`)
  lines.push(`Antennas ${s.owned.antenna}   Decoders ${s.owned.decoder}`)

  return {
    header: header(s, d),
    body: centerBlock(lines.join('\n'), BODY_W, BODY_INNER_H),
    footer: footer(0, 'Status', false),
  }
}

/** Build: the four buildings with cost (signal) + power draw + a cursor. */
export function renderBuild(s: GameState, d: Derived, mods: Modifiers, cursor: number): Zones {
  const order: Building[] = ['antenna', 'amplifier', 'decoder', 'reactor']
  const lines = order.map((b, i) => {
    const cost = costOf(b, s.owned[b], mods)
    const right = `${fmt(cost)} sig  ${POWER[b]} pwr`
    return row(`${title(b)} x${s.owned[b]}`, right, i === cursor)
  })
  return {
    header: header(s, d),
    body: rowsBlock(lines),
    footer: footer(1, 'Build', cursor >= 0),
  }
}

/** Tech: the already-filtered available nodes, with fragment (+signal) cost. */
export function renderTech(s: GameState, cursor: number, list: TechNode[]): Zones {
  const lines = list.map((n, i) => {
    const sig = n.cost.signal ? ` +${fmt(n.cost.signal)}s` : ''
    const right = `${fmt(n.cost.fragments)}f${sig}`
    return row(n.name, right, i === cursor)
  })
  return {
    header: resourceHeader(s),
    body: rowsBlock(lines),
    footer: footer(2, 'Tech', cursor >= 0),
  }
}

/** Decode: each target with its (mod-scaled) duration + signal cost. */
export function renderDecode(s: GameState, mods: Modifiers, cursor: number, list: DecodeDef[]): Zones {
  const lines = list.map((def, i) => {
    const durMs = def.durationMs * mods.decodeTimeMult
    const right = `${clock(durMs / 1000)}  ${fmt(def.signalCost)} sig`
    return row(def.name, right, i === cursor)
  })
  return {
    header: resourceHeader(s),
    body: rowsBlock(lines),
    footer: footer(3, 'Decode', cursor >= 0),
  }
}

/** Objectives: a compact progress summary (counts of what's been earned). */
export function renderObjectives(s: GameState): Zones {
  const lines = [
    'OBJECTIVES',
    '',
    `Completed ${s.completedObjectives.length}`,
    `Challenges ${s.completedChallenges.length}`,
    `Decodes ${fmt(s.decodesCompleted)}`,
  ]
  return {
    header: resourceHeader(s),
    body: centerBlock(lines.join('\n'), BODY_W, BODY_INNER_H),
    footer: footer(4, 'Goals', false),
  }
}

/** Full-screen modal story card: title + body + a continue prompt, centered. */
export function renderBeat(beat: StoryBeat): string {
  const parts = [beat.title ?? 'SIGNAL', '', beat.body, '', 'tap to continue']
  return centerBlock(parts.join('\n'), SCREEN_W, SCREEN_H)
}

/** First-run intro: premise + controls + a start prompt, centered full-screen.
 *  ASCII/glyph-safe; reuses the same modal path as story beats. */
export function renderIntro(): string {
  const parts = [
    'LOST SIGNAL',
    '',
    'A dead receiver stirs. Something is',
    'transmitting in the static.',
    'Build signal. Decode the message.',
    '',
    'swipe = move   press = open',
    'double-press = back',
    '',
    'press to begin',
  ]
  return centerBlock(parts.join('\n'), SCREEN_W, SCREEN_H)
}

// ── small helpers ─────────────────────────────────────────────────────────────

const BUILDING_TITLES: Record<Building, string> = {
  antenna: 'Antenna',
  amplifier: 'Amplifier',
  decoder: 'Decoder',
  reactor: 'Reactor',
}

function title(b: Building): string {
  return BUILDING_TITLES[b]
}

// Tech/Decode/Objectives don't receive a `Derived` (their costs are paid in the
// resources they show), so they get a resource header — signal left, fragments
// right — rather than a misleading zeroed power bar. The full vitals header
// (with the live rate + power bar) is reserved for Status and Build, which carry
// a real `Derived`.
function resourceHeader(s: GameState): string {
  return justify(`SIG ${fmt(s.signal)}`, `FRAG ${fmt(s.fragments)}`, BAR_W)
}

/** Resolve a decode id to its catalogue display name; humanize the id as a
 *  fallback so an unknown/removed id still renders a readable label. */
function decodeName(id: string): string {
  const def = decodeById(id)
  if (def) return def.name
  return id
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}
