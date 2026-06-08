import './authoring-web.css'
import { parse } from '../src/core/parse'
import { serializeCards, deckNameFromFilename } from '../src/core/deck-file'
import { validateCard } from '../src/core/glyphs'

interface DraftCard {
  front: string
  back: string
}
interface Draft {
  name: string
  cards: DraftCard[]
}

const STORE_KEY = 'deckbuilder.draft'

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const d = JSON.parse(raw) as Draft
      if (typeof d?.name === 'string' && Array.isArray(d.cards)) return d
    }
  } catch {
    // ignore corrupt draft
  }
  return { name: 'My Deck', cards: [] }
}

let draft = loadDraft()
const save = () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(draft))
  } catch {
    // storage full / disabled — non-fatal for authoring
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'deck'

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = el('a', { href: url, download: filename })
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

document.querySelector('#app')!.innerHTML = `
  <main class="app">
    <header>
      <h1>Deck Builder</h1>
      <p class="sub">Build a flashcard deck here, export a <code>.txt</code>, then Import it in the phone app.</p>
    </header>

    <label class="field">
      <span>Deck name</span>
      <input id="name" autocomplete="off" />
    </label>

    <section class="panel">
      <textarea id="paste" rows="4" placeholder="Paste cards — one per line:
front | back        (| or Tab separates the two sides)"></textarea>
      <div class="row">
        <button id="addPaste" class="accent">Add from paste</button>
        <span id="pasteMsg" class="msg"></span>
      </div>
    </section>

    <section class="panel">
      <div class="toolbar">
        <span id="stats" class="stats"></span>
        <span class="spacer"></span>
        <button id="addRow" class="ghost">Add card</button>
        <button id="open" class="ghost">Open file</button>
        <input id="openFile" type="file" accept=".txt,.csv,text/plain" hidden />
        <button id="export" class="accent">Export .txt</button>
        <button id="clear" class="danger">Clear all</button>
      </div>
      <ol id="rows" class="rows"></ol>
    </section>
  </main>`

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!
const nameInput = $<HTMLInputElement>('#name')
const paste = $<HTMLTextAreaElement>('#paste')
const pasteMsg = $('#pasteMsg')
const rows = $<HTMLOListElement>('#rows')
const stats = $('#stats')
const openInput = $<HTMLInputElement>('#openFile')

nameInput.value = draft.name
nameInput.oninput = () => {
  draft.name = nameInput.value
  save()
}

function updateStats() {
  const flagged = draft.cards.filter((c) => !validateCard(c).ok).length
  stats.textContent =
    `${draft.cards.length} card${draft.cards.length === 1 ? '' : 's'}` +
    (flagged ? ` · ${flagged} with characters the glasses can't show` : '')
  stats.classList.toggle('has-warning', flagged > 0)
}

function warningFor(card: DraftCard): string | null {
  const v = validateCard(card)
  if (v.ok) return null
  const bad = [...new Set([...v.front, ...v.back].map((u) => u.char))].join(' ')
  return `Won't display on the glasses: ${bad}`
}

function renderRows() {
  rows.innerHTML = ''
  if (draft.cards.length === 0) {
    const li = el('li', { class: 'empty' })
    li.textContent = 'No cards yet — paste above or add a card.'
    rows.append(li)
    return
  }
  draft.cards.forEach((card, i) => {
    const li = el('li', { class: 'cardrow' })

    const front = el('input', { class: 'front', placeholder: 'front', value: '' }) as HTMLInputElement
    const back = el('input', { class: 'back', placeholder: 'back', value: '' }) as HTMLInputElement
    front.value = card.front
    back.value = card.back

    const warn = el('span', { class: 'warn' })
    const applyWarn = () => {
      const w = warningFor(draft.cards[i])
      warn.textContent = w ? '⚠' : ''
      warn.title = w ?? ''
    }
    applyWarn()

    front.oninput = () => {
      draft.cards[i].front = front.value
      applyWarn()
      updateStats()
      save()
    }
    back.oninput = () => {
      draft.cards[i].back = back.value
      applyWarn()
      updateStats()
      save()
    }

    const up = el('button', { class: 'icon', title: 'Move up', 'aria-label': 'Move up' })
    up.textContent = '↑'
    up.disabled = i === 0
    up.onclick = () => move(i, -1)

    const down = el('button', { class: 'icon', title: 'Move down', 'aria-label': 'Move down' })
    down.textContent = '↓'
    down.disabled = i === draft.cards.length - 1
    down.onclick = () => move(i, 1)

    const del = el('button', { class: 'icon danger', title: 'Delete', 'aria-label': 'Delete' })
    del.textContent = '✕'
    del.onclick = () => {
      draft.cards.splice(i, 1)
      renderRows()
      updateStats()
      save()
    }

    li.append(front, back, warn, up, down, del)
    rows.append(li)
  })
}

function move(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= draft.cards.length) return
  ;[draft.cards[i], draft.cards[j]] = [draft.cards[j], draft.cards[i]]
  renderRows()
  save()
}

$('#addPaste').onclick = () => {
  const { cards, skipped } = parse(paste.value)
  if (cards.length === 0) {
    pasteMsg.textContent = skipped ? `No cards added (${skipped} skipped)` : 'Nothing to add'
    return
  }
  const flagged = cards.filter((c) => !validateCard(c).ok).length
  draft.cards.push(...cards.map((c) => ({ front: c.front, back: c.back })))
  paste.value = ''
  pasteMsg.textContent =
    `Added ${cards.length}` +
    (skipped ? `, ${skipped} skipped` : '') +
    (flagged ? `, ${flagged} flagged` : '')
  renderRows()
  updateStats()
  save()
}

$('#addRow').onclick = () => {
  draft.cards.push({ front: '', back: '' })
  renderRows()
  updateStats()
  save()
  rows.querySelector<HTMLInputElement>('.cardrow:last-child .front')?.focus()
}

$('#export').onclick = () => {
  if (draft.cards.length === 0) {
    pasteMsg.textContent = 'Nothing to export yet'
    return
  }
  download(`${slug(draft.name)}.txt`, serializeCards(draft.cards))
}

$('#open').onclick = () => openInput.click()
openInput.onchange = async () => {
  const file = openInput.files?.[0]
  if (!file) return
  const { cards } = parse(await file.text())
  openInput.value = ''
  draft = { name: deckNameFromFilename(file.name), cards: cards.map((c) => ({ front: c.front, back: c.back })) }
  nameInput.value = draft.name
  renderRows()
  updateStats()
  save()
  pasteMsg.textContent = `Opened "${draft.name}" (${draft.cards.length} cards)`
}

$('#clear').onclick = () => {
  if (draft.cards.length > 0 && !confirm('Clear all cards in this draft?')) return
  draft.cards = []
  renderRows()
  updateStats()
  save()
}

renderRows()
updateStats()
