import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge, LaunchSource } from '@evenrealities/even_hub_sdk'
import { createStorage, type StorageBridge } from './core/storage'
import { runGlasses } from './glasses/review'
import { runPhone } from './phone/authoring'

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
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

// The launch source is pushed once, shortly after load; default to the phone
// screen if it never arrives (e.g. plain browser dev).
function firstLaunchSource(bridge: EvenAppBridge, ms: number): Promise<LaunchSource> {
  return new Promise((resolve) => {
    let done = false
    const finish = (s: LaunchSource) => {
      if (done) return
      done = true
      unsub?.()
      resolve(s)
    }
    const unsub = bridge.onLaunchSource(finish)
    setTimeout(() => finish('appMenu'), ms)
  })
}

// window.localStorage persists across reloads, so the phone UI is fully
// exercisable in a browser during dev.
function browserBridge(): StorageBridge {
  return {
    async setLocalStorage(k, v) {
      try {
        localStorage.setItem(k, v)
        return true
      } catch {
        return false
      }
    },
    async getLocalStorage(k) {
      return localStorage.getItem(k) ?? ''
    },
  }
}

// In a real host (phone/simulator) bridge storage round-trips; with no host it
// either hangs or resolves to undefined, so probe with a write→read and fall
// back to browser storage for dev.
async function pickStorageBridge(bridge: EvenAppBridge): Promise<StorageBridge> {
  try {
    const wrote = await withTimeout(bridge.setLocalStorage('__probe__', 'ok'), 800)
    const read = await withTimeout(bridge.getLocalStorage('__probe__'), 800)
    if (wrote === true && read === 'ok') return bridge
  } catch {
    // fall through
  }
  return browserBridge()
}

async function main() {
  let bridge: EvenAppBridge
  try {
    bridge = await withTimeout(waitForEvenAppBridge(), 5000)
  } catch {
    await runPhone(createStorage(browserBridge()), { dev: true })
    return
  }

  const storage = createStorage(await pickStorageBridge(bridge))
  const source = await firstLaunchSource(bridge, 1500)
  if (source === 'glassesMenu') await runGlasses(bridge, storage)
  else await runPhone(storage, {})
}

void main()
