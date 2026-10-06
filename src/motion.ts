// Smooth movement between screens. The table is rebuilt from scratch on every change, so on its own
// a tile would vanish from one spot and pop up in another. render() calls capture() just before
// rebuilding and play() just after. Tiles are tagged with data-key (which physical tile) and
// data-place (where it lies: 'rack-0', 'pool', 'meld-2' …):
//  - a tile that changed place flies there along a gentle arc, as a flat "ghost" over the page
//    (the table is tilted in 3D, so the real tile waits hidden until the ghost lands on it);
//  - a tile that only shifted within your flat rack slides across;
//  - a new tile flies in from wherever `origin` says it came from, or drops into your rack.

interface Seen { rect: DOMRect; face: string; place: string }
interface Flight { ghost: HTMLElement; anim: Animation }

let before = new Map<string, Seen>()
let hadTable = false                       // the last screen was the table (not the menu)
const inFlight = new Map<string, Flight>()

const FLY_MS = 420
const SLIDE_MS = 260
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const inTable = (e: Element) => !!e.closest('.table')
const faceOf = (e: Element) => (e.querySelector('.face.top') ?? e).innerHTML

// Where a tile that wasn't on screen before comes from: a screen rectangle to fly in from, or null.
export type Origin = (e: HTMLElement) => DOMRect | null

export function capture(root: ParentNode) {
  before = new Map()
  hadTable = !!root.querySelector('.table')
  if (!hadTable) return
  for (const e of root.querySelectorAll<HTMLElement>('[data-key]')) {
    before.set(e.dataset.key!, { rect: e.getBoundingClientRect(), face: faceOf(e), place: e.dataset.place ?? '' })
  }
}

export function play(root: ParentNode, origin: Origin) {
  if (document.hidden) {                   // a background tab doesn't run animations: land everything now
    for (const f of inFlight.values()) f.anim.finish()
    return
  }
  if (!hadTable || reduced()) return       // coming from the menu: everything is simply there
  for (const e of root.querySelectorAll<HTMLElement>('[data-key]')) {
    const key = e.dataset.key!
    const was = before.get(key)
    if (was && was.place === (e.dataset.place ?? '')) {
      if (inFlight.has(key)) { e.style.visibility = 'hidden'; continue }   // its ghost is still on the way
      if (!inTable(e)) slide(e, was.rect)
      continue
    }
    const from = was?.rect ?? origin(e)
    if (from) fly(key, e, from, was?.face ?? faceOf(e))
    else if (!inTable(e)) drop(e)
  }
}

// FLIP within a flat row: start where it was, glide to where it is.
function slide(e: HTMLElement, from: DOMRect) {
  const to = e.getBoundingClientRect()
  const dx = from.left - to.left, dy = from.top - to.top
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
  e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
    { duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' })
}

// A new tile in your rack: it drops in from just above.
function drop(e: HTMLElement) {
  e.animate([{ opacity: 0, transform: 'translateY(-28px)' }, { opacity: 1, transform: 'none' }],
    { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' })
}

// A flat copy of the tile flies from `from` to the real tile's place along an arc, growing a little
// at the top of the arc as if lifted, then the real tile appears and settles.
function fly(key: string, target: HTMLElement, from: DOMRect, face: string) {
  const to = target.getBoundingClientRect()
  if (to.width === 0) return
  const old = inFlight.get(key)
  if (old) {                                // re-routed mid-flight (say, claimed as it landed): carry on from here
    from = old.ghost.getBoundingClientRect()
    old.anim.cancel()
    old.ghost.remove()
  }
  const g = document.createElement('div')
  g.className = 'ghost-tile' + (face.trim() ? '' : ' back')
  g.innerHTML = face
  Object.assign(g.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` })
  document.body.appendChild(g)
  target.style.visibility = 'hidden'

  const dx = to.left - from.left, dy = to.top - from.top
  const sx = to.width / from.width, sy = to.height / from.height
  const lift = Math.min(70, Math.hypot(dx, dy) * 0.18)
  const anim = g.animate([
    { transform: 'translate(0, 0) scale(1, 1)' },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(${((1 + sx) / 2) * 1.12}, ${((1 + sy) / 2) * 1.12})`, offset: 0.45 },
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
  ], { duration: FLY_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' })
  inFlight.set(key, { ghost: g, anim })
  anim.onfinish = () => {
    g.remove()
    inFlight.delete(key)
    const live = document.querySelector<HTMLElement>(`[data-key="${key}"]`)
    if (!live) return
    live.style.visibility = ''
    live.animate([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' })
  }
}
