// The card behind the "Your hand" score pill: the faan you already have and why, the patterns
// within reach, and — when short of the game's minimum — plans to get there.
import { type HaveItem, type CloseTo, type Plan } from './engine'
import { el, mini } from './ui'

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
const whyOf = (name: string) => HAVE_WHY.find(([n]) => name.startsWith(n))?.[1] ?? ''

// The card behind the score pill: every faan you already have and why, then the combinations
// your current tiles can reach — with the exact tiles to collect or throw away.
// The plan to lead with: the easiest one that doesn't rely only on luck, if there is one.
export const headlinePlan = (plans: Plan[]) => plans.find(p => p.items.length > 0) ?? plans[0]

// One line naming a plan: "Mixed one suit", "Dragon pong + self-drawn", ...
export function planSummary(p: Plan): string {
  if (!p.items.length) return 'Win by drawing the winning tile yourself'
  return p.items.map(i => i.name).join(' + ') + (p.selfDrawn ? ' + self-drawn' : '')
}

// One pattern to aim for, with its explanation and the exact tiles involved.
function goalRow(c: CloseTo, cls: string): HTMLElement {
  const row = el('div', 'hm-row ' + cls)
  const tiles = el('div', 'hm-row-tiles')
  tiles.appendChild(el('span', 'hm-tiles-label', c.action === 'need' ? 'Need:' : 'Throw away:'))
  for (const t of c.tiles) tiles.appendChild(mini(t))
  row.append(el('div', 'hm-row-name', c.name), el('div', 'hm-row-faan', `+${c.faan}`), el('div', 'hm-row-why', c.how), tiles)
  return row
}

// "How to reach 3 faan": each plan as a numbered card listing what to complete.
function plansSection(plans: Plan[], total: number, minFaan: number): HTMLElement {
  const s = el('div', 'hm-plans')
  s.appendChild(el('h4', '', `How to reach ${minFaan} faan`))
  s.appendChild(el('p', 'hm-plans-intro', `You have ${total}. This game needs ${minFaan} to win — here’s how your tiles could get there:`))
  if (!plans.length) {
    s.appendChild(el('p', 'hm-empty', 'No quick route from these tiles yet. Try keeping just one suit (plus winds and dragons) — that alone is +3.'))
  }
  plans.forEach((p, i) => {
    const box = el('div', 'hm-plan')
    const head = el('div', 'hm-plan-head')
    const effort = p.off === 0 ? 'nothing to change' : `about ${p.off} tile${p.off > 1 ? 's' : ''} to change`
    head.append(el('span', 'hm-plan-num', `Plan ${i + 1}`), el('span', 'hm-plan-effort', effort), el('span', 'hm-plan-total', `→ ${p.total} faan`))
    box.appendChild(head)
    for (const item of p.items) box.appendChild(goalRow(item, 'plan-step'))
    if (p.selfDrawn) {
      const luck = el('div', 'hm-row plan-step luck')
      luck.append(el('div', 'hm-row-name', 'Self-drawn'), el('div', 'hm-row-faan', '+1'),
        el('div', 'hm-row-why', 'Then win by drawing the winning tile from the wall yourself — not on someone’s throw.'))
      box.appendChild(luck)
    }
    s.appendChild(box)
  })
  return s
}

export function faanCard(have: HaveItem[], close: CloseTo[], total: number, plans: Plan[], minFaan: number): HTMLElement {
  const card = el('div', 'hm-card')
  card.appendChild(el('div', 'hm-card-title', `Your hand: ${total} faan so far`))
  if (total < minFaan) card.appendChild(plansSection(plans, total, minFaan))

  card.appendChild(el('h4', '', 'What you have'))
  if (!have.length) card.appendChild(el('p', 'hm-empty', 'Nothing yet — every finished hand still wins if it reaches the minimum.'))
  for (const item of have) {
    const row = el('div', 'hm-row')
    const name = el('div', 'hm-row-name', item.name)
    if (item.tile) name.appendChild(mini(item.tile))
    row.append(name, el('div', 'hm-row-faan', `+${item.faan}`), el('div', 'hm-row-why', whyOf(item.name)))
    card.appendChild(row)
  }

  card.appendChild(el('h4', '', 'Go for next'))
  if (!close.length) card.appendChild(el('p', 'hm-empty', 'Nothing close yet — keep building sets of three and a pair.'))
  for (const c of close) card.appendChild(goalRow(c, 'next'))
  const tip = el('div', 'hm-row next')
  tip.append(el('div', 'hm-row-name', 'Self-drawn'), el('div', 'hm-row-faan', '+1'),
    el('div', 'hm-row-why', 'Any time: win by drawing the winning tile yourself.'))
  card.appendChild(tip)

  card.appendChild(el('div', 'hm-card-foot', `This game needs at least ${minFaan} faan to win. Faan count once your hand is finished (4 sets + 1 pair).`))
  return card
}
