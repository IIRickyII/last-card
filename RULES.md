# Rules reference

Every rule parameter the game uses, where it comes from, and the test that checks it. Tests live in `tests/engine.test.js` (E) and `tests/room.test.js` (R). Run them with `node --test tests/`.

Sources:
- **Classic:** Mattel's standard rules for the 108-card deck.
- **Flip:** Mattel instruction sheet GDR44.
- **No Mercy:** Mattel instruction sheet HVW18.
- **Liar:** the published rules for the Liar edition (2025). The rule guides disagree on challenge penalties; we follow the box text they quote.

## Shared by all modes

| Parameter | Rule | Test |
|---|---|---|
| Players | 4–8 here. Official: Classic and Flip 2–10, No Mercy 2–6 | E `deck composition` |
| Hand size | 7 cards each | E `deck composition`, `opening card …` |
| Who starts | The seat left of the dealer. A random seat starts a room's first game; the deal then moves one seat clockwise each round and carries on into the next game | E `first: …`, `rounds: nextRound resets state…`, R `deal: …`, `lobby: toLobby…` |
| A legal play | Same color, same number or symbol, or a wild | E `matching: …` |
| Can't or won't play | Draw 1. If it fits you may play it at once, but no other card (Classic, Flip, Liar) | E `draw: …` |
| Calling "last card" | Call when you go down to one card. Caught before the next player starts their turn: draw 2 | E `last card: …` |
| Draw pile runs out | Shuffle the discard pile, except its top card, into a new draw pile | E `reshuffle: …` |
| Winning a round | Score the cards left in the other hands. The first player to reach the target wins the game | E `scoring: …`, `points: every card face…` |

## Classic (108 cards)

| Parameter | Official rule | Test |
|---|---|---|
| Deck | Per color: one 0, two each of 1–9, two Skip, two Reverse, two Draw 2. Plus 4 Wild and 4 Wild Draw 4 | E `deck composition: classic` |
| Opening card | Takes effect. Skip: the first player is skipped. Reverse: the dealer starts and play goes the other way. Draw 2: the first player draws 2 and is skipped. Wild: the first player picks the color. Wild Draw 4: back into the deck, shuffle, turn up another | E `opening card follows the official classic rule`, `opening Wild…` |
| Draw 2 | The next player draws 2 and loses their turn. No stacking | E `classic: draw two makes next draw exactly 2…` |
| Wild Draw 4 | Only legal when you hold no card of the color in play; the next player may challenge. Guilty: the player who played it draws 4. Innocent: the challenger draws 6 and loses their turn. Accepting: draw 4 and lose the turn | E `classic: wd4…` |
| Challenged hand | The challenged player shows their hand to the challenger, and only to them | E `challenge: the challenger alone sees…` |
| Going out on Draw 2 or Wild Draw 4 | The next player still draws, and those cards are scored | E `scoring: going out on a draw card…` |
| Points | Numbers at face value. Skip, Reverse, Draw 2: 20. Wild, Wild Draw 4: 50 | E `points: every card face…` |
| Target | 500 | UI default |

## Flip (112 double-sided cards)

| Parameter | Official rule | Test |
|---|---|---|
| Deck | Light side per color (red, yellow, green, blue): two each of 1–9, two each of Draw 1, Reverse, Skip, Flip. Plus 4 Wild and 4 Wild Draw 2. Dark side per color (pink, teal, orange, purple): two each of 1–9, two each of Draw 5, Reverse, Skip Everyone, Flip. Plus 4 Wild and 4 Wild Draw Color | E `deck composition: flip` |
| What you see | Your own cards' active side; the other side of everyone else's cards and of the top draw card | E `view redaction: flip at many states…` |
| Opening card | As in Classic, with Draw 1 in place of Draw 2. Wild Draw 2 goes back into the deck | E `opening card follows the official flip rule` |
| Flip card | The whole discard pile turns over, so the Flip card goes to the bottom. The draw pile turns over too, and every hand flips | E `flip: the whole discard pile turns over…` |
| Draw 1 / Draw 5 | The next player draws 1 or 5 and loses their turn | E `flip: light d1…`, `flip: dark d5…` |
| Skip Everyone | Everyone else is skipped; the same player plays again | E `flip: dark skipall…` |
| Wild Draw 2 | Like Wild Draw 4: draw 2. A failed challenge costs 2 + 2 | E `flip: Wild Draw 2 accepted…`, `…challenged and guilty…`, `…challenged and innocent…` |
| Wild Draw Color | The next player draws until the chosen color shows. Challenge guilty: the player who played it draws until the color. Innocent: the challenger draws until the color, then 2 more | E `flip: wdc…`, `flip: Wild Draw Color challenged and innocent…`, `…challenged and guilty…` |
| Going out on a draw card | Draw 1 / 5 / 2 make the next player draw. Wild Draw Color: choose the color, then the next player draws until it shows | E `flip: going out on Wild Draw Color…` |
| Points (side the round ends on) | Numbers at face value. Draw 1: 10. Draw 5, Reverse, Skip, Flip: 20. Skip Everyone: 30. Wild: 40. Wild Draw 2: 50. Wild Draw Color: 60 | E `points: every card face…` |
| Target | 500 | UI default |

