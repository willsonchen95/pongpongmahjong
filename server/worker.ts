// Pong Pong Mahjong's room server. Each room is a Durable Object named by its code; players connect
// with a WebSocket to /rooms/<code>/ws?player=<id>. The code is made up by whoever creates the room
// (five letters/digits), and the room comes into being when the first player connects.

import { Room, type Env } from './room'

export { Room }

const ROOM_PATH = /^\/rooms\/([A-Z2-9]{5})\/ws$/

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
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
