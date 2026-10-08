import { defineConfig, type Plugin } from 'vite'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

// The version shown at the bottom of the main menu: package.json's version.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// The offline helper (service worker), written at build time so it knows every file of this build.
// It keeps the game on the phone, so the installed app opens instantly and bots play offline.
// The music is left out (5 MB, and played in pieces), so offline games are just quiet.
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const built = Object.keys(bundle)
      const icons = readdirSync(new URL('./public/icons', import.meta.url)).map((f: string) => `icons/${f}`)
      const files = ['', ...built, 'favicon.svg', 'manifest.webmanifest', ...icons].map(f => '/' + f)
      const id = createHash('sha256').update(built.sort().join()).digest('hex').slice(0, 10)
      const source = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8')
        .replace('__CACHE__', `ppm-${id}`)
        .replace('__FILES__', JSON.stringify(files))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// Cloudflare Web Analytics (visitors, countries, where they came from; no cookies), added to the
// built page only, so playing on this computer isn't counted. The token isn't a secret: it only
// says which site the visits belong to.
function webAnalytics(): Plugin {
  return {
    name: 'web-analytics',
    apply: 'build',
    transformIndexHtml: () => [{
      tag: 'script', injectTo: 'body',
      attrs: { defer: true, src: 'https://static.cloudflareinsights.com/beacon.min.js', 'data-cf-beacon': '{"token": "281aea6b9ed24e9dab514a9d1a42a19f"}' },
    }],
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [serviceWorker(), webAnalytics()],
})
