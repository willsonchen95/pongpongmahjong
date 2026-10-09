// Your record: the games you've finished and the hands you've won — kept on this device only, never
// sent anywhere. History, personal bests and a set of challenges to collect. The rules here are plain
// functions over a record (no screen code), so they can be tested; main.ts tells them what happened
// and record-page.ts shows the result.

import type { BotLevel, Category, Tile } from './engine'
import type { Style } from './table'

// A finished game, as it went for you.
export interface GameEntry {
  at: number                          // when it finished
  style: Style
  bots: BotLevel
  online: boolean
  minFaan: number
  rounds: number                      // 1 = the East round, 4 = a full game
  hands: number                       // hands played
  early: boolean                      // ended early by the players
  place: number                       // 1 – 4 (a shared place counts as the higher one)
  wins: number                        // hands you won
  points: number | null               // points won or lost (Hong Kong style; null in Family style)
}

// Your biggest winning hand: its faan, the patterns, and the tiles (sets, then the rest, then flowers).
export interface BestHand {
  faan: number
  limit: boolean
  items: { name: string; faan: number }[]
  groups: [Category, number][][]
  at: number
}

export interface PlayerRecord {
  v: 1
  games: GameEntry[]                  // newest first, the last MAX_GAMES
  handsPlayed: number
  handsWon: number
  streak: number                      // hands won in a row, now
  bestStreak: number
  best: BestHand | null
  challenges: Partial<Record<string, number>>   // challenge id → when it was completed
  counted: string[]                   // the last hands and games counted, so a reload never counts one twice
}

const MAX_GAMES = 50
const MAX_COUNTED = 40

export const emptyRecord = (): PlayerRecord => ({
  v: 1, games: [], handsPlayed: 0, handsWon: 0, streak: 0, bestStreak: 0, best: null, challenges: {}, counted: [],
})

// What happened in a hand, as main.ts sees it.
export interface HandInfo {
  winner: 'you' | 'other' | 'nobody'
  faan: number
  limit: boolean
  items: { name: string; faan: number }[]
  groups: Tile[][]                    // your winning hand, as shown on the result card
  online: boolean
  at?: number
}
// …and in a finished game.
export type GameInfo = Omit<GameEntry, 'at'> & { at?: number }

// ---------- Challenges ----------
// Calm goals to collect, like stamps: each is checked when you win a hand or finish a game.
interface Challenge {
  id: string
  title: string
  hint: string                        // how to get it
  hand?: (h: HandInfo, r: PlayerRecord) => boolean
  game?: (g: GameInfo) => boolean
}
const has = (h: HandInfo, ...names: string[]) => h.items.some(i => names.includes(i.name))
const won = (h: HandInfo) => h.winner === 'you'
// (a game won outright: first place, played to its end)
const firstPlace = (g: GameInfo) => g.place === 1 && !g.early

export const CHALLENGES: Challenge[] = [
  { id: 'first-win', title: 'First win', hint: 'Win a hand', hand: won },
  { id: 'self-drawn', title: 'From the wall', hint: 'Win by drawing the winning tile yourself', hand: h => won(h) && has(h, 'Self-drawn') },
  { id: 'concealed', title: 'Keeping it quiet', hint: 'Win with a concealed hand — no claimed sets', hand: h => won(h) && has(h, 'Concealed hand') },
  { id: 'three-faan', title: 'Three faan', hint: 'Win a hand worth 3 faan or more', hand: h => won(h) && h.faan >= 3 },
  { id: 'five-faan', title: 'Five faan', hint: 'Win a hand worth 5 faan or more', hand: h => won(h) && h.faan >= 5 },
  { id: 'all-pongs', title: 'All pongs', hint: 'Win with every set three of a kind', hand: h => won(h) && has(h, 'All pongs') },
  { id: 'one-suit', title: 'One suit', hint: 'Win with Mixed or Pure one suit', hand: h => won(h) && has(h, 'Mixed one suit', 'Pure one suit') },
  { id: 'pure-suit', title: 'Pure one suit', hint: 'Win with every tile from one suit', hand: h => won(h) && has(h, 'Pure one suit') },
  { id: 'dragons', title: 'Three dragons', hint: 'Win with Small or Big three dragons', hand: h => won(h) && has(h, 'Small three dragons', 'Big three dragons') },
  { id: 'limit', title: 'Limit hand', hint: 'Win a hand at the limit (10 faan)', hand: h => won(h) && h.limit },
  { id: 'streak-3', title: 'Three in a row', hint: 'Win three hands in a row', hand: (h, r) => won(h) && r.streak >= 3 },
  { id: 'online-win', title: 'With friends', hint: 'Win a hand in an online game', hand: h => won(h) && h.online },
  { id: 'first-game', title: 'A whole game', hint: 'Play a game to its end', game: g => !g.early },
  { id: 'beat-normal', title: 'Steady hands', hint: 'Finish first against Normal bots', game: g => firstPlace(g) && !g.online && g.bots === 'normal' },
  { id: 'beat-hard', title: 'Sharp play', hint: 'Finish first against Hard bots', game: g => firstPlace(g) && !g.online && g.bots === 'hard' },
  { id: 'full-game', title: 'Four winds', hint: 'Play a full game — all four wind rounds — to its end', game: g => g.rounds === 4 && !g.early },
  { id: 'family-five', title: 'High bar', hint: 'Finish first in a Family game with a minimum of 5 faan or more', game: g => firstPlace(g) && g.style === 'family' && g.minFaan >= 5 },
]

