// Smooth movement between screens. The table is rebuilt from scratch on every change, so on its own
// a tile would vanish from one spot and pop up in another. render() calls capture() just before
// rebuilding and play() just after. Tiles are tagged with data-key (which physical tile) and
// data-place (where it lies: 'rack-0', 'pool', 'meld-2' …); wall stacks with data-stack and
// data-height (how many tiles it still holds):
//  - a tile that changed place flies there along a gentle arc, as a flat "ghost" over the page
//    (the table is tilted in 3D, so the real tile waits hidden until the ghost lands on it);
//  - a tile that only shifted within your flat rack slides across;
//  - tiles taken off the wall lift from the very stack they came from: into your rack (turning
//    face up on the way), or face down to whoever is drawing;
//  - any other new tile flies in from wherever `origin` says it came from, or drops into your rack.

interface Seen { rect: DOMRect; face: string; place: string }
interface Stack { rect: DOMRect; height: number }
interface Flight { ghost: HTMLElement; anim: Animation }

export interface Hooks {
  origin(e: HTMLElement): DOMRect | null   // where a new tile (not from the wall) comes from
  wallSink(): DOMRect | null               // where face-down tiles off the wall go (a bot's rack)
}

let before = new Map<string, Seen>()
let stacks = new Map<string, Stack>()
let hadTable = false                       // the last screen was the table (not the menu)
const inFlight = new Map<string, Flight>()

const FLY_MS = 420
const SLIDE_MS = 260
const STAGGER_MS = 45                      // between tiles taken together (four at a time in the deal)
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const inTable = (e: Element) => !!e.closest('.table')
const faceOf = (e: Element) => (e.querySelector('.face.top') ?? e).innerHTML

export function capture(root: ParentNode) {
  before = new Map()
  stacks = new Map()
  hadTable = !!root.querySelector('.table')
  if (!hadTable) return
  for (const e of root.querySelectorAll<HTMLElement>('[data-key]')) {
    before.set(e.dataset.key!, { rect: e.getBoundingClientRect(), face: faceOf(e), place: e.dataset.place ?? '' })
  }
  for (const e of root.querySelectorAll<HTMLElement>('[data-stack]')) {
    stacks.set(e.dataset.stack!, { rect: e.getBoundingClientRect(), height: Number(e.dataset.height) })
  }
}

export function play(root: ParentNode, hooks: Hooks) {
  if (document.hidden) {                   // a background tab doesn't run animations: land everything now
    for (const f of inFlight.values()) f.anim.finish()
    return
  }
  if (!hadTable || reduced()) return       // coming from the menu: everything is simply there

  // one entry per tile that just left the wall, at the stack it left from
  const taken: DOMRect[] = []
  for (const e of root.querySelectorAll<HTMLElement>('[data-stack]')) {
    const was = stacks.get(e.dataset.stack!)
    if (was) for (let n = Number(e.dataset.height); n < was.height; n++) taken.push(was.rect)
  }
  let delay = 0
  const light = lite()
  const dealt: HTMLElement[] = []          // (touch screens) new tiles in your rack, flown in as one bundle

  for (const e of root.querySelectorAll<HTMLElement>('[data-key]')) {
    const key = e.dataset.key!
    const was = before.get(key)
    if (was && was.place === (e.dataset.place ?? '')) {
      if (inFlight.has(key)) { e.style.visibility = 'hidden'; continue }   // its ghost is still on the way
      if (!inTable(e)) slide(e, was.rect)
      continue
    }
    if (was) { fly(key, e, was.rect, was.face); continue }
    if (e.dataset.place === 'rack-0' && taken.length) {        // drawn or dealt to you: off the wall, turning over
      if (light) { dealt.push(e); continue }
      fly(key, e, taken.shift()!, '', faceOf(e), delay)
      delay += STAGGER_MS
      continue
    }
    const from = hooks.origin(e)
    if (from) fly(key, e, from, faceOf(e))
    else if (!inTable(e)) drop(e)
  }
  if (dealt.length) flyBundle(dealt, taken.splice(0, dealt.length)[0])

  // the rest went face down to someone else's rack (on touch screens, as one bundle)
  const sink = taken.length ? hooks.wallSink() : null
  if (sink && light) flyAway(taken[0], sink, 0, taken.length)
  else if (sink) for (const from of taken) { flyAway(from, sink, delay); delay += STAGGER_MS }
}

// Touch screens (phones, tablets) get lighter animations: tiles taken off the wall together — four at
// a time in the deal — fly as one face-down bundle instead of one tile each, turning over as they land.
const lite = () => matchMedia('(pointer: coarse)').matches

// A row of `n` face-down tiles, starting at the stack `from`.
const row = (from: DOMRect, n: number) => new DOMRect(from.left, from.top, from.width * Math.min(n, 4), from.height)

