// Pure game logic — no DOM. Testable on its own, and reusable on the server later.

export type Category = 'man' | 'sou' | 'pin' | 'wind' | 'dragon' | 'flower' | 'season'

export interface Tile {
  category: Category
  value: number
  glyph: string
  id?: number                          // which of the 144 physical tiles (set when the wall is built)
}

const BASE: Record<Category, number> = {
  wind: 0x1F000, dragon: 0x1F004, man: 0x1F007,
  sou: 0x1F010, pin: 0x1F019, flower: 0x1F022, season: 0x1F026,
}
const SUITS: Category[] = ['man', 'sou', 'pin']

export function isSuit(c: Category): boolean {
  return c === 'man' || c === 'sou' || c === 'pin'
}
export function isBonus(t: Tile): boolean {
  return t.category === 'flower' || t.category === 'season'
}
export function glyphFor(category: Category, value: number): string {
  return String.fromCodePoint(BASE[category] + (isSuit(category) ? value - 1 : value))
}
export function makeTile(category: Category, value: number): Tile {
  return { category, value, glyph: glyphFor(category, value) }
}

export function buildWall(): Tile[] {
  const wall: Tile[] = []
  const push = (c: Category, v: number, n: number) => { for (let i = 0; i < n; i++) wall.push(makeTile(c, v)) }
  for (const s of SUITS) for (let r = 1; r <= 9; r++) push(s, r, 4)
  for (let w = 0; w < 4; w++) push('wind', w, 4)
  for (let d = 0; d < 3; d++) push('dragon', d, 4)
  for (let f = 0; f < 4; f++) push('flower', f, 1)
  for (let s = 0; s < 4; s++) push('season', s, 1)
  wall.forEach((t, i) => { t.id = i })   // so a tile can be named in a message ("throw tile 57") and followed on screen
  return wall
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

const CATEGORY_ORDER: Category[] = ['man', 'sou', 'pin', 'wind', 'dragon', 'flower', 'season']
export function sortHand(hand: Tile[]): Tile[] {
  return [...hand].sort((a, b) =>
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.value - b.value)
}

// The four winds, in seat order: the dealer sits East, then South, West, North going counter-clockwise.
export const SEATS = ['East', 'South', 'West', 'North'] as const

export interface GameState {
  dealer: number                 // player index of this hand's dealer (East)
  roundWind: number              // prevailing wind of the round: 0 = East … 3 = North
  wall: Tile[]
  hands: Tile[][]
  melds: Tile[][][]
  concealedKongs: Tile[][]       // per seat, one tile of each kong declared from the hand (it keeps the hand concealed)
  discards: Tile[][]
  bonus: Tile[][]                // flowers/seasons set aside face-up
  wallFront: number              // tiles taken from the back of the wall (array front) so far — for drawing the wall
  current: number
  drawn: Tile | null             // the tile just drawn (for highlighting), null after a claim
  lastDrawFromBack: boolean      // the latest draw was a kong's replacement tile
  over: boolean
  winner: number | null
}

// A player's seat wind for this hand: the dealer is East, and the winds follow the turn order.
export function seatWind(game: GameState, player: number): number {
  return (player - game.dealer + 4) % 4
}

export function deal(dealer = 0, roundWind = 0): GameState {
  const wall = shuffle(buildWall())
  const hands: Tile[][] = [[], [], [], []]
  const bonus: Tile[][] = [[], [], [], []]
  let wallFront = 0
  for (let i = 0; i < 13; i++) for (let s = 0; s < 4; s++) hands[s].push(wall.pop()!)
  // Set aside any dealt bonus tiles and replace them from the back of the wall (replacements may be bonus too).
  for (let s = 0; s < 4; s++) {
    let i: number
    while ((i = hands[s].findIndex(isBonus)) >= 0) {
      bonus[s].push(hands[s].splice(i, 1)[0])
      hands[s].push(wall.shift()!)
      wallFront++
    }
  }
  return {
    dealer, roundWind, wall, hands, melds: [[], [], [], []], concealedKongs: [[], [], [], []],
    discards: [[], [], [], []], bonus, wallFront,
    current: dealer, drawn: null, lastDrawFromBack: false, over: false, winner: null,
  }
}

// Pull from the back of the wall (the array front).
function shiftWall(game: GameState): Tile | undefined {
  const t = game.wall.shift()
  if (t) game.wallFront++
  return t
}

// Draw for a seat (from the back of the wall for a kong replacement). Bonus tiles go face-up and are
// replaced from the back of the wall. Returns the tile added to the hand, or null if the wall ran out.
export function drawTile(game: GameState, seat: number, fromBack = false): Tile | null {
  game.lastDrawFromBack = fromBack                 // a flower's replacement doesn't count as a kong's
  let t = fromBack ? shiftWall(game) : game.wall.pop()
  while (t && isBonus(t)) {
    game.bonus[seat].push(t)
    t = shiftWall(game)
  }
  if (!t) return null
  game.hands[seat].push(t)
  return t
}

// ---------- Win detection ----------
// A standard winning hand = 4 sets + 1 pair (14 tiles).
// Set = pung (three identical) or chow (three consecutive in one number suit).
// Honors (winds/dragons) can only be a pung or the pair. Bonus tiles aren't part of this.

type Counts = Map<string, number>
const keyOf = (t: Tile) => `${t.category}-${t.value}`
function parseKey(k: string): { category: Category; value: number } {
  const [c, v] = k.split('-')
  return { category: c as Category, value: Number(v) }
}

// Every tile key in a fixed order, so we always consume the lowest tile first.
const ALL_KEYS: string[] = (() => {
  const keys: string[] = []
  for (const s of SUITS) for (let r = 1; r <= 9; r++) keys.push(`${s}-${r}`)
  for (let w = 0; w < 4; w++) keys.push(`wind-${w}`)
  for (let d = 0; d < 3; d++) keys.push(`dragon-${d}`)
  return keys
})()

function toCounts(tiles: Tile[]): Counts {
  const m: Counts = new Map()
  for (const t of tiles) m.set(keyOf(t), (m.get(keyOf(t)) ?? 0) + 1)
  return m
}
function firstNonZero(counts: Counts): string | null {
  for (const k of ALL_KEYS) if ((counts.get(k) ?? 0) > 0) return k
  return null
}

// Can the remaining tiles split cleanly into sets?
function canFormSets(counts: Counts): boolean {
  const k = firstNonZero(counts)
  if (k === null) return true                      // all consumed — success
  const { category, value } = parseKey(k)

  if ((counts.get(k) ?? 0) >= 3) {                 // try a pung
    counts.set(k, counts.get(k)! - 3)
    if (canFormSets(counts)) { counts.set(k, counts.get(k)! + 3); return true }
    counts.set(k, counts.get(k)! + 3)
  }
  if (isSuit(category) && value <= 7) {            // try a chow
    const k2 = `${category}-${value + 1}`, k3 = `${category}-${value + 2}`
    if ((counts.get(k2) ?? 0) >= 1 && (counts.get(k3) ?? 0) >= 1) {
      counts.set(k, counts.get(k)! - 1); counts.set(k2, counts.get(k2)! - 1); counts.set(k3, counts.get(k3)! - 1)
      if (canFormSets(counts)) {
        counts.set(k, counts.get(k)! + 1); counts.set(k2, counts.get(k2)! + 1); counts.set(k3, counts.get(k3)! + 1)
        return true
      }
      counts.set(k, counts.get(k)! + 1); counts.set(k2, counts.get(k2)! + 1); counts.set(k3, counts.get(k3)! + 1)
    }
  }
  return false
}

// Thirteen orphans: one of every 1, 9, wind and dragon, plus a second of any of them.
const ORPHAN_KEYS = ALL_KEYS.filter(k => { const { category, value } = parseKey(k); return !isSuit(category) || value === 1 || value === 9 })
export function isThirteenOrphans(concealed: Tile[]): boolean {
  if (concealed.length !== 14) return false
  const counts = toCounts(concealed)
  return counts.size === 13 && ORPHAN_KEYS.every(k => counts.has(k))
}

export function isWinningHand(concealed: Tile[], meldCount = 0): boolean {
  const need = 4 - meldCount                          // sets still needed from the concealed tiles
  if (concealed.length !== need * 3 + 2) return false // must be exactly N sets + one pair
  if (concealed.some(isBonus)) return false
  if (meldCount === 0 && isThirteenOrphans(concealed)) return true
  const counts = toCounts(concealed)
  for (const k of ALL_KEYS) {
    if ((counts.get(k) ?? 0) >= 2) {
      counts.set(k, counts.get(k)! - 2)
      const ok = canFormSets(counts)
      counts.set(k, counts.get(k)! + 2)
      if (ok) return true
    }
  }
  return false
}

// Every distinct tile that would complete this hand (empty if it isn't one tile from winning).
// Used for the beginner hints: "you win with …" and "throwing this keeps you ready".
export function winningTiles(concealed: Tile[], meldCount = 0): Tile[] {
  return ALL_KEYS.map(parseKey)
    .map(({ category, value }) => makeTile(category, value))
    .filter(t => isWinningHand([...concealed, t], meldCount))
}

// Test/debug helper: "123m 456p 11z" — m/p/s suits, z = honors (1–4 = E S W N, 5–7 = Red Green White)
export function parse(spec: string): Tile[] {
  const out: Tile[] = []
  for (const group of spec.split(/\s+/).filter(Boolean)) {
    const suit = group[group.length - 1]
    for (const d of group.slice(0, -1)) {
      const n = Number(d)
      if (suit === 'm') out.push(makeTile('man', n))
      else if (suit === 'p') out.push(makeTile('pin', n))
      else if (suit === 's') out.push(makeTile('sou', n))
      else if (suit === 'z') out.push(n <= 4 ? makeTile('wind', n - 1) : makeTile('dragon', n - 5))
    }
  }
  return out
}

// ---------- Claims & kongs ----------

export const sameTile = (a: Tile, b: Tile) => a.category === b.category && a.value === b.value
export function countOf(hand: Tile[], tile: Tile): number {
  return hand.filter(t => sameTile(t, tile)).length
}

export function canPong(hand: Tile[], tile: Tile): boolean { return countOf(hand, tile) >= 2 }
export function canKong(hand: Tile[], tile: Tile): boolean { return countOf(hand, tile) >= 3 }

export function canWinOn(game: GameState, seat: number, tile: Tile): boolean {
  return isWinningHand([...game.hands[seat], tile], game.melds[seat].length)
}

// Chows a hand could make with `tile`: each option is the run's three values, e.g. [3, 4, 5].
export function chowOptions(hand: Tile[], tile: Tile): number[][] {
  if (!isSuit(tile.category)) return []
  const has = (v: number) => hand.some(t => t.category === tile.category && t.value === v)
  const out: number[][] = []
  for (let start = Math.max(1, tile.value - 2); start <= Math.min(7, tile.value); start++) {
    const run = [start, start + 1, start + 2]
    if (run.every(v => v === tile.value || has(v))) out.push(run)
  }
  return out
}

// Remove one tile of this kind from the hand and return it.
function take(hand: Tile[], like: Tile, value = like.value): Tile {
  const i = hand.findIndex(t => t.category === like.category && t.value === value)
  return hand.splice(i, 1)[0]
}

export type ClaimKind = 'pong' | 'kong' | 'chow'

// `seat` takes the latest discard of `from` and exposes a meld. For a chow, `run` gives the three values.
export function claimDiscard(game: GameState, seat: number, from: number, kind: ClaimKind, run?: number[]): void {
  const tile = game.discards[from].pop()!
  const hand = game.hands[seat]
  const meld = [tile]
  if (kind === 'chow') {
    for (const v of run!) if (v !== tile.value) meld.push(take(hand, tile, v))
    meld.sort((a, b) => a.value - b.value)
  } else {
    for (let k = 0; k < (kind === 'kong' ? 3 : 2); k++) meld.push(take(hand, tile))
  }
  game.melds[seat].push(meld)
  game.current = seat
}

const isPungOf = (meld: Tile[], t: Tile) => meld.length === 3 && meld.every(m => sameTile(m, t))

// Kongs a seat can declare on its own turn: four of a kind in hand (concealed),
// or the fourth tile for one of its exposed pungs (added). One representative tile each.
export function kongOptions(game: GameState, seat: number): Tile[] {
  const hand = game.hands[seat]
  const out: Tile[] = []
  for (const t of hand) {
    if (out.some(o => sameTile(o, t))) continue
    if (countOf(hand, t) === 4 || game.melds[seat].some(m => isPungOf(m, t))) out.push(t)
  }
  return out
}

// An added kong (the fourth tile onto an exposed pong) — the one kind of kong another player can rob.
export function isAddedKong(game: GameState, seat: number, tile: Tile): boolean {
  return game.melds[seat].some(m => isPungOf(m, tile))
}

// Declare a kong from kongOptions. The caller then draws a replacement tile.
export function declareKong(game: GameState, seat: number, tile: Tile): void {
  const hand = game.hands[seat]
  const pung = game.melds[seat].find(m => isPungOf(m, tile))
  if (pung) pung.push(take(hand, tile))
  else {
    game.melds[seat].push([take(hand, tile), take(hand, tile), take(hand, tile), take(hand, tile)])
    game.concealedKongs[seat].push(tile)
  }
}

// Is this exposed set a kong declared from the hand (shown with its end tiles face down)?
export function isConcealedKong(game: GameState, seat: number, meld: Tile[]): boolean {
  return meld.length === 4 && game.concealedKongs[seat].some(t => sameTile(t, meld[0]))
}

// ---------- Scoring (Hong Kong faan, simplified) ----------
// A winning hand is scored by the patterns it contains; each pattern is worth some faan. A hand
// can sometimes be split into sets in more than one way (111 222 333 is three pongs or three
// chows), so every split is tried and the best score kept.

export interface SetInfo { type: 'pong' | 'chow'; tile: Tile }   // pong includes kong; tile = lowest tile
export interface Decomposition { pair: Tile; sets: SetInfo[] }
export interface FaanItem { name: string; faan: number }
export interface ScoreInput {
  concealed: Tile[]                  // the hidden part of the winning hand, winning tile included
  melds: Tile[][]                    // exposed sets
  bonus: Tile[]                      // flowers/seasons
  selfDrawn: boolean
  seatWind: number                   // 0 = East … 3 = North
  roundWind: number
  concealedKongs?: number            // how many of `melds` are kongs declared from the hand
  kongReplacement?: boolean          // self-drawn on the replacement tile after a kong
  robbedKong?: boolean               // won on the tile another player added to their pong
  lastTile?: boolean                 // won with the wall's last tile, or the discard after it
}

export const MAX_FAAN = 10           // the limit: no hand scores more

// Every way to split the concealed tiles into one pair plus sets.
export function decompose(concealed: Tile[]): Decomposition[] {
  const counts = toCounts(concealed)
  const out: Decomposition[] = []
  for (const k of ALL_KEYS) {
    if ((counts.get(k) ?? 0) < 2) continue
    counts.set(k, counts.get(k)! - 2)
    const { category, value } = parseKey(k)
    for (const sets of allSets(counts)) out.push({ pair: makeTile(category, value), sets })
    counts.set(k, counts.get(k)! + 2)
  }
  return out
}

// All ways to split the remaining counts into sets (an empty list if it can't be done).
function allSets(counts: Counts): SetInfo[][] {
  const k = firstNonZero(counts)
  if (k === null) return [[]]
  const { category, value } = parseKey(k)
  const results: SetInfo[][] = []
  if ((counts.get(k) ?? 0) >= 3) {
    counts.set(k, counts.get(k)! - 3)
    for (const rest of allSets(counts)) results.push([{ type: 'pong', tile: makeTile(category, value) }, ...rest])
    counts.set(k, counts.get(k)! + 3)
  }
  const k2 = `${category}-${value + 1}`, k3 = `${category}-${value + 2}`
  if (isSuit(category) && value <= 7 && (counts.get(k2) ?? 0) >= 1 && (counts.get(k3) ?? 0) >= 1) {
    for (const key of [k, k2, k3]) counts.set(key, counts.get(key)! - 1)
    for (const rest of allSets(counts)) results.push([{ type: 'chow', tile: makeTile(category, value) }, ...rest])
    for (const key of [k, k2, k3]) counts.set(key, counts.get(key)! + 1)
  }
  return results
}

function classifyMeld(meld: Tile[]): SetInfo {
  const lowest = meld.reduce((a, b) => (b.value < a.value ? b : a))
  return { type: meld.every(t => sameTile(t, meld[0])) ? 'pong' : 'chow', tile: lowest }
}

// Patterns that depend on how the hand is split into sets.
function setPatterns(d: Decomposition, input: ScoreInput): FaanItem[] {
  const items: FaanItem[] = []
  const sets = [...input.melds.map(classifyMeld), ...d.sets]
  const tiles = [...input.concealed, ...input.melds.flat()]

  const suits = new Set(tiles.filter(t => isSuit(t.category)).map(t => t.category))
  const hasHonours = tiles.some(t => !isSuit(t.category))
  if (suits.size === 0) items.push({ name: 'All honours', faan: 10 })
  else if (suits.size === 1 && !hasHonours) items.push({ name: 'Pure one suit', faan: 7 })
  else if (suits.size === 1) items.push({ name: 'Mixed one suit', faan: 3 })

  if (sets.every(s => s.type === 'pong')) items.push({ name: 'All pongs', faan: 3 })
  else if (sets.every(s => s.type === 'chow')) items.push({ name: 'All chi', faan: 1 })

  const pongsOf = (cat: Category) => sets.filter(s => s.type === 'pong' && s.tile.category === cat)
  const dragonPongs = pongsOf('dragon').length
  if (dragonPongs === 3) items.push({ name: 'Big three dragons', faan: 8 })
  else if (dragonPongs === 2 && d.pair.category === 'dragon') items.push({ name: 'Small three dragons', faan: 5 })
  else if (dragonPongs > 0) items.push({ name: dragonPongs > 1 ? `Dragon pongs ×${dragonPongs}` : 'Dragon pong', faan: dragonPongs })

  const windPongs = pongsOf('wind')
  if (windPongs.length === 4) items.push({ name: 'Big four winds', faan: 10 })
  else if (windPongs.length === 3 && d.pair.category === 'wind') items.push({ name: 'Small four winds', faan: 8 })
  else {
    if (windPongs.some(s => s.tile.value === input.seatWind)) items.push({ name: 'Seat wind pong', faan: 1 })
    if (windPongs.some(s => s.tile.value === input.roundWind)) items.push({ name: 'Round wind pong', faan: 1 })
  }
  return items
}

// A hand counts as concealed if every set showing is a kong declared from the hand.
const isConcealed = (input: { melds: Tile[][]; concealedKongs?: number }) => input.melds.length === (input.concealedKongs ?? 0)

// Faan from flowers and seasons: none at all, your own seat's, or complete sets of four.
function bonusItems(bonus: Tile[], seat: number): FaanItem[] {
  if (bonus.length === 0) return [{ name: 'No flowers', faan: 1 }]
  if (bonus.length === 8) return [{ name: 'All eight flowers', faan: MAX_FAAN }]
  const items: FaanItem[] = []
  const full = (['flower', 'season'] as Category[]).filter(c => bonus.filter(t => t.category === c).length === 4)
  if (full.length) items.push({ name: 'Flower set', faan: 2 })                // a full set replaces its own-flower faan
  const own = bonus.filter(t => t.value === seat && !full.includes(t.category)).length
  if (own > 0) items.push({ name: own > 1 ? `Own flowers ×${own}` : 'Own flower', faan: own })
  return items
}

// Score a winning hand: the faan patterns it earns (best split) and the total, capped at the limit.
export function scoreHand(input: ScoreInput): { faan: number; items: FaanItem[]; limit: boolean } {
  const common: FaanItem[] = []
  if (input.selfDrawn) common.push({ name: 'Self-drawn', faan: 1 })
  if (isConcealed(input)) common.push({ name: 'Concealed hand', faan: 1 })
  common.push(...bonusItems(input.bonus, input.seatWind))
  if (input.kongReplacement) common.push({ name: 'Win on a kong', faan: 2 })
  if (input.robbedKong) common.push({ name: 'Robbing a kong', faan: 2 })
  if (input.lastTile) common.push({ name: 'Last tile', faan: 1 })

  let best: FaanItem[] = []
  let bestTotal = -1
  if (input.melds.length === 0 && isThirteenOrphans(input.concealed)) {
    best = [{ name: 'Thirteen orphans', faan: MAX_FAAN }]
    bestTotal = MAX_FAAN
  }
  for (const d of decompose(input.concealed)) {
    const items = setPatterns(d, input)
    const total = items.reduce((n, i) => n + i.faan, 0)
    if (total > bestTotal) { best = items; bestTotal = total }
  }
  const items = [...best, ...common]
  const raw = items.reduce((n, i) => n + i.faan, 0)
  return { faan: Math.min(raw, MAX_FAAN), items, limit: raw >= MAX_FAAN }
}

// Points paid for a hand of the given faan — roughly doubling, up to the limit.
const PAYOUT = [8, 16, 32, 64, 128, 192, 256, 384, 512, 768, 1024]
export function payout(faan: number): number { return PAYOUT[Math.min(faan, MAX_FAAN)] }

// Score changes for each player. On a discard the thrower pays it all; when self-drawn the
// other three each pay half.
export function settle(winner: number, discarder: number | null, faan: number): number[] {
  const p = payout(faan)
  const deltas = [0, 0, 0, 0]
  if (discarder === null) {
    for (let s = 0; s < 4; s++) if (s !== winner) { deltas[s] -= p / 2; deltas[winner] += p / 2 }
  } else {
    deltas[discarder] -= p
    deltas[winner] += p
  }
  return deltas
}

// ---------- Hand progress (for the live "Your hand" meter) ----------
// For a hand still being built: the faan already secured by what you hold, and big patterns you
// are close to. "Secured" assumes the hand is later completed without spoiling them.

export interface ProgressInput {
  concealed: Tile[]; melds: Tile[][]; bonus: Tile[]; seatWind: number; roundWind: number
  concealedKongs?: number            // how many of `melds` are kongs declared from the hand
}
// A pattern within reach: `off` tiles stand in the way. `tiles` are the ones to collect (action
// 'need') or to get rid of (action 'discard'); `how` says it in plain words.
export interface CloseTo { name: string; faan: number; off: number; how: string; action: 'need' | 'discard'; tiles: Tile[] }
export interface HaveItem extends FaanItem { tile?: Tile }              // tile = which dragon/wind, for display

const SUIT_LABEL: Record<string, string> = { man: 'Characters', sou: 'Bamboo', pin: 'Circles' }
// one tile of each kind, in hand order
const distinct = (tiles: Tile[]) => sortHand(tiles).filter((t, i, all) => i === 0 || !sameTile(t, all[i - 1]))

export function handProgress(input: ProgressInput): { have: HaveItem[]; close: CloseTo[] } {
  const have: HaveItem[] = []
  const close: CloseTo[] = []
  const counts = toCounts(input.concealed)
  const meldSets = input.melds.map(classifyMeld)
  // a pong of this kind, exposed or held as three (or four) in the hand
  const hasPong = (cat: Category, v: number) =>
    meldSets.some(s => s.type === 'pong' && s.tile.category === cat && s.tile.value === v) || (counts.get(`${cat}-${v}`) ?? 0) >= 3
  const hasPair = (cat: Category, v: number) => (counts.get(`${cat}-${v}`) ?? 0) === 2

  if (isConcealed(input)) have.push({ name: 'Concealed hand', faan: 1 })
  have.push(...bonusItems(input.bonus, input.seatWind))

  const dragonPongs = [0, 1, 2].filter(v => hasPong('dragon', v))
  const dragonPairs = [0, 1, 2].filter(v => hasPair('dragon', v))
  if (dragonPongs.length === 3) have.push({ name: 'Big three dragons', faan: 8 })
  else if (dragonPongs.length === 2 && dragonPairs.length) have.push({ name: 'Small three dragons', faan: 5 })
  else {
    for (const v of dragonPongs) have.push({ name: 'Dragon pong', faan: 1, tile: makeTile('dragon', v) })
    const missing = [0, 1, 2].filter(v => !dragonPongs.includes(v)).map(v => makeTile('dragon', v))
    if (dragonPongs.length === 2) {
      close.push({ name: 'Small three dragons', faan: 5, off: 2, action: 'need', tiles: missing,
        how: 'You have two dragon pongs — collect a pair of the third dragon' })
    } else if (dragonPongs.length + dragonPairs.length >= 3) {
      close.push({ name: 'Small three dragons', faan: 5, off: 1, action: 'need', tiles: dragonPairs.map(v => makeTile('dragon', v)),
        how: 'Turn one of your dragon pairs into a pong' })
    }
    for (const v of dragonPairs) {
      close.push({ name: 'Dragon pong', faan: 1, off: 1, action: 'need', tiles: [makeTile('dragon', v)],
        how: 'You have a pair — one more makes a pong' })
    }
  }
  // wind pongs: your seat's wind and the round's wind score (both, if they're the same wind)
  for (const [w, label] of [[input.seatWind, 'Seat wind pong'], [input.roundWind, 'Round wind pong']] as [number, string][]) {
    if (hasPong('wind', w)) have.push({ name: label, faan: 1, tile: makeTile('wind', w) })
    else if (hasPair('wind', w)) {
      close.push({ name: label, faan: 1, off: 1, action: 'need', tiles: [makeTile('wind', w)],
        how: 'You have a pair of this wind — one more makes a pong' })
    }
  }

  // one suit: how many tiles stand in the way
  const tiles = [...input.concealed, ...input.melds.flat()]
  if (tiles.every(t => !isSuit(t.category))) have.push({ name: 'All honours', faan: 10 })
  else for (const suit of ['man', 'sou', 'pin'] as Category[]) {
    const notSuit = input.concealed.filter(t => t.category !== suit)                    // can only change hidden tiles
    const otherSuits = notSuit.filter(t => isSuit(t.category))
    const lockedOut = input.melds.flat().some(t => isSuit(t.category) && t.category !== suit)
    if (lockedOut) continue                                                             // an exposed set of another suit
    if (tiles.every(t => t.category === suit)) { have.push({ name: 'Pure one suit', faan: 7 }); break }
    if (otherSuits.length === 0) {
      have.push({ name: 'Mixed one suit', faan: 3 })
      if (notSuit.length <= 3 && !input.melds.flat().some(t => !isSuit(t.category))) {
        close.push({ name: 'Pure one suit', faan: 7, off: notSuit.length, action: 'discard', tiles: distinct(notSuit),
          how: `Keep only ${SUIT_LABEL[suit]} — throw away the winds and dragons` })
      }
      break
    }
    if (otherSuits.length <= 3) {
      close.push({ name: 'Mixed one suit', faan: 3, off: otherSuits.length, action: 'discard', tiles: distinct(otherSuits),
        how: `Keep ${SUIT_LABEL[suit]} plus winds & dragons — throw away the other suits` })
      break
    }
  }

  // all pongs: no runs taken, and every hidden tile in a pair or better (one pair is the eyes)
  if (meldSets.every(s => s.type === 'pong')) {
    const singles = input.concealed.filter(t => (counts.get(`${t.category}-${t.value}`) ?? 0) === 1)
    const pairs = [...counts.values()].filter(n => n === 2).length
    const off = singles.length + Math.max(0, pairs - 1)
    if (off > 0 && off <= 3) {
      close.push({ name: 'All pongs', faan: 3, off, action: 'discard', tiles: distinct(singles),
        how: 'Make every set three of a kind — these single tiles have no partners' })
    }
  }
  // biggest reward first, then the easiest
  close.sort((a, b) => b.faan - a.faan || a.off - b.off)
  return { have, close: close.filter(c => c.off > 0) }
}

// ---------- What a claim does to your hand ----------
// Taking a discard exposes a set, which can spoil patterns. Compare the hand's progress before and
// after the claim: `lost` are secured patterns that go away, `ruined` are goals you were close to
// that become impossible, `gained` are patterns the new set secures.

export interface ClaimEffects { lost: HaveItem[]; ruined: CloseTo[]; gained: HaveItem[] }

// The hand left, and the set exposed, if `tile` were claimed this way. The hand passed in is untouched.
function claimedHand(hand: Tile[], kind: ClaimKind, tile: Tile, run?: number[]): { concealed: Tile[]; meld: Tile[] } {
  const concealed = [...hand]
  const meld = [tile]
  if (kind === 'chow') {
    for (const v of run!) if (v !== tile.value) meld.push(take(concealed, tile, v))
  } else {
    for (let k = 0; k < (kind === 'kong' ? 3 : 2); k++) meld.push(take(concealed, tile))
  }
  return { concealed, meld }
}

export function claimEffects(input: ProgressInput, kind: ClaimKind, tile: Tile, run?: number[]): ClaimEffects {
  const { concealed, meld } = claimedHand(input.concealed, kind, tile, run)
  const before = handProgress(input)
  const after = handProgress({ ...input, concealed, melds: [...input.melds, meld] })
  // a dragon or wind pong is told apart by which tile it is; other patterns by name alone
  const key = (i: { name: string; tile?: Tile; tiles?: Tile[] }) => {
    const t = i.tile ?? i.tiles?.[0]
    return / pong$/.test(i.name) && t ? `${i.name}:${t.category}-${t.value}` : i.name
  }
  const beforeHave = new Set(before.have.map(key))
  const afterHave = new Set(after.have.map(key))
  const stillPossible = new Set([...afterHave, ...after.close.map(key)])
  return {
    lost: before.have.filter(i => !afterHave.has(key(i))),
    ruined: before.close.filter(c => !stillPossible.has(key(c))),
    gained: after.have.filter(i => !beforeHave.has(key(i))),
  }
}

// ---------- Planning toward the minimum ----------
// When a table needs, say, 3 faan to win and your hand has 1, suggest combinations of patterns that
// would get there from your current tiles — the easiest (fewest tiles to change) first.

export interface Plan {
  items: CloseTo[]        // patterns to complete
  selfDrawn: boolean      // also relies on drawing the winning tile yourself (+1)
  total: number           // faan the hand would then have
  off: number             // tiles to change, roughly
}

// Mixed one suit as a longer-term goal: the suit needing the fewest hidden tiles changed, even
// when that's more than the 3 handProgress considers "close".
function farOneSuit(input: ProgressInput): CloseTo | null {
  let best: CloseTo | null = null
  for (const suit of ['man', 'sou', 'pin'] as Category[]) {
    if (input.melds.flat().some(t => isSuit(t.category) && t.category !== suit)) continue
    const others = input.concealed.filter(t => isSuit(t.category) && t.category !== suit)
    if (others.length === 0) continue                                       // already one suit
    if (!best || others.length < best.off) {
      best = { name: 'Mixed one suit', faan: 3, off: others.length, action: 'discard', tiles: distinct(others),
        how: `Keep ${SUIT_LABEL[suit]} plus winds & dragons — throw away the other suits` }
    }
  }
  return best
}

// Two patterns that can't both be made in one hand.
function clash(a: CloseTo, b: CloseTo): boolean {
  if (a.name.includes('one suit') && b.name.includes('one suit')) return true
  const threeDragons = (c: CloseTo) => c.name === 'Small three dragons'
  if (threeDragons(a) !== threeDragons(b) && [a, b].every(c => c.name.includes('ragon'))) return true
  return a.name === b.name && sameTile(a.tiles[0], b.tiles[0])
}

export function planToMinimum(input: ProgressInput, minFaan: number, maxPlans = 3): { base: number; plans: Plan[] } {
  const { have, close } = handProgress(input)
  const base = have.reduce((n, i) => n + i.faan, 0)
  if (base >= minFaan) return { base, plans: [] }

  const candidates = [...close]
  const hasSuitGoal = close.some(c => c.name.includes('one suit')) ||
    have.some(h => h.name.includes('one suit') || h.name === 'All honours')
  if (!hasSuitGoal) {
    // even a long way off, one suit is the surest +3 — worth offering beside luck-based plans
    const far = farOneSuit(input)
    if (far && far.off <= 9) candidates.push(far)
  }

  // every combination of up to three compatible patterns, with or without a self-drawn win
  const plans: Plan[] = []
  const consider = (items: CloseTo[]) => {
    const total = base + items.reduce((n, c) => n + c.faan, 0)
    const off = items.reduce((n, c) => n + c.off, 0)
    if (total >= minFaan) plans.push({ items, selfDrawn: false, total, off })
    else if (total + 1 >= minFaan) plans.push({ items, selfDrawn: true, total: total + 1, off })
  }
  consider([])
  const n = candidates.length
  for (let i = 0; i < n; i++) {
    consider([candidates[i]])
    for (let j = i + 1; j < n; j++) {
      if (clash(candidates[i], candidates[j])) continue
      consider([candidates[i], candidates[j]])
      for (let k = j + 1; k < n; k++) {
        if (clash(candidates[i], candidates[k]) || clash(candidates[j], candidates[k])) continue
        consider([candidates[i], candidates[j], candidates[k]])
      }
    }
  }
  // easiest first: fewest tiles to change, then not relying on luck, then fewer steps, then more faan
  plans.sort((a, b) => a.off - b.off || Number(a.selfDrawn) - Number(b.selfDrawn) ||
    a.items.length - b.items.length || b.total - a.total)
  // drop plans that just add an extra pattern to an easier plan already listed — unless the easier
  // one needs a self-drawn win and this one doesn't (that's a genuinely different, surer route)
  const kept: Plan[] = []
  for (const p of plans) {
    const padded = kept.some(k => k.items.every(ki => p.items.includes(ki)) && k.items.length < p.items.length &&
      (!k.selfDrawn || p.selfDrawn))
    if (!padded) kept.push(p)
    if (kept.length === maxPlans) break
  }
  return { base, plans: kept }
}

// ---------- Bot AI ----------
// Bots only use what a player at the table could know: their own hand and flowers, plus every
// discard and exposed set. Each choice weighs three things:
//  - speed: how many tiles from ready the hand is (shanten), and how many unseen tiles would help;
//  - value: how far the hand is from the agreed minimum faan — a hand that can't be declared is no use;
//  - safety: when someone looks close to winning, avoid throwing what they may be waiting on.

// The 34 kinds of playing tile, in ALL_KEYS order: man 0–8, sou 9–17, pin 18–26, winds 27–30, dragons 31–33.
const KINDS = 34
function kindOf(t: Tile): number {
  if (isSuit(t.category)) return SUITS.indexOf(t.category) * 9 + t.value - 1
  return (t.category === 'wind' ? 27 : 31) + t.value
}
function kindCounts(tiles: Tile[]): number[] {
  const c = new Array<number>(KINDS).fill(0)
  for (const t of tiles) if (!isBonus(t)) c[kindOf(t)]++
  return c
}

// How many tiles away from ready a hand is: 0 = one tile from winning, −1 = already complete.
// Tries every split into sets, partial sets (pairs, two-tile runs) and loose tiles: a set is
// worth 2, a partial 1 (at most four sets + partials), and a pair kept as the eyes 1.
export function shanten(concealed: Tile[], meldCount = 0): number {
  return shantenOf(kindCounts(concealed), meldCount)
}
const ORPHAN_KINDS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]
function shantenOf(c: number[], meldCount: number): number {
  let best = 8 - 2 * meldCount
  if (meldCount === 0) {                              // thirteen orphans: 13 different, plus a pair of one
    const held = ORPHAN_KINDS.filter(k => c[k] > 0)
    best = Math.min(best, 13 - held.length - (held.some(k => c[k] > 1) ? 1 : 0))
  }
  const scan = (i: number, sets: number, partials: number, eyes: number) => {
    while (i < KINDS && c[i] === 0) i++
    if (i === KINDS) {
      best = Math.min(best, 8 - 2 * sets - Math.min(partials, 4 - sets) - eyes)
      return
    }
    const inSuit = i < 27, pos = i % 9
    const room = sets + partials < 4
    if (c[i] >= 3) { c[i] -= 3; scan(i, sets + 1, partials, eyes); c[i] += 3 }
    if (inSuit && pos <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--
      scan(i, sets + 1, partials, eyes)
      c[i]++; c[i + 1]++; c[i + 2]++
    }
    if (c[i] >= 2) {
      c[i] -= 2
      if (!eyes) scan(i, sets, partials, 1)
      if (room) scan(i, sets, partials + 1, eyes)
      c[i] += 2
    }
    if (room && inSuit) {
      for (const step of [1, 2]) {
        if (pos + step > 8 || !c[i + step]) continue
        c[i]--; c[i + step]--
        scan(i, sets, partials + 1, eyes)
        c[i]++; c[i + step]++
      }
    }
    c[i]--; scan(i, sets, partials, eyes); c[i]++      // or leave one copy as a loose tile
  }
  scan(0, meldCount, 0, 0)
  return best
}

