// Takes the link-preview picture: opens scripts/og-card.html from the running dev server (`npm run dev`)
// in Chrome without a window and saves it as public/og-image.jpg (1200×630, what LinkedIn and others
// want; a JPEG is a quarter the size of the PNG Chrome takes).
// Run with `node scripts/make-og-image.mjs [dev server address]`; the result is committed.
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const server = process.argv[2] ?? 'http://localhost:5173'
const chrome = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find(p => p && existsSync(p))
if (!chrome) throw new Error('Chrome not found: set CHROME to its path')

const png = resolve('public/og-image.png'), out = resolve('public/og-image.jpg')
execFileSync(chrome, [
  '--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630',
  '--virtual-time-budget=8000',                     // time for the fonts and tiles to load
  `--screenshot=${png}`, `${server}/scripts/og-card.html`,
], { stdio: 'inherit' })
await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toFile(out)
rmSync(png)
console.log('wrote', out)
