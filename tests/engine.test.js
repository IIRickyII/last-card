'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const { newGame, nextRound, act, actor, botAction, botCatch, face, top, points, nextIdx, active } = E;

// ---------- helpers ----------
let nid = 100000; // junk ids stay clear of the hand-picked scenario ids (900-3999)
const card = (id, c, v) => ({ id, light: { c, v } });
const fcard = (id, lc, lv, dc, dv) => ({ id, light: { c: lc, v: lv }, dark: { c: dc, v: dv } });
const mkPlayers = (n) => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, bot: false }));
const game = (mode = 'classic', n = 4, seed = 7, target = 500) => newGame({ mode, players: mkPlayers(n), seed, target });
const junk = (s, n) => Array.from({ length: n }, () => (s.mode === 'flip' ? fcard(nid++, 'green', '9', 'teal', '9') : card(nid++, 'green', '9')));
const defTop = (s) => (s.mode === 'flip' ? fcard(900, 'red', '5', 'pink', '5') : card(900, 'red', '5'));
const ids = (hand) => hand.map((c) => c.id);
const allCards = (s) => [...s.draw, ...s.discard, ...(s.aside || []), ...s.players.flatMap((p) => p.hand)]; // aside: knocked-out hands (No Mercy)

// Overwrite a freshly created game with a controlled scenario. `draw` top = last element.
function setup(s, { hands = {}, topCard, color, turn = 0, dir = 1, side = 'light', draw } = {}) {
  s.side = side; s.dir = dir; s.turn = turn; s.stack = 0; s.stackMin = 0; s.pending = null; s.vulnerable = null;
  s.players.forEach((pl, i) => { pl.hand = hands[i] ? hands[i].slice() : junk(s, 4); pl.called = false; pl.out = false; });
  const t = topCard || defTop(s);
  s.discard = [t];
  s.color = color || face(s, t).c;
  s.draw = draw ? draw.slice() : junk(s, 40);
  return s;
}
const mustOk = (r) => assert.equal(r.ok, true, JSON.stringify(r));
const mustNo = (r) => assert.equal(r.ok, false);

// ---------- 1. deck composition ----------
const LIGHT = ['red', 'yellow', 'green', 'blue'];
const DARK = ['pink', 'teal', 'orange', 'purple'];
function expected(colors, perColor, wilds) {
  const out = [];
  for (const c of colors) for (const [v, n] of perColor) for (let i = 0; i < n; i++) out.push(c + ':' + v);
  for (const [v, n] of wilds) for (let i = 0; i < n; i++) out.push('wild:' + v);
  return out.sort();
}
const range = (a, n) => Array.from({ length: 10 - a }, (_, i) => [String(a + i), n]);
const key = (f) => f.c + ':' + f.v;

const DECKS = {
  classic: { size: 108, light: expected(LIGHT, [['0', 1], ...range(1, 2), ['skip', 2], ['rev', 2], ['d2', 2]], [['wild', 4], ['wd4', 4]]) },
  flip: {
    size: 112,
    light: expected(LIGHT, [...range(1, 2), ['d1', 2], ['rev', 2], ['skip', 2], ['flip', 2]], [['wild', 4], ['wd2', 4]]),
    dark: expected(DARK, [...range(1, 2), ['d5', 2], ['rev', 2], ['skipall', 2], ['flip', 2]], [['wild', 4], ['wdc', 4]]),
  },
  nomercy: {
    size: 168,
    light: expected(LIGHT, [...range(0, 2), ['d2', 3], ['d4', 2], ['skip', 3], ['skipall', 2], ['rev', 3], ['discall', 3]],
      [['wrd4', 8], ['wd6', 4], ['wd10', 4], ['roul', 8]]),
  },
};

for (const mode of ['classic', 'flip', 'nomercy']) {
  test(`deck composition: ${mode}`, () => {
    const s = game(mode, 4, 11);
    const all = allCards(s);
    assert.equal(all.length, DECKS[mode].size);
    assert.equal(new Set(all.map((c) => c.id)).size, all.length, 'ids unique');
    assert.deepEqual(all.map((c) => key(c.light)).sort(), DECKS[mode].light);
    if (mode === 'flip') {
      assert.ok(all.every((c) => c.dark));
      assert.deepEqual(all.map((c) => key(c.dark)).sort(), DECKS[mode].dark);
    }
    // what the opening card does to hands, turn and direction is covered by the opening-card tests below
    assert.equal(s.round, 1);
    assert.equal(s.phase, 'play');
  });
}
// Opening card, per the official sheets. Classic and Flip: the turned-up card takes effect (Classic Wild Draw 4,
// Flip Wild Draw 2 and Flip go back into the deck). No Mercy and Liar: action cards are ignored and the next card goes
// on top until a number shows. Seat 0 sits left of the dealer (seat n-1). Each branch must occur in the seeds tried.
for (const mode of ['classic', 'flip', 'nomercy', 'liar']) {
  test(`opening card follows the official ${mode} rule`, () => {
    const seen = new Set();
    for (let seed = 1; seed <= 600; seed++) {
      const n = 4 + (seed % 5), s = game(mode, n, seed), f = top(s).light, sizes = s.players.map((p) => p.hand.length);
      assert.equal(allCards(s).length, { classic: 108, flip: 112, nomercy: 168, liar: 112 }[mode]);
      if (mode === 'nomercy' || mode === 'liar') {
        assert.match(f.v, /^\d$/, 'a number ends the turning-up');
        assert.ok(s.discard.slice(0, -1).every((c) => !/^\d$/.test(c.light.v)), 'only ignored action cards lie under it');
        assert.deepEqual([s.turn, s.dir, s.pending, s.color], [0, 1, null, f.c]);
        assert.ok(sizes.every((k) => k === 7));
        seen.add(s.discard.length > 1 ? 'ignored' : 'number');
        continue;
      }
      assert.equal(s.discard.length, 1, 'returned cards go back into the deck');
      assert.ok(!['wd4', 'wd2', 'flip'].includes(f.v), `${f.v} is never the opening card`);
      const rest = sizes.slice(1).every((k) => k === 7);
      if (/^\d$/.test(f.v)) { assert.deepEqual([s.turn, s.dir, s.color, sizes[0]], [0, 1, f.c, 7]); seen.add('number'); }
      else if (f.v === 'skip') { assert.deepEqual([s.turn, s.dir, sizes[0]], [1, 1, 7]); seen.add('skip'); }
      else if (f.v === 'rev') { assert.deepEqual([s.turn, s.dir, sizes[0]], [n - 1, -1, 7]); seen.add('rev'); }
      else if (f.v === 'd2' || f.v === 'd1') { assert.deepEqual([s.turn, s.dir, sizes[0]], [1, 1, f.v === 'd2' ? 9 : 8]); seen.add(f.v); }
      else if (f.v === 'wild') { assert.deepEqual([s.pending.type, s.pending.p, s.color, s.turn], ['color', 0, null, 0]); seen.add('wild'); }
      else assert.fail(`unexpected opening card ${f.v}`);
      assert.ok(rest, 'only the first player can be made to draw');
    }
    const want = { classic: ['number', 'skip', 'rev', 'd2', 'wild'], flip: ['number', 'skip', 'rev', 'd1', 'wild'], nomercy: ['number', 'ignored'], liar: ['number', 'ignored'] }[mode];
    for (const w of want) assert.ok(seen.has(w), `opening branch "${w}" was exercised`);
  });
}
test('opening Wild: the first player picks the color, then plays', () => {
  for (let seed = 1; seed <= 600; seed++) {
    const s = game('classic', 4, seed);
    if (!s.pending) continue;
    mustNo(act(s, { p: 0, type: 'draw' }));
    mustOk(act(s, { p: 0, type: 'color', color: 'green' }));
    assert.deepEqual([s.color, s.turn, s.pending], ['green', 0, null]);
    return;
  }
  assert.fail('no seed opened on a Wild');
});

// ---------- 2. matching ----------
test('matching: same color plays', () => {
  const s = setup(game());
  s.players[0].hand = [card(1001, 'red', '9'), card(1002, 'blue', '1'), card(1003, 'blue', '2')];
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(top(s).id, 1001);
  assert.equal(s.turn, 1);
});
test('matching: same value plays and changes color', () => {
  const s = setup(game());
  s.players[0].hand = [card(1001, 'blue', '5'), card(1002, 'green', '1'), card(1003, 'green', '2')];
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.color, 'blue');
});
test('matching: wild always plays', () => {
  const s = setup(game());
  s.players[0].hand = [card(1001, 'wild', 'wild'), card(1002, 'green', '1'), card(1003, 'green', '2')];
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
});
test('matching: mismatch rejected, state unchanged', () => {
  const s = setup(game());
  s.players[0].hand = [card(1001, 'blue', '9'), card(1002, 'green', '1')];
  const before = JSON.stringify([s.players[0].hand, s.discard, s.turn, s.color]);
  mustNo(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(JSON.stringify([s.players[0].hand, s.discard, s.turn, s.color]), before);
  mustNo(act(s, { p: 0, type: 'play', id: 99999 }));
});
test('matching: play follows color chosen on a wild', () => {
  const s = setup(game(), { topCard: card(900, 'wild', 'wild'), color: 'green' });
  s.players[0].hand = [card(1001, 'green', '3'), card(1002, 'red', '4'), card(1003, 'red', '5')];
  mustNo(act(s, { p: 0, type: 'play', id: 1002 }));
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
});
test('matching: acting out of turn is rejected', () => {
  const s = setup(game(), { hands: { 1: [card(1001, 'red', '9'), card(1002, 'red', '1')] } });
  mustNo(act(s, { p: 1, type: 'play', id: 1001 }));
  mustNo(act(s, { p: 1, type: 'draw' }));
  assert.equal(s.turn, 0);
  assert.equal(s.players[1].hand.length, 2);
});

// ---------- 3. classic actions ----------
test('classic: skip jumps two seats', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'red', 'skip'), card(1002, 'red', '1'), card(1003, 'red', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.turn, 2);
});
test('classic: reverse flips direction', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'red', 'rev'), card(1002, 'red', '1'), card(1003, 'red', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.dir, -1);
  assert.equal(s.turn, 3);
});
test('classic: draw two makes next draw exactly 2 and skips them', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'red', 'd2'), card(1002, 'red', '1'), card(1003, 'red', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.players[1].hand.length, 6);
  assert.equal(s.turn, 2);
  assert.equal(s.draw.length, 38);
});
test('classic: wild asks owner for color then passes turn', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'wild', 'wild'), card(1002, 'red', '1'), card(1003, 'red', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.pending.type, 'color');
  assert.equal(s.pending.p, 0);
  assert.equal(actor(s), 0);
  mustNo(act(s, { p: 1, type: 'color', color: 'blue' }));
  mustNo(act(s, { p: 0, type: 'color', color: 'pink' }));
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  assert.equal(s.color, 'blue');
  assert.equal(s.pending, null);
  assert.equal(s.turn, 1);
});
function wd4Scenario(offenderHand) {
  const s = setup(game(), { hands: { 0: offenderHand } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  return s;
}
test('classic: wd4 sets pending challenge owned by next player', () => {
  const s = wd4Scenario([card(1001, 'wild', 'wd4'), card(1002, 'green', '1'), card(1003, 'green', '2')]);
  assert.equal(s.color, 'blue');
  assert.equal(s.pending.type, 'challenge');
  assert.equal(s.pending.p, 1);
  assert.equal(actor(s), 1);
});
test('classic: wd4 accept -> draws 4 and is skipped', () => {
  const s = wd4Scenario([card(1001, 'wild', 'wd4'), card(1002, 'green', '1'), card(1003, 'green', '2')]);
  mustOk(act(s, { p: 1, type: 'accept' }));
  assert.equal(s.players[1].hand.length, 8);
  assert.equal(s.turn, 2);
  assert.equal(s.pending, null);
});
test('classic: wd4 challenge succeeds on bluff -> offender draws 4, challenger plays', () => {
  const s = wd4Scenario([card(1001, 'wild', 'wd4'), card(1002, 'red', '1'), card(1003, 'green', '2')]);
  mustOk(act(s, { p: 1, type: 'challenge' }));
  assert.equal(s.players[0].hand.length, 6);
  assert.equal(s.players[1].hand.length, 4);
  assert.equal(s.turn, 1);
  assert.equal(s.pending, null);
});
test('classic: wd4 challenge fails when legal -> challenger draws 6 and is skipped', () => {
  const s = wd4Scenario([card(1001, 'wild', 'wd4'), card(1002, 'green', '1'), card(1003, 'blue', '2')]);
  mustOk(act(s, { p: 1, type: 'challenge' }));
  assert.equal(s.players[1].hand.length, 10);
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.turn, 2);
});
test('classic: only the challenge owner may answer it', () => {
  const s = wd4Scenario([card(1001, 'wild', 'wd4'), card(1002, 'green', '1'), card(1003, 'green', '2')]);
  mustNo(act(s, { p: 2, type: 'accept' }));
  mustNo(act(s, { p: 0, type: 'challenge' }));
  mustNo(act(s, { p: 1, type: 'draw' }));
});

// ---------- 4. draw ----------
test('classic draw: exactly one card, playable -> pending drawn, keep passes turn', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'blue', '1'), card(1002, 'blue', '2')] }, draw: [...junk(game(), 10), card(1100, 'red', '7')] });
  mustOk(act(s, { p: 0, type: 'draw' }));
  assert.equal(s.players[0].hand.length, 3);
  assert.deepEqual(s.pending, { type: 'drawn', p: 0, id: 1100 });
  mustOk(act(s, { p: 0, type: 'keep' }));
  assert.equal(s.pending, null);
  assert.equal(s.turn, 1);
  assert.equal(s.players[0].hand.length, 3);
});
test('classic draw: playing the drawn card works', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'blue', '1'), card(1002, 'blue', '2')] }, draw: [...junk(game(), 10), card(1100, 'red', '7')] });
  mustOk(act(s, { p: 0, type: 'draw' }));
  mustOk(act(s, { p: 0, type: 'play', id: 1100 }));
  assert.equal(top(s).id, 1100);
  assert.equal(s.turn, 1);
  assert.equal(s.players[0].hand.length, 2);
});
test('classic draw: other card (even matching) refused while drawn pending', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'red', '1'), card(1002, 'blue', '2')] }, draw: [...junk(game(), 10), card(1100, 'red', '7')] });
  mustOk(act(s, { p: 0, type: 'draw' }));
  mustNo(act(s, { p: 0, type: 'play', id: 1001 }));
  mustNo(act(s, { p: 0, type: 'draw' }));
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(s.pending.type, 'drawn');
});
test('classic draw: unplayable draw passes turn automatically', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'blue', '1'), card(1002, 'blue', '2')] }, draw: [...junk(game(), 10), card(1100, 'blue', '7')] });
  mustOk(act(s, { p: 0, type: 'draw' }));
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(s.pending, null);
  assert.equal(s.turn, 1);
});
test('nomercy draw: draws until a playable card', () => {
  const s = setup(game('nomercy'), {
    hands: { 0: [card(1001, 'blue', '1'), card(1002, 'blue', '2')] },
    draw: [...junk(game('nomercy'), 10), card(1100, 'red', '7'), card(1101, 'green', '3'), card(1102, 'blue', '2'), card(1103, 'blue', '1')],
  });
  mustOk(act(s, { p: 0, type: 'draw' }));
  assert.equal(s.players[0].hand.length, 6);
  assert.deepEqual(s.pending, { type: 'drawn', p: 0, id: 1100 });
  assert.equal(s.draw.length, 10);
});

