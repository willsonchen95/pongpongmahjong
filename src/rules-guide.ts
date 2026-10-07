// The rules guide: how to win, the sets, taking tiles, scoring patterns and what faan are worth.
// Shared by the in-game help panel and the "How to play" page in the menu.
import { type Tile, makeTile, payout, MAX_FAAN } from './engine'
import { el, tileEl, para, exampleTiles, fmt } from './ui'

interface InGame { minFaan: number; startPoints: number }

// The rules guide — shared by the in-game panel and the "How to play" page in the menu.
// In a game, `inGame` carries its rules, for the reminders of its minimum faan and starting points.
export function rulesSections(inGame: InGame | null): HTMLElement[] {
  const win = el('section')
  win.append(el('h3', '', 'How to win'),
    para('Collect ', el('strong', '', '4 sets and 1 pair'), ' — 14 tiles. For example:'))
  const hand = el('div', 'example-hand')
  for (const spec of ['123m', '555p', '111z', '789s', '66z']) hand.appendChild(exampleTiles(spec))
  win.appendChild(hand)

  const sets = el('section')
  sets.appendChild(el('h3', '', 'The sets'))
  const grid = el('div', 'set-grid')
  const row = (name: string, spec: string, what: string) => grid.append(el('strong', '', name), exampleTiles(spec), el('span', 'set-what', what))
  row('Pong', '555p', 'three the same')
  row('Kong', '7777s', 'four the same')
  row('Chi', '345m', 'three in a row, same suit (numbers only)')
  row('Pair', '66z', 'two the same — you need one')
  sets.appendChild(grid)

  const take = el('section')
  take.append(el('h3', '', 'Taking a thrown-away tile'),
    para('When someone throws away a tile you can use, a box pops up:'),
    para(el('strong', '', 'Pong / Kong'), ' — from anyone, if you hold 2 / 3 of that tile.'),
    para(el('strong', '', 'Chi'), ' — only from Lin, the player on your left (just before you).'),
    para(el('strong', '', 'Mahjong!'), ' — from anyone, if it finishes your hand.'),
    para('Taken sets are laid face-up on the table; then you throw away a tile.'))

  const kinds = el('section')
  kinds.append(el('h3', '', 'The tiles'))
  const kgrid = el('div', 'set-grid')
  const kind = (name: string, spec: string) => kgrid.append(el('strong', '', name), exampleTiles(spec), el('span'))
  kind('Characters', '159m'); kind('Circles', '159p'); kind('Bamboo', '159s'); kind('Winds', '1234z'); kind('Dragons', '567z')
  kinds.append(kgrid, para('Flowers and seasons are bonus tiles — they’re put aside for you automatically.'))

  return [win, sets, take, scoringSection(inGame), kinds]
}

