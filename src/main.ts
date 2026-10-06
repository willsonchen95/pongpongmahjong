import './style.css'
import {
  type Tile, type GameState, type ClaimKind, type HaveItem, type CloseTo, SEATS, sortHand, makeTile, isWinningHand,
  kongOptions, winningTiles, parse, seatWind, payout, handProgress, planToMinimum, type Plan, MAX_FAAN,
  claimEffects, progressInput, isConcealedKong,
} from './engine'
import { tileSVG, tileName } from './tiles'
import { sfx, music, isMuted, setMuted } from './sfx'
import * as motion from './motion'
import { Table, type Match, type HandResult, type Offer, type TableData, type Phase, type Draw, type TableEvent } from './table'
import { OnlineRoom, ROOM_SERVER, ROOM_CODE, newRoomCode, savedSession, type LocalView } from './online'

// Players sit in fixed places: you at the bottom, then counter-clockwise (the turn order)
// Mei on your right, Kai across, Lin on your left. Seat winds move as the deal passes round.
const HUMAN = 0
declare const __APP_VERSION__: string        // filled in at build time (vite.config.ts)
declare const __BUILD_DATE__: string
const BOT_NAMES = ['You', 'Mei', 'Kai', 'Lin']
let NAMES = BOT_NAMES                     // online: the room's players, turned round so you're first
const WIND_CHARS = ['東', '南', '西', '北']
const possessive = (p: number) => (p === HUMAN ? 'your' : `${NAMES[p]}’s`)
const fmt = (n: number) => n.toLocaleString('en-US')
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0')
const points = (n: number) => (n < 0 ? `−${fmt(-n)}` : fmt(n))      // a player's balance

// ---------- The match ----------
// The rules of play — the turn flow, claims, scoring, the match moving on — live in table.ts; this
// file shows the table and plays the bots' moves at a pace you can follow.

// What the players agree before a game; remembered for next time.
interface Settings { rounds: number; minFaan: number; tips: boolean; startPoints: number }
const SETTINGS_KEY = 'mahjong-settings'
let settings: Settings = (() => {
  const fallback = { rounds: 1, minFaan: 1, tips: true, startPoints: 1000 }
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') } } catch { return fallback }
})()
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* storage unavailable — keep it in memory */ }
}

// You play seat 0; the other three are bots.
const SEAT_IS_PERSON = [true, false, false, false]
let table = new Table(settings, SEAT_IS_PERSON)

// The screen reads the table through these, refreshed from it by sync() after every change.
let match: Match = table.match
let game: GameState = table.game
let mustDiscard = false           // it's your turn and you must discard (or declare a kong)
let winFrom: number | null = null // player whose discard won the hand; null = self-drawn
let lastDiscard: number | null = null  // player whose latest discard is the newest tile on the table (for highlighting)
let pool: Tile[] = []             // every discard still on the table, in the order thrown — shown in the middle

// ---------- One hand ----------

let started = false               // a match is under way (enables "Resume" in the menu)
let wallBreak = 0                // where the wall is broken open, in ring slots — cosmetic, random per hand
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
// The rule book never opens by itself — a coachmark in the tutorial points at the Rules button
// instead. If the player opened it last time on a screen with room beside the table, it's open
// again; on a narrow screen (a phone) it would cover the table, so there it always starts closed.
let helpOpen = (() => {
  if (window.innerWidth <= 1150) return false
  try { return localStorage.getItem(HELP_KEY) === '1' } catch { return false }
})()

let offer: Offer | null = null    // a tile you may take right now (see Offer in table.ts), or null

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const BOT_THINK_MS = 900          // pause before each bot move, so you can follow the play
const CLAIM_PAUSE_MS = 1100       // extra pause after a bot claims a discard
// What players see and hear for each call. (The rules code calls a run a "chow"; on screen it's "Chi".)
const CALL_WORDS: Record<ClaimKind, string> = { pong: 'Pong!', kong: 'Kong!', chow: 'Chi!' }

// The screen's view of the table, refreshed after every change: the table owns the state, and these
// module variables are what the drawing code reads.
function sync() {
  match = table.match
  game = table.game
  pool = table.pool
  lastDiscard = table.lastDiscard
  winFrom = table.winFrom
  winTile = table.winTile
  const p = table.phase
  mustDiscard = p.kind === 'turn' && p.seat === HUMAN
  offer = p.kind === 'claims' && !p.answers[HUMAN] ? p.offers[HUMAN] : null
}

// Turn the table's events (or, online, the room's) into sounds and banners.
function playEvents(events: TableEvent[] = table.takeEvents()) {
  for (const e of events) {
    if (e.type === 'draw') sfx.draw(e.seat !== HUMAN)
    else if (e.type === 'flowers') announceFlowers(e.seat, e.tiles)
    else if (e.type === 'discard') sfx.discard()
    else if (e.type === 'call') announceCall(e.seat, e.kind, e.meld)
    else if (e.type === 'yourTurn' && e.seat === HUMAN) { banners.push({ text: 'Your turn', kind: 'turn', seat: null }); sfx.yourTurn() }
    else if (e.type === 'win') { celebrate = e.seat === HUMAN; sfx.win() }
  }
  sync()
}

// The scoring helpers the hints use, for the current table.
const faanOf = (seat: number, concealed: Tile[], selfDrawn: boolean, now = true) => table.faanOf(seat, concealed, selfDrawn, now)

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