// ---------- 5. last card ----------
test('last card: dropping to 1 without calling makes player vulnerable', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'red', '3'), card(1002, 'red', '4')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.vulnerable, 0);
});
test('last card: catch makes victim draw 2 and clears vulnerability', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'red', '3'), card(1002, 'red', '4')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustNo(act(s, { p: 0, type: 'catch', target: 0 }));
  mustOk(act(s, { p: 2, type: 'catch', target: 0 }));
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(s.vulnerable, null);
  mustNo(act(s, { p: 3, type: 'catch', target: 0 }));
});
test('last card: calling at 2 cards before playing avoids vulnerability', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'red', '3'), card(1002, 'red', '4')] } });
  mustOk(act(s, { p: 0, type: 'call' }));
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.vulnerable, null);
  mustNo(act(s, { p: 2, type: 'catch', target: 0 }));
});
test('last card: late call saves a vulnerable player', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'red', '3'), card(1002, 'red', '4')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 0, type: 'call' }));
  assert.equal(s.vulnerable, null);
});
test('last card: window closes once the next player acts', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'red', '3'), card(1002, 'red', '4')], 1: [card(1003, 'red', '7'), card(1004, 'red', '8'), card(1005, 'red', '9')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.vulnerable, 0);
  mustOk(act(s, { p: 1, type: 'play', id: 1003 }));
  assert.equal(s.vulnerable, null);
  mustNo(act(s, { p: 2, type: 'catch', target: 0 }));
  assert.equal(s.players[0].hand.length, 1);
});
test('last card: call with 3+ cards is rejected', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'red', '3'), card(1002, 'red', '4'), card(1003, 'red', '6')] } });
  mustNo(act(s, { p: 0, type: 'call' }));
  assert.equal(s.players[0].called, false);
});
test('last card: catch with nobody vulnerable is rejected', () => {
  const s = setup(game());
  mustNo(act(s, { p: 1, type: 'catch', target: 0 }));
});

