// Playing in an online room: the connection to the room server (server/), and turning what it sends
// into the shape the table screen already understands. The server numbers seats 0–3 round the table;
// on screen you're always at the bottom, seat 0 — so everything is turned round to put you there.

import type { ServerMsg, ClientMsg, SeatView, SeatInfo } from '../server/room-core'
import type { Rules, Phase, Match, TableEvent } from './table'
import { makeTile, type GameState, type Tile } from './engine'

export type { SeatInfo }
export { REACTIONS, PHRASES, TURN_MS } from '../server/room-core'

// Where the room server is: while developing on this computer or its home network, the local
// `npm run server:dev` on port 8787; otherwise the live one on Cloudflare (`npm run server:deploy`).
// VITE_ROOM_SERVER, set at build time, overrides both.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)$/
const LIVE_ROOM_SERVER = 'wss://pongpongmahjong-rooms.willsonchen95.workers.dev'
export const ROOM_SERVER: string = import.meta.env.VITE_ROOM_SERVER
  || (LOCAL_HOST.test(location.hostname) ? `ws://${location.hostname}:8787` : LIVE_ROOM_SERVER)

// Room codes: five letters/digits, leaving out ones easily mixed up (0/O, 1/I).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ROOM_CODE = /^[A-Z2-9]{5}$/
export function newRoomCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), b => CODE_CHARS[b % CODE_CHARS.length]).join('')
}

// This browser's player id, kept so a dropped connection (or a reload) gets its seat back.
// (Made from getRandomValues: randomUUID only exists on https pages, and while testing on a phone the
// game is opened over plain http on the home network.)
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
export function playerId(): string {
  const KEY = 'mahjong-player-id'
  try {
    let id = localStorage.getItem(KEY)
    if (!id) { id = randomId(); localStorage.setItem(KEY, id) }
    return id
  } catch { return randomId() }
}

// The room you're in, remembered so the menu can offer to take you back after a reload.
const SESSION_KEY = 'mahjong-online'
export interface Session { code: string; name: string }
export function savedSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') } catch { return null }
}
function saveSession(s: Session | null) {
  try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY) } catch { /* fine */ }
}

// ---------- Turning the table round so you're at the bottom ----------

// What the screen needs, from your seat's point of view (you = seat 0).
export interface LocalView {
  match: Match
  game: GameState
  phase: Phase
  pool: Tile[]
  lastDiscard: number | null
  winFrom: number | null
  winTileId: number | null
  handCounts: number[]
  readyCount: number
  deadline: number | null              // on this device's clock: when the room plays for you
  turnDeadline: number | null          // on this device's clock: when whoever's turn it is runs out of time
}

const rot = <T>(a: T[], me: number): T[] => [0, 1, 2, 3].map(i => a[(i + me) % 4])
const seat = (s: number, me: number) => (s - me + 4) % 4
const seatOrNull = (s: number | null, me: number) => (s === null ? null : seat(s, me))
const HIDDEN = makeTile('man', 1)    // stands in for each unseen wall tile (only the count is used)

export function turnView(v: SeatView, serverNow: number): LocalView {
  const me = v.seat
  const g = v.game
  const game: GameState = {
    ...g,
    dealer: seat(g.dealer, me), current: seat(g.current, me), winner: seatOrNull(g.winner, me),
    hands: rot(g.hands, me), melds: rot(g.melds, me), concealedKongs: rot(g.concealedKongs, me),
    discards: rot(g.discards, me), bonus: rot(g.bonus, me),
    wall: Array.from({ length: v.wallCount }, () => HIDDEN),
  }
  // the drawn tile arrives as a copy: point it at the very tile in your hand, so it's set apart (not shown twice)
  if (game.drawn) game.drawn = game.hands[0].find(t => t.id === game.drawn!.id) ?? null
  const m = v.match
  const match: Match = {
    ...m, scores: rot(m.scores, me), dealer: seat(m.dealer, me), bust: seatOrNull(m.bust, me),
    result: m.result && { ...m.result, winner: seatOrNull(m.result.winner, me), from: seatOrNull(m.result.from, me), deltas: rot(m.result.deltas, me) },
  }
  const p = v.phase
  const phase: Phase =
    p.kind === 'next' || p.kind === 'turn' || p.kind === 'discarded' ? { ...p, seat: seat(p.seat, me) }
    : p.kind === 'claims' ? { ...p, from: seat(p.from, me), offers: rot(p.offers, me).map(o => o && { ...o, from: seat(o.from, me) }), answers: rot(p.answers, me) }
    : p
  return {
    match, game, phase, pool: v.pool, lastDiscard: seatOrNull(v.lastDiscard, me), winFrom: seatOrNull(v.winFrom, me),
    winTileId: v.winTileId, handCounts: rot(v.handCounts, me), readyCount: v.readyCount,
    deadline: v.deadline === null ? null : v.deadline - serverNow + Date.now(),
    turnDeadline: v.turnDeadline == null ? null : v.turnDeadline - serverNow + Date.now(),
  }
}

