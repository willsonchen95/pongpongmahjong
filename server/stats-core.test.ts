import { describe, it, expect } from 'vitest'
import { parseEvent, parseFeedback, statsPage, deviceOf, daysBefore, MAX_COMMENT, type Summary } from './stats-core'

const player = 'abcdef0123456789'

describe('play counts', () => {
  it('takes the known events from a proper player id', () => {
    expect(parseEvent(JSON.stringify({ type: 'bot-game', player }))).toEqual({ type: 'bot-game', player })
  })
  it('turns away anything else', () => {
    for (const bad of ['', 'nope', '[]', JSON.stringify({ type: 'hack', player }), JSON.stringify({ type: 'open', player: 'x' }),
      JSON.stringify({ type: 'toString', player }), JSON.stringify({ type: 'open', player: '<script>alert(1)</script>' })]) {
      expect(parseEvent(bad)).toBeNull()
    }
  })
})

describe('feedback', () => {
  const send = (f: object) => parseFeedback(JSON.stringify({ player, ...f }))
  it('takes a rating, a comment, or both', () => {
    expect(send({ rating: 5 })).toMatchObject({ rating: 5, comment: '' })
    expect(send({ comment: '  Love it  ' })).toMatchObject({ rating: null, comment: 'Love it' })
  })
  it('needs one of them, and a rating of 1 to 5', () => {
    expect(send({})).toBeNull()
    expect(send({ comment: '   ' })).toBeNull()
    expect(send({ rating: 6, comment: 'hi' })).toMatchObject({ rating: null })
    expect(send({ rating: 2.5 })).toBeNull()
  })
  it('turns away very long comments and odd emails', () => {
    expect(send({ comment: 'x'.repeat(MAX_COMMENT + 1) })).toBeNull()
    expect(send({ comment: 'hi', email: 'not an email' })).toBeNull()
    expect(send({ comment: 'hi', email: 'me@example.com' })).toMatchObject({ email: 'me@example.com' })
  })
})

describe('the stats page', () => {
  const summary: Summary = {
    today: '2026-10-08', players: 3, active: { today: 2, week: 3, month: 3 },
    days: [{ day: '2026-10-08', active: 2, fresh: 1, counts: { open: 4, 'bot-game': 1 } }],
    feedback: [{ at: Date.parse('2026-10-08T10:00:00Z'), rating: 4, comment: '<img src=x onerror=alert(1)>', email: '"><b>@x.com', version: '1.0.0', where: 'menu', device: 'iPhone · Safari' }],
  }
  const html = statsPage(summary)
  it('shows the numbers and the feedback', () => {
    expect(html).toContain('★★★★☆')
    expect(html).toContain('4.0 ★')
    expect(html).toContain('iPhone · Safari')
  })
  it('never lets what players typed run as HTML', () => {
    expect(html).not.toContain('<img')
    expect(html).toContain('&#34;&#62;&#60;b&#62;@x.com')
    expect(html).toContain('&#60;img')
  })
})

describe('helpers', () => {
  it('counts days back across months', () => expect(daysBefore('2026-10-01', 1)).toBe('2026-09-30'))
  it('describes a device in a few words', () => {
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14; SM-F956B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36')).toBe('Android phone · Samsung Internet')
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari')
  })
})
