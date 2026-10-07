// Effects over the table: the glow that follows whose turn it is, the "Mahjong!" burst when
// someone wins, and confetti when it's you.
import { el } from './ui'

// A soft gold light on the table in front of whoever's turn it is. Each seat has its own light,
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

// The big "Mahjong!" that bursts over the table when someone wins, then fades (about 2 seconds).
export function mahjongBurst(over: HTMLElement, sub: string, you: boolean) {
  document.querySelector('.mahjong-burst')?.remove()
  const r = over.getBoundingClientRect()
  const b = el('div', 'mahjong-burst' + (you ? ' you' : ''))
  b.append(el('div', 'mb-rays'), el('div', 'mb-word', 'Mahjong!'), el('div', 'mb-sub', sub))
  b.style.left = `${r.left + r.width / 2}px`
  b.style.top = `${r.top + r.height * 0.45}px`
  b.addEventListener('animationend', e => { if (e.target === b) b.remove() })
  document.body.appendChild(b)
}

// Confetti falling over the table when you win.
export function confetti(): HTMLElement {
  const layer = el('div', 'confetti')
  const colours = ['#e0b53a', '#d0282b', '#1d7a3a', '#2f80d0', '#ffffff', '#ff8fb1']
  for (let i = 0; i < 70; i++) {
    const piece = el('i')
    piece.style.left = `${Math.random() * 100}%`
    piece.style.background = colours[i % colours.length]
    piece.style.animationDelay = `${Math.random() * 0.8}s`
    piece.style.animationDuration = `${2.2 + Math.random() * 1.6}s`
    piece.style.setProperty('--spin', `${(Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540)}deg`)
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`)
    layer.appendChild(piece)
  }
  setTimeout(() => layer.remove(), 4500)
  return layer
}
