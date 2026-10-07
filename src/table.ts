// The table: a match of Hong Kong mahjong between four seats, each a person or a bot — the whole flow
// of play (draws, discards, claims, kongs, wins, scoring, the match moving on) with no screen code.
// The browser drives it for a game on this device; a server can drive the very same thing for a game
// played online.
//
// It works in steps. Each call changes the state and queues events (a draw, a call, a win…) for
// whoever shows the game to turn into sounds and banners; `phase` says what it's waiting for:
//   dealing    the hand is dealt; once the deal has been shown, begin()
//   next       a seat's turn is about to start (with a draw, or straight after a claim): startTurn()
//   turn       a seat holds a full hand and must act — a person: discard() or kong(); a bot: botMove()
//   discarded  a tile was just thrown; afterDiscard() offers it to the others
//   claims     people may take that tile (or rob a kong); each answers with answer()
//   over       the hand is finished; the match has been scored (newHand() deals the next)
// Bots decide instantly; only people are ever waited for.

import {
  type Tile, type GameState, type ClaimKind, type FaanItem, type ScoreInput, type BotLevel,
  deal, drawTile, isWinningHand, canPong, canKong, canWinOn, chowOptions, claimDiscard, kongOptions,
  declareKong, isAddedKong, sameTile, scoreHand, settle, progressInput, botDiscard, botWantsKong, botClaim,
} from './engine'

// ---------- The match ----------
// Everyone starts with the same stack of points; each win moves points from the payers to the winner.
// If anyone's points drop below zero they're bust and the game ends there. Before the game the table
// agrees a minimum faan: a complete hand scoring less can't be declared.

export interface Rules {
  rounds: number                       // 1 = East round only, 4 = full game
  minFaan: number                      // the agreed minimum to declare a win
  startPoints: number                  // everyone's stack at the start
  bots?: BotLevel                      // how well the bots play (older saves and rooms: normal)
}

export interface HandResult {
  winner: number | null                // null = the wall ran out
  from: number | null                  // who threw (or was robbed of) the winning tile; null = self-drawn
  faan: number
  limit: boolean
  items: FaanItem[]
  deltas: number[]                     // score change per player
  dealerStays: boolean
}

export interface Match extends Rules {
  scores: number[]                     // each player's points now
  bust: number | null                  // who ran out of points, ending the game early
  roundWind: number                    // 0 = East round …
  dealer: number                       // who deals the next/current hand
  passes: number                       // times the deal has passed on; every 4 the round wind moves on
  hand: number                         // hand number within the match, from 1
  result: HandResult | null            // the hand just finished
  over: boolean
}

export const newMatch = (r: Rules): Match => ({
  rounds: r.rounds, minFaan: r.minFaan, startPoints: r.startPoints, bots: r.bots ?? 'normal', scores: [0, 0, 0, 0].map(() => r.startPoints),
  bust: null, roundWind: 0, dealer: 0, passes: 0, hand: 0, result: null, over: false,
})

// ---------- What the table is waiting for, and what it tells the screen ----------

export type Draw = 'normal' | 'replacement' | 'none'     // replacement = from the back of the wall, after a kong

// A tile a person may take. Only options that would actually succeed are offered — anything a
// higher-priority bot claim would beat is already left out. `robbing`: not a discard but the tile
// `from` is adding to a pong — it can only be won with.
export interface Offer { from: number; tile: Tile; win: boolean; pong: boolean; kong: boolean; chows: number[][]; robbing?: boolean }
export type Answer = { kind: ClaimKind | 'win'; run?: number[] } | { kind: 'pass' }

export type Phase =
  | { kind: 'dealing' }
  | { kind: 'next'; seat: number; draw: Draw }
  | { kind: 'turn'; seat: number }
  | { kind: 'discarded'; seat: number }
  | { kind: 'claims'; from: number; tile: Tile; robbing: boolean; offers: (Offer | null)[]; answers: (Answer | null)[] }
  | { kind: 'over' }

