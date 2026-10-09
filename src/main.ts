import './style.css'
import {
  type Tile, type GameState, type ClaimKind, SEATS, sortHand, makeTile, isWinningHand,
  kongOptions, winningTiles, parse, seatWind, handProgress, planToMinimum, canWinOn, payout,
  claimEffects, progressInput, isConcealedKong, type BotLevel,
} from './engine'
import { tileName } from './tiles'
import { rulesSections } from './rules-guide'
import { resultCard, finalCard, wonByRobbingIn, winsOf, type ResultContext } from './result-cards'
import { TIPS, type CoachStep, type Steps } from './tips'
import { mahjongBurst, turnGlow, notice } from './fx'
import { emote, emoteArt } from './emotes'
import { faanCard, headlinePlan, planSummary } from './faan-card'
import { initInstall, installButton } from './install'
import { el, tag, tileEl, ICONS, MENU_ICONS, soundButtons, chip, mini, button, box, phoneScreen, tileScale, lyingTile, para, uniqueTiles, score, fmt, pageTitle } from './ui'
import { sfx, music } from './sfx'
import * as motion from './motion'
import { Table, type Match, type Rules, type Style, type Offer, type TableData, type Phase, type Draw, type TableEvent } from './table'
import { track } from './stats'
import { renderFeedbackPage, quickRating } from './feedback-page'
import { OnlineRoom, ROOM_SERVER, ROOM_CODE, REACTIONS, PHRASES, TURN_MS, FAMILY_MIN_FAAN, RULE_CHOICES, isFamilyMinFaan, newRoomCode, savedSession, leaveSavedRoom, type LocalView, type SeatInfo } from './online'
import { myClips, playClip, CALL_SLOTS, type VoiceSlot } from './voice'
import { renderVoicePage } from './voice-page'

// Players sit in fixed places: you at the bottom, then counter-clockwise (the turn order)
// Mei on your right, Kai across, Lin on your left. Seat winds move as the deal passes round.
const HUMAN = 0
declare const __APP_VERSION__: string        // filled in at build time (vite.config.ts)
const BOT_NAMES = ['You', 'Mei', 'Kai', 'Lin']
let NAMES = BOT_NAMES                     // online: the room's players, turned round so you're first
const WIND_CHARS = ['東', '南', '西', '北']
const possessive = (p: number) => (p === HUMAN ? 'your' : `${NAMES[p]}’s`)

// ---------- The match ----------
// The rules of play — the turn flow, claims, scoring, the match moving on — live in table.ts; this
// file shows the table and plays the bots' moves at a pace you can follow.

// What the players agree before a game; remembered for next time.
// (`minFaan` is Hong Kong style's minimum, `familyMinFaan` Family style's — each kept for next time.)
interface Settings { rounds: number; minFaan: number; tips: boolean; startPoints: number; bots: BotLevel; style: Style; familyMinFaan: number }
const SETTINGS_KEY = 'mahjong-settings'
const DEFAULT_SETTINGS: Settings = { rounds: 1, minFaan: 1, tips: true, startPoints: 1000, bots: 'normal', style: 'hk', familyMinFaan: 1 }
// Remembered settings, each checked against what the game offers now (RULE_CHOICES): one left over
// from an older version, or garbled, falls back to its default rather than leaving a question with
// nothing picked (or a room the server refuses).
function cleanSettings(saved: unknown): Settings {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof Settings, unknown>>
  const d = DEFAULT_SETTINGS
  const pick = <T>(list: readonly T[], x: unknown, fallback: T): T => (list.includes(x as T) ? x as T : fallback)
  return {
    rounds: pick(RULE_CHOICES.rounds, s.rounds, d.rounds),
    minFaan: pick(RULE_CHOICES.minFaan, s.minFaan, d.minFaan),
    startPoints: pick(RULE_CHOICES.startPoints, s.startPoints, d.startPoints),
    bots: pick(RULE_CHOICES.bots, s.bots, d.bots),
    style: pick(RULE_CHOICES.style, s.style, d.style),
    familyMinFaan: isFamilyMinFaan(s.familyMinFaan) ? s.familyMinFaan : d.familyMinFaan,
    tips: typeof s.tips === 'boolean' ? s.tips : d.tips,
  }
}
let settings: Settings = (() => {
  try { return cleanSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')) } catch { return cleanSettings({}) }
})()
// The rules for a new game, from the settings: the minimum faan of the chosen style.
const rulesNow = (bots: BotLevel = settings.bots): Rules => ({
  rounds: settings.rounds, startPoints: settings.startPoints, bots, style: settings.style,
  minFaan: settings.style === 'family' ? settings.familyMinFaan : settings.minFaan,
})
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* storage unavailable — keep it in memory */ }
}

// You play seat 0; the other three are bots.
const SEAT_IS_PERSON = [true, false, false, false]
let table = new Table(rulesNow(), SEAT_IS_PERSON)

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
// A win is revealed before the result card: a "Mahjong!" burst, the winner's tiles lit up on the
// table, then (REVEAL_MS later) the card.
const REVEAL_MS = 2200
let revealUntil = 0               // performance.now() until which the result card waits
let scoreRevealAt = 0             // when the result card first showed, for its score reveal (-Infinity: skipped)
let scoreRevealFor = ''           // …and which hand's result that was
let burst: number | null = null   // a winner whose burst is still to be shown
let revealTimer = 0
const revealing = () => game.over && performance.now() < revealUntil
let faanCardOpen = false          // the "Your hand" details card, tapped open (it also opens on hover)
// a tap anywhere else puts the "Your hand" card away (the pill and "Way to" chip toggle it themselves)
document.addEventListener('pointerdown', e => {
  if (!faanCardOpen || (e.target as Element).closest?.('.hm-total-wrap, .hm-way')) return
  faanCardOpen = false
  document.querySelector('.hm-total-wrap.open')?.classList.remove('open')   // no redraw, so the tap itself still lands
}, true)
// With a mouse the card also opens on pointing at the pill — but only when the mouse really moves onto
// it. When the page changes under a still pointer (the claim box closing after you press Pong), the
// pill arrives under the pointer and must not pop its card open by itself.
let faanPointed = false
let lastPointer = ''
document.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return
  const at = `${e.clientX},${e.clientY}`
  if (at === lastPointer) return                   // (the browser repeating a still pointer after a redraw)
  lastPointer = at
  const over = !!(e.target as Element).closest?.('.hm-total-wrap')
  if (over === faanPointed) return
  faanPointed = over
  document.querySelector('.hm-total-wrap')?.classList.toggle('pointed', over)
}, true)
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
  const away = !!online?.away || !!online?.joining     // (online, away or just arrived: a bot is playing your seat)
  mustDiscard = p.kind === 'turn' && p.seat === HUMAN && !away
  offer = p.kind === 'claims' && !p.answers[HUMAN] && !away ? p.offers[HUMAN] : null
}

// Turn the table's events (or, online, the room's) into sounds and banners.
function playEvents(events: TableEvent[] = table.takeEvents()) {
  for (const e of events) {
    if (e.type === 'draw') sfx.draw(e.seat !== HUMAN)
    else if (e.type === 'flowers') announceFlowers(e.seat, e.tiles)
    else if (e.type === 'discard') { sfx.discard(); if (e.seat !== HUMAN) explainShortWin(e.tile) }
    else if (e.type === 'call') announceCall(e.seat, e.kind, e.meld)
    else if (e.type === 'yourTurn' && e.seat === HUMAN) { banners.push({ text: 'Your turn', kind: 'turn', seat: null }); sfx.yourTurn(); explainShortWin(null) }
    else if (e.type === 'win') { burst = e.seat; revealUntil = performance.now() + REVEAL_MS; sayOrPlay('win', e.seat, () => sfx.win(), () => sfx.win(false)) }
  }
  sync()
}

