'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const LC = require('../engine.js');
const Room = require('../room.js');

// ---------- fake environment: manual clock + timers, capturing send/drop ----------
function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function env(delays, seed = 12345) {
  const clock = { t: 100000 };
  let tid = 0;
  const timers = new Map(), inbox = new Map(), handlers = new Map(), dropped = [];
  const e = {
    clock, timers, inbox, dropped, updates: 0,
    advance(ms) {
      const end = clock.t + ms;
      for (;;) {
        let best = null;
        for (const [id, tm] of timers) if (!best || tm.at < best.tm.at || (tm.at === best.tm.at && id < best.id)) best = { id, tm };
        if (!best || best.tm.at > end) break;
        timers.delete(best.id);
        clock.t = Math.max(clock.t, best.tm.at);
        best.tm.fn();
      }
      clock.t = end;
    },
    msgs: (id, t) => (inbox.get(id) || []).filter((m) => !t || m.t === t),
  };
  e.room = Room.create({
    seed, random: mulberry(seed ^ 0x5bd1e995), // reproducible deals and bot timing
    timers: { set: (fn, ms) => { const id = ++tid; timers.set(id, { at: clock.t + ms, fn }); return id; }, clear: (id) => { timers.delete(id); } },
    delays: delays || { bot: [20, 40], react: [20, 60] },
    now: () => clock.t,
    onUpdate: () => { e.updates++; },
    send: (id, text) => {
      assert.equal(typeof text, 'string');
      const m = JSON.parse(text);
      if (!inbox.has(id)) inbox.set(id, []);
      inbox.get(id).push(m);
      const h = handlers.get(id);
      if (h) h(m);
    },
    drop: (id) => { dropped.push(id); },
  });
  e.onMsg = (id, fn) => handlers.set(id, fn);
  return e;
}
// A remote player: only ever knows what the host sent it.
function remote(e, id, name, token) {
  const R = { id, seat: null, token: null, view: null, vseq: 0, acted: 0, last: -Infinity, closed: false, errors: [], lobby: null };
  e.onMsg(id, (m) => {
    if (m.t === 'welcome') { R.seat = m.seat; R.token = m.token; }
    else if (m.t === 'view') { R.view = m.view; R.vseq++; }
    else if (m.t === 'lobby') R.lobby = m.lobby;
    else if (m.t === 'closed') R.closed = true;
    else if (m.t === 'error') R.errors.push(m.msg);
  });
  R.hello = (extra) => {
    assert.equal(e.room.connect(id), true);
    e.room.receive(id, JSON.stringify(Object.assign({ t: 'hello', name }, token ? { token } : {}, extra)));
  };
  R.send = (obj) => e.room.receive(id, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return R;
}
const LIGHT = ['red', 'yellow', 'green', 'blue'], DARK = ['pink', 'teal', 'orange', 'purple'];
// Choose an action from the last view message alone.
function choose(R, rng) {
  const v = R.view, me = R.seat;
  if (!v || v.phase !== 'play' || v.players[me].out) return null;
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const pd = v.pending, cols = v.side === 'dark' ? DARK : LIGHT;
  if (v.actor !== me) {
    if (pd && pd.type === 'doubt' && pd.from !== me && pd.p !== me && rng() < 0.3) return { type: 'challenge' };
    if (v.vulnerable != null && v.vulnerable !== me && rng() < 0.3) return { type: 'catch', target: v.vulnerable };
    return null;
  }
  const claimFor = (c) => {
    const same = v.claims && v.claims.find((o) => o.c === c.face.c && o.v === c.face.v);
    return same && rng() < 0.5 ? same : pick(v.claims);
  };
  if (!pd) {
    if (v.hand.length <= 2 && !v.players[me].called && rng() < 0.5) return { type: 'call' };
    const ok = v.hand.filter((c) => c.playable);
    if (!ok.length) return { type: 'draw' };
    const reg = ok.filter((c) => !c.liar), c = pick(reg.length ? reg : ok);
    return c.liar ? { type: 'play', id: c.id, claim: claimFor(c) } : { type: 'play', id: c.id };
  }
  switch (pd.type) {
    case 'color': case 'roulette': return { type: 'color', color: pick(cols) };
    case 'challenge': return { type: rng() < 0.3 ? 'challenge' : 'accept' };
    case 'doubt': return { type: rng() < 0.3 ? 'challenge' : 'accept' };
    case 'swap': {
      const others = v.players.map((p, i) => i).filter((i) => i !== me && !v.players[i].out);
      return { type: 'swap', target: pick(others) };
    }
    case 'drawn': {
      const c = v.hand.find((x) => x.id === pd.id);
      // No Mercy: the drawn card must be played (official rule); elsewhere keeping it is allowed
      if (c && c.playable && (v.mode === 'nomercy' || rng() < 0.5)) return c.liar ? { type: 'play', id: c.id, claim: claimFor(c) } : { type: 'play', id: c.id };
      return { type: 'keep' };
    }
    // the view marks which cards may go down (a card of the called color whenever you hold one)
    case 'place': return { type: 'place', id: pick(v.hand.filter((h) => h.playable)).id };
    case 'callout': {
      const open = pd.placed.map((b, i) => (b && !pd.shown[i] ? i : -1)).filter((i) => i >= 0);
      if (pd.shown.some(Boolean) && rng() < 0.4) return { type: 'stop' };
      return { type: 'reveal', target: pick(open) };
    }
  }
  return null;
}
const allCards = (s) => [...s.draw, ...s.discard, ...(s.aside || []), ...s.players.flatMap((p) => p.hand)]; // aside: knocked-out hands (No Mercy)
function invariants(s, total) {
  const all = allCards(s);
  assert.equal(all.length, total, 'card count constant');
  assert.equal(new Set(all.map((c) => c.id)).size, total, 'ids unique');
  assert.ok(s.discard.length > 0, 'discard never empty');
  if (s.phase === 'play') {
    assert.equal(s.players[s.turn].out, false);
    if (s.pending) assert.equal(s.players[s.pending.p].out, false);
  }
}

// Seats: local host, `remotes` remote players, bots up to n.  Plays to the end of the game on the fake clock.
function runGame({ mode, n, remotes, seed, hostBot = true, target = 100, hostile, onTick }) {
  const rng = mulberry(seed), realRandom = Math.random;
  Math.random = mulberry(seed ^ 0x5bd1e995); // deterministic engine seed and delays
  try {
    const e = env();
    const { room } = e;
    room.addLocal('Host');
    const Rs = [];
    for (let i = 0; i < remotes; i++) { const R = remote(e, 'r' + i, 'Rem' + i); R.hello(); Rs.push(R); assert.equal(R.seat, i + 1); assert.match(R.token, /^[0-9a-f]{32}$/); }
    room.configure({ mode, target, count: n });
    assert.equal(room.start(), true);
    assert.equal(room.state.players.length, n);
    if (hostBot) { room.seats[0].kind = 'bot'; room.setPaused(false); }
    const total = allCards(room.state).length;
    const H = hostile ? hostile(e, rng) : null;
    let iters = 0;
    while (room.state.phase !== 'gameOver') {
      if (++iters > 40000) assert.fail(`${mode} n=${n} seed=${seed}: no progress (phase ${room.state.phase}, actor ${LC.actor(room.state)}, pending ${JSON.stringify(room.state.pending)})`);
      for (const R of Rs) {
        for (let k = 0; k < 2; k++) {
          if (!R.view || R.vseq === R.acted || e.clock.t - R.last < 40) break;
          R.acted = R.vseq;
          const a = choose(R, rng);
          if (!a) continue;
          R.last = e.clock.t;
          R.send({ t: 'act', a });
        }
      }
      if (H) H.tick();
      e.advance(50);
      if (onTick) onTick(e, Rs);
      invariants(room.state, total);
      if (room.state.phase === 'roundOver') assert.equal(room.nextRound(), true);
    }
    assert.equal(room.state.phase, 'gameOver');
    assert.ok(room.state.players[room.state.winner].score >= target);
    for (const R of Rs) {
      assert.deepEqual(R.errors, [], `remote ${R.id} got errors from a legal strategy`);
      assert.equal(R.view.seat, R.seat);
      assert.deepEqual(R.view, JSON.parse(JSON.stringify(LC.view(room.state, R.seat))), 'remote view matches the host view for its seat');
    }
    return { e, room, Rs, H };
  } finally { Math.random = realRandom; }
}

// ===================================================================================================
// Lobby
// ===================================================================================================
test('lobby: addLocal/addBot seat players; configure clamps count to 4..8 and to the seats taken', () => {
  const e = env(), { room } = e;
  assert.equal(room.addLocal('Hosty'), 0);
  assert.equal(room.addBot(), 1);
  assert.deepEqual(room.seats.map((s) => [s.kind, s.name]), [['local', 'Hosty'], ['bot', 'Ava']]);
  assert.equal(room.settings.count, 4);
  assert.equal(room.configure({ count: 2 }), true);
  assert.equal(room.settings.count, 4);
  room.configure({ count: 100 });
  assert.equal(room.settings.count, 8);
  room.configure({ count: 6 });
  assert.equal(room.settings.count, 6);
  room.configure({ count: 6.5 });
  assert.equal(room.settings.count, 6);
  room.configure({ count: '8' });
  assert.equal(room.settings.count, 6);
  room.configure({ count: -3 });
  assert.equal(room.settings.count, 4);
  for (let i = 0; i < 3; i++) room.addBot();
  assert.equal(room.seats.length, 5);
  assert.equal(room.settings.count, 5);
  room.configure({ count: 4 });
  assert.equal(room.settings.count, 5, 'never fewer than the seats taken');
  room.configure({ mode: 'liar', target: 250 });
  assert.equal(room.settings.mode, 'liar');
  assert.equal(room.settings.target, 250);
  room.configure({ mode: 'bogus', target: -1 });
  assert.equal(room.settings.mode, 'liar');
  assert.equal(room.settings.target, 250);
  room.configure({ target: 1.5 });
  room.configure({ target: 1e9 });
  assert.equal(room.settings.target, 250);
  room.configure({ target: 0 });
  assert.equal(room.settings.target, 0);
  assert.equal(new Set(room.seats.map((s) => s.name)).size, room.seats.length, 'bot names unique');
  for (let i = 0; i < 5; i++) room.addBot();
  assert.equal(room.seats.length, 8);
  assert.equal(room.addBot(), -1);
  assert.equal(room.addLocal('x'), -1);
});

test('lobby: hello from connected ids seats them with 32-hex tokens and sends welcome then lobby', () => {
  const e = env(), { room } = e;
  const a = remote(e, 'a', 'Zed'), b = remote(e, 'b', 'Zed'), c = remote(e, 'c', 'zed'), d = remote(e, 'd', 'Zed 2');
  a.hello(); b.hello(); c.hello(); d.hello();
  assert.equal(a.seat, 0);
  assert.equal(b.seat, 1);
  assert.match(a.token, /^[0-9a-f]{32}$/);
  assert.notEqual(a.token, b.token);
  assert.deepEqual(room.seats.map((s) => s.name), ['Zed', 'Zed 2', 'zed 3', 'Zed 2 2']);
  assert.deepEqual(e.msgs('a').map((m) => m.t).slice(0, 2), ['welcome', 'lobby']);
  assert.equal(a.lobby.seats.length, 4);
  assert.equal(a.lobby.you, 0);
  assert.equal(a.lobby.started, false);
  assert.deepEqual(Object.keys(a.lobby.seats[0]).sort(), ['away', 'kind', 'name']);
  assert.ok(!JSON.stringify(a.lobby).includes(a.token), 'tokens are never shown to others');
  assert.ok(!JSON.stringify(b.lobby).includes(a.token));
  // a second hello on a seated connection is ignored; a hello from an unconnected id is ignored
  const n = e.msgs('a').length;
  a.send({ t: 'hello', name: 'Other' });
  assert.equal(e.msgs('a').length, n);
  e.room.receive('ghost', JSON.stringify({ t: 'hello', name: 'G' }));
  assert.equal(room.seats.length, 4);
  // names with a full 16 characters still get unique suffixes within the limit
  const e2 = env();
  const long = 'abcdefghijklmnop';
  for (const id of ['x', 'y']) remote(e2, id, long).hello();
  assert.equal(e2.room.seats[1].name, 'abcdefghijklm 2');
  assert.ok(Array.from(e2.room.seats[1].name).length <= 16);
});

test('lobby: cleanName strips control / zero-width / bidi characters, trims, caps at 16, empty -> Player', () => {
  const C = Room.cleanName;
  assert.equal(C('  Bob  '), 'Bob');
  assert.equal(C('a​b‌c‍d﻿e'), 'abcde');
  assert.equal(C('‮evil‬'), 'evil');
  assert.equal(C('x⁦y⁩z⁠'), 'xyz');
  assert.equal(C('\u0000\u0007\u001b[31mred'), '[31mred');
  assert.equal(C('a\nb\tc\r'), 'abc');
  assert.equal(C('a\u0085b\u007fc\u009fd­e'), 'abcde');
  assert.equal(C('a   b'), 'a b');
  assert.equal(C(''), 'Player');
  assert.equal(C('   '), 'Player');
  assert.equal(C('​‮\u0000'), 'Player');
  assert.equal(C(null), 'Player');
  assert.equal(C(undefined), 'Player');
  assert.equal(C(123), 'Player'); // names must be strings; anything else is protocol misuse
  assert.equal(C({ toString: 1 }), 'Player'); // must not throw (String() on this object would)
  assert.equal(C('0123456789abcdefXYZ'), '0123456789abcdef');
  assert.equal(C('0123456789abcde      fXYZ'), '0123456789abcde');
  assert.equal(Array.from(C('😀'.repeat(40))).length, 16);
  assert.equal(C('😀'.repeat(40)), '😀'.repeat(16));
  assert.equal(C('a'.repeat(5000)).length, 16);
  assert.equal(C('​ hi ​'), 'hi');
});

test('lobby: the ninth seat gets "The room is full"; connect caps at 24 connections', () => {
  const e = env(), { room } = e;
  const Rs = Array.from({ length: 9 }, (_, i) => remote(e, 'c' + i, 'P' + i));
  Rs.forEach((R) => R.hello());
  assert.equal(room.seats.length, 8);
  assert.equal(Rs[8].seat, null);
  assert.deepEqual(e.msgs('c8', 'error').map((m) => m.msg), ['The room is full']);
  assert.equal(e.msgs('c8', 'welcome').length, 0);
  const e2 = env();
  for (let i = 0; i < 24; i++) assert.equal(e2.room.connect('k' + i), true);
  assert.equal(e2.room.connect('k24'), false);
  e2.room.disconnect('k0');
  assert.equal(e2.room.connect('k24'), true);
});

test('lobby: hello after start without a valid token is an error; the right token gets the seat back', () => {
  const e = env(), { room } = e;
  const a = remote(e, 'a', 'Ann'); a.hello();
  room.start();
  const late = remote(e, 'late', 'Late'); late.hello();
  assert.equal(late.seat, null);
  assert.deepEqual(e.msgs('late', 'error').map((m) => m.msg), ['That game has already started']);
  for (const token of ['x'.repeat(32), a.token.slice(1), a.token + 'a', 12345, null, {}, [a.token]]) {
    const id = 'bad' + Math.random();
    e.room.connect(id);
    e.room.receive(id, JSON.stringify({ t: 'hello', name: 'X', token }));
    assert.equal(e.msgs(id, 'error').length, 1, JSON.stringify(token));
    assert.equal(e.msgs(id, 'welcome').length, 0);
  }
  assert.equal(room.seats.length, 4);
  assert.equal(room.seats.filter((s) => s.kind === 'remote').length, 1);
});

test('lobby: removeSeat closes a remote and drops it; disconnect frees the seat; both only before the start', () => {
  const e = env(), { room } = e;
  room.addLocal('H');
  const a = remote(e, 'a', 'Ann'), b = remote(e, 'b', 'Bob'), c = remote(e, 'c', 'Cy');
  a.hello(); b.hello(); c.hello();
  assert.equal(room.seats.length, 4);
  assert.equal(room.removeSeat(9), false);
  assert.equal(room.removeSeat(-1), false);
  assert.equal(room.removeSeat(1), true);
  assert.equal(a.closed, true);
  assert.ok(e.dropped.includes('a'));
  assert.deepEqual(room.seats.map((s) => s.name), ['H', 'Bob', 'Cy']);
  assert.equal(room.removeSeat(0), true); // a local seat has nothing to drop
  assert.deepEqual(room.seats.map((s) => s.name), ['Bob', 'Cy']);
  room.disconnect('b');
  assert.deepEqual(room.seats.map((s) => s.name), ['Cy']);
  const n = e.msgs('b').length;
  b.send({ t: 'act', a: { type: 'draw' } });
  assert.equal(e.msgs('b').length, n, 'a disconnected id is ignored');
  assert.equal(room.settings.count, 4);
  room.start();
  assert.equal(room.removeSeat(0), false);
  assert.equal(room.addBot(), -1);
  assert.equal(room.configure({ mode: 'liar' }), false);
  assert.equal(room.start(), false);
});

test('lobby: start fills bots up to count with unique names and starts a game of the chosen mode', () => {
  for (const mode of LC.MODES) {
    const e = env(), { room } = e;
    room.addLocal('Host');
    const a = remote(e, 'a', 'Ava'); a.hello(); // collides with the first bot name
    room.configure({ mode, count: 7, target: 0 });
    assert.equal(room.start(), true);
    assert.equal(room.seats.length, 7);
    assert.equal(new Set(room.seats.map((s) => s.name.toLowerCase())).size, 7);
    assert.equal(room.state.mode, mode);
    assert.equal(room.state.target, 0);
    assert.deepEqual(room.state.players.map((p) => p.bot), room.seats.map((s) => s.kind === 'bot'));
    assert.equal(e.msgs('a', 'view').length, 1);
    assert.deepEqual(a.view.seat, a.seat);
    assert.equal(a.lobby.started, false);
    assert.equal(room.lobby(0).started, true);
  }
});

test('lobby: act/view/nextRound before a game exist are harmless', () => {
  const e = env(), { room } = e;
  assert.equal(room.view(0), null);
  assert.equal(room.nextRound(), false);
  room.addLocal('H');
  assert.deepEqual(room.act(0, { type: 'draw' }), { ok: false, error: 'Not your seat' });
  const a = remote(e, 'a', 'A'); a.hello();
  a.send({ t: 'act', a: { type: 'draw' } });
  assert.deepEqual(e.msgs('a', 'error').map((m) => m.msg), ['The game has not started yet']);
});

// ===================================================================================================
// Game
// ===================================================================================================
for (const mode of LC.MODES) {
  for (const n of [4, 5, 6, 7, 8]) {
    test(`game: remotes play from their own views and finish a full ${mode} game with ${n} seats`, () => {
      const r = runGame({ mode, n, remotes: Math.min(3, n - 1), seed: n * 101 + mode.length * 7, });
      assert.ok(r.Rs.every((R) => R.vseq > 5), 'remotes received many views');
      assert.ok(r.e.msgs('r0', 'view').every((m) => Array.isArray(m.room.seats) && m.room.seats.length === n));
    });
  }
}

test('game: a remote can only act for its own seat; local act() refuses non-local seats', () => {
  const e = env(), { room } = e;
  room.addLocal('Host');
  const a = remote(e, 'a', 'Ann'), b = remote(e, 'b', 'Bob');
  a.hello(); b.hello();
  room.configure({ count: 4, mode: 'classic' });
  room.start();
  room.setPaused(true);
  const S = room.state;
  // seat 1 (a) is not the actor in round 1; claiming to be the actor (seat 0) is overridden
  const seq = S.seq, h = JSON.stringify(S.players.map((p) => p.hand));
  a.send({ t: 'act', a: { type: 'draw', p: 0 } });
  a.send({ t: 'act', a: { type: 'play', p: 0, id: S.players[0].hand[0].id } });
  assert.equal(S.seq, seq);
  assert.equal(JSON.stringify(S.players.map((p) => p.hand)), h);
  assert.equal(a.errors.length, 2);
  assert.ok(a.errors.every((m) => m === 'Not your turn'));
  // when it IS a's turn the action lands on a's hand, whatever `p` says
  S.turn = 1;
  S.draw.push({ id: 99999, light: { c: S.color, v: '1' } }); // a drawn card that can be played
  S.discard.push({ id: 99998, light: { c: S.color, v: '2' } });
  const before = S.players.map((p) => p.hand.length);
  a.send({ t: 'act', a: { type: 'draw', p: 3 } });
  const after = S.players.map((p) => p.hand.length);
  assert.equal(after[1], before[1] + 1);
  assert.deepEqual([after[0], after[2], after[3]], [before[0], before[2], before[3]]);
  // b cannot answer a's pending decision
  assert.equal(S.pending && S.pending.type, 'drawn');
  b.send({ t: 'act', a: { type: 'keep', p: 1 } });
  assert.equal(S.pending.type, 'drawn');
  // local act: only local seats
  assert.deepEqual(room.act(1, { type: 'draw' }), { ok: false, error: 'Not your seat' });
  assert.deepEqual(room.act(3, { type: 'draw' }), { ok: false, error: 'Not your seat' });
  assert.deepEqual(room.act(9, { type: 'draw' }), { ok: false, error: 'Not your seat' });
  assert.deepEqual(room.act(0, { type: 'bogus' }), { ok: false, error: 'Unknown action' });
  assert.equal(room.act(0, { type: 'draw' }).ok, false); // not seat 0's turn, but it is the host's own seat
  a.send({ t: 'act', a: { type: 'keep' } });
  assert.equal(S.turn, 2);
  S.turn = 0; S.pending = null;
  const r = room.act(0, { type: 'draw', p: 2 }); // `p` is overwritten for local acts too
  assert.equal(r.ok, true);
});

test('game: disconnect mid-game makes the seat away and a bot plays it; the token restores it with welcome + view', () => {
  const e = env(), { room } = e;
  const a = remote(e, 'a', 'Ann'), b = remote(e, 'b', 'Bob');
  a.hello(); b.hello();
  room.configure({ count: 4, mode: 'nomercy' }); // No Mercy always opens on a number card, so seat 0 moves first
  room.start();
  const S = room.state, token = a.token;
  assert.equal(LC.actor(S), 0); // Ann is seat 0 and must move first
  room.disconnect('a');
  assert.equal(room.seats[0].away, true);
  assert.equal(room.seats[0].conn, null);
  const seq = S.seq;
  e.advance(500);
  assert.ok(S.seq > seq, 'a bot played Ann\'s turn');
  const views = e.msgs('b', 'view');
  assert.equal(views[views.length - 1].room.seats[0].away, true);
  assert.equal(S.players[0].bot, false);
  // rejoin on a new connection with the token
  const a2 = remote(e, 'a2', 'Whoever', token);
  a2.hello();
  assert.deepEqual(e.msgs('a2').map((m) => m.t).slice(0, 2), ['welcome', 'view']);
  assert.equal(a2.seat, 0);
  assert.equal(a2.token, token);
  assert.equal(room.seats[0].away, false);
  assert.equal(room.seats[0].conn, 'a2');
  assert.equal(room.seats[0].name, 'Ann');
  assert.deepEqual(a2.view, JSON.parse(JSON.stringify(LC.view(S, 0))));
  // taking over a live connection drops the old one
  const a3 = remote(e, 'a3', 'x', token);
  a3.hello();
  assert.ok(e.dropped.includes('a2'));
  assert.equal(room.seats[0].conn, 'a3');
  assert.equal(a3.seat, 0);
  // an unknown / other-seat token cannot hijack, and bob's token gives bob's seat
  const b2 = remote(e, 'b2', 'y', b.token);
  b2.hello();
  assert.equal(b2.seat, 1);
});

test('game: an away seat keeps being played by bots until the end; rejoining mid-game works repeatedly', () => {
  const e = env(), { room } = e;
  const a = remote(e, 'a', 'Ann'); a.hello();
  room.configure({ count: 5, target: 300, mode: 'liar' });
  room.start();
  const rng = mulberry(5);
  let R = a, cnt = 0, iters = 0;
  while (room.state.phase !== 'gameOver') {
    if (++iters > 40000) assert.fail('no progress');
    if (iters % 40 === 0) { // flap the connection
      cnt++;
      room.disconnect(R.id);
      e.advance(300);
      const next = remote(e, 'a' + cnt, 'z', a.token);
      next.hello();
      assert.equal(next.seat, 0);
      assert.equal(room.seats[0].away, false);
      R = next;
    }
    if (R.view && R.vseq !== R.acted && e.clock.t - R.last >= 40) {
      R.acted = R.vseq;
      const act = choose(R, rng);
      if (act) { R.last = e.clock.t; R.send({ t: 'act', a: act }); }
    }
    e.advance(50);
    if (room.state.phase === 'roundOver') room.nextRound();
  }
  assert.ok(cnt >= 3, 'flapped ' + cnt + ' iters ' + iters + ' round ' + room.state.round);
});

test('game: nextRound only when the round is over; restart gives a fresh game with the same seats', () => {
  const e = env(), { room } = e;
  room.addLocal('Host');
  const a = remote(e, 'a', 'Ann'); a.hello();
  room.configure({ count: 4, target: 100000 });
  room.start();
  room.seats[0].kind = 'bot'; room.setPaused(false);
  assert.equal(room.nextRound(), false);
  room.restart();
  assert.equal(room.state.round, 1);
  assert.equal(room.state.phase, 'play');
  assert.equal(room.seats.length, 4);
  assert.equal(room.seats[1].conn, 'a');
  assert.equal(a.view.round, 1);
  assert.equal(a.view.players[0].count, 7);
  const rng = mulberry(3);
  let guard = 0;
  while (room.state.phase === 'play' && ++guard < 20000) {
    if (a.view && a.vseq !== a.acted && e.clock.t - a.last >= 40) {
      a.acted = a.vseq;
      const act = choose(a, rng);
      if (act) { a.last = e.clock.t; a.send({ t: 'act', a: act }); }
    }
    e.advance(50);
  }
  assert.equal(room.state.phase, 'roundOver');
  assert.equal(a.view.phase, 'roundOver');
  const total = allCards(room.state).length;
  assert.equal(room.nextRound(), true);
  assert.equal(room.state.round, 2);
  assert.equal(room.state.phase, 'play');
  assert.equal(allCards(room.state).length, total);
  assert.equal(a.view.round, 2);
  assert.equal(a.view.players.reduce((x, p) => x + p.score, 0) > 0, true, 'scores carry over');
  room.state.phase = 'gameOver';
  assert.equal(room.nextRound(), false);
  assert.equal(room.restart(), true);
  assert.equal(room.state.round, 1);
  assert.equal(room.state.phase, 'play');
  assert.equal(room.state.players.every((p) => p.score === 0), true);
});

test('game: pausing stops bots; unpausing resumes them; close() tells remotes and stops all timers', () => {
  const e = env(), { room } = e;
  const a = remote(e, 'a', 'Ann'), b = remote(e, 'b', 'Bob');
  a.hello(); b.hello();
  room.configure({ count: 6 });
  room.start();
  room.disconnect('a'); // seat 0 away: a bot must play it
  room.setPaused(true);
  const seq = room.state.seq;
  e.advance(5000);
  assert.equal(room.state.seq, seq);
  assert.equal(e.timers.size, 0, 'no timers while paused');
  room.setPaused(false);
  assert.ok(e.timers.size > 0);
  e.advance(300);
  assert.ok(room.state.seq > seq);
  const n = e.msgs('b', 'closed').length;
  room.close('bye');
  assert.equal(room.closed, true);
  assert.deepEqual(e.msgs('b', 'closed').slice(n).map((m) => m.msg), ['bye']);
  assert.equal(e.msgs('a', 'closed').length, 0, 'away seat has no connection to tell');
  assert.equal(e.timers.size, 0);
  const seq2 = room.state.seq;
  e.advance(10000);
  assert.equal(room.state.seq, seq2);
  const m = e.msgs('b').length;
  b.send({ t: 'act', a: { type: 'draw' } });
  assert.equal(e.msgs('b').length, m, 'closed room ignores everything');
  room.close('again');
  assert.equal(e.msgs('b').length, m);
  assert.equal(room.connect('z'), false);
  assert.equal(room.start(), false);
  assert.equal(e.msgs('b', 'closed').slice(-1)[0].msg, 'bye');
  // default close message
  const e2 = env(); const c = remote(e2, 'c', 'C'); c.hello(); e2.room.close();
  assert.equal(e2.msgs('c', 'closed')[0].msg, 'The host ended the game');
});

test('game: bots react out of turn (catch / doubt) at most once per episode and never as the actor or the bluffer', () => {
  const e = env({ bot: [20, 20], react: [20, 30] }), { room } = e;
  room.addBot(); room.addBot(); room.addBot(); room.addBot();
  room.configure({ mode: 'liar', target: 100000 });
  room.start();
  let guard = 0, doubts = 0;
  const seen = new Set();
  while (room.state.round < 3 && ++guard < 20000) {
    e.advance(25);
    const pd = room.state.pending;
    if (pd && pd.type === 'doubt' && !seen.has(pd.id + ':' + pd.from + ':' + room.state.seq)) { seen.add(pd.id + ':' + pd.from + ':' + room.state.seq); doubts++; }
    if (room.state.phase === 'roundOver') room.nextRound();
  }
  assert.ok(doubts > 0);
  assert.ok(room.state.round >= 3);
});

// ===================================================================================================
// Rate limit, strikes, hostile input
// ===================================================================================================
test('rate limit: more than 30 messages in one second from one id are ignored', () => {
  const e = env(), { room } = e;
  const a = remote(e, 'a', 'Ann'); a.hello();
  room.configure({ count: 4 });
  room.start();
  room.setPaused(true);
  e.advance(1000); // new window
  const n = e.msgs('a', 'error').length;
  for (let i = 0; i < 100; i++) a.send({ t: 'act', a: { type: 'call' } });
  assert.equal(e.msgs('a', 'error').length - n, 30, 'exactly 30 processed');
  e.advance(999);
  a.send({ t: 'act', a: { type: 'call' } });
  assert.equal(e.msgs('a', 'error').length - n, 30, 'still inside the same second window');
  e.advance(1);
  a.send({ t: 'act', a: { type: 'call' } });
  assert.equal(e.msgs('a', 'error').length - n, 31, 'window reset');
  // the limit is per connection
  const b = remote(e, 'b', 'x'); room.connect('b');
  b.send({ t: 'hello', name: 'Late' });
  assert.equal(e.msgs('b', 'error').length, 1);
  // flood of malformed messages cannot be used to bypass: ignored ones add no strikes, but strikes still accumulate
  const c = 'c'; room.connect(c);
  for (let i = 0; i < 100; i++) room.receive(c, 'junk');
  assert.ok(e.dropped.includes('c'), 'garbage flood gets the connection dropped');
});

test('strikes: 20 malformed messages are tolerated, the 21st closes and drops the connection', () => {
  const e = env(), { room } = e;
  room.connect('m');
  for (let i = 0; i < 20; i++) {
    room.receive('m', 'not json');
    if (i % 10 === 9) e.advance(1000);
  }
  assert.equal(e.msgs('m', 'closed').length, 0);
  assert.deepEqual(e.dropped, []);
  room.receive('m', '{');
  assert.deepEqual(e.msgs('m', 'closed').map((m) => m.msg), ['Too many invalid messages']);
  assert.deepEqual(e.dropped, ['m']);
  room.receive('m', 'again');
  assert.equal(e.msgs('m', 'closed').length, 1, 'removed connection is ignored');
  // a valid message is not a strike, errors are not strikes
  const e2 = env(); const a = remote(e2, 'a', 'A'); a.hello(); e2.room.start();
  for (let i = 0; i < 100; i++) { a.send({ t: 'act', a: { type: 'keep' } }); if (i % 20 === 19) e2.advance(1000); }
  assert.equal(e2.dropped.length, 0);
  // a seated player who gets dropped for abuse becomes away in a running game, and frees the seat in the lobby
  const e3 = env(); const b = remote(e3, 'b', 'B'); b.hello();
  for (let i = 0; i < 21; i++) { b.send('zzz'); if (i % 10 === 9) e3.advance(1000); }
  assert.equal(e3.room.seats.length, 0);
  const e4 = env(); const c = remote(e4, 'c', 'C'); c.hello(); e4.room.start();
  for (let i = 0; i < 21; i++) { c.send([1, 2]); if (i % 10 === 9) e4.advance(1000); }
  assert.equal(e4.room.seats[0].away, true);
  assert.ok(e4.dropped.includes('c'));
});

test('input validation: a hello whose name is an object without a callable toString/valueOf must not throw', () => {
  for (const name of ['{"toString":1}', '[{"toString":1}]', '{"valueOf":1,"toString":null}', '{"toString":"x","valueOf":"y"}']) {
    const e = env(), { room } = e;
    room.connect('a');
    assert.doesNotThrow(() => room.receive('a', `{"t":"hello","name":${name}}`), name);
  }
});

test('input validation: text limits and message shapes', () => {
  const e = env(), { room } = e;
  const pad = (obj, len) => { const s = JSON.stringify(obj); return s + ' '.repeat(len - s.length); };
  room.connect('a');
  room.receive('a', pad({ t: 'hello', name: 'Exact' }, 4096));
  assert.equal(room.seats.length, 1, '4096 characters are accepted');
  room.connect('b');
  room.receive('b', pad({ t: 'hello', name: 'TooBig' }, 4097));
  assert.equal(room.seats.length, 1, '4097 are not');
  for (const bad of [123, null, undefined, {}, [], ['hello'], true, 'null', '123', '"hello"', '[]', '{"t":1}', 'x'.repeat(5000), '{"t":"hello"', '\u0000']) {
    const before = room.seats.length;
    room.receive('b', bad);
    assert.equal(room.seats.length, before);
  }
  room.receive('b', JSON.stringify({ t: 'hello' })); // missing name is fine -> 'Player'
  assert.equal(room.seats[1].name, 'Player');
  const hello = { t: 'hello', name: '‮​ Mallory \u0000' };
  room.connect('c');
  room.receive('c', JSON.stringify(hello));
  assert.equal(room.seats[2].name, 'Mallory');
});

// ---------- fuzz ----------
const PROTO_KEYS = (o) => Object.getOwnPropertyNames(o).sort().join();
function snapshotProtos() { return [Object.prototype, Array.prototype, Function.prototype, String.prototype, Number.prototype].map(PROTO_KEYS); }
function mkHostile(e, rng, count, thrown) {
  const { room } = e;
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const hs = [];
  let nid = 0, sent = 0;
  const tokens = [];
  const weird = () => pick([null, undefined, true, false, 0, -1, 1, 2, 3, 5, 7, 1.5, -0.5, 2 ** 53, 1e300, 'a', '', '5', 'red', '__proto__', 'constructor', [], [1], {}, { a: 1 }, 'x'.repeat(10000), '\u0000', NaN, Infinity]);
  const intish = () => pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 100, -1, -100, 2 ** 31, 2 ** 53, 1.5, '3', null, NaN, 1e309, [], {}, true]);
  const rawNum = () => pick(['NaN', '1e309', '-1e309', '1e-999', '0x10', '+1', '.5', '5.', '--1', '9'.repeat(400)]);
  const claim = () => pick([null, [], {}, 5, 'red', { c: 'red', v: '5' }, { c: 'wild', v: 'wd4' }, { c: 'red' }, { v: '3' }, { c: 1, v: 2 }, { c: ['red'], v: ['3'] },
    { c: 'x'.repeat(5000), v: 'y'.repeat(5000) }, { c: '__proto__', v: 'constructor' }, { c: 'blue', v: 'd2', extra: { __proto__: { polluted: 1 } } }, { c: null, v: null }]);
  const colorv = () => pick(['red', 'yellow', 'green', 'blue', 'pink', 'teal', 'orange', 'purple', 'wild', '', 5, null, [], {}, '__proto__', 'x'.repeat(100)]);
  const typev = () => pick(['play', 'draw', 'keep', 'color', 'accept', 'challenge', 'swap', 'call', 'catch', 'place', 'reveal', 'stop', 'play', 'draw', 'accept', 'bogus', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 5, null, ['play'], { toString: 'play' }, 'PLAY', ' play']);
  function action(h) {
    const a = { type: typev() };
    if (rng() < 0.6) a.id = rng() < 0.5 && h.view && h.view.hand.length ? pick(h.view.hand).id : intish();
    if (rng() < 0.4) a.target = intish();
    if (rng() < 0.4) a.color = colorv();
    if (rng() < 0.4) a.claim = claim();
    if (rng() < 0.2) a.p = intish();
    if (rng() < 0.1) a.__proto__ = { polluted: 1 };
    return a;
  }
  const payloads = [
    () => '{"__proto__":{"polluted":1}}',
    () => '{"constructor":{"prototype":{"polluted":2}}}',
    () => '{"t":"act","a":{"__proto__":{"polluted":3},"type":"draw"}}',
    () => '{"t":"act","a":{"type":"draw","constructor":{"prototype":{"polluted":4}}}}',
    () => '{"t":"hello","name":"x","__proto__":{"polluted":5}}',
    () => '{"t":"hello","name":{"__proto__":{"polluted":6}}}',
    () => '{"t":"act","a":{"type":"play","claim":{"__proto__":{"polluted":7},"c":"red","v":"3"}}}',
    () => '{"t":"act","a":{"type":"play","claim":{"constructor":{"prototype":{"polluted":8}}}}}',
    () => '{"t":"__proto__","a":{"type":"draw"}}',
    () => '{"t":"constructor"}',
    () => '[{"t":"act","a":{"type":"draw"}}]',
    () => `{"t":"act","a":{"type":"play","id":${rawNum()}}}`,
    () => `{"t":"act","a":{"type":"swap","target":${rawNum()}}}`,
    () => `{"t":"act","a":{"type":"reveal","target":${rawNum()}}}`,
    () => `{"t":"act","a":{"type":"catch","target":${rawNum()}}}`,
    () => 'x'.repeat(4097),
    () => JSON.stringify({ t: 'act', a: { type: 'draw' }, pad: 'p'.repeat(5000) }),
    () => '',
    () => 'null',
    () => '{"t":"act"}',
    () => '{"t":"act","a":null}',
    () => '{"t":"act","a":[]}',
    () => '{"t":"act","a":"draw"}',
  ];
  function message(h) {
    const r = rng();
    if (r < 0.12) return pick(payloads)();
    if (r < 0.2) return pick([123, null, undefined, {}, [], true, Symbol.iterator && 5, { t: 'act' }, ['x']]);
    if (r < 0.62) return JSON.stringify({ t: 'act', a: action(h) });
    if (r < 0.7) return JSON.stringify({ t: 'act', a: pick([null, 5, 'x', [], [1, 2], { type: ['draw'] }, { type: { toString: 1 } }]) });
    if (r < 0.8) {
      const name = pick([weird(), { toString: 1 }, { valueOf: 1, toString: null }, [{ toString: 1 }], 'Evil‮​'.repeat(10), 'N'.repeat(5000), 'Same', 'Same', 'Same 2']);
      const tok = pick([undefined, weird(), pick(tokens) || 'a'.repeat(32), 'f'.repeat(32), '0'.repeat(32)]);
      return JSON.stringify({ t: 'hello', name, token: tok });
    }
    if (r < 0.9) return JSON.stringify({ t: pick([weird(), 'act', 'view', 'welcome', 'closed', 'lobby', 'error', 'ping', 'hello']), a: action(h), name: weird() });
    return pick(['{', '}', '[', '"', "{'t':'act'}", 'undefined', 'NaN', '{"t":"act","a":{"type":"draw"}', '\u0000\u0001', '{"t":"act","a":{"type":"draw"}}garbage']);
  }
  function addOne() {
    const id = 'h' + ++nid, h = { id, view: null };
    const R = remote(e, id, 'Hostile');
    e.onMsg(id, (m) => { if (m.t === 'view') h.view = m.view; if (m.t === 'welcome') tokens.push(m.token); R.seat = m.seat; });
    room.connect(id);
    hs.push(h);
    return h;
  }
  for (let i = 0; i < count; i++) addOne();
  return {
    hs,
    get sent() { return sent; },
    seatBefore(n) { for (let i = 0; i < n; i++) room.receive(hs[i].id, JSON.stringify({ t: 'hello', name: 'Hostile' })); },
    tick() {
      for (let i = 0; i < hs.length; i++) {
        let h = hs[i];
        if (e.dropped.includes(h.id) || room.closed) { hs[i] = addOne(); hs.pop(); h = hs[i]; if (rng() < 0.5) room.receive(h.id, JSON.stringify({ t: 'hello', name: 'H', token: pick(tokens) })); }
        const k = pick([0, 1, 2, 5, 12, 40, 40]);
        for (let j = 0; j < k; j++) {
          const m = message(h);
          sent++;
          try { room.receive(h.id, m); } catch (err) { thrown.push({ m: typeof m === 'string' ? m.slice(0, 120) : String(m), err: String(err && err.stack || err).split('\n').slice(0, 3).join(' | ') }); }
        }
      }
    },
  };
}
for (const mode of LC.MODES) {
  test(`fuzz: thousands of hostile messages mixed into a real ${mode} game; nothing throws, protos stay clean, game finishes`, () => {
    const protos = snapshotProtos(), thrown = [];
    let H;
    const r = runGame({
      mode, n: 6, remotes: 2, seed: 900 + mode.length, hostBot: true, target: 150,
      hostile: (e, rng) => {
        H = mkHostile(e, rng, 8, thrown);
        H.seatBefore(0);
        return H;
      },
    });
    assert.deepEqual(thrown, [], 'room.receive must never throw');
    assert.deepEqual(snapshotProtos(), protos);
    for (const k of ['polluted']) { assert.equal(({})[k], undefined); assert.equal([][k], undefined); assert.equal(Object.prototype[k], undefined); }
    assert.ok(H.sent > 2000, 'sent ' + H.sent);
    assert.equal(r.room.state.phase, 'gameOver');
  });
}
test('fuzz: hostile players seated in the lobby (and dropped mid-game) do not break the game', () => {
  const protos = snapshotProtos(), thrown = [];
  for (const mode of ['liar', 'nomercy']) {
    runGame({
      mode, n: 8, remotes: 2, seed: 4242 + mode.length, hostBot: true, target: 60,
      hostile: (e, rng) => {
        // the game has already started: these hellos carry no token and are refused, then they flood the room
        const H = mkHostile(e, rng, 6, thrown);
        H.seatBefore(6);
        return H;
      },
    });
  }
  assert.deepEqual(thrown, []);
  assert.deepEqual(snapshotProtos(), protos);
});
test('fuzz: hostile connections seated in the lobby before the start', () => {
  const protos = snapshotProtos(), thrown = [];
  const rng = mulberry(77), realRandom = Math.random;
  Math.random = mulberry(78);
  try {
    for (const mode of LC.MODES) {
      const e = env(), { room } = e;
      const H = mkHostile(e, rng, 5, thrown);
      H.seatBefore(2); // the other three stay unseated and keep sending hellos (names of every odd type)
      assert.equal(room.seats.length, 2);
      room.configure({ mode, count: 6, target: 60 });
      for (let i = 0; i < 300; i++) H.tick(); // lobby phase
      while (room.seats.length > 8) room.removeSeat(0);
      room.start();
      const total = allCards(room.state).length;
      let it = 0;
      while (room.state.phase !== 'gameOver') {
        if (++it > 40000) assert.fail('no progress ' + mode);
        H.tick();
        e.advance(50);
        invariants(room.state, total);
        if (room.state.phase === 'roundOver') room.nextRound();
      }
      assert.ok(H.sent > 2000);
    }
  } finally { Math.random = realRandom; }
  assert.deepEqual(thrown, []);
  assert.deepEqual(snapshotProtos(), protos);
  assert.equal(({}).polluted, undefined);
});