export type TableEvent =
  | { type: 'draw'; seat: number }                          // drew from the wall
  | { type: 'flowers'; seat: number; tiles: Tile[] }        // set aside flowers/seasons (and drew replacements)
  | { type: 'discard'; seat: number; tile: Tile }
  | { type: 'call'; seat: number; kind: ClaimKind; meld: Tile[] }   // pong, chow or kong, with the set made
  | { type: 'yourTurn'; seat: number }                      // a person drew and must now throw a tile
  | { type: 'win'; seat: number; from: number | null; robbing: boolean }
  | { type: 'exhausted' }                                   // the wall ran out: a draw

// Everything needed to carry the table on later (saved in the browser, or kept by a server). Tiles
// come back as copies, so the two that are "this very tile" are remembered by their place.
export interface TableData {
  match: Match; game: GameState; pool: Tile[]; lastDiscard: number | null; winFrom: number | null
  winTileAt: number; drawnAt: number; phase: Phase; humans: boolean[]
}

const nextSeat = (seat: number) => (seat + 1) % 4
const after = (seat: number) => [1, 2, 3].map(k => (seat + k) % 4)     // the other seats, in turn order

export class Table {
  match: Match
  game: GameState
  pool: Tile[] = []                    // every discard still on the table, in the order thrown
  lastDiscard: number | null = null    // whose discard is the newest tile on the table (for highlighting)
  winFrom: number | null = null        // whose tile won the hand; null = self-drawn
  winTile: Tile | null = null          // the tile that completed the winning hand
  phase: Phase = { kind: 'dealing' }
  humans: boolean[]                    // which seats are people (the rest are bots; online, a bot sits in for anyone who drops out)
  private events: TableEvent[] = []

  constructor(rules: Rules, humans: boolean[]) {
    this.match = newMatch(rules)
    this.humans = humans
    this.game = deal()                 // a placeholder until the first newHand()
  }

  // The events since last asked, oldest first.
  takeEvents(): TableEvent[] {
    const e = this.events
    this.events = []
    return e
  }

  // ---------- Saving and restoring ----------

  toData(): TableData {
    const { game, winTile } = this
    return {
      match: this.match, game, pool: this.pool, lastDiscard: this.lastDiscard, winFrom: this.winFrom, phase: this.phase,
      humans: this.humans,
      winTileAt: game.winner !== null && winTile ? game.hands[game.winner].indexOf(winTile) : -1,
      drawnAt: game.drawn ? game.hands[game.current].indexOf(game.drawn) : -1,
    }
  }

  static fromData(d: TableData): Table {
    const t = new Table(d.match, d.humans)
    t.match = d.match
    t.game = d.game
    t.lastDiscard = d.lastDiscard
    t.winFrom = d.winFrom
    t.phase = d.phase
    t.game.drawn = d.drawnAt >= 0 ? t.game.hands[t.game.current][d.drawnAt] : null
    t.winTile = d.winTileAt >= 0 && t.game.winner !== null ? t.game.hands[t.game.winner][d.winTileAt] : null
    // the middle of the table shows the very tiles lying in the discard piles
    const thrown = t.game.discards.flat()
    t.pool = d.pool.map(p => { const i = thrown.findIndex(x => sameTile(x, p)); return i >= 0 ? thrown.splice(i, 1)[0] : p })
    return t
  }

  // ---------- Scoring helpers ----------

  // How `seat` would be scored winning right now with these concealed tiles, including the special
  // ways to win: on a kong's replacement tile, by robbing a kong, or with the last tile.
  scoreInput(seat: number, concealed: Tile[], selfDrawn: boolean, robbing = false): ScoreInput {
    const g = this.game
    return {
      ...progressInput(g, seat, concealed), selfDrawn,
      kongReplacement: selfDrawn && g.lastDrawFromBack, robbedKong: robbing, lastTile: g.wall.length === 0,
    }
  }

