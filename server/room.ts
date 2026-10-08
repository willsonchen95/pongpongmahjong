// The Cloudflare side of a room: one Durable Object per room code. It keeps each player's live
// connection (WebSocket), stores the room after every change so nothing is lost if Cloudflare moves or
// sleeps the room, and sets an alarm for the room's next timed step (a bot's move, the end of the
// deal, someone's time running out). All the actual rules live in RoomCore.

import { DurableObject } from 'cloudflare:workers'
import type { Stats } from './stats'
import { RoomCore, newRoom, Limiter, CLIP_COST, MAX_MSG_CHARS, type RoomState, type ClientMsg, type Out, type Voices, type Clip, type VoiceSlot } from './room-core'

// CONNECTS / API: Cloudflare's rate limiters, so one address can't open rooms or send stats without end
// (see wrangler.jsonc). STATS: the play counts and feedback (stats.ts); ADMIN_KEY: the password for
// the stats page, a secret set with `npx wrangler secret put ADMIN_KEY --config server/wrangler.jsonc`.
export interface Env {
  ROOMS: DurableObjectNamespace<Room>
  STATS: DurableObjectNamespace<Stats>
  CONNECTS?: RateLimit
  API?: RateLimit
  ADMIN_KEY?: string
}

const DEFAULT_RULES = { rounds: 1, minFaan: 1, startPoints: 1000 }
const PLAYER_ID = /^[A-Za-z0-9-]{8,64}$/
const IDLE_MS = 24 * 60 * 60 * 1000     // a room nobody has been in for this long is deleted (its code works again)

export class Room extends DurableObject<Env> {
  // players' recorded clips, each stored under its own key ("voice:<playerId>:<slot>"): read in once
  // when the room wakes, then kept here
  private voices: Voices | null = null
  // how fast each connection is sending (kept in memory: a room that sleeps simply starts them over)
  private limits = new WeakMap<WebSocket, Limiter>()

  private async loadVoices(): Promise<Voices> {
    if (this.voices) return this.voices
    const voices: Voices = {}
    for (const [key, clip] of await this.ctx.storage.list<Clip>({ prefix: 'voice:' })) {
      const [, id, slot] = key.split(':')
      ;(voices[id] ??= {})[slot as VoiceSlot] = clip
    }
    return (this.voices = voices)
  }

  // A player connecting: /rooms/<code>/ws?player=<their id>
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
    const url = new URL(req.url)
    const code = url.pathname.split('/')[2]
    const playerId = url.searchParams.get('player') ?? ''
    if (!PLAYER_ID.test(playerId)) return new Response('Bad player id', { status: 400 })
    const [client, server] = Object.values(new WebSocketPair())
    // hibernation: the room can sleep between messages. (Nothing is stored until they join.)
    this.ctx.acceptWebSocket(server, [playerId, code])
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const [playerId, code] = this.ctx.getTags(ws)
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    let msg: ClientMsg
    try { msg = JSON.parse(text) } catch { return }
    if (text.length > MAX_MSG_CHARS || !msg || typeof msg !== 'object' || typeof msg.type !== 'string') return
    const now = Date.now()
    let limit = this.limits.get(ws)
    if (!limit) this.limits.set(ws, (limit = new Limiter(undefined, undefined, now)))
    const verdict = limit.take(msg.type === 'voice' ? CLIP_COST : 1, now)
    if (verdict === 'close') { ws.close(1008, 'Too many messages'); return }
    if (verdict === 'drop') return
    if (msg.type === 'join' && !(await this.ctx.storage.get('room'))) await this.ctx.storage.put('room', newRoom(code, DEFAULT_RULES))
    await this.update(core => core.handle(playerId, msg, now))
  }

  async webSocketClose(ws: WebSocket) {
    const [playerId] = this.ctx.getTags(ws)
    // still here in another tab? then they haven't left
    if (this.ctx.getWebSockets(playerId).some(w => w !== ws && w.readyState === WebSocket.OPEN)) return
    await this.update(core => core.leave(playerId, Date.now()), ws)
  }

  async webSocketError(ws: WebSocket) { await this.webSocketClose(ws) }

  async alarm() {
    const state = await this.ctx.storage.get<RoomState>('room')
    if (!this.anyoneHere() && (!state || state.wakeAt === null)) {   // left empty: forget the room and its clips
      await this.ctx.storage.deleteAll()
      this.voices = null
      return
    }
    await this.update(core => core.tick(Date.now()))
  }

  private anyoneHere(gone?: WebSocket): boolean {
    return this.ctx.getWebSockets().some(w => w !== gone && w.readyState === WebSocket.OPEN)
  }

  // Load the room, apply a change, store it, set the next alarm, and tell the players.
  // (gone: a connection that's closing, so doesn't count as someone here)
  private async update(change: (core: RoomCore) => Out[], gone?: WebSocket) {
    const state = await this.ctx.storage.get<RoomState>('room')
    if (!state) return
    const core = new RoomCore(state, await this.loadVoices())
    const out = change(core)
    await this.ctx.storage.put('room', core.s)
    for (const w of core.voiceWrites) {
      const [id, slot] = w.split(':')
      const clip = core.voices[id]?.[slot as VoiceSlot]
      if (clip) await this.ctx.storage.put(`voice:${w}`, clip)
      else await this.ctx.storage.delete(`voice:${w}`)
    }
    if (core.s.wakeAt !== null) await this.ctx.storage.setAlarm(core.s.wakeAt)
    else if (!this.anyoneHere(gone)) await this.ctx.storage.setAlarm(Date.now() + IDLE_MS)   // empty: deleted unless someone comes back
    else await this.ctx.storage.deleteAlarm()
    for (const o of out) {
      const text = JSON.stringify(o.msg)
      for (const ws of this.ctx.getWebSockets(o.to)) {
        try { ws.send(text) } catch { /* closing — they'll get the next update when they reconnect */ }
      }
    }
  }
}
