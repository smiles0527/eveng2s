// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Importing ./main runs its bottom IIFE (waitForEvenAppBridge -> runGame). Mock
// the SDK so that handshake never resolves (the IIFE just parks) and the
// container classes are cheap stand-ins. We drive runGame() directly with a
// fake bridge instead of going through the IIFE.
vi.mock('@evenrealities/even_hub_sdk', () => {
  class Box {
    constructor(o: Record<string, unknown> = {}) {
      Object.assign(this, o)
    }
  }
  return {
    waitForEvenAppBridge: () => new Promise(() => {}),
    CreateStartUpPageContainer: Box,
    TextContainerProperty: Box,
    TextContainerUpgrade: Box,
    OsEventTypeList: {
      CLICK_EVENT: 0,
      SCROLL_TOP_EVENT: 1,
      SCROLL_BOTTOM_EVENT: 2,
      DOUBLE_CLICK_EVENT: 3,
      FOREGROUND_ENTER_EVENT: 4,
      FOREGROUND_EXIT_EVENT: 5,
      ABNORMAL_EXIT_EVENT: 6,
      SYSTEM_EXIT_EVENT: 7,
      IMU_DATA_REPORT: 8,
    },
  }
})

import { runGame } from './main'

type Bridge = Parameters<typeof runGame>[0]

function fakeBridge(over: Record<string, unknown> = {}): Bridge {
  return {
    createStartUpPageContainer: vi.fn(async () => 0),
    rebuildPageContainer: vi.fn(async () => true),
    textContainerUpgrade: vi.fn(async () => true),
    setLocalStorage: vi.fn(async () => true),
    getLocalStorage: vi.fn(async () => ''),
    shutDownPageContainer: vi.fn(async () => true),
    onEvenHubEvent: vi.fn(() => () => {}),
    ...over,
  } as unknown as Bridge
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('runGame startup', () => {
  it('paints the page even when storage hangs (no stuck-on-starting)', () => {
    // getLocalStorage never resolves — the exact BLE failure that stranded the
    // app on "Starting Lost Signal..." when the read ran before the first paint.
    const bridge = fakeBridge({ getLocalStorage: vi.fn(() => new Promise<string>(() => {})) })
    void runGame(bridge)
    // createStartUpPageContainer must already have been called — synchronously,
    // before (and independent of) the hanging storage read.
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledTimes(1)
    expect(bridge.getLocalStorage).not.toHaveBeenCalled()
  })

  it('renders after a normal (empty) load', async () => {
    const bridge = fakeBridge()
    await runGame(bridge)
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledTimes(1)
    expect(bridge.textContainerUpgrade).toHaveBeenCalled()
  })
})
