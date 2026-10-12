// The cards at the end of a hand (who won, the winning hand, its faan, who paid whom and why)
// and at the end of the game (the final standings). main.ts supplies the match and the buttons.
// In Family style there are no points: the cards show the faan and count hands won instead.
import { type Tile, type GameState, type FaanItem, SEATS, sortHand, payout, MAX_FAAN } from './engine'
import type { Match, HandResult } from './table'
import { el, tileEl, fmt, signed } from './ui'
import { faanMeaning } from './rules-guide'
import { t, faanName } from './i18n'

const HUMAN = 0                       // on your own screen you're always seat 0
export interface ResultContext { match: Match; game: GameState; names: string[]; winTile: Tile | null }

// The card being built reads these, set from its context.
let match: Match, game: GameState, NAMES: string[], winTile: Tile | null
function use(ctx: ResultContext) { ({ match, game, names: NAMES, winTile } = ctx) }
export const isFamily = (m: Match) => m.style === 'family'
export const winsOf = (m: Match, p: number) => m.wins?.[p] ?? 0
const faanWonOf = (m: Match, p: number) => m.faanWon?.[p] ?? 0
// Who's ahead of whom: by points — or in Family style by hands won, then the faan those wins scored.
const ahead = (m: Match, a: number, b: number) =>
  isFamily(m) ? winsOf(m, b) - winsOf(m, a) || faanWonOf(m, b) - faanWonOf(m, a) : m.scores[b] - m.scores[a]
export const standingsOf = (m: Match) => [0, 1, 2, 3].sort((a, b) => ahead(m, a, b))
// A player's place, 1 – 4; a shared place counts as the higher one.
export const placeOf = (m: Match, p: number) => 1 + [0, 1, 2, 3].filter(q => ahead(m, q, p) < 0).length
// Who is ahead on their own — null when the top place is shared (a game ended early often is).
export const soleLeader = (m: Match): number | null => {
  const [first, second] = standingsOf(m)
  return ahead(m, first, second) < 0 ? first : null
}
// "2 wins · 9 faan"
const winsText = (m: Match, p: number) => t(winsOf(m, p) === 1 ? '{n} win · {f} faan' : '{n} wins · {f} faan', { n: winsOf(m, p), f: faanWonOf(m, p) })
const standings = () => standingsOf(match)

// The faan pattern being explained on the result card ('': none), kept across redraws of the same hand.
let faanPicked = ''
const handKey = (r: HandResult) => `${match.roundWind}:${match.hand}:${r.winner}:${r.faan}:${r.items.map(i => i.name).join()}`

// ---------- The score reveal ----------
// When someone wins, the card shows how the points add up, a step at a time: each faan pattern in
// turn with the tiles that earned it lit up, the total, the faan climbing the payout ladder, then who
// pays. Every step is a CSS animation with its own delay counted from when the card first appeared
// (`elapsed`, in seconds), so the card can be rebuilt mid-way — online, it is, often — and simply
// carries on from the same moment. Past the end (or once skipped) it's just the plain card.
const STEP = 0.75                       // seconds per faan pattern
let elapsed = Infinity
let revealEnd = 0
// Animate `e` with `anim`, starting `at` seconds into the reveal.
function at(e: HTMLElement, when: number, anim = 'rv-in', length = 0.4) {
  revealEnd = Math.max(revealEnd, when + length)
  if (elapsed >= when + length) return
  e.style.animation = `${anim} ${length}s ease-out ${(when - elapsed).toFixed(3)}s both`
}
// Did this pattern come from this tile? (FaanItem.show: the whole hand, the winning tile, or kinds of tile)
type ShownTile = { el: HTMLElement; tile: Tile; bonus: boolean }
function earns(item: FaanItem, { tile, bonus }: ShownTile): boolean {
  const s = item.show
  return s === 'hand' ? !bonus : s === 'win' ? tile === winTile : Array.isArray(s) ? s.includes(`${tile.category}-${tile.value}`) : false
}
// Each tile in the winning hand lights up while the patterns it belongs to are shown.
function lightTiles(tiles: ShownTile[], items: FaanItem[], start: number) {
  for (const shown of tiles) {
    const e = shown.el
    const times = items.flatMap((item, i) => (earns(item, shown) ? [start + i * STEP] : [])).filter(t => elapsed < t + STEP)
    if (times.length) e.style.animation = times.map(t => `rv-lit ${STEP}s ease-in-out ${(t - elapsed).toFixed(3)}s both`).join(', ')
  }
}

