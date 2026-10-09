// Tile face artwork as SVG: the classic Hong Kong symbols in soft ink colours (brick red, pine green, ink).
// Faces are drawn on a 60×80 canvas; the tile element supplies the ivory body around it.

import type { Category } from './engine'
import { t } from './i18n'

const GREEN = '#2f6048'
const RED = '#a8402f'
const SLATE = '#3d5566'
const INK = '#26292b'
const FONT = `'LXGW WenKai TC', 'KaiTi', 'Microsoft JhengHei', serif`     // a brush hand, like the characters on real tiles

const svg = (body: string) =>
  `<svg viewBox="0 0 60 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`

const text = (s: string, x: number, y: number, size: number, fill: string) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="${FONT}" font-weight="700" text-anchor="middle">${s}</text>`

// ---------- Circles (pin) ----------
// A ring-and-dot "coin": colour with a fine white ring inside its edge, white ring, colour, white centre.
function coin(cx: number, cy: number, r: number, fill: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.84}" fill="none" stroke="#fff" stroke-width="${(r * 0.07).toFixed(2)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.64}" fill="#fff"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.47}" fill="${fill}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.16}" fill="#fff"/>`
}

// [x, y, colour] per coin, plus the coin radius, for 2–9. The 1 is drawn separately.
const COINS: Record<number, { r: number; at: [number, number, string][] }> = {
  2: { r: 12, at: [[30, 22, GREEN], [30, 58, INK]] },
  3: { r: 10, at: [[16, 17, GREEN], [30, 40, RED], [44, 63, INK]] },
  4: { r: 11, at: [[17, 24, INK], [43, 24, GREEN], [17, 56, GREEN], [43, 56, INK]] },
  5: { r: 9.5, at: [[16, 18, INK], [44, 18, GREEN], [30, 40, RED], [16, 62, GREEN], [44, 62, INK]] },
  6: { r: 9, at: [[18, 15, GREEN], [42, 15, GREEN], [18, 42, RED], [42, 42, RED], [18, 64, RED], [42, 64, RED]] },
  7: { r: 8, at: [[14, 12, GREEN], [30, 19, GREEN], [46, 26, GREEN], [19, 46, RED], [41, 46, RED], [19, 66, RED], [41, 66, RED]] },
  8: { r: 8, at: [13, 31, 49, 67].flatMap(y => [[19, y, INK], [41, y, INK]] as [number, number, string][]) },
  9: { r: 8, at: ([[16, GREEN], [40, RED], [64, INK]] as [number, string][])
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
      `<circle cx="30" cy="40" r="15.5" fill="none" stroke="${INK}" stroke-width="1.5"/>` + petals +
      `<circle cx="30" cy="40" r="5" fill="${GREEN}"/><circle cx="30" cy="40" r="2" fill="#fff"/>`
  }
  const { r, at } = COINS[v]
  return at.map(([x, y, c]) => coin(x, y, r, c)).join('')
}

// ---------- Bamboo (sou) ----------
// One bamboo stick, as on real tiles: two lengths of stem that narrow at the waist, joined by knots
// at the ends and the middle, with a white line down each length.
function stick(cx: number, cy: number, h: number, fill: string, rot = 0): string {
  const top = cy - h / 2, bottom = cy + h / 2
  const length = (y0: number, y1: number) => {
    const m = (y0 + y1) / 2
    return `<path d="M${cx - 3.4} ${y0} Q${cx - 1.6} ${m} ${cx - 3.4} ${y1} H${cx + 3.4} Q${cx + 1.6} ${m} ${cx + 3.4} ${y0}Z" fill="${fill}"/>` +
      `<path d="M${cx} ${y0 + 2.2} V${y1 - 2.2}" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>`
  }
  const knot = (y: number) => `<ellipse cx="${cx}" cy="${y}" rx="4.6" ry="1.9" fill="${fill}"/>`
  return `<g transform="rotate(${rot} ${cx} ${cy})">` +
    length(top + 1, cy) + length(cy, bottom - 1) + knot(top + 1.2) + knot(cy) + knot(bottom - 1.2) +
    `</g>`
}

