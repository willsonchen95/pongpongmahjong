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

// A tone that slides from one pitch to another (a drum's thud drops in pitch as it fades).
function slide(a: AudioContext, at: number, from: number, to: number, length: number, gain: number, type: OscillatorType = 'sine') {
  const osc = a.createOscillator(); osc.type = type
  osc.frequency.setValueAtTime(from, at)
  osc.frequency.exponentialRampToValueAtTime(to, at + length)
  const g = a.createGain()
  g.gain.setValueAtTime(gain, at)
  g.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(g).connect(a.destination)
  osc.start(at); osc.stop(at + length + 0.02)
}

// A brassy note: buzzy waves through a filter that opens and closes ("wah"), with a wobble if held.
function brass(a: AudioContext, at: number, freqs: number[], length: number, gain: number, wobble = 0) {
  const filter = a.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 4
  filter.frequency.setValueAtTime(400, at)
  filter.frequency.linearRampToValueAtTime(2200, at + 0.08)
  filter.frequency.linearRampToValueAtTime(900, at + length)
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.04)
  g.gain.setValueAtTime(gain, at + length - 0.08)
  g.gain.exponentialRampToValueAtTime(0.0001, at + length)
  filter.connect(g).connect(a.destination)
  for (const f of freqs) {
    const osc = a.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f
    if (wobble) {
      const lfo = a.createOscillator(); lfo.frequency.value = 5.5
      const depth = a.createGain(); depth.gain.value = wobble
      lfo.connect(depth).connect(osc.frequency)
      lfo.start(at); lfo.stop(at + length + 0.02)
    }
    osc.connect(filter)
    osc.start(at); osc.stop(at + length + 0.02)
  }
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
  // dice rattling in the hand, then landing on the table
  dice() {
    const a = audio(); if (!a) return
    const t = a.currentTime
    for (let i = 0; i < 9; i++) knock(a, t + i * 0.07 + Math.random() * 0.03, 3200 + Math.random() * 1600, 2, 0.18, 0.03)
    for (let i = 0; i < 3; i++) knock(a, t + 0.85 + i * 0.09, 1800, 1.5, 0.5, 0.05)
  },
  // a clock's tick while your time runs out (tock on alternate ticks; urgent = higher and louder)
  tick(tock = false, urgent = false) {
    const a = audio(); if (!a) return
    const t = a.currentTime
    knock(a, t, tock ? 1900 : 2600, 6, urgent ? 0.5 : 0.3, 0.03)
    tone(a, t, tock ? 880 : 1175, 0.05, urgent ? 0.07 : 0.04, 'square')
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
  win(spoken = true) {
    const a = audio(); if (!a) return
    const t = a.currentTime
    ;[523, 659, 784, 1047].forEach((f, i) => tone(a, t + i * 0.11, f, 0.6, 0.2, 'triangle'))
    if (spoken) say('Mahjong!')
  },
  // the soundboard's ready-made sounds (see BUILTIN_SOUNDS)
  board(name: string) {
    const a = audio(); if (!a) return
    const t = a.currentTime
    if (name === 'horn') {                             // air horn: honk, honk, hoooonk
      ;[[0, 0.16], [0.22, 0.16], [0.44, 0.75]].forEach(([at, len]) => brass(a, t + at, [466, 470, 587], len, 0.09))
    } else if (name === 'drum') {                      // ba-dum-tss
      slide(a, t, 190, 110, 0.18, 0.5)
      knock(a, t, 900, 1, 0.25, 0.05)
      slide(a, t + 0.17, 150, 85, 0.22, 0.5)
      knock(a, t + 0.17, 700, 1, 0.25, 0.05)
      knock(a, t + 0.45, 7500, 0.7, 0.55, 1.1, 'highpass')
    } else if (name === 'trombone') {                  // sad trombone: wah, wah, wah, waaaah
      ;[[0, 294, 0.38], [0.42, 277, 0.38], [0.84, 262, 0.38], [1.26, 247, 1.2]].forEach(([at, f, len], i) =>
        brass(a, t + at, [f, f * 1.003], len, 0.11, i === 3 ? 7 : 0))
    } else if (name === 'clap') {                      // applause: lots of claps, dying away
      for (let i = 0; i < 70; i++) {
        const at = Math.random() ** 1.6 * 1.8
        knock(a, t + at, 1100 + Math.random() * 1500, 1.4, 0.35 * (1 - at / 2.2), 0.03)
      }
    }
  },
}
