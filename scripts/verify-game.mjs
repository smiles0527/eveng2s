import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const BASE = 'http://127.0.0.1:9898'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const ok = (n, c, d = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }
async function shot(name) {
  const r = await fetch(`${BASE}/api/screenshot/glasses`)
  const b = Buffer.from(await r.arrayBuffer())
  writeFileSync(`shots-game/${name}.png`, b)
  return createHash('sha1').update(b).digest('hex')
}
const input = (a) => fetch(`${BASE}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: a }) }).catch(() => {})
for (let i = 0; i < 40; i++) { try { if ((await (await fetch(`${BASE}/api/ping`)).text()) === 'pong') break } catch {} await sleep(500) }
await sleep(7000) // boot + first render
const h1 = await shot('1-status')
ok('status screen rendered', !!h1)
await sleep(3500)
const h2 = await shot('2-status-later')
ok('live tick: signal accrues (screen changed)', h2 !== h1)
await input('down'); await sleep(900); await shot('3-build')
await input('down'); await sleep(900); await shot('4-tech')
await input('down'); await sleep(900); await shot('5-decode')
await input('click'); await sleep(500); await input('click'); await sleep(1500); await shot('6-decode-started')
await input('double_click'); await sleep(400)
await input('up'); await sleep(400); await input('up'); await sleep(400); await input('up'); await sleep(900)
await shot('7-status-decoding')
const logs = (await (await fetch(`${BASE}/api/console`)).json()).entries ?? []
const errs = logs.filter((e) => e.level === 'error' || /^\[(uncaught|unhandledrejection)\]/.test(e.message))
ok('no console errors', errs.length === 0, errs.map((e) => e.message).slice(0, 3).join(' | '))
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
