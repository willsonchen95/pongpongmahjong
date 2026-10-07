// Your own voice: short clips you record on this phone — shouted when you call Pong!, Chi!, Kong! or
// Mahjong! (instead of the computer voice), and three of your own for the soundboard. They're kept on
// the phone; in an online room they're passed to the others at the table (see online.ts and the room
// server). Each is a small WAV: trimmed, evened out in volume and stored at a low sample rate, so a
// clip is a few dozen KB and plays on any phone.

import { MAX_CLIP_CHARS, type Clip, type VoiceSlot } from '../server/room-core'
import { audioContext, playBuffer } from './sfx'

export type { Clip, VoiceSlot }
export const CALL_SLOTS = ['pong', 'chow', 'kong', 'win'] as const satisfies readonly VoiceSlot[]
export const OWN_SLOTS = ['own1', 'own2', 'own3'] as const satisfies readonly VoiceSlot[]
export const MAX_SECONDS = 2.5
const RATE = 12000                     // samples a second: plenty for a voice, and keeps clips small

// ---------- Your clips, kept on this phone ----------

const KEY = 'mahjong-voice'
let mine: Partial<Record<VoiceSlot, Clip>> = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {} } catch { return {} }
})()

export function myClips(): Partial<Record<VoiceSlot, Clip>> { return mine }

// Keep (or with null, delete) one of your clips. False if the phone wouldn't store it.
export function saveClip(slot: VoiceSlot, clip: Clip | null): boolean {
  const next = { ...mine }
  if (clip) next[slot] = clip
  else delete next[slot]
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { return false }
  mine = next
  return true
}

// A soundboard clip's new name (kept with the clip).
export function renameClip(slot: VoiceSlot, label: string): Clip | null {
  const c = mine[slot]
  if (!c) return null
  const named: Clip = { ...c, id: newId(), label: label.trim().slice(0, 16) || undefined }   // a new id, so the room passes the new name on
  return saveClip(slot, named) ? named : null
}

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')

// How long a clip lasts, in seconds (from the WAV's size: 2 bytes a sample after a 44-byte header).
export const clipSeconds = (c: Clip) => Math.max(0, (c.data.length * 3 / 4 - 44) / 2 / RATE)

// ---------- Recording ----------

export const canRecord = () => !!navigator.mediaDevices?.getUserMedia && window.isSecureContext

export interface Recording {
  stop(): Promise<Clip | null>         // null: nothing heard
  cancel(): void
}

// Start recording from the microphone (asks permission the first time). It stops by itself after
// MAX_SECONDS; `onDone` is called then, or never if you stop it first. `onLevel` gets the loudness
// (0–1) as you speak, for a meter.
export async function startRecording(onLevel: (level: number) => void, onDone: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const a = audioContext()
  if (a.state === 'suspended') await a.resume()
  const source = a.createMediaStreamSource(stream)
  // (a ScriptProcessor rather than MediaRecorder: it hands over plain samples on every phone, where
  // MediaRecorder gives each browser's own compressed format)
  const proc = a.createScriptProcessor(4096, 1, 1)
  const silent = a.createGain()
  silent.gain.value = 0
  const chunks: Float32Array[] = []
  let length = 0
  const limit = Math.ceil(a.sampleRate * MAX_SECONDS)
  let finished = false
  const end = () => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    proc.disconnect(); source.disconnect(); silent.disconnect()
    stream.getTracks().forEach(t => t.stop())
  }
  proc.onaudioprocess = e => {
    if (finished) return
    const input = e.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(input))
    length += input.length
    let peak = 0
    for (let i = 0; i < input.length; i += 16) peak = Math.max(peak, Math.abs(input[i]))
    onLevel(Math.min(1, peak * 2))
  }
  source.connect(proc).connect(silent).connect(a.destination)
  const timer = setTimeout(() => { if (!finished) onDone() }, MAX_SECONDS * 1000 + 150)
  return {
    async stop() {
      end()
      const all = new Float32Array(Math.min(length, limit))
      let at = 0
      for (const c of chunks) { if (at >= all.length) break; all.set(c.subarray(0, all.length - at), at); at += c.length }
      return toClip(all, a.sampleRate)
    },
    cancel: end,
  }
}

// Recorded samples to a clip: cut the silence off both ends, even out the volume, and store it small.
async function toClip(samples: Float32Array, rate: number): Promise<Clip | null> {
  let peak = 0
  for (const x of samples) peak = Math.max(peak, Math.abs(x))
  if (peak < 0.02) return null                                       // didn't hear anything
  const quiet = Math.max(0.015, peak * 0.08)
  let from = samples.findIndex(x => Math.abs(x) > quiet)
  let to = samples.length - 1
  while (to > from && Math.abs(samples[to]) <= quiet) to--
  const pad = Math.round(rate * 0.06)
  from = Math.max(0, from - pad)
  to = Math.min(samples.length, to + pad * 2)
  const cut = samples.slice(from, to)
  const gain = Math.min(8, 0.9 / peak)
  const fade = Math.min(Math.round(rate * 0.01), cut.length >> 2)
  for (let i = 0; i < cut.length; i++) {
    const edge = Math.min(1, i / fade, (cut.length - 1 - i) / fade)
    cut[i] *= gain * edge
  }
  // down to RATE samples a second, done by the browser (it filters properly as it goes)
  const n = Math.max(1, Math.round(cut.length * RATE / rate))
  const off = new OfflineAudioContext(1, n, RATE)
  const buf = off.createBuffer(1, cut.length, rate)
  buf.getChannelData(0).set(cut)
  const src = off.createBufferSource()
  src.buffer = buf
  src.connect(off.destination)
  src.start()
  const low = (await off.startRendering()).getChannelData(0)
  const data = base64(wav(low))
  return data.length <= MAX_CLIP_CHARS ? { id: newId(), data } : null
}

// 16-bit mono WAV.
function wav(samples: Float32Array): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); out.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE')
  text(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true)
  out.setUint32(24, RATE, true); out.setUint32(28, RATE * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true)
  text(36, 'data'); out.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true)
  return new Uint8Array(out.buffer)
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// ---------- Playing ----------

const decoded = new Map<string, Promise<AudioBuffer | null>>()

// Get a clip ready to play (online, as soon as it arrives, so a call isn't late).
export function prepare(clip: Clip): Promise<AudioBuffer | null> {
  let p = decoded.get(clip.id)
  if (!p) {
    const bytes = Uint8Array.from(atob(clip.data), ch => ch.charCodeAt(0))
    p = audioContext().decodeAudioData(bytes.buffer).catch(() => null)
    decoded.set(clip.id, p)
  }
  return p
}

// Play a clip (quietly does nothing while the sound is off).
export async function playClip(clip: Clip) {
  const buf = await prepare(clip)
  if (buf) playBuffer(buf)
}