export function turnEvents(events: TableEvent[], me: number): TableEvent[] {
  return events.map(e => {
    if (e.type === 'exhausted') return e
    if (e.type === 'win') return { ...e, seat: seat(e.seat, me), from: seatOrNull(e.from, me) }
    return { ...e, seat: seat(e.seat, me) }
  })
}

// ---------- The connection ----------

export class OnlineRoom {
  readonly code: string
  name: string
  readonly playerId = playerId()
  room: Extract<ServerMsg, { type: 'room' }> | null = null
  view: LocalView | null = null
  connected = false
  private ws: WebSocket | null = null
  private closing = false
  private retry = 0

  onRoom: () => void = () => {}
  onState: (view: LocalView, events: TableEvent[]) => void = () => {}
  onError: (message: string) => void = () => {}
  onConnection: () => void = () => {}
  onReact: (seat: number, emoji: string) => void = () => {}   // seat as on screen (you = 0)

  constructor(code: string, name: string) {
    this.code = code
    this.name = name
  }

  // Your seat round the table (as the server numbers it), once you've joined.
  get seat(): number | null { return this.room?.you ?? null }

  // The seats turned round so you're first, with you called "You".
  names(): string[] {
    const r = this.room
    if (!r || r.you === null) return ['You', 'Mei', 'Kai', 'Lin']
    // someone who's dropped out is played by a bot until they're back
    // (and someone who arrived mid-game is played by one until the next hand)
    return rot(r.seats, r.you).map((s, i) => (i === 0 ? 'You' : s.person && (!s.connected || s.away) ? `${s.name} (away)`
      : s.joining ? `${s.name} (next hand)` : s.name))
  }

  // Whether you timed out too often and a bot is playing your seat until you say you're back.
  get away(): boolean {
    const r = this.room
    return !!r && r.you !== null && r.seats[r.you].away
  }

  // Whether you arrived mid-game: you watch while a bot finishes this hand, and play from the next.
  get joining(): boolean {
    const r = this.room
    return !!r && r.you !== null && r.seats[r.you].joining
  }

  connect() {
    this.closing = false
    saveSession({ code: this.code, name: this.name })
    const ws = new WebSocket(`${ROOM_SERVER}/rooms/${this.code}/ws?player=${encodeURIComponent(this.playerId)}`)
    this.ws = ws
    ws.onopen = () => {
      this.connected = true
      this.retry = 0
      this.send({ type: 'join', playerId: this.playerId, name: this.name })
      this.onConnection()
    }
    ws.onmessage = ev => {
      const m: ServerMsg = JSON.parse(ev.data)
      if (m.type === 'room') { this.room = m; this.onRoom() }
      else if (m.type === 'state') {
        this.view = turnView(m.view, m.now)
        this.onState(this.view, turnEvents(m.events, m.view.seat))
      } else if (m.type === 'react') {
        if (this.seat !== null) this.onReact(seat(m.seat, this.seat), m.emoji)
      } else if (m.type === 'error') this.onError(m.message)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.connected = false
      this.onConnection()
      if (this.closing) return
      // dropped: try again, waiting a little longer each time (up to 10s)
      const wait = Math.min(10000, 1000 * 2 ** this.retry++)
      setTimeout(() => { if (!this.closing) this.connect() }, wait)
    }
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  start(rules: Rules) { this.send({ type: 'start', rules }) }
  react(emoji: string) { this.send({ type: 'react', emoji }) }
  back() { this.send({ type: 'back' }) }

  // Leave the room for good (a bot takes your seat; you can still come back with the code).
  leave() {
    this.closing = true
    saveSession(null)
    this.ws?.close()
  }
}