// Play on from wherever the table is until it needs you (your move, a tile you may take) or the hand
// ends. Bots pause before moving so you can follow, and again after taking someone's tile; the loop
// gives up if a new hand was started meanwhile.
async function drive() {
  const myGen = gen
  const stale = () => myGen !== gen
  for (;;) {
    const p = table.phase
    if (p.kind === 'next') { table.startTurn(); playEvents(); continue }
    if (p.kind === 'discarded') {
      const taker = table.afterDiscard()
      playEvents()
      if (taker !== null && !game.over && table.phase.kind === 'next') {   // someone took the tile — let it register
        refresh()
        if (taker !== HUMAN) await coach('bot-call', TIPS.botCall(taker))   // first time only
        await sleep(CLAIM_PAUSE_MS)
        if (stale()) return
      }
      continue
    }
    if (p.kind !== 'turn' || table.humans[p.seat]) break    // your move, your decision, or the hand is over
    refresh()
    await gameIdle()                              // a tip, the pause box or the menu is up: wait
    await sleep(BOT_THINK_MS)
    await gameIdle()
    if (stale()) return
    table.botMove()
    playEvents()
    if (table.phase.kind === 'discarded') refresh()   // show the tile land before anyone takes it
  }
  refresh()
}

// Your moves. Online they go to the room, and the screen changes when the room's answer comes back.
function humanClaim(kind: ClaimKind | 'win', run?: number[]) {
  if (!offer) return
  if (online) return online.send({ type: 'answer', answer: { kind, run } })
  if (table.answer(HUMAN, { kind, run })) { playEvents(); void drive() }
}

function humanPass() {
  if (!offer) return
  if (online) return online.send({ type: 'answer', answer: { kind: 'pass' } })
  if (table.answer(HUMAN, { kind: 'pass' })) { playEvents(); void drive() }
}

function humanKong(tile: Tile) {
  if (online) return online.send({ type: 'kong', tile: tile.id! })
  if (table.kong(HUMAN, tile)) { playEvents(); void drive() }
}

function humanDiscard(tile: Tile) {
  if (online) { if (mustDiscard) online.send({ type: 'discard', tile: tile.id! }); return }
  if (table.discard(HUMAN, tile)) { playEvents(); void drive() }
}

// ---------- Playing online ----------
// In an online room the room server runs the game; this device only shows it. Each update from the
// room (already turned so you're seat 0) is put into the local table object, so the whole screen —
// and the hints, which score hands on that table — works just as it does in a game against bots.

let online: OnlineRoom | null = null
let onlineDeal = ''                       // the deal we've shown (your tiles' ids)

function goOnline(code: string, name: string) {
  online?.leave()
  // a game against the bots stays saved as it was; it's loaded again when you leave the room
  gen++
  started = false
  intro = null
  table = new Table(settings, SEAT_IS_PERSON)
  sync()
  const room = new OnlineRoom(code, name)
  online = room
  room.onRoom = () => {
    NAMES = room.names()
    if (!room.room?.started || !room.view) { if (lobbyShowing()) renderLobby() }
    else refresh()                                     // someone left or came back: their name on the table
  }
  room.onState = (view, events) => applyOnline(view, events)
  room.onError = message => { onlineError = message; if (lobbyShowing()) renderLobby(); else refresh() }
  room.onConnection = () => { if (lobbyShowing()) renderLobby(); else refresh() }
  room.connect()
  renderLobby()
}

function leaveOnline() {
  online?.leave()
  online = null
  NAMES = BOT_NAMES
  onlineDeal = ''
  intro = null
  gen++
  if (!loadMatch()) { table = new Table(settings, SEAT_IS_PERSON); sync() }   // back to your game against the bots, if any
  renderMenu()
}

let onlineError = ''
const lobbyShowing = () => !!app.querySelector('.lobby')

// An update from the room: put it into the table, then show it — the deal first, if a hand just began.
function applyOnline(view: LocalView, events: TableEvent[]) {
  table.match = view.match
  table.game = view.game
  table.pool = view.pool
  table.lastDiscard = view.lastDiscard
  table.winFrom = view.winFrom
  table.phase = view.phase
  const w = view.game.winner
  table.winTile = w === null ? null : view.game.hands[w].find(t => t.id === view.winTileId) ?? null
  onlineError = ''
  // a new deal: recognised by your tiles (the hand number alone repeats when a new game starts)
  const deal = view.game.hands[HUMAN].map(t => t.id).join()
  const newDeal = view.phase.kind === 'dealing' && deal !== onlineDeal
  onlineDeal = deal
  if (newDeal) {
    gen++
    sync()
    banners = []; resultClosed = false; showFinal = false; celebrate = false
    inMenu = false
    void runIntro()
    return
  }
  // play has begun while this screen was still showing the deal (a slow or backgrounded tab): the room
  // doesn't wait, so drop the rest of the deal and show the table as it is now
  if (intro && view.phase.kind !== 'dealing') { gen++; intro = null }
  playEvents(events)
  if (game.over && !resultClosed && events.some(e => e.type === 'win' || e.type === 'exhausted')) showFinal = false
  if (inMenu && !intro) { inMenu = false; render() }
  else if (!intro) refresh()
}

function startMatch() {
  if (online) { online.leave(); online = null; NAMES = BOT_NAMES }   // a game against the bots instead
  music.start()                                       // the Start click is the gesture browsers want before playing audio
  saveSettings()
  table = new Table(settings, SEAT_IS_PERSON)
  started = true
  nextHand()
}