  // The faan `seat` would score with these concealed tiles (assumed to make a complete hand) — right
  // now, or for hints about a later tile (`now` false: none of the special ways to win).
  faanOf(seat: number, concealed: Tile[], selfDrawn: boolean, now = true, robbing = false): number {
    const input = now ? this.scoreInput(seat, concealed, selfDrawn, robbing) : { ...progressInput(this.game, seat, concealed), selfDrawn }
    return scoreHand(input).faan
  }

  // May this player declare a win — with the tile just drawn, or with someone's discard (or the tile
  // they're adding to a pong)? The hand must be complete AND reach the agreed minimum faan.
  canDeclareSelfDrawn(seat: number): boolean {
    const hand = this.game.hands[seat]
    return isWinningHand(hand, this.game.melds[seat].length) && this.faanOf(seat, hand, true) >= this.match.minFaan
  }
  canDeclareOn(seat: number, tile: Tile, robbing = false): boolean {
    return canWinOn(this.game, seat, tile) && this.faanOf(seat, [...this.game.hands[seat], tile], false, true, robbing) >= this.match.minFaan
  }

  // ---------- A hand ----------

  // Deal the next hand of the match. The dealer draws first once begin() is called.
  newHand() {
    const m = this.match
    m.hand++
    this.game = deal(m.dealer, m.roundWind)
    this.pool = []
    this.lastDiscard = this.winFrom = null
    this.winTile = null
    this.phase = { kind: 'dealing' }
  }

  begin() {
    if (this.phase.kind === 'dealing') this.phase = { kind: 'next', seat: this.game.dealer, draw: 'normal' }
  }

  // Start the turn waiting in `next`: draw (if it starts with one). A person who draws their winning
  // tile wins on the spot; otherwise the seat now holds a full hand and must act.
  startTurn() {
    const p = this.phase
    if (p.kind !== 'next') return
    const g = this.game
    g.current = p.seat
    let drawn: Tile | null = null
    if (p.draw !== 'none') {
      drawn = this.drawFor(p.seat, p.draw === 'replacement')
      if (drawn === null) return this.exhausted()
      this.events.push({ type: 'draw', seat: p.seat })
    }
    if (this.humans[p.seat]) {
      g.drawn = drawn
      if (drawn && this.canDeclareSelfDrawn(p.seat)) return this.win(p.seat)
      this.phase = { kind: 'turn', seat: p.seat }
      // after a pong or chow the call itself says it's their move
      if (drawn) this.events.push({ type: 'yourTurn', seat: p.seat })
    } else {
      this.phase = { kind: 'turn', seat: p.seat }
    }
  }

  // A bot's move on its turn: win if it can, declare any kongs worth making, then throw a tile.
  botMove() {
    const p = this.phase
    if (p.kind !== 'turn' || this.humans[p.seat]) return
    const seat = p.seat, g = this.game
    if (this.canDeclareSelfDrawn(seat)) return this.win(seat)
    let kong: Tile | undefined
    while ((kong = kongOptions(g, seat).find(t => botWantsKong(g, seat, t, this.match.minFaan)))) {
      if (!this.tryKong(seat, kong)) return                   // robbed, or people are deciding whether to rob it
      if (this.drawFor(seat, true) === null) return this.exhausted()
      if (this.canDeclareSelfDrawn(seat)) return this.win(seat)
    }
    const hand = g.hands[seat]
    this.throwTile(seat, hand.splice(botDiscard(g, seat, this.match.minFaan, this.botLevel), 1)[0])
  }

  // A person throws a tile on their turn. Returns false if it isn't theirs to throw.
  discard(seat: number, tile: Tile): boolean {
    const p = this.phase
    if (p.kind !== 'turn' || p.seat !== seat || !this.humans[seat]) return false
    const hand = this.game.hands[seat]
    let i = hand.indexOf(tile)
    if (i < 0) i = hand.findIndex(t => sameTile(t, tile))
    if (i < 0) return false
    this.game.drawn = null
    this.throwTile(seat, hand.splice(i, 1)[0])
    return true
  }

