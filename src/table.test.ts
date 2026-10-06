import { describe, it, expect } from 'vitest'
import { Table, type Phase } from './table'
import { parse, makeTile, type GameState, type Tile } from './engine'

const RULES = { rounds: 1, minFaan: 1, startPoints: 1000 }
const tile = (spec: string) => parse(spec)[0]

// Play the bots' moves until the table needs a person (or the hand is over).
function playOn(t: Table): Phase {
  for (let i = 0; i < 3000; i++) {
    const p = t.phase
    if (p.kind === 'next') t.startTurn()
    else if (p.kind === 'discarded') t.afterDiscard()
    else if (p.kind === 'turn' && !t.humans[p.seat]) t.botMove()
    else return p
  }
  throw new Error('the table never came to rest')
}

// Every tile is somewhere: the wall, a hand, an exposed set, a discard pile or the flowers.
function tilesAccountedFor(g: GameState): number {
  return g.wall.length + g.hands.flat().length + g.melds.flat(2).length + g.discards.flat().length + g.bonus.flat().length
}

// A hand-built table: everyone's tiles set by hand, a wall of plain tiles that win nobody anything.
function setUp(humans: boolean[], hands: string[], melds: Tile[][][] = [[], [], [], []]): Table {
  const t = new Table({ ...RULES, minFaan: 0 }, humans)
  const g: GameState = {
    dealer: 0, roundWind: 0, wall: Array.from({ length: 40 }, () => makeTile('man', 1)), hands: hands.map(parse),
    melds, concealedKongs: [[], [], [], []], discards: [[], [], [], []], bonus: [[], [], [], []],
    wallFront: 0, current: 0, drawn: null, lastDrawFromBack: false, over: false, winner: null,
  }
  t.game = g
  return t
}
// Seat `seat` has just thrown `spec` (as if from its hand).
function threw(t: Table, seat: number, spec: string) {
  t.game.discards[seat].push(tile(spec))
  t.pool.push(t.game.discards[seat][0])
  t.lastDiscard = seat
  t.phase = { kind: 'discarded', seat }
}
const JUNK = '19m 19s 19p 1234z 567z'           // 13 tiles that connect with nothing

describe('a table of four bots', () => {
  it('plays whole matches to the end, keeping every tile and every point', { timeout: 30000 }, () => {
    for (let n = 0; n < 2; n++) {
      const t = new Table({ rounds: 1, minFaan: n % 2 ? 3 : 1, startPoints: 1000 }, [false, false, false, false])
      for (let hand = 0; hand < 40 && !t.match.over; hand++) {
        t.newHand()
        expect(tilesAccountedFor(t.game)).toBe(144)
        t.begin()
        expect(playOn(t).kind).toBe('over')
        expect(tilesAccountedFor(t.game)).toBe(144)
        expect(t.match.scores.reduce((a, b) => a + b, 0)).toBe(4000)
      }
      expect(t.match.over).toBe(true)
    }
  })
})

