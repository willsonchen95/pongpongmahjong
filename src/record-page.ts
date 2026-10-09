// The "Your record" page: how you've done (games, hands won, best run), your biggest hand with its
// tiles, how you fare against each bot level, the challenges to collect, and your recent games.
// Everything comes from record.ts — kept on this device only.

import { makeTile } from './engine'
import { el, tileEl, button, pageTitle, signed } from './ui'
import { CHALLENGES, byLevel, type PlayerRecord, type GameEntry } from './record'

const LEVELS = [['easy', 'Easy bots'], ['normal', 'Normal bots'], ['hard', 'Hard bots']] as const
const PLACES = ['1st', '2nd', '3rd', '4th']
const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

// One number with what it is, in the row along the top.
function stat(value: string, label: string): HTMLElement {
  const s = el('div', 'rec-stat')
  s.append(el('strong', '', value), el('span', '', label))
  return s
}

// "Hong Kong · Hard bots" / "Family (min 5) · online"
function gameLabel(g: GameEntry): string {
  const style = g.style === 'family' ? `Family (min ${g.minFaan})` : 'Hong Kong'
  const who = g.online ? 'online' : `${g.bots[0].toUpperCase()}${g.bots.slice(1)} bots`
  return `${style} · ${who}${g.rounds === 4 ? ' · full game' : ''}`
}
function gameResult(g: GameEntry): string {
  const wins = `${g.wins} win${g.wins === 1 ? '' : 's'}`
  return g.points === null ? wins : `${wins} · ${signed(g.points)} pts`
}

// `clear`: asks, then wipes the record (main.ts owns the dialog); `back`: where Back goes.
export function renderRecordPage(app: HTMLElement, record: PlayerRecord, back: () => void, clear: () => void) {
  app.innerHTML = ''
  const page = el('div', 'rules-page record-page')
  const body = el('div', 'rules-body help')

  // the row of numbers
  const done = CHALLENGES.filter(c => record.challenges[c.id]).length
  const top = el('section', 'rec-stats')
  top.append(
    stat(String(record.games.length), record.games.length === 1 ? 'game played' : 'games played'),
    stat(`${record.handsWon}`, `hand${record.handsWon === 1 ? '' : 's'} won${record.handsPlayed ? ` of ${record.handsPlayed}` : ''}`),
    stat(String(record.bestStreak), 'best run of wins'),
    stat(`${done}/${CHALLENGES.length}`, 'challenges'),
  )

  // the biggest hand, tiles and all
  const best = el('section')
  best.appendChild(el('h3', '', 'Your biggest hand'))
  if (record.best) {
    const b = record.best
    const tiles = el('div', 'result-hand rec-hand')
    for (const g of b.groups) {
      const group = el('div', 'rh-group')
      for (const [c, v] of g) group.appendChild(tileEl(makeTile(c, v), 'rh'))
      tiles.appendChild(group)
    }
    const items = el('div', 'rec-items')
    for (const i of b.items) items.append(el('span', '', i.name), el('strong', '', `+${i.faan}`))
    best.append(el('p', 'rec-big', `${b.faan} faan${b.limit ? ' — a limit hand' : ''} · ${day(b.at)}`), tiles, items)
  } else {
    best.appendChild(el('p', 'rec-empty', 'Win a hand and your biggest one shows here, with all its tiles.'))
  }

  // against each bot level
  const levels = el('section')
  levels.appendChild(el('h3', '', 'Against the bots'))
  const counts = byLevel(record)
  const rows = el('div', 'rec-levels')
  for (const [level, name] of LEVELS) {
    const { games, first } = counts[level]
    rows.append(el('span', '', name), el('strong', '', games ? `${first} of ${games} won` : '—'))
  }
  levels.append(rows, el('p', 'rec-note', 'Games played to the end; first place counts as won.'))

  // the challenges, as stamps
  const ch = el('section')
  ch.appendChild(el('h3', '', `Challenges · ${done} of ${CHALLENGES.length}`))
  const grid = el('div', 'rec-challenges')
  for (const c of CHALLENGES) {
    const at = record.challenges[c.id]
    const card = el('div', 'rec-challenge' + (at ? ' done' : ''))
    const mark = el('span', 'rec-seal', at ? '✓' : '')
    const text = el('div', 'rec-ch-text')
    text.append(el('strong', '', c.title), el('span', '', at ? `${c.hint} · ${day(at)}` : c.hint))
    card.append(mark, text)
    grid.appendChild(card)
  }
  ch.appendChild(grid)

  // recent games
  const recent = el('section')
  recent.appendChild(el('h3', '', 'Recent games'))
  if (record.games.length) {
    const list = el('div', 'rec-games')
    for (const g of record.games.slice(0, 10)) {
      const row = el('div', 'rec-game' + (g.place === 1 && !g.early ? ' first' : ''))
      const what = el('div', 'rec-game-what')
      what.append(el('strong', '', gameLabel(g)), el('span', '', `${day(g.at)} · ${g.hands} hand${g.hands === 1 ? '' : 's'}${g.early ? ' · ended early' : ''}`))
      row.append(el('span', 'rec-place', PLACES[g.place - 1] ?? '—'), what, el('span', 'rec-game-result', gameResult(g)))
      list.appendChild(row)
    }
    recent.appendChild(list)
  } else {
    recent.appendChild(el('p', 'rec-empty', 'Finish a game and it shows here.'))
  }

  const privacy = el('p', 'rec-note', 'Your record is kept on this device only — it’s never sent anywhere.')
  body.append(top, best, ch, levels, recent, privacy)
  const foot = el('div', 'rules-foot')
  foot.append(button('Back to menu', back, 'act'))
  if (record.handsPlayed || record.games.length) foot.appendChild(button('Clear my record', clear, 'act rec-clear'))
  page.append(pageTitle('Your record', back, 'Back to the menu'), body, foot)
  app.appendChild(page)
  window.scrollTo(0, 0)
}
