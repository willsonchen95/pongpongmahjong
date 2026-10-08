// Online rooms through the site's own address: /rooms/<code>/ws on pongpongmahjong.pages.dev is handed
// to the room server (server/) over a service binding, so phones and networks that block workers.dev
// addresses can still play. The binding, ROOMS_SERVER -> the pongpongmahjong-rooms Worker, is set in
// the Cloudflare dashboard (Pages project > Settings > Bindings). The request goes on unchanged, so the
// room server still sees the player's own address for its connection limit.

interface Env { ROOMS_SERVER?: Fetcher }

export const onRequest: PagesFunction<Env> = ({ request, env }) =>
  // not linked yet: say so, and the game goes straight to workers.dev instead
  env.ROOMS_SERVER ? env.ROOMS_SERVER.fetch(request) : new Response('Room server not linked', { status: 503 })