function flyBundle(targets: HTMLElement[], from: DOMRect) {
  const rects = targets.map(t => t.getBoundingClientRect())
  const left = Math.min(...rects.map(r => r.left)), top = Math.min(...rects.map(r => r.top))
  const to = new DOMRect(left, top, Math.max(...rects.map(r => r.right)) - left, Math.max(...rects.map(r => r.bottom)) - top)
  const start = row(from, targets.length)
  const g = ghostAt(start, '', Math.min(targets.length, 4))
  for (const t of targets) t.style.visibility = 'hidden'
  const anim = g.animate(arc(start, to), { duration: FLY_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' })
  const keys = targets.map(t => t.dataset.key!)
  for (const k of keys) inFlight.set(k, { ghost: g, anim })
  const land = () => {
    g.remove()
    for (const k of keys) {
      if (inFlight.get(k)?.anim !== anim) continue
      inFlight.delete(k)
      const live = document.querySelector<HTMLElement>(`[data-key="${k}"]`)
      if (live) live.style.visibility = ''
    }
  }
  anim.onfinish = land
  anim.oncancel = land                     // one of them re-routed mid-flight: the rest still appear
}

// FLIP within a flat row: start where it was, glide to where it is.
function slide(e: HTMLElement, from: DOMRect) {
  const to = e.getBoundingClientRect()
  const dx = from.left - to.left, dy = from.top - to.top
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
  e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
    { duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' })
}

// A new tile in your rack with nowhere to come from: it drops in from just above.
function drop(e: HTMLElement) {
  e.animate([{ opacity: 0, transform: 'translateY(-28px)' }, { opacity: 1, transform: 'none' }],
    { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' })
}

function ghostAt(from: DOMRect, face: string, n = 1): HTMLElement {
  const g = document.createElement('div')
  g.className = 'ghost-tile' + (face.trim() ? '' : ' back')
  g.innerHTML = face
  Object.assign(g.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` })
  // a bundle: thin seams between its tiles
  if (n > 1) g.style.setProperty('--seams', `repeating-linear-gradient(to right, transparent 0 calc(${100 / n}% - 1.5px), rgba(0, 0, 0, 0.45) calc(${100 / n}% - 1.5px) ${100 / n}%)`)
  document.body.appendChild(g)
  return g
}

// The path from one rectangle to another: lifted at the top of the arc, growing a little as if
// picked up. `end` adds to the last keyframe (to fade out, say).
function arc(from: DOMRect, to: DOMRect, end: Keyframe = {}): Keyframe[] {
  const dx = to.left - from.left, dy = to.top - from.top
  const sx = to.width / from.width, sy = to.height / from.height
  const lift = Math.min(70, Math.hypot(dx, dy) * 0.18)
  return [
    { transform: 'translate(0, 0) scale(1, 1)' },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(${((1 + sx) / 2) * 1.12}, ${((1 + sy) / 2) * 1.12})`, offset: 0.45 },
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, ...end },
  ]
}

// A flat copy of the tile flies from `from` to the real tile's place, then the real tile appears
// and settles. With `reveal`, the copy starts face down and turns face up halfway.
function fly(key: string, target: HTMLElement, from: DOMRect, face: string, reveal = '', delay = 0) {
  const to = target.getBoundingClientRect()
  if (to.width === 0) return
  const old = inFlight.get(key)
  if (old) {                                // re-routed mid-flight (say, claimed as it landed): carry on from here
    from = old.ghost.getBoundingClientRect()
    old.anim.cancel()
    old.ghost.remove()
  }
  const g = ghostAt(from, face)
  target.style.visibility = 'hidden'
  const anim = g.animate(arc(from, to), { duration: FLY_MS, delay, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' })
  if (reveal) {
    // turn over at the top of the arc: squash flat, swap to the face, open out again
    g.animate([{ scale: '1 1' }, { scale: '0 1', offset: 0.5 }, { scale: '1 1' }],
      { duration: 160, delay: delay + FLY_MS * 0.35, easing: 'ease-in-out' })
    setTimeout(() => { g.classList.remove('back'); g.innerHTML = reveal }, delay + FLY_MS * 0.35 + 80)
  }
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

// A face-down tile (or a bundle of `n`) off the wall to another player's rack, where it melts into their hand.
function flyAway(from: DOMRect, to: DOMRect, delay: number, n = 1) {
  if (n > 1) { from = row(from, n); to = new DOMRect(to.left - (to.width * (Math.min(n, 4) - 1)) / 2, to.top, to.width * Math.min(n, 4), to.height) }
  const g = ghostAt(from, '', Math.min(n, 4))
  g.animate(arc(from, to, { opacity: 0.2 }), { duration: FLY_MS, delay, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' })
    .onfinish = () => g.remove()
}