// Deal the next hand of the match: roll the dice, deal the tiles out, reveal flowers, then the
// dealer draws first.
function nextHand() {
  gen++
  table.newHand()
  sync()
  banners = []; resultClosed = false; showFinal = false; celebrate = false
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
  // online the room waits ~7 seconds for the deal on everyone's screen, so it's shown a little quicker
  const quick = !!online

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
  await wait(quick ? 900 : 1700)
  if (stale()) return

  // 2. deal: four tiles at a time to each player, three times round, then one more each
  it.phase = 'deal'
  const order = [0, 1, 2, 3].map(k => (game.dealer + k) % 4)
  for (const batch of [4, 4, 4, 1]) {
    for (const p of order) {
      it.shown[p] += batch
      dealingTo = p                                    // the tiles fly from the wall to them as it redraws
      sfx.deal()
      refresh()
      await wait(quick ? 200 : 260)
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
    await wait(quick ? 450 : 1100)
    if (stale()) return
  }

  intro = null
  if (online) { refresh(); return }                    // the room starts the play itself
  table.begin()                                        // the dealer draws first
  void drive()
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
  if (online) {                                        // an online game can't pause for everyone
    const choice = await dialog('Leave the room?',
      `The game carries on without you — a bot plays your seat. To come back, use the code ${online.code}.`, [
        { label: 'Stay', value: 'stay', cls: 'primary' },
        { label: 'Leave room', value: 'leave', cls: 'danger' },
      ])
    if (choice === 'leave') leaveOnline()
    return
  }
  paused = true
  music.duck(true)
  const where = `${SEATS[match.roundWind]} round · Hand ${match.hand} · Your points ${points(match.scores[HUMAN])}`
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
  intro = null
  clearSave()
  wakeWaiters()
  document.querySelectorAll('.banner, .ghost-tile').forEach(e => e.remove())
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !inMenu && !paused && !coachOpen && (started || online)) { e.preventDefault(); void openPause() }
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
  if (online) return                                  // an online game can't stop for one player's tip
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
  helpOpen = false                                    // the table first; a coachmark shows where the rule book is
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
        body: ['You just drew a tile — it’s set apart on the right. Now you have one tile too many.', touchScreen.matches
          ? 'Tap the tile you need least to lift it, then tap it again to throw it away.'
          : 'Tap the tile you need least to throw it away.'] },
      { target: '.hm-total', title: 'Your hand’s score',
        body: ['This shows the faan (points) your hand already has.', 'Hover over it — or tap it — to see what you have and what to aim for next.'] },
      { target: '.status-pill', title: 'What’s happening',
        body: ['This tells you whose turn it is. It glows gold whenever it’s your move.'] },
      { target: '.rules-chip', title: 'The rule book',
        body: ['Stuck? Tap here any time to open the rule book — every set and every scoring pattern, with pictures.',
          'Tap it again to close it and get back to the table.'] },
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
// Every physical tile gets a lasting id, and on-table elements are tagged with it and with where the
// tile lies, so motion.ts can glide it from its old place to its new one between renders.
const tileIds = new WeakMap<Tile, number>()
let nextTileId = 1
function tag<T extends HTMLElement>(e: T, t: Tile, place: string): T {
  if (!tileIds.has(t)) tileIds.set(t, nextTileId++)
  e.dataset.key = t.id === undefined ? 'o' + tileIds.get(t) : String(t.id)   // a tile's own id stays the same across online updates
  e.dataset.place = place
  return e
}

// A tile-sized spot in the middle of a player's rack, on screen.
function rackSpot(seat: number, w: number, h: number): DOMRect | null {
  const rack = seat === HUMAN ? document.querySelector('.player-rack') : document.querySelector(`.layer[data-seat="${seat}"] .rack-row`)
  if (!rack) return null
  const r = rack.getBoundingClientRect()
  return new DOMRect(r.left + r.width / 2 - w / 2, r.top + r.height / 2 - h / 2, w, h)
}

