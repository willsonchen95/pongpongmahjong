// One online room: who sits where, the game they play, its timers, and what each player gets to see.
// Plain code with no Cloudflare in it — room.ts wraps it in a Durable Object (one per room, with live
// connections and storage), and the tests drive it directly.
//
// Players are known by a playerId their browser keeps, so a dropped connection can rejoin its seat.
// Seats go to people in the order they join; the first in is the host, who picks the rules and starts.
// Empty seats are played by bots. Someone arriving mid-game takes a bot's seat (and its points) from
// the next hand; until then the bot plays on. When someone drops out mid-game a bot plays their seat
// until they come back. The room runs the game at a steady pace (bots pause before moving) and never waits for
// ever: a person who doesn't act in time has a tile thrown for them, or passes.

import { Table, type Rules, type Answer, type Phase, type TableData, type TableEvent, type Match } from '../src/table'
import type { GameState, Tile } from '../src/engine'

export const BOT_NAMES = ['East bot', 'Mei', 'Kai', 'Lin']
export const INTRO_MS = 7000           // the deal being shown on everyone's screen
export const BOT_MS = 900              // a bot's pause before it moves, so people can follow
export const CLAIM_PAUSE_MS = 1100     // extra pause after someone takes a tile
export const TURN_MS = 15000           // a person's time to throw a tile
export const CLAIM_MS = 12000          // a person's time to decide on a tile they could take

export const AWAY_AFTER = 2            // timeouts in a row before a bot takes over the seat
// away: timed out AWAY_AFTER times in a row, so a bot plays for them until they say they're back
// (timeouts counts the ones in a row; anything they do resets it)
// joining: arrived mid-game; a bot finishes the hand for them and the seat is theirs from the next one
export interface Seat { playerId: string; name: string; connected: boolean; away?: boolean; timeouts?: number; joining?: boolean }
export interface RoomState {
  code: string
  hostId: string | null
  seats: (Seat | null)[]
  rules: Rules
  table: TableData | null              // the game, once started
  ready: string[]                      // players who've pressed "Next hand"
  wakeAt: number | null                // when the room next has something to do on its own
  waitKey?: string | null              // which wait on people wakeAt belongs to (see schedule)
  pauseAfterClaim: boolean             // the next wait includes the pause after a tile was taken
  reactedAt?: Record<string, number>   // when each player last sent a reaction (they're limited to one a second)
}

// What a player may send.
export type ClientMsg =
  | { type: 'join'; playerId: string; name: string }
  | { type: 'start'; rules: Rules }                      // host only, in the lobby or after a match
  | { type: 'discard'; tile: number }                    // by tile id
  | { type: 'kong'; tile: number }
  | { type: 'answer'; answer: Answer }
  | { type: 'ready' }                                    // ready for the next hand
  | { type: 'react'; emoji: string }                     // one of REACTIONS or PHRASES, shown to everyone
  | { type: 'back' }                                     // back after being away: take your seat from the bot
  | { type: 'leave' }                                    // pressed Leave (not just a dropped connection): the host leaving closes the room

// Quick reactions and chat phrases people can send during a game (only these, at most one a second each).
export const REACTIONS = ['👍', '😂', '😮', '😭', '😡', '🎉']
export const PHRASES = ['Nice one!', 'So lucky!', 'Hurry up 😄', 'Oops!', 'Thanks!', 'Good game!']
export const REACT_GAP_MS = 1000

