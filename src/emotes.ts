// The reactions (online), drawn as a little tea-house cast instead of emoji: a panda, a bao, a koi,
// a teacup, a teapot and a lion-dance head. The room still sends the six emoji (server/room-core.ts
// REACTIONS), so nothing changes there — each emoji is just shown as its character. They move only
// while floating up from a player's place (.reaction in style.css); in the tray they keep still.

import { t } from './i18n'

const INK = '#2f3b40', RED = '#a8402f', KOI = '#c4553f', CREAM = '#fbf8f2', CHEEK = '#e7a99a', TEAR = '#7fb3cf'

const svg = (body: string) => `<svg viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`

const cheeks = (y: number, l = 19, r = 45) =>
  `<circle cx="${l}" cy="${y}" r="2.6" fill="${CHEEK}" opacity="0.75"/><circle cx="${r}" cy="${y}" r="2.6" fill="${CHEEK}" opacity="0.75"/>`

const CAST: Record<string, { name: string; art: string }> = {
  // a panda giving a thumbs-up, nodding
  '👍': {
    name: 'Panda: thumbs up',
    art: svg(`
      <ellipse cx="31" cy="56" rx="17" ry="10" fill="#fff" stroke="${INK}" stroke-width="2"/>
      <g class="em-nod">
        <circle cx="17" cy="15" r="7" fill="${INK}"/><circle cx="45" cy="15" r="7" fill="${INK}"/>
        <ellipse cx="31" cy="30" rx="18" ry="16" fill="#fff" stroke="${INK}" stroke-width="2"/>
        <ellipse cx="23" cy="29" rx="4.6" ry="6" fill="${INK}" transform="rotate(-20 23 29)"/>
        <ellipse cx="39" cy="29" rx="4.6" ry="6" fill="${INK}" transform="rotate(20 39 29)"/>
        <circle cx="24" cy="28" r="1.7" fill="#fff"/><circle cx="38" cy="28" r="1.7" fill="#fff"/>
        <ellipse cx="31" cy="35" rx="2.6" ry="1.8" fill="${INK}"/>
        <path d="M27.5 38.5 Q31 41.5 34.5 38.5" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        ${cheeks(36, 18, 44)}
      </g>
      <g class="em-wave"><rect x="46" y="37" width="6" height="12" rx="3" fill="${INK}"/><ellipse cx="49" cy="52" rx="7" ry="6" fill="${INK}"/></g>`),
  },
  // a steamed bao, laughing so hard it bounces
  '😂': {
    name: 'Bao: laughing',
    art: svg(`
      <ellipse cx="32" cy="59" rx="17" ry="3" fill="rgba(47, 59, 64, 0.12)"/>
      <g class="em-bounce">
        <path d="M9 50 Q9 22 32 17 Q55 22 55 50 Q55 57 32 57 Q9 57 9 50Z" fill="#f6efe2" stroke="#c9b99c" stroke-width="1.6"/>
        <path d="M32 17 q-3 5 -9 6 M32 17 q3 5 9 6 M32 17 q0 5 -2 8" stroke="#c9b99c" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        <path d="M19 38 q4 -5 8 0 M37 38 q4 -5 8 0" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M25 43 Q32 53 39 43Z" fill="${RED}"/>
        <path d="M17 40 q-2 3 0 4.6 q2 -1.6 0 -4.6Z M47 40 q-2 3 0 4.6 q2 -1.6 0 -4.6Z" fill="${TEAR}"/>
        ${cheeks(45, 16, 48)}
      </g>`),
  },
  // a koi leaping out of the water, mouth open in surprise
  '😮': {
    name: 'Koi: surprised',
    art: svg(`
      <g class="em-splash" fill="${TEAR}"><circle cx="18" cy="58" r="2"/><circle cx="26" cy="61" r="1.4"/><circle cx="12" cy="61" r="1.2"/></g>
      <g class="em-jump">
        <path d="M14 40 L4 30 L7 40 L4 50Z" fill="${KOI}"/>
        <path d="M12 40 Q22 22 40 25 Q53 29 55 40 Q53 49 40 51 Q24 53 12 40Z" fill="${CREAM}" stroke="${RED}" stroke-width="1.5"/>
        <path d="M23 28 Q31 23 38 29 Q32 36 23 33Z" fill="${KOI}"/><circle cx="34" cy="45" r="4" fill="${KOI}"/>
        <path d="M30 49 L26 57 L35 51Z" fill="${KOI}"/>
        <circle cx="45" cy="33" r="3.4" fill="#fff" stroke="${INK}" stroke-width="1.2"/><circle cx="45.4" cy="33" r="1.6" fill="${INK}"/>
        <path d="M41.5 27.5 q3.5 -2.5 7 0" stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        <ellipse cx="54.5" cy="40" rx="2.4" ry="3" fill="#7a2e22"/>
      </g>`),
  },
  // a little teacup with a tear rolling down
  '😭': {
    name: 'Teacup: sad',
    art: svg(`
      <ellipse cx="32" cy="55" rx="23" ry="5" fill="#e9f1ea" stroke="#a9c3b0" stroke-width="1.3"/>
      <path d="M51 32 q10 0 8 8 q-2 6 -9 5" stroke="#8fb09c" stroke-width="3" fill="none"/>
      <path d="M11 28 H53 Q53 51 32 53 Q11 51 11 28Z" fill="#c6dccb" stroke="#8fb09c" stroke-width="1.5"/>
      <ellipse cx="32" cy="28" rx="21" ry="4.5" fill="#e9f1ea" stroke="#8fb09c" stroke-width="1.3"/>
      <ellipse cx="32" cy="28.6" rx="17" ry="2.8" fill="#c9a36b"/>
      <path d="M19 36 l6 -2.5 M45 36 l-6 -2.5" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="23" cy="39" r="1.7" fill="${INK}"/><circle cx="41" cy="39" r="1.7" fill="${INK}"/>
      <path d="M28 47 Q32 44 36 47" stroke="${INK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <path class="em-tear" d="M22 42 q-2.4 3.6 0 5.4 q2.4 -1.8 0 -5.4Z" fill="${TEAR}"/>`),
  },
  // a grumpy teapot, huffing steam
  '😡': {
    name: 'Teapot: grumpy',
    art: svg(`
      <g class="em-steam" fill="#d9d2c3"><circle cx="58" cy="22" r="3.2"/><circle cx="54" cy="15" r="2.4"/><circle cx="30" cy="13" r="2.8"/></g>
      <g class="em-shake">
        <path d="M11 33 C1 33 2 50 12 47" stroke="#a8705a" stroke-width="4" fill="none"/>
        <path d="M47 40 Q55 38 59 28 L62 30 Q58 45 47 47Z" fill="#a8705a"/>
        <ellipse cx="30" cy="41" rx="20" ry="15" fill="#b9806a"/>
        <ellipse cx="30" cy="27" rx="10" ry="3" fill="#a8705a"/><circle cx="30" cy="23" r="3" fill="#a8705a"/>
        <path d="M19 34 l7 3 M41 34 l-7 3" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
        <circle cx="23" cy="40" r="1.8" fill="${INK}"/><circle cx="37" cy="40" r="1.8" fill="${INK}"/>
        <path d="M26 48 Q30 45 34 48" stroke="${INK}" stroke-width="1.9" fill="none" stroke-linecap="round"/>
      </g>`),
  },
  // a lion-dance head, dancing and blinking
  '🎉': {
    name: 'Lion dance: hooray',
    art: svg(`
      <g class="em-dance">
        <circle cx="32" cy="33" r="25" fill="#f3ead9" stroke="#d9c9ab" stroke-width="1.5"/>
        <circle cx="32" cy="34" r="20" fill="${KOI}"/>
        <path d="M32 6 L28 15 H36Z" fill="#4f7a67"/>
        <circle cx="32" cy="20" r="3" fill="#e9f1ea" stroke="#4f7a67" stroke-width="1.3"/>
        <path d="M16 22 Q22 17 28 21 M36 21 Q42 17 48 22" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>
        <g class="em-blink">
          <circle cx="23" cy="31" r="5.5" fill="#fff" stroke="${INK}" stroke-width="1.4"/><circle cx="23.5" cy="32" r="2.8" fill="${INK}"/>
          <circle cx="41" cy="31" r="5.5" fill="#fff" stroke="${INK}" stroke-width="1.4"/><circle cx="40.5" cy="32" r="2.8" fill="${INK}"/>
        </g>
        <circle cx="32" cy="39" r="3.4" fill="${CHEEK}"/>
        <path d="M20 45 Q32 56 44 45 Q32 49 20 45Z" fill="#7a2e22"/>
        <path d="M25 47 h3 v2.4 h-3Z M36 47 h3 v2.4 h-3Z" fill="#fff"/>
        <path d="M18 55 q2 4 5 4 M26 57 q1 4 3 5 M38 57 q-1 4 -3 5 M46 55 q-2 4 -5 4" stroke="#f3ead9" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      </g>`),
  },
}

// The picture for a reaction, or null for one we don't draw (a phrase, or an older client's emoji).
export function emote(emoji: string): HTMLElement | null {
  const c = CAST[emoji]
  if (!c) return null
  const e = document.createElement('span')
  e.className = 'emote'
  e.setAttribute('role', 'img')
  e.setAttribute('aria-label', t(c.name))
  e.title = t(c.name)
  e.innerHTML = c.art
  return e
}

// Just the markup (for the top bar's reactions button).
export const emoteArt = (emoji: string) => CAST[emoji]?.art ?? emoji
