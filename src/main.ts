import './style.css'
import {
  type Tile, type GameState, type ClaimKind, type FaanItem, type HaveItem, type CloseTo, SEATS, deal, drawTile, sortHand, makeTile, isWinningHand,
  botDiscard, botWantsKong, canPong, canKong, canWinOn, chowOptions, claimDiscard, kongOptions, declareKong, botClaim, winningTiles,
  parse, sameTile, seatWind, scoreHand, settle, payout, handProgress, planToMinimum, type Plan, MAX_FAAN, claimEffects,
} from './engine'
import { tileSVG, tileName } from './tiles'
import { sfx, music, isMuted, setMuted } from './sfx'

// Players sit in fixed places: you at the bottom, then counter-clockwise (the turn order)
// Mei on your right, Kai across, Lin on your left. Seat winds move as the deal passes round.
const HUMAN = 0
const NAMES = ['You', 'Mei', 'Kai', 'Lin']
const WIND_CHARS = ['東', '南', '西', '北']
const possessive = (p: number) => (p === HUMAN ? 'your' : `${NAMES[p]}’s`)
const fmt = (n: number) => n.toLocaleString('en-US')
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0')

// ---------- The match: several hands, scores carried over, dealer and round wind moving on ----------
// Everyone starts at 0; each win moves points from the payers to the winner, so scores always sum to 0.
// Before the game the table agrees a minimum faan: a complete hand scoring less can't be declared.

// What the players agree before a game; remembered for next time.
interface Settings { rounds: number; minFaan: number; tips: boolean }
const SETTINGS_KEY = 'mahjong-settings'
let settings: Settings = (() => {
  const fallback = { rounds: 1, minFaan: 1, tips: true }
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') } } catch { return fallback }
})()
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* storage unavailable — keep it in memory */ }
}

interface HandResult {
  winner: number | null                // null = the wall ran out
  from: number | null                  // who threw the winning tile; null = self-drawn
  faan: number
  limit: boolean
  items: FaanItem[]
  deltas: number[]                     // score change per player
  dealerStays: boolean
}
interface Match {
  rounds: number                       // 1 = East round only, 4 = full game
  minFaan: number                      // the agreed minimum to declare a win
  scores: number[]
  roundWind: number                    // 0 = East round …
  dealer: number                       // who deals the next/current hand
  passes: number                       // times the deal has passed on; every 4 the round wind moves on
  hand: number                         // hand number within the match, from 1
  result: HandResult | null            // the hand just finished
  over: boolean
}
const newMatch = (s: Settings): Match => ({
  rounds: s.rounds, minFaan: s.minFaan, scores: [0, 0, 0, 0],
  roundWind: 0, dealer: 0, passes: 0, hand: 0, result: null, over: false,
})
let match: Match = newMatch(settings)

// ---------- One hand ----------

let game: GameState = deal()
let started = false               // a match is under way (enables "Resume" in the menu)
let mustDiscard = false           // it's your turn and you must discard (or declare a kong)
let winFrom: number | null = null // player whose discard won the hand; null = self-drawn
let lastDiscard: number | null = null  // player whose latest discard is the newest tile on the table (for highlighting)
let pool: Tile[] = []             // every discard still on the table, in the order thrown — shown in the middle
let wallBreak = 0                 // where the wall is broken open, in ring slots — cosmetic, random per hand
let gen = 0                       // bumped on every new hand, so a bot loop from an old hand stops
let inMenu = true                 // the menu is showing — bot turns carry on but don't redraw over it
// Short pop-up banners ("Your turn", "Mei: Pong!") waiting to be shown on the next render.
// seat = which side of the table it appears on; null = the middle.
interface Banner { text: string; kind: 'turn' | 'call' | 'flower'; seat: number | null; tiles?: Tile[] }
let banners: Banner[] = []
let winTile: Tile | null = null   // the tile that completed the winning hand (raised on the result card)
let resultClosed = false          // the end-of-hand card was dismissed to look at the table
let showFinal = false             // the match is over and the final standings are showing
let celebrate = false             // confetti pending — shown once, not on every re-render
let faanCardOpen = false          // the "Your hand" details card, tapped open (it also opens on hover)
const HELP_KEY = 'mahjong-help-open'
// Open by default only when it fits beside the table (on narrow screens it would cover the table).
let helpOpen = (() => {
  const roomy = window.innerWidth > 1150
  try { const saved = localStorage.getItem(HELP_KEY); return saved === null ? roomy : saved === '1' } catch { return roomy }
})()

// A discard you may claim. Only options that would actually succeed are offered —
// anything a higher-priority bot claim would beat is already left out.
interface Offer { from: number; tile: Tile; win: boolean; pong: boolean; kong: boolean; chows: number[][] }
let offer: Offer | null = null

type Draw = 'normal' | 'replacement' | 'none'     // replacement = from the back of the wall, after a kong
const nextSeat = (seat: number) => (seat + 1) % 4
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const BOT_THINK_MS = 900          // pause before each bot move, so you can follow the play
const CLAIM_PAUSE_MS = 1100       // extra pause after a bot claims a discard
// What players see and hear for each call. (The rules code calls a run a "chow"; on screen it's "Chi".)
const CALL_WORDS: Record<ClaimKind, string> = { pong: 'Pong!', kong: 'Kong!', chow: 'Chi!' }

// The winning tile is always the last one added to the hand (the draw, or the claimed discard).
function win(seat: number, from: number | null = null) {
  const hand = game.hands[seat]
  winTile = hand[hand.length - 1]
  game.over = true; game.winner = seat; winFrom = from; game.drawn = null; mustDiscard = false
  celebrate = seat === HUMAN
  sfx.win()
  endHand(seat, from)
}
function wallExhausted() {
  game.over = true; game.drawn = null; mustDiscard = false
  endHand(null, null)
}

// Score the hand, pay out, and move the match on: the dealer keeps the deal after winning or a
// draw, otherwise it passes to the next player; after four passes the round wind moves on.
function endHand(winner: number | null, from: number | null) {
  const dealerStays = winner === null || winner === game.dealer
  let result: HandResult
  if (winner === null) {
    result = { winner, from, faan: 0, limit: false, items: [], deltas: [0, 0, 0, 0], dealerStays }
  } else {
    const s = scoreHand({
      concealed: game.hands[winner], melds: game.melds[winner], bonus: game.bonus[winner],
      selfDrawn: from === null, seatWind: seatWind(game, winner), roundWind: game.roundWind,
    })
    result = { winner, from, ...s, deltas: settle(winner, from, s.faan), dealerStays }
  }
  result.deltas.forEach((d, p) => { match.scores[p] += d })
  match.result = result
  if (!dealerStays) {
    match.dealer = nextSeat(match.dealer)
    match.passes++
    if (match.passes % 4 === 0) match.roundWind++
  }
  match.over = match.roundWind >= match.rounds
}

// The faan a player would score with these concealed tiles (assumed to make a complete hand).
function faanOf(seat: number, concealed: Tile[], selfDrawn: boolean): number {
  return scoreHand({
    concealed, melds: game.melds[seat], bonus: game.bonus[seat],
    selfDrawn, seatWind: seatWind(game, seat), roundWind: game.roundWind,
  }).faan
}
// May this player declare a win — with the tile just drawn, or with someone's discard?
// The hand must be complete AND reach the agreed minimum faan.
function canDeclareSelfDrawn(seat: number): boolean {
  const hand = game.hands[seat]
  return isWinningHand(hand, game.melds[seat].length) && faanOf(seat, hand, true) >= match.minFaan
}
function canDeclareOn(seat: number, tile: Tile): boolean {
  return canWinOn(game, seat, tile) && faanOf(seat, [...game.hands[seat], tile], false) >= match.minFaan
}

// Draw for a player, announcing any flowers/seasons that turn up (they're set aside and replaced).
function drawFor(seat: number, fromBack: boolean): Tile | null {
  const before = game.bonus[seat].length
  const t = drawTile(game, seat, fromBack)
  const found = game.bonus[seat].slice(before)
  if (found.length) announceFlowers(seat, found)
  return t
}

// "Kai: Flower!" banner and a bell — "Own flower! +1 faan" when one matches the player's seat.
function announceFlowers(seat: number, tiles: Tile[]) {
  const own = tiles.filter(t => t.value === seatWind(game, seat)).length
  const what = tiles.every(t => t.category === 'season') ? 'Season' : 'Flower'
  const text = own ? `${NAMES[seat]}: Own ${what.toLowerCase()}! +${own} faan` : `${NAMES[seat]}: ${what}${tiles.length > 1 ? 's' : ''}!`
  banners.push({ text, kind: 'flower', seat, tiles })
  sfx.flower()
}

// Someone called pong/chow/kong: say it, and pop up a banner on their side showing the set.
function announceCall(seat: number, kind: ClaimKind, meld: Tile[]) {
  sfx.call(CALL_WORDS[kind])
  banners.push({ text: `${NAMES[seat]}: ${CALL_WORDS[kind]}`, kind: 'call', seat, tiles: meld })
}
const lastMeld = (seat: number) => game.melds[seat][game.melds[seat].length - 1]
const kongMeld = (seat: number, t: Tile) => game.melds[seat].find(m => m.length === 4 && sameTile(m[0], t))!

