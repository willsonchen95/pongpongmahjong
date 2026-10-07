import { describe, it, expect } from 'vitest'
import { RoomCore, newRoom, type Out, type SeatView, INTRO_MS, TURN_MS, CLAIM_MS, NEXT_HAND_MS } from './room-core'

const RULES = { rounds: 1, minFaan: 1, startPoints: 1000 }
const lastState = (out: Out[], to: string): SeatView | undefined =>
  out.filter(o => o.to === to && o.msg.type === 'state').map(o => (o.msg as { view: SeatView }).view).pop()

// Let the room's own clock run until it's waiting on a person (or the hand is over).
function runClock(room: RoomCore, now: { t: number }): Out[] {
  const all: Out[] = []
  for (let i = 0; i < 2000; i++) {
    const w = room.s.wakeAt
    if (w === null) break
    const p = room.s.table!.phase
    const waitingOnPerson = (p.kind === 'turn' && room.s.table!.humans[p.seat]) || p.kind === 'claims'
    if (waitingOnPerson || p.kind === 'over') break         // (over: the clock would deal the next hand)
    now.t = w
    all.push(...room.tick(now.t))
  }
  return all
}

describe('a room', () => {
  it('one person answering a claim doesn’t give the others more time', () => {
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0); room.join('b', 'Bob', 0)
    room.handle('a', { type: 'start', rules: RULES }, 0)
    // play on (people throw their newest tile, never claim) until both people are offered the same tile
    let now = 0
    for (let i = 0; i < 3000; i++) {
      const t = room.s.table!
      const p = t.phase
      if (p.kind === 'over') break
      if (p.kind === 'claims' && p.offers[0] && p.offers[1]) {
        const deadline = room.s.wakeAt
        room.handle('a', { type: 'answer', answer: { kind: 'pass' } }, now + 5000)
        expect(room.s.wakeAt).toBe(deadline)
        return
      }
      if (p.kind === 'turn' && t.humans[p.seat]) {
        const hand = t.game.hands[p.seat]
        room.handle(p.seat === 0 ? 'a' : 'b', { type: 'discard', tile: hand[hand.length - 1].id! }, now)
      } else if (p.kind === 'claims') {
        for (const s of [0, 1]) if (p.offers[s] && !p.answers[s]) room.handle(s === 0 ? 'a' : 'b', { type: 'answer', answer: { kind: 'pass' } }, now)
      } else { now = room.s.wakeAt ?? now; room.tick(now) }
    }
    // (in the rare deal where it never happens, there's nothing to check)
  })

  it('seats people in the order they join, with the first as host', () => {
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0)
    const out = room.join('b', 'Bob', 0)
    const lobby = out.find(o => o.to === 'b' && o.msg.type === 'room')!.msg
    if (lobby.type !== 'room') throw new Error()
    expect(lobby.you).toBe(1)
    expect(lobby.seats.map(s => s.name)).toEqual(['Alice', 'Bob', 'Kai', 'Lin'])
    expect(lobby.seats[0].host).toBe(true)
    expect(room.handle('b', { type: 'start', rules: RULES }, 0)[0].msg.type).toBe('error')   // only the host
  })

  it('shows each player only their own hand, and none of the wall', () => {
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0); room.join('b', 'Bob', 0)
    const out = room.handle('a', { type: 'start', rules: RULES }, 0)
    const va = lastState(out, 'a')!, vb = lastState(out, 'b')!
    expect(va.seat).toBe(0)
    expect(va.game.hands[0]).toHaveLength(13)
    expect(va.game.hands[1]).toHaveLength(0)
    expect(va.handCounts).toEqual([13, 13, 13, 13])
    expect(va.game.wall).toHaveLength(0)
    expect(va.wallCount).toBeGreaterThan(80)
    expect(vb.game.hands[1]).toHaveLength(13)
    expect(vb.game.hands[0]).toHaveLength(0)
  })

  it('plays a whole hand with two people and two bots, people acting by tile id', () => {
    const now = { t: 0 }
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0); room.join('b', 'Bob', 0)
    room.handle('a', { type: 'start', rules: RULES }, 0)
    let views: Record<string, SeatView | undefined> = {}
    for (let step = 0; step < 500; step++) {
      runClock(room, now)
      const t = room.s.table!
      if (t.phase.kind === 'over') break
      for (const id of ['a', 'b']) {
        const seat = id === 'a' ? 0 : 1
        const p = t.phase
        if (p.kind === 'turn' && p.seat === seat) {
          const hand = t.game.hands[seat]
          const out = room.handle(id, { type: 'discard', tile: hand[hand.length - 1].id! }, now.t)
          views = { ...views, [id]: lastState(out, id) }
        } else if (p.kind === 'claims' && p.offers[seat] && !p.answers[seat]) {
          room.handle(id, { type: 'answer', answer: { kind: 'pass' } }, now.t)
        }
      }
    }
    expect(room.s.table!.phase.kind).toBe('over')
    expect(room.s.table!.match.scores.reduce((x, y) => x + y, 0)).toBe(4000)
  })

  it('plays for a person who runs out of time', () => {
    const now = { t: 0 }
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0)
    room.handle('a', { type: 'start', rules: RULES }, 0)
    expect(room.s.wakeAt).toBe(INTRO_MS)
    for (let i = 0; i < 300; i++) {                       // let the clock run, never acting ourselves
      const w = room.s.wakeAt
      if (w === null || room.s.table!.phase.kind === 'over') break
      const p = room.s.table!.phase
      if (p.kind === 'turn' && p.seat === 0 && room.s.table!.humans[0]) expect(w - now.t).toBe(TURN_MS)
      if (p.kind === 'claims') expect(w - now.t).toBe(CLAIM_MS)
      now.t = w
      room.tick(now.t)
    }
    expect(room.s.table!.phase.kind).toBe('over')
  })

  it('lets a bot sit in for someone who drops out, and gives the seat back when they return', () => {
    const now = { t: 0 }
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0); room.join('b', 'Bob', 0)
    room.handle('a', { type: 'start', rules: RULES }, 0)
    room.leave('b', 0)
    expect(room.s.table!.humans).toEqual([true, false, false, false])
    expect(room.lobbyFor('a')).toMatchObject({ seats: [{ name: 'Alice' }, { name: 'Bob', connected: false }, {}, {}] })
    runClock(room, now)
    const out = room.join('b', 'Bob', now.t)
    expect(room.s.table!.humans).toEqual([true, true, false, false])
    expect(lastState(out, 'b')?.seat).toBe(1)
    room.join('c', 'Carol', now.t)                           // arriving mid-game: a bot's seat, from the next hand
    expect(room.s.table!.humans).toEqual([true, true, false, false])
  })

  it('after a game: newcomers can join, and Play again frees the seats of anyone who left', () => {
    const now = { t: 0 }
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0); room.join('b', 'Bob', 0)
    room.handle('a', { type: 'start', rules: RULES }, 0)
    room.leave('b', 0)                                       // Bob leaves; a bot plays his seat
    for (let i = 0; i < 20000 && !room.s.table!.match.over; i++) {
      const t = room.s.table!
      if (t.phase.kind === 'over') { room.handle('a', { type: 'ready' }, now.t); continue }
      const p = t.phase
      if (p.kind === 'turn' && p.seat === 0) { const h = t.game.hands[0]; room.handle('a', { type: 'discard', tile: h[h.length - 1].id! }, now.t); continue }
      if (p.kind === 'claims' && p.offers[0] && !p.answers[0]) { room.handle('a', { type: 'answer', answer: { kind: 'pass' } }, now.t); continue }
      now.t = room.s.wakeAt ?? now.t
      room.tick(now.t)
    }
    expect(room.s.table!.match.over).toBe(true)
    const joined = room.join('c', 'Carol', now.t)
    expect(joined.find(o => o.to === 'c')?.msg.type).toBe('room')   // in, not turned away
    room.handle('a', { type: 'start', rules: RULES }, now.t)
    expect(room.lobbyFor('a')).toMatchObject({ started: true, seats: [{ name: 'Alice' }, { person: false }, { name: 'Carol' }, { person: false }] })
    expect(room.s.table!.humans).toEqual([true, false, true, false])
  })

  it('passes reactions and chat phrases to everyone, only known ones, at most one a second each', () => {
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0); room.join('b', 'Bob', 0)
    const out = room.handle('b', { type: 'react', emoji: '😂' }, 5000)
    expect(out.map(o => o.to).sort()).toEqual(['a', 'b'])
    expect(out[0].msg).toEqual({ type: 'react', seat: 1, emoji: '😂' })
    expect(room.handle('b', { type: 'react', emoji: '👍' }, 5500)).toEqual([])         // too soon
    expect(room.handle('b', { type: 'react', emoji: '👍' }, 6000)).toHaveLength(2)
    expect(room.handle('a', { type: 'react', emoji: '<b>hi</b>' }, 9000)).toEqual([])  // not one of the reactions
    expect(room.handle('a', { type: 'react', emoji: 'Good game!' }, 10000)[0].msg).toEqual({ type: 'react', seat: 0, emoji: 'Good game!' })   // a chat phrase
    expect(room.handle('b', { type: 'react', emoji: 'Hello there' }, 10000)).toEqual([])   // only the set phrases
  })

  it('out of time on your turn: throws the tile you just drew; twice in a row and a bot takes over until you’re back', () => {
    const now = { t: 0 }
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0); room.join('b', 'Bob', 0)
    room.handle('a', { type: 'start', rules: RULES }, 0)
    const timeOut = () => {                                   // run until Alice's own turn, then let it run out
      for (let i = 0; i < 400; i++) {
        const t = room.s.table!, p = t.phase
        if (p.kind === 'over') return null
        if (p.kind === 'turn' && p.seat === 0 && t.humans[0]) {
          const drawn = t.game.drawn
          now.t = room.s.wakeAt!
          room.tick(now.t)
          return { drawn }
        }
        // (Alice never acts — answering would count as being here and reset her timeouts — so a tile
        // offered to her waits out its time; Bob passes straight away)
        if (p.kind === 'claims' && p.offers[1] && !p.answers[1]) { room.handle('b', { type: 'answer', answer: { kind: 'pass' } }, now.t); continue }
        if (p.kind === 'turn' && p.seat === 1 && t.humans[1]) { const h = t.game.hands[1]; room.handle('b', { type: 'discard', tile: h[h.length - 1].id! }, now.t); continue }
        now.t = room.s.wakeAt ?? now.t
        room.tick(now.t)
      }
      return null
    }
    const first = timeOut()
    if (!first) return                                        // (the hand ended first: nothing to check)
    // the drawn tile went (it's on the table — or in the set of whoever took it at once)
    if (first.drawn) expect([...room.s.table!.pool, ...room.s.table!.game.melds.flat(2)].some(t => t.id === first.drawn!.id)).toBe(true)
    expect(room.lobbyFor('b')).toMatchObject({ seats: [{ away: false }, {}, {}, {}] })
    if (!timeOut()) return
    expect(room.lobbyFor('b')).toMatchObject({ seats: [{ name: 'Alice', away: true }, {}, {}, {}] })
    expect(room.s.table!.humans[0]).toBe(false)               // a bot plays her seat now
    room.handle('a', { type: 'back' }, now.t)
    expect(room.s.table!.humans[0]).toBe(true)
    expect(room.lobbyFor('b')).toMatchObject({ seats: [{ away: false }, {}, {}, {}] })  })

  it('someone arriving mid-game takes a bot’s seat, and its points, from the next hand', () => {
    const now = { t: 0 }
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0)
    room.handle('a', { type: 'start', rules: RULES }, 0)
    now.t = INTRO_MS
    room.tick(now.t)                                         // the deal is done; the hand is under way
    const joined = room.join('c', 'Carol', now.t)
    expect(joined.find(o => o.to === 'c')?.msg.type).toBe('room')   // in, not turned away
    expect(room.lobbyFor('c')).toMatchObject({ you: 1, seats: [{ name: 'Alice' }, { name: 'Carol', person: true, joining: true }, {}, {}] })
    expect(room.s.table!.humans[1]).toBe(false)              // the bot finishes this hand for her
    const hand = room.s.table!.game.hands[1]
    expect(room.handle('c', { type: 'discard', tile: hand[0].id! }, now.t)).toEqual([])   // her moves wait for the next hand
    // Alice plays the hand out (throwing her newest tile, never claiming)
    for (let i = 0; i < 5000 && room.s.table!.phase.kind !== 'over'; i++) {
      const t = room.s.table!, p = t.phase
      if (p.kind === 'turn' && p.seat === 0) { const h = t.game.hands[0]; room.handle('a', { type: 'discard', tile: h[h.length - 1].id! }, now.t); continue }
      if (p.kind === 'claims' && p.offers[0] && !p.answers[0]) { room.handle('a', { type: 'answer', answer: { kind: 'pass' } }, now.t); continue }
      now.t = room.s.wakeAt ?? now.t
      room.tick(now.t)
    }
    if (room.s.table!.match.over) return                     // (a big hand ended the game: nothing more to check)
    room.handle('a', { type: 'back' }, now.t); room.handle('a', { type: 'ready' }, now.t)
    const out = room.handle('c', { type: 'ready' }, now.t)
    expect(room.s.table!.humans).toEqual([true, true, false, false])   // her seat from this hand on
    expect(out.find(o => o.to === 'c' && o.msg.type === 'room')?.msg).toMatchObject({ seats: [{}, { joining: false }, {}, {}] })   // and she's told
    expect(room.lobbyFor('a')).toMatchObject({ seats: [{ name: 'Alice' }, { name: 'Carol', joining: false }, {}, {}] })
  })

  it('the host pressing Leave closes the room and sends everyone back; anyone else leaving keeps it going', () => {
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0); room.join('b', 'Bob', 0); room.join('c', 'Carol', 0)
    room.handle('a', { type: 'start', rules: RULES }, 0)
    room.handle('c', { type: 'leave' }, 0)                   // not the host: a bot takes Carol's seat
    expect(room.s.table).not.toBeNull()
    expect(room.s.table!.humans).toEqual([true, true, false, false])
    const out = room.handle('a', { type: 'leave' }, 0)       // the host
    expect(out).toEqual([{ to: 'b', msg: { type: 'closed', host: 'Alice' } }])
    expect(room.s.table).toBeNull()
    expect(room.s.seats).toEqual([null, null, null, null])
    expect(room.lobbyFor('b')).toMatchObject({ started: false, you: null })
  })

  it('someone leaving while the others wait at Next hand doesn’t leave them stuck', () => {
    const now = { t: 0 }
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0); room.join('b', 'Bob', 0); room.join('c', 'Carol', 0)
    room.handle('a', { type: 'start', rules: RULES }, 0)
    for (let i = 0; i < 3000 && room.s.table!.phase.kind !== 'over'; i++) {
      const w = room.s.wakeAt
      if (w === null) break
      now.t = w
      room.tick(now.t)
    }
    if (room.s.table!.match.over) return                     // (a big hand ended the game: nothing to check)
    for (const p of ['a', 'b', 'c']) room.handle(p, { type: 'back' }, now.t)   // (nobody acted, so all were marked away)
    const hand = room.s.table!.match.hand
    room.handle('a', { type: 'ready' }, now.t); room.handle('b', { type: 'ready' }, now.t)
    expect(room.s.table!.match.hand).toBe(hand)              // waiting for Carol…
    room.leave('c', now.t)                                   // …who leaves instead
    expect(room.s.table!.match.hand).toBe(hand + 1)          // so the next hand is dealt
  })

  it('deals the next hand anyway if someone never presses Next hand', () => {
    const now = { t: 0 }
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0); room.join('b', 'Bob', 0)
    room.handle('a', { type: 'start', rules: RULES }, 0)
    for (let i = 0; i < 3000 && room.s.table!.phase.kind !== 'over'; i++) {
      const w = room.s.wakeAt
      if (w === null) break
      now.t = w
      room.tick(now.t)
    }
    if (room.s.table!.match.over) return                     // (a big hand ended the game: nothing to check)
    const ended = now.t, hand = room.s.table!.match.hand
    room.handle('a', { type: 'back' }, ended); room.handle('b', { type: 'back' }, ended)
    const out = room.handle('a', { type: 'ready' }, ended + 1000)   // Alice presses; Bob has gone quiet
    expect(lastState(out, 'a')?.nextHandAt).toBe(ended + NEXT_HAND_MS)   // everyone sees when it'll be dealt
    expect(room.tick(ended + NEXT_HAND_MS - 1)).toEqual([])
    room.tick(ended + NEXT_HAND_MS)
    expect(room.s.table!.match.hand).toBe(hand + 1)
  })

  it('waits for everyone to press Next hand', () => {
    const now = { t: 0 }
    const room = new RoomCore(newRoom('ABCD', RULES))
    room.join('a', 'Alice', 0); room.join('b', 'Bob', 0)
    room.handle('a', { type: 'start', rules: RULES }, 0)
    for (let i = 0; i < 2000 && room.s.table!.phase.kind !== 'over'; i++) {
      const w = room.s.wakeAt
      if (w === null) break
      now.t = w
      room.tick(now.t)
    }
    expect(room.s.table!.phase.kind).toBe('over')
    room.handle('b', { type: 'back' }, now.t)                 // (nobody acted, so both had been marked away)
    const hand = room.s.table!.match.hand
    room.handle('a', { type: 'ready' }, now.t)
    expect(room.s.table!.match.hand).toBe(hand)              // still waiting for Bob
    room.handle('b', { type: 'ready' }, now.t)
    if (!room.s.table!.match.over) expect(room.s.table!.match.hand).toBe(hand + 1)
  })
})
