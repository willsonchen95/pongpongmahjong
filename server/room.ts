// The Cloudflare side of a room: one Durable Object per room code. It keeps each player's live
// connection (WebSocket), stores the room after every change so nothing is lost if Cloudflare moves or
// sleeps the room, and sets an alarm for the room's next timed step (a bot's move, the end of the
// deal, someone's time running out). All the actual rules live in RoomCore.

import { DurableObject } from 'cloudflare:workers'
import { RoomCore, newRoom, type RoomState, type ClientMsg, type Out } from './room-core'

export interface Env { ROOMS: DurableObjectNamespace<Room> }

const DEFAULT_RULES = { rounds: 1, minFaan: 1, startPoints: 1000 }
const PLAYER_ID = /^[A-Za-z0-9-]{8,64}$/

export class Room extends DurableObject<Env> {
  // A player connecting: /rooms/<code>/ws?player=<their id>
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
    const url = new URL(req.url)
    const code = url.pathname.split('/')[2]
    const playerId = url.searchParams.get('player') ?? ''
    if (!PLAYER_ID.test(playerId)) return new Response('Bad player id', { status: 400 })
    if (!(await this.ctx.storage.get('room'))) await this.ctx.storage.put('room', newRoom(code, DEFAULT_RULES))
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server, [playerId])        // hibernation: the room can sleep between messages
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const [playerId] = this.ctx.getTags(ws)
    let msg: ClientMsg
    try { msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)) } catch { return }
    await this.update(core => core.handle(playerId, msg, Date.now()))
  }

  async webSocketClose(ws: WebSocket) {
    const [playerId] = this.ctx.getTags(ws)
    // still here in another tab? then they haven't left
    if (this.ctx.getWebSockets(playerId).some(w => w !== ws && w.readyState === WebSocket.OPEN)) return
    await this.update(core => core.leave(playerId, Date.now()))
  }

  async webSocketError(ws: WebSocket) { await this.webSocketClose(ws) }

  async alarm() {
    await this.update(core => core.tick(Date.now()))
  }

  // Load the room, apply a change, store it, set the next alarm, and tell the players.
  private async update(change: (core: RoomCore) => Out[]) {
    const state = await this.ctx.storage.get<RoomState>('room')
    if (!state) return
    const core = new RoomCore(state)
    const out = change(core)
    await this.ctx.storage.put('room', core.s)
    if (core.s.wakeAt !== null) await this.ctx.storage.setAlarm(core.s.wakeAt)
    else await this.ctx.storage.deleteAlarm()
    for (const o of out) {
      const text = JSON.stringify(o.msg)
      for (const ws of this.ctx.getWebSockets(o.to)) {
        try { ws.send(text) } catch { /* closing — they'll get the next update when they reconnect */ }
      }
    }
  }
}
