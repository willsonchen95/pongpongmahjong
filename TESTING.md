# How Pong Pong Mahjong! is tested

I built this game on my own, from the first idea to the live site, and my background is QA. This
page covers how it's tested, the bugs that taught me the most, and how feedback from players changed
the game.

## The approach

**Automate where a bug costs most.** Mistakes in the rules or on the room server ruin a game for
everyone at the table, so that's where most of the automated tests are:

| Test file | What it covers |
|---|---|
| `src/engine.test.ts` | The rules: the wall, calls, winning hands, special hands, faan scoring |
| `src/table.test.ts` | The turn flow, and what happens when a player runs out of time |
| `server/room-core.test.ts` | Online rooms: joining, leaving, reconnecting, timeouts, the host leaving, players arriving mid-game |
| `server/stats-core.test.ts` | Anonymous play counts and feedback |
| `src/record.test.ts` | The player's record and challenges, including old or damaged saved data |
| `src/i18n.test.ts` | Every English text has an Indonesian translation |
| `src/changelog.test.ts` | The changelog and the version number stay in step |

125 tests in all, run on every push by GitHub Actions together with typechecks and a build.

**Make cheating impossible by design.** The room server runs the game with the same rules engine as
the browser. A player's browser only *asks* to make a move, the server decides whether it's legal,
and each player gets only what they're allowed to see. The server also rate-limits connections and
messages, checks everything players send, and deletes rooms left empty for a day.

**Test on real devices, the way people really play.** Bugs in online play only show up with real
phones on real networks, so I tested by playing with friends:

- **Samsung Galaxy Z Fold 5**: folded (cover screen) and unfolded, upright and sideways
- **Friends' phones** on their own mobile networks
- **Chrome on Windows 11** for the computer version
- Whole games played automatically through the app, in both scoring styles, at desktop and phone
  sizes, plus two-player online games against a local room server before each release

## Bugs that taught me the most

Each case follows the same steps: what players saw, how I found the cause, the fix, and what stops
it from coming back.

### 1. Friends' phones stuck on "Connecting…"

- **What players saw:** On some friends' phones, *Play online* never got past "Connecting…". It
  worked on my phone and on wi-fi, so the code didn't look broken.
- **Root cause:** The room server lived on a `workers.dev` address, and some mobile networks, ad
  blockers and Private DNS settings block `workers.dev`. The game wasn't failing; it was being blocked
  before it could connect.
- **Fix (two steps):**
  1. First, so players weren't left guessing: after 8 seconds of "Connecting…", the game explains the
     likely causes (network, ad blocker, Private DNS) and what to try.
  2. Then the real fix: the game now reaches the room server through **its own address**, with a
     Cloudflare Pages Function passing the connection on. It falls back to `workers.dev` only if that
     doesn't answer, so the change was safe to deploy before the new route was switched on.
- **Lesson:** "Works on my phone" isn't a test result. The device matrix has to include other
  people's networks.

### 2. Invite links opened the main menu on Android

- **What players saw:** Tapping a friend's invite link on Android sometimes landed on the main menu
  instead of the room.
- **Root cause:** A race. Chrome on Android fires its "install this app" event a moment after the
  page loads, and handling it redrew the main menu *over* the invite screen that had just opened.
  Desktop and iPhone don't fire that event in the same way, so they never showed it.
- **Fix:** The install prompt no longer redraws the screen the player is on.
- **Lesson:** Events that arrive late (install prompts, reconnects, timers) need testing against
  every screen they can interrupt.

### 3. Everyone stuck at "Waiting for others…"

- **What players saw:** After a hand ended, the others waited for ever at "Waiting for others… (1/2)".
- **Root cause (two separate bugs, found in two games):**
  1. If a player *left* at that moment, the server never checked again whether everyone still at the
     table had pressed *Next hand*, so it kept waiting for someone who had gone.
  2. If a player simply went quiet (phone locked, just looking at the table), nothing moved the game
     on.
- **Fix:** The server checks again whenever someone leaves or drops out, and the next hand is dealt
  30 seconds after the last one ends, with a countdown on the button. Short notices now say who left,
  who came back and who joined.
- **Regression tests:** both cases are covered in `server/room-core.test.ts`.

### 4. Friends missing wins online

