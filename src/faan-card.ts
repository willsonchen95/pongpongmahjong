// The card behind the "Your hand" score pill: the faan you already have and why, the patterns
// within reach, and — when short of the game's minimum — plans to get there.
import { type HaveItem, type CloseTo, type Plan } from './engine'
import { el, mini } from './ui'
import { t, faanName } from './i18n'

// Why each pattern you already hold scores — in plain words for the hover card.
const HAVE_WHY: [string, string][] = [
  ['Concealed hand', 'You haven’t taken anyone’s tile. Avoid Pong / Chi to keep it.'],
  ['No flowers', 'You have no flower or season tiles.'],
  ['Own flower', 'A flower or season showing your seat number.'],
  ['Flower set', 'All four flowers, or all four seasons.'],
  ['All eight flowers', 'Every flower and season — a limit hand!'],
  ['Dragon pong', 'Three of the same dragon.'],
  ['Seat wind pong', 'Three of your seat’s wind.'],
  ['Round wind pong', 'Three of this round’s wind.'],
  ['Mixed one suit', 'Only one suit, plus winds and dragons.'],
  ['Pure one suit', 'Every tile from one suit.'],
  ['All honours', 'Only winds and dragons.'],
  ['Small three dragons', 'Pongs of two dragons and a pair of the third.'],
  ['Big three dragons', 'Pongs of all three dragons.'],
]
const whyOf = (name: string) => { const why = HAVE_WHY.find(([n]) => name.startsWith(n))?.[1]; return why ? t(why) : '' }

// The card behind the score pill: every faan you already have and why, then the combinations
// your current tiles can reach — with the exact tiles to collect or throw away.
// The plan to lead with: the easiest one that doesn't rely only on luck, if there is one.
export const headlinePlan = (plans: Plan[]) => plans.find(p => p.items.length > 0) ?? plans[0]

// One line naming a plan: "Mixed one suit", "Dragon pong + self-drawn", ...
export function planSummary(p: Plan): string {
  if (!p.items.length) return t('Win by drawing the winning tile yourself')
  return p.items.map(i => faanName(i.name)).join(' + ') + (p.selfDrawn ? ' + ' + t('self-drawn') : '')
}

// The engine's explanation of a goal, in the player's language (two of them name a suit).
function howText(how: string): string {
  const only = how.match(/^Keep only (\w+) — throw away the winds and dragons$/)
  if (only) return t('Keep only {suit} — throw away the winds and dragons', { suit: t(only[1]) })
  const plus = how.match(/^Keep (\w+) plus winds & dragons — throw away the other suits$/)
  if (plus) return t('Keep {suit} plus winds & dragons — throw away the other suits', { suit: t(plus[1]) })
  return t(how)
}

// One pattern to aim for, with its explanation and the exact tiles involved.
function goalRow(c: CloseTo, cls: string): HTMLElement {
  const row = el('div', 'hm-row ' + cls)
  const tiles = el('div', 'hm-row-tiles')
  tiles.appendChild(el('span', 'hm-tiles-label', c.action === 'need' ? t('Need:') : t('Throw away:')))
  for (const t of c.tiles) tiles.appendChild(mini(t))
  row.append(el('div', 'hm-row-name', faanName(c.name)), el('div', 'hm-row-faan', `+${c.faan}`), el('div', 'hm-row-why', howText(c.how)), tiles)
  return row
}

// "How to reach 3 faan": each plan as a numbered card listing what to complete.
function plansSection(plans: Plan[], total: number, minFaan: number): HTMLElement {
  const s = el('div', 'hm-plans')
  s.appendChild(el('h4', '', t('How to reach {min} faan', { min: minFaan })))
  s.appendChild(el('p', 'hm-plans-intro', t('You have {total}. This game needs {min} to win — here’s how your tiles could get there:', { total, min: minFaan })))
  if (!plans.length) {
    s.appendChild(el('p', 'hm-empty', t('No quick route from these tiles yet. Try keeping just one suit (plus winds and dragons) — that alone is +3.')))
  }
  plans.forEach((p, i) => {
    const box = el('div', 'hm-plan')
    const head = el('div', 'hm-plan-head')
    const effort = p.off === 0 ? t('nothing to change') : t(p.off > 1 ? 'about {n} tiles to change' : 'about {n} tile to change', { n: p.off })
    head.append(el('span', 'hm-plan-num', t('Plan {n}', { n: i + 1 })), el('span', 'hm-plan-effort', effort), el('span', 'hm-plan-total', `→ ${p.total} faan`))
    box.appendChild(head)
    for (const item of p.items) box.appendChild(goalRow(item, 'plan-step'))
    if (p.selfDrawn) {
      const luck = el('div', 'hm-row plan-step luck')
      luck.append(el('div', 'hm-row-name', t('Self-drawn')), el('div', 'hm-row-faan', '+1'),
        el('div', 'hm-row-why', t('Then win by drawing the winning tile from the wall yourself — not on someone’s throw.')))
      box.appendChild(luck)
    }
    s.appendChild(box)
  })
  return s
}

export function faanCard(have: HaveItem[], close: CloseTo[], total: number, plans: Plan[], minFaan: number): HTMLElement {
  const card = el('div', 'hm-card')
  card.appendChild(el('div', 'hm-card-title', t('Your hand: {total} faan so far', { total })))
  if (total < minFaan) card.appendChild(plansSection(plans, total, minFaan))

  card.appendChild(el('h4', '', t('What you have')))
  if (!have.length) card.appendChild(el('p', 'hm-empty', t('Nothing yet — every finished hand still wins if it reaches the minimum.')))
  for (const item of have) {
    const row = el('div', 'hm-row')
    const name = el('div', 'hm-row-name', faanName(item.name))
    if (item.tile) name.appendChild(mini(item.tile))
    row.append(name, el('div', 'hm-row-faan', `+${item.faan}`), el('div', 'hm-row-why', whyOf(item.name)))
    card.appendChild(row)
  }

  card.appendChild(el('h4', '', t('Go for next')))
  if (!close.length) card.appendChild(el('p', 'hm-empty', t('Nothing close yet — keep building sets of three and a pair.')))
  for (const c of close) card.appendChild(goalRow(c, 'next'))
  const tip = el('div', 'hm-row next')
  tip.append(el('div', 'hm-row-name', t('Self-drawn')), el('div', 'hm-row-faan', '+1'),
    el('div', 'hm-row-why', t('Any time: win by drawing the winning tile yourself.')))
  card.appendChild(tip)

  card.appendChild(el('div', 'hm-card-foot', t('This game needs at least {min} faan to win. Faan count once your hand is finished (4 sets + 1 pair).', { min: minFaan })))
  return card
}
