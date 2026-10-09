import { describe, it, expect } from 'vitest'
import { ID } from './i18n-id'
import { CHALLENGES } from './record'
import { CHANGELOG } from './changelog'
import { SEATS } from './engine'
import roomCore from '../server/room-core.ts?raw'

// Every phrase the game shows must have its Indonesian (i18n-id.ts), with the same blanks ({name}…).
// Phrases are found two ways: the English literals passed to t() anywhere in the code, and the
// phrases that live in lists and are translated where they're shown (patterns, challenges, …).

// the game's source files, as text
const files = import.meta.glob<string>(['./*.ts', '!./*.test.ts', '!./i18n-id.ts'], { query: '?raw', import: 'default', eager: true })
const read = (name: string) => files[`./${name}`]
const sources = Object.keys(files).map(k => k.slice(2))

// The quoted strings inside each t( … ) call (including a choice like t(a ? 'x' : 'y')).
function phrasesInCalls(code: string): string[] {
  const out: string[] = []
  const call = /(?<![\w.$])t\(/g
  for (let m = call.exec(code); m; m = call.exec(code)) {
    let depth = 1, i = m.index + 2, braces = 0
    while (i < code.length && depth > 0) {
      const c = code[i]
      if (c === "'") {
        let j = i + 1, s = ''
        while (code[j] !== "'") { if (code[j] === '\\') { s += code[j + 1]; j += 2 } else s += code[j++] }
        if (braces === 0) out.push(s)                    // (not the values filled into the blanks)
        i = j + 1
        continue
      }
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === '{') braces++
      else if (c === '}') braces--
      i++
    }
  }
  return out
}
const all = (re: RegExp, code: string) => [...code.matchAll(re)].map(m => m[1])

const literal = sources.flatMap(f => phrasesInCalls(read(f)).map(p => ({ p, f })))
const listed = [
  ...SEATS, ...CHALLENGES.flatMap(c => [c.title, c.hint]), ...CHANGELOG.flatMap(r => r.notes),
  ...all(/name: '([^']+)'/g, read('rules-guide.ts')), ...all(/what: '([^']+)'/g, read('rules-guide.ts')),
  ...all(/'(Seat wind pong|Round wind pong)': '([^']+)'/g, read('rules-guide.ts')),
  ...all(/\['[^']+', '([^']+)'\]/g, read('faan-card.ts')),
  ...all(/\bhow: '([^']+)'/g, read('engine.ts')),
  ...all(/name: '([^']+)'/g, read('engine.ts')), 'Seat wind pong', 'Round wind pong',
  ...all(/name: '([^']+)'/g, read('emotes.ts')),
  ...all(/message: '([^']+)'/g, roomCore),
  ...all(/'([^']+)'/g, read('tiles.ts').match(/const HONOR_NAMES[\s\S]*?\n}/)![0]),
  ...all(/: '(\{n\} \w+)'/g, read('tiles.ts')),
].map(p => ({ p, f: '(lists)' }))

const blanks = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')

describe('Bahasa Indonesia', () => {
  it('finds the phrases (a sanity check on the search itself)', () => {
    expect(literal.length).toBeGreaterThan(500)
    expect(literal.map(x => x.p)).toContain('Your turn')
  })
  it('has every phrase the game shows', () => {
    const missing = [...literal, ...listed].filter(({ p }) => !(p in ID)).map(({ p, f }) => `${f}: ${p}`)
    expect([...new Set(missing)]).toEqual([])
  })
  it('keeps the same blanks in every translation', () => {
    const wrong = Object.entries(ID).filter(([en, id]) => blanks(en) !== blanks(id)).map(([en]) => en)
    expect(wrong).toEqual([])
  })
})
