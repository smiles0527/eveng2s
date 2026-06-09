// Shared list selectors used by both the reducer (cursor bounds + actions) and
// the glue (what to render). Keeping them here keeps reducer and render aligned.
import { TECH, isUnlockable } from './tech'
import { DECODES } from './decodes'
import { OBJECTIVES } from './objectives'
import type { GameState, Modifiers, Building, TechNode, DecodeDef, Objective } from './types'

export const BUILDINGS: Building[] = ['antenna', 'amplifier', 'decoder', 'reactor']

/** The first uncompleted objective, in onboarding order — drives the on-screen
 *  "Next:" prompt. Null once every objective is done. */
export function nextObjective(s: GameState): Objective | null {
  return OBJECTIVES.find((o) => !s.completedObjectives.includes(o.id)) ?? null
}

/** Tech nodes whose prereqs are met and that aren't owned yet. */
export function availableTech(s: GameState): TechNode[] {
  return TECH.filter((n) => !s.ownedTech.includes(n.id) && isUnlockable(n, s.ownedTech))
}

/** Decodes the player may start. Corrupted decodes stay locked until the
 *  decryption tech (effect `unlockDecode 'corrupted'`) is researched. */
export function availableDecodes(_s: GameState, mods: Modifiers): DecodeDef[] {
  return DECODES.filter((d) => !d.corrupted || mods.unlocked.has('corrupted'))
}
