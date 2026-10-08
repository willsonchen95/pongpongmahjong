// Small building blocks for the screen: elements, tiles, buttons, icons and number formats.
// Nothing here knows about the game in progress — main.ts and the other screens put them together.
import type { Tile } from './engine'
import { parse } from './engine'
import { tileSVG, tileName } from './tiles'
import { music, isMuted, setMuted } from './sfx'

export const fmt = (n: number) => n.toLocaleString('en-US')
export const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0')
export const points = (n: number) => (n < 0 ? `−${fmt(-n)}` : fmt(n))      // a player's balance

export function el(tag: string, cls = '', text = ''): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}
// Every physical tile gets a lasting id, and on-table elements are tagged with it and with where the
// tile lies, so motion.ts can glide it from its old place to its new one between renders.
const tileIds = new WeakMap<Tile, number>()
let nextTileId = 1
export function tag<T extends HTMLElement>(e: T, t: Tile, place: string): T {
  if (!tileIds.has(t)) tileIds.set(t, nextTileId++)
  e.dataset.key = t.id === undefined ? 'o' + tileIds.get(t) : String(t.id)   // a tile's own id stays the same across online updates
  e.dataset.place = place
  return e
}

// A flat tile, for your rack and inline in text/buttons.
export function tileEl(tile: Tile, cls = '', onClick?: () => void): HTMLElement {
  const e = el('div', 'tile ' + cls)
  e.innerHTML = tileSVG(tile.category, tile.value)
  e.title = tileName(tile.category, tile.value)
  if (onClick) { e.classList.add('clickable'); e.onclick = onClick }
  return e
}
// Line icons for the top-bar chips (they take the chip's text colour).
export const svgIcon = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
export const ICONS = {
  menu: svgIcon('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  book: svgIcon('<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/>'),
  soundOn: svgIcon('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  soundOff: svgIcon('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 10l5 5M21 10l-5 5"/>'),
  musicOn: svgIcon('<path d="M9 17.5V5.5l10-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>'),
  musicOff: svgIcon('<path d="M9 17.5V5.5l10-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/><path d="M3 3l18 18"/>'),
}

// The two sound buttons: music, and sound effects (tile clacks, calls). `redraw` repaints the screen they're on.
export function soundButtons(redraw: () => void): HTMLElement[] {
  const m = chip(music.isOn() ? ICONS.musicOn : ICONS.musicOff, null, () => { music.toggle(); redraw() }, 'icon-only' + (music.isOn() ? '' : ' off'))
  m.title = music.isOn() ? 'Music is on — tap to turn off' : 'Music is off — tap to turn on'
  const s = chip(isMuted() ? ICONS.soundOff : ICONS.soundOn, null, () => { setMuted(!isMuted()); redraw() }, 'icon-only' + (isMuted() ? ' off' : ''))
  s.title = isMuted() ? 'Sound effects are off — tap to turn on' : 'Sound effects are on — tap to turn off'
  for (const b of [m, s]) b.setAttribute('aria-label', b.title)
  return [m, s]
}

// A top-bar pill: a round icon badge, then an optional label. With no onClick it's a plain info chip.
export function chip(icon: string, label: string | null, onClick: (() => void) | null, cls = ''): HTMLElement {
  const c = el(onClick ? 'button' : 'div', 'chip ' + cls)
  const badge = el('span', 'chip-icon')
  badge.innerHTML = icon
  c.appendChild(badge)
  if (label) c.appendChild(el('span', 'chip-label', label))
  if (onClick) c.onclick = onClick
  return c
}

// A small inline tile for status text and buttons.
export const mini = (t: Tile) => tileEl(t, 'mini')
export function button(label: string, onClick: () => void, cls = '', tiles: Tile[] = []): HTMLElement {
  const b = el('button', cls, label)
  for (const t of tiles) b.appendChild(mini(t))
  b.onclick = onClick
  return b
}

// A tile-shaped 3D box on the table: footprint w×d and height h, in table units (--u).
// kind: 'up' = lying face-up (top shows `face`), 'down2'/'down1' = wall stack two/one tile high,
// 'stand' = a row of concealed tiles standing on edge. The CSS colours each face to match.
export function box(kind: string, w: number, d: number, h: number, cls = '', face?: Tile): HTMLElement {
  const b = el('div', `box ${kind} ${cls}`)
  b.style.setProperty('--bw', String(w))
  b.style.setProperty('--bd', String(d))
  b.style.setProperty('--bh', String(h))
  for (const side of ['front', 'back', 'left', 'right']) b.appendChild(el('div', 'face ' + side))
  const top = el('div', 'face top')
  if (face) { top.innerHTML = tileSVG(face.category, face.value); b.title = tileName(face.category, face.value) }
  b.appendChild(top)
  return b
}
// Phones draw the tiles players read — discards, sets, flowers, the others' hands — a size bigger
// (the wall stays: its 18 stacks a side have to fit along the table's edge).
export const phoneScreen = matchMedia('(max-width: 600px), (orientation: landscape) and (max-height: 600px)')
export const tileScale = () => (phoneScreen.matches ? 1.16 : 1)
export const lyingTile = (t: Tile, cls = '') => box('up', 1.15 * tileScale(), 1.54 * tileScale(), 0.8, cls, t)

// Icons on the main menu's cards and buttons.
export const MENU_ICONS = {
  play: svgIcon('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>'),
  resume: svgIcon('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><path d="M10.5 9v6l4.5-3z" fill="currentColor"/>'),
  learn: svgIcon('<path d="M2.5 9.5 12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5V16c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2v-4.5"/><path d="M21.5 9.5V15"/>'),
  book: ICONS.book,
  install: svgIcon('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M12 7v7.5M9 11.5l3 3 3-3"/><path d="M10.5 18.5h3"/>'),
  online: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'),
  feedback: svgIcon('<path d="M4 5.5h16v10H10l-4.5 4v-4H4z"/><path d="M12 8.2l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 10.3l2-.3z" fill="currentColor" stroke="none"/>'),
  voice: svgIcon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
}

// A page's title with a round back button before it, so going back never means scrolling down to the
// button at the bottom. `onBack` does what that bottom button does.
export function pageTitle(title: string, onBack: () => void, backLabel: string): HTMLElement {
  const row = el('div', 'page-title-row')
  const back = button('‹', onBack, 'page-back')
  back.title = backLabel
  back.setAttribute('aria-label', backLabel)
  row.append(back, el('h1', 'setup-title', title))
  return row
}

// A row of tiles written in parse() notation, e.g. '123m' — for the rules and tips.
export const exampleTiles = (spec: string, cls = 'ex') => {
  const row = el('span', 'tiles-row')
  for (const t of parse(spec)) row.appendChild(tileEl(t, cls))
  return row
}
export function uniqueTiles(tiles: Tile[]): Tile[] {
  return tiles.filter((t, i) => tiles.findIndex(o => o.category === t.category && o.value === t.value) === i)
}
export function para(...parts: (string | Node)[]): HTMLElement { const p = el('p'); p.append(...parts); return p }