// A tile can only help a hand if it matches, or sits within two of, a tile already held
// (or is a 1, 9 or honour, which can help thirteen orphans).
function near(c: number[], k: number): boolean {
  if (c[k] || ORPHAN_KINDS.includes(k)) return true
  if (k >= 27) return false
  const pos = k % 9
  return [-2, -1, 1, 2].some(d => pos + d >= 0 && pos + d <= 8 && c[k + d] > 0)
}

// Copies of each kind this seat can't see: not in its hand, not discarded, not in anyone's exposed sets.
function unseenCounts(game: GameState, seat: number): number[] {
  const c = new Array<number>(KINDS).fill(4)
  for (const t of [...game.hands[seat], ...game.discards.flat(), ...game.melds.flat(2)]) if (!isBonus(t)) c[kindOf(t)]--
  return c.map(n => Math.max(0, n))
}

// A seat's hand as the progress/scoring helpers want it (by default, as it stands).
export const progressInput = (game: GameState, seat: number, concealed = game.hands[seat], melds = game.melds[seat]): ProgressInput => ({
  concealed, melds, bonus: game.bonus[seat], seatWind: seatWind(game, seat), roundWind: game.roundWind,
  concealedKongs: game.concealedKongs[seat].length,
})

// Roughly how many tiles must change before the hand could reach the minimum (0 = it already does;
// relying on a self-drawn win counts as one more).
function faanGap(input: ProgressInput, minFaan: number): number {
  const { base, plans } = planToMinimum(input, minFaan, 1)
  if (base >= minFaan) return 0
  if (!plans.length) return 6
  return plans[0].off + (plans[0].selfDrawn ? 1 : 0)
}

