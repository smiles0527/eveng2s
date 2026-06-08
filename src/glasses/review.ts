import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  ImuReportPace,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge, EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { Storage } from '../core/storage'
import type { Card, Deck } from '../core/types'
import { todayLocal } from '../core/time'
import { reduce, initialState, type ReviewState, type ReviewEvent } from './reducer'
import { renderReview, renderDone, renderWelcome, ZONES, SCREEN } from './render'
import { createGestureDetector } from './imu'
import { createInputGate } from './input-gate'

const PAD = 4
const WELCOME = { id: 1, name: 'welcome' }
const HEADER = { id: 1, name: 'header' }
const BODY = { id: 2, name: 'body' } // captures events
const FOOTER = { id: 3, name: 'footer' }

type Box = { x: number; y: number; w: number; h: number }

function textContainer(
  id: number,
  name: string,
  box: Box,
  capture: 0 | 1,
  content: string,
): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: box.x,
    yPosition: box.y,
    width: box.w,
    height: box.h,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: PAD,
    containerID: id,
    containerName: name,
    content,
    isEventCapture: capture,
  })
}

const welcomeContainer = () =>
  textContainer(WELCOME.id, WELCOME.name, { x: 0, y: 0, w: SCREEN.w, h: SCREEN.h }, 1, renderWelcome())

const reviewContainers = () => [
  textContainer(HEADER.id, HEADER.name, ZONES.header, 0, ''),
  textContainer(BODY.id, BODY.name, ZONES.body, 1, 'Loading...'),
  textContainer(FOOTER.id, FOOTER.name, ZONES.footer, 0, ''),
]

export async function runGlasses(bridge: EvenAppBridge, storage: Storage): Promise<void> {
  const onboarded = await storage.getOnboarded()

  const first = onboarded ? reviewContainers() : [welcomeContainer()]
  const created = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: first.length, textObject: first }),
  )
  if (created !== 0) {
    console.error('createStartUpPageContainer failed with code', created)
    return
  }

  let state = initialState
  let layout: 'welcome' | 'review' = onboarded ? 'review' : 'welcome'
  let deck: Deck | null = null
  const detector = createGestureDetector()
  let unsub: (() => void) | undefined

  const deckName = () => deck?.name ?? 'Cards'

  function upgrade(id: number, name: string, content: string) {
    return bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: id, containerName: name, content }),
    )
  }

  async function render() {
    if (state.phase === 'welcome' || state.phase === 'loading') return // static welcome / nothing yet
    if (layout === 'welcome') {
      await bridge.rebuildPageContainer(
        new RebuildPageContainer({ containerTotalNum: 3, textObject: reviewContainers() }),
      )
      layout = 'review'
    }
    const z = state.phase === 'done' ? renderDone(state) : renderReview(state, deckName())
    await upgrade(HEADER.id, HEADER.name, z.header)
    await upgrade(BODY.id, BODY.name, z.body)
    await upgrade(FOOTER.id, FOOTER.name, z.footer)
  }

  async function persist(card: Card) {
    if (!deck) return
    deck = { ...deck, cards: deck.cards.map((c) => (c.id === card.id ? card : c)) }
    const ok = await storage.saveDeck(deck)
    if (!ok) console.error('saveDeck failed for card', card.id)
  }

  function cleanup() {
    bridge.imuControl(false).catch(() => {})
    unsub?.()
  }

  async function dispatch(event: ReviewEvent) {
    const res = reduce(state, event, todayLocal())
    state = res.state
    await render()
    for (const eff of res.effects) {
      if (eff.type === 'persist') await persist(eff.card)
      else if (eff.type === 'markOnboarded') await storage.setOnboarded()
      else if (eff.type === 'exitDialog') await bridge.shutDownPageContainer(1)
      else if (eff.type === 'cleanup') cleanup()
    }
  }

  // Collapse a burst of events from one physical gesture (a simulator scroll
  // swipe fires many) into a single action, so a flip can't cascade into a grade.
  const inputGate = createInputGate(250)
  const gate = () => inputGate.accept(Date.now())

  function handle(event: EvenHubEvent) {
    const sysType = event.sysEvent ? (event.sysEvent.eventType ?? 0) : -1

    // IMU stream (back side only)
    if (sysType === OsEventTypeList.IMU_DATA_REPORT) {
      if (state.phase === 'back' && event.sysEvent?.imuData) {
        const { x = 0, y = 0, z = 0 } = event.sysEvent.imuData
        const g = detector.feed({ x, y, z }, Date.now())
        if (g) void dispatch({ type: 'grade', grade: g })
      }
      return
    }
    // Lifecycle
    if (sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT) return void dispatch({ type: 'lifecycle', kind: 'foregroundEnter' })
    if (sysType === OsEventTypeList.FOREGROUND_EXIT_EVENT) return void dispatch({ type: 'lifecycle', kind: 'foregroundExit' })
    if (sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) return void dispatch({ type: 'lifecycle', kind: 'abnormalExit' })
    if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT) return void dispatch({ type: 'lifecycle', kind: 'systemExit' })
    // Double press = exit, from anywhere
    if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT) return void dispatch({ type: 'exit' })

    // Welcome: any single input begins the session
    if (state.phase === 'welcome') {
      if (gate()) void dispatch({ type: 'dismissWelcome' })
      return
    }
    // Swipes: up/down
    if (event.textEvent) {
      if (!gate()) return
      const t = event.textEvent.eventType ?? 0
      if (state.phase === 'front') void dispatch({ type: 'flip' })
      else if (state.phase === 'back') void dispatch({ type: 'grade', grade: t === 1 ? 'easy' : 'again' })
      return
    }
    // Single press
    if (event.sysEvent) {
      if (!gate()) return
      if (state.phase === 'front') void dispatch({ type: 'flip' })
      else if (state.phase === 'back') void dispatch({ type: 'grade', grade: 'good' })
    }
  }

  unsub = bridge.onEvenHubEvent(handle)
  window.addEventListener('beforeunload', cleanup)
  bridge.imuControl(true, ImuReportPace.P500).catch(() => {})

  const today = todayLocal()
  const activeId = await storage.getActiveDeckId()
  deck = activeId ? await storage.loadDeck(activeId) : null
  const due = deck ? shuffle(deck.cards.filter((c) => c.due <= today)) : []
  const nextDue = deck ? nextDueInDays(deck.cards, today) : null
  await dispatch({ type: 'loaded', due, nextDueInDays: nextDue, showWelcome: !onboarded })
}

function nextDueInDays(cards: Card[], today: number): number | null {
  const future = cards.map((c) => c.due).filter((d) => d > today)
  return future.length ? Math.min(...future) - today : null
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