describe('a person at the table', () => {
  it('is offered a pong on a bot’s discard, and taking it starts their turn', () => {
    const t = setUp([true, false, false, false], ['55p 123m 456m 789s 99s', JUNK, JUNK, JUNK])
    threw(t, 3, '5p')
    expect(t.afterDiscard()).toBeNull()
    const p = t.phase
    expect(p.kind).toBe('claims')
    if (p.kind !== 'claims') return
    expect(p.offers[0]).toMatchObject({ from: 3, pong: true, kong: false })
    expect(t.answer(0, { kind: 'pong' })).toBe(true)
    expect(t.game.melds[0][0].map(x => x.value)).toEqual([5, 5, 5])
    expect(t.phase).toEqual({ kind: 'next', seat: 0, draw: 'none' })
    expect(t.takeEvents().some(e => e.type === 'call' && e.seat === 0 && e.kind === 'pong')).toBe(true)
  })

  it('passing lets play carry on with the next seat drawing', () => {
    const t = setUp([true, false, false, false], ['55p 123m 456m 789s 99s', JUNK, JUNK, JUNK])
    threw(t, 3, '5p')
    t.afterDiscard()
    expect(t.answer(0, { kind: 'chow', run: [3, 4, 5] })).toBe(false)     // not something it was offered
    expect(t.answer(0, { kind: 'pass' })).toBe(true)
    expect(t.phase).toEqual({ kind: 'next', seat: 0, draw: 'normal' })
  })

  it('wins on a discard that completes their hand', () => {
    const t = setUp([true, false, false, false], ['123m 456m 789m 46p 11s', JUNK, JUNK, JUNK])
    threw(t, 2, '5p')
    t.afterDiscard()
    expect(t.answer(0, { kind: 'win' })).toBe(true)
    expect(t.phase.kind).toBe('over')
    expect(t.game.winner).toBe(0)
    expect(t.winFrom).toBe(2)
    expect(t.match.result?.deltas[2]).toBeLessThan(0)                 // the thrower pays
  })

  it('may rob a bot’s kong, and wins with the robbed tile', () => {
    const t = setUp([true, false, false, false], ['123m 456m 789m 46p 11s', '5p 19m 19s 1234z 56z', JUNK, JUNK],
      [[], [parse('555p')], [], []])
    t.phase = { kind: 'turn', seat: 1 }
    t.botMove()                                       // the bot adds its 5p to its pong of 5p…
    const p = t.phase as Phase
    expect(p.kind).toBe('claims')
    if (p.kind !== 'claims') return
    expect(p.robbing).toBe(true)
    expect(p.offers[0]?.win).toBe(true)
    t.answer(0, { kind: 'win' })                      // …and you take it
    expect(t.game.winner).toBe(0)
    expect(t.winFrom).toBe(1)
    expect(t.match.result?.items.map(i => i.name)).toContain('Robbing a kong')
  })

  it('carries on exactly where it was after being saved and restored', () => {
    const t = new Table(RULES, [true, false, false, false])
    t.newHand(); t.begin()
    let p = playOn(t)
    for (let i = 0; i < 6 && p.kind === 'turn'; i++) {            // a few of your turns: throw the newest tile
      t.discard(0, t.game.hands[0][t.game.hands[0].length - 1])
      p = playOn(t)
    }
    const copy = Table.fromData(JSON.parse(JSON.stringify(t.toData())))
    expect(copy.phase).toEqual(t.phase)
    expect(copy.game.hands).toEqual(t.game.hands)
    expect(tilesAccountedFor(copy.game)).toBe(144)
    if (copy.game.drawn) expect(copy.game.hands[copy.game.current]).toContain(copy.game.drawn)   // the very tile, not a copy
    expect(copy.pool.every(x => copy.game.discards.flat().includes(x))).toBe(true)
  })
})

describe('two people at the table', () => {
  it('waits for both, then a pong beats a chi', () => {
    // seat 3 throws 5p: seat 0 (next) could chi it, seat 2 could pong it
    const t = setUp([true, false, true, false], ['46p 123m 456m 789s 99s', JUNK, '55p 123m 456m 789s 11s', JUNK])
    threw(t, 3, '5p')
    t.afterDiscard()
    const p = t.phase
    if (p.kind !== 'claims') throw new Error('expected claims')
    expect(p.offers[0]?.chows).toEqual([[4, 5, 6]])
    expect(p.offers[2]?.pong).toBe(true)
    t.answer(0, { kind: 'chow', run: [4, 5, 6] })
    expect(t.phase.kind).toBe('claims')                // still waiting for seat 2
    t.answer(2, { kind: 'pong' })
    expect(t.game.melds[2]).toHaveLength(1)
    expect(t.game.melds[0]).toHaveLength(0)
    expect(t.phase).toEqual({ kind: 'next', seat: 2, draw: 'none' })
  })

  it('if both could win, the one next in turn order does', () => {
    const t = setUp([true, false, true, false], ['123m 456m 789m 46p 11s', JUNK, '123s 456s 789s 46p 22m', JUNK])
    threw(t, 1, '5p')                                 // seat 2 comes before seat 0 after seat 1
    t.afterDiscard()
    t.answer(0, { kind: 'win' })
    t.answer(2, { kind: 'win' })
    expect(t.game.winner).toBe(2)
  })
})