// The payout ladder: the faan around this hand's and what each is worth, climbing to this hand's.
// (Seven steps, so the numbers stay readable on a phone.)
function payLadder(faan: number, when: number): HTMLElement {
  const ladder = el('div', 'pay-ladder')
  const lo = Math.max(0, Math.min(faan - 3, MAX_FAAN - 6)), hi = lo + 6
  for (let f = lo; f <= hi; f++) {
    const cell = el('div', 'pl-cell' + (f === faan ? ' here' : f < faan ? ' passed' : ''))
    cell.append(el('span', 'pl-faan', `${f}`), el('span', 'pl-pts', fmt(payout(f))))
    if (f <= faan) at(cell, when + (f - lo) * 0.12, f === faan ? 'rv-here' : 'rv-step', f === faan ? 0.5 : 0.3)
    ladder.appendChild(cell)
  }
  return ladder
}
export const wonByRobbingIn = (m: Match) => !!m.result?.items.some(i => i.name === 'Robbing a kong')
const wonByRobbing = () => wonByRobbingIn(match)

// Family style: hands won so far, best first, with this hand's winner marked.
function winsTable(winner: number | null): HTMLElement {
  const table = el('div', 'score-table')
  table.append(el('span', 'st-head'), el('span', 'st-head', t('This hand')), el('span', 'st-head', t('Wins')))
  for (const p of standings()) {
    table.append(
      el('span', 'st-name' + (p === HUMAN ? ' you' : ''), NAMES[p]),
      el('span', 'st-delta' + (p === winner ? ' up' : ''), p === winner ? t('won') : '—'),
      el('span', 'st-total', String(winsOf(match, p))),
    )
  }
  return table
}

