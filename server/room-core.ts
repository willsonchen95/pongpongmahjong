// One online room: who sits where, the game they play, its timers, and what each player gets to see.
// Plain code with no Cloudflare in it — room.ts wraps it in a Durable Object (one per room, with live
// connections and storage), and the tests drive it directly.
//
// Players are known by a playerId their browser keeps, so a dropped connection can rejoin its seat.
// Seats go to people in the order they join; the first in is the host, who picks the rules and starts.
// Empty seats are played by bots. When someone drops out mid-game a bot plays their seat until they
// come back. The room runs the game at a steady pace (bots pause before moving) and never waits for
// ever: a person who doesn't act in time has a tile thrown for them, or passes.

import { Table, type Rules, type Answer, type Phase, type TableData, type TableEvent, type Match } from '../src/table'
import type { GameState, Tile } from '../src/engine'

export const BOT_NAMES = ['East bot', 'Mei', 'Kai', 'Lin']
export const INTRO_MS = 7000           // the deal being shown on everyone's screen
export const BOT_MS = 900              // a bot's pause before it moves, so people can follow
export const CLAIM_PAUSE_MS = 1100     // extra pause after someone takes a tile
export const TURN_MS = 30000           // a person's time to throw a tile
export const CLAIM_MS = 12000          // a person's time to decide on a tile they could take

export interface Seat { playerId: string; name: string; connected: boolean }
export interface RoomState {
  code: string
  hostId: string | null
  seats: (Seat | null)[]
  rules: Rules
  table: TableData | null              // the game, once started
  ready: string[]                      // players who've pressed "Next hand"
  wakeAt: number | null                // when the room next has something to do on its own
  pauseAfterClaim: boolean             // the next wait includes the pause after a tile was taken
}

// What a player may send.
export type ClientMsg =
  | { type: 'join'; playerId: string; name: string }
  | { type: 'start'; rules: Rules }                      // host only, in the lobby or after a match
  | { type: 'discard'; tile: number }                    // by tile id
  | { type: 'kong'; tile: number }
  | { type: 'answer'; answer: Answer }
  | { type: 'ready' }                                    // ready for the next hand

// What a player is told.
export interface SeatInfo { name: string; person: boolean; connected: boolean; host: boolean }
export type ServerMsg =
  | { type: 'room'; code: string; you: number | null; seats: SeatInfo[]; started: boolean; rules: Rules }
  | { type: 'state'; view: SeatView; events: TableEvent[] }
  | { type: 'error'; message: string }

// A player's view of the table: everything on the table, but only their own hand (everyone's is
// shown once the hand is over) and none of the wall.
export interface SeatView {
  seat: number
  match: Match
  game: GameState                      // other hands and the wall emptied out — see handCounts / wallCount
  handCounts: number[]
  wallCount: number
  phase: Phase                         // only this player's offer, and nobody's answers
  pool: Tile[]
  lastDiscard: number | null
  winFrom: number | null
  winTileId: number | null
  readyCount: number
  deadline: number | null              // when the room plays for you, if it's waiting on you
}

export interface Out { to: string; msg: ServerMsg }

export function newRoom(code: string, rules: Rules): RoomState {
  return { code, hostId: null, seats: [null, null, null, null], rules, table: null, ready: [], wakeAt: null, pauseAfterClaim: false }
}

export class RoomCore {
  s: RoomState
  private table: Table | null
  private pendingEvents: TableEvent[] = []

  constructor(state: RoomState) {
    this.s = state
    this.table = state.table ? Table.fromData(state.table) : null
  }

  private seatOf(playerId: string): number {
    return this.s.seats.findIndex(x => x?.playerId === playerId)
  }
  private people(): Seat[] { return this.s.seats.filter((x): x is Seat => !!x) }
  private connectedPeople(): Seat[] { return this.people().filter(x => x.connected) }

  // ---------- Messages from players ----------

