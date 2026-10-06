// Tile face artwork as SVG, coloured like a classic Hong Kong set.
// Faces are drawn on a 60×80 canvas; the tile element supplies the ivory body around it.

import type { Category } from './engine'

const GREEN = '#1d7a3a'
const RED = '#d0282b'
const NAVY = '#1b2a5a'
const BLUE = '#1b4f9c'
const INK = '#1a1a1a'
const FONT = `'Noto Serif TC', 'KaiTi', 'Microsoft JhengHei', serif`

const svg = (body: string) =>
  `<svg viewBox="0 0 60 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`

const text = (s: string, x: number, y: number, size: number, fill: string) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="${FONT}" font-weight="900" text-anchor="middle">${s}</text>`

// ---------- Circles (pin) ----------
// A ring-and-dot "coin": colour, white ring, colour, white centre.
function coin(cx: number, cy: number, r: number, fill: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="#fff"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="${fill}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.18}" fill="#fff"/>`
}

// [x, y, colour] per coin, plus the coin radius, for 2–9. The 1 is drawn separately.
const COINS: Record<number, { r: number; at: [number, number, string][] }> = {
  2: { r: 12, at: [[30, 22, GREEN], [30, 58, NAVY]] },
  3: { r: 10, at: [[16, 17, GREEN], [30, 40, RED], [44, 63, NAVY]] },
  4: { r: 11, at: [[17, 24, NAVY], [43, 24, GREEN], [17, 56, GREEN], [43, 56, NAVY]] },
  5: { r: 9.5, at: [[16, 18, NAVY], [44, 18, GREEN], [30, 40, RED], [16, 62, GREEN], [44, 62, NAVY]] },
  6: { r: 9, at: [[18, 15, GREEN], [42, 15, GREEN], [18, 42, RED], [42, 42, RED], [18, 64, RED], [42, 64, RED]] },
  7: { r: 8, at: [[14, 12, GREEN], [30, 19, GREEN], [46, 26, GREEN], [19, 46, RED], [41, 46, RED], [19, 66, RED], [41, 66, RED]] },
  8: { r: 8, at: [13, 31, 49, 67].flatMap(y => [[19, y, NAVY], [41, y, NAVY]] as [number, number, string][]) },
  9: { r: 8, at: ([[16, GREEN], [40, RED], [64, NAVY]] as [number, string][])
    .flatMap(([y, c]) => [[14, y, c], [30, y, c], [46, y, c]] as [number, number, string][]) },
}

function pin(v: number): string {
  if (v === 1) {
    // the big ornamental one: green rim, red petals, green heart
    let petals = ''
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4
      petals += `<circle cx="${30 + 9 * Math.cos(a)}" cy="${40 + 9 * Math.sin(a)}" r="3" fill="${RED}"/>`
    }
    return `<circle cx="30" cy="40" r="21" fill="${GREEN}"/><circle cx="30" cy="40" r="17.5" fill="#fff"/>` +
      `<circle cx="30" cy="40" r="15.5" fill="none" stroke="${NAVY}" stroke-width="1.5"/>` + petals +
      `<circle cx="30" cy="40" r="5" fill="${GREEN}"/><circle cx="30" cy="40" r="2" fill="#fff"/>`
  }
  const { r, at } = COINS[v]
  return at.map(([x, y, c]) => coin(x, y, r, c)).join('')
}

// ---------- Bamboo (sou) ----------
// One bamboo stick: a rounded stem with a white core and a node band across the middle.
function stick(cx: number, cy: number, h: number, fill: string, rot = 0): string {
  const w = 9
  return `<g transform="rotate(${rot} ${cx} ${cy})">` +
    `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="4.5" fill="${fill}"/>` +
    `<rect x="${cx - 1.5}" y="${cy - h / 2 + 3.5}" width="3" height="${h - 7}" rx="1.5" fill="#fff"/>` +
    `<rect x="${cx - w / 2 - 0.8}" y="${cy - 1.6}" width="${w + 1.6}" height="3.2" rx="1.4" fill="${fill}"/>` +
    `</g>`
}

