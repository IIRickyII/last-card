# Last Card

An original shedding card game for 4–8 players with four modes: **Classic**, **Flip**, **No Mercy** and **Liar**.
Play on one device against bots or pass-and-play, or play online with friends. There's no install, no account and no server.

**Play:** https://iirickyii.github.io/last-card/

## Playing online with friends

1. One person picks **Host an online game**, enters a name and gets a 6-character room code with an invite link.
2. Friends open the link, or pick **Join a game** and type the code, from any recent Safari, Chrome, Edge or Firefox, on phone or computer.
3. The host chooses the mode, target score and number of players, then presses **Start**. Empty seats are filled with bots.

Keep the host's page open: the host's browser runs the game. If a friend loses their connection, a bot plays their seat until they open the link again in the same browser tab.

## Modes

| Mode | Deck | What's special |
|---|---|---|
| Classic | 108 | Skip, Reverse, Draw 2, Wild, Wild Draw 4 (can be challenged) |
| Flip | 112 double-sided | Light side: Draw 1, Skip, Reverse, Flip, Wild Draw 2. Dark side: Draw 5, Skip Everyone, Wild Draw Color. You can see the other side of opponents' cards |
| No Mercy | 168 | Stacking +2/+4/+6/+10 and Wild Reverse +4, Discard All, Color Roulette, 0 rotates hands, 7 swaps hands, 25 cards knocks you out |
| Liar | 112 | Bluff cards are played face down while you claim what they are. Anyone can call the bluff. Wild Call-Out makes everyone put a card face down; the caller flips them |

The full rules for each mode are under **Rules** in the game.

### Rule choices

- The first discard is always a number card.
- When a Flip reveals a card, that card's action doesn't happen. If it's a wild, the player who flipped picks the color.
- No Mercy: any draw card of equal or higher value can be stacked, whatever its color. For Color Roulette, the next player names the color.
- Liar: a bluff claim must be a card that could legally be played. A wrong call costs the caller 1 card. A caught bluff goes back to its owner with 1 extra card, and its effect doesn't happen. In a Call-Out, any card may be put down; players who go out together share the win.
- Going out on Wild Draw Color or Color Roulette makes nobody draw.
- If no one can play and there is nothing left to draw, the lowest hand wins the round.

## How online play works, and what it means for privacy

- Players connect browser to browser with WebRTC. The free public PeerJS service only introduces them, and no game data is stored anywhere.
- The host's browser is the only place every card exists. Each player receives only what they're allowed to see: never another hand, the deck order, a face-down card or the shuffle seed. The host's device could reveal everything, so play with people you trust.
- The host checks everything players send: message size, message rate, format, and the game rules. A player can only act for their own seat.
- Because players connect directly, each player's browser learns the others' IP addresses. Video calls work the same way.
- There is no free public relay server any more, so a few very strict networks (some mobile carriers, offices) can't connect. If a friend is stuck, try another network, or add your own TURN server in `net.js`.
- The page uses a strict Content-Security-Policy. The one outside script (PeerJS 1.5.5 from jsDelivr) is pinned with Subresource Integrity.

## Files

- `engine.js`: rules, bots and per-player views. Pure JavaScript, which also runs in Node.
- `room.js`: runs a game on the host's device, including bots, timing and checks on every message from players.
- `net.js`: the WebRTC connection layer, using PeerJS.
- `index.html`, `style.css`, `ui.js`: the interface, styled after Apple's Human Interface Guidelines.
- `tests/`: rules for every mode, hidden-information checks, malicious and malformed message tests, and full simulated games.

```bash
node --test tests/
```
