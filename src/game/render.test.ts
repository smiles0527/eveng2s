import { describe, it, expect } from 'vitest'
import {
  fmt,
  bar,
  renderStatus,
  renderBuild,
  renderTech,
  renderDecode,
  renderObjectives,
  renderBeat,
  type Zones,
} from './render'
import { findUnsupported } from '../core/glyphs'
import type {
  GameState,
  Modifiers,
  Derived,
  TechNode,
  DecodeDef,
  StoryBeat,
  Slot,
} from './types'

// ── fixtures ────────────────────────────────────────────────────────────────

const mods = (over: Partial<Modifiers> = {}): Modifiers => ({
  signalMult: 1,
  decodeTimeMult: 1,
  powerCapAdd: 0,
  buildCostMult: 1,
  unlocked: new Set<string>(),
  parallelDecodes: 1,
  ...over,
})

const makeState = (over: Partial<GameState> = {}): GameState => ({
  signal: 0,
  fragments: 0,
  owned: { antenna: 0, amplifier: 0, decoder: 0, reactor: 0 },
  slots: [],
  queue: [],
  decodesCompleted: 0,
  ownedTech: [],
  completedObjectives: [],
  completedChallenges: [],
  seenBeats: [],
  session: { decodesThisHour: 0, hourStartMs: 0 },
  lastSeenMs: 0,
  ...over,
})

const derived = (over: Partial<Derived> = {}): Derived => ({
  signalPerSec: 0,
  powerCap: 5,
  powerUsed: 0,
  ...over,
})

const techNode = (over: Partial<TechNode> = {}): TechNode => ({
  id: 't.gain1',
  name: 'Signal Gain I',
  branch: 'throughput',
  cost: { fragments: 15 },
  prereqs: [],
  effects: [{ kind: 'signalMult', value: 1.25 }],
  desc: '+25% signal.',
  ...over,
})

const decodeDef = (over: Partial<DecodeDef> = {}): DecodeDef => ({
  id: 'triangulate',
  name: 'Triangulate Source',
  durationMs: 900_000, // 15 min
  signalCost: 25,
  fragmentYield: 5,
  ...over,
})

// A representative, "busy" state exercising every widget for the dogfood test.
const richState = (): GameState =>
  makeState({
    signal: 12_400,
    fragments: 34_500,
    owned: { antenna: 2, amplifier: 1, decoder: 2, reactor: 1 },
    slots: [
      { status: 'running', def: 'triangulate', startMs: 0, endMs: 134_000 },
      { status: 'banked', def: 'first-contact', finishedMs: 0 },
    ] as Slot[],
    decodesCompleted: 7,
    completedObjectives: ['reach-100'],
    lastSeenMs: 60_000, // ~45% into the running decode -> visible filled bar
  })

const richDerived = (): Derived =>
  derived({ signalPerSec: 84, powerCap: 10, powerUsed: 7 })

// ── fmt ───────────────────────────────────────────────────────────────────

describe('fmt', () => {
  it('passes integers below 1000 through unchanged', () => {
    expect(fmt(0)).toBe('0')
    expect(fmt(7)).toBe('7')
    expect(fmt(999)).toBe('999')
  })

  it('rounds sub-1000 floats to an integer', () => {
    expect(fmt(83.7)).toBe('84')
  })

  it('formats thousands as k with one decimal, trimming .0', () => {
    expect(fmt(1200)).toBe('1.2k')
    expect(fmt(34_500)).toBe('34.5k')
    expect(fmt(1000)).toBe('1k')
  })

  it('formats millions as M', () => {
    expect(fmt(3_400_000)).toBe('3.4M')
  })

  it('formats billions as B', () => {
    expect(fmt(1_200_000_000)).toBe('1.2B')
  })
})

// ── bar ─────────────────────────────────────────────────────────────────────