interface HandValue { shanten: number; accept: number; gap: number }
const SHANTEN_W = 300, GAP_W = 350, ACCEPT_W = 2, KONG_BONUS = 50

// How well bots play. Hard is the full player above. Normal is less careful against a player
// close to winning and now and then throws a slightly worse tile. Easy plays like a beginner: rough
// throws (sometimes a step backwards), no defence, and little thought for the minimum faan.
export type BotLevel = 'easy' | 'normal' | 'hard'
interface Style { noise: number; caution: number; faanCare: number }
const STYLES: Record<BotLevel, Style> = {
  hard: { noise: 0, caution: 1, faanCare: 1 },
  normal: { noise: 480, caution: 0.2, faanCare: 0.6 },
  easy: { noise: 700, caution: 0, faanCare: 0.2 },
}
const worth = (v: HandValue, s: Style = STYLES.hard) => -SHANTEN_W * v.shanten - GAP_W * s.faanCare * v.gap + ACCEPT_W * v.accept
// A wobble added to each choice's worth: the bigger, the more often a worse choice wins. It's drawn
// from the state of the hand rather than pure chance, so asking a bot the same question twice (the
// table checks what bots would claim before asking the people) gets the same answer.
function wobbler(game: GameState, seat: number, s: Style): () => number {
  if (!s.noise) return () => 0
  let x = (game.wall.length * 7919 + seat * 104729 + game.discards.flat().length * 31 + game.hands[seat].length * 613 +
    game.dealer * 97 + game.roundWind * 389 + (game.wall[0] ? game.wall[0].value * 13 + game.wall[0].category.length * 7 : 0)) >>> 0   // (the tile at the far end varies it from hand to hand)
  return () => {                                       // mulberry32
    x = (x + 0x6d2b79f5) >>> 0
    let t = Math.imul(x ^ (x >>> 15), 1 | x)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * s.noise
  }
}