  // A person declares a kong on their turn (four in hand, or a fourth onto an exposed pong).
  kong(seat: number, tile: Tile): boolean {
    const p = this.phase
    if (p.kind !== 'turn' || p.seat !== seat || !this.humans[seat]) return false
    if (!kongOptions(this.game, seat).some(t => sameTile(t, tile))) return false
    this.game.drawn = null
    if (this.tryKong(seat, tile)) this.phase = { kind: 'next', seat, draw: 'replacement' }
    return true
  }

  // The tile just thrown is offered to the others. Bots answer at once; if any person could take it,
  // the table waits for them (phase `claims`). Returns the seat that claimed it, if someone did now.
  afterDiscard(): number | null {
    const p = this.phase
    if (p.kind !== 'discarded') return null
    const d = p.seat
    const tile = this.topDiscard(d)
    const offers = this.discardOffers(d, tile)
    if (offers.some(Boolean)) {
      this.phase = { kind: 'claims', from: d, tile, robbing: false, offers, answers: [null, null, null, null] }
      return null
    }
    return this.settleDiscard(d, [null, null, null, null])
  }

  // A person's answer to an offer: take the tile (as offered) or pass. Once everyone offered something
  // has answered, the claims are settled — highest priority wins. Returns false if not allowed.
  answer(seat: number, a: Answer): boolean {
    const p = this.phase
    if (p.kind !== 'claims') return false
    const o = p.offers[seat]
    if (!o || p.answers[seat]) return false
    const allowed = a.kind === 'pass' || (a.kind === 'win' && o.win) || (a.kind === 'pong' && o.pong) ||
      (a.kind === 'kong' && o.kong) || (a.kind === 'chow' && o.chows.some(r => r.join() === a.run?.join()))
    if (!allowed) return false
    p.answers[seat] = a
    if (p.offers.some((x, s) => x && !p.answers[s])) return true       // still waiting for someone
    if (p.robbing) this.settleRob(p.from, p.tile, p.answers)
    else this.settleDiscard(p.from, p.answers)
    return true
  }

  // When a person runs out of time: throw the tile a bot would (no kongs), or pass on a tile they
  // were offered. Does nothing if the table isn't waiting for them.
  autoPlay(seat: number) {
    const p = this.phase
    if (p.kind === 'turn' && p.seat === seat) {
      // out of time: the tile they just drew goes (after a pong or chi there isn't one: the bot's pick)
      const hand = this.game.hands[seat], drawn = this.game.drawn
      let i = drawn ? hand.findIndex(t => t === drawn || (t.id !== undefined && t.id === drawn.id)) : -1
      if (i < 0) i = botDiscard(this.game, seat, this.match.minFaan)
      this.game.drawn = null
      this.throwTile(seat, hand.splice(i, 1)[0])
    } else if (p.kind === 'claims' && p.offers[seat] && !p.answers[seat]) {
      this.answer(seat, { kind: p.offers[seat]!.win ? 'win' : 'pass' })   // a win is never thrown away by running out of time
    }
  }

  // Which seats the table is waiting on right now (people only; bots never keep it waiting).
  waitingFor(): number[] {
    const p = this.phase
    if (p.kind === 'turn' && this.humans[p.seat]) return [p.seat]
    if (p.kind === 'claims') return [0, 1, 2, 3].filter(s => p.offers[s] && !p.answers[s])
    return []
  }

  // ---------- Inside a hand ----------

  // Draw for a seat, announcing any flowers/seasons that turn up (they're set aside and replaced).
  private drawFor(seat: number, fromBack: boolean): Tile | null {
    const before = this.game.bonus[seat].length
    const t = drawTile(this.game, seat, fromBack)
    const found = this.game.bonus[seat].slice(before)
    if (found.length) this.events.push({ type: 'flowers', seat, tiles: found })
    return t
  }

  private throwTile(seat: number, tile: Tile) {
    this.game.discards[seat].push(tile)
    this.pool.push(tile)
    this.lastDiscard = seat
    this.events.push({ type: 'discard', seat, tile })
    this.phase = { kind: 'discarded', seat }
  }

