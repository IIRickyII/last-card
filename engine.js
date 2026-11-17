/*
 * Last Card — rules engine + bots. Pure logic, no DOM.
 * Browser: <script src="engine.js"> exposes window.LastCard.  Node: require('./engine.js').
 *
 * API
 *   newGame({mode, players:[{name, bot}], target=500, seed?}) -> state
 *       mode: 'classic' | 'flip' | 'nomercy' | 'liar'; 4-8 players; target 0 = single round
 *   nextRound(state)            start the next round (only when state.phase === 'roundOver')
 *   actor(state)                index of the player who must act now (pending decision owner, else turn)
 *   act(state, action)          -> {ok:true} | {ok:false, error}; mutates state
 *     {p, type:'play', id, claim?}  play card `id` (a wild then needs 'color'). Liar mode: a bluff card (card.liar)
 *                                   goes face down claiming {c, v}, which must be one of claimOptions(state)
 *     {p, type:'draw'}            classic/flip/liar: draw 1; nomercy: draw until playable; facing a stack: take it
 *     {p, type:'keep'}            keep the card just drawn (pending 'drawn') and end the turn
 *     {p, type:'color', color}    answer pending 'color' or 'roulette'; color from colors(state)
 *     {p, type:'accept'}          answer pending 'challenge' or 'doubt': let it stand
 *     {p, type:'challenge'}       answer pending 'challenge' (wild draw) or 'doubt' (call the bluff). During 'doubt'
 *                                 any player except the one who played may send it, even out of turn
 *     {p, type:'swap', target}    answer pending 'swap' (a 7 in nomercy / liar)
 *     {p, type:'place', id}       Liar Call-Out: put one card face down (pending 'place')
 *     {p, type:'reveal', target}  Liar Call-Out: flip target's card (pending 'callout'); {p, type:'stop'} ends it
 *     {p, type:'call'}            "Last card!" — allowed any time p holds 1-2 cards (also saves a vulnerable p)
 *     {p, type:'catch', target}   catch state.vulnerable (target draws 2); any player, any time
 *   view(state, p)              -> plain data with only what player p may know (no other hands, deck order, face-down
 *                                 cards or rng seed). Screens and network players should only ever get this.
 *   botAction(state, p)         -> action for bot p when actor(state) === p, else null
 *   botCatch(state, p)          -> true if bot p decides to catch state.vulnerable right now
 *   botDoubt(state, p)          -> true if bot p calls a bluff it was not asked about
 *   canPlay, playableIds, claimOptions, face, otherFace (flip only), top, colors, label, points, active, nextIdx
 *
 * State (engine-internal: send view() to players, never this)
 *   mode, target, round, phase: 'play' | 'roundOver' | 'gameOver'
 *   side: 'light' | 'dark' (flip only changes it), dir: 1 | -1, turn
 *   color: active color (still the previous color while a 'color' / 'roulette' choice is pending)
 *   claim: what a face-down top card (Liar mode) claims to be, else null
 *   players[i]: {name, bot, hand:[card], score, out (nomercy knockout), called}
 *   card: {id, light:{c, v}, dark?:{c, v}, liar?: true}   c: color or 'wild'
 *     v: '0'-'9' | skip | rev | d1 | d2 | d4 | d5 | flip | skipall | discall | wild | wd2 | wd4 | wdc | wrd4 | wd6
 *        | wd10 | roul | wlc (Wild Call-Out)
 *   draw: [card] (top = last), discard: [card] (top = last)
 *   pending: null | {type:'color', p, reveal?, down?} | {type:'drawn', p, id} | {type:'challenge', p, from, v, legal}
 *     | {type:'swap', p} | {type:'roulette', p, from} | {type:'doubt', p, from, id, claim, prevColor, prevClaim, final}
 *     | {type:'place' | 'callout', p, from, color, placed:[id|null], shown:[{face, truthful}|null]}
 *   stack, stackMin (nomercy draw stack), vulnerable (player who missed "Last card!", or null)
 *   winner, lastRound: {winner, winners, points, detail:[{p, pts}]}, events: [{n, type, p, text}] (last 60)
 */
