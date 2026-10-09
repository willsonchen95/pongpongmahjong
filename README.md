# Pong Pong Mahjong!

**Hong Kong mahjong, free in your browser — on iPhone, Android and PC, all playing together.**

### ▶ [Play it at pongpongmahjong.pages.dev](https://pongpongmahjong.pages.dev/)

![Pong Pong Mahjong! on a computer and a phone](public/og-image.jpg)

Share a room code with friends, or practise against bots — even offline. Played for fun: no money,
no betting, no download, no sign-up.

## Features

- **Online rooms with friends** — private rooms joined by a short code; bots fill any empty seats,
  and a player who drops out can reconnect to their seat.
- **Bots at three levels**, plus a guided first game and beginner tips for people new to mahjong.
- **Hong Kong scoring**, with a reveal that shows each faan pattern in turn and lights up the tiles
  that earned it. A *Family style* option drops the points and just asks for a minimum faan.
- **Voice calls** — record your own *Pong!*, *Chi!*, *Kong!* and *Mahjong!* for friends to hear.
- **Your record** — history, best hand and 17 challenges, kept on the device only.
- **English and Bahasa Indonesia**, switchable from the main menu.
- **Installs like an app** (PWA) and plays against the bots with no connection.

## How it's built

No game framework and no UI library — TypeScript, the DOM and CSS.

| Part | What it does |
|---|---|
| `src/engine.ts` | The rules: the wall, calls (pong, chi, kong), winning hands and faan scoring |
| `src/main.ts`, `src/ui.ts`, `src/table.ts` | The game screens and the table, laid out for phones held either way and for computers |
| `src/online.ts` | The browser side of online play, over WebSockets |
| `server/` | A Cloudflare Worker with a Durable Object per room: it runs the game with the same rules engine as the browser, so every player sees the same table and no one can cheat from their own copy; it also rate-limits connections and messages |
| `functions/` | Cloudflare Pages Functions that pass `/api` and `/rooms` through to the Worker |
| `src/sw.js` | The service worker that makes the game installable and playable offline |

Tested with Vitest (the rules engine, the room server, scoring, translations and the record).

**Stack:** TypeScript · Vite · Vitest · Cloudflare Pages, Workers and Durable Objects

## Running it locally

```sh
npm install
npm run dev          # the game, at http://localhost:5173
npm run server:dev   # the room server, for online play
npm test             # the tests
```

## Licence

© 2026 Wilson Chen. All rights reserved — the code is here to read, not to reuse; see
[LICENSE](LICENSE). Music: "Moonlit Whispers" by kaazoom (Pixabay). Font: LXGW WenKai TC (SIL OFL 1.1).
