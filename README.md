# Last Card

An original shedding card game for 4–8 players with four modes: **Classic**, **Flip**, **No Mercy** and **Liar**.
Play on one device against bots or pass-and-play, or play online with friends. There's no install, no account and no server.

**Site:** https://iirickyii.github.io/last-card/ · **Play:** https://iirickyii.github.io/last-card/play.html

## Playing online with friends

1. One person picks **Host an online game**, enters a name and gets a 6-character room code with an invite link.
2. Friends open the link, or pick **Join a game** and type the code, from any recent Safari, Chrome, Edge or Firefox, on phone or computer.
3. The host chooses the mode, target score and number of players, then presses **Start game**. Empty seats are filled with bots.

Keep the host's page open: the host's browser runs the game. If a friend loses their connection, a bot plays their seat until they open the link again in the same browser tab.

## Modes

| Mode | Deck | What's special |
|---|---|---|
| Classic | 108 | Skip, Reverse, Draw 2, Wild, Wild Draw 4 (can be challenged) |
| Flip | 112 double-sided | Light side: Draw 1, Skip, Reverse, Flip, Wild Draw 2. Dark side: Draw 5, Skip Everyone, Wild Draw Color. You can see the other side of opponents' cards |
| No Mercy | 168 | Stacking +2/+4/+6/+10 and Wild Reverse +4, Discard All, Color Roulette, 0 rotates hands, 7 swaps hands, 25 cards knocks you out |
| Liar | 112 | Bluff cards are played face down while you claim what they are. Anyone can call the bluff. Wild Call-Out makes everyone put a card face down; the caller flips them |

The full rules for each mode are under **How to play** in the game. [RULES.md](RULES.md) lists every rule parameter, where it comes from and the test that checks it. Targets: 500 for Classic, Flip and Liar; 1000 for No Mercy (or a single round).

### Rule choices

Where the published instruction sheets leave a case open, the game decides as follows (also in [RULES.md](RULES.md)):

- A Flip that turns up a wild: the player who played the Flip picks the color, and nothing else happens.
- A Flip card as the opening card goes back into the deck, like Wild Draw 2.
- If no one can play and there is nothing left to draw for a whole round of turns, the lowest hand wins the round.
- The game seats 4 to 8 players.

## How online play works, and what it means for privacy

- Players connect browser to browser with WebRTC. The free public PeerJS service only introduces them, and no game data is stored anywhere.
- The host's browser is the only place every card exists. Each player receives only what they're allowed to see: never another hand, the deck order, a face-down card or the shuffle seed. The host's device could reveal everything, so play with people you trust.
- The host checks everything players send: message size, message rate, format, and the game rules. A player can only act for their own seat.
- Because players connect directly, each player's browser learns the others' IP addresses. Video calls work the same way.
- There is no free public relay server any more, so a few very strict networks (some mobile carriers, offices) can't connect. If a friend is stuck, try another network, or add your own TURN server in `net.js`.
- The game page uses a strict Content-Security-Policy; the site's policy allows inline styles but pins its two inline scripts by hash. The one outside script (PeerJS 1.5.5 from jsDelivr) is pinned with Subresource Integrity. Fonts come from Google Fonts.

## Files

- `engine.js`: rules, bots and per-player views. Pure JavaScript, which also runs in Node.
- `room.js`: runs a game on the host's device, including bots, timing and checks on every message from players.
- `net.js`: the WebRTC connection layer, using PeerJS.
- `play.html`, `style.css`, `ui.js`: the game's interface. `cards.css`: the card art, shared with the site.
- `index.html`, `site.css`, `assets/`, `media/`: the site. It is built on the design kit in `assets/`; every picture in `media/` is a capture of the real game or a render of its cards.
- `tests/`: rules for every mode, hidden-information checks, malicious and malformed message tests, and full simulated games.

```bash
node --test tests/
```
