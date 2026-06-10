import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge, EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { createGameStore } from './save'
import { newGame, computeMods, derive } from './engine'
import { reduce, initialUi, type UiState, type UiEvent } from './reducer'
import { availableTech, availableDecodes, nextObjective } from './selectors'
import {
  renderStatus,
  renderBuild,
  renderTech,
  renderDecode,
  renderObjectives,
  renderBeat,
  renderIntro,
  type Zones,
} from './render'
import { createInputGate } from '../glasses/input-gate'

const HDR = { id: 1, name: 'hdr', x: 0, y: 0, w: 576, h: 40 }
const BODY = { id: 2, name: 'body', x: 0, y: 40, w: 576, h: 208 } // captures events
const FTR = { id: 3, name: 'ftr', x: 0, y: 248, w: 576, h: 40 }

function tc(c: typeof HDR, capture: 0 | 1, content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: c.x,
    yPosition: c.y,
    width: c.w,
    height: c.h,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: c.id,
    containerName: c.name,
    content,
    isEventCapture: capture,
  })
}

/** Map the UI state to the three on-screen zones. Beats reuse the same zones. */
function zonesFor(ui: UiState): Zones {
  if (!ui.game.seenIntro) return { header: '', body: renderIntro(), footer: '' }
  if (ui.beats.length > 0) return { header: '', body: renderBeat(ui.beats[0]), footer: '' }
  const g = ui.game
  const mods = computeMods(g)
  const d = derive(g, mods)
  const cur = ui.focused ? ui.cursor : -1
  switch (ui.view) {
    case 'status':
      return renderStatus(g, d, nextObjective(g)?.goal ?? null)
    case 'build':
      return renderBuild(g, d, mods, cur)
    case 'tech':
      return renderTech(g, cur, availableTech(g))
    case 'decode':
      return renderDecode(g, mods, cur, availableDecodes(g, mods))
    case 'objectives':
      return renderObjectives(g)
  }
}

// Reject if a promise outruns `ms`. BLE bridge calls can hang ~30s on real
// hardware; startup must never block on one. (The flashcards app guards the
// same way — see src/main.ts.)
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(id)
        resolve(v)
      },
      (e) => {
        clearTimeout(id)
        reject(e)
      },
    )
  })
}

export async function runGame(bridge: EvenAppBridge): Promise<void> {
  // Paint FIRST — establish the page before touching storage, so the app always
  // leaves the launcher splash once the bridge is up. Reading the save before
  // this call would strand the user on "Starting Lost Signal..." whenever the
  // BLE getLocalStorage hangs (the simulator never reproduces that — its storage
  // resolves instantly).
  const created = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [tc(HDR, 0, 'Lost Signal'), tc(BODY, 1, 'Loading...'), tc(FTR, 0, '')],
    }),
  )
  if (created !== 0) {
    console.error('createStartUpPageContainer failed:', created)
    return
  }

  // Then load the save — but never let a slow/flaky read block startup. On
  // timeout or error, start fresh rather than hang.
  const store = createGameStore(bridge)
  const loaded = await withTimeout(store.load(), 2500).catch((e) => {
    console.warn('lostsignal: save load slow/failed; starting fresh', e)
    return null
  })
  let ui: UiState = initialUi(loaded ?? newGame(Date.now()))

  // ---- rendering (diffed; same three containers always → only text upgrades) ----
  let last: Zones = { header: '', body: '', footer: '' }
  const upgrade = (c: typeof HDR, content: string) =>
    bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: c.id, containerName: c.name, content }))
  async function render() {
    const z = zonesFor(ui)
    if (z.header !== last.header) await upgrade(HDR, z.header)
    if (z.body !== last.body) await upgrade(BODY, z.body)
    if (z.footer !== last.footer) await upgrade(FTR, z.footer)
    last = z
  }

  // ---- persistence (debounced + an immediate flush) ----
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const persist = () => {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void store.save(ui.game)
    }, 1000)
  }
  const persistNow = async () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
    await store.save(ui.game)
  }

  let unsub: (() => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const cleanup = () => {
    if (timer) clearInterval(timer)
    unsub?.()
  }

  async function dispatch(ev: UiEvent) {
    const r = reduce(ui, ev)
    ui = r.state
    // A bridge rejection must not abort the rest (esp. a pending persistNow).
    try {
      await render()
    } catch (e) {
      console.error('render failed', e)
    }
    for (const eff of r.effects) {
      try {
        if (eff.type === 'persist') persist()
        else if (eff.type === 'persistNow') await persistNow()
        else if (eff.type === 'exitDialog') await bridge.shutDownPageContainer(1)
        else if (eff.type === 'cleanup') cleanup()
        // 'rebuild' is a no-op: the three containers are fixed, render() already ran
      } catch (e) {
        console.error('effect failed', eff.type, e)
      }
    }
  }

  // ---- input ----
  const startTick = () => {
    if (!timer) timer = setInterval(() => void dispatch({ type: 'tick', now: Date.now() }), 1000)
  }
  const stopTick = () => {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const gate = createInputGate(250)
  unsub = bridge.onEvenHubEvent((event: EvenHubEvent) => {
    const sysType = event.sysEvent ? (event.sysEvent.eventType ?? 0) : -1
    if (sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      // catch up on time elapsed while backgrounded, then resume live ticking
      return void dispatch({ type: 'lifecycle', kind: 'foregroundEnter', now: Date.now() }).then(startTick)
    }
    if (sysType === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
      stopTick() // no bridge calls while backgrounded
      return void dispatch({ type: 'lifecycle', kind: 'foregroundExit', now: Date.now() })
    }
    if (sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) return void dispatch({ type: 'lifecycle', kind: 'abnormalExit', now: Date.now() })
    if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT) return void dispatch({ type: 'lifecycle', kind: 'systemExit', now: Date.now() })
    if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      if (gate.accept(Date.now())) void dispatch({ type: 'back' })
      return
    }
    if (event.textEvent) {
      if (!gate.accept(Date.now())) return
      const t = event.textEvent.eventType ?? 0
      return void dispatch({ type: t === 1 ? 'navUp' : 'navDown' })
    }
    if (event.sysEvent) {
      // single press
      if (gate.accept(Date.now())) void dispatch({ type: 'select' })
    }
  })
  // beforeunload is synchronous — an async save would never flush, so just stop
  // timers/listeners; graceful saves happen on FOREGROUND_EXIT / SYSTEM_EXIT.
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', cleanup)

  // first catch-up advance + initial render, then the live tick
  await dispatch({ type: 'tick', now: Date.now() })
  startTick()
}

// No top-level await (some webviews don't run bundled TLA) — run in an IIFE.
void (async () => {
  const bridge = await waitForEvenAppBridge()
  await runGame(bridge)
})()
