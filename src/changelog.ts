// What changed in each version, newest first — shown at the end of the About page. When releasing,
// add an entry here and set the same version in package.json (npm version <x.y.z> --no-git-tag-version).

export interface Release { version: string; date: string; notes: string[] }   // date: YYYY-MM-DD; notes in English (translated where shown)

export const CHANGELOG: Release[] = [
  {
    version: '1.2.0', date: '2026-10-12',
    notes: [
      'Phones look like a real table: tiles with real depth, a sage cloth with a lotus border, and the table filling the screen, held upright or sideways.',
      'Bigger tiles on the table on phones, so the discards and the other players’ sets are easy to read.',
      'The other players’ hands stand at the back of their rack with their sets laid in front — and stay on the table when the hand is over.',
      'A clearer screen on phones: the buttons fold away behind ⋯, your score and tips sit in the corners, and whose turn it is lights up on the table.',
      'End the game from the result screen, between hands.',
      'Learn to play is now one short guided hand, and your record counts hands.',
      'Starting points: each player starts with points and the game ends when someone runs out.',
      'Online: a countdown on the table shows how long is left to play or call.',
    ],
  },
  {
    version: '1.1.0', date: '2026-10-09',
    notes: [
      'Bahasa Indonesia: switch between English and Indonesian on the main menu (EN | ID). Phones set to Indonesian start in Indonesian.',
      'A calm new look: a tea-house table with a printed mat, brush-lettered tiles in soft colours, and a quiet tea room around the game.',
      'Family style: no points — just reach the minimum faan to win (choose any minimum from 0 to 10). The most hands won wins the game.',
      'See how a hand scored: each faan pattern appears in turn and lights up the tiles that earned it. Tap a pattern to see what it means.',
      'Your record: your history, your biggest hand and 17 challenges to collect — kept on your device only.',
      'Reactions drawn as a little tea-house cast: a panda, a bao, a koi, a teacup, a teapot and a lion dance.',
      'Calmer sounds, new background music, and Chi spoken in Chinese.',
      'An About page that says plainly what the game is: free, played for fun, no money and no sign-up.',
      'Easier to read: the discards stand out on the table, and ties share their place in the final standings.',
    ],
  },
  {
    version: '1.0.0', date: '2026-10-08',
    notes: [
      'The first version: Hong Kong mahjong in the browser, on phones and computers.',
      'Play against bots at three levels, or learn with a guided game and beginner tips.',
      'Private online rooms with friends — share a code; bots fill any empty seats.',
      'Record your own Pong!, Chi!, Kong! and Mahjong! calls for your friends to hear.',
      'Installs like an app on phones, and plays against the bots offline.',
    ],
  },
]