  // how well the bots play this match (a match saved before there was a choice, or anything
  // unexpected sent to the room server: normal)
  private get botLevel(): BotLevel { const b = this.match.bots; return b === 'easy' || b === 'hard' ? b : 'normal' }

  private topDiscard(seat: number): Tile {
    const pile = this.game.discards[seat]
    return pile[pile.length - 1]
  }

  // What each person could do with seat `d`'s discard, given what the bots will do: win (unless a bot
  // ahead of them in turn order wins), pong or kong (unless a bot wins), chi (only the next seat,
  // unless a bot wins or pongs).
  private discardOffers(d: number, tile: Tile): (Offer | null)[] {
    const order = after(d)
    const bots = order.filter(s => !this.humans[s])
    const botWinner = bots.find(s => this.canDeclareOn(s, tile))
    const botPong = bots.some(s => { const c = botClaim(this.game, s, d, tile, this.match.minFaan, this.botLevel); return c && c.kind !== 'chow' })
    const noBotWin = botWinner === undefined
    return [0, 1, 2, 3].map(s => {
      if (s === d || !this.humans[s]) return null
      const hand = this.game.hands[s]
      const o: Offer = {
        from: d, tile,
        win: this.canDeclareOn(s, tile) && (noBotWin || order.indexOf(s) < order.indexOf(botWinner)),
        pong: noBotWin && canPong(hand, tile),
        kong: noBotWin && canKong(hand, tile),
        chows: noBotWin && !botPong && nextSeat(d) === s ? chowOptions(hand, tile) : [],
      }
      return o.win || o.pong || o.kong || o.chows.length ? o : null
    })
  }

  // Settle who gets seat `d`'s discard. Priority: win > pong/kong > chi (the next seat only); tied wins
  // go to whoever is next in turn order. Returns the seat that took it, if anyone did.
  private settleDiscard(d: number, answers: (Answer | null)[]): number | null {
    const tile = this.topDiscard(d)
    const order = after(d)
    const wants = (s: number, ...kinds: string[]) => this.humans[s] && kinds.includes(answers[s]?.kind ?? '')
    const winner = order.find(s => (this.humans[s] ? wants(s, 'win') : this.canDeclareOn(s, tile)))
    if (winner !== undefined) {
      this.game.hands[winner].push(this.game.discards[d].pop()!)
      this.pool.pop()
      this.lastDiscard = null
      this.win(winner, d)
      return winner
    }
    const claimOf = (s: number) => this.humans[s]
      ? (wants(s, 'pong', 'kong', 'chow') ? answers[s] as { kind: ClaimKind; run?: number[] } : null)
      : botClaim(this.game, s, d, tile, this.match.minFaan, this.botLevel)
    const claims = order.map(s => ({ seat: s, claim: claimOf(s) }))
    const c = claims.find(x => x.claim && x.claim.kind !== 'chow') ?? claims.find(x => x.claim?.kind === 'chow')
    if (c?.claim) {
      claimDiscard(this.game, c.seat, d, c.claim.kind, c.claim.run)
      this.pool.pop()
      this.lastDiscard = null
      const melds = this.game.melds[c.seat]
      this.events.push({ type: 'call', seat: c.seat, kind: c.claim.kind, meld: melds[melds.length - 1] })
      this.phase = { kind: 'next', seat: c.seat, draw: c.claim.kind === 'kong' ? 'replacement' : 'none' }
      return c.seat
    }
    this.phase = { kind: 'next', seat: nextSeat(d), draw: 'normal' }
    return null
  }

