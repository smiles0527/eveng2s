// Shared list selectors used by both the reducer (cursor bounds + actions) and
// the glue (what to render). Keeping them here keeps reducer and render aligned.
import { TECH, isUnlockable } from './tech'
import { DECODES } from './decodes'
import type { GameState, Modifiers, Building, TechNode, DecodeDef } from './types'

export const BUILDINGS: Building[] = ['antenna', 'amplifier', 'decoder', 'reactor']

/** Tech nodes whose prereqs are met and that aren't owned yet. */
export function availableTech(s: GameState): TechNode[] {
  return TECH.filter((n) => !s.ownedTech.includes(n.id) && isUnlockable(n, s.ownedTech))
}

/** Decodes the player may start. Corrupted decodes stay locked until the
 *  decryption tech (effect `unlockDecode 'corrupted'`) is researched. */
export function availableDecodes(_s: GameState, mods: Modifiers): DecodeDef[] {
  return DECODES.filter((d) => !d.corrupted || mods.unlocked.has('corrupted'))
}