// Where tiles appearing on the table come from, for motion.ts: a new discard, set or flower comes
// from its owner's rack; tiles off the wall go to whoever is being dealt to or drawing.
let dealingTo = 0
const motionHooks: motion.Hooks = {
  origin(e) {
    const [what, seatText] = (e.dataset.place ?? '').split('-')
    const seat = what === 'pool' ? lastDiscard : Number(seatText)
    if (seat === null || Number.isNaN(seat) || (what !== 'pool' && what !== 'meld' && what !== 'bonus')) return null
    const size = e.getBoundingClientRect()
    return rackSpot(seat, size.width, size.height)
  },
  wallSink() {
    const seat = intro ? dealingTo : game.current
    if (seat === HUMAN) return null                    // yours fly to the actual tiles in your rack
    const stack = document.querySelector('[data-stack]')?.getBoundingClientRect()
    return stack ? rackSpot(seat, stack.width, stack.height) : null
  },
}

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
  // the name as a logo: "Pong Pong" over a bigger "Mahjong!", each word bouncing in after the last
  const title = el('h1', 'menu-title')
  title.setAttribute('aria-label', 'Pong Pong Mahjong!')
  const top = el('span', 'mt-line')
  top.append(el('span', 'mt-word', 'Pong'), el('span', 'mt-word', 'Pong'))
  title.append(top, el('span', 'mt-line mt-big', ''))
  title.lastElementChild!.appendChild(el('span', 'mt-word', 'Mahjong!'))
  const tagline = el('p', 'menu-tagline')
  tagline.append(el('span', 'mt-spark', '✦'), 'Pong until you can’t Pong anymore!', el('span', 'mt-spark', '✦'))
  hero.append(fan, title, el('div', 'menu-cn', '麻雀'), tagline)
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
      `${SEATS[match.roundWind]} round · Hand ${match.hand} · Your points ${points(match.scores[HUMAN])}`, continueGame, 'primary'))
  }
  const fresh = !(started && !match.over)
  cards.append(
    menuCard(MENU_ICONS.play, 'New game', 'Choose your house rules, then play', renderSetup, fresh ? 'primary' : ''),
    menuCard(MENU_ICONS.learn, 'Learn to play', 'A guided game — friendly tips explain every step', () => void startNewIfOk(startGuidedGame), 'learn',
      tipsSeen.size === 0 ? 'New to mahjong? Start here' : ''),
    menuCard(MENU_ICONS.book, 'How to play', 'The rules, the sets and how scoring works — with pictures', renderRulesPage),
    onlineMenuCard(),
  )
  // which version this is, and when it was built — at the very bottom of the menu
  // (a dev server started before vite.config.ts existed doesn't fill them in — say so rather than break)
  const version = typeof __APP_VERSION__ === 'string' ? `v${__APP_VERSION__}` : 'dev'
  const built = typeof __BUILD_DATE__ === 'string'
    ? ` · ${new Date(__BUILD_DATE__).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''
  page.append(menuHero(), sound, cards, el('p', 'menu-version', version + built))
  app.appendChild(page)
}

// "Play online" — or, while you're in a room, the way back to it (also after a reload).
function onlineMenuCard(): HTMLElement {
  if (!ROOM_SERVER) return menuCard(MENU_ICONS.online, 'Play online', 'Play with friends and family', null, 'soon', 'Coming soon')
  const room = online
  if (room) {
    return menuCard(MENU_ICONS.online, `Back to room ${room.code}`, room.room?.started ? 'Your online game is still going' : 'Your friends are in the room', () => {
      if (room.room?.started && room.view) { inMenu = false; render() } else renderLobby()
    }, 'primary')
  }
  const session = savedSession()
  if (session) {
    return menuCard(MENU_ICONS.online, `Rejoin room ${session.code}`, `Back to your online game as ${session.name}`,
      () => goOnline(session.code, session.name), '', 'Online')
  }
  return menuCard(MENU_ICONS.online, 'Play online', 'Play with friends — create a room or join one with a code', renderOnlineHome)
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

  ruleChoices(card, renderSetup, true)
  const actions = el('div', 'setup-actions')
  actions.append(button('‹ Back', renderMenu, 'act'), button('Start game', () => void startNewIfOk(startMatch), 'act primary big'))
  card.appendChild(actions)
  app.appendChild(card)
}

// The house rules, as rows of choices (the New game screen, and the host's in an online room).
// Choosing one updates `settings` and redraws the screen with `redraw`.
function ruleChoices(card: HTMLElement, redraw: () => void, withTips: boolean) {
  const pick = (change: Partial<Settings>) => { settings = { ...settings, ...change }; saveSettings(); redraw() }

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

  if (withTips) {
    card.append(el('h2', 'setup-q', 'Beginner tips'),
      choiceRow([
        { value: true, label: 'On', sub: 'Short pop-ups explain each new step' },
        { value: false, label: 'Off', sub: 'I know how to play' },
      ], settings.tips, v => pick({ tips: v })))
  }

  card.append(el('h2', 'setup-q', 'Starting points'),
    el('p', 'setup-help', 'Everyone starts with this many points. Winners collect from whoever pays; if anyone drops below zero the game ends early. Most points at the end wins.'),
    choiceRow([
      { value: 1000, label: '1,000', sub: 'Lively — one big hand can end it' },
      { value: 2000, label: '2,000', sub: 'Room for a few bad hands' },
      { value: 5000, label: '5,000', sub: 'Plays to the end almost always' },
    ], settings.startPoints, v => pick({ startPoints: v })))
}

// ---------- Online: joining a room, and the room before the game ----------

const NAME_KEY = 'mahjong-online-name'
const savedName = () => { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } }
let inviteCode = ''                       // a room code from an invite link, waiting to be joined

// "Play online": your name, then create a room or join one with its code.
function renderOnlineHome() {
  inMenu = true
  app.innerHTML = ''
  const card = el('div', 'setup online-home')
  card.append(el('h1', 'setup-title', 'Play online'),
    el('p', 'setup-intro', 'Play with friends: one of you creates a room and shares its code. Bots fill any empty seats.'))

  const nameInput = el('input', 'text-input') as HTMLInputElement
  nameInput.maxLength = 16
  nameInput.placeholder = 'Your name'
  nameInput.value = savedName()
  nameInput.autocomplete = 'nickname' as AutoFill
  const codeInput = el('input', 'text-input code-input') as HTMLInputElement
  codeInput.maxLength = 5
  codeInput.placeholder = 'CODE'
  codeInput.value = inviteCode
  codeInput.autocapitalize = 'characters'
  codeInput.spellcheck = false
  const message = el('p', 'form-message')

  const go = (code: string) => {
    const name = nameInput.value.trim()
    if (!name) { message.textContent = 'Enter your name first.'; nameInput.focus(); return }
    try { localStorage.setItem(NAME_KEY, name) } catch { /* fine */ }
    inviteCode = ''
    goOnline(code, name)
  }
  codeInput.oninput = () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }

  const create = button('Create a room', () => go(newRoomCode()), 'act primary big')
  const join = button('Join', () => {
    const code = codeInput.value.trim().toUpperCase()
    if (!ROOM_CODE.test(code)) { message.textContent = 'A room code is 5 letters and numbers, like K7Q2M.'; codeInput.focus(); return }
    go(code)
  }, 'act')
  const joinRow = el('div', 'join-row')
  joinRow.append(codeInput, join)

  card.append(el('h2', 'setup-q', 'Your name'), nameInput,
    el('h2', 'setup-q', 'Start a room'), el('p', 'setup-help', 'You’ll get a code to send to your friends.'), create,
    el('h2', 'setup-q', 'Or join one'), el('p', 'setup-help', 'Type the code a friend sent you.'), joinRow,
    message)
  const actions = el('div', 'setup-actions')
  actions.append(button('‹ Back', renderMenu, 'act'))
  card.appendChild(actions)
  app.appendChild(card)
  ;(inviteCode && !nameInput.value ? nameInput : inviteCode ? join : nameInput).focus()
}

// The room before the game: its code to share, who's sitting where, and — for the host — the rules
// and the Start button.
function renderLobby() {
  const room = online
  if (!room) return renderMenu()
  inMenu = true
  app.innerHTML = ''
  const card = el('div', 'setup lobby')
  const r = room.room
  card.append(el('h1', 'setup-title', 'Your room'))

  const codeBox = el('div', 'room-code')
  codeBox.append(el('span', 'room-code-label', 'Room code'), el('span', 'room-code-value', room.code))
  const link = `${location.origin}${location.pathname}?room=${room.code}`
  const copy = button('Copy invite link', async () => {
    try {
      if (navigator.share && touchScreen.matches) await navigator.share({ title: 'Pong Pong Mahjong!', text: `Join my mahjong room: ${room.code}`, url: link })
      else { await navigator.clipboard.writeText(link); copy.textContent = 'Link copied ✓' }
    } catch { /* closed the share sheet */ }
  }, 'act')
  codeBox.appendChild(copy)
  card.appendChild(codeBox)

  if (!room.connected) card.appendChild(el('p', 'form-message', r ? 'Connection lost — reconnecting…' : 'Connecting…'))
  if (onlineError) card.appendChild(el('p', 'form-message', onlineError))

  if (r) {
    card.appendChild(el('h2', 'setup-q', 'Players'))
    const list = el('div', 'seat-list')
    r.seats.forEach((s, i) => {
      const row = el('div', 'seat-row' + (i === r.you ? ' you' : '') + (s.person ? '' : ' bot'))
      row.append(el('span', 'seat-wind', WIND_CHARS[i]), el('span', 'seat-name', s.name + (i === r.you ? ' (you)' : '')))
      const tag = !s.person ? 'Bot' : s.host ? 'Host' : s.connected ? '' : 'Away'
      if (tag) row.appendChild(el('span', 'seat-tag', tag))
      list.appendChild(row)
    })
    card.appendChild(list)
    const isHost = r.you !== null && r.seats[r.you]?.host
    if (isHost) {
      ruleChoices(card, renderLobby, false)
      const actions = el('div', 'setup-actions')
      actions.append(button('Leave', leaveOnline, 'act'),
        button('Start game', () => room.start({ rounds: settings.rounds, minFaan: settings.minFaan, startPoints: settings.startPoints }), 'act primary big'))
      card.appendChild(actions)
    } else {
      const host = r.seats.find(s => s.host)
      card.appendChild(el('p', 'setup-help lobby-wait', `Waiting for ${host?.name ?? 'the host'} to start the game…`))
      const actions = el('div', 'setup-actions')
      actions.append(button('Leave', leaveOnline, 'act'))
      card.appendChild(actions)
    }
  } else {
    const actions = el('div', 'setup-actions')
    actions.append(button('Leave', leaveOnline, 'act'))
    card.appendChild(actions)
  }
  app.appendChild(card)
}

// The hand just won was won by robbing a kong (the tile came from a pong being made a kong).
const wonByRobbing = () => !!match.result?.items.some(i => i.name === 'Robbing a kong')

// One sentence describing how the hand ended.
function resultLine(): string {
  if (game.winner === null) return 'The wall ran out — nobody won this hand.'
  const who = game.winner === HUMAN ? 'You win' : `${NAMES[game.winner]} wins`
  const how = winFrom === null ? 'by drawing the winning tile'
    : wonByRobbing() ? `by robbing ${possessive(winFrom)} kong` : `with ${possessive(winFrom)} thrown-away tile`
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
    hint = winFrom === null ? 'Drew the winning tile'
      : wonByRobbing() ? `Robbed ${possessive(winFrom)} kong` : `On ${possessive(winFrom)} thrown-away tile`
  } else if (game.over) {
    mood = 'done'; badge = '–'; title.textContent = 'Draw'; hint = 'The wall ran out'
  } else if (offer) {
    mood = 'mine'; badge = windChar(offer.from)
    title.append(`${NAMES[offer.from]} ${offer.robbing ? 'adds to a pong' : 'threw away'}`, mini(offer.tile))
    hint = offer.robbing ? 'Rob the kong, or pass' : 'Take it, or pass'
  } else if (mustDiscard) {
    mood = 'mine'; badge = windChar(HUMAN); title.textContent = 'Your turn'
    hint = touchScreen.matches ? 'Tap a tile, then tap it again to throw it' : 'Tap a tile to throw it away'
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
  const hintEl = el('div', 'status-hint', hint)
  if (online && !online.connected) hintEl.textContent = 'Connection lost — reconnecting…'
  else if (online && (offer || mustDiscard)) { hintEl.dataset.base = hint; showCountdown(hintEl) }
  text.append(title, hintEl)
  pill.append(el('div', 'status-badge', badge), text)
  s.appendChild(pill)
  return s
}

// Online, the room plays for you when your time is up: count it down beside the hint.
function showCountdown(hintEl: HTMLElement) {
  const deadline = online?.view?.deadline
  if (!deadline || !hintEl.dataset.base) return
  const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
  hintEl.textContent = `${hintEl.dataset.base} · ${secs}s`
  hintEl.classList.toggle('hurry', secs <= 5)
}
setInterval(() => document.querySelectorAll<HTMLElement>('.status-hint[data-base]').forEach(showCountdown), 500)

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
    const stack = height === 2 ? box('down2', 1, 1.34, 1.1) : height === 1 ? box('down1', 1, 1.34, 0.55) : el('div', 'stack-gap')
    stack.dataset.stack = String(k)                    // motion.ts flies tiles taken from it to whoever drew them
    stack.dataset.height = String(height)
    row.appendChild(stack)
  }
  return row
}

// How many of a player's tiles to show: during the deal, only those handed out so far.
// (Online, the others' hands aren't sent — only how many tiles they hold.)
const handCount = (seat: number) => {
  const held = online?.view && seat !== HUMAN && !game.over ? online.view.handCounts[seat] : game.hands[seat].length
  return intro && intro.phase !== 'flowers' ? Math.min(intro.shown[seat], held) : held
}
// Flowers stay hidden during the opening until that player's turn to reveal them.
const flowersVisible = (seat: number) => !intro || intro.flowersShown[seat]

// One side of the table, laid out as if it were the bottom edge, then rotated into place.
// Edge → centre: rack (hand, exposed melds, bonus tiles), then the wall; the player's name, score
// and seat wind are printed on the felt just inside it.
function sideLayer(seat: number): HTMLElement {
  const layer = el('div', 'layer')
  layer.dataset.seat = String(seat)
  layer.style.transform = `rotate(${-90 * seat}deg)`   // seats go counter-clockwise: right, top, left

  // Lights up on that player's turn.
  let labelCls = 'wind-label'
  if (seat === game.winner) labelCls += ' winner'
  else if (!game.over && seat === game.current) labelCls += ' active'
  const label = el('div', labelCls)
  const w = seatWind(game, seat)
  label.append(
    el('div', 'wl-name', `${NAMES[seat]} · ${points(match.scores[seat])}`),
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
    const hidden = isConcealedKong(game, seat, meld)   // declared from the hand: its end tiles lie face down
    meld.forEach((t, i) => g.appendChild(tag(hidden && (i === 0 || i === 3) ? box('up', 1.15, 1.54, 0.8, 'facedown') : lyingTile(t), t, `meld-${seat}`)))
    rack.appendChild(g)
  }
  if (game.bonus[seat].length && flowersVisible(seat)) {
    const g = el('div', 'group')
    for (const t of game.bonus[seat]) g.appendChild(tag(lyingTile(t, 'bonus'), t, `bonus-${seat}`))
    rack.appendChild(g)
  }

  layer.append(rack, wallRow(seat))
  return layer
}

// All discards, pooled in the middle of the table in the order they were thrown, facing you.
function discardPool(): HTMLElement {
  const p = el('div', 'pool')
  pool.forEach((t, i) => p.appendChild(tag(box('up', 1.02, 1.37, 0.7, lastDiscard !== null && i === pool.length - 1 ? 'latest' : '', t), t, 'pool')))
  return p
}

// The button that moves the match on once a hand is over.
// Online the next hand starts once everyone has pressed it.
const continueButton = () => {
  if (match.over) return button('Final results', showStandings, 'act primary')
  if (!online) return button('Next hand', nextHand, 'act primary')
  const people = online.room?.seats.filter(x => x.person && x.connected).length ?? 1
  const ready = online.view?.readyCount ?? 0
  const pressed = pressedNext === match.hand
  const b = button(pressed ? `Waiting for others… (${ready}/${people})` : 'Next hand', () => {
    pressedNext = match.hand
    online?.send({ type: 'ready' })
    refresh()
  }, 'act primary')
  if (pressed) (b as HTMLButtonElement).disabled = true
  return b
}
let pressedNext = 0                       // online: the hand after which you pressed "Next hand"

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
  const input = progressInput(game, HUMAN)
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
        const f = faanOf(HUMAN, [...hand, t], false, false)
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
  const { lost, ruined, gained } = claimEffects(progressInput(game, HUMAN), kind, tile, run)
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
  head.append(el('span', '', `${NAMES[o.from]} ${o.robbing ? 'is adding to a pong to make a kong:' : 'threw away'}`), tileEl(o.tile, 'claim-tile'))
  const opts = el('div', 'claim-options')
  if (o.win) opts.appendChild(claimButton('Mahjong!', o.robbing
    ? 'Rob the kong — this tile completes your hand, you win!'
    : 'This tile completes your hand — you win!', () => humanClaim('win'), 'win'))
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
  opts.appendChild(claimButton('Pass', o.robbing ? 'Let them make the kong' : "Don't take it", humanPass, 'pass'))
  card.append(head, opts)
  return card
}

// On touch screens a tap only lifts a tile; tapping the lifted tile throws it away, so one stray tap
// doesn't cost you a tile. With a mouse, a click throws it straight away.
const touchScreen = matchMedia('(pointer: coarse)')
let lifted: Tile | null = null
function tapTile(t: Tile, e: HTMLElement) {
  if (touchScreen.matches && lifted !== t) {
    lifted = t
    e.parentElement?.querySelector('.lifted')?.classList.remove('lifted')
    e.classList.add('lifted')
    return
  }
  lifted = null
  humanDiscard(t)
}

// Your hand on the big rack: sorted, with the freshly drawn tile set apart on the right.
function playerRack(): HTMLElement {
  const rack = el('div', 'player-rack' + (game.winner === HUMAN ? ' winner' : ''))
  const canDiscard = !game.over && mustDiscard && !offer
  const drawn = canDiscard ? game.drawn : null
  if (!canDiscard) lifted = null
  // mid-deal your tiles arrive in batches and sit in the order dealt; once dealt you sort them
  const tiles = intro && intro.phase !== 'flowers'
    ? game.hands[HUMAN].slice(0, handCount(HUMAN))
    : sortHand(game.hands[HUMAN].filter(t => t !== drawn))
  const add = (t: Tile, cls = '') => {
    const e = tag(tileEl(t, cls + (t === lifted ? ' lifted' : '')), t, 'rack-0')
    if (canDiscard) { e.classList.add('clickable'); e.onclick = () => tapTile(t, e) }
    rack.appendChild(e)
  }
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
  winningTiles(concealed, game.melds[HUMAN].length).filter(t => faanOf(HUMAN, [...concealed, t], true, false) >= match.minFaan)

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
    s.append(para(offer.robbing
      ? `${NAMES[offer.from]} is adding a tile to their pong — and that tile would finish your hand! Press Mahjong! to rob the kong, or Pass.`
      : `${NAMES[offer.from]} threw away a tile you can use. Choose a big button in the box, or press Pass.`))
  } else if (mustDiscard) {
    s.append(para(touchScreen.matches
      ? 'Your turn. You have one tile too many — tap a tile in your hand to lift it, then tap it again to throw it away.'
      : 'Your turn. You have one tile too many — tap a tile in your hand to throw it away.'))
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
  const { base, plans } = planToMinimum(progressInput(game, HUMAN), match.minFaan)
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
    para('Everyone starts with the same points (',
      el('strong', '', inGame ? fmt(match.startPoints) : '1,000, 2,000 or 5,000'),
      '). If anyone drops below zero, the game ends early. The dealer (East) keeps the deal after winning or a draw; otherwise it passes on.'))
  return s
}

function toggleHelp() {
  helpOpen = !helpOpen
  try { localStorage.setItem(HELP_KEY, helpOpen ? '1' : '0') } catch { /* storage unavailable — keep it in memory */ }
  render()
}

function render() {
  inMenu = false
  motion.capture(app)                                 // where every tile is now, to glide them after the rebuild
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
  motion.play(app, motionHooks)
  music.start()                                      // carries on (or resumes, e.g. via Continue game)
  if (!coachOpen && !paused) music.duck(game.over && !resultClosed)   // quieter while the result card is showing
  if (celebrate) { celebrate = false; main.appendChild(confetti()) }
  for (const b of banners) showBanner(b, scene)
  banners = []
  saveMatch()
  if (!paused) wakeWaiters()                         // back at the table: a paused deal or bot turn carries on
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
  t.append(el('span', 'st-head'), el('span', 'st-head', 'This hand'), el('span', 'st-head', 'Total'))
  for (const p of standings()) {
    const d = deltas[p]
    t.append(
      el('span', 'st-name' + (p === HUMAN ? ' you' : ''), NAMES[p]),
      el('span', 'st-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : ''), d === 0 ? '—' : signed(d)),
      el('span', 'st-total' + (match.scores[p] < 0 ? ' bust' : ''), points(match.scores[p])),
    )
  }
  return t
}

// "Who pays, and why": the payment rule that applied this hand in one sentence, then each player's
// share with the reason — so a minus score never comes as a surprise.
function paymentBox(r: HandResult, w: number): HTMLElement {
  const who = (p: number) => (p === HUMAN ? 'You' : NAMES[p])
  const pays = (p: number) => (p === HUMAN ? 'you pay' : `${NAMES[p]} pays`)
  const points = payout(r.faan)
  const worth = `${r.faan} faan is worth ${fmt(points)} points.`
  let rule: string
  if (r.from === null) {
    rule = `${worth} ${who(w)} drew the winning tile from the wall, so nobody gave it away — the other three share the cost and each pay half (${fmt(points / 2)}).`
  } else if (wonByRobbing()) {
    rule = `${worth} ${who(w)} robbed ${possessive(r.from)} kong: the tile added to the pong finished the hand. That counts like throwing away the winning tile, so ${pays(r.from)} the full ${fmt(points)} and the others pay nothing.`
  } else {
    rule = `${worth} ${who(r.from)} threw away the winning tile, so ${pays(r.from)} the full ${fmt(points)} — the others pay nothing.`
  }

  const box = el('div', 'pay-box')
  box.append(el('h4', '', 'Who pays, and why'), el('p', 'pay-rule', rule))
  const rows = el('div', 'pay-rows')
  for (const p of [w, ...[1, 2, 3].map(k => (w + k) % 4)]) {
    const d = r.deltas[p]
    let why: string
    const lower = (q: number) => (q === HUMAN ? 'you' : NAMES[q])
    if (p === w) why = r.from === null ? 'won — collected half from each of the other three' : `won — collected it all from ${lower(r.from)}`
    else if (r.from === null) why = `paid half to ${lower(w)}`
    else if (p === r.from) why = wonByRobbing() ? 'paid it all — the kong was robbed' : 'paid it all — threw away the winning tile'
    else why = 'paid nothing — didn’t throw the winning tile'
    rows.append(
      el('span', 'pay-name' + (p === HUMAN ? ' you' : ''), who(p)),
      el('span', 'pay-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : ''), d === 0 ? '0' : signed(d)),
      el('span', 'pay-why', why),
    )
  }
  box.appendChild(rows)
  return box
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
      : wonByRobbing() ? `Robbed ${possessive(r.from)} kong — the tile they added completed the hand`
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
    faan.appendChild(el('div', 'paid', `${r.faan} faan = ${fmt(payout(r.faan))} points`))
    cols.appendChild(faan)
  }
  const scores = el('div', 'score-box')
  scores.append(el('h4', '', 'Scores'), scoreTable(r.deltas))
  cols.appendChild(scores)
  card.appendChild(cols)
  if (w !== null) card.appendChild(paymentBox(r, w))

  // what happens next
  let next: string
  if (match.bust !== null) next = `${match.bust === HUMAN ? 'You have' : `${NAMES[match.bust]} has`} run out of points — the game ends here.`
  else if (match.over) next = 'That was the last hand of the game.'
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
    const gain = match.scores[p] - match.startPoints
    row.append(el('span', 'place', places[i]), el('span', 'who', NAMES[p]),
      el('span', 'pts', `${points(match.scores[p])} pts`), el('span', 'gain ' + (gain > 0 ? 'up' : gain < 0 ? 'down' : ''), `(${signed(gain)})`))
    list.appendChild(row)
  })
  const ended = match.bust === null ? '' : ` — ${match.bust === HUMAN ? 'you' : NAMES[match.bust]} ran out of points, so the game ended early`
  card.append(list, el('div', 'result-next', `${match.hand} hands played${ended}. Everyone started with ${fmt(match.startPoints)}.`))
  const actions = el('div', 'result-actions')
  if (online) {                                        // the host starts the next game; everyone else waits
    const host = online.room?.seats[online.seat ?? -1]?.host
    if (host) actions.append(button('Play again', () => online?.start(settings), 'act primary'))
    else actions.append(el('div', 'result-next', 'The host can start another game.'))
    actions.append(button('Leave room', leaveOnline, 'act'))
  } else {
    actions.append(button('Play again', startMatch, 'act primary'), button('Main menu', renderMenu, 'act'))
  }
  actions.append(button('See the table', () => { resultClosed = true; render() }, 'act'))
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

// ---------- Saving the match ----------
// After every redraw the match is saved in this browser, so a refresh or a closed tab doesn't lose
// it: the menu then offers "Continue game", which picks up exactly where play stopped. The game
// state is plain data; what needs care is restarting play, which only ever waits at a few points —
// a bot about to move (or just after a claim), your move or claim, the deal, or the result card.

const SAVE_KEY = 'mahjong-save-v2'
const OLD_SAVE_KEY = 'mahjong-save-v1'               // before table.ts: converted on load, then removed
let resumeSaved: (() => void) | null = null          // restarts play after a saved match is loaded

// The table's own state, plus how the screen was showing it.
interface Saved { table: TableData; wallBreak: number; resultClosed: boolean; showFinal: boolean }

function saveMatch() {
  if (!started || online) return                     // an online game is kept by the room
  const s: Saved = { table: table.toData(), wallBreak, resultClosed, showFinal }
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)) } catch { /* storage full or unavailable — play on unsaved */ }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(OLD_SAVE_KEY) } catch { /* nothing saved */ }
}

// A match saved by the version before table.ts: the same game state, with "what happens next" kept
// separately. Turn that into the table's phase.
type OldNext = { kind: 'intro' } | { kind: 'over' } | { kind: 'you' } | { kind: 'bot'; seat: number; draw: Draw }
interface OldSaved {
  match: Match; game: GameState; pool: Tile[]; wallBreak: number; lastDiscard: number | null; winFrom: number | null
  winTileAt: number; drawnAt: number; offer: Offer | null; resultClosed: boolean; showFinal: boolean; next: OldNext
}
function fromOldSave(o: OldSaved): Saved {
  const n = o.next
  const phase: Phase = n.kind === 'intro' ? { kind: 'dealing' }
    : n.kind === 'over' ? { kind: 'over' }
    : n.kind === 'bot' ? { kind: 'next', seat: n.seat, draw: n.draw }
    : o.offer ? { kind: 'claims', from: o.offer.from, tile: o.offer.tile, robbing: !!o.offer.robbing,
      offers: [o.offer, null, null, null], answers: [null, null, null, null] }
    : { kind: 'turn', seat: HUMAN }
  return {
    table: { match: o.match, game: o.game, pool: o.pool, lastDiscard: o.lastDiscard, winFrom: o.winFrom,
      winTileAt: o.winTileAt, drawnAt: o.drawnAt, phase, humans: SEAT_IS_PERSON },
    wallBreak: o.wallBreak, resultClosed: o.resultClosed, showFinal: o.showFinal,
  }
}

// Load a match still being played, if one was saved. Returns whether there was one.
function loadMatch(): boolean {
  let s: Saved | null = null
  try {
    s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null')
    const old: OldSaved | null = s ? null : JSON.parse(localStorage.getItem(OLD_SAVE_KEY) ?? 'null')
    if (old?.match && old.game?.hands && old.next) {         // keep it in the new format from now on
      s = fromOldSave(old)
      localStorage.setItem(SAVE_KEY, JSON.stringify(s))
      localStorage.removeItem(OLD_SAVE_KEY)
    }
  } catch { s = null }
  if (!s?.table?.match || !s.table.game?.hands || s.table.match.over) { clearSave(); return false }
  table = Table.fromData(s.table)
  sync()
  wallBreak = s.wallBreak; resultClosed = s.resultClosed; showFinal = s.showFinal
  started = true
  resumeSaved = () => {
    if (table.phase.kind === 'dealing') void runIntro()   // the tiles are already dealt; show the deal again
    else void drive()                                     // carries on, or simply waits for you
  }
  return true
}

// "Continue game" on the menu: back to the table, restarting play if the match was just loaded.
function continueGame() {
  render()
  const resume = resumeSaved
  resumeSaved = null
  resume?.()
}

loadMatch()
// opened from an invite link (…?room=K7Q2M): straight to joining that room
const invited = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? ''
if (ROOM_SERVER && ROOM_CODE.test(invited)) {
  inviteCode = invited
  history.replaceState(null, '', location.pathname)
  renderOnlineHome()
} else {
  renderMenu()
}