(function (root) {
  'use strict';

  const MODES = ['classic', 'flip', 'nomercy', 'liar'];
  const COLORS = { light: ['red', 'yellow', 'green', 'blue'], dark: ['pink', 'teal', 'orange', 'purple'] };
  const NAMES = {
    skip: 'Skip', rev: 'Reverse', d1: 'Draw 1', d2: 'Draw 2', d4: 'Draw 4', d5: 'Draw 5', flip: 'Flip',
    skipall: 'Skip Everyone', discall: 'Discard All', wild: 'Wild', wd2: 'Wild Draw 2', wd4: 'Wild Draw 4',
    wdc: 'Wild Draw Color', wrd4: 'Wild Reverse Draw 4', wd6: 'Wild Draw 6', wd10: 'Wild Draw 10', roul: 'Wild Color Roulette',
    wlc: 'Wild Call-Out',
  };
  const DRAW = { d1: 1, d2: 2, d4: 4, d5: 5, wd2: 2, wd4: 4, wrd4: 4, wd6: 6, wd10: 10 };
  const CHALLENGE = { wd4: true, wd2: true, wdc: true };
  const PTS = {
    classic: { skip: 20, rev: 20, d2: 20, wild: 50, wd4: 50 },
    flip: { d1: 10, d5: 20, skip: 20, rev: 20, flip: 20, skipall: 30, wild: 40, wd2: 50, wdc: 60 },
    nomercy: { skip: 20, rev: 20, d2: 20, discall: 20, skipall: 20, d4: 20, wrd4: 50, wd6: 50, wd10: 50, roul: 50 },
    liar: { skip: 20, rev: 20, d2: 20, wd4: 50, wlc: 50 },
  };
  const HAND_SIZE = 7, MERCY = 25, KNOCKOUT_BONUS = 250;
  const SWAPS = { nomercy: true, liar: true }; // a 0 passes every hand on, a 7 swaps with a chosen player
  const CLAIMS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'd2', 'rev', 'skip']; // plus Wild Draw 4

  // ---------- seeded rng (state lives in s.seed so games replay from a seed) ----------
  function rand(s) {
    let t = (s.seed = (s.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(s, a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- deck ----------
  const nums = (from, n) => Array.from({ length: 10 - from }, (_, i) => [String(from + i), n]);
  function faces(colors, spec, wilds) {
    const out = [];
    for (const c of colors) for (const [v, n] of spec) for (let i = 0; i < n; i++) out.push({ c, v });
    for (const [v, n] of wilds) for (let i = 0; i < n; i++) out.push({ c: 'wild', v });
    return out;
  }
  function buildDeck(s) {
    let light, dark = null;
    if (s.mode === 'classic') {
      light = faces(COLORS.light, [['0', 1], ...nums(1, 2), ['skip', 2], ['rev', 2], ['d2', 2]], [['wild', 4], ['wd4', 4]]);
    } else if (s.mode === 'nomercy') {
      light = faces(COLORS.light, [...nums(0, 2), ['d2', 3], ['d4', 2], ['skip', 3], ['skipall', 2], ['rev', 3], ['discall', 3]],
        [['wrd4', 8], ['wd6', 4], ['wd10', 4], ['roul', 8]]);
    } else if (s.mode === 'liar') {
      // bluff cards (played face down): one of each number per color and every action except the Call-Out
      const cards = [
        ...faces(COLORS.light, nums(0, 1), [['wlc', 6]]).map((f) => ({ light: f })),
        ...faces(COLORS.light, [...nums(0, 1), ['d2', 2], ['rev', 2], ['skip', 2]], [['wd4', 2]]).map((f) => ({ light: f, liar: true })),
      ];
      return shuffle(s, cards.map((c, id) => Object.assign({ id }, c)));
    } else {
      light = faces(COLORS.light, [...nums(1, 2), ['d1', 2], ['rev', 2], ['skip', 2], ['flip', 2]], [['wild', 4], ['wd2', 4]]);
      dark = shuffle(s, faces(COLORS.dark, [...nums(1, 2), ['d5', 2], ['rev', 2], ['skipall', 2], ['flip', 2]], [['wild', 4], ['wdc', 4]]));
    }
    return shuffle(s, light.map((f, id) => (dark ? { id, light: f, dark: dark[id] } : { id, light: f })));
  }

  // ---------- helpers ----------
  const face = (s, card) => (s.side === 'dark' ? card.dark : card.light);
  const otherFace = (s, card) => (card.dark ? (s.side === 'dark' ? card.light : card.dark) : null);
  const top = (s) => s.discard[s.discard.length - 1];
  const topFace = (s) => s.claim || face(s, top(s)); // a face-down card counts as what it claims
  const colors = (s) => COLORS[s.side];
  const isWild = (f) => f.c === 'wild';
  const isNum = (f) => /^\d$/.test(f.v);
  const actor = (s) => (s.pending ? s.pending.p : s.turn);
  const active = (s) => s.players.flatMap((pl, i) => (pl.out ? [] : [i]));
  const name = (s, i) => s.players[i].name;
  const plural = (k) => `${k} card${k === 1 ? '' : 's'}`;
  const ok = () => ({ ok: true });
  const no = (error) => ({ ok: false, error });

  function label(f) {
    const n = NAMES[f.v] || f.v;
    return isWild(f) ? n : f.c[0].toUpperCase() + f.c.slice(1) + ' ' + n;
  }
  function points(s, card) {
    const f = face(s, card);
    return isNum(f) ? +f.v : PTS[s.mode][f.v];
  }
  const handPts = (s, pl) => pl.hand.reduce((a, c) => a + points(s, c), 0);

  function nextIdx(s, from, steps = 1) {
    const n = s.players.length;
    let i = from;
    for (let k = 0; k < steps; k++) do i = (i + s.dir + n) % n; while (s.players[i].out);
    return i;
  }
  function log(s, type, p, text) {
    s.events.push({ n: ++s.seq, type, p, text });
    if (s.events.length > 60) s.events.shift();
  }

  // ---------- drawing ----------
  function drawOne(s) {
    if (!s.draw.length) {
      // keep the top card; while a face-down card is unresolved (its color being picked, or in doubt) also the one
      // under it, which a caught bluff uncovers. No Mercy: knocked-out hands set aside join this reshuffle.
      const keep = s.pending && (s.pending.type === 'doubt' || s.pending.down) ? 2 : 1;
      const pool = s.discard.slice(0, Math.max(0, s.discard.length - keep)).concat(s.aside);
      if (!pool.length) return null; // every card is in someone's hand
      s.discard = s.discard.slice(-keep);
      s.aside = [];
      s.draw = shuffle(s, pool);
      log(s, 'shuffle', -1, 'Discard pile shuffled into a new draw pile');
    }
    return s.draw.pop();
  }
  // Draw up to n cards for p, stopping early once until(card) is true. Returns {k, last}.
  function draw(s, p, n, until) {
    const pl = s.players[p];
    let k = 0, last = null;
    while (k < n) {
      const c = drawOne(s);
      if (!c) break;
      pl.hand.push(c);
      k++;
      last = c;
      if (until && until(c)) break;
    }
    if (k) {
      pl.called = false;
      if (s.vulnerable === p) s.vulnerable = null;
    }
    return { k, last };
  }

  // ---------- rounds ----------
  function newGame({ mode = 'classic', players, target = 500, seed } = {}) {
    if (!MODES.includes(mode)) throw new Error('Unknown mode: ' + mode);
    if (!Array.isArray(players) || players.length < 4 || players.length > 8) throw new Error('Need 4-8 players');
    const s = {
      mode, target, round: 0, seq: 0, events: [],
      seed: seed == null ? (Math.random() * 4294967296) >>> 0 : seed >>> 0,
      players: players.map((p, i) => ({ name: p.name || 'Player ' + (i + 1), bot: !!p.bot, hand: [], score: 0, out: false, called: false })),
    };
    startRound(s);
    return s;
  }
  function nextRound(s) {
    if (s.phase !== 'roundOver') throw new Error('Round is not over');
    startRound(s);
  }
  function startRound(s) {
    s.round++;
    Object.assign(s, {
      phase: 'play', side: 'light', dir: 1, stack: 0, stackMin: 0, pending: null, vulnerable: null, winner: null,
      lastRound: null, passes: 0, claim: null, aside: [], peek: null,
    });
    for (const pl of s.players) Object.assign(pl, { hand: [], out: false, called: false });
    s.draw = buildDeck(s);
    for (let r = 0; r < HAND_SIZE; r++) for (const pl of s.players) pl.hand.push(s.draw.pop());
    const n = s.players.length;
    s.turn = (s.round - 1) % n; // the deal moves one seat each round; the dealer sits just before s.turn
    log(s, 'round', s.turn, `Round ${s.round}: ${name(s, s.turn)} goes first`);
    openingCard(s, (s.turn - 1 + n) % n);
  }
  // Turn up the first discard and do what each rule sheet says about it.
  function openingCard(s, dealer) {
    const first = s.turn;
    s.discard = [];
    for (;;) {
      const card = s.draw.pop(), f = card.light;
      if (isNum(f)) {
        s.discard.push(card);
        s.color = f.c;
        return;
      }
      if (s.mode === 'nomercy' || s.mode === 'liar') { // "ignore it and flip over the next card"
        s.discard.push(card);
        continue;
      }
      if (f.v === 'wd4' || f.v === 'wd2' || f.v === 'flip') { // back into the deck, shuffle, turn up another
        s.draw.push(card);
        shuffle(s, s.draw);
        continue;
      }
      s.discard.push(card);
      log(s, 'play', -1, `The opening card is ${label(f)}`);
      if (f.v === 'wild') { // the player left of the dealer chooses the color
        s.color = null;
        s.pending = { type: 'color', p: first, start: true };
        return;
      }
      s.color = f.c;
      if (f.v === 'skip') log(s, 'skip', first, `${name(s, first)} is skipped`);
      if (DRAW[f.v]) log(s, 'draw', first, `${name(s, first)} draws ${plural(draw(s, first, DRAW[f.v]).k)} and is skipped`);
      if (f.v === 'skip' || DRAW[f.v]) s.turn = nextIdx(s, first);
      if (f.v === 'rev') { // the dealer goes first and play moves the other way
        s.dir = -1;
        s.turn = dealer;
        log(s, 'reverse', dealer, `${name(s, dealer)} goes first, the other way round`);
      }
      return;
    }
  }
  // w: the winner, or several players who went out together (Liar Call-Out); each scores the other hands.
  // A player knocked out in No Mercy is worth a flat KNOCKOUT_BONUS instead of their hand.
  function endRound(s, w) {
    const ws = [].concat(w);
    const detail = s.players.map((pl, p) => ({ p, pts: ws.includes(p) ? 0 : pl.out ? KNOCKOUT_BONUS : handPts(s, pl) }));
    const total = detail.reduce((a, d) => a + d.pts, 0);
    for (const i of ws) s.players[i].score += total;
    const best = ws.reduce((a, b) => (s.players[b].score > s.players[a].score ? b : a));
    Object.assign(s, {
      phase: s.players[best].score >= s.target ? 'gameOver' : 'roundOver',
      winner: best, pending: null, vulnerable: null, stack: 0, stackMin: 0,
      lastRound: { winner: ws[0], winners: ws, points: total, detail },
    });
    log(s, 'round', ws[0], `${ws.map((i) => name(s, i)).join(' & ')} win${ws.length > 1 ? '' : 's'} round ${s.round} (+${total} pts)`);
    if (s.phase === 'gameOver') log(s, 'game', best, `${name(s, best)} wins the game with ${s.players[best].score} pts!`);
  }
  // Nothing left to draw and nobody can play: lowest hand wins.
  function stalemate(s) {
    const w = active(s).reduce((a, b) => (handPts(s, s.players[b]) < handPts(s, s.players[a]) ? b : a));
    log(s, 'round', w, 'No cards left to draw — lowest hand wins the round');
    endRound(s, w);
  }
  // No Mercy: 25+ cards knocks a player out; their hand is set aside until the next reshuffle.
  function mercy(s) {
    if (s.mode !== 'nomercy') return;
    s.players.forEach((pl, i) => {
      if (pl.out || pl.hand.length < MERCY) return;
      log(s, 'out', i, `${pl.name} reached ${pl.hand.length} cards and is knocked out!`);
      pl.out = true;
      s.aside.push(...pl.hand);
      pl.hand = [];
      if (s.vulnerable === i) s.vulnerable = null;
    });
    const left = active(s);
    if (left.length === 1) endRound(s, left[0]);
  }
  function settle(s) {
    if (s.phase !== 'play') return;
    mercy(s);
    if (s.phase !== 'play') return;
    if (s.pending && s.players[s.pending.p].out) s.pending = null;
    if (s.players[s.turn].out) s.turn = nextIdx(s, s.turn);
  }

  // ---------- legality ----------
  function matches(s, f) {
    if (s.stack) return (DRAW[f.v] || 0) >= s.stackMin; // nomercy: only an equal-or-bigger draw card
    if (isWild(f)) return true;
    return f.c === s.color || f.v === topFace(s).v;
  }
  function canPlay(s, p, card) {
    if (s.phase !== 'play' || actor(s) !== p) return false;
    const pd = s.pending;
    if (pd && (pd.type !== 'drawn' || pd.id !== card.id)) return false;
    if (card.liar && !pd) return true; // a bluff card can always go down face down with a believable claim
    return matches(s, face(s, card));
  }
  const playableIds = (s, p) => s.players[p].hand.filter((c) => canPlay(s, p, c)).map((c) => c.id);

  // ---------- actions ----------
  function act(s, a) {
    const r = step(s, a || {});
    if (r.ok) settle(s);
    return r;
  }
  function step(s, a) {
    if (s.phase !== 'play') return no('The round is over');
    const p = a.p, pl = s.players[p];
    if (!pl || pl.out) return no('Invalid player');
    if (a.type === 'call') {
      if (pl.called || pl.hand.length > 2) return no('Call "Last card!" when you have 1 or 2 cards');
      pl.called = true;
      if (s.vulnerable === p) s.vulnerable = null;
      log(s, 'call', p, `${pl.name}: "Last card!"`);
      return ok();
    }
    if (a.type === 'catch') {
      const t = a.target;
      if (t === p || t == null || s.vulnerable !== t) return no('Nobody to catch');
      s.vulnerable = null;
      log(s, 'catch', p, `${pl.name} caught ${name(s, t)} without "Last card!" — ${name(s, t)} draws ${draw(s, t, 2).k}`);
      return ok();
    }
    if (a.type === 'challenge' && s.pending && s.pending.type === 'doubt' && p !== actor(s)) {
      if (p === s.pending.from) return no('You cannot call your own bluff');
      return resolveDoubt(s, p, true); // anyone may call a bluff, not only the next player
    }
    if (p !== actor(s)) return no('Not your turn');
    const vul = s.vulnerable;
    const r = decide(s, p, a);
    if (r.ok && vul !== null && vul !== p && s.vulnerable === vul) s.vulnerable = null; // next player acted: too late to catch
    return r;
  }
  function decide(s, p, a) {
    const pd = s.pending, pl = s.players[p];
    if (s.peek && s.peek.p === p) s.peek = null; // a challenger's look at a hand lasts until their next move
    const want = (t) => pd && pd.type === t;
    switch (a.type) {
      case 'play':
        return pd && !want('drawn') ? no('Answer the pending decision first') : play(s, p, a.id, a.claim);
      case 'draw':
        return pd ? no('Answer the pending decision first') : drawTurn(s, p);
      case 'keep':
        if (!want('drawn')) return no('Nothing to keep');
        if (s.mode === 'nomercy') return no('In No Mercy you must play the card you drew');
        log(s, 'keep', p, `${pl.name} keeps the drawn card`);
        endTurn(s, p, 1);
        return ok();
      case 'color':
        if (!want('color') && !want('roulette')) return no('No color to choose');
        if (!colors(s).includes(a.color)) return no('Invalid color');
        return want('color') ? chooseColor(s, p, a.color) : roulette(s, p, a.color);
      case 'accept':
      case 'challenge':
        if (want('doubt')) return resolveDoubt(s, p, a.type === 'challenge');
        return want('challenge') ? challenge(s, p, a.type === 'challenge') : no('Nothing to challenge');
      case 'place':
        return want('place') ? place(s, p, a.id) : no('Nothing to place');
      case 'reveal':
        return want('callout') ? revealPlaced(s, a.target) : no('Nothing to reveal');
      case 'stop':
        if (!want('callout') || !pd.shown.some(Boolean)) return no('Reveal at least one card first');
        settleCallOut(s);
        return ok();
      case 'swap': {
        const q = a.target, other = s.players[q];
        if (!want('swap')) return no('No swap pending');
        if (q === p || !other || other.out) return no('Pick another player');
        [pl.hand, other.hand] = [other.hand, pl.hand];
        pl.called = other.called = false;
        s.vulnerable = null;
        log(s, 'swap', p, `${pl.name} swaps hands with ${other.name}`);
        endTurn(s, p, 1);
        return ok();
      }
      default:
        return no('Unknown action');
    }
  }
  function endTurn(s, p, steps) {
    s.pending = null;
    s.turn = nextIdx(s, p, steps);
  }

  function play(s, p, id, claim) {
    const pl = s.players[p], card = pl.hand.find((c) => c.id === id);
    if (!card) return no('That card is not in your hand');
    if (!canPlay(s, p, card)) return no('That card cannot be played now');
    if (card.liar) return playDown(s, p, card, claim);
    const f = face(s, card), prev = s.color;
    pl.hand = pl.hand.filter((c) => c !== card);
    const same = f.v === 'discall' ? pl.hand.filter((c) => face(s, c).c === f.c) : [];
    if (same.length) pl.hand = pl.hand.filter((c) => !same.includes(c));
    s.discard.push(...same, card); // Discard All goes on top of the cards it dumps
    s.claim = null; // a face-up card now tops the pile, not an earlier face-down claim
    s.pending = null;
    s.passes = 0;
    log(s, 'play', p, `${pl.name} plays ${label(f)}`);
    if (same.length) log(s, 'discard', p, `${pl.name} also discards ${same.length} ${f.c} ${same.length === 1 ? 'card' : 'cards'}`);
    if (pl.hand.length === 1 && !pl.called) s.vulnerable = p;
    pl.called = false;
    if (!pl.hand.length && f.v === 'wdc') { // going out still makes the next player draw to a color: pick it first
      s.pending = { type: 'color', p, final: true };
      return ok();
    }
    if (!pl.hand.length) return finish(s, p, f);
    if (f.v === 'roul') {
      s.pending = { type: 'roulette', p: nextIdx(s, p), from: p };
      return ok();
    }
    if (isWild(f)) {
      // a challengeable wild is legal only if p had no card of the color in play
      s.pending = { type: 'color', p, legal: !CHALLENGE[f.v] || !pl.hand.some((c) => face(s, c).c === prev) };
      return ok();
    }
    s.color = f.c;
    effect(s, p, f, true);
    return ok();
  }
  // Going out on a draw card still makes the next player draw (it counts for scoring).
  // Classic, Flip and Liar: a draw card played to go out still makes the next player draw (those cards score).
  // No Mercy's sheet just says the player who plays their final card wins, so nobody draws there.
  function finish(s, p, f) {
    if (f.v === 'flip') s.side = s.side === 'light' ? 'dark' : 'light'; // the flip still happens: score the new side
    const n = s.mode === 'nomercy' ? 0 : DRAW[f.v] || 0;
    if (n) {
      const q = nextIdx(s, p);
      log(s, 'draw', q, `${name(s, q)} draws ${plural(draw(s, q, n).k)}`);
    }
    endRound(s, p);
    return ok();
  }
  function effect(s, p, f, legal) {
    const v = f.v, q = nextIdx(s, p);
    if (s.mode === 'nomercy' && DRAW[v]) {
      if (v === 'wrd4') s.dir *= -1;
      s.stack += DRAW[v];
      s.stackMin = DRAW[v];
      // with two players left, Wild Reverse Draw 4 skips the other player: the 4 land on whoever played it,
      // who may stack to send them back
      endTurn(s, p, v === 'wrd4' && active(s).length === 2 ? 2 : 1);
      log(s, 'stack', s.turn, `${name(s, s.turn)} must stack a draw card or take ${s.stack}`);
      return;
    }
    switch (v) {
      case 'skip':
        log(s, 'skip', q, `${name(s, q)} is skipped`);
        return endTurn(s, p, 2);
      case 'skipall':
        log(s, 'skip', p, `Everyone is skipped — ${name(s, p)} goes again`);
        return endTurn(s, p, 0);
      case 'rev':
        s.dir *= -1;
        log(s, 'reverse', p, 'Direction reversed');
        return endTurn(s, p, active(s).length === 2 ? 2 : 1); // with two players Reverse acts as Skip
      case 'flip':
        return flip(s, p);
      case 'wd4': case 'wd2': case 'wdc':
        if (s.mode !== 'liar') {
          s.pending = { type: 'challenge', p: q, from: p, v, legal };
          return;
        }
      // falls through: in Liar mode calling the bluff already replaced the Wild Draw 4 challenge
      case 'd1': case 'd2': case 'd5':
        log(s, 'draw', q, `${name(s, q)} draws ${plural(draw(s, q, DRAW[v]).k)} and is skipped`);
        return endTurn(s, p, 2);
      case 'wlc':
        return callOut(s, p);
      case '7':
        if (SWAPS[s.mode]) {
          s.pending = { type: 'swap', p };
          return;
        }
        break;
      case '0':
        if (SWAPS[s.mode]) rotate(s);
        break;
    }
    endTurn(s, p, 1);
  }
  function rotate(s) {
    const ids = active(s), hands = ids.map((i) => s.players[i].hand);
    ids.forEach((i, k) => { s.players[nextIdx(s, i)].hand = hands[k]; });
    for (const i of ids) s.players[i].called = false;
    s.vulnerable = null;
    log(s, 'rotate', -1, 'Everyone passes their hand to the next player');
  }
  // "Flip over the Discard Pile (the card just played will now be on the bottom), then the Draw Pile, then everyone's
  // hands": both piles turn over as stacks, so the card that was at the bottom of the discard is now on top.
  function flip(s, p) {
    s.side = s.side === 'light' ? 'dark' : 'light';
    s.discard.reverse();
    s.draw.reverse();
    const t = face(s, top(s));
    log(s, 'flip', p, `Everything flips to the ${s.side} side — top card is now ${label(t)}`);
    if (isWild(t)) {
      s.pending = { type: 'color', p, reveal: true }; // flipper picks the color, no effect
      return;
    }
    s.color = t.c;
    endTurn(s, p, 1);
  }
  function chooseColor(s, p, color) {
    const { reveal, legal, down, start, final } = s.pending;
    s.pending = null;
    s.color = color;
    log(s, 'color', p, `${name(s, p)} picks ${color}`);
    if (start) return ok(); // opening Wild: the same player now takes the first turn
    if (final) { // went out on Wild Draw Color: the next player draws to the color, then the round is scored
      const q = nextIdx(s, p);
      log(s, 'draw', q, `${name(s, q)} draws ${plural(draw(s, q, Infinity, (c) => face(s, c).c === color).k)}`);
      endRound(s, p);
      return ok();
    }
    if (reveal) endTurn(s, p, 1);
    else if (down) openDoubt(s, p, down);
    else effect(s, p, face(s, top(s)), legal);
    return ok();
  }

  // ---------- liar mode ----------
  // Every claim a face-down card may make: a card that could legally go on the current top.
  function claimOptions(s) {
    const tv = topFace(s).v, out = [];
    for (const c of COLORS.light) for (const v of CLAIMS) if (c === s.color || v === tv) out.push({ c, v });
    out.push({ c: 'wild', v: 'wd4' });
    return out;
  }
  function playDown(s, p, card, claim) {
    const c = claim && claim.c, v = claim && claim.v, f = { c, v };
    const real = v === 'wd4' ? c === 'wild' : COLORS.light.includes(c) && CLAIMS.includes(v);
    if (!real || !matches(s, f)) return no('Claim a card that could be played here');
    const pl = s.players[p];
    const down = { id: card.id, claim: f, prevColor: s.color, prevClaim: s.claim, final: pl.hand.length === 1 };
    pl.hand = pl.hand.filter((x) => x !== card);
    s.discard.push(card);
    s.claim = f;
    s.pending = null;
    s.passes = 0;
    log(s, 'play', p, `${pl.name} plays a card face down, claiming ${label(f)}`);
    if (pl.hand.length === 1 && !pl.called) s.vulnerable = p;
    pl.called = false;
    if (v === 'wd4') s.pending = { type: 'color', p, down };
    else {
      s.color = c;
      openDoubt(s, p, down);
    }
    return ok();
  }
  function openDoubt(s, p, down) {
    s.pending = Object.assign({ type: 'doubt', p: nextIdx(s, p), from: p }, down);
  }
  // The next player lets the claim stand or calls the bluff (anyone else may call it first). A caught bluff goes
  // back to its owner with one extra card and does nothing; otherwise the claim works as if it were the real card.
  function resolveDoubt(s, r, call) {
    const pd = s.pending, p = pd.from, pl = s.players[p], card = top(s), f = face(s, card);
    s.pending = null;
    if (call) {
      log(s, 'challenge', r, `${name(s, r)} calls the bluff: it's ${label(f)}`);
      if (f.c !== pd.claim.c || f.v !== pd.claim.v) {
        s.discard.pop();
        pl.hand.push(card);
        s.claim = pd.prevClaim;
        s.color = pd.prevColor;
        if (s.vulnerable === p) s.vulnerable = null;
        log(s, 'challenge', p, `${pl.name} takes it back and draws ${plural(draw(s, p, 1).k)}`);
        endTurn(s, p, 1);
        return ok();
      }
      s.claim = null; // turned face up, and it is what it claimed
      log(s, 'challenge', r, `${name(s, r)} was wrong and draws ${plural(draw(s, r, 1).k)}`);
    }
    if (pd.final) return finish(s, p, pd.claim);
    effect(s, p, pd.claim, true);
    return ok();
  }
  // Wild Call-Out: everyone else puts one card face down "of the chosen color"; the caller flips them one by one.
  function callOut(s, p) {
    const n = s.players.length;
    s.pending = { type: 'place', p: nextIdx(s, p), from: p, color: s.color, placed: Array(n).fill(null), shown: Array(n).fill(null) };
    log(s, 'callout', p, `Call-Out! Everyone puts a ${s.color} card face down`);
  }
  // "Each other player must place one card of that color ... A player with no card of that color may place any card"
  function canPlace(s, p, card) {
    const color = s.pending.color, hand = s.players[p].hand;
    return face(s, card).c === color || !hand.some((c) => face(s, c).c === color);
  }
  function place(s, p, id) {
    const pd = s.pending, pl = s.players[p], card = pl.hand.find((c) => c.id === id);
    if (!card) return no('That card is not in your hand');
    if (!canPlace(s, p, card)) return no(`You hold a ${pd.color} card, so one of those must go down`);
    pd.placed[p] = id; // stays in the hand until the Call-Out settles
    log(s, 'place', p, `${pl.name} puts a card face down`);
    const q = nextIdx(s, p);
    if (q === pd.from) {
      pd.type = 'callout';
      pd.p = pd.from;
      log(s, 'callout', pd.from, `${name(s, pd.from)} picks whose card to flip`);
    } else pd.p = q;
    return ok();
  }
  function revealPlaced(s, t) {
    const pd = s.pending;
    if (!Number.isInteger(t) || pd.placed[t] == null || pd.shown[t]) return no('Pick a player whose card is still face down');
    const tp = s.players[t], card = tp.hand.find((c) => c.id === pd.placed[t]), f = face(s, card);
    const truthful = f.c === pd.color; // a wild is never "of that color"
    pd.shown[t] = { face: f, truthful };
    if (truthful) {
      log(s, 'challenge', t, `${tp.name} told the truth: ${label(f)}`);
      settleCallOut(s);
      return ok();
    }
    pd.placed[t] = null; // the bluffer keeps the card
    log(s, 'challenge', t, `${tp.name} was bluffing (${label(f)}) and draws ${plural(draw(s, t, 1).k)}`);
    if (!pd.placed.some((id, i) => id != null && !pd.shown[i])) settleCallOut(s);
    return ok();
  }
  // Cards not caught as bluffs go under the Call-Out card; anyone left without cards wins (together).
  function settleCallOut(s) {
    const pd = s.pending, callout = s.discard.pop(), out = [];
    pd.placed.forEach((id, i) => {
      const pl = s.players[i], card = id == null ? null : pl.hand.find((c) => c.id === id);
      if (!card) return;
      pl.hand = pl.hand.filter((c) => c !== card);
      s.discard.push(card);
      if (!pl.hand.length) out.push(i);
    });
    s.discard.push(callout);
    s.pending = null;
    log(s, 'callout', pd.from, `The other cards go under the Call-Out; the color is ${pd.color}`);
    if (out.length) return endRound(s, out);
    endTurn(s, pd.from, 1);
  }
  // Wild Draw Color: draw until the chosen color appears; others: fixed count. Plus `extra`.
  function penalty(s, who, v, extra) {
    const k = v === 'wdc' ? draw(s, who, Infinity, (c) => face(s, c).c === s.color).k : 0;
    return k + draw(s, who, (DRAW[v] || 0) + extra).k;
  }
  function challenge(s, p, doIt) {
    const { from, v, legal } = s.pending;
    s.pending = null;
    // "The challenged player must show you (the challenger) their hand": only the challenger's view carries it
    if (doIt) s.peek = { p, of: from, n: s.seq + 1, cards: s.players[from].hand.map((c) => face(s, c)) };
    if (!doIt) {
      log(s, 'draw', p, `${name(s, p)} draws ${plural(penalty(s, p, v, 0))} and is skipped`);
      endTurn(s, p, 1);
    } else if (!legal) {
      log(s, 'challenge', p, `Challenge won! ${name(s, from)} could have matched the color and draws ${plural(penalty(s, from, v, 0))}`);
      s.turn = p; // challenger plays normally
    } else {
      log(s, 'challenge', p, `Challenge lost — ${name(s, p)} draws ${plural(penalty(s, p, v, 2))} and is skipped`);
      endTurn(s, p, 1);
    }
    return ok();
  }
  function roulette(s, p, color) {
    s.pending = null;
    s.color = color;
    log(s, 'draw', p, `${name(s, p)} calls ${color} and flips ${plural(draw(s, p, Infinity, (c) => face(s, c).c === color).k)}`);
    endTurn(s, p, 1);
    return ok();
  }
  function drawTurn(s, p) {
    const pl = s.players[p], couldPlay = playableIds(s, p).length > 0;
    let k, last = null;
    if (s.stack) {
      const n = s.stack;
      s.stack = s.stackMin = 0;
      k = draw(s, p, n).k;
      log(s, 'draw', p, `${pl.name} takes the stack: ${plural(k)}`);
    } else {
      const until = s.mode === 'nomercy' ? (c) => matches(s, face(s, c)) : null;
      ({ k, last } = draw(s, p, until ? Infinity : 1, until));
      log(s, 'draw', p, `${pl.name} draws ${plural(k)}`);
    }
    s.passes = k || couldPlay ? 0 : s.passes + 1; // consecutive stuck turns: no legal play and nothing to draw
    if (s.passes >= active(s).length) {
      stalemate(s);
      return ok();
    }
    if (last && matches(s, face(s, last))) s.pending = { type: 'drawn', p, id: last.id };
    else endTurn(s, p, 1);
    return ok();
  }

  // ---------- bots ----------
  function bestColor(s, p) {
    const score = {};
    for (const c of colors(s)) score[c] = rand(s) * 0.5; // tie-break noise
    for (const card of s.players[p].hand) {
      const f = face(s, card);
      if (!isWild(f)) score[f.c] += 1;
    }
    return colors(s).reduce((a, b) => (score[b] > score[a] ? b : a));
  }
  function pickCard(s, p, ids) {
    const hand = s.players[p].hand, threat = s.players[nextIdx(s, p)].hand.length <= 2;
    const count = {};
    for (const c of hand) { const f = face(s, c); count[f.c] = (count[f.c] || 0) + 1; }
    let best = ids[0], bestScore = -Infinity;
    for (const id of ids) {
      const c = hand.find((x) => x.id === id), f = face(s, c);
      let sc = rand(s);
      if (s.stack) sc -= DRAW[f.v]; // stack with the smallest card that works
      else if (isWild(f)) sc += hand.length <= 2 ? 3 : -3; // hold wilds until late
      else sc += count[f.c] + points(s, c) / 20; // follow the longest color, shed points
      if (threat && (DRAW[f.v] || /^(skip|wdc|roul)$/.test(f.v))) sc += 8; // stop the next player going out
      if (CHALLENGE[f.v] && hand.some((x) => face(s, x).c === s.color)) sc -= 5; // rarely bluff
      if (f.v === 'discall') sc += count[f.c] * 1.5;
      if (f.v === '7' && s.mode === 'nomercy') sc += active(s).some((i) => i !== p && s.players[i].hand.length < hand.length - 1) ? 4 : -4;
      if (sc > bestScore) { bestScore = sc; best = id; }
    }
    return best;
  }
  function botAction(s, p) {
    if (s.phase !== 'play' || actor(s) !== p) return null;
    const pd = s.pending, pl = s.players[p];
    const A = (type, extra) => Object.assign({ p, type }, extra);
    const wantCall = () => pl.hand.length === 2 && !pl.called && rand(s) < 0.85; // bots forget sometimes
    if (pd) {
      if (pd.type === 'color' || pd.type === 'roulette') return A('color', { color: bestColor(s, p) });
      if (pd.type === 'challenge') return A(rand(s) < (s.players[pd.from].hand.length >= 5 ? 0.35 : 0.15) ? 'challenge' : 'accept');
      if (pd.type === 'swap') {
        const others = active(s).filter((i) => i !== p);
        return A('swap', { target: others.reduce((a, b) => (s.players[b].hand.length < s.players[a].hand.length ? b : a)) });
      }
      if (pd.type === 'drawn') return wantCall() ? A('call') : A('play', honest(s, p, pd.id));
      if (pd.type === 'doubt') return A(rand(s) < doubtOdds(pd) ? 'challenge' : 'accept');
      if (pd.type === 'place') return A('place', { id: placeCard(s, p, pd.color) });
      if (pd.type === 'callout') return A(...calloutMove(s, pd));
    }
    if (s.mode === 'liar') {
      const m = liarMove(s, p);
      return m.id != null && wantCall() ? A('call') : A(m.type, m);
    }
    const ids = playableIds(s, p);
    if (!ids.length) return A('draw');
    if (wantCall()) return A('call');
    return A('play', { id: pickCard(s, p, ids) });
  }
  // A play action that tells the truth about a bluff card.
  function honest(s, p, id) {
    const c = s.players[p].hand.find((x) => x.id === id);
    return c.liar ? { id, claim: face(s, c) } : { id };
  }
  // Liar mode: play a card that really fits when possible, otherwise usually bluff with a face-down card.
  function liarMove(s, p) {
    const hand = s.players[p].hand, fits = hand.filter((c) => matches(s, face(s, c))).map((c) => c.id);
    if (fits.length) return Object.assign({ type: 'play' }, honest(s, p, pickCard(s, p, fits)));
    const bluffs = hand.filter((c) => c.liar);
    if (!bluffs.length || rand(s) >= 0.7) return { type: 'draw' };
    const c = bluffs.reduce((a, b) => (points(s, b) > points(s, a) ? b : a)), v = face(s, c).v; // dump the costliest
    return { type: 'play', id: c.id, claim: { c: s.color, v: CLAIMS.includes(v) ? v : String(Math.floor(rand(s) * 10)) } };
  }
  function doubtOdds(pd) {
    if (pd.final) return 0.6; // last chance to stop them going out
    return { d2: 0.35, skip: 0.3, wd4: 0.4 }[pd.claim.v] || 0.2;
  }
  function placeCard(s, p, color) {
    const hand = s.players[p].hand, fits = hand.filter((c) => face(s, c).c === color);
    return (fits.length ? fits : hand).reduce((a, b) => (points(s, b) > points(s, a) ? b : a)).id;
  }
  function calloutMove(s, pd) {
    if (pd.shown.some(Boolean) && rand(s) < 0.4) return ['stop'];
    const open = pd.placed.flatMap((id, i) => (id != null && !pd.shown[i] ? [i] : []));
    return ['reveal', { target: open.reduce((a, b) => (s.players[b].hand.length < s.players[a].hand.length ? b : a)) }];
  }
  function botDoubt(s, p) {
    const pd = s.pending;
    return s.phase === 'play' && !!pd && pd.type === 'doubt' && p !== pd.from && p !== pd.p && !s.players[p].out && rand(s) < 0.1;
  }
  function botCatch(s, p) {
    const v = s.vulnerable;
    return s.phase === 'play' && v !== null && v !== p && !s.players[p].out && rand(s) < 0.5;
  }

  // ---------- what one player may see ----------
  // Plain data for player p: their own hand, everyone's card counts and public facts. Never another hand, the deck
  // order, a face-down card, a Call-Out placement, the Wild Draw 4 legality flag or the rng seed. Card ids reveal
  // identities (they follow deck-build order), so only p's own ids appear.
  function view(s, p) {
    const flip = s.mode === 'flip', pd = s.pending, me = s.players[p], who = actor(s);
    const dtop = s.draw[s.draw.length - 1];
    return {
      seat: p, mode: s.mode, target: s.target, round: s.round, phase: s.phase, side: s.side, dir: s.dir,
      turn: s.turn, actor: who, stack: s.stack, vulnerable: s.vulnerable, winner: s.winner,
      color: pd && (pd.type === 'color' || pd.type === 'roulette') ? null : s.color, // null while being picked
      top: s.claim ? { face: s.claim, down: true } : { face: face(s, top(s)), down: false },
      drawCount: s.draw.length, drawBack: flip && dtop ? otherFace(s, dtop) : null,
      players: s.players.map((pl, i) => ({
        name: pl.name, bot: pl.bot, count: pl.hand.length, score: pl.score, out: pl.out, called: pl.called,
        backs: flip && i !== p ? pl.hand.map((c) => otherFace(s, c)) : null, // Flip: everyone sees the other side
      })),
      hand: me ? me.hand.map((c) => ({
        id: c.id, face: face(s, c), liar: !!c.liar,
        playable: canPlay(s, p, c) || (!!pd && pd.type === 'place' && pd.p === p && canPlace(s, p, c)),
      })) : [],
      peek: s.peek && s.peek.p === p ? { of: s.peek.of, n: s.peek.n, cards: s.peek.cards } : null,
      pending: pd ? pendingView(pd, p) : null,
      claims: s.mode === 'liar' && who === p && (!pd || pd.type === 'drawn') ? claimOptions(s) : null,
      lastRound: s.lastRound, events: s.events.slice(-20),
    };
  }
  function pendingView(pd, p) {
    const v = { type: pd.type, p: pd.p };
    if (pd.from != null) v.from = pd.from;
    if (pd.type === 'challenge') v.v = pd.v;
    if (pd.type === 'color' && pd.reveal) v.reveal = true;
    if (pd.type === 'drawn' && pd.p === p) v.id = pd.id;
    if (pd.type === 'doubt') Object.assign(v, { claim: pd.claim, final: pd.final });
    if (pd.type === 'place' || pd.type === 'callout') {
      Object.assign(v, {
        color: pd.color, shown: pd.shown,
        placed: pd.placed.map((id, i) => id != null || !!pd.shown[i]),
        mine: pd.placed[p] == null ? null : pd.placed[p],
      });
    }
    return v;
  }

  const api = {
    MODES, COLORS, NAMES, newGame, nextRound, act, actor, view, botAction, botCatch, botDoubt, canPlay, playableIds,
    claimOptions, face, otherFace, top, colors, label, points, active, nextIdx,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LastCard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