## No Mercy (168 cards)

| Parameter | Official rule | Test |
|---|---|---|
| Deck | Per color: two each of 0–9, three Draw 2, two Draw 4, three Skip, two Skip Everyone, three Reverse, three Discard All. Plus 8 Wild Reverse Draw 4, 4 Wild Draw 6, 4 Wild Draw 10, 8 Wild Color Roulette | E `deck composition: nomercy` |
| Opening card | An action card is ignored and the next card goes on top, until a number shows | E `opening card follows the official nomercy rule` |
| Can't play | Keep drawing until a card fits, then **you must play it** | E `nomercy: a card drawn because nothing fit must be played` |
| Stacking | Answer a draw card with one of equal or higher value (+2, +4, +6, +10, any color), or take the whole stack and lose your turn | E `nomercy: …stack…` |
| Wild Reverse Draw 4 | Reverses play, then the next player in the new direction faces +4. With two players left the 4 come back to whoever played it, who may stack them back | E `nomercy: wrd4…`, `with two players left…` |
| Discard All | Also discards every other card of that color, under it | E `nomercy: discall…` |
| Skip Everyone | You play again | E `nomercy: Skip Everyone skips all the other players…` |
| Wild Color Roulette | The next player names a color, turns up cards until that color shows (wilds don't count), keeps them all and loses their turn | E `nomercy: roulette…` |
| 0 and 7 | 0: every hand passes to the next player in the direction of play. 7: swap hands with a player you choose | E `nomercy: 0 rotates…`, `7 swaps…` |
| Mercy rule | 25 or more cards knocks you out. Your hand is set aside until the next reshuffle. The last player standing wins | E `mercy: …` |
| Going out | The round simply ends: no forced draw | E `nomercy: going out on a draw card ends the round…` |
| Points | Numbers at face value. Every colored action card: 20. Every wild: 50. Each knocked-out player: a flat 250 | E `points: every card face…`, `mercy: last player standing…250` |
| Target | 1000 | UI default |

## Liar (112 cards)

| Parameter | Rule | Test |
|---|---|---|
| Deck | Per color: regular 0–9 ×1 and bluff 0–9 ×1, plus bluff Draw 2, Reverse and Skip ×2 each. Plus 2 bluff Wild Draw 4 and 6 regular Wild Call-Out | E `liar deck…` |
| Opening card | An action card is ignored and the next card goes on top | E `opening card follows the official liar rule` |
| Bluff cards | Always played face down, claiming a card that could legally be played: the same color, the same value, or Wild Draw 4. The real card doesn't need to fit | E `liar: …claim…` |
| Calling a bluff | The next player lets it stand or calls it. Anyone else may call it first; the player who played it can't | E `liar: …challenge…` |
| Wrong call | The caller draws 1, and the claimed card works | E `liar: …truthful…` |
| Caught bluff | The card goes back with 1 extra card; no effect, and play moves on | E `liar: …bluff…` |
| Last card face down | Can be called. Truthful: you win. Caught: take it back, draw 1, play goes on | E `liar: going out face down…` |
| Wild Call-Out | The caller picks a color. Everyone else puts one card face down. **If you hold that color you must put one of those down**; only without it may you bluff. The caller flips cards one by one and stops at the first truthful card. Caught bluffers keep their card and draw 1. Everything else goes under the Call-Out. Anyone left with no cards wins, together if several | E `liar Call-Out: …` |
| 0 and 7 | As in No Mercy | E `liar: …` |
| Points | Numbers at face value. Draw 2, Reverse, Skip: 20. Wild Draw 4, Wild Call-Out: 50. Forced draws happen first | E `points: every card face…` |
| Target | 500 | UI default |

## Where we decide for ourselves

These are cases the rule sheets don't cover.

- A Flip that turns up a wild: the player who played the Flip picks the color, and nothing else happens.
- A Flip card as the opening card: it goes back into the deck, like Wild Draw 2.
- Stalemate: if nobody can play and there is nothing left to draw for a whole round of turns, the lowest hand wins the round.
- 4–8 players, as asked for this game.