function bird(): string {
  // the 1 of bamboo: a little sparrow — red head, green body, tail feathers
  return `<path d="M30 52 L20 74 M30 52 L30 76 M30 52 L40 74" stroke="${GREEN}" stroke-width="3" stroke-linecap="round"/>` +
    `<ellipse cx="30" cy="44" rx="11" ry="14" fill="${GREEN}"/>` +
    `<path d="M22 40 Q30 50 38 40" stroke="#fff" stroke-width="2" fill="none"/>` +
    `<path d="M24 46 Q30 54 36 46" stroke="${SLATE}" stroke-width="2" fill="none"/>` +
    `<circle cx="30" cy="22" r="8" fill="${RED}"/>` +
    `<path d="M37 21 L45 24 L37 26 Z" fill="#c99a52"/>` +
    `<circle cx="32" cy="20" r="2" fill="#fff"/><circle cx="32.5" cy="20" r="1" fill="${INK}"/>` +
    `<path d="M24 15 Q22 8 28 10" stroke="${RED}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
}

function sou(v: number): string {
  const g = GREEN
  switch (v) {
    case 1: return bird()
    case 2: return stick(30, 22, 30, g) + stick(30, 58, 30, g)
    case 3: return stick(30, 22, 28, g) + stick(18, 57, 28, g) + stick(42, 57, 28, g)
    case 4: return stick(18, 23, 28, g) + stick(42, 23, 28, GREEN) + stick(18, 57, 28, GREEN) + stick(42, 57, 28, g)
    case 5: return stick(15, 22, 26, g) + stick(45, 22, 26, GREEN) + stick(30, 40, 26, RED) +
      stick(15, 58, 26, GREEN) + stick(45, 58, 26, g)
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
  return text(NUMERALS[v - 1], 30, 33, 27, INK) + text('萬', 30, 70, 31, RED)
}

function dragon(v: number): string {
  if (v === 0) return text('中', 30, 55, 42, RED)
  if (v === 1) return text('發', 30, 55, 40, GREEN)
  return `<rect x="12" y="13" width="36" height="54" rx="3" fill="none" stroke="${SLATE}" stroke-width="4"/>` +
    `<rect x="17.5" y="18.5" width="25" height="43" rx="1.5" fill="none" stroke="${SLATE}" stroke-width="1.5"/>`
}

const TAN = '#c99a52'

// five round petals around a tan heart
function blossom(cx: number, cy: number, r: number, petal: string): string {
  let s = ''
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2
    s += `<circle cx="${(cx + r * Math.cos(a)).toFixed(2)}" cy="${(cy + r * Math.sin(a)).toFixed(2)}" r="${(r * 0.72).toFixed(2)}" fill="${petal}"/>`
  }
  return s + `<circle cx="${cx}" cy="${cy}" r="${(r * 0.5).toFixed(2)}" fill="${TAN}"/>`
}
const leaf = (x: number, y: number, rot: number, len = 12) =>
  `<path d="M0 0 Q${len / 2} -${len / 4} ${len} 0 Q${len / 2} ${len / 4} 0 0Z" fill="${GREEN}" transform="translate(${x} ${y}) rotate(${rot})"/>`
const stem = (d: string, colour = GREEN, w = 1.8) => `<path d="${d}" stroke="${colour}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`

// The pictures on the bonus tiles, in the space under their labels (x 8–52, y 26–74).
const PLANTS = {
  // flowers: plum, orchid, bamboo, chrysanthemum
  plum: () => stem('M18 72 Q24 56 34 50 Q40 46 44 36', INK, 2) + stem('M29 54 Q22 46 20 38', INK, 1.6) +
    blossom(44, 34, 4.2, RED) + blossom(20, 37, 3.6, RED) + blossom(31, 58, 3.2, RED) + `<circle cx="38" cy="47" r="1.8" fill="${RED}"/>`,
  orchid: () => stem('M30 74 Q22 54 12 44') + stem('M30 74 Q30 52 24 34') + stem('M30 74 Q40 56 50 50') + stem('M30 74 Q34 60 42 40', GREEN, 1.4) +
    `<g fill="${RED}"><ellipse cx="42" cy="34" rx="2.4" ry="5" transform="rotate(-20 42 38)"/><ellipse cx="42" cy="38" rx="2.4" ry="5" transform="rotate(60 42 38)"/><ellipse cx="42" cy="38" rx="2.4" ry="5" transform="rotate(-100 42 38)"/></g>` +
    `<circle cx="42" cy="38" r="1.6" fill="${TAN}"/>`,
  bamboo: () => [[24, 30, 74], [34, 38, 74]].map(([x, top, bottom]) =>
      `<rect x="${x - 2}" y="${top}" width="4" height="${bottom - top}" rx="2" fill="${GREEN}"/>` +
      [0.3, 0.6].map(k => `<rect x="${x - 2.6}" y="${top + (bottom - top) * k}" width="5.2" height="1.6" rx="0.8" fill="#fff"/>`).join('')).join('') +
    leaf(26, 34, -30, 14) + leaf(24, 40, 200, 13) + leaf(36, 44, -20, 14) + leaf(36, 52, 10, 12),
  chrysanthemum: () => stem('M30 74 Q28 62 30 50') + leaf(29, 64, 200, 11) + leaf(30, 60, -25, 11) +
    Array.from({ length: 14 }, (_, i) => `<ellipse cx="30" cy="34" rx="1.7" ry="7" fill="${RED}" transform="rotate(${i * (360 / 14)} 30 41)"/>`).join('') +
    `<circle cx="30" cy="41" r="3.2" fill="${TAN}"/>`,
  // seasons: spring blossom, summer lotus, autumn maple, winter snow
  spring: () => stem('M14 72 Q26 60 30 46', INK, 2) + stem('M24 60 Q36 60 44 54', INK, 1.5) +
    blossom(30, 42, 5.4, RED) + blossom(45, 52, 3.4, RED) + `<circle cx="18" cy="64" r="1.8" fill="${RED}"/>`,
  summer: () => `<ellipse cx="20" cy="68" rx="10" ry="3.6" fill="${GREEN}"/><ellipse cx="41" cy="69" rx="8" ry="3" fill="${GREEN}" opacity="0.75"/>` +
    stem('M30 68 V52') +
    `<g fill="#fff" stroke="${RED}" stroke-width="1.2" stroke-linejoin="round">` +
    [-60, 60, -30, 30, 0].map(rot => `<path d="M30 34 Q35 42 30 52 Q25 42 30 34Z" transform="rotate(${rot} 30 52)"/>`).join('') + '</g>',
  autumn: () => stem('M30 74 V48', RED, 1.6) +
    `<path d="M30 30 L33 39 L41 35 L38 43 L47 45 L39 49 L42 55 L33 51 L30 56 L27 51 L18 55 L21 49 L13 45 L22 43 L19 35 L27 39Z" fill="${RED}"/>` +
    stem('M30 54 V36 M30 47 L38 41 M30 47 L22 41', '#fff', 0.8),
  winter: () => `<g stroke="${SLATE}" stroke-width="1.8" stroke-linecap="round">` +
    [0, 60, 120].map(rot => `<g transform="rotate(${rot} 30 50)"><path d="M30 32 V68"/><path d="M30 38 l-4 -4 M30 38 l4 -4 M30 62 l-4 4 M30 62 l4 4"/></g>`).join('') +
    `</g><circle cx="30" cy="50" r="2.4" fill="${SLATE}"/>`,
}
const FLOWER_PLANTS = [PLANTS.plum, PLANTS.orchid, PLANTS.bamboo, PLANTS.chrysanthemum]
const SEASON_PLANTS = [PLANTS.spring, PLANTS.summer, PLANTS.autumn, PLANTS.winter]

// the flowers have the plant's character top left and the number top right; the seasons the other way round
function bonus(chars: string[], v: number, picture: () => string, numberFirst: boolean): string {
  const [left, right] = numberFirst ? [String(v + 1), chars[v]] : [chars[v], String(v + 1)]
  return text(left, 13, 19, 14, INK) + text(right, 47, 19, 14, INK) + picture()
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
      case 'season': body = bonus(SEASONS, value, SEASON_PLANTS[value], true); break
      case 'flower': body = bonus(FLOWERS, value, FLOWER_PLANTS[value], false); break
    }
    s = svg(body)
    cache.set(key, s)
  }
  return s
}

const SUIT_NAMES: Record<string, string> = { man: '{n} Characters', pin: '{n} Circles', sou: '{n} Bamboo' }
const HONOR_NAMES: Record<string, string[]> = {
  wind: ['East wind', 'South wind', 'West wind', 'North wind'],
  dragon: ['Red dragon', 'Green dragon', 'White dragon'],
  flower: ['Plum', 'Orchid', 'Bamboo flower', 'Chrysanthemum'],
  season: ['Spring', 'Summer', 'Autumn', 'Winter'],
}

export function tileName(category: Category, value: number): string {
  return SUIT_NAMES[category] ? t(SUIT_NAMES[category], { n: value }) : t(HONOR_NAMES[category][value])
}