// Play from `seat`'s turn until you must act (discard or a claim decision) or the hand ends.
// Bots pause before moving; the loop gives up if a new hand was started meanwhile.
async function play(seat: number, draw: Draw) {
  const myGen = gen
  const stale = () => myGen !== gen
  while (!game.over) {
    game.current = seat
    let drawn: Tile | null = null
    if (draw !== 'none') {
      drawn = drawFor(seat, draw === 'replacement')
      if (drawn === null) { wallExhausted(); break }
      sfx.draw(seat !== HUMAN)
    }
    if (seat === HUMAN) {
      game.drawn = drawn
      if (drawn && canDeclareSelfDrawn(HUMAN)) win(HUMAN)   // self-draw
      else {
        mustDiscard = true
        // after your own pong/chow the call banner already says it's your move
        if (drawn) { banners.push({ text: 'Your turn', kind: 'turn', seat: null }); sfx.yourTurn() }
      }
      break
    }
    refresh()
    await gameIdle()                              // a tip, the pause box or the menu is up: wait
    await sleep(BOT_THINK_MS)
    await gameIdle()
    if (stale()) return
    botTurn(seat)
    if (game.over) break
    const r = resolveDiscard(seat)
    if (r === null) break                         // you're deciding on a claim, or someone won
    if (r[1] !== 'normal') {                      // a bot claimed the discard — let it register
      refresh()
      if (r[0] !== HUMAN) await coach('bot-call', TIPS.botCall(r[0]))   // first time only
      await sleep(CLAIM_PAUSE_MS)
      if (stale()) return
    }
    ;[seat, draw] = r
  }
  refresh()
}

// A bot with a full hand: win if it can, declare any kongs worth making, then discard.
function botTurn(seat: number) {
  const hand = game.hands[seat]
  if (canDeclareSelfDrawn(seat)) return win(seat)
  let kong: Tile | undefined
  while ((kong = kongOptions(game, seat).find(t => botWantsKong(game, seat, t, match.minFaan)))) {
    declareKong(game, seat, kong)
    announceCall(seat, 'kong', kongMeld(seat, kong))
    if (drawFor(seat, true) === null) return wallExhausted()
    if (canDeclareSelfDrawn(seat)) return win(seat)
  }
  const [tile] = hand.splice(botDiscard(game, seat, match.minFaan), 1)
  game.discards[seat].push(tile)
  pool.push(tile)
  lastDiscard = seat
  sfx.discard()
  refresh()
}

// Someone may claim seat `d`'s discard. Priority: win > pong/kong > chow (next seat only); tied wins go
// to whoever is next in turn order. Returns who plays next, or null if the hand ended or you must decide.
function resolveDiscard(d: number, humanPassed = false): [number, Draw] | null {
  const tile = game.discards[d][game.discards[d].length - 1]
  const order = [1, 2, 3].map(k => (d + k) % 4)
  const bots = order.filter(s => s !== HUMAN)
  const botWinner = bots.find(s => canDeclareOn(s, tile))
  const claims = bots.map(seat => ({ seat, claim: botClaim(game, seat, d, tile, match.minFaan) }))
  const botPong = claims.find(c => c.claim && c.claim.kind !== 'chow')
  const botChow = claims.find(c => c.claim?.kind === 'chow')

  if (d !== HUMAN && !humanPassed) {
    const hand = game.hands[HUMAN]
    const noBotWin = botWinner === undefined
    const o: Offer = {
      from: d, tile,
      win: canDeclareOn(HUMAN, tile) && (noBotWin || order.indexOf(HUMAN) < order.indexOf(botWinner)),
      pong: noBotWin && canPong(hand, tile),
      kong: noBotWin && canKong(hand, tile),
      chows: noBotWin && !botPong && nextSeat(d) === HUMAN ? chowOptions(hand, tile) : [],
    }
    if (o.win || o.pong || o.kong || o.chows.length) { offer = o; return null }
  }

  if (botWinner !== undefined) {
    game.hands[botWinner].push(game.discards[d].pop()!)
    pool.pop()
    lastDiscard = null
    win(botWinner, d)
    return null
  }
  const c = botPong ?? botChow
  if (c?.claim) {
    claimDiscard(game, c.seat, d, c.claim.kind, c.claim.run)
    pool.pop()
    lastDiscard = null
    announceCall(c.seat, c.claim.kind, lastMeld(c.seat))
    return [c.seat, c.claim.kind === 'kong' ? 'replacement' : 'none']
  }
  return [nextSeat(d), 'normal']
}

function humanClaim(kind: ClaimKind | 'win', run?: number[]) {
  if (!offer) return
  const { from } = offer
  offer = null
  lastDiscard = null
  pool.pop()                                          // the claimed tile leaves the middle
  if (kind === 'win') {
    game.hands[HUMAN].push(game.discards[from].pop()!)
    win(HUMAN, from)
    refresh()
  } else {
    claimDiscard(game, HUMAN, from, kind, run)
    announceCall(HUMAN, kind, lastMeld(HUMAN))
    void play(HUMAN, kind === 'kong' ? 'replacement' : 'none')
  }
}

function humanPass() {
  if (!offer) return
  const { from } = offer
  offer = null
  const r = resolveDiscard(from, true)
  if (r) void play(...r)
  else refresh()
}

function humanKong(tile: Tile) {
  if (game.over || !mustDiscard) return
  declareKong(game, HUMAN, tile)
  announceCall(HUMAN, 'kong', kongMeld(HUMAN, tile))
  mustDiscard = false
  void play(HUMAN, 'replacement')
}

function humanDiscard(tile: Tile) {
  if (game.over || !mustDiscard || offer) return
  const hand = game.hands[HUMAN]
  game.discards[HUMAN].push(hand.splice(hand.indexOf(tile), 1)[0])
  pool.push(tile)
  lastDiscard = HUMAN
  mustDiscard = false
  game.drawn = null
  sfx.discard()
  const r = resolveDiscard(HUMAN)
  if (r) void play(...r)
  else refresh()
}

function startMatch() {
  music.start()                                       // the Start click is the gesture browsers want before playing audio
  saveSettings()
  match = newMatch(settings)
  started = true
  nextHand()
}

// Deal the next hand of the match: roll the dice, deal the tiles out, reveal flowers, then the
// dealer draws first.
function nextHand() {
  gen++
  match.hand++
  game = deal(match.dealer, match.roundWind)
  offer = null; mustDiscard = false; winFrom = null; lastDiscard = null; pool = []
  banners = []; winTile = null; resultClosed = false; showFinal = false; celebrate = false
  inMenu = false
  void runIntro()
}

// ---------- The opening: dice, dealing, flowers ----------
// The dealing is all decided by deal(); this only stages how it's shown.

interface Intro {
  phase: 'dice' | 'deal' | 'flowers'
  dice: number[]
  rolling: boolean
  breakSide: number                    // whose wall is broken open
  shown: number[]                      // tiles each player has received so far
  flowersShown: boolean[]              // whose flowers have been revealed
}
let intro: Intro | null = null

const rollDie = () => 1 + Math.floor(Math.random() * 6)

async function runIntro() {
  const myGen = gen
  const dice = [rollDie(), rollDie()]
  const total = dice[0] + dice[1]
  // Real rule: count round the table from the dealer (dealer = 1) to find whose wall breaks, then
  // count `total` stacks in from the right end of that wall. Tiles are drawn from just left of the
  // break; kong replacements come from the other side of it.
  const breakSide = (game.dealer + total - 1) % 4
  wallBreak = 2 * (breakSide * 18 + 18 - total)       // 2 dice: total 2–12, so 6–16 stacks in from the left
  intro = { phase: 'dice', dice, rolling: true, breakSide, shown: [0, 0, 0, 0], flowersShown: [false, false, false, false] }
  const it = intro
  const stale = () => myGen !== gen
  // Every pause also waits while the game is paused (menu, pause box, a tip), and nothing is
  // drawn over the menu — otherwise the deal would carry on behind it and pull you back in.
  const wait = async (ms: number) => { await sleep(ms); await gameIdle() }

  // 1. the dice tumble, then settle
  refresh()
  sfx.dice()
  for (let i = 0; i < 12; i++) {
    await wait(90)
    if (stale()) return
    showDiceFaces([rollDie(), rollDie()])
  }
  it.rolling = false
  refresh()
  await coach('dice', TIPS.dice)
  await wait(1700)
  if (stale()) return

  // 2. deal: four tiles at a time to each player, three times round, then one more each
  it.phase = 'deal'
  const order = [0, 1, 2, 3].map(k => (game.dealer + k) % 4)
  for (const batch of [4, 4, 4, 1]) {
    for (const p of order) {
      it.shown[p] += batch
      flyTiles(it.breakSide, p, batch)
      sfx.deal()
      refresh()
      await wait(260)
      if (stale()) return
    }
  }

  // 3. flowers: each player with bonus tiles lays them out in turn and draws replacements
  it.phase = 'flowers'
  refresh()
  await coach('deal', TIPS.deal)
  await gameIdle()
  if (stale()) return
  for (const p of order) {
    if (!game.bonus[p].length) continue
    it.flowersShown[p] = true
    announceFlowers(p, game.bonus[p])
    refresh()
    await coach('flowers', TIPS.flowers)
    await wait(1100)
    if (stale()) return
  }

  intro = null
  void play(game.dealer, 'normal')
}

