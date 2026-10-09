import { describe, it, expect } from 'vitest'
import { emptyRecord, noteHand, noteGame, byLevel, type HandInfo, type GameInfo } from './record'
import { parse } from './engine'

const hand = (over: Partial<HandInfo> = {}): HandInfo => ({
  winner: 'you', faan: 1, limit: false, items: [{ name: 'Self-drawn', faan: 1 }], groups: [parse('123m')], online: false, at: 1, ...over,
})
const game = (over: Partial<GameInfo> = {}): GameInfo => ({
  style: 'hk', bots: 'normal', online: false, minFaan: 1, rounds: 1, hands: 5, early: false, place: 1, wins: 2, points: 120, at: 2, ...over,
})
const ids = (cs: { id: string }[]) => cs.map(c => c.id).sort()

describe('the record', () => {
  it('counts a hand only once, however often it is seen', () => {
    const r = emptyRecord()
    noteHand(r, 'h1', hand())
    noteHand(r, 'h1', hand())
    expect(r.handsPlayed).toBe(1)
    expect(r.handsWon).toBe(1)
  })
  it('keeps the biggest winning hand, with its tiles', () => {
    const r = emptyRecord()
    noteHand(r, 'a', hand({ faan: 3 }))
    noteHand(r, 'b', hand({ faan: 2 }))
    expect(r.best?.faan).toBe(3)
    noteHand(r, 'c', hand({ faan: 5, groups: [parse('555z')] }))
    expect(r.best?.faan).toBe(5)
    expect(r.best?.groups).toEqual([[['dragon', 0], ['dragon', 0], ['dragon', 0]]])
  })
  it('a win streak: others winning breaks it, a draw does not', () => {
    const r = emptyRecord()
    noteHand(r, '1', hand()); noteHand(r, '2', hand({ winner: 'nobody' })); noteHand(r, '3', hand())
    expect(r.streak).toBe(2)
    noteHand(r, '4', hand({ winner: 'other' }))
    expect(r.streak).toBe(0)
    expect(r.bestStreak).toBe(2)
  })
  it('challenges are awarded once, for the right hands', () => {
    const r = emptyRecord()
    expect(ids(noteHand(r, '1', hand()))).toEqual(['first-win', 'self-drawn'])
    expect(noteHand(r, '2', hand())).toEqual([])                                   // already have them
    expect(ids(noteHand(r, '3', hand({ faan: 5, items: [{ name: 'Pure one suit', faan: 7 }] }))))
      .toEqual(['five-faan', 'one-suit', 'pure-suit', 'streak-3', 'three-faan'])
    expect(noteHand(r, '4', hand({ winner: 'other', faan: 10, limit: true }))).toEqual([])   // someone else's win earns you nothing
  })
  it('game challenges need first place in a game played to its end', () => {
    const r = emptyRecord()
    expect(ids(noteGame(r, 'g1', game({ early: true, bots: 'hard' })))).toEqual([])
    expect(ids(noteGame(r, 'g2', game({ bots: 'hard' })))).toEqual(['beat-hard', 'first-game'])
    expect(ids(noteGame(r, 'g3', game({ style: 'family', minFaan: 5, place: 2 })))).toEqual([])
    expect(ids(noteGame(r, 'g4', game({ style: 'family', minFaan: 5, rounds: 4 })))).toEqual(['beat-normal', 'family-five', 'full-game'])
  })
  it('games by bot level leave out online and unfinished games', () => {
    const r = emptyRecord()
    noteGame(r, '1', game({ bots: 'hard', place: 1 }))
    noteGame(r, '2', game({ bots: 'hard', place: 3 }))
    noteGame(r, '3', game({ bots: 'hard', online: true }))
    noteGame(r, '4', game({ bots: 'easy', early: true }))
    expect(byLevel(r)).toEqual({ easy: { games: 0, first: 0 }, normal: { games: 0, first: 0 }, hard: { games: 2, first: 1 } })
    expect(r.games.map(g => g.at)).toEqual([2, 2, 2, 2])
  })
})
