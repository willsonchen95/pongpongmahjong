// Draws the app icon (a 中 tile on red lacquer) and writes the PNGs the install manifest needs.
// Run with `node scripts/make-icons.mjs` after changing the drawing; the results are committed.
// The 中 is drawn with shapes, not a font, so it looks the same on every computer.
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'

// `scale` shrinks the tile: maskable icons get cropped to a circle or squircle by the phone,
// so their tile has to stay inside the middle 80%.
function iconSvg(scale = 1, rounded = false) {
  const s = 512, w = 290 * scale, h = 380 * scale, x = (s - w) / 2, y = (s - h) / 2 - 10 * scale
  const r = 34 * scale, edge = 26 * scale
  const u = (fx, fy) => [x + w * fx, y + h * fy]           // a point on the tile face, as fractions of it
  const [bx, by] = u(0.2, 0.36), bw = w * 0.6, bh = h * 0.28, t = w * 0.11
  const [vx, vy] = u(0.5 - 0.06, 0.16)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="#b52a25"/><stop offset="1" stop-color="#6e1210"/></radialGradient>
    <linearGradient id="face" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ece8dc"/></linearGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="${rounded ? 112 : 0}" fill="url(#bg)"/>
  <rect x="${x}" y="${y + edge + 10 * scale}" width="${w}" height="${h}" rx="${r}" fill="#000" opacity="0.28"/>
  <rect x="${x}" y="${y + edge}" width="${w}" height="${h}" rx="${r}" fill="#1f2a6e"/>
  <rect x="${x}" y="${y + edge * 0.45}" width="${w}" height="${h}" rx="${r}" fill="#3445a8"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#face)"/>
  <rect x="${bx + t / 2}" y="${by + t / 2}" width="${bw - t}" height="${bh - t}" rx="${t * 0.35}" fill="none" stroke="#c8211c" stroke-width="${t}"/>
  <rect x="${vx}" y="${vy}" width="${w * 0.12}" height="${h * 0.68}" rx="${t * 0.3}" fill="#c8211c"/>
</svg>`
}

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/favicon.svg', iconSvg(1, true))
const out = [
  ['icon-192.png', 192, iconSvg()],
  ['icon-512.png', 512, iconSvg()],
  ['maskable-512.png', 512, iconSvg(0.74)],
  ['apple-touch-icon.png', 180, iconSvg()],                // iPhones round the corners themselves
]
for (const [name, size, svg] of out) await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/${name}`)
console.log('icons written')