// Judge a hand waiting for its next tile. `accept` = unseen tiles that would bring it closer; once
// ready, only winning tiles that reach the minimum count (a third as much if it must be self-drawn).
function judge(game: GameState, seat: number, concealed: Tile[], melds: Tile[][], unseen: number[], minFaan: number): HandValue {
  const c = kindCounts(concealed)
  const sh = shantenOf(c, melds.length)
  let accept = 0
  if (sh === 0) {
    for (const w of winningTiles(concealed, melds.length)) {
      const n = unseen[kindOf(w)]
      if (!n) continue
      const faan = scoreHand({ ...progressInput(game, seat, [...concealed, w], melds), selfDrawn: false }).faan
      if (faan >= minFaan) accept += n
      else if (faan + 1 >= minFaan) accept += n / 3
    }
  } else {
    for (let k = 0; k < KINDS; k++) {
      if (!unseen[k] || !near(c, k)) continue
      c[k]++
      if (shantenOf(c, melds.length) < sh) accept += unseen[k]
      c[k]--
    }
  }
  const gap = faanGap(progressInput(game, seat, concealed, melds), minFaan)
  // ready, but nothing left that could be declared: really still a step away
  return { shanten: sh === 0 && accept === 0 ? 1 : sh, accept, gap }
}

// Best worth over every discard from a hand holding one tile too many.
function bestAfterDiscard(game: GameState, seat: number, hand: Tile[], melds: Tile[][], unseen: number[], minFaan: number) {
  const out: { i: number; value: HandValue }[] = []
  hand.forEach((t, i) => {
    if (hand.findIndex(o => sameTile(o, t)) !== i) return             // same kind as one already judged
    out.push({ i, value: judge(game, seat, [...hand.slice(0, i), ...hand.slice(i + 1)], melds, unseen, minFaan) })
  })
  return out
}