function bird(): string {
  // the 1 of bamboo: a little sparrow — red head, green body, tail feathers
  return `<path d="M30 52 L20 74 M30 52 L30 76 M30 52 L40 74" stroke="${GREEN}" stroke-width="3" stroke-linecap="round"/>` +
    `<ellipse cx="30" cy="44" rx="11" ry="14" fill="${GREEN}"/>` +
    `<path d="M22 40 Q30 50 38 40" stroke="#fff" stroke-width="2" fill="none"/>` +
    `<path d="M24 46 Q30 54 36 46" stroke="${BLUE}" stroke-width="2" fill="none"/>` +
    `<circle cx="30" cy="22" r="8" fill="${RED}"/>` +
    `<path d="M37 21 L45 24 L37 26 Z" fill="#e8a020"/>` +
    `<circle cx="32" cy="20" r="2" fill="#fff"/><circle cx="32.5" cy="20" r="1" fill="${INK}"/>` +
    `<path d="M24 15 Q22 8 28 10" stroke="${RED}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
}

function sou(v: number): string {
  const g = GREEN
  switch (v) {
    case 1: return bird()
    case 2: return stick(30, 22, 30, g) + stick(30, 58, 30, g)
    case 3: return stick(30, 22, 28, g) + stick(18, 57, 28, g) + stick(42, 57, 28, g)
    case 4: return stick(18, 23, 28, g) + stick(42, 23, 28, BLUE) + stick(18, 57, 28, BLUE) + stick(42, 57, 28, g)
    case 5: return stick(15, 22, 26, g) + stick(45, 22, 26, BLUE) + stick(30, 40, 26, RED) +
      stick(15, 58, 26, BLUE) + stick(45, 58, 26, g)
    case 6: return [14, 30, 46].map(x => stick(x, 23, 28, g) + stick(x, 57, 28, g)).join('')
    case 7: return stick(30, 13, 18, RED) + [14, 30, 46].map(x => stick(x, 38, 20, g) + stick(x, 64, 20, g)).join('')
    case 8: // "W" over "M"
      return [12, 24, 36, 48].map((x, i) => stick(x, 22, 28, g, i % 2 ? 22 : -22)).join('') +
        [12, 24, 36, 48].map((x, i) => stick(x, 58, 28, g, i % 2 ? -22 : 22)).join('')
    case 9: return [14, 30, 46].map(x => [15, 40, 65].map(y => stick(x, y, 21, x === 30 ? RED : g)).join('')).join('')
  }
  return ''
}

// ---------- Characters, honours, bonus ----------
const NUMERALS = ['一', '二', '三', '四', '伍', '六', '七', '八', '九']
const WINDS = ['東', '南', '西', '北']
const SEASONS = ['春', '夏', '秋', '冬']
const FLOWERS = ['梅', '蘭', '竹', '菊']          // same order as engine/Unicode: plum, orchid, bamboo, chrysanthemum

function man(v: number): string {
  return text(NUMERALS[v - 1], 30, 33, 27, NAVY) + text('萬', 30, 70, 31, RED)
}

function dragon(v: number): string {
  if (v === 0) return text('中', 30, 55, 42, RED)
  if (v === 1) return text('發', 30, 55, 40, GREEN)
  return `<rect x="12" y="13" width="36" height="54" rx="3" fill="none" stroke="${BLUE}" stroke-width="4"/>` +
    `<rect x="17.5" y="18.5" width="25" height="43" rx="1.5" fill="none" stroke="${BLUE}" stroke-width="1.5"/>`
}

function blossom(cx: number, cy: number, petal: string): string {
  let s = ''
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2
    s += `<circle cx="${cx + 5 * Math.cos(a)}" cy="${cy + 5 * Math.sin(a)}" r="3.6" fill="${petal}"/>`
  }
  return `<path d="M${cx} ${cy + 4} Q${cx - 6} ${cy + 14} ${cx - 2} ${cy + 20}" stroke="${GREEN}" stroke-width="2" fill="none"/>` +
    `<path d="M${cx - 3} ${cy + 13} Q${cx - 11} ${cy + 10} ${cx - 12} ${cy + 15}" stroke="${GREEN}" stroke-width="2" fill="none"/>` +
    s + `<circle cx="${cx}" cy="${cy}" r="2.6" fill="#e8b020"/>`
}

function bonus(chars: string[], v: number, colour: string): string {
  return text(String(v + 1), 11, 17, 13, colour) + text(chars[v], 39, 21, 15, colour) + blossom(30, 44, colour)
}

const cache = new Map<string, string>()

export function tileSVG(category: Category, value: number): string {
  const key = `${category}-${value}`
  let s = cache.get(key)
  if (s === undefined) {
    let body = ''
    switch (category) {
      case 'man': body = man(value); break
      case 'pin': body = pin(value); break
      case 'sou': body = sou(value); break
      case 'wind': body = text(WINDS[value], 30, 55, 40, INK); break
      case 'dragon': body = dragon(value); break
      case 'season': body = bonus(SEASONS, value, RED); break
      case 'flower': body = bonus(FLOWERS, value, BLUE); break
    }
    s = svg(body)
    cache.set(key, s)
  }
  return s
}

const SUIT_NAMES: Record<string, string> = { man: 'Characters', pin: 'Circles', sou: 'Bamboo' }
const HONOR_NAMES: Record<string, string[]> = {
  wind: ['East wind', 'South wind', 'West wind', 'North wind'],
  dragon: ['Red dragon', 'Green dragon', 'White dragon'],
  flower: ['Plum', 'Orchid', 'Bamboo flower', 'Chrysanthemum'],
  season: ['Spring', 'Summer', 'Autumn', 'Winter'],
}

export function tileName(category: Category, value: number): string {
  return SUIT_NAMES[category] ? `${value} ${SUIT_NAMES[category]}` : HONOR_NAMES[category][value]
}
