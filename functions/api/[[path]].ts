// Play counts, feedback and the stats page through the site's own address: /api/* on
// pongpongmahjong.pages.dev is handed to the room server, just as rooms/[[path]].ts does for rooms.

interface Env { ROOMS_SERVER?: Fetcher }

export const onRequest: PagesFunction<Env> = ({ request, env }) =>
  env.ROOMS_SERVER ? env.ROOMS_SERVER.fetch(request) : new Response('Room server not linked', { status: 503 })