// A finished hand that doesn't reach the game's minimum faan can't be declared — say so, rather than
// leave the player wondering why there's no Mahjong! button. `tile`: someone's discard (null: the
// tile you just drew). Once per hand for each tile.
let explained = ''
function explainShortWin(tile: Tile | null) {
  const g = table.game, min = table.match.minFaan, hand = g.hands[HUMAN]
  const complete = tile ? canWinOn(g, HUMAN, tile) : isWinningHand(hand, g.melds[HUMAN].length)
  if (!complete || g.over) return
  const faan = table.faanOf(HUMAN, tile ? [...hand, tile] : hand, !tile)
  const key = `${gen}:${match.hand}:${tile ? tile.category + tile.value : 'own'}`
  if (faan >= min || explained.includes(key)) return
  explained += key + ';'
  const what = tile ? `That ${tileName(tile.category, tile.value)} would finish your hand` : 'Your hand is complete'
  notice(`${what}, but it only scores ${faan} faan — this game needs ${min} to win. Keep going for a bigger hand!`)
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

// A player's own recorded voice for a call, if they made one: online, anyone at the table; against the
// bots, just yours.
function voiceClip(seat: number, slot: VoiceSlot) {
  return online ? online.clipFor(seat, slot) : seat === HUMAN ? myClips()[slot] : undefined
}
// Their own voice with the chime (`withVoice`), or the game's voice (`plain`).
function sayOrPlay(slot: VoiceSlot, seat: number, plain: () => void, withVoice: () => void) {
  const clip = voiceClip(seat, slot)
  if (!clip) return plain()
  withVoice()
  void playClip(clip)
}

// Someone called pong/chow/kong: say it, and pop up a banner on their side showing the set.
function announceCall(seat: number, kind: ClaimKind, meld: Tile[]) {
  sayOrPlay(kind, seat, () => sfx.call(CALL_WORDS[kind]), () => sfx.call(CALL_WORDS[kind], false))
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
        if (taker !== HUMAN) await coach('bot-call', TIPS.botCall(NAMES[taker]))   // first time only
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
  table = new Table(rulesNow(), SEAT_IS_PERSON)
  sync()
  const room = new OnlineRoom(code, name)
  online = room
  let seatsBefore: SeatInfo[] | null = null
  room.onRoom = () => {
    if (room.room) { announceSeatChanges(seatsBefore, room.room.seats, room.room.you, room.room.started); seatsBefore = room.room.seats }
    NAMES = room.names()
    if (!room.room?.started || !room.view) { if (lobbyShowing()) renderLobby() }
    else { sync(); refresh() }                         // someone left, came back or went away: their name on the table
  }
  room.onState = (view, events) => applyOnline(view, events)
  room.onError = message => { onlineError = message; if (lobbyShowing()) renderLobby(); else refresh() }
  room.onConnection = () => { if (lobbyShowing()) renderLobby(); else refresh() }
  room.onReact = (seat, emoji) => { if (!lobbyShowing()) showReaction(seat, emoji) }
  room.onClosed = host => {                           // the host left: back to the menu, saying why
    leaveRoom(false)
    void dialog('The room has closed', `${host} (the host) left the room, so the game has ended.`, [{ label: 'OK', value: true, cls: 'primary' }])
  }
  room.connect()
  renderLobby()
  setTimeout(() => { if (online === room && !room.everConnected && lobbyShowing()) renderLobby() }, CANT_CONNECT_MS + 100)
}
const CANT_CONNECT_MS = 8000                    // how long "Connecting…" shows before the advice on why it might not

// Online: tell everyone at the table when someone leaves, comes back or joins, and what happens next.
function announceSeatChanges(before: SeatInfo[] | null, now: SeatInfo[], you: number | null, started: boolean) {
  if (!before || !started) return                    // (in the room before the game, the player list shows it)
  now.forEach((s, i) => {
    const was = before[i]
    if (i === you) return
    if (was.person && was.connected && (!s.person || !s.connected)) notice(`${was.name} left — a bot plays their seat until they’re back`)
    else if (s.person && s.connected && was.person && !was.connected && was.name === s.name) notice(`${s.name} is back`)
    else if (s.person && !was.person) notice(s.joining ? `${s.name} joined — they play from the next hand` : `${s.name} joined`)
  })
}

function leaveOnline() { leaveRoom(true) }
// `tellRoom`: you pressed Leave (false: the room has already closed)
function leaveRoom(tellRoom: boolean) {
  online?.leave(tellRoom)
  online = null
  NAMES = BOT_NAMES
  onlineDeal = ''
  intro = null
  gen++
  if (!loadMatch()) { table = new Table(rulesNow(), SEAT_IS_PERSON); sync() }   // back to your game against the bots, if any
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
    banners = []; resultClosed = false; showFinal = false
    inMenu = false
    void runIntro()
    return
  }
  // play has begun while this screen was still showing the deal (a slow or backgrounded tab): the room
  // doesn't wait, so drop the rest of the deal and show the table as it is now
  if (intro && view.phase.kind !== 'dealing') { gen++; intro = null }
  playEvents(events)
  buzzIfWaitingOnYou()
  if (game.over && !resultClosed && events.some(e => e.type === 'win' || e.type === 'exhausted')) showFinal = false
  // the host ended the game: straight to the final scores (also when reconnecting afterwards)
  if (view.match.endedAfter !== undefined && (!showFinal || events.some(e => e.type === 'ended'))) {
    showFinal = true; resultClosed = false; banners = []
  }
  if (inMenu && !intro) { inMenu = false; render() }
  else if (!intro) refresh()
}

// Online, the table waiting on you (your turn, or a tile you could take): a short buzz on phones
// that can, and — if you're on another tab — the tab's title flashes until you come back. Once per
// thing you're asked to do.
let buzzedFor = ''
function buzzIfWaitingOnYou() {
  const key = mustDiscard ? `turn:${game.wall.length}:${pool.length}` : offer ? `offer:${offer.tile.id}:${pool.length}` : ''
  if (key === buzzedFor) return
  buzzedFor = key
  if (!key) return
  try { navigator.vibrate?.(mustDiscard ? 120 : [70, 60, 70]) } catch { /* not allowed here */ }
  if (document.hidden) flashTitle(mustDiscard ? '🀄 Your turn!' : '🀄 Take this tile?')
}
const GAME_TITLE = document.title
let titleTimer = 0
function flashTitle(text: string) {
  clearInterval(titleTimer)
  let on = false
  titleTimer = window.setInterval(() => { on = !on; document.title = on ? text : GAME_TITLE }, 1000)
  document.title = text
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { clearInterval(titleTimer); document.title = GAME_TITLE }
})

// `bots`: how well they play; the guided game always has easy ones, whatever's chosen for New game.
function startMatch(bots: BotLevel = settings.bots) {
  if (online) { online.leave(); online = null; NAMES = BOT_NAMES }   // a game against the bots instead
  music.start()                                       // the Start click is the gesture browsers want before playing audio
  saveSettings()
  table = new Table(rulesNow(bots), SEAT_IS_PERSON)
  started = true
  finishCounted = false
  track('bot-game')
  nextHand()
}