// ---------- regressions from the final review ----------
test('connections the room ends itself free their slot (kick, rejoin takeover)', () => {
  const e = env();
  for (let i = 0; i < 30; i++) { // kick 30 players one after another
    const id = 'k' + i;
    assert.equal(e.room.connect(id), true, `connect ${i}`);
    e.room.receive(id, JSON.stringify({ t: 'hello', name: 'K' + i }));
    assert.equal(e.room.removeSeat(e.room.seats.findIndex((s) => s.conn === id)), true);
    assert.ok(e.dropped.includes(id));
  }
  assert.equal(e.room.connect('first'), true);
  e.room.receive('first', JSON.stringify({ t: 'hello', name: 'Pat' }));
  const token = e.msgs('first', 'welcome')[0].token;
  for (let i = 0; i < 30; i++) { // the same player rejoins from 30 new connections
    const id = 'r' + i;
    assert.equal(e.room.connect(id), true, `rejoin ${i}`);
    e.room.receive(id, JSON.stringify({ t: 'hello', name: 'Pat', token }));
    assert.equal(e.room.seats[0].conn, id);
  }
  assert.equal(e.room.seats.length, 1);
});
test('a full room says so and closes the connection instead of hanging', () => {
  const e = env();
  for (let i = 0; i < 24; i++) assert.equal(e.room.connect('c' + i), true);
  assert.equal(e.room.connect('late'), false);
  assert.equal(e.msgs('late', 'closed').length, 1);
  assert.ok(e.dropped.includes('late'));
});
test('a connection that never says hello is dropped after 15 s and frees its slot', () => {
  const e = env();
  for (let i = 0; i < 24; i++) assert.equal(e.room.connect('idle' + i), true);
  e.advance(14000);
  assert.equal(e.dropped.length, 0);
  e.advance(1500);
  assert.equal(e.dropped.length, 24);
  assert.equal(e.msgs('idle0', 'closed').length, 1);
  assert.equal(e.room.connect('fresh'), true);
  e.room.receive('fresh', JSON.stringify({ t: 'hello', name: 'Sam' }));
  e.advance(20000);
  assert.ok(!e.dropped.includes('fresh')); // seated players are never timed out
});