  join(playerId: string, name: string, now: number): Out[] {
    name = name.trim().slice(0, 16) || 'Player'
    let seat = this.seatOf(playerId)
    if (seat < 0) {
      if (this.s.table) return [{ to: playerId, msg: { type: 'error', message: 'This game has already started.' } }]
      seat = this.s.seats.findIndex(x => !x)
      if (seat < 0) return [{ to: playerId, msg: { type: 'error', message: 'This room is full.' } }]
      this.s.seats[seat] = { playerId, name, connected: true }
    } else {
      this.s.seats[seat] = { ...this.s.seats[seat]!, name, connected: true }
    }
    if (!this.s.hostId || !this.connectedPeople().some(x => x.playerId === this.s.hostId)) this.s.hostId = playerId
    if (this.table) {                                        // back in the game: your seat is yours again
      this.table.humans[seat] = true
      this.schedule(now)
    }
    return [...this.lobbyToAll(), ...this.statesToAll()]
  }

  leave(playerId: string, now: number): Out[] {
    const seat = this.seatOf(playerId)
    if (seat < 0) return []
    if (!this.table) {
      this.s.seats[seat] = null                              // in the lobby the seat simply frees up
    } else {
      this.s.seats[seat]!.connected = false
      this.table.humans[seat] = false                         // a bot plays for them until they're back
      this.table.autoPlay(seat)                               // if it was waiting on them, carry on
      this.collect()
      this.schedule(now)
    }
    if (this.s.hostId === playerId) this.s.hostId = this.connectedPeople()[0]?.playerId ?? null
    this.s.ready = this.s.ready.filter(id => id !== playerId)
    return [...this.lobbyToAll(), ...this.statesToAll()]
  }

  handle(playerId: string, m: ClientMsg, now: number): Out[] {
    if (m.type === 'join') return this.join(playerId, m.name, now)
    const seat = this.seatOf(playerId)
    if (seat < 0) return [{ to: playerId, msg: { type: 'error', message: 'Join the room first.' } }]
    const t = this.table
    if (m.type === 'start') {
      if (playerId !== this.s.hostId) return [{ to: playerId, msg: { type: 'error', message: 'Only the host can start.' } }]
      if (t && !t.match.over) return [{ to: playerId, msg: { type: 'error', message: 'A game is already under way.' } }]
      this.s.rules = m.rules
      this.table = new Table(m.rules, this.s.seats.map(x => !!x?.connected))
      this.newHand(now)
      return [...this.lobbyToAll(), ...this.statesToAll()]
    }
    if (!t) return [{ to: playerId, msg: { type: 'error', message: 'The game hasn’t started yet.' } }]
    let ok = true
    if (m.type === 'discard' || m.type === 'kong') {
      const tile = t.game.hands[seat].find(x => x.id === m.tile)
      ok = !!tile && (m.type === 'discard' ? t.discard(seat, tile) : t.kong(seat, tile))
    } else if (m.type === 'answer') {
      ok = t.answer(seat, m.answer)
    } else if (m.type === 'ready') {
      if (t.phase.kind !== 'over' || t.match.over) return []
      if (!this.s.ready.includes(playerId)) this.s.ready.push(playerId)
      if (this.connectedPeople().every(x => this.s.ready.includes(x.playerId))) this.newHand(now)
      return this.statesToAll()
    }
    if (!ok) return [{ to: playerId, msg: { type: 'error', message: 'That move isn’t possible right now.' } }]
    this.collect()
    this.schedule(now)
    return this.statesToAll()
  }

  // ---------- The room running the game ----------

  // The room's own clock: called when wakeAt arrives. Does whatever was waiting (a bot's move, the
  // end of the deal, someone running out of time), then plays on to the next wait.
  tick(now: number): Out[] {
    const t = this.table
    if (!t || this.s.wakeAt === null || now < this.s.wakeAt) return []
    this.s.wakeAt = null
    this.s.pauseAfterClaim = false
    const p = t.phase
    if (p.kind === 'dealing') t.begin()
    else if (p.kind === 'turn' && !t.humans[p.seat]) t.botMove()
    else for (const seat of t.waitingFor()) t.autoPlay(seat)    // out of time
    this.collect()
    this.schedule(now)
    return this.statesToAll()
  }

