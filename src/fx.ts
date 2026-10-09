// Effects over the table: the light that follows whose turn it is, the "Mahjong!" card when
// someone wins, and short notices at the top of the screen.
import { el } from './ui'

// A soft light on the table in front of whoever's turn it is. Each seat has its own light,
// and they stay the same elements between redraws, so when the turn passes one fades out as the
// next fades in.
export function turnGlow() {
  const e = el('div', 'turn-glow')
  const lights = [0, 1, 2, 3].map(seat => {
    const l = el('div', 'tg-light')
    l.style.setProperty('--turn-angle', `${-90 * seat}deg`)   // 0 = you, at the bottom; then counter-clockwise
    e.appendChild(l)
    return l
  })
  return {
    el: e,
    // light up `to`'s side, or none with null
    point(to: number | null) { lights.forEach((l, seat) => l.classList.toggle('on', seat === to)) },
  }
}

// "Mahjong!" on a card over the table when someone wins: fades in, then out (about 2 seconds).
export function mahjongBurst(over: HTMLElement, sub: string, you: boolean) {
  document.querySelector('.mahjong-burst')?.remove()
  const r = over.getBoundingClientRect()
  const b = el('div', 'mahjong-burst' + (you ? ' you' : ''))
  b.append(el('div', 'mb-word', 'Mahjong!'), el('div', 'mb-sub', sub))
  b.style.left = `${r.left + r.width / 2}px`
  b.style.top = `${r.top + r.height * 0.45}px`
  b.addEventListener('animationend', e => { if (e.target === b) b.remove() })
  document.body.appendChild(b)
}

// A short notice at the top of the screen (someone left the room, came back, joined), gone after a
// few seconds. Several stack, newest at the bottom.
export function notice(text: string) {
  let stack = document.querySelector<HTMLElement>('.notices')
  if (!stack) { stack = el('div', 'notices'); document.body.appendChild(stack) }
  const n = el('div', 'notice', text)
  n.addEventListener('animationend', e => { if (e.animationName === 'notice-life') n.remove() })
  stack.appendChild(n)
}
