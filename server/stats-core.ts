// Play counts and feedback: checking what the game sends, and the owner's stats page. No names, no
// cookies — each browser is only a random id (the one it already uses for online rooms), and only a
// hash of that is kept. The storage itself is in stats.ts.

// What the game reports, each once when it happens.
export const EVENTS = {
  open: 'Opened the game',
  'guided-game': 'Guided games started',
  'bot-game': 'Games vs bots started',
  'hand-done': 'Hands vs bots played',
  'hand-won': 'Hands vs bots won',
  'bot-game-done': 'Games vs bots finished',
  'room-create': 'Rooms created',
  'room-join': 'Rooms joined',
  'online-game': 'Online games started',
} as const
export type EventType = keyof typeof EVENTS

const PLAYER = /^[A-Za-z0-9-]{8,64}$/
export const MAX_BODY = 5000
export const MAX_COMMENT = 2000
const EMAIL = /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,30}$/

export interface PlayEvent { type: EventType; player: string }
export interface Feedback { rating: number | null; comment: string; email: string; player: string; version: string; where: string }

const parse = (text: string): Record<string, unknown> | null => {
  if (text.length > MAX_BODY) return null
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null } catch { return null }
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function parseEvent(text: string): PlayEvent | null {
  const v = parse(text)
  if (!v || typeof v.type !== 'string' || !Object.hasOwn(EVENTS, v.type) || typeof v.player !== 'string' || !PLAYER.test(v.player)) return null
  return { type: v.type as EventType, player: v.player }
}

// A rating of 1–5 stars, a comment, or both; an email only if it looks like one.
export function parseFeedback(text: string): Feedback | null {
  const v = parse(text)
  if (!v || typeof v.player !== 'string' || !PLAYER.test(v.player)) return null
  const rating = Number.isInteger(v.rating) && (v.rating as number) >= 1 && (v.rating as number) <= 5 ? v.rating as number : null
  const comment = typeof v.comment === 'string' ? v.comment.trim() : ''
  if (comment.length > MAX_COMMENT || (rating === null && !comment)) return null
  const email = str(v.email, 200)
  if (email && !EMAIL.test(email)) return null
  return { rating, comment, email, player: v.player, version: str(v.version, 20), where: str(v.where, 20) }
}

// The day (UTC) as 2026-10-08, and n days before it.
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const daysBefore = (day: string, n: number) => dayOf(Date.parse(day) - n * 86_400_000)

// ---------- The stats page ----------

export interface DayRow { day: string; active: number; fresh: number; counts: Partial<Record<EventType, number>> }
export interface FeedbackRow { at: number; rating: number | null; comment: string; email: string; version: string; where: string; device: string }
export interface Summary {
  today: string
  players: number                                     // different browsers ever seen
  active: { today: number; week: number; month: number }
  days: DayRow[]                                      // newest first
  feedback: FeedbackRow[]                             // newest first
}

export const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const stars = (n: number | null) => (n === null ? '–' : '★'.repeat(n) + '☆'.repeat(5 - n))

export function statsPage(s: Summary): string {
  const types = Object.keys(EVENTS) as EventType[]
  const rated = s.feedback.filter(f => f.rating !== null)
  const avg = rated.length ? (rated.reduce((t, f) => t + f.rating!, 0) / rated.length).toFixed(1) : '–'
  const tile = (n: number | string, label: string) => `<div class="tile"><b>${n}</b><span>${label}</span></div>`
  const dayRows = s.days.map(d => `<tr><td>${d.day}</td><td>${d.active}</td><td>${d.fresh}</td>${types.map(t => `<td>${d.counts[t] ?? 0}</td>`).join('')}</tr>`).join('')
  const notes = s.feedback.map(f => `<article>
  <header><span class="stars">${stars(f.rating)}</span> <time>${esc(new Date(f.at).toISOString().slice(0, 16).replace('T', ' '))} UTC</time>
  ${f.email ? `· <a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : ''}</header>
  ${f.comment ? `<p>${esc(f.comment)}</p>` : ''}
  <small>v${esc(f.version || '?')} · from ${esc(f.where || '?')} · ${esc(f.device)}</small>
</article>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Pong Pong Mahjong stats</title><style>
:root{color-scheme:light dark;--bg:#fbf8f1;--fg:#2b2118;--mute:#7a6c5d;--line:#e4dccd;--card:#fff;--accent:#b8231f}
@media (prefers-color-scheme:dark){:root{--bg:#171310;--fg:#f3ead9;--mute:#a8998a;--line:#3a3129;--card:#211b16;--accent:#ff7a6b}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:20px 16px 48px}h1{margin:0 0 4px;font-size:1.5rem}h2{margin:32px 0 10px;font-size:1.15rem}
.sub{color:var(--mute);margin:0 0 18px}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.tile b{display:block;font-size:1.6rem;font-variant-numeric:tabular-nums}
.tile span{color:var(--mute);font-size:.85rem}.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:7px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--line)}
th:first-child,td:first-child{text-align:left}th{font-size:.8rem;color:var(--mute);font-weight:600;vertical-align:bottom;white-space:normal}
article{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px}
article p{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}article small,time{color:var(--mute)}.stars{color:var(--accent);letter-spacing:1px}
a{color:var(--accent)}.empty{color:var(--mute)}</style></head><body><main>
<h1>Pong Pong Mahjong — players &amp; feedback</h1>
<p class="sub">Anonymous counts by day (UTC), today ${s.today}. A “player” is one browser: the same person on two devices counts twice.
Visitors, countries and where they came from are in Cloudflare Web Analytics.</p>
<div class="tiles">${tile(s.players, 'players ever')}${tile(s.active.today, 'played today')}${tile(s.active.week, 'last 7 days')}${tile(s.active.month, 'last 30 days')}${tile(`${avg} ★`, `average of ${rated.length} rating${rated.length === 1 ? '' : 's'}`)}</div>
<h2>Last 30 days</h2>
<div class="scroll"><table><thead><tr><th>Day</th><th>Players</th><th>New players</th>${types.map(t => `<th>${EVENTS[t]}</th>`).join('')}</tr></thead>
<tbody>${dayRows || `<tr><td colspan="${types.length + 3}" class="empty">Nobody yet.</td></tr>`}</tbody></table></div>
<h2>Feedback (${s.feedback.length})</h2>
${notes || '<p class="empty">No feedback yet.</p>'}
</main></body></html>`
}

// A short description of the device from its browser's User-Agent ("Android phone · Samsung
// Internet"), so feedback says what it was played on without keeping the whole string.
export function deviceOf(ua: string): string {
  const os = /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet')
    : /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'unknown device'
  const browser = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'other browser'
  return `${os} · ${browser}`
}