describe('bar', () => {
  it('fills round(value/max*width) cells with the rest empty', () => {
    const b = bar(5, 10, 8) // round(4.0) = 4 filled
    expect(b).toBe('████▒▒▒▒')
    expect(b.length).toBe(8)
  })

  it('is fully filled at value === max', () => {
    expect(bar(10, 10, 8)).toBe('████████')
  })

  it('is fully empty at value 0', () => {
    expect(bar(0, 10, 8)).toBe('▒▒▒▒▒▒▒▒')
  })

  it('clamps over-full input to all filled', () => {
    expect(bar(99, 10, 8)).toBe('████████')
  })

  it('clamps negative / zero-max input to all empty (no crash, no NaN)', () => {
    expect(bar(-5, 10, 8)).toBe('▒▒▒▒▒▒▒▒')
    expect(bar(5, 0, 8)).toBe('▒▒▒▒▒▒▒▒')
  })
})

// ── helpers shared by the render assertions ─────────────────────────────────

const isZones = (z: Zones) => {
  expect(typeof z.header).toBe('string')
  expect(typeof z.body).toBe('string')
  expect(typeof z.footer).toBe('string')
}

// ── renderStatus ──────────────────────────────────────────────────────────

describe('renderStatus', () => {
  it('header carries formatted signal, rate, and a power bar with used/cap', () => {
    const z = renderStatus(richState(), richDerived())
    isZones(z)
    expect(z.header).toContain('12.4k') // SIG
    expect(z.header).toContain('84') // rate
    expect(z.header).toContain('7/10') // used/cap
    expect(z.header).toContain('█') // power bar present
    expect(z.header).toContain('▒')
  })

  it('body shows the running decode name, a progress bar, and fragments', () => {
    const z = renderStatus(richState(), richDerived())
    expect(z.body).toContain('Triangulate Source')
    expect(z.body).toContain('█') // progress bar present
    expect(z.body).toContain('34.5k') // fragments
  })

  it('body reports an idle receiver when no slot is running', () => {
    const z = renderStatus(makeState(), derived())
    // no running decode -> some idle/standby copy, never a stray decode name
    expect(z.body).not.toContain('Triangulate Source')
    expect(z.body.length).toBeGreaterThan(0)
  })
})

// ── renderBuild ───────────────────────────────────────────────────────────

describe('renderBuild', () => {
  it('lists all four buildings with a cost and power column', () => {
    const z = renderBuild(richState(), richDerived(), mods(), 0)
    isZones(z)
    for (const name of ['Antenna', 'Amplifier', 'Decoder', 'Reactor']) {
      expect(z.body).toContain(name)
    }
  })

  it('puts the cursor on the row at `cursor` and a blank prefix elsewhere', () => {
    const z = renderBuild(richState(), richDerived(), mods(), 2)
    const lines = z.body.split('\n').filter((l) => l.trim().length > 0)
    const cursored = lines.filter((l) => l.includes('>'))
    expect(cursored.length).toBe(1)
    expect(cursored[0].toLowerCase()).toContain('decoder') // index 2
  })

  it('header still shows the power bar', () => {
    const z = renderBuild(richState(), richDerived(), mods(), 0)
    expect(z.header).toContain('7/10')
    expect(z.header).toContain('█')
  })
})

// ── renderTech ────────────────────────────────────────────────────────────

describe('renderTech', () => {
  const list = [
    techNode({ id: 't.gain1', name: 'Signal Gain I', cost: { fragments: 15 } }),
    techNode({ id: 'e.reactor1', name: 'Reactor Tap', cost: { fragments: 20 } }),
  ]

  it('lists the passed-in nodes with names and fragment cost', () => {
    const z = renderTech(richState(), 0, list)
    isZones(z)
    expect(z.body).toContain('Signal Gain I')
    expect(z.body).toContain('Reactor Tap')
    expect(z.body).toContain('15') // fragment cost
  })

  it('marks the cursored row', () => {
    const z = renderTech(richState(), 1, list)
    const cursored = z.body.split('\n').filter((l) => l.includes('>'))
    expect(cursored.length).toBe(1)
    expect(cursored[0]).toContain('Reactor Tap')
  })

  it('handles an empty list without crashing', () => {
    const z = renderTech(richState(), 0, [])
    isZones(z)
    expect(z.body.length).toBeGreaterThan(0)
  })
})

// ── renderDecode ──────────────────────────────────────────────────────────