const PIPS: Record<number, number[]> = {           // which cells of a 3×3 grid have a pip
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}
// A die face. Like Chinese dice, the 1 and the 4 have red pips.
function dieFace(v: number, die: HTMLElement) {
  die.innerHTML = ''
  for (let c = 0; c < 9; c++) die.appendChild(el('span', PIPS[v].includes(c) ? 'pip' + (v === 1 || v === 4 ? ' red' : '') + (v === 1 ? ' big' : '') : ''))
}
// While rolling, flick the faces directly rather than re-rendering the whole table.
function showDiceFaces(values: number[]) {
  document.querySelectorAll<HTMLElement>('.table-dice .face.top').forEach((d, i) => dieFace(values[i], d))
}

const diceTotal = (it: Intro) => it.dice.reduce((a, b) => a + b, 0)

// Two dice in the middle of the felt: real 3D cubes that tumble while rolling, then lie
// showing the result with the total printed beneath. They stay put until play starts.
// The landing animation plays only on the render where they land — the table is redrawn after
// every batch dealt, and replaying it each time made the dice blink.
function tableDice(it: Intro): HTMLElement {
  const state = it.rolling ? ' rolling' : it.phase === 'dice' ? ' landing' : ''
  const wrap = el('div', 'table-dice' + state)
  const row = el('div', 'dice-row')
  for (const v of it.dice) {
    const d = box('die', 1.5, 1.5, 1.5)
    dieFace(v, d.querySelector<HTMLElement>('.face.top')!)
    row.appendChild(d)
  }
  wrap.appendChild(row)
  if (!it.rolling) wrap.appendChild(el('div', 'dice-total', String(diceTotal(it))))
  return wrap
}

// Small face-down tiles sliding from the broken wall to a player's rack.
// Positions are fractions of the table's on-screen box (your rack is just below the table).
const WALL_SPOT: [number, number][] = [[0.5, 0.7], [0.72, 0.5], [0.5, 0.28], [0.28, 0.5]]
const RACK_SPOT: [number, number][] = [[0.5, 1.12], [0.96, 0.5], [0.5, 0.04], [0.04, 0.5]]
function flyTiles(fromSide: number, to: number, n: number) {
  const scene = document.querySelector('.scene')
  if (!scene) return
  const r = scene.getBoundingClientRect()
  const at = ([fx, fy]: [number, number]) => [r.left + r.width * fx, r.top + r.height * fy]
  const [x0, y0] = at(WALL_SPOT[fromSide]), [x1, y1] = at(RACK_SPOT[to])
  for (let i = 0; i < n; i++) {
    const t = el('div', 'flying-tile')
    const off = (i - (n - 1) / 2) * 16
    t.style.left = `${x0}px`
    t.style.top = `${y0}px`
    document.body.appendChild(t)
    t.animate(
      [{ transform: `translate(calc(-50% + ${off}px), -50%) scale(0.9)`, opacity: 0.95 },
       { transform: `translate(calc(-50% + ${x1 - x0 + off}px), calc(-50% + ${y1 - y0}px)) scale(1.1)`, opacity: 0.9 }],
      { duration: 380, delay: i * 25, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)', fill: 'forwards' },
    ).onfinish = () => t.remove()
  }
}

function showStandings() {
  showFinal = true
  resultClosed = false
  celebrate = standings()[0] === HUMAN
  render()
}

// Players ordered by score, best first.
const standings = () => [0, 1, 2, 3].sort((a, b) => match.scores[b] - match.scores[a])

// ---------- Beginner tips (coachmarks) ----------
// The first time each situation comes up, the game pauses, dims the screen around the part that
// matters, and explains it in a small card. Each tip shows once (remembered across visits); the
// "Learn to play" menu entry resets them for a fully guided game.

interface CoachStep { target?: string; title: string; body: (string | Node)[] }
type Steps = CoachStep[] | (() => CoachStep[])
const TIPS_SEEN_KEY = 'mahjong-tips-seen'
let tipsSeen = new Set<string>((() => {
  try { return JSON.parse(localStorage.getItem(TIPS_SEEN_KEY) ?? '[]') as string[] } catch { return [] }
})())
function saveTipsSeen() {
  try { localStorage.setItem(TIPS_SEEN_KEY, JSON.stringify([...tipsSeen])) } catch { /* storage unavailable — keep it in memory */ }
}
let coachOpen: Promise<void> | null = null          // a tip is showing; the bots wait for it

// Resolves once no tip is showing.
async function coachIdle() { while (coachOpen) await coachOpen }

// ---------- Pausing ----------
// The game stands still while you're away from the table: in the menu, in the pause box, or
// reading a tip. Bot turns and the opening deal wait at gameIdle() until you're back.
let paused = false                                     // the pause box is open
let resumeWaiters: (() => void)[] = []
const awayFromTable = () => inMenu || paused
// Resolves on the next render of the table (i.e. when you come back to it).
const nextRender = () => new Promise<void>(resolve => resumeWaiters.push(resolve))
async function gameIdle() {
  while (coachOpen || awayFromTable()) {
    if (coachOpen) await coachIdle()
    else await nextRender()
  }
}
function wakeWaiters() {
  const waiting = resumeWaiters
  resumeWaiters = []
  for (const w of waiting) w()
}

// A small dialog over everything; resolves with the value of the button pressed.
// Esc picks the first ("stay") option.
function dialog<T>(title: string, text: string, options: { label: string; value: T; cls: string }[]): Promise<T> {
  return new Promise(resolve => {
    const layer = el('div', 'coach-layer dim dialog-layer')
    const card = el('div', 'dialog-card')
    const actions = el('div', 'dialog-actions')
    const close = (v: T) => { document.removeEventListener('keydown', onKey); layer.remove(); resolve(v) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(options[0].value) } }
    for (const o of options) actions.appendChild(button(o.label, () => close(o.value), 'act ' + o.cls))
    card.append(el('div', 'dialog-title', title), el('p', 'dialog-text', text), actions)
    layer.appendChild(card)
    document.body.appendChild(layer)
    document.addEventListener('keydown', onKey)
    actions.querySelector<HTMLElement>('button')?.focus()
  })
}

const gameInProgress = () => started && !match.over

// The Menu button (or Esc) in a game: pause, then keep playing, go to the menu, or quit.
async function openPause() {
  if (paused || coachOpen) return
  paused = true
  music.duck(true)
  const where = `${SEATS[match.roundWind]} round · Hand ${match.hand} · Your score ${signed(match.scores[HUMAN])}`
  const choice = await dialog('Game paused', where, [
    { label: 'Keep playing', value: 'play', cls: 'primary' },
    { label: 'Main menu', value: 'menu', cls: '' },
    { label: 'Quit this game', value: 'quit', cls: 'danger' },
  ])
  if (choice === 'quit' && !(await confirmQuit())) return void resumeFromPause()
  paused = false
  if (choice === 'play') return void resumeFromPause()
  if (choice === 'quit') endMatchEarly()
  renderMenu()                                         // the game stays paused there until you continue
}
function resumeFromPause() { paused = false; render() }

function confirmQuit(): Promise<boolean> {
  return dialog('Quit this game?', 'Your game and its scores will be lost. This can’t be undone.', [
    { label: 'No, keep it', value: false, cls: 'primary' },
    { label: 'Yes, quit', value: true, cls: 'danger' },
  ])
}

// Before starting a new game: if one is under way, check first that it's OK to end it.
async function okToEndCurrentGame(): Promise<boolean> {
  if (!gameInProgress()) return true
  return dialog('Start a new game?', 'Your current game and its scores will end.', [
    { label: 'No, go back', value: false, cls: '' },
    { label: 'Yes, start new', value: true, cls: 'primary' },
  ])
}

// Start a new game — asking first if that would end one already under way.
async function startNewIfOk(start: () => void) {
  if (!(await okToEndCurrentGame())) return
  if (gameInProgress()) endMatchEarly()
  start()
}

function endMatchEarly() {
  gen++                                                // stops the paused bot loop / deal for good
  started = false
  offer = null
  mustDiscard = false
  intro = null
  wakeWaiters()
  document.querySelectorAll('.banner, .flying-tile').forEach(e => e.remove())
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !inMenu && !paused && !coachOpen && started) { e.preventDefault(); void openPause() }
})

// Browsers only allow sound after a click or key press — start the music on the very first one,
// so it plays from the main menu onwards.
const startMusicOnce = () => {
  music.start()
  document.removeEventListener('pointerdown', startMusicOnce)
  document.removeEventListener('keydown', startMusicOnce)
}
document.addEventListener('pointerdown', startMusicOnce)
document.addEventListener('keydown', startMusicOnce)

// Show a tip (one or more steps) unless tips are off or it's been seen before.
async function coach(id: string, steps: Steps): Promise<void> {
  if (!settings.tips || tipsSeen.has(id) || inMenu || coachOpen) return
  tipsSeen.add(id)
  saveTipsSeen()
  const list = typeof steps === 'function' ? steps() : steps
  music.duck(true)
  coachOpen = (async () => {
    for (let i = 0; i < list.length; i++) {
      if (await showCoachStep(list[i], i, list.length) === 'off') {
        settings = { ...settings, tips: false }
        saveSettings()
        break
      }
    }
  })()
  await coachOpen
  coachOpen = null
  music.duck(game.over && !resultClosed)            // back to normal, unless the result card is up
}

