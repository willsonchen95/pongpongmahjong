// Game sounds, synthesised with Web Audio (no audio files), plus spoken calls via speech synthesis.
// Kept calm, like a quiet tea house: soft wooden taps, and the calls spoken gently in Chinese where
// the device has a Chinese voice.
// The audio context starts on the first user click (browsers block sound before that).

const MUTE_KEY = 'mahjong-muted'
let ctx: AudioContext | null = null
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false } })()

export function isMuted(): boolean { return muted }
export function setMuted(m: boolean) {
  muted = m
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0') } catch { /* storage unavailable — keep it in memory */ }
  if (m) speechSynthesis?.cancel()
}

// The audio context, sound on or off (recording and getting players' clips ready need it either way).
export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

function audio(): AudioContext | null {
  if (muted || document.hidden) return null           // the bots play on in a hidden tab, silently
  const a = audioContext()
  if (a.state === 'suspended') void a.resume()
  return a
}

// Play recorded sound (a player's own clip), unless the sound is off.
export function playBuffer(buf: AudioBuffer) {
  const a = audio(); if (!a) return
  const src = a.createBufferSource()
  src.buffer = buf
  src.connect(a.destination)
  src.start()
}

// A short filtered noise burst — the "click" of tile on tile.
function knock(a: AudioContext, at: number, freq: number, q: number, gain: number, length: number, type: BiquadFilterType = 'bandpass') {
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * length), a.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3
  const src = a.createBufferSource(); src.buffer = buf
  const filter = a.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q
  const g = a.createGain(); g.gain.value = gain
  src.connect(filter).connect(g).connect(a.destination)
  src.start(at)
}

// A plain tone with a quick attack and exponential fade.
function tone(a: AudioContext, at: number, freq: number, length: number, gain: number, type: OscillatorType = 'sine') {
  const osc = a.createOscillator(); osc.type = type; osc.frequency.value = freq
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(g).connect(a.destination)
  osc.start(at); osc.stop(at + length + 0.02)
}

// A plucked string, a little like a guzheng: a few harmonics through a filter that closes as the
// note dies away, starting a touch sharp and settling onto the pitch.
function pluck(a: AudioContext, at: number, freq: number, length: number, gain: number) {
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7
  lp.frequency.setValueAtTime(freq * 6, at)
  lp.frequency.exponentialRampToValueAtTime(freq * 1.5, at + length)
  const out = a.createGain()
  out.gain.setValueAtTime(0.0001, at)
  out.gain.exponentialRampToValueAtTime(gain, at + 0.006)
  out.gain.exponentialRampToValueAtTime(0.0001, at + length)
  lp.connect(out).connect(a.destination)
  for (const [h, level] of [[1, 1], [2, 0.45], [3, 0.18]]) {
    const osc = a.createOscillator(); osc.type = h === 1 ? 'triangle' : 'sine'
    osc.frequency.setValueAtTime(freq * h * 1.006, at)
    osc.frequency.exponentialRampToValueAtTime(freq * h, at + 0.08)
    const g = a.createGain(); g.gain.value = level
    osc.connect(g).connect(lp)
    osc.start(at); osc.stop(at + length + 0.02)
  }
}

// Notes of the five-note (pentatonic) scale on G, for the win.
const G4 = 392, A4 = 440, B4 = 494, D5 = 587, E5 = 659, G5 = 784

// ---------- Spoken calls ----------
// Said by a woman's voice in Cantonese where the device has one (it's Hong Kong mahjong), else in
// Mandarin, else in English as written. Chi is always Mandarin 吃 ("chī", as Google Translate says
// it) — the Cantonese for it doesn't sound like "chi" at all. Speech voices don't say whether
// they're a man or a woman, so the known men's voices are skipped by name.
const CHINESE_CALLS: Record<string, { yue?: string; zh: string }> = {
  'Pong!': { yue: '碰', zh: '碰' },
  'Chi!': { zh: '吃' },                                   // Mandarin only (see above)
  'Kong!': { yue: '槓', zh: '槓' },
  'Mahjong!': { yue: '食糊', zh: '胡了' },
}
const MEN = /danny|kangkang|yunxi|yunjian|yunyang|yunhao|yunze|wanlung|zhiwei|male/i