// How likely an opponent is to be close to winning, 0–1: exposed sets, and how late in the hand it is.
function threat(game: GameState, opp: number): number {
  const t = [0, 0.25, 0.6, 0.9, 1][Math.min(game.melds[opp].length, 4)]
  const left = game.wall.length
  return Math.min(1, t + (left < 15 ? 0.4 : left < 35 ? 0.2 : 0))
}
// How risky throwing a tile of kind `k` is against one opponent, 0–1.
function danger(game: GameState, opp: number, k: number, unseen: number[]): number {
  if (game.discards[opp].some(t => kindOf(t) === k)) return 0.1     // they threw one themselves — rarely their wait
  const live = unseen[k]
  if (k >= 27) return [0, 0.15, 0.5, 0.7][Math.min(live, 3)]        // an honour nobody else can pair is safe
  const pos = k % 9
  const edge = pos === 0 || pos === 8 ? 0.6 : pos === 1 || pos === 7 ? 0.8 : 1   // fewer runs end on 1/9
  return edge * (live === 0 ? 0.7 : 1)
}

// Which tile a bot throws from its full hand (an index into it).
export function botDiscard(game: GameState, seat: number, minFaan = 1, level: BotLevel = 'hard'): number {
  const style = STYLES[level], wobble = wobbler(game, seat, style)
  const hand = game.hands[seat]
  const unseen = unseenCounts(game, seat)
  const options = bestAfterDiscard(game, seat, hand, game.melds[seat], unseen, minFaan).map(({ i, value }) => {
    let risk = 0
    for (let opp = 0; opp < 4; opp++) if (opp !== seat) risk += threat(game, opp) * danger(game, opp, kindOf(hand[i]), unseen)
    return { i, value, risk }
  })
  // the further from ready, the more a bot plays safe
  const closest = Math.min(...options.map(o => o.value.shanten))
  const caution = (closest >= 2 ? 400 : closest === 1 ? 150 : 50) * style.caution
  const scored = options.map(o => ({ i: o.i, score: worth(o.value, style) - caution * o.risk + wobble() }))
  return scored.reduce((a, b) => (b.score > a.score ? b : a)).i
}