// One step: dim everything, ring the target, and place the card beside it.
function showCoachStep(step: CoachStep, i: number, n: number): Promise<'next' | 'off'> {
  return new Promise(resolve => {
    const layer = el('div', 'coach-layer')            // also blocks clicks on the game
    const card = el('div', 'coach-card')
    const body = el('div', 'coach-body')
    for (const part of step.body) body.appendChild(typeof part === 'string' ? para(part) : part)
    const foot = el('div', 'coach-foot')
    const finish = (v: 'next' | 'off') => { layer.remove(); resolve(v) }
    foot.append(
      button('Turn off tips', () => finish('off'), 'coach-off'),
      el('span', 'coach-count', n > 1 ? `${i + 1} of ${n}` : ''),
      button(i < n - 1 ? 'Next ›' : 'Got it', () => finish('next'), 'act primary coach-next'),
    )
    card.append(el('div', 'coach-title', step.title), body, foot)
    const spot = el('div', 'coach-spot')
    if (step.target) layer.appendChild(spot)
    layer.appendChild(card)
    document.body.appendChild(layer)

    // Ring the target and place the card below it if it fits, else above, else mid-screen.
    // Re-measured every frame while open, so the ring follows the target if anything shifts
    // (a re-render, a late-loading font) instead of pointing at an empty spot.
    const place = () => {
      const target = step.target ? document.querySelector<HTMLElement>(step.target) : null
      layer.classList.toggle('dim', !target)
      spot.hidden = !target
      const w = card.offsetWidth, h = card.offsetHeight, gap = 18, pad = 8
      let left = (window.innerWidth - w) / 2, top = (window.innerHeight - h) / 2
      if (target) {
        const r = target.getBoundingClientRect()
        Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` })
        left = Math.min(Math.max(r.left + r.width / 2 - w / 2, 12), window.innerWidth - w - 12)
        if (r.bottom + gap + h < window.innerHeight - 8) top = r.bottom + gap
        else if (r.top - gap - h > 8) top = r.top - gap - h
      }
      Object.assign(card.style, { left: `${left}px`, top: `${top}px` })
    }
    const follow = () => { if (!layer.isConnected) return; place(); requestAnimationFrame(follow) }
    place()
    requestAnimationFrame(follow)
    card.querySelector<HTMLElement>('.coach-next')?.focus({ preventScroll: true })
  })
}

// Look at what's on screen now and explain it if it's new to the player.
async function coachForState() {
  if (!settings.tips || coachOpen || inMenu) return
  if (game.over && !resultClosed && !showFinal) return coach('result', TIPS.result)
  if (offer) return coach('claim', TIPS.claim)
  if (mustDiscard) return coach('first-turn', TIPS.firstTurn)
  if (document.querySelector('.hm-ready')) return coach('ready', TIPS.ready)
}

// A quick game with every tip shown again from the start.
function startGuidedGame() {
  tipsSeen = new Set()
  saveTipsSeen()
  settings = { ...settings, tips: true, rounds: 1 }
  startMatch()
}

const TIPS = {
  dice: (): CoachStep[] => [{
    target: '.table-dice', title: 'Rolling the dice',
    body: ['Every hand starts with the dealer rolling two dice. The total decides where the wall is opened.', 'You don’t need to do anything — just watch.'],
  }],
  deal: (): CoachStep[] => [{
    target: '.player-rack', title: 'Your 13 tiles',
    body: ['Everyone is dealt 13 tiles, four at a time. Yours are here at the bottom — the other players’ tiles stand face-down on their racks.'],
  }],
  flowers: (): CoachStep[] => [{
    title: 'Flowers & seasons',
    body: ['These are bonus tiles. They’re put aside face-up and replaced with a new tile automatically.',
      'A flower or season showing your seat number (East 1, South 2…) scores +1 faan.'],
  }],
  firstTurn: (): CoachStep[] => {
    const example = el('div', 'example-hand')
    for (const spec of ['123m', '555p', '111z', '789s', '66z']) example.appendChild(exampleTiles(spec))
    return [
      { title: 'How to win', body: [para('Make ', el('strong', '', '4 sets and 1 pair'), ' — 14 tiles, like this:'), example,
          'A set is three the same (a Pong) or three in a row of one suit (a Chi).'] },
      { target: '.player-rack', title: 'Your turn',
        body: ['You just drew a tile — it’s set apart on the right. Now you have one tile too many.', 'Tap the tile you need least to throw it away.'] },
      { target: '.hm-total', title: 'Your hand’s score',
        body: ['This shows the faan (points) your hand already has.', 'Hover over it — or tap it — to see what you have and what to aim for next.'] },
      { target: '.status-pill', title: 'What’s happening',
        body: ['This tells you whose turn it is. It glows gold whenever it’s your move.'] },
      { target: '.rules-chip', title: 'Need help?',
        body: ['The Rules button opens the guide — every set and every scoring pattern, with pictures.'] },
    ]
  },
  claim: (): CoachStep[] => [{
    target: '.claim-card', title: 'You can take this tile',
    body: ['Someone threw away a tile you can use:',
      para(el('strong', '', 'Pong'), ' — make three the same.  ', el('strong', '', 'Chi'), ' — make three in a row (only from Lin, on your left).'),
      para(el('strong', '', 'Mahjong!'), ' — the tile finishes your hand: you win.'),
      'Taking a tile lays that set face-up, and you lose the Concealed hand bonus. Not sure? Press Pass.'],
  }],
  botCall: (seat: number) => (): CoachStep[] => [{
    title: `${NAMES[seat]} called!`,
    body: [`${NAMES[seat]} took the tile that was just thrown away, to make a set. They lay it face-up on the table, then throw away a tile of their own.`,
      'Play carries on from them — so a turn can be skipped.'],
  }],
  ready: (): CoachStep[] => [{
    target: '.hm-ready', title: 'One tile from winning!',
    body: ['Any of these tiles would finish your hand. If someone throws one away, a Mahjong! button appears.',
      'Draw it from the wall yourself and you score +1 faan more.'],
  }],
  result: (): CoachStep[] => [{
    target: '.result-cols', title: 'How the hand scored',
    body: ['The winner scores faan for the patterns in their hand — more faan, more points.',
      'Whoever threw the winning tile pays. If the winner drew it themselves, all three others pay.'],
  }],
}

// ---------- Rendering ----------

function el(tag: string, cls = '', text = ''): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}
// A flat tile, for your rack and inline in text/buttons.
function tileEl(tile: Tile, cls = '', onClick?: () => void): HTMLElement {
  const e = el('div', 'tile ' + cls)
  e.innerHTML = tileSVG(tile.category, tile.value)
  e.title = tileName(tile.category, tile.value)
  if (onClick) { e.classList.add('clickable'); e.onclick = onClick }
  return e
}
// Line icons for the top-bar chips (they take the chip's text colour).
const svgIcon = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const ICONS = {
  menu: svgIcon('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  book: svgIcon('<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/>'),
  soundOn: svgIcon('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  soundOff: svgIcon('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 10l5 5M21 10l-5 5"/>'),
  musicOn: svgIcon('<path d="M9 17.5V5.5l10-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>'),
  musicOff: svgIcon('<path d="M9 17.5V5.5l10-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/><path d="M3 3l18 18"/>'),
}

// The two sound buttons: music, and sound effects (tile clacks, calls). `redraw` repaints the screen they're on.
function soundButtons(redraw: () => void): HTMLElement[] {
  const m = chip(music.isOn() ? ICONS.musicOn : ICONS.musicOff, null, () => { music.toggle(); redraw() }, 'icon-only' + (music.isOn() ? '' : ' off'))
  m.title = music.isOn() ? 'Music is on — tap to turn off' : 'Music is off — tap to turn on'
  const s = chip(isMuted() ? ICONS.soundOff : ICONS.soundOn, null, () => { setMuted(!isMuted()); redraw() }, 'icon-only' + (isMuted() ? ' off' : ''))
  s.title = isMuted() ? 'Sound effects are off — tap to turn on' : 'Sound effects are on — tap to turn off'
  for (const b of [m, s]) b.setAttribute('aria-label', b.title)
  return [m, s]
}

// A top-bar pill: a round icon badge, then an optional label. With no onClick it's a plain info chip.
function chip(icon: string, label: string | null, onClick: (() => void) | null, cls = ''): HTMLElement {
  const c = el(onClick ? 'button' : 'div', 'chip ' + cls)
  const badge = el('span', 'chip-icon')
  badge.innerHTML = icon
  c.appendChild(badge)
  if (label) c.appendChild(el('span', 'chip-label', label))
  if (onClick) c.onclick = onClick
  return c
}

// A small inline tile for status text and buttons.
const mini = (t: Tile) => tileEl(t, 'mini')
function button(label: string, onClick: () => void, cls = '', tiles: Tile[] = []): HTMLElement {
  const b = el('button', cls, label)
  for (const t of tiles) b.appendChild(mini(t))
  b.onclick = onClick
  return b
}

// A tile-shaped 3D box on the table: footprint w×d and height h, in table units (--u).
// kind: 'up' = lying face-up (top shows `face`), 'down2'/'down1' = wall stack two/one tile high,
// 'stand' = a row of concealed tiles standing on edge. The CSS colours each face to match.
function box(kind: string, w: number, d: number, h: number, cls = '', face?: Tile): HTMLElement {
  const b = el('div', `box ${kind} ${cls}`)
  b.style.setProperty('--bw', String(w))
  b.style.setProperty('--bd', String(d))
  b.style.setProperty('--bh', String(h))
  for (const side of ['front', 'back', 'left', 'right']) b.appendChild(el('div', 'face ' + side))
  const top = el('div', 'face top')
  if (face) { top.innerHTML = tileSVG(face.category, face.value); b.title = tileName(face.category, face.value) }
  b.appendChild(top)
  return b
}
const lyingTile = (t: Tile, cls = '') => box('up', 1.15, 1.54, 0.8, cls, t)

const app = document.querySelector<HTMLDivElement>('#app')!

function refresh() {
  if (inMenu) return
  render()
  void coachForState()                                // first time in a new situation? explain it
}

// A big menu card: round icon badge, title, a one-line explanation, and an optional tag.
function menuCard(icon: string, title: string, sub: string, onClick: (() => void) | null, cls = '', tag = ''): HTMLElement {
  const b = el('button', 'menu-card ' + cls) as HTMLButtonElement
  const badge = el('span', 'mc-icon')
  badge.innerHTML = icon
  const text = el('span', 'mc-text')
  text.append(el('span', 'mc-title', title), el('span', 'mc-sub', sub))
  b.append(badge, text)
  if (tag) b.appendChild(el('span', 'mc-tag', tag))
  if (onClick) b.onclick = onClick
  else b.disabled = true
  return b
}

const MENU_ICONS = {
  play: svgIcon('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>'),
  resume: svgIcon('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><path d="M10.5 9v6l4.5-3z" fill="currentColor"/>'),
  learn: svgIcon('<path d="M2.5 9.5 12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5V16c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2v-4.5"/><path d="M21.5 9.5V15"/>'),
  book: ICONS.book,
  online: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'),
}

// The title area: a fan of tiles over the name, with 麻雀 (the game's Cantonese name) beneath.
function menuHero(): HTMLElement {
  const hero = el('div', 'menu-hero')
  const fan = el('div', 'tile-fan')
  for (const spec of ['1p', '5z', '6z', '1s', '1z']) fan.appendChild(tileEl(parse(spec)[0], 'fan-tile'))
  hero.append(fan, el('h1', 'menu-title', 'Mahjong'), el('div', 'menu-cn', '麻雀'),
    el('p', 'menu-tagline', 'Hong Kong style · play against three computer players'))
  return hero
}

function renderMenu() {
  inMenu = true
  app.innerHTML = ''
  const page = el('div', 'menu-page')
  const sound = el('div', 'menu-sound')
  sound.append(...soundButtons(renderMenu))

  const cards = el('div', 'menu-cards')
  if (started && !match.over) {
    cards.appendChild(menuCard(MENU_ICONS.resume, 'Continue game',
      `${SEATS[match.roundWind]} round · Hand ${match.hand} · Your score ${signed(match.scores[HUMAN])}`, render, 'primary'))
  }
  const fresh = !(started && !match.over)
  cards.append(
    menuCard(MENU_ICONS.play, 'New game', 'Choose your house rules, then play', renderSetup, fresh ? 'primary' : ''),
    menuCard(MENU_ICONS.learn, 'Learn to play', 'A guided game — friendly tips explain every step', () => void startNewIfOk(startGuidedGame), 'learn',
      tipsSeen.size === 0 ? 'New to mahjong? Start here' : ''),
    menuCard(MENU_ICONS.book, 'How to play', 'The rules, the sets and how scoring works — with pictures', renderRulesPage),
    menuCard(MENU_ICONS.online, 'Play online', 'Play with friends and family', null, 'soon', 'Coming soon'),
  )
  page.append(sound, menuHero(), cards)
  app.appendChild(page)
}

// The full rules guide as its own page, opened from the menu.
function renderRulesPage() {
  inMenu = true
  app.innerHTML = ''
  const page = el('div', 'rules-page')
  const head = el('div', 'rules-head')
  head.append(button('‹ Back', renderMenu, 'act'), el('h1', '', 'How to play'))
  const intro = el('section', 'rules-intro')
  intro.append(
    para('Mahjong is played by four players with 144 tiles. You sit at the bottom of the table; play goes round counter-clockwise — you, then Mei, Kai and Lin.'),
    para('On your turn you take a tile from the wall, then throw one away. The first to complete a winning hand calls ', el('strong', '', 'Mahjong!')),
  )
  const body = el('div', 'rules-body help')
  body.append(intro, ...rulesSections(false))
  const foot = el('div', 'rules-foot')
  foot.append(button('Try it — Learn to play', () => void startNewIfOk(startGuidedGame), 'act primary big'), button('Back to menu', renderMenu, 'act'))
  const credit = el('p', 'credit', 'Music: “Chinese Harmony” by LunarBoomMusic, from Pixabay.')
  page.append(head, body, foot, credit)
  app.appendChild(page)
  window.scrollTo(0, 0)
}

// A row of big choice buttons; the chosen one is lit. `onPick` gets the chosen value.
function choiceRow<T>(options: { value: T; label: string; sub: string }[], current: T, onPick: (v: T) => void): HTMLElement {
  const row = el('div', 'choice-row')
  for (const o of options) {
    const b = el('button', 'choice' + (o.value === current ? ' picked' : ''))
    b.append(el('span', 'choice-label', o.label), el('span', 'choice-sub', o.sub))
    b.onclick = () => onPick(o.value)
    row.appendChild(b)
  }
  return row
}

// Before a game: agree the minimum faan to win and how long to play, like at a real table.
function renderSetup() {
  inMenu = true
  app.innerHTML = ''
  const card = el('div', 'setup')
  card.append(el('h1', 'setup-title', 'New game'), el('p', 'setup-intro', 'Agree the house rules before you start — just like at a real table.'))

  const pick = (change: Partial<Settings>) => { settings = { ...settings, ...change }; renderSetup() }

  card.append(el('h2', 'setup-q', 'Minimum to win'),
    el('p', 'setup-help', 'A finished hand must score at least this many faan before you can call Mahjong. Higher makes winning harder but each win worth more.'),
    choiceRow([
      { value: 0, label: 'Any hand', sub: '0 faan — every finished hand wins' },
      { value: 1, label: '1 faan', sub: 'Good for learning' },
      { value: 3, label: '3 faan', sub: 'Hong Kong standard' },
    ], settings.minFaan, v => pick({ minFaan: v })))

  card.append(el('h2', 'setup-q', 'How long to play'),
    choiceRow([
      { value: 1, label: 'Quick game', sub: 'One round · at least 4 hands' },
      { value: 4, label: 'Full game', sub: 'All four wind rounds · 16+ hands' },
    ], settings.rounds, v => pick({ rounds: v })))

  card.append(el('h2', 'setup-q', 'Beginner tips'),
    choiceRow([
      { value: true, label: 'On', sub: 'Short pop-ups explain each new step' },
      { value: false, label: 'Off', sub: 'I know how to play' },
    ], settings.tips, v => pick({ tips: v })))

  card.append(el('p', 'setup-help', 'Everyone starts at 0 points. Winners collect points from whoever pays; the highest score at the end wins the game.'))
  const actions = el('div', 'setup-actions')
  actions.append(button('‹ Back', renderMenu, 'act'), button('Start game', () => void startNewIfOk(startMatch), 'act primary big'))
  card.appendChild(actions)
  app.appendChild(card)
}

// One sentence describing how the hand ended.
function resultLine(): string {
  if (game.winner === null) return 'The wall ran out — nobody won this hand.'
  const who = game.winner === HUMAN ? 'You win' : `${NAMES[game.winner]} wins`
  const how = winFrom === null ? 'by drawing the winning tile' : `with ${possessive(winFrom)} thrown-away tile`
  return `${who} ${how}!`
}

// The status pill in the top bar: a badge for whose move it is (their seat wind), a bold headline
// and a short hint underneath. It glows gold when you need to act.
function statusEl(): HTMLElement {
  const windChar = (p: number) => WIND_CHARS[seatWind(game, p)]
  let mood = 'wait', badge = windChar(game.current), hint = ''
  const title = el('div', 'status-title')
  if (game.winner === HUMAN) {
    mood = 'win'; badge = '🏆'; title.textContent = 'You win!'; hint = 'Mahjong!'
  } else if (game.winner !== null) {
    mood = 'done'; badge = windChar(game.winner); title.textContent = `${NAMES[game.winner]} wins`
    hint = winFrom === null ? 'Drew the winning tile' : `On ${possessive(winFrom)} thrown-away tile`
  } else if (game.over) {
    mood = 'done'; badge = '–'; title.textContent = 'Draw'; hint = 'The wall ran out'
  } else if (offer) {
    mood = 'mine'; badge = windChar(offer.from)
    title.append(`${NAMES[offer.from]} threw away`, mini(offer.tile))
    hint = 'Take it, or pass'
  } else if (mustDiscard) {
    mood = 'mine'; badge = windChar(HUMAN); title.textContent = 'Your turn'; hint = 'Tap a tile to throw it away'
  } else if (intro) {
    badge = windChar(game.dealer)
    const roller = game.dealer === HUMAN ? 'You' : NAMES[game.dealer]
    const breaker = intro.breakSide === HUMAN ? 'you' : NAMES[intro.breakSide]
    if (intro.phase === 'dice' && intro.rolling) { title.textContent = `${roller} ${game.dealer === HUMAN ? 'roll' : 'rolls'} the dice…`; hint = 'Get ready…' }
    else if (intro.phase === 'dice') { title.textContent = `${roller} rolled ${diceTotal(intro)}`; hint = `The wall is opened in front of ${breaker}` }
    else if (intro.phase === 'deal') { title.textContent = 'Dealing the tiles'; hint = 'Four at a time, then one more each' }
    else { title.textContent = 'Flowers and seasons'; hint = 'Bonus tiles are put aside and replaced' }
  } else {
    title.textContent = `${NAMES[game.current]} is playing…`; hint = 'Please wait'
  }
  const s = el('div', 'status ' + mood)
  const pill = el('div', 'status-pill')
  const text = el('div', 'status-text')
  text.append(title, el('div', 'status-hint', hint))
  pill.append(el('div', 'status-badge', badge), text)
  s.appendChild(pill)
  return s
}

// The wall is a ring of 144 slots (72 stacks of 2, 18 stacks per side). The remaining tiles are the
// contiguous run [wallFront, wallFront + wall.length) of the original array, rotated by the break point.
function wallRow(side: number): HTMLElement {
  const row = el('div', 'wall')
  let from = game.wallFront, to = game.wallFront + game.wall.length
  if (intro && intro.phase !== 'flowers') {           // mid-deal: tiles not yet handed out are still in the wall
    from = 0
    to += 52 - intro.shown.reduce((a, b) => a + b, 0)
  }
  const present = (slot: number) => { const i = (slot - wallBreak + 144) % 144; return i >= from && i < to }
  for (let j = 0; j < 18; j++) {
    const k = side * 18 + j
    const height = Number(present(2 * k)) + Number(present(2 * k + 1))
    if (height === 2) row.appendChild(box('down2', 1, 1.34, 1.1))
    else if (height === 1) row.appendChild(box('down1', 1, 1.34, 0.55))
    else row.appendChild(el('div', 'stack-gap'))
  }
  return row
}

// How many of a player's tiles to show: during the deal, only those handed out so far.
const handCount = (seat: number) =>
  intro && intro.phase !== 'flowers' ? Math.min(intro.shown[seat], game.hands[seat].length) : game.hands[seat].length
// Flowers stay hidden during the opening until that player's turn to reveal them.
const flowersVisible = (seat: number) => !intro || intro.flowersShown[seat]

// One side of the table, laid out as if it were the bottom edge, then rotated into place.
// Edge → centre: rack (hand, exposed melds, bonus tiles), then the wall; the player's name, score
// and seat wind are printed on the felt just inside it.
function sideLayer(seat: number): HTMLElement {
  const layer = el('div', 'layer')
  layer.style.transform = `rotate(${-90 * seat}deg)`   // seats go counter-clockwise: right, top, left

  // Lights up on that player's turn.
  let labelCls = 'wind-label'
  if (seat === game.winner) labelCls += ' winner'
  else if (!game.over && seat === game.current) labelCls += ' active'
  const label = el('div', labelCls)
  const w = seatWind(game, seat)
  label.append(
    el('div', 'wl-name', `${NAMES[seat]} · ${signed(match.scores[seat])}`),
    el('div', 'wl-wind', `${SEATS[w]} ${WIND_CHARS[w]}${seat === game.dealer ? ' · Dealer' : ''}`),
  )
  if (seat !== HUMAN) label.style.transform = 'rotate(180deg)'   // read from the middle of the table, like a real cloth
  layer.appendChild(label)

  const rack = el('div', 'rack-row' + (seat === game.winner ? ' winner' : ''))
  if (seat !== HUMAN) {                                // your own hand is on the big rack below the table
    const hand = sortHand(game.hands[seat])
    if (game.over) {                                   // at the end of the hand it's laid down face-up
      const g = el('div', 'group')
      for (const t of hand) g.appendChild(lyingTile(t))
      rack.appendChild(g)
    } else {                                           // otherwise it stands on edge, backs toward the table
      const n = handCount(seat)
      if (n > 0) rack.appendChild(box('stand', 1.15 * n, 0.8, 1.54))
    }
  }
  for (const meld of game.melds[seat]) {
    const g = el('div', 'group')
    for (const t of meld) g.appendChild(lyingTile(t))
    rack.appendChild(g)
  }
  if (game.bonus[seat].length && flowersVisible(seat)) {
    const g = el('div', 'group')
    for (const t of game.bonus[seat]) g.appendChild(lyingTile(t, 'bonus'))
    rack.appendChild(g)
  }

  layer.append(rack, wallRow(seat))
  return layer
}

// All discards, pooled in the middle of the table in the order they were thrown, facing you.
function discardPool(): HTMLElement {
  const p = el('div', 'pool')
  pool.forEach((t, i) => p.appendChild(box('up', 1.02, 1.37, 0.7, lastDiscard !== null && i === pool.length - 1 ? 'latest' : '', t)))
  return p
}

// The button that moves the match on once a hand is over.
const continueButton = () => (match.over
  ? button('Final results', showStandings, 'act primary')
  : button('Next hand', nextHand, 'act primary'))

// Why each pattern you already hold scores — in plain words for the hover card.
const HAVE_WHY: [string, string][] = [
  ['Concealed hand', 'You haven’t taken anyone’s tile. Avoid Pong / Chi to keep it.'],
  ['No flowers', 'You have no flower or season tiles.'],
  ['Own flower', 'A flower or season showing your seat number.'],
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
const headlinePlan = (plans: Plan[]) => plans.find(p => p.items.length > 0) ?? plans[0]

// One line naming a plan: "Mixed one suit", "Dragon pong + self-drawn", ...
function planSummary(p: Plan): string {
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
function plansSection(plans: Plan[], total: number): HTMLElement {
  const s = el('div', 'hm-plans')
  s.appendChild(el('h4', '', `How to reach ${match.minFaan} faan`))
  s.appendChild(el('p', 'hm-plans-intro', `You have ${total}. This game needs ${match.minFaan} to win — here’s how your tiles could get there:`))
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

function faanCard(have: HaveItem[], close: CloseTo[], total: number, plans: Plan[]): HTMLElement {
  const card = el('div', 'hm-card')
  card.appendChild(el('div', 'hm-card-title', `Your hand: ${total} faan so far`))
  if (total < match.minFaan) card.appendChild(plansSection(plans, total))

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

  card.appendChild(el('div', 'hm-card-foot', `This game needs at least ${match.minFaan} faan to win. Faan count once your hand is finished (4 sets + 1 pair).`))
  return card
}

// The live "Your hand" meter: faan you've already secured (vs. the minimum to win), patterns
// you're close to, and — when one tile from winning — which tiles win and what each would score.
function handMeter(): HTMLElement {
  const hand = game.hands[HUMAN], melds = game.melds[HUMAN]
  const input = { concealed: hand, melds, bonus: game.bonus[HUMAN], seatWind: seatWind(game, HUMAN), roundWind: game.roundWind }
  const { have, close } = handProgress(input)
  const total = have.reduce((n, i) => n + i.faan, 0)
  const enough = total >= match.minFaan
  const { plans } = planToMinimum(input, match.minFaan)
  const m = el('div', 'hand-meter')

  // the score pill; hover (or tap, on touch screens) opens the "what you have / go for next" card
  const wrap = el('div', 'hm-total-wrap' + (faanCardOpen ? ' open' : ''))
  const head = el('button', 'hm-total' + (enough ? ' ok' : ''))
  head.append(el('span', 'hm-label', 'Your hand'), el('span', 'hm-faan', `${total} faan`),
    el('span', 'hm-need', enough ? `✓ minimum ${match.minFaan} reached` : `${match.minFaan - total} more to reach minimum ${match.minFaan}`),
    el('span', 'hm-more', 'ⓘ'))
  head.setAttribute('aria-label', 'Your hand score — show details')
  head.onclick = () => { faanCardOpen = !faanCardOpen; render() }
  wrap.append(head, faanCard(have, close, total, plans))
  m.appendChild(wrap)

  // short of the minimum: point straight at the easiest way to reach it (details in the card)
  if (!enough && plans.length) {
    const way = el('button', 'hm-way')
    way.append(el('span', 'hm-way-label', `Way to ${match.minFaan} faan:`), el('span', '', planSummary(headlinePlan(plans))))
    way.title = 'See every way your hand could reach the minimum'
    way.onclick = () => { faanCardOpen = !faanCardOpen; render() }
    m.appendChild(way)
  }

  const chips = el('div', 'hm-chips')
  for (const item of have) {
    const c = el('span', 'hm-chip have', item.name)
    if (item.tile) c.appendChild(mini(item.tile))
    c.appendChild(el('b', '', `+${item.faan}`))
    chips.appendChild(c)
  }
  for (const c of close.slice(0, enough ? 2 : 1)) {    // the best one or two; the card lists them all
    const chip = el('span', 'hm-chip close', `Close: ${c.name}`)
    chip.append(el('b', '', `+${c.faan}`), el('small', '', `${c.off} tile${c.off > 1 ? 's' : ''} off`))
    chip.title = `Change ${c.off} more tile${c.off > 1 ? 's' : ''} to get ${c.name} (+${c.faan} faan)`
    chips.appendChild(chip)
  }
  m.appendChild(chips)

  // between turns, with one tile to go: show each winning tile and what it would score
  if (!mustDiscard) {
    const wins = winningTiles(hand, melds.length)
    if (wins.length) {
      const ready = el('div', 'hm-ready')
      ready.appendChild(el('span', 'hm-ready-label', 'Ready! Win with'))
      for (const t of wins) {
        const f = faanOf(HUMAN, [...hand, t], false)
        const w = el('span', 'hm-win' + (f >= match.minFaan ? '' : ' short'))
        w.append(mini(t), el('span', '', `${f} faan`))
        w.title = f >= match.minFaan ? `Winning on ${tileName(t.category, t.value)} scores ${f} faan (more if you draw it yourself)`
          : `${tileName(t.category, t.value)} would complete your hand but only scores ${f} faan — not enough to win`
        ready.appendChild(w)
      }
      m.appendChild(ready)
    }
  }
  return m
}

// Buttons under the table: kongs on your turn; moving on once the hand is over. While a hand is
// being played the "Your hand" meter sits here too.
function actionBar(): HTMLElement {
  const bar = el('div', 'action-bar')
  if (!game.over && !intro) bar.appendChild(handMeter())
  if (game.over) {
    // the result card carries these buttons; they appear here only once it's been closed
    if (resultClosed && !showFinal) bar.appendChild(continueButton())
    if (resultClosed) bar.appendChild(button(showFinal ? 'Show standings' : 'Show result', () => { resultClosed = false; render() }, 'act'))
  } else if (mustDiscard && !offer) {
    for (const t of kongOptions(game, HUMAN)) bar.appendChild(button('Kong', () => humanKong(t), 'act primary', [t]))
  }
  return bar
}

// A big claim button: what it's called, the tiles involved, and a one-line reminder of what it does.
function claimButton(label: string, hint: string, onClick: () => void, cls: string, tiles: Tile[] = [], extra?: HTMLElement | null): HTMLElement {
  const b = el('button', 'claim-btn ' + cls)
  const head = el('span', 'claim-label', label)
  for (const t of tiles) head.appendChild(mini(t))
  b.append(head, el('span', 'claim-hint', hint))
  if (extra) b.appendChild(extra)
  b.onclick = onClick
  return b
}

// What taking the tile would do to your hand's patterns: "✗ Concealed hand −1", "✗ Spoils All pongs",
// "✓ Dragon pong +1". Null when it changes nothing.
function claimEffectsEl(kind: ClaimKind, tile: Tile, run?: number[]): HTMLElement | null {
  const input = { concealed: game.hands[HUMAN], melds: game.melds[HUMAN], bonus: game.bonus[HUMAN],
    seatWind: seatWind(game, HUMAN), roundWind: game.roundWind }
  const { lost, ruined, gained } = claimEffects(input, kind, tile, run)
  if (!lost.length && !ruined.length && !gained.length) return null
  const box = el('span', 'claim-effects')
  for (const i of lost) box.appendChild(el('span', 'ce-bad', `✗ Lose ${i.name} −${i.faan}`))
  for (const c of ruined) box.appendChild(el('span', 'ce-bad', `✗ Ruins ${c.name} (+${c.faan})`))
  for (const i of gained) box.appendChild(el('span', 'ce-good', `✓ ${i.name} +${i.faan}`))
  return box
}

// The pop-up when another player's discard is yours to take.
function claimCard(o: Offer): HTMLElement {
  const card = el('div', 'claim-card')
  const head = el('div', 'claim-head')
  head.append(el('span', '', `${NAMES[o.from]} threw away`), tileEl(o.tile, 'claim-tile'))
  const opts = el('div', 'claim-options')
  if (o.win) opts.appendChild(claimButton('Mahjong!', 'This tile completes your hand — you win!', () => humanClaim('win'), 'win'))
  // taking a tile exposes a set, which can cost patterns you have or are building — say which
  if (o.kong) opts.appendChild(claimButton('Kong', 'Take it: four of a kind', () => humanClaim('kong'), '', [o.tile],
    claimEffectsEl('kong', o.tile)))
  if (o.pong) opts.appendChild(claimButton('Pong', 'Take it: three of a kind', () => humanClaim('pong'), '', [o.tile],
    claimEffectsEl('pong', o.tile)))
  for (const run of o.chows) {
    const tiles = run.map(v => makeTile(o.tile.category, v))
    opts.appendChild(claimButton('Chi', 'Take it: three in a row', () => humanClaim('chow', run), '', tiles,
      claimEffectsEl('chow', o.tile, run)))
  }
  opts.appendChild(claimButton('Pass', "Don't take it", humanPass, 'pass'))
  card.append(head, opts)
  return card
}

// Your hand on the big rack: sorted, with the freshly drawn tile set apart on the right.
function playerRack(): HTMLElement {
  const rack = el('div', 'player-rack' + (game.winner === HUMAN ? ' winner' : ''))
  const canDiscard = !game.over && mustDiscard && !offer
  const drawn = canDiscard ? game.drawn : null
  // mid-deal your tiles arrive in batches and sit in the order dealt; once dealt you sort them
  const tiles = intro && intro.phase !== 'flowers'
    ? game.hands[HUMAN].slice(0, handCount(HUMAN))
    : sortHand(game.hands[HUMAN].filter(t => t !== drawn))
  const add = (t: Tile, cls = '') => rack.appendChild(tileEl(t, cls, canDiscard ? () => humanDiscard(t) : undefined))
  for (const t of tiles) add(t)
  if (drawn) add(drawn, 'drawn')
  return rack
}

// ---------- Help panel ----------

const exampleTiles = (spec: string, cls = 'ex') => {
  const row = el('span', 'tiles-row')
  for (const t of parse(spec)) row.appendChild(tileEl(t, cls))
  return row
}
function uniqueTiles(tiles: Tile[]): Tile[] {
  return tiles.filter((t, i) => tiles.findIndex(o => o.category === t.category && o.value === t.value) === i)
}
function para(...parts: (string | Node)[]): HTMLElement { const p = el('p'); p.append(...parts); return p }

// Tiles that would let you declare a win with these concealed tiles — complete AND reaching the
// minimum (counting a self-draw, since you might draw it yourself).
const winsFor = (concealed: Tile[]) =>
  winningTiles(concealed, game.melds[HUMAN].length).filter(t => faanOf(HUMAN, [...concealed, t], true) >= match.minFaan)

// "Right now": what you should do at this moment, plus hints toward a win.
function nowSection(): HTMLElement {
  const s = el('section', 'now')
  s.appendChild(el('h3', '', 'Right now'))
  const hand = game.hands[HUMAN], melds = game.melds[HUMAN].length
  if (game.over) {
    s.append(para(resultLine()), para(match.over ? 'That was the last hand — press “Final results”.' : 'Press “Next hand” to carry on.'))
  } else if (intro) {
    s.append(para(`${game.dealer === HUMAN ? 'You are' : `${NAMES[game.dealer]} is`} the dealer this hand. The dice decide where the wall is opened, then everyone gets 13 tiles — four at a time.`),
      para('Flowers and seasons are put aside and replaced automatically.'))
  } else if (offer) {
    s.append(para(`${NAMES[offer.from]} threw away a tile you can use. Choose a big button in the box, or press Pass.`))
  } else if (mustDiscard) {
    s.append(para('Your turn. You have one tile too many — tap a tile in your hand to throw it away.'))
    if (isWinningHand(hand, melds)) {               // complete, but below the agreed minimum
      const f = faanOf(HUMAN, hand, true)
      s.append(para(`Your hand is complete but scores only ${f} faan — you need ${match.minFaan} to win. Keep going for a better hand!`))
    }
    const keepReady = uniqueTiles(hand).filter(t => winsFor(hand.filter(h => h !== t)).length > 0)
    if (keepReady.length) {
      const p = para('Tip: throw away one of these and you’ll be just one tile from winning: ')
      for (const t of keepReady) p.appendChild(mini(t))
      s.appendChild(p)
    }
    const plan = bestPlanPara()
    if (plan) s.appendChild(plan)
  } else {
    s.append(para(`Waiting for ${NAMES[game.current]} to play…`))
    const wins = winsFor(hand)
    if (wins.length) {
      const p = para('You’re one tile from winning! You need: ')
      for (const t of wins) p.appendChild(mini(t))
      s.appendChild(p)
    }
    const plan = bestPlanPara()
    if (plan) s.appendChild(plan)
  }
  return s
}

// "To reach 3 faan: Mixed one suit — throw away 2萬 3筒." when your hand is short of the minimum.
function bestPlanPara(): HTMLElement | null {
  const input = { concealed: game.hands[HUMAN], melds: game.melds[HUMAN], bonus: game.bonus[HUMAN],
    seatWind: seatWind(game, HUMAN), roundWind: game.roundWind }
  const { base, plans } = planToMinimum(input, match.minFaan)
  if (base >= match.minFaan) return null
  const p = para(el('strong', '', `To reach ${match.minFaan} faan: `))
  if (!plans.length) { p.append('try keeping just one suit, plus winds and dragons (+3).'); return p }
  const best = headlinePlan(plans)
  p.append(`${planSummary(best)} (→ ${best.total} faan)`)
  for (const item of best.items) {
    p.append(item.action === 'need' ? ' — need ' : ' — throw away ')
    for (const t of item.tiles) p.appendChild(mini(t))
  }
  p.append('. Hover over “Your hand” for more plans.')
  return p
}

function helpPanel(): HTMLElement {
  const p = el('aside', 'help')
  const head = el('div', 'help-head')
  head.append(el('h2', '', 'How to play'), button('✕', toggleHelp, 'close-btn'))
  p.append(head, nowSection(), ...rulesSections(true))
  return p
}

// The rules guide — shared by the in-game panel and the "How to play" page in the menu.
// `inGame` adds the reminder of this game's minimum faan.
function rulesSections(inGame: boolean): HTMLElement[] {
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
  { name: 'Concealed hand', faan: '+1', what: 'You win without taking anyone’s tile for a set — no Pong, Chi or Kong.' },
  { name: 'No flowers', faan: '+1', what: 'You have no flower or season tiles.' },
  { name: 'Own flower', faan: '+1 each', what: 'A flower or season showing your seat number: East 1, South 2, West 3, North 4.', bonus: [makeTile('flower', 0), makeTile('season', 0)] },
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
]

function scoringSection(inGame: boolean): HTMLElement {
  const s = el('section')
  s.append(el('h3', '', 'How to earn points'),
    para('Every winning hand scores ', el('strong', '', 'faan'), ' for the patterns in it. Add them up — more faan, more points.'),
    para(el('strong', 'min-note', inGame
      ? `This game: you need at least ${match.minFaan} faan to win.`
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
    para('Everyone starts at 0. The dealer (East) keeps the deal after winning or a draw; otherwise it passes on.'))
  return s
}

function toggleHelp() {
  helpOpen = !helpOpen
  try { localStorage.setItem(HELP_KEY, helpOpen ? '1' : '0') } catch { /* storage unavailable — keep it in memory */ }
  render()
}

function render() {
  inMenu = false
  app.innerHTML = ''
  const main = el('div', 'main-col')
  const top = el('div', 'topbar')
  // round and wall: "East round · Hand 3" over "87 tiles left"
  // mid-deal, tiles not yet handed out still count as being in the wall
  const tilesLeft = game.wall.length + (intro && intro.phase !== 'flowers' ? 52 - intro.shown.reduce((a, b) => a + b, 0) : 0)
  const round = chip(WIND_CHARS[game.roundWind], null, null, 'info round')
  round.title = `${SEATS[game.roundWind]} round, hand ${match.hand} — ${tilesLeft} tiles left in the wall`
  const roundText = el('span', 'chip-stack')
  const tilesLine = el('span', 'chip-small')
  tilesLine.append(el('strong', '', String(tilesLeft)), ' tiles left')
  roundText.append(el('span', '', `${SEATS[game.roundWind]} round · Hand ${match.hand}`), tilesLine)
  round.appendChild(roundText)
  // three columns: menu | status (centred over the table) | game info and settings
  const leftGroup = el('div', 'tb-left')
  leftGroup.appendChild(chip(ICONS.menu, 'Menu', () => void openPause()))
  const rightGroup = el('div', 'tb-right')
  // the gold outline shows when the rules are open, so the label can stay short
  const rules = chip(ICONS.book, 'Rules', toggleHelp, 'rules-chip' + (helpOpen ? ' on' : ''))
  rules.title = helpOpen ? 'Hide the rules panel' : 'Show the rules panel'
  rightGroup.append(round, rules, ...soundButtons(render))
  top.append(leftGroup, statusEl(), rightGroup)

  const table = el('div', 'table')
  for (let seat = 0; seat < 4; seat++) table.appendChild(sideLayer(seat))
  table.appendChild(discardPool())
  if (intro && intro.phase !== 'flowers') table.appendChild(tableDice(intro))
  const scene = el('div', 'scene')                    // supplies the perspective for the tilted table
  scene.appendChild(table)

  main.append(top, scene, actionBar(), playerRack())
  if (offer) main.appendChild(claimCard(offer))

  const layout = el('div', 'layout')
  layout.appendChild(main)
  if (helpOpen) layout.appendChild(helpPanel())
  app.appendChild(layout)

  if (game.over && !resultClosed) main.appendChild(showFinal ? finalCard() : resultCard())
  music.start()                                       // carries on (or resumes, e.g. via Continue game)
  if (!coachOpen && !paused) music.duck(game.over && !resultClosed)   // quieter while the result card is showing
  if (celebrate) { celebrate = false; main.appendChild(confetti()) }
  for (const b of banners) showBanner(b, scene)
  banners = []
  if (!paused) wakeWaiters()                          // back at the table: a paused deal or bot turn carries on
}

// Where on the table each player's banners appear (fractions of the table's on-screen box).
// Side players' banners hug their own edge (see .banner[data-spot] in the CSS) and sit higher up,
// so they never cover the "Your turn" banner in the middle.
const BANNER_SPOT: Record<string, [number, number]> = {
  0: [0.5, 0.85], 1: [0.97, 0.3], 2: [0.5, 0.15], 3: [0.03, 0.3], middle: [0.5, 0.5],
}

// A short pop-up banner over the table. It lives outside #app so re-renders don't restart it,
// and removes itself when its animation ends. A new banner replaces one already in the same spot.
function showBanner(b: Banner, over: HTMLElement) {
  const spot = b.seat === null ? 'middle' : String(b.seat)
  document.querySelector(`.banner[data-spot="${spot}"]`)?.remove()
  const r = over.getBoundingClientRect()
  const [fx, fy] = BANNER_SPOT[spot]
  const banner = el('div', `banner ${b.kind}`, b.text)
  banner.dataset.spot = spot
  for (const t of b.tiles ?? []) banner.appendChild(mini(t))
  banner.style.left = `${r.left + r.width * fx}px`
  banner.style.top = `${r.top + r.height * fy}px`
  banner.addEventListener('animationend', () => banner.remove())
  document.body.appendChild(banner)
}

// Everyone's score change for the hand and their new total, best first.
function scoreTable(deltas: number[]): HTMLElement {
  const t = el('div', 'score-table')
  for (const p of standings()) {
    const d = deltas[p]
    t.append(
      el('span', 'st-name' + (p === HUMAN ? ' you' : ''), NAMES[p]),
      el('span', 'st-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : ''), d === 0 ? '—' : signed(d)),
      el('span', 'st-total', signed(match.scores[p])),
    )
  }
  return t
}

// The end-of-hand card: who won (or a draw), the winning hand, its faan, and who paid whom.
function resultCard(): HTMLElement {
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
    const paid = r.from === null
      ? `Everyone else pays ${fmt(-r.deltas[(w + 1) % 4])}`
      : `${r.from === HUMAN ? 'You pay' : `${NAMES[r.from]} pays`} ${fmt(-r.deltas[r.from])}`
    faan.appendChild(el('div', 'paid', paid))
    cols.appendChild(faan)
  }
  const scores = el('div', 'score-box')
  scores.append(el('h4', '', 'Scores'), scoreTable(r.deltas))
  cols.appendChild(scores)
  card.appendChild(cols)

  // what happens next
  let next: string
  if (match.over) next = 'That was the last hand of the game.'
  else if (r.dealerStays) next = `${NAMES[game.dealer]} ${game.dealer === HUMAN ? 'stay' : 'stays'} dealer for the next hand.`
  else next = `Next hand: ${NAMES[match.dealer]} ${match.dealer === HUMAN ? 'deal' : 'deals'}${match.roundWind !== game.roundWind ? ` — the ${SEATS[match.roundWind]} round begins` : ''}.`
  card.appendChild(el('div', 'result-next', next))

  const actions = el('div', 'result-actions')
  actions.append(continueButton(), button('See the table', () => { resultClosed = true; render() }, 'act'))
  card.appendChild(actions)
  return card
}

// The final standings once the last hand is played.
function finalCard(): HTMLElement {
  const order = standings()
  const youFirst = order[0] === HUMAN
  const card = el('div', 'result-card final' + (youFirst ? ' you' : ''))
  card.append(
    el('div', 'result-title', youFirst ? '🏆 You win the game! 🏆' : 'Game over'),
    el('div', 'result-sub', youFirst ? 'Congratulations — top score!' : `${NAMES[order[0]]} wins the game`),
  )
  const list = el('div', 'standings')
  const places = ['1st', '2nd', '3rd', '4th']
  order.forEach((p, i) => {
    const row = el('div', 'standing' + (p === HUMAN ? ' you' : '') + (i === 0 ? ' first' : ''))
    row.append(el('span', 'place', places[i]), el('span', 'who', NAMES[p]), el('span', 'pts', `${signed(match.scores[p])} pts`))
    list.appendChild(row)
  })
  card.append(list, el('div', 'result-next', `${match.hand} hands played`))
  const actions = el('div', 'result-actions')
  actions.append(button('Play again', startMatch, 'act primary'), button('Main menu', renderMenu, 'act'),
    button('See the table', () => { resultClosed = true; render() }, 'act'))
  card.appendChild(actions)
  return card
}

// Confetti falling over the table when you win.
function confetti(): HTMLElement {
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

renderMenu()