// "How to earn points": each scoring pattern as a card with its faan, a plain explanation and
// example tiles (groups separated by spaces, in parse() notation), then what the faan are worth.
const PATTERNS: { name: string; faan: string; what: string; tiles?: string; bonus?: Tile[] }[] = [
  { name: 'Self-drawn', faan: '+1', what: 'You draw the winning tile from the wall yourself.' },
  { name: 'Concealed hand', faan: '+1', what: 'You win without taking anyone’s tile for a set — no Pong, Chi or Kong from a thrown-away tile. A kong of four from your own hand is fine.' },
  { name: 'No flowers', faan: '+1', what: 'You have no flower or season tiles.' },
  { name: 'Own flower', faan: '+1 each', what: 'A flower or season showing your seat number: East 1, South 2, West 3, North 4.', bonus: [makeTile('flower', 0), makeTile('season', 0)] },
  { name: 'Flower set', faan: '+2', what: 'All four flowers, or all four seasons (instead of the own-flower faan for that set).', bonus: [0, 1, 2, 3].map(v => makeTile('flower', v)) },
  { name: 'Last tile', faan: '+1', what: 'You win with the very last tile of the wall — or the tile thrown away after it.' },
  { name: 'Win on a kong', faan: '+2', what: 'After a kong you draw a replacement tile — and it completes your hand.' },
  { name: 'Robbing a kong', faan: '+2', what: 'Someone adds a fourth tile to their pong, and that tile completes your hand: take it and win. They pay.' },
  { name: 'All chi', faan: '+1', what: 'Every set is a run of three.', tiles: '123m 456p 789s 234s 55m' },
  { name: 'Dragon pong', faan: '+1 each', what: 'Three of the same dragon.', tiles: '555z' },
  { name: 'Wind pong', faan: '+1', what: 'Three of your seat’s wind, or of the round’s wind (+2 if it’s both).', tiles: '111z' },
  { name: 'All pongs', faan: '+3', what: 'Every set is three of a kind.', tiles: '111m 555p 999s 222z 66z' },
  { name: 'Mixed one suit', faan: '+3', what: 'Only one suit, plus winds or dragons.', tiles: '123p 456p 999p 111z 55z' },
  { name: 'Small three dragons', faan: '+5', what: 'Pongs of two dragons and a pair of the third.', tiles: '555z 666z 77z' },
  { name: 'Pure one suit', faan: '+7', what: 'Every tile from one suit — no winds or dragons.', tiles: '123s 345s 678s 999s 22s' },
  { name: 'Big three dragons', faan: '+8', what: 'Pongs of all three dragons.', tiles: '555z 666z 777z' },
  { name: 'Small four winds', faan: '+8', what: 'Pongs of three winds and a pair of the fourth.', tiles: '111z 222z 333z 44z' },
  { name: 'Big four winds', faan: `${MAX_FAAN} (limit)`, what: 'Pongs of all four winds.', tiles: '111z 222z 333z 444z 66z' },
  { name: 'All honours', faan: `${MAX_FAAN} (limit)`, what: 'Only winds and dragons.', tiles: '222z 333z 555z 777z 11z' },
  { name: 'Thirteen orphans', faan: `${MAX_FAAN} (limit)`, what: 'One of every 1, 9, wind and dragon — plus a second of any one. No sets needed!', tiles: '19m 19p 19s 1234z 5677z' },
  { name: 'All eight flowers', faan: `${MAX_FAAN} (limit)`, what: 'Win holding every flower and season.' },
]

function scoringSection(inGame: InGame | null): HTMLElement {
  const s = el('section')
  s.append(el('h3', '', 'How to earn points'),
    para('Every winning hand scores ', el('strong', '', 'faan'), ' for the patterns in it. Add them up — more faan, more points.'),
    para(el('strong', 'min-note', inGame
      ? `This game: you need at least ${inGame.minFaan} faan to win.`
      : 'Before a game you choose the minimum faan needed to win (0, 1 or 3).')))

  for (const pt of PATTERNS) {
    const card = el('div', 'pattern-card')
    const head = el('div', 'pattern-head')
    const badge = pt.faan.includes('limit') ? pt.faan
      : pt.faan.includes('each') ? `${pt.faan.replace(' each', '')} faan each` : `${pt.faan} faan`
    head.append(el('strong', '', pt.name), el('span', 'faan-badge', badge))
    card.append(head, el('div', 'pattern-what', pt.what))
    if (pt.tiles || pt.bonus) {
      const row = el('div', 'pattern-tiles')
      for (const spec of pt.tiles?.split(' ') ?? []) row.appendChild(exampleTiles(spec, 'ex sm'))
      if (pt.bonus) { const g = el('span', 'tiles-row'); for (const t of pt.bonus) g.appendChild(tileEl(t, 'ex sm')); row.appendChild(g) }
      card.appendChild(row)
    }
    s.appendChild(card)
  }

  // what the faan are worth
  const table = el('div', 'payout-table')
  for (let f = 0; f <= MAX_FAAN; f++) table.append(el('span', 'pf', `${f}`), el('span', 'pp', fmt(payout(f))))
  s.append(el('h3', 'sub-h', 'What faan are worth'), table,
    para('If you win on someone’s thrown-away tile, ', el('strong', '', 'they pay'), ' the full amount. If you draw it yourself, ',
      el('strong', '', 'all three pay half'), ' each.'),
    para('Everyone starts with the same points (',
      el('strong', '', inGame ? fmt(inGame.startPoints) : '1,000, 2,000 or 5,000'),
      '). If anyone drops below zero, the game ends early. The dealer (East) keeps the deal after winning or a draw; otherwise it passes on.'))
  return s
}