let cantonese: SpeechSynthesisVoice | null = null
let mandarin: SpeechSynthesisVoice | null = null
const langOf = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace('_', '-')
const isCantonese = (v: SpeechSynthesisVoice) => langOf(v) === 'zh-hk' || langOf(v).startsWith('yue')
function pickVoices() {
  const women = speechSynthesis.getVoices().filter(v => !MEN.test(v.name))
  cantonese = women.find(isCantonese) ?? null
  // mainland Mandarin first: on Chrome that's Google's own voice, the one Google Translate uses
  mandarin = women.find(v => langOf(v) === 'zh-cn') ?? women.find(v => langOf(v) === 'zh-tw')
    ?? women.find(v => langOf(v).startsWith('zh') && !isCantonese(v)) ?? null
}
if (typeof speechSynthesis !== 'undefined') {
  pickVoices()
  speechSynthesis.addEventListener?.('voiceschanged', pickVoices)   // (some browsers load them late)
}

function say(word: string) {
  if (muted || document.hidden || typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel()
  const chinese = CHINESE_CALLS[word]
  const [text, voice] = chinese?.yue && cantonese ? [chinese.yue, cantonese]
    : chinese && mandarin ? [chinese.zh, mandarin]
    : [word, null]
  const u = new SpeechSynthesisUtterance(text)
  if (voice) { u.voice = voice; u.lang = voice.lang }
  u.rate = 0.85; u.pitch = 1; u.volume = 0.75                     // unhurried and soft
  speechSynthesis.speak(u)
}

// ---------- Background music ----------
// "Moonlit Whispers" by kaazoom (Pixabay Content License — free to use in the game, no
// attribution required; we credit it on the How to play page). Quiet and looping; it fades in and
// out rather than cutting, and dips further while a tip or result card is up. Its on/off setting is
// separate from the sound effects.

const MUSIC_SRC = 'music/kaazoom-moonlit-whispers-353045.mp3'
const MUSIC_KEY = 'mahjong-music-off'
const MUSIC_VOLUME = 0.22
const DUCKED_VOLUME = 0.07
let musicOff = (() => { try { return localStorage.getItem(MUSIC_KEY) === '1' } catch { return false } })()
let track: HTMLAudioElement | null = null
let ducked = false
let fade: number | undefined

// Glide the volume to `to` over `ms`, then optionally run `done`.
function fadeTo(to: number, ms = 700, done?: () => void) {
  if (!track) return
  clearInterval(fade)
  const t = track, from = t.volume, steps = Math.max(1, Math.round(ms / 40))
  let i = 0
  fade = window.setInterval(() => {
    i++
    t.volume = Math.min(1, Math.max(0, from + (to - from) * (i / steps)))
    if (i >= steps) { clearInterval(fade); done?.() }
  }, 40)
}

const musicVolume = () => (ducked ? DUCKED_VOLUME : MUSIC_VOLUME)

// The music element, set to loop. As a safety net, if it ever ends or errors anyway (a failed
// seek back to the start, a dropped connection), it restarts — from a fresh copy if need be.
function newTrack(): HTMLAudioElement {
  const t = new Audio(MUSIC_SRC)
  t.loop = true
  t.volume = 0
  t.addEventListener('ended', () => restartTrack())
  t.addEventListener('error', () => { if (!musicOff) setTimeout(() => restartTrack(true), 2000) })
  return t
}
function restartTrack(fresh = false) {
  if (musicOff || !track) return
  const volume = track.volume
  if (fresh) {
    track.pause()
    track = newTrack()
    track.volume = volume
  } else {
    track.currentTime = 0
  }
  track.play().catch(() => {
    // couldn't jump back to the start: load a fresh copy instead (the file is already cached)
    if (!fresh) restartTrack(true)
  })
}

// Switching to another tab silences the game at once (a hidden tab's timers are slowed, so no
// fade-out); coming back fades the music in again from where it stopped.
let pausedByHiding = false
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    if (track && !track.paused) {
      clearInterval(fade)
      track.pause()
      track.volume = 0
      pausedByHiding = true
    }
  } else if (pausedByHiding) {
    pausedByHiding = false
    if (!musicOff) track?.play().then(() => fadeTo(musicVolume(), 1000)).catch(() => { /* not allowed yet */ })
  }
})

