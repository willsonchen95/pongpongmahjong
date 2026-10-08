// The Cloudflare side of the play counts and feedback: one Durable Object for the whole game (named
// "stats"), keeping them in its own small SQLite database. The checks and the page are in stats-core.ts.

import { DurableObject } from 'cloudflare:workers'
import { dayOf, daysBefore, type EventType, type Feedback, type Summary, type DayRow, type FeedbackRow } from './stats-core'

const KEEP_DAYS = 90                    // who played on which day is kept this long (enough for "last 30 days")

// Only a hash of each browser's id is kept, so the stats can't be matched back to a seat in a room.
async function hashId(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pongpong-stats:' + id))
  return Array.from(new Uint8Array(digest).slice(0, 12), b => b.toString(16).padStart(2, '0')).join('')
}

export class Stats extends DurableObject {
  private get sql() { return this.ctx.storage.sql }

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS counts (day TEXT, type TEXT, n INTEGER, PRIMARY KEY (day, type));
      CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, first_day TEXT, last_day TEXT);
      CREATE TABLE IF NOT EXISTS active (day TEXT, id TEXT, PRIMARY KEY (day, id));
      CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, rating INTEGER,
        comment TEXT, email TEXT, player TEXT, version TEXT, place TEXT, device TEXT);`)
  }

  async record(type: EventType, player: string, now = Date.now()) {
    const day = dayOf(now), id = await hashId(player)
    this.sql.exec('INSERT INTO counts VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1', day, type)
    this.sql.exec('INSERT INTO players VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET last_day = excluded.last_day', id, day, day)
    const seen = this.sql.exec('INSERT OR IGNORE INTO active VALUES (?, ?)', day, id).rowsWritten > 0
    if (seen && Math.random() < 0.02) this.sql.exec('DELETE FROM active WHERE day < ?', daysBefore(day, KEEP_DAYS))
  }

  async addFeedback(f: Feedback, device: string, now = Date.now()) {
    this.sql.exec('INSERT INTO feedback (at, rating, comment, email, player, version, place, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      now, f.rating, f.comment, f.email, await hashId(f.player), f.version, f.where, device)
  }

  async summary(now = Date.now()): Promise<Summary> {
    const today = dayOf(now)
    const one = (q: string, ...args: (string | number)[]) => Number(this.sql.exec(q, ...args).one().n)
    const activeSince = (n: number) => one('SELECT COUNT(DISTINCT id) AS n FROM active WHERE day >= ?', daysBefore(today, n - 1))
    const since = daysBefore(today, 29)
    const days = new Map<string, DayRow>()
    const row = (day: string) => days.get(day) ?? days.set(day, { day, active: 0, fresh: 0, counts: {} }).get(day)!
    for (const r of this.sql.exec<{ day: string; n: number }>('SELECT day, COUNT(*) AS n FROM active WHERE day >= ? GROUP BY day', since)) row(r.day).active = r.n
    for (const r of this.sql.exec<{ day: string; n: number }>('SELECT first_day AS day, COUNT(*) AS n FROM players WHERE first_day >= ? GROUP BY first_day', since)) row(r.day).fresh = r.n
    for (const r of this.sql.exec<{ day: string; type: EventType; n: number }>('SELECT day, type, n FROM counts WHERE day >= ?', since)) row(r.day).counts[r.type] = r.n
    const feedback = this.sql.exec<{ at: number; rating: number | null; comment: string; email: string; version: string; place: string; device: string }>(
      'SELECT at, rating, comment, email, version, place, device FROM feedback ORDER BY id DESC LIMIT 500').toArray()
      .map((f): FeedbackRow => ({ ...f, where: f.place }))
    return {
      today,
      players: one('SELECT COUNT(*) AS n FROM players'),
      active: { today: activeSince(1), week: activeSince(7), month: activeSince(30) },
      days: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)),
      feedback,
    }
  }
}