// ---------- Counting ----------
const counted = (r: PlayerRecord, key: string) => r.counted.includes(key)
function markCounted(r: PlayerRecord, key: string) {
  r.counted.push(key)
  if (r.counted.length > MAX_COUNTED) r.counted.splice(0, r.counted.length - MAX_COUNTED)
}
function award(r: PlayerRecord, at: number, done: (c: Challenge) => boolean): Challenge[] {
  const fresh = CHALLENGES.filter(c => !r.challenges[c.id] && done(c))
  for (const c of fresh) r.challenges[c.id] = at
  return fresh
}

// A hand has finished (`key` names it, so the same hand is only ever counted once). Changes the
// record; returns the challenges it completed.
export function noteHand(r: PlayerRecord, key: string, h: HandInfo): Challenge[] {
  if (counted(r, key)) return []
  markCounted(r, key)
  const at = h.at ?? Date.now()
  r.handsPlayed++
  if (h.winner === 'you') {
    r.handsWon++
    r.streak++
    r.bestStreak = Math.max(r.bestStreak, r.streak)
    if (!r.best || h.faan > r.best.faan) {
      r.best = { faan: h.faan, limit: h.limit, items: h.items.map(i => ({ name: i.name, faan: i.faan })),
        groups: h.groups.map(g => g.map(t => [t.category, t.value] as [Category, number])), at }
    }
  } else if (h.winner === 'other') {
    r.streak = 0                      // (a draw doesn't break a run)
  }
  return award(r, at, c => !!c.hand?.(h, r))
}

// A game has finished. Changes the record; returns the challenges it completed.
export function noteGame(r: PlayerRecord, key: string, g: GameInfo): Challenge[] {
  if (counted(r, key)) return []
  markCounted(r, key)
  const at = g.at ?? Date.now()
  r.games.unshift({ ...g, at })
  if (r.games.length > MAX_GAMES) r.games.length = MAX_GAMES
  return award(r, at, c => !!c.game?.(g))
}

// Games and first places against each bot level (online games aside).
export function byLevel(r: PlayerRecord): Record<BotLevel, { games: number; first: number }> {
  const out = { easy: { games: 0, first: 0 }, normal: { games: 0, first: 0 }, hard: { games: 0, first: 0 } }
  for (const g of r.games) {
    if (g.online || g.early) continue
    out[g.bots].games++
    if (g.place === 1) out[g.bots].first++
  }
  return out
}

// ---------- Kept on this device ----------
const KEY = 'mahjong-record-v1'

// The record as saved — checked, since it may be from an older version or garbled: anything that
// doesn't look right is dropped rather than breaking the page.
export function loadRecord(): PlayerRecord {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!raw || raw.v !== 1) return emptyRecord()
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0)
    const r = emptyRecord()
    r.handsPlayed = num(raw.handsPlayed)
    r.handsWon = Math.min(num(raw.handsWon), r.handsPlayed)
    r.streak = num(raw.streak)
    r.bestStreak = Math.max(num(raw.bestStreak), r.streak)
    r.games = Array.isArray(raw.games) ? raw.games.filter((g: GameEntry) => g && typeof g.at === 'number' && typeof g.place === 'number').slice(0, MAX_GAMES) : []
    r.best = raw.best && typeof raw.best.faan === 'number' && Array.isArray(raw.best.groups) && Array.isArray(raw.best.items) ? raw.best : null
    if (raw.challenges && typeof raw.challenges === 'object') {
      for (const c of CHALLENGES) if (typeof raw.challenges[c.id] === 'number') r.challenges[c.id] = raw.challenges[c.id]
    }
    r.counted = Array.isArray(raw.counted) ? raw.counted.filter((k: unknown) => typeof k === 'string').slice(-MAX_COUNTED) : []
    return r
  } catch { return emptyRecord() }
}
export function saveRecord(r: PlayerRecord) {
  try { localStorage.setItem(KEY, JSON.stringify(r)) } catch { /* storage unavailable or full — the record just isn't kept */ }
}
export function clearRecord() {
  try { localStorage.removeItem(KEY) } catch { /* fine */ }
}
