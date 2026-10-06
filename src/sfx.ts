// Game sounds, synthesised with Web Audio (no audio files), plus spoken calls via speech synthesis.
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

function audio(): AudioContext | null {
  if (muted || document.hidden) return null           // the bots play on in a hidden tab, silently
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// A short filtered noise burst — the "click" of tile on tile.
function knock(a: AudioContext, at: number, freq: number, q: number, gain: number, length: number) {
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * length), a.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3
  const src = a.createBufferSource(); src.buffer = buf
  const filter = a.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = freq; filter.Q.value = q
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

function say(word: string) {
  if (muted || document.hidden || typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(word)
  u.rate = 1.1; u.pitch = 1.1; u.volume = 0.9
  speechSynthesis.speak(u)
}

// ---------- Background music ----------
// "Chinese Harmony" by LunarBoomMusic (Pixabay Content License — free to use in the game, no
// attribution required; we credit it on the How to play page). Quiet and looping; it fades in and
// out rather than cutting, and dips further while a tip or result card is up. Its on/off setting is
// separate from the sound effects.

const MUSIC_SRC = 'music/lunarboommusic-chinese-harmony-564699.mp3'
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
  // a tile slapped down on the table: bright click + low thump
  discard() {
    const a = audio(); if (!a) return
    const t = a.currentTime
    knock(a, t, 2600, 1.2, 0.9, 0.07)
    knock(a, t + 0.012, 1400, 2, 0.35, 0.05)
    tone(a, t, 170, 0.08, 0.25)
  },
  // a tile slid off the wall: softer, higher click (quieter for the bots)
  draw(quiet = false) {
    const a = audio(); if (!a) return
    knock(a, a.currentTime, 4200, 1.5, quiet ? 0.12 : 0.35, 0.04)
  },
  // pong / chow / kong: a two-note chime and the word spoken aloud
  call(word: string) {
    const a = audio(); if (!a) return
    const t = a.currentTime
    knock(a, t, 2200, 1.2, 0.6, 0.06)
    tone(a, t, 660, 0.25, 0.18, 'triangle')
    tone(a, t + 0.09, 990, 0.35, 0.18, 'triangle')
    say(word)
  },
  // dice rattling in the hand, then landing on the table
  dice() {
    const a = audio(); if (!a) return
    const t = a.currentTime
    for (let i = 0; i < 9; i++) knock(a, t + i * 0.07 + Math.random() * 0.03, 3200 + Math.random() * 1600, 2, 0.18, 0.03)
    for (let i = 0; i < 3; i++) knock(a, t + 0.85 + i * 0.09, 1800, 1.5, 0.5, 0.05)
  },
  // a small batch of tiles slid across to a player
  deal() {
    const a = audio(); if (!a) return
    knock(a, a.currentTime, 3000, 1.4, 0.16, 0.05)
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
  win() {
    const a = audio(); if (!a) return
    const t = a.currentTime
    ;[523, 659, 784, 1047].forEach((f, i) => tone(a, t + i * 0.11, f, 0.6, 0.2, 'triangle'))
    say('Mahjong!')
  },
}
