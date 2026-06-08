import './authoring.css'
import type { Storage } from '../core/storage'
import type { Card } from '../core/types'
import { parse } from '../core/parse'
import { validateCard } from '../core/glyphs'
import { newCardState } from '../core/scheduler'
import { todayLocal } from '../core/time'
import { deckNameFromFilename } from '../core/deck-file'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

function newCard(front: string, back: string): Card {
  return { id: crypto.randomUUID(), front, back, due: todayLocal(), ...newCardState() }
}

export async function runPhone(storage: Storage, opts: { dev?: boolean } = {}): Promise<void> {
  let decks = await storage.listDecks()
  if (decks.length === 0) {
    const created = await storage.createDeck('My Deck')
    decks = await storage.listDecks()
    if (decks.length === 0) decks = [created] // tolerate flaky persistence
  }
  let activeId = (await storage.getActiveDeckId()) ?? decks[0].id
  await storage.setActiveDeckId(activeId)

  document.body.className = 'phone'
  document.body.innerHTML = `
    <main class="app">
      <header>
        <h1>Flashcards</h1>
        ${opts.dev ? '<span class="dev">browser dev — saved to localStorage</span>' : ''}
      </header>
      <section class="deckbar">
        <select id="deckSel" aria-label="Deck"></select>
        <button id="newDeck" class="ghost">New deck</button>
        <button id="importBtn" class="ghost">Import file</button>
        <input id="importFile" type="file" accept=".txt,.csv,text/plain" hidden />
      </section>
      <section class="card add">
        <textarea id="paste" rows="4" placeholder="front | back&#10;one card per line ( | or Tab )"></textarea>
        <div class="row">
          <button id="save" class="accent">Save pasted</button>
          <span id="pasteMsg" class="msg"></span>
        </div>
        <div class="quick">
          <input id="qf" placeholder="front" />
          <input id="qb" placeholder="back" />
          <button id="qadd" class="ghost">Add</button>
        </div>
      </section>
      <section class="card list">
        <h2>Cards <span id="count" class="dim"></span></h2>
        <ul id="cards"></ul>
      </section>
    </main>`

  const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!
  const deckSel = $<HTMLSelectElement>('#deckSel')
  const paste = $<HTMLTextAreaElement>('#paste')
  const pasteMsg = $('#pasteMsg')
  const qf = $<HTMLInputElement>('#qf')
  const qb = $<HTMLInputElement>('#qb')
  const cardsUl = $<HTMLUListElement>('#cards')
  const count = $('#count')

  async function refresh() {
    decks = await storage.listDecks()
    deckSel.innerHTML = ''
    for (const d of decks) {
      const o = el('option', { value: d.id })
      o.textContent = d.name
      if (d.id === activeId) o.selected = true
      deckSel.append(o)
    }
    const deck = await storage.loadDeck(activeId)
    const cards = deck?.cards ?? []
    count.textContent = `(${cards.length})`
    cardsUl.innerHTML = ''
    if (cards.length === 0) {
      const li = el('li', { class: 'empty' })
      li.textContent = 'No cards yet — paste or add above'
      cardsUl.append(li)
    }
    for (const c of cards) {
      const li = el('li')
      const text = el('div', { class: 'ctext' })
      text.innerHTML = `<span class="front"></span><span class="sep"> — </span><span class="back"></span>`
      text.querySelector('.front')!.textContent = c.front
      text.querySelector('.back')!.textContent = c.back
      li.append(text)

      const v = validateCard(c)
      if (!v.ok) {
        const bad = [...v.front, ...v.back].map((u) => u.char).join(' ')
        const warn = el('span', { class: 'warn', title: `Won't display on glasses: ${bad}` })
        warn.textContent = '⚠'
        li.append(warn)
      }
      const del = el('button', { class: 'del', 'aria-label': 'Delete' })
      del.textContent = '✕'
      del.onclick = async () => {
        await storage.deleteCard(activeId, c.id)
        await refresh()
      }
      li.append(del)
      cardsUl.append(li)
    }
  }

  async function appendCards(cards: Card[]) {
    const deck = await storage.loadDeck(activeId)
    if (!deck) return false
    deck.cards.push(...cards)
    return storage.saveDeck(deck)
  }

  deckSel.onchange = async () => {
    activeId = deckSel.value
    await storage.setActiveDeckId(activeId)
    await refresh()
  }

  $('#newDeck').onclick = async () => {
    const name = prompt('Deck name?')?.trim()
    if (!name) return
    const meta = await storage.createDeck(name)
    activeId = meta.id
    await storage.setActiveDeckId(activeId)
    await refresh()
  }

  const importInput = $<HTMLInputElement>('#importFile')
  $('#importBtn').onclick = () => importInput.click()
  importInput.onchange = async () => {
    const file = importInput.files?.[0]
    if (!file) return
    const { cards, skipped } = parse(await file.text())
    importInput.value = '' // allow re-selecting the same file later
    if (cards.length === 0) {
      pasteMsg.textContent = skipped ? `Import: no cards (${skipped} skipped)` : 'Import: file had no cards'
      return
    }
    const name = deckNameFromFilename(file.name)
    const flagged = cards.filter((c) => !validateCard(c).ok).length
    const meta = await storage.createDeck(name)
    activeId = meta.id
    await storage.setActiveDeckId(activeId)
    const ok = await appendCards(cards)
    if (!ok) {
      pasteMsg.textContent = 'Import failed to save'
      return
    }
    pasteMsg.textContent =
      `Imported "${name}": ${cards.length}` +
      (skipped ? `, ${skipped} skipped` : '') +
      (flagged ? `, ${flagged} flagged` : '')
    await refresh()
  }

  $('#save').onclick = async () => {
    const { cards, skipped } = parse(paste.value)
    if (cards.length === 0) {
      pasteMsg.textContent = skipped ? `Nothing added (${skipped} skipped)` : 'Nothing to add'
      return
    }
    const flagged = cards.filter((c) => !validateCard(c).ok).length
    const ok = await appendCards(cards)
    if (!ok) {
      pasteMsg.textContent = 'Save failed — tap Save to retry'
      return
    }
    paste.value = ''
    pasteMsg.textContent =
      `Added ${cards.length}` +
      (skipped ? `, ${skipped} skipped` : '') +
      (flagged ? `, ${flagged} with unsupported glyphs` : '')
    await refresh()
  }

  $('#qadd').onclick = async () => {
    const front = qf.value.trim()
    const back = qb.value.trim()
    if (!front || !back) {
      pasteMsg.textContent = 'Both front and back are required'
      return
    }
    const ok = await appendCards([newCard(front, back)])
    if (!ok) {
      pasteMsg.textContent = 'Save failed'
      return
    }
    qf.value = ''
    qb.value = ''
    pasteMsg.textContent = 'Added 1'
    await refresh()
  }

  await refresh()
}
