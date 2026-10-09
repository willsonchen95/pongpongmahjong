// The beginner tips: what each one says, and what on screen it points at. main.ts decides when
// each is shown (only the first time, and only with tips on).
import { el, para, exampleTiles } from './ui'

// One step of a tip: a title and text, pointing at `target` (a CSS selector) if given.
export interface CoachStep { target?: string; title: string; body: (string | Node)[] }
export type Steps = CoachStep[] | (() => CoachStep[])

export const TIPS = {
  dice: (): CoachStep[] => [{
    target: '.table-dice', title: 'Rolling the dice',
    body: ['Every hand starts with the dealer rolling two dice. The total decides where the wall is opened.', 'You don’t need to do anything — just watch.'],
  }],
  deal: (): CoachStep[] => [{
    target: '.player-rack', title: 'Your 13 tiles',
    body: ['Everyone is dealt 13 tiles, four at a time. Yours are here at the bottom — the other players’ tiles stand face-down on their racks.'],
  }],
  flowers: (): CoachStep[] => [{
    title: 'Flowers & seasons',
    body: ['These are bonus tiles. They’re put aside face-up and replaced with a new tile automatically.',
      'A flower or season showing your seat number (East 1, South 2…) scores +1 faan.'],
  }],
  firstTurn: (): CoachStep[] => {
    const example = el('div', 'example-hand')
    for (const spec of ['123m', '555p', '111z', '789s', '66z']) example.appendChild(exampleTiles(spec))
    return [
      { title: 'How to win', body: [para('Make ', el('strong', '', '4 sets and 1 pair'), ' — 14 tiles, like this:'), example,
          'A set is three the same (a Pong) or three in a row of one suit (a Chi).'] },
      { target: '.player-rack', title: 'Your turn',
        body: ['You just drew a tile — it’s set apart on the right. Now you have one tile too many.', matchMedia('(pointer: coarse)').matches
          ? 'Tap the tile you need least to lift it, then tap it again to throw it away.'
          : 'Tap the tile you need least to throw it away.'] },
      { target: '.hm-total', title: 'Your hand’s score',
        body: ['This shows the faan your hand already has.', 'Hover over it — or tap it — to see what you have and what to aim for next.'] },
      { target: '.status-pill', title: 'What’s happening',
        body: ['This tells you whose turn it is. It glows gold whenever it’s your move.'] },
      { target: '.rules-chip', title: 'The rule book',
        body: ['Stuck? Tap here any time to open the rule book — every set and every scoring pattern, with pictures.',
          'Tap it again to close it and get back to the table.'] },
    ]
  },
  claim: (): CoachStep[] => [{
    target: '.claim-card', title: 'You can take this tile',
    body: ['Someone threw away a tile you can use:',
      para(el('strong', '', 'Pong'), ' — make three the same.  ', el('strong', '', 'Chi'), ' — make three in a row (only from Lin, on your left).'),
      para(el('strong', '', 'Mahjong!'), ' — the tile finishes your hand: you win.'),
      'Taking a tile lays that set face-up, and you lose the Concealed hand bonus. Not sure? Press Pass.'],
  }],
  botCall: (name: string) => (): CoachStep[] => [{
    title: `${name} called!`,
    body: [`${name} took the tile that was just thrown away, to make a set. They lay it face-up on the table, then throw away a tile of their own.`,
      'Play carries on from them — so a turn can be skipped.'],
  }],
  ready: (): CoachStep[] => [{
    target: '.hm-ready', title: 'One tile from winning!',
    body: ['Any of these tiles would finish your hand. If someone throws one away, a Mahjong! button appears.',
      'Draw it from the wall yourself and you score +1 faan more.'],
  }],
  result: (): CoachStep[] => [{
    target: '.result-cols', title: 'How the hand scored',
    body: ['The winner scores faan for the patterns in their hand. Tap a pattern to see which tiles earned it.',
      'In Hong Kong style, whoever threw the winning tile pays; if the winner drew it themselves, all three others pay.'],
  }],
}