export interface Claim { kind: ClaimKind; run?: number[] }

// What a bot does with another seat's discard (wins are checked separately): claim only when the
// hand comes out ahead — closer to ready, without drifting from the minimum faan.
export function botClaim(game: GameState, seat: number, from: number, tile: Tile, minFaan = 1, level: BotLevel = 'hard'): Claim | null {
  const style = STYLES[level], wobble = wobbler(game, seat, style)
  const hand = game.hands[seat]
  const unseen = unseenCounts(game, seat)
  const options: Claim[] = []
  if (canKong(hand, tile)) options.push({ kind: 'kong' })
  if (canPong(hand, tile)) options.push({ kind: 'pong' })
  if (seat === (from + 1) % 4) for (const run of chowOptions(hand, tile)) options.push({ kind: 'chow', run })

  let best: Claim | null = null
  let bestWorth = worth(judge(game, seat, hand, game.melds[seat], unseen, minFaan), style) + wobble()   // passing
  for (const o of options) {
    const { concealed, meld } = claimedHand(hand, o.kind, tile, o.run)
    const melds = [...game.melds[seat], meld]
    // a kong is judged as it stands (a replacement tile comes next, a free extra draw); others after their best discard
    const w = wobble() + (o.kind === 'kong'
      ? worth(judge(game, seat, concealed, melds, unseen, minFaan), style) + KONG_BONUS
      : Math.max(...bestAfterDiscard(game, seat, concealed, melds, unseen, minFaan).map(d => worth(d.value, style))))
    if (w > bestWorth) { best = o; bestWorth = w }
  }
  return best
}

// Whether a bot declares a kong it could make on its own turn: yes, unless exposing it leaves the
// hand further from the minimum faan.
export function botWantsKong(game: GameState, seat: number, tile: Tile, minFaan = 1): boolean {
  const g: GameState = {
    ...game, hands: game.hands.map(h => [...h]), melds: game.melds.map(ms => ms.map(m => [...m])),
    concealedKongs: game.concealedKongs.map(k => [...k]),
  }
  declareKong(g, seat, tile)
  const gap = (s: GameState) => faanGap(progressInput(s, seat), minFaan)
  return gap(g) <= gap(game)
}
