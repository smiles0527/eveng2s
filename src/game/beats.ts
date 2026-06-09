// Lost Signal — narrative story beats (pure). v1 is strictly linear: you advance
// the story by playing, not by choosing. Each beat is shown once, keyed on id.
//
// All title/body text is ASCII-only and firmware-glyph-safe ("..." not the
// ellipsis char, straight quotes, "-" not an em-dash); beats.test.ts asserts
// this against findUnsupported plus the structural invariants. Content is a
// frozen `as const` array compiled into the build (offline, type-checked,
// glyph-tested).

import type { StoryBeat, BeatTrigger } from './types'

export interface BeatSnapshot {
  decodesCompleted: number
  signalRate: number
  ownedTech: string[]
}

/** The 8 "Lost Signal" beats, index 0..7. Arc: noise -> pattern -> a person ->
 *  who she was -> how impossibly far -> her true intent -> the turn (it sought
 *  you) -> a v1 cliffhanger (transmit capability). All beats gate on decode
 *  count (a single monotonic axis) so the linear gate always advances in order
 *  and no earned beat is ever stranded behind a harder-to-reach trigger. */
export const BEATS: readonly StoryBeat[] = [
  {
    id: 'first-contact',
    index: 0,
    trigger: { kind: 'decodesCompleted', n: 1 },
    title: 'CARRIER FOUND',
    body: 'Static. Then, under it, a pulse. Steady. Too regular for noise. Something is still transmitting on a dead band.',
  },
  {
    id: 'the-loop',
    index: 1,
    trigger: { kind: 'decodesCompleted', n: 3 },
    title: 'IT REPEATS',
    body: "The same burst, over and over. A loop... First fragment: '. . . IF YOU CAN HEAR . . .'",
  },
  {
    id: 'a-voice',
    index: 2,
    trigger: { kind: 'decodesCompleted', n: 5 },
    title: 'A VOICE',
    body: "Not a beacon. A person. '...if you can hear this, the relay held. I am still here. I think.'",
  },
  {
    id: 'her-name',
    index: 3,
    trigger: { kind: 'decodesCompleted', n: 8 },
    title: 'KESS',
    body: "A name surfaces: KESS. A station log, a launch, then silence. 'The others slept and did not wake. I kept the signal up.'",
  },
  {
    id: 'how-far',
    index: 4,
    trigger: { kind: 'decodesCompleted', n: 11 },
    title: 'THE DELAY',
    body: 'Phase-lock resolves the timing. The delay is enormous. This crossed a gulf, and has been crossing it a very long time.',
  },
  {
    id: 'not-a-call',
    index: 5,
    trigger: { kind: 'decodesCompleted', n: 15 },
    title: 'NOT A DISTRESS CALL',
    body: "'I am not asking for rescue. There is no rescue. I am asking you to remember that we were here.'",
  },
  {
    id: 'the-coords',
    index: 6,
    trigger: { kind: 'decodesCompleted', n: 20 },
    title: 'COORDINATES',
    body: 'Buried in the carrier: a position. Yours. The loop was aimed. It was pointed at you. It was waiting.',
  },
  {
    id: 'still-here',
    index: 7,
    trigger: { kind: 'decodesCompleted', n: 25 },
    title: 'REPLY?',
    body: "'You are listening now. I can feel the lock. So tell me - are you still out there too?' [ the receiver can transmit ]",
  },
] as const

/** Whether a single trigger is satisfied by the current snapshot. Numeric
 *  thresholds are inclusive (>=); tech is satisfied when the node is owned. */
export function triggerMet(t: BeatTrigger, snap: BeatSnapshot): boolean {
  switch (t.kind) {
    case 'decodesCompleted':
      return snap.decodesCompleted >= t.n
    case 'signalRate':
      return snap.signalRate >= t.value
    case 'tech':
      return snap.ownedTech.includes(t.nodeId)
  }
}

/** Linear gate. Walk BEATS in index order; collect every unseen beat whose
 *  trigger is met, and BREAK at the first unseen beat whose trigger is NOT met
 *  (so the story can never skip ahead). Crossing several thresholds at once
 *  queues every now-eligible beat, in order. Does not mutate `seen`. */
export function pendingBeats(seen: string[], snap: BeatSnapshot): StoryBeat[] {
  const seenSet = new Set(seen)
  const out: StoryBeat[] = []
  for (const beat of BEATS) {
    if (seenSet.has(beat.id)) continue
    if (!triggerMet(beat.trigger, snap)) break
    out.push(beat)
  }
  return out
}