// Everyone's score change for the hand and their new total, best first.
function scoreTable(deltas: number[]): HTMLElement {
  const table = el('div', 'score-table')
  table.append(el('span', 'st-head'), el('span', 'st-head', t('This hand')), el('span', 'st-head', t('Total')))
  for (const p of standings()) {
    const d = deltas[p]
    table.append(
      el('span', 'st-name' + (p === HUMAN ? ' you' : ''), NAMES[p]),
      el('span', 'st-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : ''), d === 0 ? '—' : signed(d)),
      el('span', 'st-total' + (match.scores[p] < 0 ? ' bust' : ''), fmt(match.scores[p])),
    )
  }
  return table
}

// "Who pays, and why": the payment rule that applied this hand in one sentence, then each player's
// share with the reason — so a minus score never comes as a surprise.
function paymentBox(r: HandResult, w: number, when: number): HTMLElement {
  const who = (p: number) => (p === HUMAN ? t('You') : NAMES[p])
  const points = payout(r.faan)
  const worth = t('{faan} faan is worth {points} points.', { faan: r.faan, points: fmt(points) })
  // whoever gave the tile away pays it all
  const payer = r.from === null ? '' : r.from === HUMAN
    ? t('So you pay the full {points} — the others pay nothing.', { points: fmt(points) })
    : t('So {name} pays the full {points} — the others pay nothing.', { name: NAMES[r.from], points: fmt(points) })
  let how: string
  if (r.from === null) {
    how = t(w === HUMAN ? 'You drew the winning tile from the wall, so nobody gave it away — the other three share the cost and each pay half ({half}).'
      : '{who} drew the winning tile from the wall, so nobody gave it away — the other three share the cost and each pay half ({half}).', { who: who(w), half: fmt(points / 2) })
  } else if (wonByRobbing()) {
    how = t(r.from === HUMAN ? '{who} robbed your kong: the tile added to the pong finished the hand. That counts like throwing away the winning tile.'
      : '{who} robbed {from}’s kong: the tile added to the pong finished the hand. That counts like throwing away the winning tile.', { who: who(w), from: NAMES[r.from] }) + ' ' + payer
  } else {
    how = t(r.from === HUMAN ? 'You threw away the winning tile.' : '{name} threw away the winning tile.', { name: NAMES[r.from] }) + ' ' + payer
  }
  const rule = `${worth} ${how}`

  const box = el('div', 'pay-box')
  box.append(el('h4', '', t('Who pays, and why')), el('p', 'pay-rule', rule))
  const rows = el('div', 'pay-rows')
  for (const p of [w, ...[1, 2, 3].map(k => (w + k) % 4)]) {
    const d = r.deltas[p]
    let why: string
    const lower = (q: number) => (q === HUMAN ? t('you') : NAMES[q])
    if (p === w) why = r.from === null ? t('won — collected half from each of the other three') : t('won — collected it all from {name}', { name: lower(r.from) })
    else if (r.from === null) why = t('paid half to {name}', { name: lower(w) })
    else if (p === r.from) why = wonByRobbing() ? t('paid it all — the kong was robbed') : t('paid it all — threw away the winning tile')
    else why = t('paid nothing — didn’t throw the winning tile')
    const row = [
      el('span', 'pay-name' + (p === HUMAN ? ' you' : ''), who(p)),
      el('span', 'pay-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : ''), d === 0 ? '0' : signed(d)),
      el('span', 'pay-why', why),
    ]
    const n = rows.children.length / 3
    for (const e of row) at(e, when + 0.3 + n * 0.3)
    rows.append(...row)
  }
  box.appendChild(rows)
  return box
}

// The end-of-hand card: who won (or a draw), the winning hand, its faan, and who paid whom.
// `since`: seconds since the card first appeared, for the score reveal (Infinity: no reveal); `skip`:
// what a tap on the card does while the reveal is playing.
export function resultCard(ctx: ResultContext, buttons: HTMLElement[], since = Infinity, skip?: () => void): HTMLElement {
  use(ctx)
  const r = match.result!
  const w = r.winner
  elapsed = w === null ? Infinity : since
  revealEnd = 0
  const card = el('div', 'result-card' + (w === HUMAN ? ' you' : ''))
  const lit: ShownTile[] = []
  const tile = (t: Tile, cls: string, bonus = false) => { const e = tileEl(t, cls); lit.push({ el: e, tile: t, bonus }); return e }
  if (w === null) {
    card.append(el('div', 'result-title', t('Draw')), el('div', 'result-sub', isFamily(match) ? t('The wall ran out — nobody wins this hand.') : t('The wall ran out — nobody pays.')))
  } else {
    if (w === HUMAN) card.append(el('div', 'result-title', t('Congratulations')), el('div', 'result-sub', t('You win — Mahjong!')))
    else card.append(el('div', 'result-title', 'Mahjong!'), el('div', 'result-sub', t('{name} wins this hand', { name: NAMES[w] })))
    const from = r.from === null ? '' : NAMES[r.from]
    card.appendChild(el('div', 'result-how', r.from === null
      ? (w === HUMAN ? t('You drew the winning tile yourself') : t('{name} drew the winning tile', { name: NAMES[w] }))
      : wonByRobbing() ? t(r.from === HUMAN ? 'Robbed your kong — the tile you added completed the hand' : 'Robbed {from}’s kong — the tile they added completed the hand', { from })
      : t(r.from === HUMAN ? 'Won with your thrown-away tile' : 'Won with {from}’s thrown-away tile', { from })))

    // the winning hand: exposed sets first, then the rest sorted; the winning tile is raised
    const hand = el('div', 'result-hand')
    for (const meld of game.melds[w]) {
      const g = el('div', 'rh-group')
      for (const x of meld) g.appendChild(tile(x, 'rh'))
      hand.appendChild(g)
    }
    const g = el('div', 'rh-group')
    for (const x of sortHand(game.hands[w])) g.appendChild(tile(x, 'rh' + (x === winTile ? ' win-tile' : '')))
    hand.appendChild(g)
    if (game.bonus[w].length) {                        // their flowers and seasons, a little apart
      const b = el('div', 'rh-group rh-bonus')
      for (const x of game.bonus[w]) b.appendChild(tile(x, 'rh', true))
      hand.appendChild(b)
    }
    card.appendChild(hand)
  }

  // the reveal's timetable: the patterns one by one from FIRST, then the total, the ladder, who pays
  const FIRST = 0.6
  const totalAt = FIRST + Math.max(1, r.items.length) * STEP
  const ladderAt = totalAt + 0.5
  const payAt = ladderAt + Math.min(r.faan, 3) * 0.12 + 0.9
  const cols = el('div', 'result-cols')
  if (w !== null) {
    const faan = el('div', 'faan-list')
    faan.appendChild(el('h4', '', t('Faan')))
    if (r.items.length === 0) {
      const row = [el('span', '', t('No special patterns')), el('strong', '', '0')]
      for (const e of row) at(e, FIRST)
      faan.append(...row)
    }
    // each pattern can be pointed at (or tapped): its tiles light up and a line says what it means
    const rows: { name: HTMLElement; why: HTMLElement; item: FaanItem }[] = []
    const show = (item: FaanItem | null) => {
      faanPicked = item ? `${handKey(r)}|${item.name}` : ''
      for (const row of rows) { const on = row.item === item; row.name.classList.toggle('on', on); row.why.hidden = !on }
      for (const shown of lit) shown.el.classList.toggle('lit', !!item && earns(item, shown))
    }
    r.items.forEach((item, i) => {
      const name = el('button', 'faan-name', faanName(item.name))
      name.setAttribute('aria-expanded', 'false')
      const why = el('div', 'faan-why', faanMeaning(item.name) ?? '')
      why.hidden = true
      const row = { name, why, item }
      rows.push(row)
      name.addEventListener('click', e => { e.stopPropagation(); show(name.classList.contains('on') ? null : item) })
      if (matchMedia('(hover: hover)').matches) {
        name.addEventListener('pointerenter', () => show(item))
        name.addEventListener('pointerleave', () => show(null))
      }
      const points = el('strong', '', `+${item.faan}`)
      for (const e of [name, points]) at(e, FIRST + i * STEP)
      faan.append(name, points, why)
    })
    const picked = r.items.find(item => faanPicked === `${handKey(r)}|${item.name}`)
    if (picked) queueMicrotask(() => show(picked))     // (after the tiles are in the card: a redraw keeps it)
    const total = [el('span', 'total', r.limit ? t('Total (limit hand)') : t('Total')), el('strong', 'total', `${r.faan} faan`)]
    for (const e of total) at(e, totalAt, 'rv-pop', 0.5)
    faan.append(el('div', 'faan-rule'), ...total)
    // Hong Kong style: the faan climb the payout ladder; Family style: the minimum was reached, that's the win
    const worth = el('div', 'paid')
    if (isFamily(match)) {
      worth.appendChild(el('span', 'pl-say', match.minFaan > 0 ? t('Minimum {min} faan reached — a win', { min: match.minFaan }) : t('A finished hand — a win')))
    } else {
      worth.append(payLadder(r.faan, ladderAt), el('span', 'pl-say', t('{faan} faan = {points} points', { faan: r.faan, points: fmt(payout(r.faan)) })))
    }
    at(worth, ladderAt - 0.1, 'rv-in', 0.3)
    faan.appendChild(worth)
    cols.appendChild(faan)
    lightTiles(lit, r.items, FIRST)
  }
  const scores = el('div', 'score-box')
  if (isFamily(match)) scores.append(el('h4', '', t('Hands won')), winsTable(w))
  else scores.append(el('h4', '', t('Scores')), scoreTable(r.deltas))
  at(scores, w === null ? 0 : isFamily(match) ? ladderAt + 0.4 : payAt + 1.4)
  cols.appendChild(scores)
  card.appendChild(cols)
  if (w !== null && !isFamily(match)) {
    const pay = paymentBox(r, w, payAt)
    at(pay, payAt, 'rv-in', 0.3)
    card.appendChild(pay)
  }
  // while it plays, a tap anywhere on the card shows it all at once
  if (skip && elapsed < revealEnd) {
    card.classList.add('revealing')
    card.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('button')) skip() })
    card.appendChild(el('div', 'rv-skip', t('Tap to see it all')))
  }

  // what happens next
  let next: string
  if (match.bust !== null) next = t(match.bust === HUMAN ? 'You have run out of points — the game ends here.' : '{name} has run out of points — the game ends here.', { name: NAMES[match.bust] })
  else if (match.over) next = t('That was the last hand of the game.')
  else if (r.dealerStays) next = t(game.dealer === HUMAN ? 'You stay dealer for the next hand.' : '{name} stays dealer for the next hand.', { name: NAMES[game.dealer] })
  else {
    next = t(match.dealer === HUMAN ? 'Next hand: you deal' : 'Next hand: {name} deals', { name: NAMES[match.dealer] })
    if (match.roundWind !== game.roundWind) next += t(' — the {round} begins', { round: t('{wind} round', { wind: t(SEATS[match.roundWind]) }) })
    next += '.'
  }
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
  const top = order.filter(p => ahead(match, p, order[0]) === 0)
  const tied = top.map(p => (p === HUMAN ? t('you') : NAMES[p]))
  const names = tied.length === 2 ? tied.join(` ${t('and')} `) : tied.join(', ')
  const sub = youFirst ? (isFamily(match) ? t('Congratulations — the most hands won!') : t('Congratulations — top score!'))
    : leader !== null ? t('{name} wins the game', { name: NAMES[leader] })
    : top.length === 4 ? (isFamily(match) ? t('All square — nobody is ahead') : t('All square — nobody won or lost any points'))
    : t(isFamily(match) ? 'It’s a tie: {names} share the top place' : 'It’s a tie: {names} share the top score', { names })
  const card = el('div', 'result-card final' + (youFirst ? ' you' : ''))
  card.append(el('div', 'result-title', youFirst ? t('You win the game') : t('Game over')), el('div', 'result-sub', sub))
  const list = el('div', 'standings')
  const places = [t('1st'), t('2nd'), t('3rd'), t('4th')]
  order.forEach(p => {
    const row = el('div', 'standing' + (p === HUMAN ? ' you' : '') + (placeOf(match, p) === 1 ? ' first' : ''))   // (a tie shares its place)
    const gain = match.scores[p] - match.startPoints
    row.append(el('span', 'place', places[placeOf(match, p) - 1]), el('span', 'who', NAMES[p]), isFamily(match)
      ? el('span', 'pts', winsText(match, p))
      : el('span', 'pts ' + (gain > 0 ? 'up' : gain < 0 ? 'down' : ''), t('{n} pts', { n: fmt(match.scores[p]) })))
    list.appendChild(row)
  })
  const ended = match.bust === null ? '' : t(match.bust === HUMAN ? ' — you ran out of points, so the game ended early' : ' — {name} ran out of points, so the game ended early', { name: NAMES[match.bust] })
  const n = match.endedAfter
  const played = n === undefined ? t(match.hand === 1 ? '{n} hand played' : '{n} hands played', { n: match.hand }) + ended
    : n === 0 ? t('Ended before the first hand finished') : t(n === 1 ? 'Ended early after {n} hand' : 'Ended early after {n} hands', { n })
  card.append(list, el('div', 'result-next', `${played}. ${isFamily(match) ? t('Most hands won wins; a tie goes to more faan.') : t('Everyone started with {n} points.', { n: fmt(match.startPoints) })}`))
  if (rating) card.appendChild(rating)
  const actions = el('div', 'result-actions')
  actions.append(...buttons)
  card.appendChild(actions)
  return card
}
