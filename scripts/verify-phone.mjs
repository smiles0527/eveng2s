import { chromium } from 'playwright'

const URL = 'http://localhost:5173'
const results = []
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(URL)
await page.waitForSelector('#deckSel', { timeout: 15000 })
ok('phone screen renders (deck selector present)', true)

// auto-created default deck
const deckCount = await page.locator('#deckSel option').count()
ok('a default deck exists on first run', deckCount >= 1, `${deckCount} deck(s)`)

// paste: 2 clean, 1 malformed (no separator), 1 with an unsupported glyph (λ)
await page.fill(
  '#paste',
  ['eigenvector | Av = lambda v', 'rank | independent rows', 'no separator here', 'λ-term | beta reduction'].join(
    '\n',
  ),
)
await page.click('#save')
await page.waitForFunction(() => document.querySelector('#pasteMsg')?.textContent?.includes('Added'))
const msg = await page.textContent('#pasteMsg')
ok('paste reports added/skipped/flagged', msg.includes('Added 3') && msg.includes('1 skipped') && msg.includes('glyph'), msg)

const countText = () => page.textContent('#count')
ok('card count is 3 after paste', (await countText()) === '(3)', await countText())
ok('a glyph warning badge is shown', (await page.locator('.warn').count()) === 1)

// persistence across reload
await page.reload()
await page.waitForSelector('#deckSel', { timeout: 15000 })
ok('cards persist across reload', (await countText()) === '(3)', await countText())

// quick add
await page.fill('#qf', 'capital of Peru')
await page.fill('#qb', 'Lima')
await page.click('#qadd')
await page.waitForFunction(() => document.querySelector('#count')?.textContent === '(4)')
ok('quick-add appends a card', (await countText()) === '(4)')

// delete
await page.locator('.del').first().click()
await page.waitForFunction(() => document.querySelector('#count')?.textContent === '(3)')
ok('delete removes a card', (await countText()) === '(3)')

ok('no page/console errors', errors.length === 0, errors.join(' | '))

await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
