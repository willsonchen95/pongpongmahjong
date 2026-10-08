// Pong Pong Mahjong's room server. Each room is a Durable Object named by its code; players connect
// with a WebSocket to /rooms/<code>/ws?player=<id>. The code is made up by whoever creates the room
// (five letters/digits), and the room comes into being when the first player connects.
// It also takes the game's anonymous play counts (/api/event) and feedback (/api/feedback), and shows
// them to the owner at /api/admin (password: the ADMIN_KEY secret).

import { Room, type Env } from './room'
import { Stats } from './stats'
import { parseEvent, parseFeedback, deviceOf, statsPage, MAX_BODY } from './stats-core'

export { Room, Stats }

const ROOM_PATH = /^\/rooms\/([A-Z2-9]{5})\/ws$/

// (while developing, the game on the vite port sends here on 8787: let it read the answer)
const CORS = { 'access-control-allow-origin': '*' }
const reply = (status: number, text = '') => new Response(text, { status, headers: CORS })

// The stats page asks for a password (any user name). Compared in constant time, so its length and
// letters can't be worked out from how long the answer takes.
async function allowed(req: Request, env: Env): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? ''
  if (!env.ADMIN_KEY || !auth.startsWith('Basic ')) return false
  let given = ''
  try { given = atob(auth.slice(6)).split(':').slice(1).join(':') } catch { return false }
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  return crypto.subtle.timingSafeEqual(await hash(given), await hash(env.ADMIN_KEY))
}

async function api(req: Request, env: Env, path: string): Promise<Response> {
  // one address sending over and over (a script, not a person playing): turned away
  const ip = req.headers.get('cf-connecting-ip') ?? ''
  if (env.API && !(await env.API.limit({ key: ip })).success) return reply(429, 'Too many requests')
  const stats = env.STATS.get(env.STATS.idFromName('stats'))

  if (path === '/api/admin' && req.method === 'GET') {
    if (!env.ADMIN_KEY) return reply(503, 'Set the ADMIN_KEY secret first (see server/room.ts).')
    if (!(await allowed(req, env))) {
      return new Response('Password needed', { status: 401, headers: { 'www-authenticate': 'Basic realm="Pong Pong Mahjong stats", charset="UTF-8"' } })
    }
    return new Response(statsPage(await stats.summary()), {
      headers: {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'referrer-policy': 'no-referrer',
      },
    })
  }

  if (req.method !== 'POST' || (path !== '/api/event' && path !== '/api/feedback')) return reply(404, 'Not found')
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return reply(413, 'Too big')
  const text = await req.text()
  if (path === '/api/event') {
    const e = parseEvent(text)
    if (!e) return reply(400, 'Bad event')
    await stats.record(e.type, e.player)
    return reply(204)
  }
  const f = parseFeedback(text)
  if (!f) return reply(400, 'Bad feedback')
  await stats.addFeedback(f, deviceOf(req.headers.get('user-agent') ?? ''))
  return reply(204)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/')) return api(req, env, url.pathname)
    const m = url.pathname.match(ROOM_PATH)
    if (m) {
      // one address opening connections over and over (a script, not a person reconnecting): turned away
      const ip = req.headers.get('cf-connecting-ip') ?? ''
      if (env.CONNECTS && !(await env.CONNECTS.limit({ key: ip })).success) return new Response('Too many connections', { status: 429 })
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req)
    }
    return new Response('Pong Pong Mahjong rooms', { headers: { 'content-type': 'text/plain' } })
  },
} satisfies ExportedHandler<Env>