  private newHand(now: number) {
    const t = this.table!
    t.newHand()
    t.humans = this.s.seats.map(x => !!x?.connected)
    this.s.ready = []
    this.collect()
    this.s.wakeAt = now + INTRO_MS
  }

  // Run the table's instant steps (starting turns, offering a discard round) and gather their events.
  private collect() {
    const t = this.table
    if (!t) return
    for (let i = 0; i < 50; i++) {
      const p = t.phase
      if (p.kind === 'next') t.startTurn()
      else if (p.kind === 'discarded') {
        if (t.afterDiscard() !== null && (t.phase as Phase).kind === 'next') this.s.pauseAfterClaim = true
      } else break
    }
    this.pendingEvents.push(...t.takeEvents())
    this.s.table = t.toData()
  }

  // When the room should next act by itself, given what the table is waiting for. Nobody connected:
  // the game simply waits for someone to come back.
  private schedule(now: number) {
    const t = this.table
    if (!t || !this.connectedPeople().length) { this.s.wakeAt = null; return }
    const p = t.phase
    const pause = this.s.pauseAfterClaim ? CLAIM_PAUSE_MS : 0
    if (p.kind === 'dealing') this.s.wakeAt ??= now + INTRO_MS
    else if (p.kind === 'turn' && !t.humans[p.seat]) this.s.wakeAt = now + BOT_MS + pause
    else if (p.kind === 'turn') this.s.wakeAt = now + TURN_MS + pause
    else if (p.kind === 'claims') this.s.wakeAt = now + CLAIM_MS
    else this.s.wakeAt = null                                  // over: waits for "Next hand"
  }

  // ---------- What each player is told ----------

  private lobbyToAll(): Out[] {
    return this.connectedPeople().map(p => ({ to: p.playerId, msg: this.lobbyFor(p.playerId) }))
  }

  lobbyFor(playerId: string): ServerMsg {
    const you = this.seatOf(playerId)
    const seats: SeatInfo[] = this.s.seats.map((x, i) => x
      ? { name: x.name, person: true, connected: x.connected, host: x.playerId === this.s.hostId }
      : { name: BOT_NAMES[i], person: false, connected: false, host: false })
    return { type: 'room', code: this.s.code, you: you < 0 ? null : you, seats, started: !!this.table, rules: this.s.rules }
  }

  private statesToAll(): Out[] {
    const events = this.pendingEvents
    this.pendingEvents = []
    if (!this.table) return []
    return this.connectedPeople().map(p => {
      const seat = this.seatOf(p.playerId)
      return { to: p.playerId, msg: { type: 'state', view: this.viewFor(seat), events: events.filter(e => e.type !== 'yourTurn' || e.seat === seat) } }
    })
  }

  viewFor(seat: number): SeatView {
    const t = this.table!
    const g = t.game
    const shown = (i: number) => i === seat || g.over
    const game: GameState = {
      ...g,
      wall: [],
      hands: g.hands.map((h, i) => (shown(i) ? h : [])),
      drawn: g.current === seat ? g.drawn : null,
    }
    let phase = t.phase
    if (phase.kind === 'claims') {
      phase = { ...phase, offers: phase.offers.map((o, i) => (i === seat ? o : null)), answers: phase.answers.map((a, i) => (i === seat ? a : null)) }
    }
    const waiting = t.waitingFor().includes(seat)
    return {
      seat, match: t.match, game, phase,
      handCounts: g.hands.map(h => h.length),
      wallCount: g.wall.length,
      pool: t.pool, lastDiscard: t.lastDiscard, winFrom: t.winFrom, winTileId: t.winTile?.id ?? null,
      readyCount: this.s.ready.length,
      deadline: waiting ? this.s.wakeAt : null,
    }
  }
}