// ---------- 6. flip ----------
const flipHand = (...cs) => ({ 0: [...cs, fcard(1090, 'blue', '1', 'teal', '1'), fcard(1091, 'blue', '2', 'teal', '2')] });
test('flip: flip card switches side and applies dark top face', () => {
  const s = setup(game('flip'), { hands: flipHand(fcard(1001, 'red', 'flip', 'pink', '5')) });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.side, 'dark');
  assert.deepEqual(face(s, top(s)), { c: 'pink', v: '5' });
  assert.equal(s.color, 'pink');
  assert.equal(s.turn, 1);
  assert.deepEqual(E.colors(s), DARK);
});
test('flip: the whole discard pile turns over, so the old bottom card is on top and the Flip card at the bottom', () => {
  const s = setup(game('flip'), { hands: flipHand(fcard(1001, 'red', 'flip', 'orange', '9')) });
  s.discard = [fcard(899, 'blue', '3', 'teal', '7'), fcard(900, 'red', '5', 'pink', '5')];
  const drawBefore = ids(s.draw);
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.deepEqual(ids(s.discard), [1001, 900, 899]);
  assert.deepEqual(face(s, top(s)), { c: 'teal', v: '7' });
  assert.equal(s.color, 'teal');
  assert.deepEqual(ids(s.draw), drawBefore.reverse(), 'the draw pile turns over as a stack too');
});
test('flip: wild revealed -> flipper chooses a dark color then turn passes', () => {
  const s = setup(game('flip'), { topCard: fcard(900, 'red', '5', 'wild', 'wild'), hands: flipHand(fcard(1001, 'red', 'flip', 'pink', '1')) });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.side, 'dark');
  assert.equal(s.pending.type, 'color');
  assert.equal(s.pending.p, 0);
  assert.equal(s.turn, 0);
  mustNo(act(s, { p: 0, type: 'color', color: 'red' }));
  mustOk(act(s, { p: 0, type: 'color', color: 'teal' }));
  assert.equal(s.color, 'teal');
  assert.equal(s.pending, null);
  assert.equal(s.turn, 1);
  assert.equal(s.players[1].hand.length, 4, 'no draw effect on reveal');
});
test('flip: dark skipall gives same player another turn', () => {
  const s = setup(game('flip'), {
    side: 'dark', topCard: fcard(900, 'red', '5', 'orange', '4'),
    hands: flipHand(fcard(1001, 'green', '3', 'orange', 'skipall')),
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.turn, 0);
  assert.equal(s.pending, null);
});
test('flip: dark d5 makes next draw 5 and skips them', () => {
  const s = setup(game('flip'), {
    side: 'dark', topCard: fcard(900, 'red', '5', 'orange', '4'),
    hands: flipHand(fcard(1001, 'green', '3', 'orange', 'd5')),
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.players[1].hand.length, 9);
  assert.equal(s.turn, 2);
});
test('flip: wdc draws until chosen color appears', () => {
  const s = setup(game('flip'), {
    side: 'dark', topCard: fcard(900, 'red', '5', 'orange', '4'),
    hands: { 0: [fcard(1001, 'wild', 'wdc', 'wild', 'wdc'), fcard(1002, 'blue', '1', 'pink', '1'), fcard(1003, 'blue', '2', 'pink', '2')] },
    draw: [...junk(game('flip'), 10), fcard(1100, 'x', '1', 'teal', '3'), fcard(1101, 'x', '1', 'orange', '2'), fcard(1102, 'x', '1', 'pink', '1')],
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 0, type: 'color', color: 'teal' }));
  assert.equal(s.pending.type, 'challenge');
  assert.equal(s.pending.p, 1);
  mustOk(act(s, { p: 1, type: 'accept' }));
  assert.equal(s.players[1].hand.length, 7);
  assert.deepEqual(ids(s.players[1].hand.slice(4)), [1102, 1101, 1100]);
  assert.equal(s.turn, 2);
});
test('flip: light d1 makes next draw 1 and skips', () => {
  const s = setup(game('flip'), { hands: flipHand(fcard(1001, 'red', 'd1', 'pink', '1')) });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.players[1].hand.length, 5);
  assert.equal(s.turn, 2);
});
test('flip: flipping back returns to light side', () => {
  const s = setup(game('flip'), {
    side: 'dark', topCard: fcard(900, 'yellow', '5', 'orange', '4'),
    hands: flipHand(fcard(1001, 'green', 'flip', 'orange', 'flip')),
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.side, 'light');
  assert.deepEqual(face(s, top(s)), { c: 'yellow', v: '5' }, 'the old bottom card, now light side up');
  assert.equal(s.color, 'yellow');
});

// ---------- 7. no mercy ----------
const nm = (extra) => setup(game('nomercy'), extra);
test('nomercy: +2 then +4 stacks to 6 with stackMin 4', () => {
  const s = nm({ hands: { 0: [card(1001, 'red', 'd2'), card(1002, 'red', '1'), card(1003, 'red', '2')], 1: [card(1004, 'blue', 'd4'), card(1005, 'blue', '1'), card(1006, 'blue', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.stack, 2);
  assert.equal(s.stackMin, 2);
  assert.equal(s.turn, 1);
  mustOk(act(s, { p: 1, type: 'play', id: 1004 }));
  assert.equal(s.stack, 6);
  assert.equal(s.stackMin, 4);
  assert.equal(s.turn, 2);
});
test('nomercy: equal value stacks (+2 on +2, any color)', () => {
  const s = nm({ hands: { 0: [card(1001, 'red', 'd2'), card(1002, 'red', '1'), card(1003, 'red', '2')], 1: [card(1004, 'blue', 'd2'), card(1005, 'blue', '1'), card(1006, 'blue', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 1, type: 'play', id: 1004 }));
  assert.equal(s.stack, 4);
  assert.equal(s.stackMin, 2);
  assert.equal(s.turn, 2);
});
test('nomercy: +2 onto a +4 stack is rejected', () => {
  const s = nm({ hands: { 0: [card(1001, 'red', 'd4'), card(1002, 'red', '1'), card(1003, 'red', '2')], 1: [card(1004, 'red', 'd2'), card(1005, 'red', '1'), card(1006, 'red', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustNo(act(s, { p: 1, type: 'play', id: 1004 }));
  assert.equal(s.stack, 4);
  assert.equal(s.players[1].hand.length, 3);
});
test('nomercy: normal matching card rejected while a stack is pending; draw takes the stack', () => {
  const s = nm({
    hands: { 0: [card(1001, 'red', 'd2'), card(1002, 'red', '1'), card(1003, 'red', '2')], 1: [card(1004, 'red', '5'), card(1005, 'red', '6'), card(1006, 'red', '7')] },
    draw: [...junk(game('nomercy'), 20), card(1100, 'blue', '3')],
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustNo(act(s, { p: 1, type: 'play', id: 1004 }));
  assert.equal(s.players[1].hand.length, 3);
  mustOk(act(s, { p: 1, type: 'draw' }));
  assert.equal(s.players[1].hand.length, 5);
  assert.equal(s.stack, 0);
  assert.equal(s.stackMin, 0);
  assert.equal(s.turn, 2);
  assert.equal(s.pending, null);
});
test('nomercy: drawing a +6 stack takes exactly 6', () => {
  const s = nm({ hands: { 0: [card(1001, 'red', 'd2'), card(1002, 'red', '1'), card(1003, 'red', '2')], 1: [card(1004, 'blue', 'd4'), card(1005, 'blue', '1'), card(1006, 'blue', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 1, type: 'play', id: 1004 }));
  mustOk(act(s, { p: 2, type: 'draw' }));
  assert.equal(s.players[2].hand.length, 10);
  assert.equal(s.turn, 3);
  assert.equal(s.stack, 0);
});
test('nomercy: wrd4 reverses direction and adds 4', () => {
  const s = nm({ hands: { 0: [card(1001, 'wild', 'wrd4'), card(1002, 'red', '1'), card(1003, 'red', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 0, type: 'color', color: 'green' }));
  assert.equal(s.dir, -1);
  assert.equal(s.stack, 4);
  assert.equal(s.stackMin, 4);
  assert.equal(s.turn, 3);
  assert.equal(s.color, 'green');
});
test('nomercy: discall dumps every card of its color under it', () => {
  const s = nm({ hands: { 0: [card(1001, 'red', 'discall'), card(1002, 'red', '3'), card(1003, 'red', '8'), card(1004, 'blue', '2'), card(1005, 'blue', '4')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.deepEqual(ids(s.players[0].hand), [1004, 1005]);
  assert.equal(top(s).id, 1001);
  assert.equal(s.discard.length, 4);
  assert.deepEqual(ids(s.discard.slice(1, 3)).sort(), [1002, 1003]);
  assert.equal(s.turn, 1);
});
test('nomercy: 7 swaps hands with chosen target', () => {
  const s = nm({ hands: { 0: [card(1001, 'red', '7'), card(1002, 'red', '1'), card(1003, 'red', '2')], 2: [card(1004, 'blue', '1'), card(1005, 'blue', '2'), card(1006, 'blue', '3'), card(1007, 'blue', '4')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.deepEqual(s.pending, { type: 'swap', p: 0 });
  mustNo(act(s, { p: 0, type: 'swap', target: 0 }));
  mustOk(act(s, { p: 0, type: 'swap', target: 2 }));
  assert.deepEqual(ids(s.players[0].hand), [1004, 1005, 1006, 1007]);
  assert.deepEqual(ids(s.players[2].hand), [1002, 1003]);
  assert.equal(s.turn, 1);
  assert.equal(s.pending, null);
});
test('nomercy: 0 rotates hands in direction of play', () => {
  const h = (a) => [card(a, 'blue', '1'), card(a + 1, 'blue', '2'), card(a + 2, 'blue', '3')];
  const s = nm({ hands: { 0: [card(1001, 'red', '0'), card(1002, 'red', '1'), card(1003, 'red', '2')], 1: h(1010), 2: h(1020), 3: h(1030) } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.deepEqual(ids(s.players[1].hand), [1002, 1003]);
  assert.deepEqual(ids(s.players[2].hand), ids(h(1010)));
  assert.deepEqual(ids(s.players[3].hand), ids(h(1020)));
  assert.deepEqual(ids(s.players[0].hand), ids(h(1030)));
  assert.equal(s.turn, 1);
});
test('nomercy: 0 rotates the other way when direction is reversed', () => {
  const h = (a) => [card(a, 'blue', '1'), card(a + 1, 'blue', '2'), card(a + 2, 'blue', '3')];
  const s = nm({ dir: -1, hands: { 0: [card(1001, 'red', '0'), card(1002, 'red', '1'), card(1003, 'red', '2')], 1: h(1010), 2: h(1020), 3: h(1030) } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.deepEqual(ids(s.players[3].hand), [1002, 1003]);
  assert.deepEqual(ids(s.players[2].hand), ids(h(1030)));
  assert.deepEqual(ids(s.players[1].hand), ids(h(1020)));
  assert.deepEqual(ids(s.players[0].hand), ids(h(1010)));
  assert.equal(s.turn, 3);
});
test('nomercy: roulette makes next player pick a color, draw until it appears, lose turn', () => {
  const s = nm({
    hands: { 0: [card(1001, 'wild', 'roul'), card(1002, 'red', '1'), card(1003, 'red', '2')] },
    draw: [...junk(game('nomercy'), 10), card(1100, 'blue', '3'), card(1101, 'red', '2'), card(1102, 'green', '1')],
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.pending.type, 'roulette');
  assert.equal(s.pending.p, 1);
  assert.equal(actor(s), 1);
  mustNo(act(s, { p: 0, type: 'color', color: 'blue' }));
  mustOk(act(s, { p: 1, type: 'color', color: 'blue' }));
  assert.equal(s.players[1].hand.length, 7);
  assert.deepEqual(ids(s.players[1].hand.slice(4)), [1102, 1101, 1100]);
  assert.equal(s.color, 'blue');
  assert.equal(s.turn, 2);
  assert.equal(s.pending, null);
});

const numHand = (n, start) => Array.from({ length: n }, (_, i) => card(start + i, LIGHT[i % 4], String((i % 9) + 1)));
test('mercy: reaching 25 cards knocks player out; the hand is set aside until the deck is reshuffled', () => {
  const s = nm({
    hands: { 0: [card(1001, 'red', 'd4'), card(1002, 'red', '1'), card(1003, 'red', '2')], 1: numHand(21, 2000) },
    draw: [...junk(game('nomercy'), 10), ...numHand(4, 3000)],
  });
  const total = allCards(s).length;
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 1, type: 'draw' }));
  assert.equal(s.players[1].out, true);
  assert.equal(s.players[1].hand.length, 0);
  assert.equal(s.phase, 'play');
  assert.equal(s.draw.length, 10, 'the knocked-out hand is not in the draw pile');
  assert.equal(s.aside.length, 25, '"Set aside their hand of cards until the deck runs out"');
  assert.equal(allCards(s).length, total);
  assert.equal(new Set(allCards(s).map((c) => c.id)).size, total);
  assert.equal(s.turn, 2);
  assert.equal(s.stack, 0);
});
test('mercy: 24 cards is not knocked out', () => {
  const s = nm({
    hands: { 0: [card(1001, 'red', 'd4'), card(1002, 'red', '1'), card(1003, 'red', '2')], 1: numHand(20, 2000) },
    draw: [...junk(game('nomercy'), 10), ...numHand(4, 3000)],
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 1, type: 'draw' }));
  assert.equal(s.players[1].out, false);
  assert.equal(s.players[1].hand.length, 24);
});
test('mercy: set-aside hands join the next reshuffle', () => {
  const s = nm({ hands: { 0: [card(1001, 'blue', '9'), card(1002, 'blue', '8')] }, draw: [] });
  s.discard = [card(1010, 'green', '4'), card(1011, 'red', '5')];
  s.aside = [card(1020, 'yellow', '1'), card(1021, 'yellow', '2')];
  const total = allCards(s).length;
  mustOk(act(s, { p: 0, type: 'draw' })); // draw until playable: reshuffle discard (minus top) + aside
  assert.equal(s.aside.length, 0);
  assert.equal(top(s).id, 1011);
  assert.equal(allCards(s).length, total);
});
test('mercy: last player standing wins; each knocked-out player is worth a flat 250', () => {
  const s = nm({
    hands: { 0: [card(1001, 'red', 'd4'), card(1002, 'red', '1'), card(1003, 'red', '2')], 1: numHand(21, 2000), 2: [], 3: [] },
    draw: [...junk(game('nomercy'), 10), ...numHand(4, 3000)],
  });
  s.players[2].out = true;
  s.players[3].out = true;
  const want = 3 * 250; // "250 Points for each player knocked out ... (ignore the cards in their hand)"
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 1, type: 'draw' }));
  assert.ok(['roundOver', 'gameOver'].includes(s.phase));
  assert.equal(s.winner, 0);
  assert.equal(s.lastRound.points, want);
  assert.equal(s.players[0].score, want);
  for (const p of [1, 2, 3]) assert.equal(s.lastRound.detail.find((d) => d.p === p).pts, 250);
});
test('mercy: out players are skipped by turn order in both directions', () => {
  let s = nm({ hands: { 0: [card(1001, 'red', '3'), card(1002, 'red', '4'), card(1003, 'red', '6')] } });
  s.players[1].out = true;
  s.players[1].hand = [];
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.turn, 2);
  s = nm({ dir: -1, turn: 2, hands: { 2: [card(1001, 'red', '3'), card(1002, 'red', '4'), card(1003, 'red', '6')] } });
  s.players[1].out = true;
  s.players[1].hand = [];
  mustOk(act(s, { p: 2, type: 'play', id: 1001 }));
  assert.equal(s.turn, 0);
  assert.equal(nextIdx(s, 2), 0);
  assert.deepEqual(active(s), [0, 2, 3]);
});
test('mercy: knocked-out player cannot act', () => {
  const s = nm({});
  s.players[1].out = true;
  s.players[1].hand = [];
  mustNo(act(s, { p: 1, type: 'draw' }));
  mustNo(act(s, { p: 1, type: 'call' }));
});

// ---------- 8. scoring / rounds ----------
function scoringGame(target) {
  return setup(game('classic', 4, 3, target), {
    hands: {
      0: [card(1001, 'red', '5')],
      1: [card(1002, 'red', 'skip'), card(1003, 'blue', '7')],
      2: [card(1004, 'wild', 'wild'), card(1005, 'green', 'd2')],
      3: [card(1006, 'wild', 'wd4'), card(1007, 'yellow', '9'), card(1008, 'blue', 'rev')],
    },
    topCard: card(900, 'red', '3'),
  });
}
test('scoring: winner collects value of other hands (classic)', () => {
  const s = scoringGame(500);
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.phase, 'roundOver');
  assert.equal(s.winner, 0);
  assert.equal(s.lastRound.points, 20 + 7 + 50 + 20 + 50 + 9 + 20);
  assert.equal(s.players[0].score, 176);
  assert.deepEqual(s.lastRound.detail.map((d) => d.pts), [0, 27, 70, 79]);
  mustNo(act(s, { p: 1, type: 'draw' }));
});
test('scoring: reaching target -> gameOver and nextRound refuses', () => {
  const s = scoringGame(100);
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.phase, 'gameOver');
  assert.throws(() => nextRound(s));
});
test('scoring: target 0 ends after a single round', () => {
  const s = scoringGame(0);
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.phase, 'gameOver');
});
test('rounds: nextRound resets state, round 2 starts with player 1, scores kept', () => {
  const s = scoringGame(500);
  s.dir = -1;
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.throws(() => nextRound(game()), /not over/);
  nextRound(s);
  assert.equal(s.phase, 'play');
  assert.equal(s.round, 2);
  assert.equal(s.turn, 1);
  assert.equal(s.dir, 1);
  assert.equal(s.side, 'light');
  assert.equal(s.winner, null);
  assert.equal(s.players[0].score, 176);
  for (const pl of s.players) { assert.equal(pl.hand.length, 7); assert.equal(pl.out, false); }
  assert.equal(allCards(s).length, 108);
  assert.match(top(s).light.v, /^\d$/);
});
test('scoring: going out on a draw card still makes next draw and counts it', () => {
  const s = setup(game('classic', 4, 3, 500), {
    hands: { 0: [card(1001, 'red', 'd2')], 1: [card(1002, 'blue', '7')], 2: [card(1003, 'blue', '1')], 3: [card(1004, 'blue', '1')] },
    draw: [card(1100, 'blue', '4'), card(1101, 'blue', '3')],
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.players[1].hand.length, 3);
  assert.equal(s.lastRound.points, 7 + 3 + 4 + 1 + 1);
});
test('scoring: points() by mode and side', () => {
  const c = game('classic');
  assert.equal(points(c, card(1, 'red', '7')), 7);
  assert.equal(points(c, card(1, 'red', 'd2')), 20);
  assert.equal(points(c, card(1, 'wild', 'wild')), 50);
  assert.equal(points(c, card(1, 'wild', 'wd4')), 50);
  const f = game('flip');
  assert.equal(points(f, fcard(1, 'red', 'd1', 'pink', 'd5')), 10);
  assert.equal(points(f, fcard(1, 'wild', 'wild', 'wild', 'wdc')), 40);
  f.side = 'dark';
  assert.equal(points(f, fcard(1, 'red', 'd1', 'pink', 'd5')), 20);
  assert.equal(points(f, fcard(1, 'wild', 'wild', 'wild', 'wdc')), 60);
  assert.equal(points(f, fcard(1, 'red', 'd1', 'pink', 'skipall')), 30);
});

// ---------- 9. simulation ----------
const STEP_CAP = 20000;
function invariants(s, total) {
  const all = allCards(s);
  assert.equal(all.length, total, 'card count constant');
  assert.equal(new Set(all.map((c) => c.id)).size, total, 'ids unique');
  s.players.forEach((pl, i) => {
    if (pl.out) assert.equal(pl.hand.length, 0, `out player ${i} has empty hand`);
  });
  if (s.phase === 'play') {
    assert.equal(s.players[s.turn].out, false, 'turn on out player');
    if (s.pending) assert.equal(s.players[s.pending.p].out, false);
  }
}
function simulate(mode, n, seed) {
  const s = newGame({ mode, players: Array.from({ length: n }, (_, i) => ({ name: 'B' + i, bot: true })), target: 300, seed });
  const total = allCards(s).length;
  let steps = 0;
  invariants(s, total);
  while (s.phase !== 'gameOver') {
    if (++steps > STEP_CAP) assert.fail(`${mode} n=${n} seed=${seed} exceeded step cap`);
    if (s.phase === 'roundOver') { nextRound(s); invariants(s, total); continue; }
    if (s.vulnerable !== null) {
      for (let q = 0; q < n && s.vulnerable !== null; q++) {
        if (q === s.vulnerable || s.players[q].out) continue;
        if (botCatch(s, q)) {
          const r = act(s, { p: q, type: 'catch', target: s.vulnerable });
          assert.equal(r.ok, true, 'catch: ' + JSON.stringify(r));
          invariants(s, total);
        }
      }
    }
    const p = actor(s);
    const a = botAction(s, p);
    assert.ok(a, 'bot has an action');
    const r = act(s, a);
    assert.equal(r.ok, true, `${mode} n=${n} seed=${seed}: ${JSON.stringify(a)} -> ${JSON.stringify(r)}`);
    invariants(s, total);
  }
  assert.notEqual(s.winner, null);
  assert.ok(s.players[s.winner].score >= 300);
}
for (const mode of ['classic', 'flip', 'nomercy']) {
  for (let n = 4; n <= 8; n++) {
    test(`simulation: ${mode} with ${n} bots x25 games`, () => {
      for (let g = 0; g < 25; g++) simulate(mode, n, 1000 * n + g * 17 + mode.length);
    });
  }
}

// ---------- 10. edge rules found in code review ----------
test('stalemate: nobody can play and nothing is left to draw → lowest hand wins', () => {
  const s = setup(game('classic'), {
    hands: { 0: [card(1001, 'blue', '9')], 1: [card(1002, 'blue', '8'), card(1003, 'green', '1')], 2: [card(1004, 'blue', '2')], 3: [card(1005, 'green', '7')] },
    draw: [],
  });
  for (let i = 0; i < 4; i++) mustOk(act(s, { p: actor(s), type: 'draw' }));
  assert.equal(s.phase, 'roundOver');
  assert.equal(s.winner, 2);
  assert.equal(s.lastRound.points, 9 + 9 + 7);
});
test('stalemate: empty draws by players who could play do not end the round', () => {
  const s = setup(game('classic'), {
    hands: { 0: [card(1001, 'red', '9')], 1: [card(1002, 'red', '8')], 2: [card(1003, 'red', '2')], 3: [card(1004, 'red', '7')] },
    draw: [],
  });
  for (let i = 0; i < 8; i++) mustOk(act(s, { p: actor(s), type: 'draw' }));
  assert.equal(s.phase, 'play');
});
test('reshuffle: an empty draw pile is rebuilt from the discard, top card stays', () => {
  const s = setup(game('classic'), { hands: { 0: [card(1001, 'blue', '9'), card(1002, 'blue', '3')] }, draw: [] });
  const t = top(s);
  s.discard = [card(1010, 'green', '4'), card(1011, 'yellow', '6'), t];
  mustOk(act(s, { p: 0, type: 'draw' }));
  assert.equal(top(s), t);
  assert.equal(s.discard.length, 1);
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(s.draw.length, 1);
});
test('reverse with two active players acts as a skip', () => {
  const s = setup(game('nomercy'), { hands: { 0: [card(1001, 'red', 'rev'), card(1002, 'red', '1'), card(1003, 'red', '2')] } });
  for (const i of [2, 3]) Object.assign(s.players[i], { out: true, hand: [] });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.dir, -1);
  assert.equal(s.turn, 0);
});
test('seed determinism: the same seed deals the same game', () => {
  const a = game('flip', 5, 42), b = game('flip', 5, 42);
  assert.deepEqual(a.players.map((p) => p.hand), b.players.map((p) => p.hand));
  assert.deepEqual(a.draw, b.draw);
  assert.notDeepEqual(game('flip', 5, 43).draw, a.draw);
});
test('going out on a Flip card flips before scoring', () => {
  const s = setup(game('flip'), {
    hands: {
      0: [fcard(1001, 'red', 'flip', 'pink', '3')], 1: [fcard(1002, 'blue', 'skip', 'teal', 'skipall')],
      2: [fcard(1003, 'blue', '1', 'teal', '1')], 3: [fcard(1004, 'blue', '2', 'teal', '2')],
    },
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.side, 'dark');
  assert.equal(s.lastRound.points, 30 + 1 + 2); // dark faces: Skip Everyone 30, not light Skip 20
});

// =====================================================================================================
// 11. LIAR MODE
// =====================================================================================================
const bluff = (id, c, v) => ({ id, light: { c, v }, liar: true });
const lm = (extra) => setup(game('liar'), extra);
const sameFace = (a, b) => a.c === b.c && a.v === b.v;
const hasId = (hand, id) => hand.some((c) => c.id === id);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const myHand = (s, p) => s.players[p].hand;

test('liar deck: composition, ids, hands and points', () => {
  const s = game('liar', 5, 3);
  const all = allCards(s);
  assert.equal(all.length, 112);
  assert.equal(new Set(all.map((c) => c.id)).size, 112);
  const regular = [], bl = [];
  for (const c of LIGHT) {
    for (let n = 0; n <= 9; n++) { regular.push(`${c}:${n}`); bl.push(`${c}:${n}`); }
    for (const v of ['d2', 'rev', 'skip']) bl.push(`${c}:${v}`, `${c}:${v}`);
  }
  for (let i = 0; i < 6; i++) regular.push('wild:wlc');
  bl.push('wild:wd4', 'wild:wd4');
  assert.deepEqual(all.filter((c) => !c.liar).map((c) => key(c.light)).sort(), regular.sort());
  assert.deepEqual(all.filter((c) => c.liar).map((c) => key(c.light)).sort(), bl.sort());
  assert.ok(all.every((c) => !c.dark));
  for (const pl of s.players) assert.equal(pl.hand.length, 7);
  assert.match(top(s).light.v, /^\d$/);
  const P = (c, v) => points(s, bluff(1, c, v));
  assert.equal(P('red', '7'), 7);
  assert.equal(P('red', 'd2'), 20);
  assert.equal(P('red', 'rev'), 20);
  assert.equal(P('red', 'skip'), 20);
  assert.equal(P('wild', 'wd4'), 50);
  assert.equal(points(s, card(1, 'wild', 'wlc')), 50);
});

test('liar: regular cards play face up with normal matching', () => {
  const s = lm({ hands: { 0: [card(1001, 'red', '3'), card(1002, 'blue', '9'), card(1003, 'green', '1')] } });
  mustNo(act(s, { p: 0, type: 'play', id: 1002 }));
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.claim, null);
  assert.equal(top(s).id, 1001);
  assert.equal(s.pending, null);
  assert.equal(s.turn, 1);
});

test('liar: a bluff card goes face down and opens a doubt for the next player', () => {
  const s = lm({ hands: { 0: [bluff(1001, 'blue', '9'), card(1002, 'green', '1'), card(1003, 'green', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'red', v: '3' } }));
  assert.equal(s.pending.type, 'doubt');
  assert.equal(s.pending.p, 1);
  assert.equal(s.pending.from, 0);
  assert.deepEqual(s.claim, { c: 'red', v: '3' });
  assert.equal(s.color, 'red');
  assert.equal(top(s).id, 1001);
  assert.equal(myHand(s, 0).length, 2);
  assert.equal(actor(s), 1);
  mustNo(act(s, { p: 1, type: 'draw' }));
  mustNo(act(s, { p: 1, type: 'play', id: myHand(s, 1)[0].id }));
  mustNo(act(s, { p: 0, type: 'accept' }));
  mustNo(act(s, { p: 2, type: 'accept' }));
});

test('liar: claim must be a believable card; a bluff card may be anything underneath', () => {
  const valid = [{ c: 'red', v: '3' }, { c: 'blue', v: '5' }, { c: 'green', v: '5' }, { c: 'wild', v: 'wd4' }, { c: 'red', v: 'skip' }, { c: 'red', v: 'd2' }, { c: 'red', v: '0' }];
  const invalid = [{ c: 'blue', v: '7' }, { c: 'wild', v: 'wild' }, { c: 'wild', v: 'wlc' }, { c: 'red', v: 'wd4' }, { c: 'wild', v: '5' },
    { c: 'red', v: 'd1' }, { c: 'red', v: '10' }, { c: 'pink', v: '5' }, undefined, null, 5, 'red', { c: 1, v: 2 }, { c: 'red' }, { v: '3' },
    { c: ['red'], v: '3' }, { c: 'red', v: ['3'] }, {}, { c: 'blue', v: 'skip' }];
  for (const real of [bluff(1001, 'blue', '9'), bluff(1001, 'wild', 'wd4'), bluff(1001, 'red', '5')]) {
    for (const claim of valid) {
      const s = lm({ hands: { 0: [real, card(1002, 'green', '1'), card(1003, 'green', '2')] } });
      mustOk(act(s, { p: 0, type: 'play', id: 1001, claim }));
    }
    for (const claim of invalid) {
      const s = lm({ hands: { 0: [real, card(1002, 'green', '1'), card(1003, 'green', '2')] } });
      mustNo(act(s, { p: 0, type: 'play', id: 1001, claim }));
      assert.equal(myHand(s, 0).length, 3);
      assert.equal(s.pending, null);
      assert.equal(s.claim, null);
      assert.equal(s.discard.length, 1);
    }
  }
});

test('liar: claimOptions on a face-up top = same color (13 values) + same value in other colors + wd4', () => {
  const s = lm();
  const o = E.claimOptions(s);
  assert.equal(o.length, 17);
  assert.equal(o.filter((x) => x.c === 'red').length, 13);
  for (const c of ['yellow', 'green', 'blue']) assert.deepEqual(o.filter((x) => x.c === c), [{ c, v: '5' }]);
  assert.ok(o.some((x) => sameFace(x, { c: 'wild', v: 'wd4' })));
});

test('liar: with a face-down top, claims and matching follow the claim, not the real card', () => {
  const s = lm({ hands: { 0: [card(1001, 'green', '7'), card(1002, 'yellow', 'd2')] } });
  s.discard.push(bluff(950, 'red', '5'));
  s.claim = { c: 'blue', v: 'd2' };
  s.color = 'blue';
  const o = E.claimOptions(s);
  assert.equal(o.length, 17);
  for (const c of ['red', 'yellow', 'green']) assert.deepEqual(o.filter((x) => x.c === c), [{ c, v: 'd2' }]);
  assert.equal(o.filter((x) => x.c === 'blue').length, 13);
  assert.ok(!o.some((x) => x.v === '5' && x.c !== 'blue'));
  mustNo(act(s, { p: 0, type: 'play', id: 1001 })); // green 7 does not fit blue d2
  mustOk(act(s, { p: 0, type: 'play', id: 1002 })); // yellow d2 matches the claimed value
});

function bluffPlay(real, claim, extra) {
  const s = lm(Object.assign({ hands: { 0: [real, card(1002, 'green', '1'), card(1003, 'green', '2')] } }, extra));
  mustOk(act(s, { p: 0, type: 'play', id: real.id, claim }));
  return s;
}

test('liar: accepting applies the claimed effect, true or not', () => {
  for (const real of [bluff(1001, 'red', 'd2'), bluff(1001, 'blue', '9')]) {
    const s = bluffPlay(real, { c: 'red', v: 'd2' });
    mustOk(act(s, { p: 1, type: 'accept' }));
    assert.equal(myHand(s, 1).length, 6);
    assert.equal(s.turn, 2);
    assert.equal(s.pending, null);
    assert.deepEqual(s.claim, { c: 'red', v: 'd2' }); // stays face down
    assert.equal(s.color, 'red');
    assert.equal(top(s).id, 1001);
  }
  let s = bluffPlay(bluff(1001, 'blue', '9'), { c: 'red', v: 'skip' });
  mustOk(act(s, { p: 1, type: 'accept' }));
  assert.equal(s.turn, 2);
  assert.equal(myHand(s, 1).length, 4);
  s = bluffPlay(bluff(1001, 'blue', '9'), { c: 'red', v: 'rev' });
  mustOk(act(s, { p: 1, type: 'accept' }));
  assert.equal(s.dir, -1);
  assert.equal(s.turn, 3);
  s = bluffPlay(bluff(1001, 'blue', '9'), { c: 'red', v: '3' });
  mustOk(act(s, { p: 1, type: 'accept' }));
  assert.equal(s.turn, 1);
  assert.equal(myHand(s, 1).length, 4);
});

test('liar: 7 gives a swap choice and 0 rotates every hand after accept', () => {
  let s = bluffPlay(bluff(1001, 'blue', '9'), { c: 'red', v: '7' });
  mustOk(act(s, { p: 1, type: 'accept' }));
  assert.equal(s.pending.type, 'swap');
  assert.equal(s.pending.p, 0);
  const h2 = myHand(s, 2).slice(), h0 = myHand(s, 0).slice();
  mustNo(act(s, { p: 0, type: 'swap', target: 0 }));
  mustOk(act(s, { p: 0, type: 'swap', target: 2 }));
  assert.deepEqual(myHand(s, 0), h2);
  assert.deepEqual(myHand(s, 2), h0);
  assert.equal(s.turn, 1);
  s = lm({ hands: { 0: [bluff(1001, 'blue', '9'), card(1002, 'green', '1'), card(1003, 'green', '2')], 1: [card(1011, 'green', '3'), card(1012, 'green', '4'), card(1013, 'green', '5'), card(1014, 'green', '6')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'red', v: '0' } }));
  const before = [0, 1, 2, 3].map((i) => myHand(s, i).slice());
  mustOk(act(s, { p: 1, type: 'accept' }));
  for (let i = 0; i < 4; i++) assert.deepEqual(myHand(s, (i + 1) % 4), before[i]);
  assert.equal(s.turn, 1);
});

test('liar: claiming Wild Draw 4 asks for a color first, then opens the doubt; accept = 4 cards', () => {
  const s = lm({ hands: { 0: [bluff(1001, 'blue', '9'), card(1002, 'green', '1'), card(1003, 'green', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'wild', v: 'wd4' } }));
  assert.equal(s.pending.type, 'color');
  assert.equal(s.pending.p, 0);
  assert.deepEqual(s.claim, { c: 'wild', v: 'wd4' });
  mustNo(act(s, { p: 1, type: 'accept' }));
  mustNo(act(s, { p: 1, type: 'challenge' }));
  mustNo(act(s, { p: 2, type: 'challenge' })); // no doubt yet
  mustNo(act(s, { p: 0, type: 'color', color: 'pink' }));
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  assert.equal(s.color, 'blue');
  assert.equal(s.pending.type, 'doubt');
  assert.equal(s.pending.p, 1);
  mustOk(act(s, { p: 1, type: 'accept' }));
  assert.equal(myHand(s, 1).length, 8);
  assert.equal(s.turn, 2);
});

test('liar: wd4 caught bluff restores the previous color', () => {
  const s = lm({ hands: { 0: [bluff(1001, 'blue', '9'), card(1002, 'green', '1'), card(1003, 'green', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'wild', v: 'wd4' } }));
  mustOk(act(s, { p: 0, type: 'color', color: 'green' }));
  mustOk(act(s, { p: 3, type: 'challenge' }));
  assert.equal(s.color, 'red');
  assert.equal(s.claim, null);
  assert.equal(myHand(s, 0).length, 4);
  assert.equal(myHand(s, 1).length, 4);
  assert.equal(s.turn, 1);
});

test('liar: challenge against a truthful card: challenger draws 1, card turns face up, effect applies', () => {
  let s = bluffPlay(bluff(1001, 'red', 'd2'), { c: 'red', v: 'd2' });
  mustOk(act(s, { p: 2, type: 'challenge' })); // out of turn
  assert.equal(myHand(s, 2).length, 5);
  assert.equal(s.claim, null);
  assert.equal(myHand(s, 1).length, 6);
  assert.equal(s.turn, 2);
  assert.equal(s.pending, null);
  assert.equal(top(s).id, 1001);
  s = bluffPlay(bluff(1001, 'red', 'd2'), { c: 'red', v: 'd2' });
  mustOk(act(s, { p: 1, type: 'challenge' })); // the asked player is wrong: 1 + 2
  assert.equal(myHand(s, 1).length, 7);
  assert.equal(s.turn, 2);
  s = bluffPlay(bluff(1001, 'red', 'rev'), { c: 'red', v: 'rev' });
  mustOk(act(s, { p: 3, type: 'challenge' }));
  assert.equal(myHand(s, 3).length, 5);
  assert.equal(s.dir, -1);
  assert.equal(s.turn, 3);
});

test('liar: a real wd4 that is claimed truthfully also punishes a wrong challenger', () => {
  const s = lm({ hands: { 0: [bluff(1001, 'wild', 'wd4'), card(1002, 'green', '1'), card(1003, 'green', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'wild', v: 'wd4' } }));
  mustOk(act(s, { p: 0, type: 'color', color: 'yellow' }));
  mustOk(act(s, { p: 2, type: 'challenge' }));
  assert.equal(myHand(s, 2).length, 5);
  assert.equal(myHand(s, 1).length, 8);
  assert.equal(s.color, 'yellow');
  assert.equal(s.turn, 2);
});

test('liar: challenge against a bluff: card returns to its owner plus one drawn, state restored, turn after the bluffer', () => {
  for (const challenger of [1, 2, 3]) {
    const s = bluffPlay(bluff(1001, 'blue', '9'), { c: 'red', v: 'd2' });
    const total = allCards(s).length;
    mustOk(act(s, { p: challenger, type: 'challenge' }));
    assert.equal(myHand(s, 0).length, 4);
    assert.ok(hasId(myHand(s, 0), 1001));
    assert.equal(s.claim, null);
    assert.equal(s.color, 'red');
    assert.equal(top(s).id, 900);
    assert.equal(s.discard.length, 1);
    assert.equal(s.pending, null);
    assert.equal(s.turn, 1);
    assert.equal(myHand(s, 1).length, 4); // no d2 effect
    assert.equal(allCards(s).length, total);
  }
});

test('liar: a caught bluff on top of a face-down card restores that earlier claim and color', () => {
  const s = lm({ hands: { 0: [bluff(1001, 'green', '2'), card(1002, 'green', '1'), card(1003, 'green', '4')], 1: [bluff(1011, 'red', '9'), card(1012, 'green', '3'), card(1013, 'green', '3')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'yellow', v: '5' } }));
  assert.equal(s.color, 'yellow');
  mustOk(act(s, { p: 1, type: 'accept' }));
  assert.equal(s.turn, 1);
  mustOk(act(s, { p: 1, type: 'play', id: 1011, claim: { c: 'yellow', v: '3' } }));
  assert.equal(s.pending.p, 2);
  assert.equal(s.pending.from, 1);
  mustOk(act(s, { p: 3, type: 'challenge' }));
  assert.deepEqual(s.claim, { c: 'yellow', v: '5' });
  assert.equal(s.color, 'yellow');
  assert.equal(top(s).id, 1001);
  assert.ok(hasId(myHand(s, 1), 1011));
  assert.equal(myHand(s, 1).length, 4);
  assert.equal(s.turn, 2);
  // the earlier card is still face down and can itself be doubted later only via its own episode: claim keeps matching
  assert.equal(E.canPlay(s, 2, card(5000, 'green', '5')), true);
});

test('liar: the player who played cannot call their own bluff; a non-asked player cannot accept', () => {
  const s = bluffPlay(bluff(1001, 'blue', '9'), { c: 'red', v: '3' });
  mustNo(act(s, { p: 0, type: 'challenge' }));
  mustNo(act(s, { p: 0, type: 'accept' }));
  mustNo(act(s, { p: 2, type: 'accept' }));
  assert.equal(s.pending.type, 'doubt');
  mustOk(act(s, { p: 3, type: 'challenge' }));
});

test('liar: going out face down needs the doubt to pass (accept = round over)', () => {
  const mk = (real, claim) => {
    const s = lm({ hands: { 0: [real] } });
    mustOk(act(s, { p: 0, type: 'play', id: real.id, claim }));
    return s;
  };
  let s = mk(bluff(1001, 'blue', '9'), { c: 'red', v: '3' });
  assert.equal(s.pending.type, 'doubt');
  assert.equal(s.pending.final, true);
  assert.equal(s.phase, 'play');
  mustOk(act(s, { p: 1, type: 'accept' }));
  assert.equal(s.phase, 'roundOver');
  assert.equal(s.winner, 0);
  assert.equal(s.lastRound.points, 108);
  assert.equal(s.players[0].score, 108);
  // going out on a claimed draw card still makes the next player draw, and it counts
  s = mk(bluff(1001, 'blue', '9'), { c: 'red', v: 'd2' });
  mustOk(act(s, { p: 1, type: 'accept' }));
  assert.equal(s.phase, 'roundOver');
  assert.equal(myHand(s, 1).length, 6);
  assert.equal(s.lastRound.points, 126);
});

test('liar: going out face down - truthful card wins even when challenged; a caught bluff plays on', () => {
  let s = lm({ hands: { 0: [bluff(1001, 'red', '3')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'red', v: '3' } }));
  mustOk(act(s, { p: 2, type: 'challenge' }));
  assert.equal(s.phase, 'roundOver');
  assert.equal(s.winner, 0);
  assert.equal(myHand(s, 2).length, 5);
  assert.equal(s.lastRound.points, sum([1, 2, 3].map((i) => sum(myHand(s, i).map((c) => points(s, c))))));
  s = lm({ hands: { 0: [bluff(1001, 'blue', '9')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'red', v: '3' } }));
  mustOk(act(s, { p: 1, type: 'challenge' }));
  assert.equal(s.phase, 'play');
  assert.equal(myHand(s, 0).length, 2);
  assert.ok(hasId(myHand(s, 0), 1001));
  assert.equal(s.turn, 1);
  assert.equal(s.winner, null);
  // wd4 claim as the last card: color, then final doubt
  s = lm({ hands: { 0: [bluff(1001, 'blue', '9')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'wild', v: 'wd4' } }));
  mustOk(act(s, { p: 0, type: 'color', color: 'green' }));
  assert.equal(s.pending.final, true);
  mustOk(act(s, { p: 1, type: 'accept' }));
  assert.equal(s.phase, 'roundOver');
  assert.equal(myHand(s, 1).length, 8);
});

test('liar: playing down to one card without "Last card!" makes you vulnerable; a caught bluff clears it', () => {
  const s = lm({ hands: { 0: [bluff(1001, 'blue', '9'), card(1002, 'green', '1')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'red', v: '3' } }));
  assert.equal(s.vulnerable, 0);
  mustOk(act(s, { p: 2, type: 'challenge' }));
  assert.equal(s.vulnerable, null);
});

function calloutScenario(extra, handFix) {
  const hands = {
    0: [card(1001, 'wild', 'wlc'), card(1002, 'red', '1'), card(1003, 'red', '2')],
    1: [card(1011, 'blue', '3'), card(1012, 'red', '4')],
    2: [card(1021, 'green', '4'), card(1022, 'yellow', '1')], // no blue: free to bluff when blue is called
    3: [card(1031, 'red', '6'), card(1032, 'green', '2')],
  };
  const s = lm(Object.assign({ hands: Object.assign(hands, handFix) }, extra));
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  return s;
}
const placeAll = (s, picks) => { for (const [p, id] of picks) mustOk(act(s, { p, type: 'place', id })); };

test('liar Call-Out: color, then everyone else places in turn order, then the caller reveals', () => {
  const s = calloutScenario();
  assert.equal(s.pending.type, 'color');
  mustNo(act(s, { p: 0, type: 'color', color: 'pink' }));
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  assert.equal(s.color, 'blue');
  assert.equal(s.pending.type, 'place');
  assert.equal(s.pending.p, 1);
  assert.equal(s.pending.from, 0);
  assert.equal(s.pending.color, 'blue');
  mustNo(act(s, { p: 2, type: 'place', id: 1021 })); // not your turn
  mustNo(act(s, { p: 0, type: 'place', id: 1002 })); // the caller does not place
  mustNo(act(s, { p: 1, type: 'place', id: 1021 })); // not in your hand
  mustNo(act(s, { p: 1, type: 'draw' }));
  mustOk(act(s, { p: 1, type: 'place', id: 1011 }));
  assert.equal(s.pending.type, 'place');
  assert.equal(s.pending.p, 2);
  assert.ok(hasId(myHand(s, 1), 1011), 'placed card stays in hand until settled');
  mustOk(act(s, { p: 2, type: 'place', id: 1021 }));
  mustOk(act(s, { p: 3, type: 'place', id: 1031 }));
  assert.equal(s.pending.type, 'callout');
  assert.equal(s.pending.p, 0);
  for (const target of [0, 1.5, '1', 9, -1, NaN, null, undefined, 7]) mustNo(act(s, { p: 0, type: 'reveal', target }));
  mustNo(act(s, { p: 0, type: 'stop' })); // reveal at least one first
  mustNo(act(s, { p: 1, type: 'reveal', target: 2 }));
});

test('liar Call-Out: a truthful card ends it at once; all placed cards go under the Call-Out card', () => {
  const s = calloutScenario();
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  placeAll(s, [[1, 1011], [2, 1021], [3, 1031]]);
  const total = allCards(s).length;
  mustOk(act(s, { p: 0, type: 'reveal', target: 1 })); // blue 3: truthful
  assert.equal(s.pending, null);
  assert.equal(s.discard.map((c) => c.id).join(), '900,1011,1021,1031,1001');
  assert.equal(top(s).id, 1001);
  assert.equal(s.color, 'blue');
  assert.equal(s.claim, null);
  assert.equal(s.turn, 1);
  assert.equal(myHand(s, 1).length, 1);
  assert.equal(myHand(s, 2).length, 1);
  assert.equal(allCards(s).length, total);
  assert.equal(s.phase, 'play');
});

test('liar Call-Out: a bluffer keeps the card and draws 1; the caller may go on or stop', () => {
  const s = calloutScenario();
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  placeAll(s, [[1, 1011], [2, 1021], [3, 1031]]);
  const total = allCards(s).length;
  mustOk(act(s, { p: 0, type: 'reveal', target: 2 })); // green 4: bluff
  assert.equal(myHand(s, 2).length, 3);
  assert.ok(hasId(myHand(s, 2), 1021));
  assert.equal(s.pending.type, 'callout');
  assert.equal(s.pending.shown[2].truthful, false);
  assert.deepEqual(s.pending.shown[2].face, { c: 'green', v: '4' });
  mustNo(act(s, { p: 0, type: 'reveal', target: 2 })); // already flipped
  mustOk(act(s, { p: 0, type: 'stop' }));
  assert.equal(s.pending, null);
  assert.equal(s.discard.map((c) => c.id).join(), '900,1011,1031,1001'); // 1021 not under it
  assert.equal(s.turn, 1);
  assert.equal(s.color, 'blue');
  assert.equal(allCards(s).length, total);
});

test('liar Call-Out: ends by itself when every placed card is a caught bluff; wild is never of the color', () => {
  const s = calloutScenario({}, { 2: [card(1023, 'wild', 'wlc'), card(1024, 'green', '4')], 1: [card(1013, 'red', '5'), card(1014, 'red', '6')], 3: [card(1033, 'green', '3'), card(1034, 'green', '2')] });
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  placeAll(s, [[1, 1013], [2, 1023], [3, 1033]]);
  mustOk(act(s, { p: 0, type: 'reveal', target: 2 }));
  assert.equal(s.pending.shown[2].truthful, false);
  mustOk(act(s, { p: 0, type: 'reveal', target: 1 }));
  assert.equal(s.pending.type, 'callout');
  mustOk(act(s, { p: 0, type: 'reveal', target: 3 }));
  assert.equal(s.pending, null);
  assert.equal(s.discard.map((c) => c.id).join(), '900,1001');
  for (const i of [1, 2, 3]) assert.equal(myHand(s, i).length, 3);
  assert.equal(s.turn, 1);
});

test('liar Call-Out: players left with no cards win together and each scores the others\' hands', () => {
  const s = calloutScenario({}, { 1: [card(1011, 'blue', '3')], 2: [card(1021, 'blue', '4')], 3: [card(1031, 'green', '1'), card(1032, 'green', '2')] });
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  placeAll(s, [[1, 1011], [2, 1021], [3, 1031]]);
  mustOk(act(s, { p: 0, type: 'reveal', target: 3 })); // bluff: p3 draws 1 (green 9)
  mustOk(act(s, { p: 0, type: 'stop' }));
  assert.equal(s.phase, 'roundOver');
  assert.deepEqual(s.lastRound.winners, [1, 2]);
  const expectPts = (1 + 2 + 9) + (1 + 2); // p3: green1 green2 + drawn 9 ... p0: red 1, red 2
  assert.equal(s.lastRound.points, expectPts);
  assert.equal(s.players[1].score, expectPts);
  assert.equal(s.players[2].score, expectPts);
  assert.equal(s.players[0].score, 0);
  assert.equal(s.players[3].score, 0);
  assert.deepEqual(s.lastRound.detail.map((d) => d.pts), [3, 0, 0, 12]);
  assert.equal(myHand(s, 1).length, 0);
  assert.equal(myHand(s, 2).length, 0);
});

test('liar Call-Out: holding the called color forces you to put one down; without it any card may go down', () => {
  const s = calloutScenario({}, { 1: [card(1011, 'blue', '3'), card(1012, 'red', '4'), card(1013, 'wild', 'wlc')] });
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  const v = E.view(s, 1);
  assert.deepEqual(v.hand.filter((h) => h.playable).map((h) => h.id), [1011], 'only the blue card is marked');
  mustNo(act(s, { p: 1, type: 'place', id: 1012 })); // red while holding blue
  mustNo(act(s, { p: 1, type: 'place', id: 1013 })); // a wild is not "of that color"
  mustOk(act(s, { p: 1, type: 'place', id: 1011 }));
  assert.deepEqual(E.view(s, 2).hand.filter((h) => h.playable).map((h) => h.id).sort(), [1021, 1022], 'no blue: anything goes');
  assert.deepEqual(E.view(s, 3).hand.filter((h) => h.playable), [], 'not your turn to place yet');
});
test('liar Call-Out: placing order follows a reversed direction and the turn passes the other way', () => {
  const s = calloutScenario({ dir: -1 });
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  assert.equal(s.pending.p, 3);
  mustNo(act(s, { p: 1, type: 'place', id: 1011 }));
  placeAll(s, [[3, 1031], [2, 1021], [1, 1011]]);
  assert.equal(s.pending.type, 'callout');
  mustOk(act(s, { p: 0, type: 'reveal', target: 1 }));
  assert.equal(s.turn, 3);
});

test('liar Call-Out: going out with the Wild Call-Out card wins immediately', () => {
  const s = lm({ hands: { 0: [card(1001, 'wild', 'wlc')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(s.phase, 'roundOver');
  assert.equal(s.winner, 0);
  assert.equal(s.pending, null);
  assert.equal(s.lastRound.points, 108);
});

test('liar reshuffle safety: catching someone while a doubt is pending keeps the top two discards', () => {
  const s = lm({ hands: { 0: [bluff(1001, 'blue', '9'), card(1002, 'green', '1')] }, draw: [] });
  s.discard = [card(1010, 'green', '4'), card(1011, 'yellow', '6'), card(900, 'red', '5')];
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'red', v: '3' } }));
  assert.equal(s.vulnerable, 0);
  const total = allCards(s).length;
  mustOk(act(s, { p: 2, type: 'catch', target: 0 })); // draws 2 from a freshly reshuffled pile
  assert.equal(myHand(s, 0).length, 3);
  assert.deepEqual(s.discard.map((c) => c.id), [900, 1001]);
  mustOk(act(s, { p: 3, type: 'challenge' }));
  assert.equal(top(s).id, 900, 'the card under the caught bluff is uncovered');
  assert.equal(s.claim, null);
  assert.equal(allCards(s).length, total);
  assert.equal(new Set(allCards(s).map((c) => c.id)).size, total);
  assert.ok(s.discard.length >= 1);
});

test('liar reshuffle safety: a caught bluff with an empty draw pile uncovers the previous card', () => {
  const s = lm({ hands: { 0: [bluff(1001, 'blue', '9'), card(1002, 'green', '1'), card(1003, 'green', '2')] }, draw: [] });
  s.discard = [card(1010, 'green', '4'), card(1011, 'yellow', '6'), card(900, 'red', '5')];
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'red', v: '3' } }));
  const total = allCards(s).length;
  mustOk(act(s, { p: 1, type: 'challenge' }));
  assert.equal(top(s).id, 900);
  assert.equal(myHand(s, 0).length, 4);
  assert.equal(allCards(s).length, total);
  assert.equal(s.color, 'red');
  // and with only the previous card left under the bluff nothing can be drawn, but nothing is lost either
  const t = lm({ hands: { 0: [bluff(1001, 'blue', '9'), card(1002, 'green', '1'), card(1003, 'green', '2')] }, draw: [] });
  mustOk(act(t, { p: 0, type: 'play', id: 1001, claim: { c: 'red', v: '3' } }));
  mustOk(act(t, { p: 1, type: 'challenge' }));
  assert.equal(top(t).id, 900);
  assert.equal(myHand(t, 0).length, 3);
  assert.equal(t.phase, 'play');
});

// ---------- bots over whole games (also used for the view redaction checks) ----------
const COV = { accept: 0, challengeNext: 0, challengeOut: 0, caught: 0, truthful: 0, callout: 0, place: 0, reveal: 0, final: 0, wlc: 0, drawn: 0, vul: 0 };
function runBots(mode, n, seed, onStep, target = 300) {
  const s = newGame({ mode, players: Array.from({ length: n }, (_, i) => ({ name: 'B' + i, bot: true })), target, seed });
  const total = allCards(s).length;
  let steps = 0;
  const chk = () => { invariants(s, total); assert.ok(s.discard.length > 0, 'discard never empty'); };
  chk();
  if (onStep) onStep(s, steps);
  while (s.phase !== 'gameOver') {
    if (++steps > STEP_CAP) assert.fail(`${mode} n=${n} seed=${seed} exceeded step cap`);
    if (s.phase === 'roundOver') { nextRound(s); chk(); if (onStep) onStep(s, steps); continue; }
    if (s.vulnerable !== null) {
      for (let q = 0; q < n && s.vulnerable !== null; q++) {
        if (q === s.vulnerable || s.players[q].out) continue;
        if (botCatch(s, q)) { mustOk(act(s, { p: q, type: 'catch', target: s.vulnerable })); chk(); COV.vul++; }
      }
    }
    if (s.pending && s.pending.type === 'doubt') {
      for (let q = 0; q < n && s.pending && s.pending.type === 'doubt'; q++) {
        if (E.botDoubt(s, q)) {
          const tp = top(s), pd = s.pending, bl = !sameFace(face(s, tp), pd.claim);
          const r = act(s, { p: q, type: 'challenge' });
          assert.equal(r.ok, true, `botDoubt ${q}: ${JSON.stringify(r)}`);
          COV.challengeOut++;
          COV[bl ? 'caught' : 'truthful']++;
          chk();
        }
      }
    }
    if (s.phase !== 'play') { if (onStep) onStep(s, steps); continue; } // an out-of-turn call ended the round
    const p = actor(s);
    const a = botAction(s, p);
    assert.ok(a, 'bot has an action');
    const pd = s.pending;
    if (pd) {
      if (pd.type === 'doubt') {
        const bl = !sameFace(face(s, top(s)), pd.claim);
        if (a.type === 'accept') COV.accept++;
        else { COV.challengeNext++; COV[bl ? 'caught' : 'truthful']++; }
        if (pd.final) COV.final++;
      }
      if (pd.type === 'place') COV.place++;
      if (pd.type === 'callout' && a.type === 'reveal') COV.reveal++;
      if (pd.type === 'drawn') COV.drawn++;
    }
    const wasWlc = a.type === 'play' && !pd && face(s, myHand(s, p).find((c) => c.id === a.id) || { light: {} }).v === 'wlc';
    const r = act(s, a);
    assert.equal(r.ok, true, `${mode} n=${n} seed=${seed}: ${JSON.stringify(a)} -> ${JSON.stringify(r)}`);
    if (wasWlc) COV.wlc++;
    chk();
    if (onStep) onStep(s, steps);
  }
  assert.notEqual(s.winner, null);
  assert.ok(s.players[s.winner].score >= target);
  return s;
}
for (let n = 4; n <= 8; n++) {
  test(`simulation: liar with ${n} bots x25 games (botDoubt out of turn)`, () => {
    for (let g = 0; g < 25; g++) runBots('liar', n, 7000 * n + g * 31 + 5);
  });
}
test('simulation: liar games exercised doubts, caught bluffs and Call-Outs', () => {
  for (let g = 0; g < 6; g++) runBots('liar', 4 + (g % 5), 123 + g * 11);
  for (const k of ['accept', 'challengeNext', 'challengeOut', 'caught', 'truthful', 'place', 'reveal', 'final', 'wlc']) assert.ok(COV[k] > 0, `coverage: ${k} ${JSON.stringify(COV)}`);
});

// =====================================================================================================
// 12. VIEW REDACTION
// =====================================================================================================
function walkObj(x, path, f) {
  if (Array.isArray(x)) x.forEach((y, i) => walkObj(y, `${path}[${i}]`, f));
  else if (x && typeof x === 'object') {
    f(x, path);
    for (const k of Object.keys(x)) walkObj(x[k], path ? `${path}.${k}` : k, f);
  }
}
// peek.cards: the official "show the challenger your hand" after a Wild Draw challenge; checked below to reach only them
const FACE_OK = /^(top\.face|hand\[\d+\]\.face|claims\[\d+\]|pending\.claim|pending\.shown\[\d+\]\.face|players\[\d+\]\.backs\[\d+\]|drawBack|peek\.cards\[\d+\])$/;
const BANNED = ['seed', 'legal', 'prevColor', 'prevClaim', 'draw', 'discard'];
const PEND_KEYS = new Set(['type', 'p', 'from', 'v', 'reveal', 'id', 'claim', 'final', 'color', 'shown', 'placed', 'mine']);
const SEEN = { drawnOwner: 0, drawnOther: 0, mine: 0, down: 0, claims: 0, shown: 0, backs: 0 };
function checkView(s, p) {
  const v = E.view(s, p), txt = JSON.stringify(v);
  assert.ok(txt.length < 65536, 'view < 64KB: ' + txt.length);
  assert.deepEqual(JSON.parse(txt), v, 'view survives a JSON round trip unchanged');
  assert.deepEqual(v.hand.map((c) => c.id), myHand(s, p).map((c) => c.id), 'hand ids are exactly the viewer\'s');
  assert.equal(v.seat, p);
  walkObj(v, '', (o, path) => {
    for (const k of BANNED) assert.ok(!(k in o), `banned key ${k} at ${path}`);
    if ('id' in o) assert.ok(/^hand\[\d+\]$/.test(path) || path === 'pending', `id leaked at ${path}`);
    if (typeof o.c === 'string' && typeof o.v === 'string') assert.ok(FACE_OK.test(path), `face object at ${path}`);
  });
  if (s.peek && s.peek.p === p) assert.deepEqual(v.peek.cards, s.peek.cards);
  else assert.equal(v.peek, null, 'only the challenger sees the challenged hand');
  const pd = s.pending, vp = v.pending;
  if (!pd) assert.equal(vp, null);
  else {
    for (const k of Object.keys(vp)) assert.ok(PEND_KEYS.has(k), 'pending key ' + k);
    if (pd.type === 'drawn' && pd.p === p) { assert.equal(vp.id, pd.id); SEEN.drawnOwner++; }
    else { assert.ok(!('id' in vp), 'pending.id only for the drawn owner'); if (pd.type === 'drawn') SEEN.drawnOther++; }
    if (pd.type === 'place' || pd.type === 'callout') {
      assert.equal(vp.mine, pd.placed[p] == null ? null : pd.placed[p]);
      if (vp.mine !== null) { SEEN.mine++; assert.ok(hasId(myHand(s, p), vp.mine)); }
      assert.deepEqual(vp.placed, pd.placed.map((id, i) => id != null || !!pd.shown[i]));
      assert.ok(vp.placed.every((b) => typeof b === 'boolean'));
      if (pd.shown.some(Boolean)) SEEN.shown++;
    } else assert.ok(!('mine' in vp) && !('placed' in vp));
  }
  assert.deepEqual(Object.keys(v.top).sort(), ['down', 'face']);
  if (s.claim) {
    SEEN.down++;
    assert.equal(v.top.down, true);
    assert.deepEqual(v.top.face, s.claim);
  } else {
    assert.equal(v.top.down, false);
    assert.deepEqual(v.top.face, face(s, top(s)));
  }
  if (s.mode === 'liar' && actor(s) === p && (!pd || pd.type === 'drawn')) { assert.ok(Array.isArray(v.claims)); SEEN.claims++; } else assert.equal(v.claims, null);
  v.players.forEach((pl, i) => {
    if (s.mode === 'flip' && i !== p) {
      assert.deepEqual(pl.backs, myHand(s, i).map((c) => E.otherFace(s, c)));
      if (pl.backs.length) SEEN.backs++;
    } else assert.equal(pl.backs, null);
    assert.equal(pl.count, myHand(s, i).length);
  });
  if (s.mode === 'flip') {
    const dt = s.draw[s.draw.length - 1];
    assert.deepEqual(v.drawBack, dt ? E.otherFace(s, dt) : null);
  } else assert.equal(v.drawBack, null);
  assert.equal(v.drawCount, s.draw.length);
  return v;
}

for (const mode of ['classic', 'flip', 'nomercy', 'liar']) {
  test(`view redaction: ${mode} at many states of seeded bot games, every seat`, () => {
    let checked = 0;
    for (const n of [4, 5, 8]) {
      for (let g = 0; g < 3; g++) {
        runBots(mode, n, 31 * n + g * 7 + mode.length, (s, step) => {
          if (step % 3 && !s.pending) return;
          for (let p = 0; p < n; p++) { checkView(s, p); checked++; }
        }, mode === 'nomercy' ? 120 : 150);
      }
    }
    assert.ok(checked > 1000, 'checked ' + checked);
  });
}
test('view redaction: the simulations saw every special case at least once', () => {
  for (const k of ['drawnOwner', 'drawnOther', 'down', 'claims', 'backs']) assert.ok(SEEN[k] > 0, `${k}: ${JSON.stringify(SEEN)}`);
});

test('view redaction: a face-down top shows only the claim, in every seat, and events do not leak it', () => {
  const s = lm({ hands: { 0: [bluff(1001, 'blue', '9'), card(1002, 'green', '1'), card(1003, 'green', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'red', v: '3' } }));
  for (let p = 0; p < 4; p++) {
    const v = checkView(s, p), txt = JSON.stringify(v);
    assert.equal(v.top.down, true);
    assert.deepEqual(v.top.face, { c: 'red', v: '3' });
    assert.ok(!/"blue"/.test(txt.replace(/"events":.*$/, '')) || p === 99, 'no blue anywhere outside events');
    assert.ok(!/Blue 9|blue 9/.test(txt), 'events do not name the real card');
    assert.equal(v.claims, null); // not the actor
    assert.deepEqual(v.pending.claim, { c: 'red', v: '3' });
    assert.ok(!('legal' in v.pending) && !('prevClaim' in v.pending));
  }
  const v1 = E.view(s, 1);
  assert.equal(v1.pending.p, 1);
  assert.equal(v1.pending.from, 0);
  walkObj(v1, '', (o) => assert.ok(!(o.c === 'blue' && o.v === '9'), 'real face derivable'));
  assert.ok(!hasId(v1.hand, 1001));
  assert.equal(E.view(s, 0).hand.length, 2);
});

test('view redaction: Call-Out placements show only whether a card is down, and `mine` only to its owner', () => {
  const s = calloutScenario();
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  assert.equal(E.view(s, 2).color, 'blue');
  placeAll(s, [[1, 1011], [2, 1021]]);
  for (let p = 0; p < 4; p++) checkView(s, p);
  assert.equal(E.view(s, 1).pending.mine, 1011);
  assert.equal(E.view(s, 2).pending.mine, 1021);
  assert.equal(E.view(s, 3).pending.mine, null);
  assert.equal(E.view(s, 0).pending.mine, null);
  assert.deepEqual(E.view(s, 3).pending.placed, [false, true, true, false]);
  mustOk(act(s, { p: 3, type: 'place', id: 1031 }));
  mustOk(act(s, { p: 0, type: 'reveal', target: 2 }));
  for (let p = 0; p < 4; p++) checkView(s, p);
  const v = E.view(s, 3);
  assert.deepEqual(v.pending.shown[2], { face: { c: 'green', v: '4' }, truthful: false });
  assert.equal(v.pending.shown[1], null);
  assert.equal(v.pending.shown[3], null);
});

test('view redaction: while a color is being chosen the color is hidden; roulette/drawn owner rules hold in classic', () => {
  const s = setup(game('classic'), { hands: { 0: [card(1001, 'wild', 'wild'), card(1002, 'red', '1'), card(1003, 'red', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.equal(E.view(s, 1).color, null);
  const t = setup(game('classic'), { hands: { 0: [card(1001, 'blue', '9')] }, draw: [card(1005, 'red', '8')] });
  mustOk(act(t, { p: 0, type: 'draw' }));
  assert.equal(t.pending.type, 'drawn');
  assert.equal(E.view(t, 0).pending.id, 1005);
  for (const p of [1, 2, 3]) assert.ok(!('id' in E.view(t, p).pending));
  for (let p = 0; p < 4; p++) checkView(t, p);
});

// ---------- regressions from the final review ----------
test('liar regression: a face-up card on an accepted face-down card replaces the claim', () => {
  const s = lm({ hands: {
    0: [bluff(1001, 'green', '2'), card(1002, 'red', '1')],
    1: [card(1003, 'red', '8'), card(1004, 'yellow', '1')],
    2: [card(1005, 'blue', '5'), card(1006, 'green', '9')],
  } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'red', v: '5' } }));
  mustOk(act(s, { p: 1, type: 'accept' }));
  mustOk(act(s, { p: 1, type: 'play', id: 1003 }));
  assert.equal(s.claim, null);
  const v = E.view(s, 2);
  assert.equal(v.top.down, false);
  assert.deepEqual(v.top.face, { c: 'red', v: '8' });
  assert.equal(E.canPlay(s, 2, myHand(s, 2)[0]), false); // Blue 5 matches neither red nor 8
});
test('liar regression: a reshuffle while a face-down Wild Draw 4 awaits its color keeps the card under it', () => {
  const s = lm({ hands: {
    0: [bluff(1001, 'green', '3'), card(1002, 'yellow', '1')],
    1: [card(1003, 'blue', '7'), card(1004, 'blue', '8'), card(1005, 'blue', '9')],
  }, draw: [] });
  s.discard = [card(1010, 'yellow', '4'), card(1011, 'green', '6'), card(1012, 'red', '5')];
  s.color = 'red';
  const total = allCards(s).length;
  mustOk(act(s, { p: 0, type: 'play', id: 1001, claim: { c: 'wild', v: 'wd4' } }));
  assert.equal(s.vulnerable, 0);
  mustOk(act(s, { p: 1, type: 'catch', target: 0 })); // empty draw pile: reshuffles mid-decision
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  mustOk(act(s, { p: 1, type: 'challenge' })); // caught: a green 3 is no Wild Draw 4
  assert.equal(top(s).id, 1012);
  assert.equal(s.color, 'red');
  assert.equal(allCards(s).length, total);
  assert.doesNotThrow(() => E.view(s, 2));
});

// ---------- official rule sheets, parameter by parameter ----------
test('points: every card face in every mode matches the official scoring tables', () => {
  const table = {
    classic: { skip: 20, rev: 20, d2: 20, wild: 50, wd4: 50 },
    flip: { d1: 10, d5: 20, rev: 20, skip: 20, flip: 20, skipall: 30, wild: 40, wd2: 50, wdc: 60 },
    nomercy: { skip: 20, rev: 20, d2: 20, d4: 20, discall: 20, skipall: 20, wrd4: 50, wd6: 50, wd10: 50, roul: 50 },
    liar: { skip: 20, rev: 20, d2: 20, wd4: 50, wlc: 50 },
  };
  for (const mode of Object.keys(table)) {
    const s = game(mode);
    const seen = new Set();
    for (const side of mode === 'flip' ? ['light', 'dark'] : ['light']) {
      s.side = side;
      for (const c of allCards(s)) {
        const f = face(s, c), want = /^\d$/.test(f.v) ? +f.v : table[mode][f.v];
        assert.equal(points(s, c), want, `${mode} ${side} ${f.v}`);
        seen.add(f.v);
      }
    }
    for (const v of Object.keys(table[mode])) assert.ok(seen.has(v), `${mode} deck has ${v}`);
  }
});
test('nomercy: a card drawn because nothing fit must be played ("Then, play that card")', () => {
  const s = nm({ hands: { 0: [card(1001, 'blue', '9'), card(1002, 'blue', '8')] }, draw: [card(1100, 'red', '7'), card(1101, 'green', '1')] });
  mustOk(act(s, { p: 0, type: 'draw' }));
  assert.deepEqual([s.pending.type, s.pending.id], ['drawn', 1100]);
  mustNo(act(s, { p: 0, type: 'keep' }));
  assert.equal(E.botAction(s, 0).type === 'play' || E.botAction(s, 0).type === 'call', true);
  mustOk(act(s, { p: 0, type: 'play', id: 1100 }));
  assert.equal(top(s).id, 1100);
});
test('nomercy: going out on a draw card ends the round with no forced draw', () => {
  const s = nm({ hands: { 0: [card(1001, 'red', 'd4')], 1: numHand(3, 2000) } });
  s.stack = 6; s.stackMin = 2;
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.ok(['roundOver', 'gameOver'].includes(s.phase));
  assert.equal(s.players[1].hand.length, 3, 'nobody draws: the sheet only says the player wins');
});
test('nomercy: with two players left, Wild Reverse Draw 4 lands on whoever played it, who may stack it back', () => {
  const s = nm({ hands: { 0: [card(1001, 'wild', 'wrd4'), card(1002, 'red', 'd4'), card(1003, 'red', '1')], 1: numHand(3, 2000) } });
  for (const i of [2, 3]) Object.assign(s.players[i], { out: true, hand: [] });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 0, type: 'color', color: 'red' }));
  assert.deepEqual([s.turn, s.stack, s.dir], [0, 4, -1], '"makes YOU draw 4 cards"');
  mustOk(act(s, { p: 0, type: 'play', id: 1002 })); // stack a +4 to send it back
  assert.deepEqual([s.turn, s.stack], [1, 8]);
});
test('flip: going out on Wild Draw Color still makes the next player draw to the chosen color', () => {
  const s = setup(game('flip'), {
    side: 'dark', topCard: fcard(900, 'red', '5', 'orange', '4'),
    hands: { 0: [fcard(1001, 'wild', 'wd2', 'wild', 'wdc')], 1: [fcard(1010, 'blue', '1', 'pink', '1')] },
    draw: [fcard(1100, 'red', '1', 'teal', '3'), fcard(1101, 'red', '2', 'orange', '2')],
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.deepEqual([s.pending.type, s.pending.p, s.phase], ['color', 0, 'play']);
  mustOk(act(s, { p: 0, type: 'color', color: 'teal' }));
  assert.ok(['roundOver', 'gameOver'].includes(s.phase));
  assert.deepEqual(ids(s.players[1].hand), [1010, 1101, 1100], 'drew orange 2, then teal 3');
  assert.equal(s.lastRound.points, (1 + 2 + 3) + 2 * 4 * 9); // seat 1's three cards + seats 2-3: four teal 9s each
});
test('challenge: the challenger alone sees the challenged hand until their next move', () => {
  const s = setup(game(), { hands: { 0: [card(1001, 'wild', 'wd4'), card(1002, 'red', '1'), card(1003, 'green', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 0, type: 'color', color: 'blue' }));
  mustOk(act(s, { p: 1, type: 'challenge' })); // guilty: red 1 matched the red pile
  const v1 = E.view(s, 1);
  assert.deepEqual(v1.peek.cards.slice(0, 2), [{ c: 'red', v: '1' }, { c: 'green', v: '2' }]);
  assert.equal(v1.peek.of, 0);
  for (const p of [0, 2, 3]) assert.equal(E.view(s, p).peek, null);
  assert.equal(s.turn, 1);
  mustOk(act(s, { p: 1, type: 'draw' }));
  assert.equal(E.view(s, 1).peek, null, 'gone after the challenger moves');
});
// Flip challenge penalties: Wild Draw 2 = 2 (guilty: offender takes them; innocent: challenger takes 2 + 2);
// Wild Draw Color = draw to the color (innocent: to the color, then 2 more).
function flipWild(v, holdsColor) {
  const s = setup(game('flip'), {
    topCard: fcard(900, 'red', '5', 'pink', '5'),
    hands: { 0: [fcard(1001, 'wild', v, 'wild', 'wdc'), fcard(1002, holdsColor ? 'red' : 'blue', '1', 'teal', '1'), fcard(1003, 'green', '2', 'teal', '2')] },
    draw: [...junk(game('flip'), 6), fcard(1100, 'red', '3', 'pink', '3'), fcard(1101, 'red', '4', 'pink', '4')],
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 0, type: 'color', color: 'yellow' }));
  return s;
}
test('flip: Wild Draw 2 accepted -> the next player draws 2 and is skipped', () => {
  const s = flipWild('wd2', false);
  mustOk(act(s, { p: 1, type: 'accept' }));
  assert.deepEqual([s.players[1].hand.length, s.turn], [4 + 2, 2]);
});
test('flip: Wild Draw 2 challenged and guilty -> the player who played it draws 2; the challenger plays', () => {
  const s = flipWild('wd2', true); // held a red card while red was in play
  mustOk(act(s, { p: 1, type: 'challenge' }));
  assert.deepEqual([s.players[0].hand.length, s.players[1].hand.length, s.turn], [2 + 2, 4, 1]);
});
test('flip: Wild Draw 2 challenged and innocent -> the challenger draws 2 + 2 and is skipped', () => {
  const s = flipWild('wd2', false);
  mustOk(act(s, { p: 1, type: 'challenge' }));
  assert.deepEqual([s.players[0].hand.length, s.players[1].hand.length, s.turn], [2, 4 + 4, 2]);
});
test('flip: Wild Draw Color challenged and innocent -> the challenger draws to the color, then 2 more', () => {
  const s = setup(game('flip'), {
    side: 'dark', topCard: fcard(900, 'red', '5', 'orange', '4'),
    hands: { 0: [fcard(1001, 'wild', 'wd2', 'wild', 'wdc'), fcard(1002, 'blue', '1', 'pink', '1'), fcard(1003, 'blue', '2', 'pink', '2')] },
    draw: [...junk(game('flip'), 6), fcard(1100, 'x', '1', 'teal', '3'), fcard(1101, 'x', '1', 'orange', '2'), fcard(1102, 'x', '1', 'pink', '1')],
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 0, type: 'color', color: 'teal' }));
  mustOk(act(s, { p: 1, type: 'challenge' })); // innocent: no orange card in hand
  assert.deepEqual(ids(s.players[1].hand.slice(4, 7)), [1102, 1101, 1100], 'drew to the first teal');
  assert.equal(s.players[1].hand.length, 4 + 3 + 2);
  assert.equal(s.turn, 2);
});
test('flip: Wild Draw Color challenged and guilty -> the player who played it draws to the color', () => {
  const s = setup(game('flip'), {
    side: 'dark', topCard: fcard(900, 'red', '5', 'orange', '4'),
    hands: { 0: [fcard(1001, 'wild', 'wd2', 'wild', 'wdc'), fcard(1002, 'blue', '1', 'orange', '1'), fcard(1003, 'blue', '2', 'pink', '2')] },
    draw: [...junk(game('flip'), 6), fcard(1100, 'x', '1', 'teal', '3'), fcard(1101, 'x', '1', 'orange', '2')],
  });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  mustOk(act(s, { p: 0, type: 'color', color: 'teal' }));
  mustOk(act(s, { p: 1, type: 'challenge' })); // guilty: orange 1 matched the orange pile
  assert.equal(s.players[0].hand.length, 2 + 2);
  assert.equal(s.players[1].hand.length, 4);
  assert.equal(s.turn, 1);
});
test('nomercy: Skip Everyone skips all the other players and you play again', () => {
  const s = nm({ hands: { 0: [card(1001, 'red', 'skipall'), card(1002, 'red', '1'), card(1003, 'red', '2')] } });
  mustOk(act(s, { p: 0, type: 'play', id: 1001 }));
  assert.deepEqual([s.turn, s.pending, s.color], [0, null, 'red']);
});
