export type Grade = 'again' | 'good' | 'easy' // → SM-2 q = 2 | 4 | 5

export interface Card {
  id: string
  front: string
  back: string
  ef: number // ease factor, starts 2.5, floor 1.3
  interval: number // days until next review
  reps: number // consecutive successful reps
  due: number // local-day index when next due; new cards due = today
}

export interface Deck {
  id: string // stable, never changes
  name: string // human display name; renamable
  cards: Card[]
}

export interface DeckMeta {
  id: string
  name: string
}

export interface Envelope<T> {
  schemaVersion: number
  data: T
}
