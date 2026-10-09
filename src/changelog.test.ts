import { describe, it, expect } from 'vitest'
import { CHANGELOG } from './changelog'
import pkg from '../package.json'

describe('the changelog', () => {
  it('its newest entry is the version being released (package.json)', () => {
    expect(CHANGELOG[0].version).toBe(pkg.version)
  })
  it('newest first, every version once, each with notes', () => {
    const versions = CHANGELOG.map(r => r.version)
    expect(new Set(versions).size).toBe(versions.length)
    const asNumbers = versions.map(v => v.split('.').map(Number))
    for (let i = 1; i < asNumbers.length; i++) {
      const [a, b] = [asNumbers[i - 1], asNumbers[i]]
      const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
      expect(newer).toBeGreaterThan(0)
    }
    for (const r of CHANGELOG) expect(r.notes.length).toBeGreaterThan(0)
  })
})