export const music = {
  isOn: () => !musicOff,
  // Start (or keep) playing. Safe to call often; browsers refuse until the player has clicked
  // something, in which case the next call tries again.
  start() {
    if (musicOff || document.hidden) return
    if (!track) track = newTrack()
    if (!track.paused) return
    track.play().then(() => fadeTo(musicVolume(), 1500)).catch(() => { /* not allowed yet */ })
  },
  toggle() {
    musicOff = !musicOff
    try { localStorage.setItem(MUSIC_KEY, musicOff ? '1' : '0') } catch { /* storage unavailable — keep it in memory */ }
    if (musicOff) fadeTo(0, 400, () => track?.pause())
    else music.start()
  },
  // Play more quietly (while a tip or the result card needs attention), or back to normal.
  duck(on: boolean) {
    if (ducked === on) return
    ducked = on
    if (track && !track.paused && !musicOff) fadeTo(musicVolume(), 500)
  },
}

export const sfx = {
  // a tile set down on the cloth: a soft wooden tok (a little different each time, like real tiles)
  discard() {
    const a = audio(); if (!a) return
    const t = a.currentTime, v = 0.9 + Math.random() * 0.2
    knock(a, t, 1150 * v, 1.1, 0.3, 0.05)
    knock(a, t, 520 * v, 0.8, 0.22, 0.06, 'lowpass')
    tone(a, t, 150 * v, 0.07, 0.07)
  },
  // a tile slid off the wall: a quieter, lighter tap (quieter still for the others)
  draw(quiet = false) {
    const a = audio(); if (!a) return
    knock(a, a.currentTime, 2300, 1.2, quiet ? 0.05 : 0.14, 0.035)
  },
  // pong / chow / kong: a two-note chime and the word spoken aloud (not when the player's own
  // recorded voice says it instead)
  call(word: string, spoken = true) {
    const a = audio(); if (!a) return
    const t = a.currentTime
    knock(a, t, 2200, 1.2, 0.6, 0.06)
    tone(a, t, 660, 0.25, 0.18, 'triangle')
    tone(a, t + 0.09, 990, 0.35, 0.18, 'triangle')
    if (spoken) say(word)
  },
  // dice rattling in the hand, then landing on the cloth
  dice() {
    const a = audio(); if (!a) return
    const t = a.currentTime
    for (let i = 0; i < 9; i++) knock(a, t + i * 0.07 + Math.random() * 0.03, 2200 + Math.random() * 900, 2, 0.08, 0.03)
    for (let i = 0; i < 3; i++) knock(a, t + 0.85 + i * 0.09, 1100, 1.2, 0.2 - i * 0.05, 0.05)
  },
  // a soft wooden tick while your time runs out (tock on alternate ticks; urgent = a little clearer)
  tick(tock = false, urgent = false) {
    const a = audio(); if (!a) return
    const t = a.currentTime
    knock(a, t, tock ? 1300 : 1700, 5, urgent ? 0.26 : 0.15, 0.03)
    if (urgent) tone(a, t, tock ? 587 : 784, 0.08, 0.025)
  },
  // a small batch of tiles slid across to a player
  deal() {
    const a = audio(); if (!a) return
    knock(a, a.currentTime, 1900, 1.2, 0.08, 0.05)
  },
  // a flower or season turned up: a light bell
  flower() {
    const a = audio(); if (!a) return
    const t = a.currentTime
    tone(a, t, 1319, 0.5, 0.1, 'sine')
    tone(a, t + 0.08, 1760, 0.6, 0.08, 'sine')
  },
  // a gentle two-note "ding-dong" when it becomes your turn
  yourTurn() {
    const a = audio(); if (!a) return
    const t = a.currentTime
    tone(a, t, 784, 0.35, 0.12)
    tone(a, t + 0.14, 1175, 0.5, 0.12)
  },
  // a win: a slow run up the scale, like a hand drawn across guzheng strings, settling on a low note
  win(spoken = true) {
    const a = audio(); if (!a) return
    const t = a.currentTime
    ;[G4, A4, B4, D5, E5, G5].forEach((f, i) => pluck(a, t + i * 0.13, f, 1.4, 0.11))
    pluck(a, t + 0.85, G4 / 2, 2.2, 0.12)
    if (spoken) say('Mahjong!')
  },
}
