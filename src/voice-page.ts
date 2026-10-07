// The "Your voice" page: record your own Pong!, Chi!, Kong! and Mahjong!, and three sounds of your own
// for the soundboard, then hear them back. (Recording, storing and playing are in voice.ts.)

import { el, button, pageTitle } from './ui'
import { sfx, isMuted } from './sfx'
import { BUILTIN_SOUNDS } from '../server/room-core'
import {
  CALL_SLOTS, OWN_SLOTS, MAX_SECONDS, myClips, saveClip, renameClip, clipSeconds, canRecord, startRecording, playClip,
  type Recording, type VoiceSlot,
} from './voice'

export const CALL_LABELS: Record<string, string> = { pong: 'Pong!', chow: 'Chi!', kong: 'Kong!', win: 'Mahjong!' }
// the soundboard's ready-made sounds: [emoji, name]
export const BUILTIN_LABELS: Record<string, [string, string]> = {
  horn: ['📯', 'Air horn'], drum: ['🥁', 'Ba-dum-tss'], trombone: ['🎺', 'Sad trombone'], clap: ['👏', 'Applause'],
}
export const ownLabel = (slot: VoiceSlot) => myClips()[slot]?.label || `Sound ${OWN_SLOTS.indexOf(slot as typeof OWN_SLOTS[number]) + 1}`

let recording: { slot: VoiceSlot; rec: Recording } | null = null
let message = ''

// `back`: where the back buttons go. `changed`: a clip was recorded, renamed or deleted (online, it's
// passed on to the room).
export function renderVoicePage(app: HTMLElement, back: () => void, changed: (slot: VoiceSlot) => void, opening = true) {
  const redraw = () => renderVoicePage(app, back, changed, false)
  const leave = () => { recording?.rec.cancel(); recording = null; message = ''; back() }
  app.innerHTML = ''
  const card = el('div', 'setup voice-page')
  card.append(pageTitle('Your voice', leave, 'Back'),
    el('p', 'setup-intro', 'Record yourself and your friends hear you! Shout your own Pong!, Chi!, Kong! and Mahjong!, and make three sounds for the soundboard (the 😀 button in an online game). Each clip is up to 2½ seconds.'))
  if (!canRecord()) {
    card.appendChild(el('p', 'form-message', 'Recording needs the game opened from its web address (https://pongpongmahjong.pages.dev) in a browser that can use the microphone.'))
  }
  if (isMuted()) card.appendChild(el('p', 'setup-help', 'The sound is off — turn it on to hear your clips.'))
  if (message) card.appendChild(el('p', 'form-message', message))

  // one clip: its name, how long it is, and Record / Play / Delete
  const row = (slot: VoiceSlot, name: HTMLElement, playDefault: (() => void) | null) => {
    const clip = myClips()[slot]
    const r = el('div', 'voice-row' + (clip ? ' has' : ''))
    const info = el('div', 'voice-info')
    info.append(name, el('span', 'voice-status', clip ? `Your voice · ${clipSeconds(clip).toFixed(1)} s` : playDefault ? 'The game’s voice' : 'Not recorded yet'))
    const meter = el('div', 'voice-meter')
    const rec = button('● Record', () => void toggleRecord(slot, rec, meter, name), 'act voice-rec')
    rec.title = clip ? 'Record it again' : 'Record it'
    rec.toggleAttribute('disabled', !canRecord())
    const play = button('▶', () => { if (clip) void playClip(clip); else playDefault?.() }, 'act voice-play')
    play.title = 'Play it'
    play.toggleAttribute('disabled', !clip && !playDefault)
    const del = button('✕', () => { saveClip(slot, null); changed(slot); redraw() }, 'act voice-del')
    del.title = 'Delete it'
    del.toggleAttribute('disabled', !clip)
    r.append(meter, info, rec, play, del)
    return r
  }

  const toggleRecord = async (slot: VoiceSlot, btn: HTMLElement, meter: HTMLElement, name: HTMLElement) => {
    if (recording) {                                   // tapped Stop (or Record on another row: stop this one first)
      const was = recording
      recording = null
      const clip = await was.rec.stop()
      if (!clip) { message = 'Didn’t hear anything — try again, a bit closer to the microphone.'; return redraw() }
      const typed = name instanceof HTMLInputElement && was.slot === slot ? name.value.trim() : ''
      if (typed || myClips()[was.slot]?.label) clip.label = (typed || myClips()[was.slot]?.label)!.slice(0, 16)
      message = saveClip(was.slot, clip) ? '' : 'Couldn’t save it — this phone is out of space for the game.'
      if (!message) { changed(was.slot); void playClip(clip) }
      return redraw()
    }
    message = ''
    try {
      const started = Date.now()
      const rec = await startRecording(level => {
        meter.style.setProperty('--level', String(level))
        btn.textContent = `■ Stop · ${Math.max(0, MAX_SECONDS - (Date.now() - started) / 1000).toFixed(1)}`
      }, () => { if (recording?.rec === rec) void toggleRecord(slot, btn, meter, name) })
      recording = { slot, rec }
      btn.textContent = '■ Stop'
      btn.classList.add('on')
      btn.closest('.voice-row')?.classList.add('recording')
    } catch {
      message = 'The game can’t use the microphone. Allow it for this site (in the browser’s site settings), then try again.'
      redraw()
    }
  }

  card.appendChild(el('h2', 'setup-q', 'Your calls'))
  const calls = el('div', 'voice-list')
  for (const slot of CALL_SLOTS) calls.appendChild(row(slot, el('span', 'voice-name', CALL_LABELS[slot]),
    () => (slot === 'win' ? sfx.win() : sfx.call(CALL_LABELS[slot]))))
  card.appendChild(calls)

  card.append(el('h2', 'setup-q', 'Your soundboard'),
    el('p', 'setup-help', 'Give each sound a name — it’s what your friends see when you play it.'))
  const own = el('div', 'voice-list')
  for (const slot of OWN_SLOTS) {
    const input = el('input', 'text-input voice-label') as HTMLInputElement
    input.maxLength = 16
    input.placeholder = `Sound ${OWN_SLOTS.indexOf(slot) + 1}`
    input.value = myClips()[slot]?.label ?? ''
    input.onchange = () => { if (renameClip(slot, input.value)) changed(slot) }
    own.appendChild(row(slot, input, null))
  }
  card.appendChild(own)

  card.append(el('h2', 'setup-q', 'Ready-made sounds'), el('p', 'setup-help', 'Everyone has these on the soundboard too.'))
  const builtins = el('div', 'voice-builtins')
  for (const name of BUILTIN_SOUNDS) {
    const [emoji, label] = BUILTIN_LABELS[name]
    builtins.appendChild(button(`${emoji} ${label}`, () => sfx.board(name), 'act'))
  }
  card.appendChild(builtins)

  const actions = el('div', 'setup-actions')
  actions.append(button('‹ Back', leave, 'act'))
  card.appendChild(actions)
  app.appendChild(card)
  if (opening) window.scrollTo(0, 0)
}