// What a player is told.
export interface SeatInfo { name: string; person: boolean; connected: boolean; host: boolean; away: boolean; joining: boolean }
export type ServerMsg =
  | { type: 'room'; code: string; you: number | null; seats: SeatInfo[]; started: boolean; rules: Rules }
  | { type: 'state'; view: SeatView; events: TableEvent[]; now: number }   // now: the room's clock, for countdowns
  | { type: 'error'; message: string }
  | { type: 'react'; seat: number; emoji: string }
  | { type: 'closed'; host: string }                     // the host left, so the room closed: back to the menu

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
  turnDeadline: number | null          // when the person whose turn it is runs out of time (everyone sees it)
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
      // newcomers take a free seat: in the lobby, between games, or mid-game from the next hand
      seat = this.s.seats.findIndex(x => !x)
      if (seat < 0) return [{ to: playerId, msg: { type: 'error', message: 'This room is full.' } }]
      const midGame = !!this.table && !this.table.match.over
      this.s.seats[seat] = { playerId, name, connected: true, ...(midGame ? { joining: true } : {}) }
    } else {
      this.s.seats[seat] = { ...this.s.seats[seat]!, name, connected: true, away: false, timeouts: 0 }   // reconnecting counts as being back
    }
    if (!this.s.hostId || !this.connectedPeople().some(x => x.playerId === this.s.hostId)) this.s.hostId = playerId
    if (this.table) {                                        // back in the game: your seat is yours again (unless still joining)
      this.table.humans[seat] = this.plays(this.s.seats[seat])
      this.schedule(now)
    }
    return [...this.lobbyToAll(), ...this.statesToAll(now)]
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
    return [...this.lobbyToAll(), ...this.statesToAll(now)]
  }

  handle(playerId: string, m: ClientMsg, now: number): Out[] {
    if (m.type === 'join') return this.join(playerId, m.name, now)
    const seat = this.seatOf(playerId)
    if (seat < 0) return m.type === 'leave' ? [] : [{ to: playerId, msg: { type: 'error', message: 'Join the room first.' } }]
    if (m.type === 'leave') return playerId === this.s.hostId ? this.close(playerId) : this.leave(playerId, now)
    if (m.type === 'react') {                                // everyone sees it float up from that seat
      const reacted = (this.s.reactedAt ??= {})
      if (![...REACTIONS, ...PHRASES].includes(m.emoji) || now - (reacted[playerId] ?? -Infinity) < REACT_GAP_MS) return []
      reacted[playerId] = now
      return this.connectedPeople().map(p => ({ to: p.playerId, msg: { type: 'react', seat, emoji: m.emoji } }))
    }
    const t = this.table
    if (m.type === 'start') {
      if (playerId !== this.s.hostId) return [{ to: playerId, msg: { type: 'error', message: 'Only the host can start.' } }]
      if (t && !t.match.over) return [{ to: playerId, msg: { type: 'error', message: 'A game is already under way.' } }]
      this.s.rules = m.rules
      // a new game after one finished: anyone who left in the meantime gives up their seat
      if (t) this.s.seats = this.s.seats.map(x => (x?.connected ? x : null))
      this.table = new Table(m.rules, this.s.seats.map(x => this.plays(x)))
      this.newHand(now)
      return [...this.lobbyToAll(), ...this.statesToAll(now)]
    }
    if (!t) return [{ to: playerId, msg: { type: 'error', message: 'The game hasn’t started yet.' } }]
    const person = this.s.seats[seat]!
    if (person.joining && m.type !== 'ready') return []      // watching until the next hand: the bot has their seat
    if (m.type === 'back') {                                 // back at the table: the seat is theirs again
      person.away = false
      person.timeouts = 0
      t.humans[seat] = true
      this.collect()
      this.schedule(now)
      return [...this.lobbyToAll(), ...this.statesToAll(now)]
    }
    person.timeouts = 0                                      // they're here: the timeouts in a row start over
    let ok = true
    if (m.type === 'discard' || m.type === 'kong') {
      const tile = t.game.hands[seat].find(x => x.id === m.tile)
      ok = !!tile && (m.type === 'discard' ? t.discard(seat, tile) : t.kong(seat, tile))
    } else if (m.type === 'answer') {
      ok = t.answer(seat, m.answer)
    } else if (m.type === 'ready') {
      if (t.phase.kind !== 'over' || t.match.over) return []
      if (!this.s.ready.includes(playerId)) this.s.ready.push(playerId)
      const wasAway = !!person.away
      person.away = false                                    // pressing it means they're back
      // (someone away isn't waited for: they'd hold up everyone)
      const joiners = this.people().some(x => x.joining)
      if (this.connectedPeople().filter(x => !x.away).every(x => this.s.ready.includes(x.playerId))) this.newHand(now)
      const seatsChanged = wasAway || (joiners && !this.people().some(x => x.joining))   // (newcomers now play their seats)
      return [...(seatsChanged ? this.lobbyToAll() : []), ...this.statesToAll(now)]
    }
    if (!ok) return [{ to: playerId, msg: { type: 'error', message: 'That move isn’t possible right now.' } }]
    this.collect()
    this.schedule(now)
    return this.statesToAll(now)
  }

  // The host left for good: everyone else is sent back to the menu, and the room starts over empty
  // (its code works again for a brand-new room).
  private close(hostId: string): Out[] {
    const host = this.s.seats[this.seatOf(hostId)]?.name ?? 'The host'
    const others = this.connectedPeople().filter(p => p.playerId !== hostId)
    this.s = newRoom(this.s.code, this.s.rules)
    this.table = null
    this.pendingEvents = []
    return others.map(p => ({ to: p.playerId, msg: { type: 'closed', host } }))
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
    let wentAway = false
    if (p.kind === 'dealing') t.begin()
    else if (p.kind === 'turn' && !t.humans[p.seat]) t.botMove()
    else {
      // out of time: the room plays for them. Running out on their own turn AWAY_AFTER times in a row
      // means they've left the table for now: a bot takes the seat, so nobody waits on them each turn.
      const turnOf = p.kind === 'turn' ? p.seat : null
      for (const seat of t.waitingFor()) {
        t.autoPlay(seat)
        const person = this.s.seats[seat]
        if (seat !== turnOf || !person) continue
        person.timeouts = (person.timeouts ?? 0) + 1
        if (person.timeouts >= AWAY_AFTER) { person.away = true; t.humans[seat] = false; wentAway = true }
      }
    }
    this.collect()
    this.schedule(now)
    return [...(wentAway ? this.lobbyToAll() : []), ...this.statesToAll(now)]
  }

  // Whether a seat is played by its person right now (rather than a bot).
  private plays(x: Seat | null): boolean { return !!x?.connected && !x.away && !x.joining }

  private newHand(now: number) {
    const t = this.table!
    t.newHand()
    for (const x of this.s.seats) if (x) delete x.joining      // anyone who arrived during the last hand plays from now
    t.humans = this.s.seats.map(x => this.plays(x))
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
    // a wait on people keeps its deadline while it's the same wait (one person answering a claim
    // doesn't give the others more time, nor does someone reconnecting)
    const keep = (key: string, ms: number) => {
      if (this.s.waitKey !== key || this.s.wakeAt === null) this.s.wakeAt = now + ms
      this.s.waitKey = key
    }
    if (p.kind === 'turn' && t.humans[p.seat]) return keep(`turn:${p.seat}:${t.pool.length}:${t.game.wall.length}`, TURN_MS + pause)
    if (p.kind === 'claims') return keep(`claims:${p.from}:${p.tile.id}:${p.robbing}:${t.pool.length}`, CLAIM_MS)
    this.s.waitKey = null
    if (p.kind === 'dealing') this.s.wakeAt ??= now + INTRO_MS
    else if (p.kind === 'turn') this.s.wakeAt = now + BOT_MS + pause
    else this.s.wakeAt = null                                  // over: waits for "Next hand"
  }

  // ---------- What each player is told ----------

  private lobbyToAll(): Out[] {
    return this.connectedPeople().map(p => ({ to: p.playerId, msg: this.lobbyFor(p.playerId) }))
  }

  lobbyFor(playerId: string): ServerMsg {
    const you = this.seatOf(playerId)
    const seats: SeatInfo[] = this.s.seats.map((x, i) => x
      ? { name: x.name, person: true, connected: x.connected, host: x.playerId === this.s.hostId, away: !!x.away, joining: !!x.joining }
      : { name: BOT_NAMES[i], person: false, connected: false, host: false, away: false, joining: false })
    return { type: 'room', code: this.s.code, you: you < 0 ? null : you, seats, started: !!this.table, rules: this.s.rules }
  }

  private statesToAll(now: number): Out[] {
    const events = this.pendingEvents
    this.pendingEvents = []
    if (!this.table) return []
    return this.connectedPeople().map(p => {
      const seat = this.seatOf(p.playerId)
      return { to: p.playerId, msg: { type: 'state', view: this.viewFor(seat), now, events: events.filter(e => e.type !== 'yourTurn' || e.seat === seat) } }
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
      turnDeadline: phase.kind === 'turn' && t.humans[phase.seat] ? this.s.wakeAt : null,
    }
  }
}
