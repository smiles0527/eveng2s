import { describe, it, expect } from 'vitest'
import { nextObjective, availableDecodes, availableTech, BUILDINGS } from './selectors'
import { newGame } from './engine'
import type { GameState, Modifiers } from './types'

const game = (over: Partial<GameState> = {}): GameState => ({ ...newGame(0), ...over })
const mods = (over: Partial<Modifiers> = {}): Modifiers => ({
  signalMult: 1,
  decodeTimeMult: 1,
  powerCapAdd: 0,
  buildCostMult: 1,
  unlocked: new Set(),
  parallelDecodes: 0,
  ...over,
})

describe('nextObjective', () => {
  it('points a fresh game at the first decode', () => {
    expect(nextObjective(game())?.goal).toBe('Start your first decode')
  })
  it('advances to the next uncompleted objective in order', () => {
    const g = game({ completedObjectives: ['o.firstDecode'] })
    expect(nextObjective(g)?.id).toBe('o.antennas10')
  })
  it('is null once every objective is complete', () => {
    const g = game({ completedObjectives: ['o.firstDecode', 'o.antennas10', 'o.signal100', 'o.fragments50', 'o.reactor'] })
    expect(nextObjective(g)).toBeNull()
  })
  it('every objective has a goal string', () => {
    let g = game()
    // walk through them all; each surfaced objective must carry a goal
    const seen = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const o = nextObjective(g)
      if (!o) break
      expect(o.goal && o.goal.length).toBeGreaterThan(0)
      seen.add(o.id)
      g = game({ completedObjectives: [...seen] })
    }
    expect(seen.size).toBe(5)
  })
})

describe('availableDecodes — corrupted gate', () => {
  it('hides corrupted decodes until the tech is unlocked', () => {
    const locked = availableDecodes(game(), mods())
    expect(locked.some((d) => d.corrupted)).toBe(false)
    const unlocked = availableDecodes(game(), mods({ unlocked: new Set(['corrupted']) }))
    expect(unlocked.some((d) => d.corrupted)).toBe(true)
  })
})

describe('availableTech / BUILDINGS', () => {
  it('a fresh game exposes only root tech nodes', () => {
    const list = availableTech(game())
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((n) => n.prereqs.length === 0)).toBe(true)
  })
  it('lists the four buildings', () => {
    expect(BUILDINGS).toEqual(['antenna', 'amplifier', 'decoder', 'reactor'])
  })
})