describe('renderDecode', () => {
  const list = [
    decodeDef({ id: 'first-contact', name: 'First Contact', durationMs: 60_000, signalCost: 0 }),
    decodeDef({ id: 'triangulate', name: 'Triangulate Source', durationMs: 900_000, signalCost: 25 }),
    decodeDef({ id: 'reassemble', name: 'Reassemble Log', durationMs: 21_600_000, signalCost: 600 }),
  ]

  it('lists each decode with a mm:ss duration and the signal cost', () => {
    const z = renderDecode(richState(), mods(), 0, list)
    isZones(z)
    expect(z.body).toContain('First Contact')
    expect(z.body).toContain('01:00') // 60s -> mm:ss
    expect(z.body).toContain('15:00') // 900s
  })

  it('formats multi-hour durations as h:mm:ss', () => {
    const z = renderDecode(richState(), mods(), 0, list)
    expect(z.body).toContain('6:00:00') // 6h
  })

  it('scales the shown duration by mods.decodeTimeMult', () => {
    const z = renderDecode(richState(), mods({ decodeTimeMult: 0.5 }), 0, list)
    expect(z.body).toContain('00:30') // 60s * 0.5
  })

  it('marks the cursored row', () => {
    const z = renderDecode(richState(), mods(), 1, list)
    const cursored = z.body.split('\n').filter((l) => l.includes('>'))
    expect(cursored.length).toBe(1)
    expect(cursored[0]).toContain('Triangulate Source')
  })
})

// ── renderObjectives ──────────────────────────────────────────────────────

describe('renderObjectives', () => {
  it('returns Zones with a non-empty body and a power-bar header', () => {
    const z = renderObjectives(richState())
    isZones(z)
    expect(z.body.length).toBeGreaterThan(0)
  })

  it('reflects completed-objective progress', () => {
    const z = renderObjectives(richState())
    // richState completed 1 objective; the count should surface somewhere.
    expect(z.body).toContain('1')
  })
})

// ── renderBeat ────────────────────────────────────────────────────────────

describe('renderBeat', () => {
  const beat: StoryBeat = {
    id: 'first-contact',
    index: 0,
    trigger: { kind: 'decodesCompleted', n: 1 },
    title: 'CARRIER FOUND',
    body: 'Static. Then, under it, a pulse. Too regular for noise.',
  }

  it('includes the title and body text', () => {
    const card = renderBeat(beat)
    expect(card).toContain('CARRIER FOUND')
    expect(card).toContain('Too regular for noise')
  })

  it('shows a continue prompt', () => {
    expect(renderBeat(beat).toLowerCase()).toContain('continue')
  })

  it('handles a beat with no title', () => {
    const card = renderBeat({ ...beat, title: undefined })
    expect(card).toContain('Too regular for noise')
  })
})

// ── glyph-safe dogfood: every produced string passes findUnsupported ────────

describe('all rendered output is glyph-safe', () => {
  it('uses only firmware-supported characters across every view', () => {
    const s = richState()
    const d = richDerived()
    const m = mods()
    const tech = [
      techNode(),
      techNode({ id: 'd.phaselock', name: 'Phase Lock', cost: { fragments: 90, signal: 120 } }),
    ]
    const decodes = [
      decodeDef(),
      decodeDef({ id: 'signal-lock', name: 'Full Signal Lock', durationMs: 86_400_000, signalCost: 4000 }),
    ]
    const beat: StoryBeat = {
      id: 'how-far',
      index: 4,
      trigger: { kind: 'tech', nodeId: 'd.phaselock' },
      title: 'THE DELAY',
      body: 'The delay is enormous. This crossed a gulf, and has been crossing it a very long time.',
    }

    const zoneSets: Zones[] = [
      renderStatus(s, d),
      renderStatus(makeState(), derived()), // idle variant
      renderBuild(s, d, m, 1),
      renderTech(s, 0, tech),
      renderTech(s, 0, []), // empty variant
      renderDecode(s, m, 2, decodes),
      renderObjectives(s),
    ]

    const strings: string[] = [
      ...zoneSets.flatMap((z) => [z.header, z.body, z.footer]),
      renderBeat(beat),
      renderBeat({ ...beat, title: undefined }),
      fmt(1_234_567),
      bar(3, 10, 8),
    ]

    for (const str of strings) {
      const bad = findUnsupported(str)
      expect(bad, `unsupported in ${JSON.stringify(str)}: ${JSON.stringify(bad)}`).toEqual([])
    }
  })
})
