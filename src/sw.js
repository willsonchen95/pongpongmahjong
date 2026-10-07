// The offline helper (service worker). vite.config.ts fills in this build's name and file list.
// - The page itself: fetched fresh when there's a connection (so updates arrive), the saved copy offline.
// - Built files: their names change with every build, so the saved copy is always right.
// - The tile-face fonts from Google: saved the first time, then used from the phone.
// - The music and the room server: left alone.
const CACHE = '__CACHE__'
const FILES = __FILES__
const FONTS = 'ppm-fonts'

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()))
})

// a new version takes over straight away and clears out the files of older ones
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const saved = await c.match(req)
      if (saved) return saved
      const res = await fetch(req)
      if (res.ok || res.type === 'opaque') c.put(req, res.clone())
      return res
    }))
    return
  }
  if (url.origin !== location.origin || url.pathname.startsWith('/music/')) return

  if (req.mode === 'navigate') {
    // on a weak connection, don't keep the player staring at a blank screen: after 3 seconds
    // open the saved copy (the fresh one is still saved for next time when it arrives)
    const fresh = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); return caches.open(CACHE).then(c => c.put('/', copy)).then(() => res) }
      return res
    })
    e.waitUntil(fresh.catch(() => {}))
    const saved = () => caches.match('/', { cacheName: CACHE })
    const slow = new Promise(done => setTimeout(done, 3000)).then(saved)
    e.respondWith(Promise.race([fresh.catch(saved), slow.then(s => s ?? fresh)]))
    return
  }
  e.respondWith(caches.match(req, { cacheName: CACHE }).then(saved => saved ?? fetch(req)))
})