- **What players saw:** Friends said they had a winning tile and lost it, often to the turn timer.
- **Root cause:** Taking a win used the same pop-up as Pong and Chi, and running out of time counted
  as passing. Under a 15-second timer, that cost people winning hands.
- **Fix:** A winning tile gets a pop-up of its own (*You can win!*, the tile, what it's worth, one big
  button). Passing asks "Give up the win?" first, and running out of time *takes* the win. If a hand
  can't win because it's below the minimum faan, a notice explains why.
- **Regression test:** the timeout case is covered in `src/table.test.ts`.

### 5. A test that failed only on unlucky deals

- **What happened:** The "player runs out of time" test usually passed and sometimes failed.
- **Root cause:** Two wrong assumptions in the test, not in the game. A bot could pong the drawn tile
  at once (so it ended up in a set, not in the discards), and the test answering Alice's claims
  counted as her being active, which reset her timeouts.
- **Fix:** The test looks in the sets as well, and no longer makes Alice look active by accident.
- **Lesson:** A flaky test is a bug report about the test. I fixed the cause instead of re-running it.

### 6. A card that opened by itself (desktop only)

- **What players saw:** After pressing Pong or Chi on a computer, the hand card sometimes popped open
  by itself.
- **Root cause:** When the claim box closed, the button underneath could land under a mouse that
  hadn't moved, and plain CSS `:hover` treated that as hovering.
- **Fix:** The card opens only on a real mouse move onto the button. Phones were never affected
  (they open it with a tap).

## From feedback to changes

**How feedback comes in.** Beyond playing with friends, the game asks for feedback in two ways:

- a **one-tap star rating** on the final results ("How do you like the game?"), then an optional
  *Tell us more*, hidden for 30 days once someone has rated so it doesn't nag
- a **Feedback page** on the menu: stars, a comment and an optional email

Anonymous play counts (games started and finished, rooms created and joined) show where players drop
off. They use no names and no cookies, only a random ID that is hashed on the server, and they're
read on a password-protected page.

**How I handle it.** I sort each piece of feedback into one of three kinds:

1. **A bug** (something doesn't work): reproduce it on the same kind of device, find the cause, fix
   it, and add a regression test where the logic allows. Bugs 1–4 above all started this way.
2. **Confusion** (it works, but people misunderstand it): change what the game *says* rather than
   what it does. For example, the "Connecting…" advice, and the notice explaining why a hand below
   the minimum can't win.
3. **How it feels**: look for a pattern across several people before changing anything, then change
   the design itself (see below).

Each release lists what changed in a changelog on the About page.

### Why the game moved to a calmer, family style

Two pieces of feedback came together:

- **Friends said the game looked like a slot machine.** Gold, glows, light rays and confetti made a
  family card game feel like gambling.
- **People took the link for a scam.** A free game on a `pages.dev` address, with mahjong and
  points, looked like a betting site.

Mahjong is something families play together at home, and the game should feel like that. In
version 1.1.0:

- **A calm tea-house look:** a rice-paper page, a sage table mat, brush-lettered tiles in soft ink
  colours, calmer sounds and new music. All the gold, glows, rays and confetti are gone.
- **Family style beside Hong Kong style:** no points at all. Win by reaching a minimum faan (any
  number from 0 to 10), and whoever wins the most hands wins the game.
- **Saying plainly what the game is:** the menu says *Free to play · No money, bets or prizes · No
  sign-up*, and an About page explains what the game keeps and sends, and why it was made.
- **A score reveal that teaches:** each faan pattern appears in turn and lights up its tiles, so new
  players learn *why* a hand scored.

### A rule that was right, but confusing

After version 1.2.0 a player suggested that Chi should be allowed from any player, because they
kept drawing while waiting for the one tile they needed to finish an all-Chi hand.

- **Investigation:** I read the code instead of guessing. Chi is only allowed from the player before
  you, which is the standard Hong Kong rule. Winning on a discard is allowed from *anyone*, but only
  if the hand reaches the minimum faan. The player was most likely on a 1-faan minimum with a hand
  that scored 0. I confirmed this by playing the same situation with a 0-faan minimum, where the win
  is offered.
- **Decision:** the rule stays as it is, because changing it would make it a different game. This is
  the *confusion* kind of feedback above: change what the game says, not what it does.
- **Next:** the game already explains when a finished hand is below the minimum. The next release
  will name it (a "chicken hand") and explain, in the tips and rules, that a Chi comes only from the
  player before you.
