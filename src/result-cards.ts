// The cards at the end of a hand (who won, the winning hand, its faan, who paid whom and why)
// and at the end of the game (the final standings). main.ts supplies the match and the buttons.
import { type Tile, type GameState, SEATS, sortHand, payout } from './engine'
import type { Match, HandResult } from './table'
import { el, tileEl, fmt, signed, points } from './ui'

const HUMAN = 0                       // on your own screen you're always seat 0
export interface ResultContext { match: Match; game: GameState; names: string[]; winTile: Tile | null }

// The card being built reads these, set from its context.
let match: Match, game: GameState, NAMES: string[], winTile: Tile | null
function use(ctx: ResultContext) { ({ match, game, names: NAMES, winTile } = ctx) }
const possessive = (p: number) => (p === HUMAN ? 'your' : `${NAMES[p]}’s`)
export const standingsOf = (m: Match) => [0, 1, 2, 3].sort((a, b) => m.scores[b] - m.scores[a])
// Who has the most points on their own — null when the top score is shared (a game ended early often is).
export const soleLeader = (m: Match): number | null => {
  const [first, second] = standingsOf(m)
  return m.scores[first] > m.scores[second] ? first : null
}
const standings = () => standingsOf(match)
export const wonByRobbingIn = (m: Match) => !!m.result?.items.some(i => i.name === 'Robbing a kong')
const wonByRobbing = () => wonByRobbingIn(match)

