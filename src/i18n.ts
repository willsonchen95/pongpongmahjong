// The game's languages: English, as written in the code, and Bahasa Indonesia (i18n-id.ts). Every
// phrase shown on screen goes through t(), keyed by its English; blanks like {name} are filled in from
// `vars` (so each language can put them where its grammar wants). A phrase with no translation shows
// in English — and i18n.test.ts fails, so none slips through.

import { ID } from './i18n-id'

export type Lang = 'en' | 'id'
const KEY = 'mahjong-lang'

// The language chosen before, or else the device's: Indonesian phones start in Indonesian.
export let lang: Lang = (() => {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'id') return saved
  } catch { /* storage unavailable */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('id') ? 'id' : 'en'
})()
if (typeof document !== 'undefined') document.documentElement.lang = lang

export function setLang(l: Lang) {
  lang = l
  try { localStorage.setItem(KEY, l) } catch { /* kept for this visit only */ }
  document.documentElement.lang = l
}

export function t(en: string, vars?: Record<string, string | number>): string {
  const s = lang === 'id' ? (ID[en] ?? en) : en
  return vars ? s.replace(/\{(\w+)\}/g, (blank, k: string) => (k in vars ? String(vars[k]) : blank)) : s
}

// Numbers and dates the way the language writes them (1,000 / 1.000).
export const locale = () => (lang === 'id' ? 'id-ID' : 'en-US')

// A faan pattern's name, as the engine gives it — "Dragon pongs ×2" is the Dragon pong, twice.
export function faanName(name: string): string {
  const m = name.match(/^(.*?)( ×\d+)$/)
  return m ? t(m[1]) + m[2] : t(name)
}