// Deal the next hand of the match: roll the dice, deal the tiles out, reveal flowers, then the
// dealer draws first.
function nextHand() {
  gen++
  table.newHand()
  sync()
  banners = []; resultClosed = false; showFinal = false
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

let finishCounted = false                 // this game against the bots has been counted as played to the end
function showStandings() {
  if (!online && !finishCounted && match.endedAfter === undefined) { finishCounted = true; track('bot-game-done') }
  showFinal = true
  resultClosed = false
  render()
}

// ---------- Beginner tips (coachmarks) ----------
// The first time each situation comes up, the game pauses, dims the screen around the part that
// matters, and explains it in a small card. Each tip shows once (remembered across visits); the
// "Learn to play" menu entry resets them for a fully guided game.
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
// `onEscape`: what the Escape key chooses (the first option, unless given)
function dialog<T>(title: string, text: string, options: { label: string; value: T; cls: string }[], onEscape: T = options[0].value): Promise<T> {
  return new Promise(resolve => {
    const layer = el('div', 'coach-layer dim dialog-layer')
    const card = el('div', 'dialog-card')
    const actions = el('div', 'dialog-actions')
    const close = (v: T) => { document.removeEventListener('keydown', onKey); layer.remove(); resolve(v) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(onEscape) } }
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
    const room = online.room
    const youHost = !!room?.seats[online.seat ?? -1]?.host
    const hostName = room?.seats.find(s => s.host)?.name ?? 'The host'
    const choice = youHost
      ? await dialog('Finished playing?', match.over
        ? 'Leaving closes the room, and everyone goes back to the main menu.'
        : 'End the game now and everyone sees the final scores — the room stays open to play again. Leaving closes the room for everyone.', [
        { label: 'Keep playing', value: 'stay', cls: 'primary' },
        ...(match.over ? [] : [{ label: 'End game for everyone', value: 'end', cls: '' }]),
        { label: 'Leave room', value: 'leave', cls: 'danger' },
      ])
      : await dialog('Leave the room?', `The game carries on without you — a bot plays your seat. To come back, use the code ${online.code}.` +
        (match.over ? '' : ` (Want to stop for everyone? ${hostName} can end the game from their menu.)`), [
        { label: 'Stay', value: 'stay', cls: 'primary' },
        { label: 'Leave room', value: 'leave', cls: 'danger' },
      ])
    if (choice === 'end' && (await confirmEnd()) && !match.over) online?.endGame()
    if (choice === 'leave') leaveOnline()
    return
  }
  paused = true
  music.duck(true)
  const where = `${SEATS[match.roundWind]} round · Hand ${match.hand} · ${match.style === 'family' ? 'Your wins' : 'Your score'} ${standingText(HUMAN)}`
  const choice = await dialog('Game paused', where, [
    { label: 'Keep playing', value: 'play', cls: 'primary' },
    { label: 'Main menu', value: 'menu', cls: '' },
    { label: 'End game — see scores', value: 'end', cls: 'danger' },
  ])
  if (choice === 'end' && !(await confirmEnd())) return void resumeFromPause()
  paused = false
  if (choice === 'play') return void resumeFromPause()
  if (choice === 'end') return endGameNow()
  renderMenu()                                         // the game stays paused there until you continue
}

// Stop a game against the bots now and go straight to the final scores (the hand under way doesn't count).
function endGameNow() {
  gen++                                                // stops the bot loop / deal for good
  intro = null
  wakeWaiters()
  document.querySelectorAll('.banner, .ghost-tile').forEach(e => e.remove())
  table.endMatch()
  table.takeEvents()
  sync()
  clearSave()
  inMenu = false
  showStandings()
}
function resumeFromPause() { paused = false; render() }

function confirmEnd(): Promise<boolean> {
  return dialog('End the game now?', match.style === 'family'
    ? 'The hand being played won’t count. The final standings are the hands won so far.'
    : 'The hand being played won’t count. The final scores are everyone’s points so far.', [
    { label: 'No, keep playing', value: false, cls: 'primary' },
    { label: 'Yes, end it', value: true, cls: 'danger' },
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
initInstall(() => { if (app.querySelector('.menu-page')) renderMenu() })   // only the main menu itself (not the invite or setup screens)


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
  if (game.over && !resultClosed && !showFinal) return revealing() ? undefined : coach('result', TIPS.result)   // (after the reveal)
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
  startMatch('easy')
}


// ---------- Rendering ----------


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


// The title area: a fan of tiles over the name, with 麻雀 (the game's Cantonese name) beneath.
function menuHero(): HTMLElement {
  const hero = el('div', 'menu-hero')
  const fan = el('div', 'tile-fan')
  for (const spec of ['1p', '5z', '6z', '1s', '1z']) fan.appendChild(tileEl(parse(spec)[0], 'fan-tile'))
  // the name as a logo: "Pong Pong" over a bigger "Mahjong!", each word fading in after the last
  const title = el('h1', 'menu-title')
  title.setAttribute('aria-label', 'Pong Pong Mahjong!')
  const top = el('span', 'mt-line')
  top.append(el('span', 'mt-word', 'Pong'), el('span', 'mt-word', 'Pong'))
  title.append(top, el('span', 'mt-line mt-big', ''))
  title.lastElementChild!.appendChild(el('span', 'mt-word', 'Mahjong!'))
  const tagline = el('p', 'menu-tagline')
  tagline.append('Classic Hong Kong mahjong · a game of skill, played for fun')
  hero.append(fan, title, el('div', 'menu-cn', '麻雀'), tagline)
  return hero
}

function renderMenu() {
  inMenu = true
  app.innerHTML = ''
  const page = el('div', 'menu-page')
  const sound = el('div', 'menu-sound')
  sound.append(...soundButtons(renderMenu))

  // two ways to play, each under its own heading: on your own against bots (works offline), or
  // online with friends; then the rules and installing, as small buttons underneath
  const cards = el('div', 'menu-cards')
  const heading = (title: string, sub: string) => {
    const h = el('div', 'menu-section')
    h.append(el('span', 'ms-title', title), el('span', 'ms-sub', sub))
    return h
  }
  cards.appendChild(heading('Play on your own', 'Computer players · works offline'))
  if (started && !match.over) {
    cards.appendChild(menuCard(MENU_ICONS.resume, 'Continue game',
      `${SEATS[match.roundWind]} round · Hand ${match.hand} · ${match.style === 'family' ? 'Your wins' : 'Your score'} ${standingText(HUMAN)}`, continueGame, 'primary'))
  }
  const fresh = !(started && !match.over)
  cards.append(
    menuCard(MENU_ICONS.play, 'New game', 'Play at your own pace — choose the rules', renderStylePick, fresh ? 'primary' : ''),
    menuCard(MENU_ICONS.learn, 'Learn to play', 'A gentle guided game — tips explain every step', () => void startNewIfOk(startGuidedGame), 'learn',
      tipsSeen.size === 0 ? 'New to mahjong? Start here' : ''),
    heading('Play with friends', 'Online · share a room code'),
    onlineMenuCard(),
    menuCard(MENU_ICONS.voice, 'Your voice', 'Say the calls in your own voice', () => openVoicePage(renderMenu), 'voice-card'),
  )
  const extras = el('div', 'menu-extras')
  const rules = el('button', 'menu-extra')
  rules.innerHTML = MENU_ICONS.book
  rules.append(el('span', '', 'How to play'))
  rules.onclick = renderRulesPage
  const feedback = el('button', 'menu-extra')
  feedback.innerHTML = MENU_ICONS.feedback
  feedback.append(el('span', '', 'Feedback'))
  feedback.onclick = () => openFeedback(renderMenu, 'menu')
  const about = el('button', 'menu-extra')
  about.innerHTML = MENU_ICONS.about
  about.append(el('span', '', 'About'))
  about.onclick = renderAboutPage
  extras.append(rules, feedback, about)
  const install = installButton()
  if (install) extras.appendChild(install)
  // which version this is, at the very bottom of the menu
  // (a dev server started before vite.config.ts existed doesn't fill it in — say so rather than break)
  const version = typeof __APP_VERSION__ === 'string' ? `v${__APP_VERSION__}` : 'dev'
  // the logo and the small buttons share a box: on a sideways phone it's the left column, with the
  // buttons under the logo; elsewhere it melts away and the buttons come after the choices
  const side = el('div', 'menu-side')
  side.append(menuHero(), extras)
  // said plainly on the menu, so nobody has to wonder (the About page has the details)
  const promise = el('p', 'menu-promise', 'Free to play · No money, bets or prizes · No sign-up')
  page.append(side, sound, cards, promise, el('p', 'menu-version', `${version} · © 2026 Wilson Chen. All rights reserved.`))
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
  // still in a room from before (closed the tab, or left to the menu): rejoin it, or leave it and start fresh
  const session = savedSession()
  if (session) {
    return menuCard(MENU_ICONS.online, 'Play online', `You’re still in room ${session.code} — rejoin it, or start fresh`, async () => {
      const choice = await dialog(`You’re still in room ${session.code}`,
        `You left a game there as ${session.name}. Go back to it, or leave that room and start a new online game?`, [
          { label: `Rejoin room ${session.code}`, value: 'rejoin', cls: 'primary' },
          { label: 'Leave it and start fresh', value: 'fresh', cls: 'danger' },
          { label: 'Cancel', value: 'cancel', cls: '' },
        ], 'cancel')
      if (choice === 'rejoin') goOnline(session.code, session.name)
      else if (choice === 'fresh') { leaveSavedRoom(session.code); renderOnlineHome() }
    }, '', 'In a room')
  }
  return menuCard(MENU_ICONS.online, 'Play online', 'Gather friends at one table with a room code', renderOnlineHome)
}

// The full rules guide as its own page, opened from the menu.
function renderRulesPage() {
  inMenu = true
  app.innerHTML = ''
  const page = el('div', 'rules-page')
  const head = pageTitle('How to play', renderMenu, 'Back to the menu')
  const intro = el('section', 'rules-intro')
  intro.append(
    para('Mahjong is played by four players with 144 tiles. You sit at the bottom of the table; play goes round counter-clockwise — you, then Mei, Kai and Lin.'),
    para('On your turn you take a tile from the wall, then throw one away. The first to complete a winning hand calls ', el('strong', '', 'Mahjong!')),
  )
  const body = el('div', 'rules-body help')
  body.append(intro, ...rulesSections(null))
  const foot = el('div', 'rules-foot')
  foot.append(button('Try it — Learn to play', () => void startNewIfOk(startGuidedGame), 'act primary big'), button('Back to menu', renderMenu, 'act'))
  page.append(head, body, foot)
  app.appendChild(page)
  window.scrollTo(0, 0)
}

// About: first and plainly, that this is a game played for fun — no money, no bets, nothing to buy,
// no sign-up — then what it keeps and sends, why it was made, and how it's built.
function renderAboutPage() {
  inMenu = true
  app.innerHTML = ''
  const page = el('div', 'rules-page')
  const head = pageTitle('About', renderMenu, 'Back to the menu')
  const fun = el('section', 'about-promise')
  const list = el('ul')
  fun.append(el('h3', '', 'A game played for fun — never for money'), list)
  for (const line of [
    'Free to play, with nothing to buy and no ads.',
    'No real money, no betting and no prizes. Points only keep score, like on a scoresheet — or play Family style with no points at all.',
    'No sign-up or account. It never asks for passwords, card details or anything personal.',
    'No download needed: it runs in your browser. Installing it on a phone is optional.',
  ]) list.appendChild(el('li', '', line))

  const privacy = el('section')
  privacy.append(el('h3', '', 'What it keeps, and what it sends'),
    para(el('strong', '', 'On your device:'), ' your saved game and settings. Nothing else.'),
    para(el('strong', '', 'Play counts:'), ' when a game starts or ends, a count is sent with a random id for this browser — no name, no cookies — just to see how many people play.'),
    para(el('strong', '', 'Online rooms:'), ' the nickname you type and, if you record them, your Pong!, Chi!, Kong! and Mahjong! calls, shared only with the players in your room.'),
    para(el('strong', '', 'Feedback:'), ' only what you write in it (an email address is optional).'))

  const why = el('section')
  why.append(el('h3', '', 'Why it was made'),
    para('Pong Pong Mahjong! is a personal project by Wilson Chen: a way to learn how a real product is built end to end — designing it, testing it carefully (QA), listening to players’ feedback, improving it, and running it online.'),
    para('Found a bug or have an idea? Use ', el('strong', '', 'Feedback'), ' on the main menu — every message is read.'))

  const how = el('section')
  how.append(el('h3', '', 'How it’s built'),
    para('Written from scratch in TypeScript — no game engine — and it runs in any browser.'),
    para(el('strong', '', 'Any device, together:'), ' the same game runs on iPhone, Android and computers, and everyone at a table can be on a different one.'),
    para(el('strong', '', 'Online rooms'), ' run on Cloudflare: each room is its own small server that deals the tiles and checks every move, so nobody can peek at another player’s hand.'),
    para(el('strong', '', 'The bots'), ' work out how close each hand is to winning, aim for the hands that score, and throw safe tiles when someone else looks close.'),
    para(el('strong', '', 'On phones'), ' it installs like an app and plays against the bots offline.'))

  const body = el('div', 'rules-body help about-body')
  body.append(fun, privacy, why, how)
  const foot = el('div', 'rules-foot')
  foot.append(button('Back to menu', renderMenu, 'act'))
  const credit = el('p', 'credit', 'Music: “Moonlit Whispers” by kaazoom, from Pixabay.')
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

// New game, first: which style — Hong Kong (minimum faan and points) or Family (minimum faan only).
const STYLES: Record<Style, { title: string; sub: string }> = {
  hk: { title: 'Hong Kong style', sub: 'Reach the minimum faan to win, and score points: bigger hands win more' },
  family: { title: 'Family style', sub: 'No points — just reach the minimum faan to win. Choose any minimum you like' },
}
function renderStylePick() {
  inMenu = true
  app.innerHTML = ''
  const page = el('div', 'setup')
  page.append(pageTitle('New game', renderMenu, 'Back to the menu'), el('p', 'setup-intro', 'How does your table play?'))
  const cards = el('div', 'menu-cards style-cards')
  for (const style of ['hk', 'family'] as Style[]) {
    cards.appendChild(menuCard(style === 'hk' ? MENU_ICONS.points : MENU_ICONS.play, STYLES[style].title, STYLES[style].sub,
      () => { settings = { ...settings, style }; saveSettings(); renderSetup() }))
  }
  page.appendChild(cards)
  app.appendChild(page)
}

// Then agree the house rules for that style, like at a real table.
function renderSetup() {
  inMenu = true
  app.innerHTML = ''
  const card = el('div', 'setup')
  card.append(pageTitle(STYLES[settings.style].title, renderStylePick, 'Back to choosing a style'),
    el('p', 'setup-intro', 'Agree the house rules before you start — just like at a real table.'))

  ruleChoices(card, renderSetup, true)
  const actions = el('div', 'setup-actions')
  actions.append(button('‹ Back', renderStylePick, 'act'), button('Start game', () => void startNewIfOk(() => startMatch()), 'act primary big'))
  card.appendChild(actions)
  app.appendChild(card)
}

// The house rules, as rows of choices (the New game screen, and the host's in an online room).
// Choosing one updates `settings` and redraws the screen with `redraw`.
function ruleChoices(card: HTMLElement, redraw: () => void, withTips: boolean) {
  const pick = (change: Partial<Settings>) => { settings = { ...settings, ...change }; saveSettings(); redraw() }

  // (New game picks the style on its own page first; an online room asks here)
  if (!withTips) {
    card.append(el('h2', 'setup-q', 'Style'),
      choiceRow((['hk', 'family'] as Style[]).map(s => ({ value: s, label: STYLES[s].title, sub: STYLES[s].sub })), settings.style, v => pick({ style: v })))
  }

  if (settings.style === 'family') {
    card.append(el('h2', 'setup-q', 'Minimum to win'),
      el('p', 'setup-help', 'A finished hand must score at least this many faan before you can call Mahjong. There are no points — the player who wins the most hands wins the game.'),
      faanStepper(settings.familyMinFaan, v => pick({ familyMinFaan: v })))
  } else {
    card.append(el('h2', 'setup-q', 'Minimum to win'),
      el('p', 'setup-help', 'A finished hand must score at least this many faan before you can call Mahjong. Higher makes winning harder but each win worth more.'),
      choiceRow([
        { value: 0, label: 'Any hand', sub: '0 faan — every finished hand wins' },
        { value: 1, label: '1 faan', sub: 'Good for learning' },
        { value: 3, label: '3 faan', sub: 'Hong Kong standard' },
      ], settings.minFaan, v => pick({ minFaan: v })))
  }

  card.append(el('h2', 'setup-q', 'How good are the bots?'),
    el('p', 'setup-help', withTips ? 'The three players at the table with you.' : 'They take any seats your friends leave empty.'),
    choiceRow([
      { value: 'easy', label: 'Easy', sub: 'Still learning · easy to beat' },
      { value: 'normal', label: 'Normal', sub: 'Steady, but slip up now and then' },
      { value: 'hard', label: 'Hard', sub: 'Sharp · big hands, safe throws' },
    ] as { value: BotLevel; label: string; sub: string }[], settings.bots, v => pick({ bots: v })))

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

  if (settings.style === 'family') return                  // no points, so no point limit
  card.append(el('h2', 'setup-q', 'Point limit'),
    el('p', 'setup-help', 'Everyone starts at 0. Winners collect points from whoever pays; if anyone falls this far behind, the game ends early. Highest score at the end wins.'),
    choiceRow([
      { value: 1000, label: '1,000', sub: 'Lively — one big hand can end it' },
      { value: 2000, label: '2,000', sub: 'Room for a few bad hands' },
      { value: 5000, label: '5,000', sub: 'Plays to the end almost always' },
    ], settings.startPoints, v => pick({ startPoints: v })))
}

// Family style's minimum: − 3 + faan, any whole number from FAMILY_MIN_FAAN.min to .max.
function faanStepper(value: number, onPick: (v: number) => void): HTMLElement {
  const row = el('div', 'faan-stepper')
  const step = (d: number, label: string) => {
    const b = button(label, () => onPick(value + d), 'stepper-btn')
    b.setAttribute('aria-label', d < 0 ? 'Fewer faan' : 'More faan')
    b.toggleAttribute('disabled', value + d < FAMILY_MIN_FAAN.min || value + d > FAMILY_MIN_FAAN.max)
    return b
  }
  const shown = el('div', 'stepper-value')
  shown.append(el('strong', '', String(value)), el('span', '', ' faan'))
  row.append(step(-1, '−'), shown, step(1, '+'),
    el('span', 'stepper-sub', value === 0 ? 'Every finished hand wins' : `A hand needs at least ${value} faan to win`))
  return row
}

// The "Send feedback" page (feedback-page.ts); `back` redraws the screen it was opened from.
function openFeedback(back: () => void, where: string) {
  inMenu = true
  renderFeedbackPage(app, back, where)
}

// ---------- Your voice ----------

// The "Your voice" page (voice-page.ts); `back` redraws the page it was opened from. In a room, a clip
// you record or delete there goes to the others straight away.
function openVoicePage(back: () => void) {
  inMenu = true
  renderVoicePage(app, back, slot => online?.sendClip(slot))
}
// "Your voice · 2 calls recorded" — the way to it from the online pages.
function voiceLink(back: () => void): HTMLElement {
  const clips = myClips()
  const calls = CALL_SLOTS.filter(s => clips[s]).length
  const made = calls ? `${calls} call${calls === 1 ? '' : 's'} recorded` : 'Say your own Pong! — your friends hear it'
  const b = button('', () => openVoicePage(back), 'voice-link')
  b.innerHTML = MENU_ICONS.voice
  const text = el('span', 'vl-text')
  text.append(el('strong', '', 'Your voice'), el('span', '', made))
  b.append(text, el('span', 'vl-go', '›'))
  return b
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
  card.append(pageTitle('Play online', renderMenu, 'Back to the menu'),
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

  const create = button('Create a room', () => { track('room-create'); go(newRoomCode()) }, 'act primary big')
  const join = button('Join', () => {
    const code = codeInput.value.trim().toUpperCase()
    if (!ROOM_CODE.test(code)) { message.textContent = 'A room code is 5 letters and numbers, like K7Q2M.'; codeInput.focus(); return }
    track('room-join')
    go(code)
  }, 'act')
  const joinRow = el('div', 'join-row')
  joinRow.append(codeInput, join)

  card.append(el('h2', 'setup-q', 'Your name'), nameInput,
    el('h2', 'setup-q', 'Start a room'), el('p', 'setup-help', 'You’ll get a code to send to your friends.'), create,
    el('h2', 'setup-q', 'Or join one'), el('p', 'setup-help', 'Type the code a friend sent you.'), joinRow,
    message, voiceLink(renderOnlineHome))
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
  card.append(pageTitle('Your room', leaveOnline, 'Leave the room'))

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
  // never got through after a while: most often the network (or a blocker) doesn't let it reach the server
  if (!room.everConnected && Date.now() - room.since > CANT_CONNECT_MS) {
    card.appendChild(el('p', 'setup-help cant-connect', 'Still can’t reach the game server. Check your internet connection. Some Wi-Fi networks, mobile data plans, ad blockers and “Private DNS” settings block it — try switching between Wi-Fi and mobile data, or turn the blocker off for this site.'))
  }
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
    card.append(list, voiceLink(renderLobby))
    const isHost = r.you !== null && r.seats[r.you]?.host
    if (isHost) {
      ruleChoices(card, renderLobby, false)
      const actions = el('div', 'setup-actions')
      actions.append(button('Leave', leaveOnline, 'act'),
        button('Start game', () => { track('online-game'); room.start(rulesNow()) }, 'act primary big'))
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
const wonByRobbing = () => wonByRobbingIn(match)

// The players ended the game while this hand was still being played (so nobody won it).
const handStopped = () => match.endedAfter !== undefined && match.endedAfter < match.hand

// One sentence describing how the hand ended.
function resultLine(): string {
  if (game.winner === null) return handStopped() ? 'The game was ended during this hand — it doesn’t count.' : 'The wall ran out — nobody won this hand.'
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
  } else if (game.over && handStopped()) {
    mood = 'done'; badge = '–'; title.textContent = 'Game ended'; hint = 'Stopped before this hand finished'
  } else if (game.over) {
    mood = 'done'; badge = '–'; title.textContent = 'Draw'; hint = 'The wall ran out'
  } else if (online?.away) {
    badge = '🤖'; title.textContent = 'A bot is playing for you'; hint = 'Tap “I’m back” to play again'
  } else if (online?.joining) {
    badge = '👋'; title.textContent = 'You’re in!'; hint = 'Watch this hand — you play from the next one'
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
const updateNextSecs = (s: HTMLElement) => { s.textContent = `${Math.max(0, Math.ceil((Number(s.dataset.deadline) - Date.now()) / 1000))}s` }
function showCountdown(hintEl: HTMLElement) {
  const deadline = online?.view?.deadline
  if (!deadline || !hintEl.dataset.base) return
  const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
  hintEl.textContent = `${hintEl.dataset.base} · ${secs}s`
  hintEl.classList.toggle('hurry', secs <= 5)
}
setInterval(() => {
  document.querySelectorAll<HTMLElement>('.status-hint[data-base]').forEach(showCountdown)
  // the seconds beside the timer under whoever's turn it is
  for (const s of document.querySelectorAll<HTMLElement>('.turn-secs[data-deadline]')) {
    const secs = Math.max(0, Math.ceil((Number(s.dataset.deadline) - Date.now()) / 1000))
    s.textContent = String(secs)
    s.classList.toggle('hurry', secs <= 5)
  }
  document.querySelectorAll<HTMLElement>('.next-secs[data-deadline]').forEach(updateNextSecs)
  // your hand's border flashes for your last few seconds
  const mine = online?.view?.deadline
  document.querySelector('.player-rack')?.classList.toggle('hurry', !!mine && !online?.away && mine - Date.now() <= 5000)
}, 250)

// A clock ticking while your own time runs out (your turn, or deciding on a tile you could take):
// once a second from 10 seconds left, twice a second from 5, four times a second for the last 2.
let tickDeadline = 0, nextTickAt = 0, tickCount = 0
setInterval(() => {
  const deadline = online?.view?.deadline
  if (!deadline || online?.away) return
  const now = Date.now(), left = deadline - now
  if (left <= 0 || left > 10000) return
  if (deadline !== tickDeadline) { tickDeadline = deadline; nextTickAt = 0; tickCount = 0 }
  if (now < nextTickAt) return
  sfx.tick(tickCount++ % 2 === 1, left <= 5000)
  nextTickAt = now + (left <= 2000 ? 250 : left <= 5000 ? 500 : 1000)
}, 40)

// ---------- Redrawing only what changed ----------
// The screen is rebuilt on every move, but most of it is the same as before. Each part of the table
// (a player's side, the discards, the dice, your hand) is given a short description of what it shows;
// if that's unchanged since the last redraw, the old elements are put back instead of building them
// again — far less work for a phone than recreating a thousand 3D tile faces each move.
let partsBefore = new Map<string, HTMLElement>()
let partsNow = new Map<string, HTMLElement>()
function part(name: string, key: string, build: () => HTMLElement): HTMLElement {
  const old = partsBefore.get(name)
  const e = old && old.dataset.part === key ? old : build()
  e.dataset.part = key
  partsNow.set(name, e)
  return e
}
const ids = (tiles: Tile[]) => tiles.map(t => t.id ?? `${t.category}${t.value}`).join(',')

// The wall is a ring of 144 slots (72 stacks of 2, 18 stacks per side). The remaining tiles are the
// contiguous run [wallFront, wallFront + wall.length) of the original array, rotated by the break point.
// How many tiles (0–2) are left in each of a side's 18 stacks:
function wallHeights(side: number): number[] {
  let from = game.wallFront, to = game.wallFront + game.wall.length
  if (intro && intro.phase !== 'flowers') {           // mid-deal: tiles not yet handed out are still in the wall
    from = 0
    to += 52 - intro.shown.reduce((a, b) => a + b, 0)
  }
  const present = (slot: number) => { const i = (slot - wallBreak + 144) % 144; return i >= from && i < to }
  return Array.from({ length: 18 }, (_, j) => { const k = side * 18 + j; return Number(present(2 * k)) + Number(present(2 * k + 1)) })
}
function wallRow(side: number): HTMLElement {
  const row = el('div', 'wall')
  wallHeights(side).forEach((height, j) => {
    const k = side * 18 + j
    const stack = height === 2 ? box('down2', 1, 1.34, 1.1) : height === 1 ? box('down1', 1, 1.34, 0.55) : el('div', 'stack-gap')
    stack.dataset.stack = String(k)                    // motion.ts flies tiles taken from it to whoever drew them
    stack.dataset.height = String(height)
    row.appendChild(stack)
  })
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
// and seat wind are printed on the felt just inside it. The side itself stays on screen; its three
// pieces are each swapped only when they change (the name lights up every turn, the wall shrinks
// with every draw, the rack changes far less often).
function sideParts(seat: number): HTMLElement[] {
  const w = seatWind(game, seat)
  const labelKey = [NAMES[seat], match.scores[seat], winsOf(match, seat), w, seat === game.dealer, seat === game.winner, !game.over && seat === game.current, turnDeadlineOf(seat)].join(';')
  const rackKey = [
    tileScale(), seat === game.winner,
    seat === HUMAN ? '' : game.over ? ids(sortHand(game.hands[seat])) : handCount(seat),
    game.melds[seat].map(m => ids(m) + (isConcealedKong(game, seat, m) ? '*' : '')).join('|'),
    flowersVisible(seat) ? ids(game.bonus[seat]) : '',
  ].join(';')
  return [
    part(`label${seat}`, labelKey, () => sideLabel(seat)),
    part(`rack${seat}`, rackKey, () => sideRack(seat)),
    part(`wall${seat}`, wallHeights(seat).join(''), () => wallRow(seat)),
  ]
}

function sideLayer(seat: number): HTMLElement {
  const layer = el('div', 'layer')
  layer.dataset.seat = String(seat)
  layer.style.transform = `rotate(${-90 * seat}deg)`   // seats go counter-clockwise: right, top, left
  return layer
}

// The player's name, points and seat wind, printed on the felt. Lights up on their turn.
function sideLabel(seat: number): HTMLElement {
  let labelCls = 'wind-label'
  if (seat === game.winner) labelCls += ' winner'
  else if (!game.over && seat === game.current) labelCls += ' active'
  const label = el('div', labelCls)
  const w = seatWind(game, seat)
  const name = el('div', 'wl-name', `${NAMES[seat]} · ${standingText(seat)}`)
  label.append(name, el('div', 'wl-wind', `${SEATS[w]} ${WIND_CHARS[w]}${seat === game.dealer ? ' · Dealer' : ''}`))
  if (seat !== HUMAN) label.style.transform = 'rotate(180deg)'   // read from the middle of the table, like a real cloth
  // online, the time left on their turn: beside the name, not under it — the others' labels are turned
  // round, so "under" would reach into the discards in the middle
  const deadline = turnDeadlineOf(seat)
  if (deadline) name.appendChild(turnTimer(deadline))
  return label
}

// Online: when the player whose turn it is runs out of time (and the room plays for them), or null.
function turnDeadlineOf(seat: number): number | null {
  const d = online?.view?.turnDeadline
  return d && !game.over && seat === game.current ? d : null
}

// The bar under a name that shrinks as their turn's time runs out, red for the last few seconds.
// It's a CSS animation set going from where the time stands now, so nothing redraws it each second.
function turnTimer(deadline: number): HTMLElement {
  const row = el('div', 'turn-timer-row')
  const bar = el('div', 'turn-timer')
  const fill = el('div', 'turn-timer-fill')
  const secs = el('span', 'turn-secs', String(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))))
  secs.dataset.deadline = String(deadline)          // (kept up to date by the countdown above)
  const left = Math.max(0, deadline - Date.now())
  fill.style.setProperty('--from', String(Math.min(1, left / TURN_MS)))
  fill.style.setProperty('--left', `${left}ms`)
  fill.style.setProperty('--hurry-in', `${Math.max(0, left - 5000)}ms`)
  bar.appendChild(fill)
  row.append(bar, secs)
  return row
}

// The player's rack: their hand (standing, or laid face-up once the hand is over), sets and flowers.
function sideRack(seat: number): HTMLElement {
  const rack = el('div', 'rack-row' + (seat === game.winner ? ' winner' : ''))
  if (seat !== HUMAN) {                                // your own hand is on the big rack below the table
    const hand = sortHand(game.hands[seat])
    if (game.over) {                                   // at the end of the hand it's laid down face-up
      const g = el('div', 'group')
      for (const t of hand) g.appendChild(lyingTile(t, t === winTile ? 'win-tile' : ''))   // the tile that won it, lit up
      rack.appendChild(g)
    } else {                                           // otherwise it stands on edge, backs toward the table
      const n = handCount(seat)
      if (n > 0) {
        const b = box('stand', 1.15 * tileScale() * n, 0.8, 1.54 * tileScale())
        b.style.setProperty('--ts', String(tileScale()))   // for the seams between its tiles (style.css)
        rack.appendChild(b)
      }
    }
  }
  for (const meld of game.melds[seat]) {
    const g = el('div', 'group')
    const hidden = isConcealedKong(game, seat, meld)   // declared from the hand: its end tiles lie face down
    meld.forEach((t, i) => g.appendChild(tag(hidden && (i === 0 || i === 3) ? box('up', 1.15 * tileScale(), 1.54 * tileScale(), 0.8, 'facedown') : lyingTile(t), t, `meld-${seat}`)))
    rack.appendChild(g)
  }
  if (game.bonus[seat].length && flowersVisible(seat)) {
    const g = el('div', 'group')
    for (const t of game.bonus[seat]) g.appendChild(tag(lyingTile(t, 'bonus'), t, `bonus-${seat}`))
    rack.appendChild(g)
  }
  return rack
}

// All discards, pooled in the middle of the table in the order they were thrown, facing you. Each
// tile is its own part, so a new discard adds one tile rather than redrawing the pile.
// On a phone they're the same size as the sets round the edge (rows of 9, not 11), so they can be read.
function poolTiles(): HTMLElement[] {
  const big = phoneScreen.matches
  shell?.pool.classList.toggle('big', big)
  // (a long hand's seventh row of 9 would reach the names: then they go back to 10 a row, a little smaller)
  const crowded = big && pool.length > 54
  shell?.pool.classList.toggle('crowded', crowded)
  const [w, d] = crowded ? [1.15, 1.54] : big ? [1.15 * tileScale(), 1.54 * tileScale()] : [1.02, 1.37]
  return pool.map((t, i) => {
    const latest = lastDiscard !== null && i === pool.length - 1
    return part(`pool${ids([t])}`, `${latest}:${w}`,() => tag(box('up', w, d, 0.7, latest ? 'latest' : '', t), t, 'pool'))
  })
}

// Tapping the middle of the table: every discard, full size, in the order thrown (newest marked).
function showDiscards() {
  if (!pool.length || document.querySelector('.discards-layer')) return
  const layer = el('div', 'coach-layer dim dialog-layer discards-layer')
  const card = el('div', 'dialog-card discards-card')
  const grid = el('div', 'discards-grid')
  pool.forEach((t, i) => grid.appendChild(tileEl(t, lastDiscard !== null && i === pool.length - 1 ? 'newest' : '')))
  const close = () => { document.removeEventListener('keydown', onKey); layer.remove() }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close() } }
  const actions = el('div', 'dialog-actions')
  actions.appendChild(button('Close', close, 'act primary'))
  card.append(el('div', 'dialog-title', `Discards · ${pool.length}`), grid, actions)
  layer.appendChild(card)
  layer.onclick = e => { if (e.target === layer) close() }
  document.body.appendChild(layer)
  document.addEventListener('keydown', onKey)
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
  // the next hand is dealt by this time anyway, so nobody waits for ever on someone who's gone quiet
  const at = online.view?.nextHandAt
  if (at) { const s = el('span', 'next-secs'); s.dataset.deadline = String(at); b.append(' · ', s); updateNextSecs(s) }
  return b
}
let pressedNext = 0                       // online: the hand after which you pressed "Next hand"


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
  const wrap = el('div', 'hm-total-wrap' + (faanCardOpen ? ' open' : '') + (faanPointed ? ' pointed' : ''))
  const head = el('button', 'hm-total' + (enough ? ' ok' : ''))
  head.append(el('span', 'hm-label', 'Your hand'), el('span', 'hm-faan', `${total} faan`),
    el('span', 'hm-need', enough ? `✓ minimum ${match.minFaan} reached` : `${match.minFaan - total} more to reach minimum ${match.minFaan}`),
    el('span', 'hm-more', 'ⓘ'))
  head.setAttribute('aria-label', 'Your hand score — show details')
  head.onclick = () => { faanCardOpen = !faanCardOpen; render() }
  const card = faanCard(have, close, total, plans, match.minFaan)
  card.onclick = () => { if (faanCardOpen) { faanCardOpen = false; render() } }   // tap the card to put it away
  wrap.append(head, card)
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

// Online, after running out of time on your turn twice in a row: a bot has your seat until you're back.
function awayCard(): HTMLElement {
  const card = el('div', 'claim-card away-card')
  card.append(
    el('div', 'claim-head', 'You were away, so a bot is playing for you'),
    el('p', 'away-text', 'Your time ran out twice in a row. Tap below when you’re ready to play again.'),
    button('I’m back', () => online?.back(), 'act primary big'),
  )
  return card
}

// The pop-up when another player's discard is yours to take.
function claimCard(o: Offer): HTMLElement {
  if (o.win) return winCard(o)
  const card = el('div', 'claim-card')
  const head = el('div', 'claim-head')
  head.append(el('span', '', `${NAMES[o.from]} ${o.robbing ? 'is adding to a pong to make a kong:' : 'threw away'}`), tileEl(o.tile, 'claim-tile'))
  const opts = el('div', 'claim-options')
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

// When the tile wins it for you: a pop-up just for that, so it can't be missed among Pong and Chi —
// one big Mahjong! button with what the win is worth. Passing is possible, but asks first.
function winCard(o: Offer): HTMLElement {
  const card = el('div', 'claim-card win-card')
  const faan = table.faanOf(HUMAN, [...game.hands[HUMAN], o.tile], false, true, !!o.robbing)
  const head = el('div', 'claim-head')
  head.append(el('span', '', o.robbing ? `${NAMES[o.from]} is adding this to a pong — it finishes your hand:` : `${NAMES[o.from]} threw away the tile you need:`),
    tileEl(o.tile, 'claim-tile'))
  const win = claimButton('Mahjong!', (match.style === 'family' ? `Win now — ${faan} faan` : `Win now — ${faan} faan, ${fmt(payout(faan))} points`), () => humanClaim('win'), 'win big-win')
  const pass = button('Not now', async () => {
    const choice = await dialog('Give up the win?', 'If you pass, this tile goes on and you keep playing for a later win. Most players take it.', [
      { label: 'Take the win', value: 'win', cls: 'primary' },
      { label: 'Pass', value: 'pass', cls: 'danger' },
    ])
    if (choice === 'pass') humanPass(); else humanClaim('win')
  }, 'win-pass')
  card.append(el('div', 'win-card-title', 'You can win!'), head, win, pass)
  return card
}

// On touch screens a tap only lifts a tile; tapping the lifted tile throws it away, so one stray tap
// doesn't cost you a tile. With a mouse, a click throws it straight away.
const touchScreen = matchMedia('(pointer: coarse)')
let lifted: Tile | null = null
function tapTile(t: Tile, e: HTMLElement) {
  const already = !!lifted && (lifted === t || (t.id !== undefined && lifted.id === t.id))
  if (touchScreen.matches && !already) {
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
  const canDiscard = !game.over && mustDiscard && !offer
  const drawn = canDiscard ? game.drawn : null
  if (!canDiscard) lifted = null
  // mid-deal your tiles arrive in batches and sit in the order dealt; once dealt you sort them
  const tiles = intro && intro.phase !== 'flowers'
    ? game.hands[HUMAN].slice(0, handCount(HUMAN))
    : sortHand(game.hands[HUMAN].filter(t => t !== drawn))
  // the rack stays; each tile is its own part, so new tiles are added without rebuilding the rest
  const rack = part('rack', 'rack', () => el('div', 'player-rack'))
  rack.classList.toggle('winner', game.winner === HUMAN)
  // (online each update brings fresh copies of the tiles, so "the lifted tile" is matched by its id)
  const isLifted = (t: Tile) => !!lifted && (t === lifted || (t.id !== undefined && t.id === lifted.id))
  const tile = (t: Tile, cls = '') => part(`hand${ids([t])}`, `${cls}:${isLifted(t)}:${canDiscard}`, () => {
    const e = tag(tileEl(t, cls + (isLifted(t) ? ' lifted' : '')), t, 'rack-0')
    if (canDiscard) { e.classList.add('clickable'); e.onclick = () => tapTile(t, e) }
    return e
  })
  placeAll(rack, [...tiles.map(t => tile(t, game.over && t === winTile ? 'win-tile' : '')), ...(drawn ? [tile(drawn, 'drawn')] : [])])
  return rack
}

// ---------- Help panel ----------


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
  p.append(matchMedia('(hover: hover)').matches ? '. Hover over “Your hand” for more plans.' : '. Tap “Your hand” for more plans.')
  return p
}

function helpPanel(): HTMLElement {
  const p = el('aside', 'help')
  const head = el('div', 'help-head')
  head.append(el('h2', '', 'How to play'), button('✕', toggleHelp, 'close-btn'))
  p.append(head, nowSection(), ...rulesSections(match))
  return p
}


function toggleHelp() {
  helpOpen = !helpOpen
  try { localStorage.setItem(HELP_KEY, helpOpen ? '1' : '0') } catch { /* storage unavailable — keep it in memory */ }
  render()
}

function render() {
  const t0 = performance.now()
  try { renderTable() } finally {
    // while developing: how long each redraw takes, and how big the page is (window.__perf)
    if (import.meta.env.DEV) {
      const w = window as unknown as { __perf?: { ms: number; nodes: number }[] }
      ;(w.__perf ??= []).push({ ms: Math.round((performance.now() - t0) * 10) / 10, nodes: app.getElementsByTagName('*').length })
    }
  }
}

const stageTimes: Record<string, number> = {}        // while developing: where a redraw's time goes
const stage = (name: string, since: number) => { if (import.meta.env.DEV) stageTimes[name] = (stageTimes[name] ?? 0) + performance.now() - since }
;(window as unknown as { __stages?: Record<string, number> }).__stages = stageTimes

// The frame of the game screen stays put between redraws: the layout, the game column and the tilted
// table. Each redraw swaps in only the pieces that changed — the table's parts via part(), plus the
// small bars and pop-ups around it — so the browser doesn't lay out and style the whole 3D table again
// on every move. (Leaving the screen for a menu clears it; it's built afresh on the way back.)
interface Shell {
  layout: HTMLElement; main: HTMLElement; scene: HTMLElement; table: HTMLElement
  sides: HTMLElement[]; pool: HTMLElement           // the four sides of the table, and the discards in the middle
  glow: ReturnType<typeof turnGlow>                 // the light in front of whoever's turn it is
  top: HTMLElement | null; bar: HTMLElement | null; rack: HTMLElement | null; extras: HTMLElement[]; help: HTMLElement | null
}
let shell: Shell | null = null

// Make `container`'s children exactly `wanted`, in order, touching only the ones that differ.
// A player's standing, as shown by their name: points won or lost, or in Family style hands won.
const standingText = (seat: number) => match.style === 'family'
  ? `${winsOf(match, seat)} win${winsOf(match, seat) === 1 ? '' : 's'}`
  : score(match.scores[seat], match.startPoints)

// The end-of-hand and final cards are rebuilt on every redraw; only their first appearance fades in,
// so a tap or an online tick doesn't make them blink.
let endCardKey = '', endCardAt = 0
function settled(card: HTMLElement, key: string): HTMLElement {
  if (key !== endCardKey) { endCardKey = key; endCardAt = performance.now() }
  else if (performance.now() - endCardAt > 500) card.classList.add('settled')
  return card
}

// Seconds since the result card first showed (its score reveal plays from there), or Infinity — the
// whole card at once — when the reveal was skipped or the player prefers less motion.
function scoreRevealSince(): number {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Infinity
  const hand = `${match.roundWind}:${match.hand}:${match.scores.join()}`   // (the scores change with every hand)
  if (hand !== scoreRevealFor) { scoreRevealFor = hand; scoreRevealAt = performance.now() }
  return (performance.now() - scoreRevealAt) / 1000
}

function placeAll(container: HTMLElement, wanted: HTMLElement[]) {
  wanted.forEach((e, i) => {
    const at = container.children[i]
    if (at === e) return
    if (at) at.replaceWith(e)
    else container.appendChild(e)
  })
  while (container.children.length > wanted.length) container.lastElementChild!.remove()
}

function renderTable() {
  inMenu = false
  let t = performance.now()
  motion.capture(app)                                 // where every tile is now, to glide them after the rebuild
  stage('capture', t); t = performance.now()
  if (!shell || !app.contains(shell.layout)) {
    app.innerHTML = ''
    const layout = el('div', 'layout'), main = el('div', 'main-col')
    const scene = el('div', 'scene'), table = el('div', 'table')   // the scene supplies the perspective for the tilted table
    const sides = [0, 1, 2, 3].map(sideLayer), poolEl = el('div', 'pool')
    poolEl.title = 'See all the discards up close'
    poolEl.onclick = showDiscards
    const glow = turnGlow()
    table.append(glow.el, ...sides, poolEl)
    scene.appendChild(table)
    main.appendChild(scene)
    layout.appendChild(main)
    app.appendChild(layout)
    shell = { layout, main, scene, table, sides, pool: poolEl, glow, top: null, bar: null, rack: null, extras: [], help: null }
    partsBefore = new Map()                           // nothing drawn before is on screen any more
  }
  const sh = shell
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
  if (online) {                                       // quick reactions for the others at the table
    const react = chip(emoteArt('👍'), null, () => toggleReactions(react), 'react-chip')
    react.title = 'Send a reaction'
    leftGroup.appendChild(react)
  }
  const rightGroup = el('div', 'tb-right')
  // the gold outline shows when the rules are open, so the label can stay short
  const rules = chip(ICONS.book, 'Rules', toggleHelp, 'rules-chip' + (helpOpen ? ' on' : ''))
  rules.title = helpOpen ? 'Hide the rules panel' : 'Show the rules panel'
  rightGroup.append(round, rules, ...soundButtons(render))
  top.append(leftGroup, statusEl(), rightGroup)
  if (sh.top) sh.top.replaceWith(top)
  else sh.main.insertBefore(top, sh.scene)
  sh.top = top

  // the table: each side, the discards and the dice, swapped only if they changed
  partsNow = new Map()
  const it = intro
  const diceKey = it && it.phase !== 'flowers' ? `${it.rolling}:${it.phase}:${it.dice}` : ''
  sh.sides.forEach((side, seat) => placeAll(side, sideParts(seat)))
  placeAll(sh.pool, poolTiles())
  placeAll(sh.table, [sh.glow.el, ...sh.sides, sh.pool, ...(it && diceKey ? [part('dice', diceKey, () => tableDice(it))] : [])])
  sh.glow.point(it || game.over ? null : game.current)

  // under the table: the action bar (small, rebuilt) and your hand (swapped if it changed)
  const bar = actionBar()
  if (sh.bar) sh.bar.replaceWith(bar)
  else sh.scene.after(bar)
  sh.bar = bar
  const rack = playerRack()
  if (rack !== sh.rack) {
    if (sh.rack) sh.rack.replaceWith(rack)
    else bar.after(rack)
    sh.rack = rack
  }

  // pop-ups over the game, and the rules panel beside it
  // (the away and claim cards stay the same element while they're unchanged, so a redraw — someone
  // throwing a tile — doesn't make them pop in again)
  const extras: HTMLElement[] = []
  const o = offer
  if (online?.away) extras.push(part('away', 'away', awayCard))
  else if (o) extras.push(part('claim', JSON.stringify(o), () => claimCard(o)))
  if (game.over && !resultClosed && !revealing()) {
    const key = `${showFinal ? 'final' : 'hand'}:${match.roundWind}:${match.hand}:${match.scores.join()}:${(match.wins ?? []).join()}`
    extras.push(settled(showFinal ? finalCard(resultContext(), finalButtons(), quickRating(() => openFeedback(() => { inMenu = false; render() }, 'game-end')))
      : resultCard(resultContext(), handOverButtons(), scoreRevealSince(), () => { scoreRevealAt = -Infinity; render() }), key))
  }
  if (revealing() && !revealTimer) revealTimer = window.setTimeout(() => { revealTimer = 0; refresh() }, revealUntil - performance.now() + 20)
  for (const x of sh.extras) if (!extras.includes(x)) x.remove()
  for (const x of extras) if (x.parentElement !== sh.main) sh.main.append(x)
  sh.extras = extras
  sh.help?.remove()
  sh.help = helpOpen ? helpPanel() : null
  if (sh.help) sh.layout.appendChild(sh.help)
  const main = sh.main, scene = sh.scene
  partsBefore = partsNow
  stage('build', t); t = performance.now()
  void app.offsetHeight                               // (lay the page out now, so the timing below is the animations alone)
  // (upright phones stand the pong/chi/kong pop-up just above your hand: see .claim-card in style.css)
  if ((offer || online?.away) && sh.rack) main.style.setProperty('--above-rack', `${Math.round(main.getBoundingClientRect().bottom - sh.rack.getBoundingClientRect().top)}px`)
  stage('layout', t); t = performance.now()
  motion.play(app, motionHooks)
  stage('play', t)
  music.start()                                      // carries on (or resumes, e.g. via Continue game)
  if (!coachOpen && !paused) music.duck(game.over && !resultClosed)   // quieter while the result card is showing
  if (burst !== null) {
    mahjongBurst(scene, burst === HUMAN ? 'You win!' : `${NAMES[burst]} wins`, burst === HUMAN)
    burst = null
  }
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
// ---------- Reactions (online) ----------
// The 😀 button opens a small tray of emoji; the one you tap floats up from your place at the table
// on everyone's screen. (The tray lives outside the top bar, which is redrawn on every move.)
function toggleReactions(from: HTMLElement) {
  const open = document.querySelector('.react-tray')
  if (open) return void open.remove()
  const tray = el('div', 'react-tray')
  const close = () => { tray.remove(); document.removeEventListener('pointerdown', outside, true) }
  const outside = (e: Event) => { if (!tray.contains(e.target as Node) && !from.contains(e.target as Node)) close() }
  const send = (what: string) => () => { online?.react(what); close() }
  const emojis = el('div', 'react-row'), phrases = el('div', 'phrase-grid')   // the emoji, then a few short phrases
  for (const emoji of REACTIONS) {                   // each drawn as its little character (emotes.ts)
    const b = el('button', 'react-pick')
    b.append(emote(emoji) ?? emoji)
    b.title = b.firstElementChild?.getAttribute('title') ?? ''
    b.onclick = send(emoji)
    emojis.appendChild(b)
  }
  for (const text of PHRASES) { const b = el('button', 'phrase-pick', text); b.onclick = send(text); phrases.appendChild(b) }
  tray.append(emojis, phrases)
  document.body.appendChild(tray)
  // under the button, kept on screen
  const r = from.getBoundingClientRect()
  tray.style.left = `${Math.max(8, Math.min(r.left, innerWidth - tray.offsetWidth - 8))}px`
  tray.style.top = `${r.bottom + 8}px`
  document.addEventListener('pointerdown', outside, true)
}

function showReaction(seat: number, emoji: string, bubbled = PHRASES.includes(emoji)) {
  const scene = shell?.scene
  if (!scene || !document.contains(scene)) return
  const r = scene.getBoundingClientRect()
  const [fx, fy] = BANNER_SPOT[String(seat)]
  const art = bubbled ? null : emote(emoji)
  const bubble = el('div', 'reaction' + (bubbled ? ' phrase' : ''), art ? '' : emoji)   // a phrase comes in a speech bubble
  if (art) bubble.appendChild(art)
  bubble.style.left = `${r.left + r.width * Math.min(0.88, Math.max(0.12, fx))}px`   // (kept clear of the screen's edges)
  bubble.style.top = `${r.top + r.height * fy}px`
  bubble.addEventListener('animationend', () => bubble.remove())
  document.body.appendChild(bubble)
}

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


// ---------- End of a hand, end of the game ----------
// The cards themselves are in result-cards.ts; these are what they show and the buttons they carry.
const resultContext = (): ResultContext => ({ match, game, names: NAMES, winTile })
const seeTable = () => button('See the table', () => { resultClosed = true; render() }, 'act')
const handOverButtons = () => [continueButton(), seeTable()]
function finalButtons(): HTMLElement[] {
  const actions: HTMLElement[] = []
  if (online) {                                        // the host starts the next game; everyone else waits
    const room = online.room, host = room?.seats[online.seat ?? -1]?.host
    const hostName = room?.seats.find(s => s.host)?.name
    if (host && room) actions.push(button('Play again', () => { track('online-game'); online?.start(room.rules) }, 'act primary'))   // same rules as this game
    else actions.push(el('div', 'result-next', `${hostName ?? 'The host'} can start another game — friends can join with code ${online.code} until then.`))
    actions.push(button('Leave room', leaveOnline, 'act'))
  } else {
    actions.push(button('Play again', () => startMatch(), 'act primary'), button('Main menu', renderMenu, 'act'))
  }
  actions.push(seeTable())
  return actions
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
  // a Hong Kong game saved with a point limit the game no longer offers (an older test version had
  // 20/50/100): carry on with the default limit, everyone's points won or lost unchanged
  const m = table.match
  if (m.style !== 'family' && !(RULE_CHOICES.startPoints as readonly number[]).includes(m.startPoints)) {
    const shift = DEFAULT_SETTINGS.startPoints - m.startPoints
    m.scores = m.scores.map(p => p + shift)
    m.startPoints = DEFAULT_SETTINGS.startPoints
  }
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

// While developing only (never in the live build): let a script see the table, to play your seat
// for a demo recording.
if (import.meta.env.DEV) Object.assign(window, { __table: () => table })

loadMatch()
track('open')
// opened from an invite link (…?room=K7Q2M): straight to joining that room
const invited = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? ''
if (ROOM_SERVER && ROOM_CODE.test(invited)) {
  inviteCode = invited
  history.replaceState(null, '', location.pathname)
  renderOnlineHome()
} else {
  renderMenu()
}
