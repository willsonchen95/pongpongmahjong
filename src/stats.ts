// Anonymous play counts and feedback, sent to the room server (server/stats-core.ts). Only this
// browser's random id goes with them — no name, no cookies — so the owner can see how many different
// people play, not who they are.

import { API_SERVERS, playerId } from './online'
import type { EventType } from '../server/stats-core'

declare const __APP_VERSION__: string        // filled in at build time (vite.config.ts)
const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

// Something happened worth counting. sendBeacon still delivers it if the page is closing, and never
// holds the game up; if it can't be sent, it simply isn't counted.
export function track(type: EventType) {
  try { navigator.sendBeacon(`${API_SERVERS[0]}/event`, JSON.stringify({ type, player: playerId() })) } catch { /* not counted */ }
}

export interface FeedbackForm { rating: number | null; comment: string; email: string; where: string }

// Send feedback: true once a server has it. Each try gives up after 8 seconds, so a bad connection
// ends in "couldn't be sent" rather than "Sending…" for ever. (Sent as plain text, so no extra
// permission check is needed while developing, when the server is on another port.)
export async function sendFeedback(f: FeedbackForm): Promise<boolean> {
  const body = JSON.stringify({ ...f, player: playerId(), version })
  for (const api of API_SERVERS) {
    try { if ((await fetch(`${api}/feedback`, { method: 'POST', body, signal: AbortSignal.timeout(8000) })).ok) return true } catch { /* try the next */ }
  }
  return false
}