// Everyone's score change for the hand and their new total, best first.
function scoreTable(deltas: number[]): HTMLElement {
  const t = el('div', 'score-table')
  t.append(el('span', 'st-head'), el('span', 'st-head', 'This hand'), el('span', 'st-head', 'Total'))
  for (const p of standings()) {
    const d = deltas[p]
    t.append(
      el('span', 'st-name' + (p === HUMAN ? ' you' : ''), NAMES[p]),
      el('span', 'st-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : ''), d === 0 ? '—' : signed(d)),
      el('span', 'st-total' + (match.scores[p] < 0 ? ' bust' : ''), points(match.scores[p])),
    )
  }
  return t
}

// "Who pays, and why": the payment rule that applied this hand in one sentence, then each player's
// share with the reason — so a minus score never comes as a surprise.
function paymentBox(r: HandResult, w: number): HTMLElement {
  const who = (p: number) => (p === HUMAN ? 'You' : NAMES[p])
  const pays = (p: number) => (p === HUMAN ? 'you pay' : `${NAMES[p]} pays`)
  const points = payout(r.faan)
  const worth = `${r.faan} faan is worth ${fmt(points)} points.`
  let rule: string
  if (r.from === null) {
    rule = `${worth} ${who(w)} drew the winning tile from the wall, so nobody gave it away — the other three share the cost and each pay half (${fmt(points / 2)}).`
  } else if (wonByRobbing()) {
    rule = `${worth} ${who(w)} robbed ${possessive(r.from)} kong: the tile added to the pong finished the hand. That counts like throwing away the winning tile, so ${pays(r.from)} the full ${fmt(points)} and the others pay nothing.`
  } else {
    rule = `${worth} ${who(r.from)} threw away the winning tile, so ${pays(r.from)} the full ${fmt(points)} — the others pay nothing.`
  }

  const box = el('div', 'pay-box')
  box.append(el('h4', '', 'Who pays, and why'), el('p', 'pay-rule', rule))
  const rows = el('div', 'pay-rows')
  for (const p of [w, ...[1, 2, 3].map(k => (w + k) % 4)]) {
    const d = r.deltas[p]
    let why: string
    const lower = (q: number) => (q === HUMAN ? 'you' : NAMES[q])
    if (p === w) why = r.from === null ? 'won — collected half from each of the other three' : `won — collected it all from ${lower(r.from)}`
    else if (r.from === null) why = `paid half to ${lower(w)}`
    else if (p === r.from) why = wonByRobbing() ? 'paid it all — the kong was robbed' : 'paid it all — threw away the winning tile'
    else why = 'paid nothing — didn’t throw the winning tile'
    rows.append(
      el('span', 'pay-name' + (p === HUMAN ? ' you' : ''), who(p)),
      el('span', 'pay-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : ''), d === 0 ? '0' : signed(d)),
      el('span', 'pay-why', why),
    )
  }
  box.appendChild(rows)
  return box
}

// The end-of-hand card: who won (or a draw), the winning hand, its faan, and who paid whom.
export function resultCard(ctx: ResultContext, buttons: HTMLElement[]): HTMLElement {
  use(ctx)
  const r = match.result!
  const w = r.winner
  const card = el('div', 'result-card' + (w === HUMAN ? ' you' : ''))
  if (w === null) {
    card.append(el('div', 'result-title', 'Draw'), el('div', 'result-sub', 'The wall ran out — nobody pays.'))
  } else {
    if (w === HUMAN) card.append(el('div', 'result-title', '🎉 Congratulations! 🎉'), el('div', 'result-sub', 'You win — Mahjong!'))
    else card.append(el('div', 'result-title', 'Mahjong!'), el('div', 'result-sub', `${NAMES[w]} wins this hand`))
    card.appendChild(el('div', 'result-how', r.from === null
      ? (w === HUMAN ? 'You drew the winning tile yourself' : `${NAMES[w]} drew the winning tile`)
      : wonByRobbing() ? `Robbed ${possessive(r.from)} kong — the tile they added completed the hand`
      : `Won with ${possessive(r.from)} thrown-away tile`))

    // the winning hand: exposed sets first, then the rest sorted; the winning tile is raised
    const hand = el('div', 'result-hand')
    for (const meld of game.melds[w]) {
      const g = el('div', 'rh-group')
      for (const t of meld) g.appendChild(tileEl(t, 'rh'))
      hand.appendChild(g)
    }
    const g = el('div', 'rh-group')
    for (const t of sortHand(game.hands[w])) g.appendChild(tileEl(t, 'rh' + (t === winTile ? ' win-tile' : '')))
    hand.appendChild(g)
    card.appendChild(hand)
  }

  const cols = el('div', 'result-cols')
  if (w !== null) {
    const faan = el('div', 'faan-list')
    faan.appendChild(el('h4', '', 'Faan'))
    if (r.items.length === 0) faan.append(el('span', '', 'No special patterns'), el('strong', '', '0'))
    for (const item of r.items) faan.append(el('span', '', item.name), el('strong', '', `+${item.faan}`))
    faan.append(el('span', 'total', r.limit ? 'Total (limit hand)' : 'Total'), el('strong', 'total', `${r.faan} faan`))
    faan.appendChild(el('div', 'paid', `${r.faan} faan = ${fmt(payout(r.faan))} points`))
    cols.appendChild(faan)
  }
  const scores = el('div', 'score-box')
  scores.append(el('h4', '', 'Scores'), scoreTable(r.deltas))
  cols.appendChild(scores)
  card.appendChild(cols)
  if (w !== null) card.appendChild(paymentBox(r, w))

  // what happens next
  let next: string
  if (match.bust !== null) next = `${match.bust === HUMAN ? 'You have' : `${NAMES[match.bust]} has`} run out of points — the game ends here.`
  else if (match.over) next = 'That was the last hand of the game.'
  else if (r.dealerStays) next = `${NAMES[game.dealer]} ${game.dealer === HUMAN ? 'stay' : 'stays'} dealer for the next hand.`
  else next = `Next hand: ${NAMES[match.dealer]} ${match.dealer === HUMAN ? 'deal' : 'deals'}${match.roundWind !== game.roundWind ? ` — the ${SEATS[match.roundWind]} round begins` : ''}.`
  card.appendChild(el('div', 'result-next', next))

  const actions = el('div', 'result-actions')
  actions.append(...buttons)
  card.appendChild(actions)
  return card
}

// The final standings once the last hand is played.
// `rating`: the quick star rating (feedback-page.ts), when it's wanted.
export function finalCard(ctx: ResultContext, buttons: HTMLElement[], rating: HTMLElement | null = null): HTMLElement {
  use(ctx)
  const order = standings()
  const leader = soleLeader(match)
  const youFirst = leader === HUMAN
  const top = order.filter(p => match.scores[p] === match.scores[order[0]])
  const sub = youFirst ? 'Congratulations — top score!'
    : leader !== null ? `${NAMES[leader]} wins the game`
    : top.length === 4 ? 'All square — nobody won or lost any points'
    : `It’s a tie: ${top.map(p => (p === HUMAN ? 'you' : NAMES[p])).join(top.length === 2 ? ' and ' : ', ')} share the top score`
  const card = el('div', 'result-card final' + (youFirst ? ' you' : ''))
  card.append(el('div', 'result-title', youFirst ? '🏆 You win the game! 🏆' : 'Game over'), el('div', 'result-sub', sub))
  const list = el('div', 'standings')
  const places = ['1st', '2nd', '3rd', '4th']
  order.forEach((p, i) => {
    const row = el('div', 'standing' + (p === HUMAN ? ' you' : '') + (i === 0 ? ' first' : ''))
    const gain = match.scores[p] - match.startPoints
    row.append(el('span', 'place', places[i]), el('span', 'who', NAMES[p]),
      el('span', 'pts', `${points(match.scores[p])} pts`), el('span', 'gain ' + (gain > 0 ? 'up' : gain < 0 ? 'down' : ''), `(${signed(gain)})`))
    list.appendChild(row)
  })
  const ended = match.bust === null ? '' : ` — ${match.bust === HUMAN ? 'you' : NAMES[match.bust]} ran out of points, so the game ended early`
  const n = match.endedAfter
  const played = n === undefined ? `${match.hand} hands played${ended}`
    : n === 0 ? 'Ended before the first hand finished' : `Ended early after ${n} hand${n === 1 ? '' : 's'}`
  card.append(list, el('div', 'result-next', `${played}. Everyone started with ${fmt(match.startPoints)}.`))
  if (rating) card.appendChild(rating)
  const actions = el('div', 'result-actions')
  actions.append(...buttons)
  card.appendChild(actions)
  return card
}