  // A kong being declared by `seat`. A fourth tile added to an exposed pong can be robbed: anyone it
  // completes may take it and win. Bots rob at once (unless a person ahead of them in turn order could);
  // people are asked. Returns true if the kong stands (the caller then draws a replacement).
  private tryKong(seat: number, tile: Tile): boolean {
    if (isAddedKong(this.game, seat, tile)) {
      const order = after(seat)
      const botRobber = order.find(s => !this.humans[s] && this.canDeclareOn(s, tile, true))
      const offers = [0, 1, 2, 3].map((s): Offer | null => {
        if (s === seat || !this.humans[s] || !this.canDeclareOn(s, tile, true)) return null
        if (botRobber !== undefined && order.indexOf(botRobber) < order.indexOf(s)) return null
        return { from: seat, tile, win: true, pong: false, kong: false, chows: [], robbing: true }
      })
      if (offers.some(Boolean)) {
        this.phase = { kind: 'claims', from: seat, tile, robbing: true, offers, answers: [null, null, null, null] }
        return false
      }
      if (botRobber !== undefined) { this.rob(botRobber, seat, tile); return false }
    }
    this.standKong(seat, tile)
    return true
  }

  private standKong(seat: number, tile: Tile) {
    declareKong(this.game, seat, tile)
    const meld = this.game.melds[seat].find(m => m.length === 4 && sameTile(m[0], tile))!
    this.events.push({ type: 'call', seat, kind: 'kong', meld })
  }

  // People have answered whether to rob `from`'s kong: the first robber in turn order (bot or person)
  // takes the tile and wins; if nobody does, the kong stands and `from` draws its replacement.
  private settleRob(from: number, tile: Tile, answers: (Answer | null)[]) {
    const robber = after(from).find(s => (this.humans[s] ? answers[s]?.kind === 'win' : this.canDeclareOn(s, tile, true)))
    if (robber !== undefined) return this.rob(robber, from, tile)
    this.standKong(from, tile)
    this.phase = { kind: 'next', seat: from, draw: 'replacement' }
  }

  private rob(robber: number, from: number, tile: Tile) {
    const hand = this.game.hands[from]
    this.game.hands[robber].push(hand.splice(hand.findIndex(t => sameTile(t, tile)), 1)[0])
    this.win(robber, from, true)
  }

  // The winning tile is always the last one added to the hand (the draw, or the claimed tile).
  private win(seat: number, from: number | null = null, robbing = false) {
    const g = this.game
    const hand = g.hands[seat]
    this.winTile = hand[hand.length - 1]
    const input = this.scoreInput(seat, hand, from === null, robbing)     // before the hand is marked over
    g.over = true; g.winner = seat; g.drawn = null
    this.winFrom = from
    this.phase = { kind: 'over' }
    this.events.push({ type: 'win', seat, from, robbing })
    this.endHand(seat, from, input)
  }

  private exhausted() {
    this.game.over = true
    this.game.drawn = null
    this.phase = { kind: 'over' }
    this.events.push({ type: 'exhausted' })
    this.endHand(null, null)
  }

  // Score the hand, pay out, and move the match on: the dealer keeps the deal after winning or a
  // draw, otherwise it passes to the next player; after four passes the round wind moves on.
  private endHand(winner: number | null, from: number | null, input?: ScoreInput) {
    const m = this.match
    const dealerStays = winner === null || winner === this.game.dealer
    let result: HandResult
    if (winner === null || !input) {
      result = { winner, from, faan: 0, limit: false, items: [], deltas: [0, 0, 0, 0], dealerStays }
    } else {
      const s = scoreHand(input)
      result = { winner, from, ...s, deltas: settle(winner, from, s.faan), dealerStays }
    }
    result.deltas.forEach((dlt, p) => { m.scores[p] += dlt })
    m.result = result
    if (!dealerStays) {
      m.dealer = nextSeat(m.dealer)
      m.passes++
      if (m.passes % 4 === 0) m.roundWind++
    }
    // below zero is bust (the lowest, if a self-drawn win sinks two at once): the game stops here
    const broke = [0, 1, 2, 3].filter(p => m.scores[p] < 0).sort((a, b) => m.scores[a] - m.scores[b])
    m.bust = broke[0] ?? null
    m.over = m.roundWind >= m.rounds || m.bust !== null
  }
}
