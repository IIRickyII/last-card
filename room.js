/*
 * Last Card — game room. Runs one game on the host device (the only place the full game state lives), drives bots
 * and their timing, and talks to remote players through a send(connId, text) hook. No DOM and no network code:
 * net.js carries the text, ui.js renders view(seat). Runs in Node for tests.
 *
 * const room = LastCardRoom.create({ onUpdate, send, drop, timers, delays, now })
 *   onUpdate()               something changed: re-render the local screen
 *   send(connId, text)       deliver a JSON string to a remote player;  drop(connId): close that connection
 *   timers {set(fn, ms) -> id, clear(id)}, delays {bot:[min,max], react:[min,max]} ms, now() -> ms (tests inject)
 *
 * Lobby: room.settings {mode, target, count}; room.seats [{kind:'local'|'remote'|'bot', name, away}]
 *   configure({mode, target, count}), addLocal(name) -> seat, addBot(), removeSeat(i), start(), restart()
 *   connect(connId) / disconnect(connId)  from the transport; receive(connId, text) for every remote message
 * Game: act(seat, action) for local seats, view(seat), lobby(seat), nextRound(), setPaused(bool), close(msg)
 *
 * Protocol (JSON text, at most 4 KB from players):
 *   player -> host  {t:'hello', name, token?}  |  {t:'act', a:{type, id?, color?, target?, claim?:{c, v}}}
 *   host -> player  {t:'welcome', seat, token} | {t:'lobby', lobby} | {t:'view', view, room} | {t:'error', msg}
 *                   | {t:'closed', msg}
 * A remote player can only ever act for their own seat; the engine then checks every rule.
 */
(function (root) {
  'use strict';
  const LC = typeof module === 'object' && module.exports ? require('./engine.js') : root.LastCard;
  const MAX_TEXT = 4096, MAX_NAME = 16, MAX_SEATS = 8, MAX_CONNS = 24;
  const RATE = 30, STRIKES = 20; // messages per second; malformed messages before the connection is dropped
  const HELLO_WAIT = 15000; // ms a new connection gets to say hello
  const ACTS = new Set(['play', 'draw', 'keep', 'color', 'accept', 'challenge', 'swap', 'call', 'catch', 'place', 'reveal', 'stop']);
  const BOT_NAMES = ['Ava', 'Ben', 'Cleo', 'Dax', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo'];

  // Printable, trimmed, at most 16 characters (no control, zero-width or direction-override characters).
  function cleanName(n) {
    const s = (typeof n === 'string' ? n : '') // never String(obj): {"toString":1} from the network would throw
      .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
      .replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, MAX_NAME).join('').trim() || 'Player';
  }
  // Copy only known fields with the right primitive types; the engine checks everything else.
  function cleanAction(seat, a) {
    if (!a || typeof a !== 'object' || !ACTS.has(a.type)) return null;
    const out = { p: seat, type: a.type };
    for (const k of ['id', 'target']) {
      if (a[k] === undefined) continue;
      if (!Number.isInteger(a[k])) return null;
      out[k] = a[k];
    }
    if (a.color !== undefined) {
      if (typeof a.color !== 'string') return null;
      out.color = a.color.slice(0, 12);
    }
    if (a.claim !== undefined) {
      const c = a.claim;
      if (!c || typeof c !== 'object' || typeof c.c !== 'string' || typeof c.v !== 'string') return null;
      out.claim = { c: c.c.slice(0, 12), v: c.v.slice(0, 12) };
    }
    return out;
  }
  function newToken() {
    const b = new Uint8Array(16);
    (root.crypto || globalThis.crypto).getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  // Player side: parse a host message; null if it is not a sane object.
  function parseHost(text) {
    if (typeof text !== 'string' || text.length > 256 * 1024) return null;
    try {
      const m = JSON.parse(text);
      return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
    } catch (e) {
      return null;
    }
  }

  function create(opts = {}) {
    const timers = opts.timers || { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };
    const delays = Object.assign({ bot: [700, 1000], react: [700, 2000] }, opts.delays);
    const onUpdate = opts.onUpdate || (() => {}), send = opts.send || (() => {}), drop = opts.drop || (() => {});
    const now = opts.now || (() => Date.now());
    const conns = new Map(); // connId -> {hits, since, strikes}
    let botTimer = null, reactTimers = [], reactKey = '';

    const room = { settings: { mode: 'classic', target: 500, count: 4 }, seats: [], state: null, paused: false, closed: false };

    const rnd = ([a, b]) => a + Math.random() * (b - a);
    const reply = (id, msg) => send(id, JSON.stringify(msg));
    const seatOf = (id) => room.seats.findIndex((s) => s.kind === 'remote' && s.conn === id);
    const isBot = (i) => { const s = room.seats[i]; return !!s && (s.kind === 'bot' || (s.kind === 'remote' && s.away)); };
    function uniqueName(name) {
      const taken = new Set(room.seats.map((s) => s.name.toLowerCase()));
      if (!taken.has(name.toLowerCase())) return name;
      for (let k = 2; ; k++) {
        const n = `${Array.from(name).slice(0, MAX_NAME - 3).join('')} ${k}`;
        if (!taken.has(n.toLowerCase())) return n;
      }
    }
    function pushSeat(seat) {
      if (room.state || room.closed || room.seats.length >= MAX_SEATS) return -1;
      seat.name = uniqueName(seat.name);
      room.seats.push(Object.assign({ conn: null, token: null, away: false }, seat));
      room.settings.count = Math.max(room.settings.count, room.seats.length);
      return room.seats.length - 1;
    }
    function addSeat(seat) {
      const i = pushSeat(seat);
      if (i >= 0) changed();
      return i;
    }

    // ---------- lobby ----------
    room.configure = ({ mode, target, count } = {}) => {
      if (room.state) return false;
      if (LC.MODES.includes(mode)) room.settings.mode = mode;
      if (Number.isInteger(target) && target >= 0 && target <= 100000) room.settings.target = target;
      if (Number.isInteger(count)) room.settings.count = Math.min(MAX_SEATS, Math.max(4, room.seats.length, count));
      changed();
      return true;
    };
    room.addLocal = (name) => addSeat({ kind: 'local', name: cleanName(name) });
    room.addBot = () => addSeat({ kind: 'bot', name: BOT_NAMES.find((n) => !room.seats.some((s) => s.name === n)) || 'Bot' });
    room.removeSeat = (i) => {
      const s = room.seats[i];
      if (room.state || !s) return false;
      room.seats.splice(i, 1);
      if (s.kind === 'remote' && s.conn) dropConn(s.conn, 'The host removed you from the room');
      changed();
      return true;
    };
    room.start = () => {
      if (room.state || room.closed) return false;
      const n = Math.min(MAX_SEATS, Math.max(4, room.settings.count, room.seats.length));
      while (room.seats.length < n) {
        const name = BOT_NAMES.find((b) => !room.seats.some((s) => s.name === b)) || 'Bot';
        room.seats.push({ kind: 'bot', name: uniqueName(name), conn: null, token: null, away: false });
      }
      room.state = LC.newGame({
        mode: room.settings.mode, target: room.settings.target,
        players: room.seats.map((s) => ({ name: s.name, bot: s.kind === 'bot' })),
      });
      changed();
      return true;
    };
    room.restart = () => { // same seats and settings, fresh game
      stopTimers();
      room.state = null;
      return room.start();
    };

    // ---------- transport ----------
    room.connect = (id) => {
      if (room.closed || conns.size >= MAX_CONNS) {
        reply(id, { t: 'closed', msg: room.closed ? 'This room is closed' : 'The room is full' });
        drop(id);
        return false;
      }
      const c = { hits: 0, since: -Infinity, strikes: 0, helloTimer: null };
      // a connection that never introduces itself would hold a slot forever
      c.helloTimer = timers.set(() => { if (conns.get(id) === c && seatOf(id) < 0) dropConn(id, 'No hello received'); }, HELLO_WAIT);
      conns.set(id, c);
      return true;
    };
    // End a connection from our side. The transport does not report connections we close, so forget it here.
    function dropConn(id, msg) {
      const c = conns.get(id);
      if (c) timers.clear(c.helloTimer);
      conns.delete(id);
      if (msg) reply(id, { t: 'closed', msg });
      drop(id);
    }
    room.disconnect = (id) => {
      const c = conns.get(id);
      if (c) timers.clear(c.helloTimer);
      conns.delete(id);
      const i = seatOf(id);
      if (i < 0) return;
      if (room.state) Object.assign(room.seats[i], { conn: null, away: true }); // a bot plays until they return
      else room.seats.splice(i, 1);
      changed();
    };
    room.receive = (id, text) => {
      const c = conns.get(id);
      if (!c || room.closed) return;
      const t = now();
      if (t - c.since >= 1000) Object.assign(c, { since: t, hits: 0 });
      if (++c.hits > RATE) return; // flood: ignore the rest of this second
      let msg = null;
      if (typeof text === 'string' && text.length <= MAX_TEXT) {
        try { msg = JSON.parse(text); } catch (e) { msg = null; }
      }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return strike(id, c);
      if (msg.t === 'hello') return hello(id, msg);
      const seat = seatOf(id);
      if (msg.t !== 'act' || seat < 0) return strike(id, c);
      if (!room.state) return reply(id, { t: 'error', msg: 'The game has not started yet' });
      const a = cleanAction(seat, msg.a);
      if (!a) return strike(id, c);
      const r = LC.act(room.state, a);
      if (!r.ok) return reply(id, { t: 'error', msg: r.error });
      changed();
    };
    function strike(id, c) {
      if (++c.strikes > STRIKES) {
        dropConn(id, 'Too many invalid messages');
        room.disconnect(id); // frees or parks the seat
      }
    }
    function hello(id, msg) {
      if (seatOf(id) >= 0) return; // already seated on this connection
      const back = typeof msg.token === 'string' && msg.token.length === 32
        ? room.seats.find((s) => s.kind === 'remote' && s.token === msg.token) : null;
      if (back) {
        if (back.conn) dropConn(back.conn, 'You joined again from another connection'); // the newer one wins
        Object.assign(back, { conn: id, away: false });
      } else {
        if (room.state) return reply(id, { t: 'error', msg: 'That game has already started' });
        if (room.seats.length >= MAX_SEATS) return reply(id, { t: 'error', msg: 'The room is full' });
        if (pushSeat({ kind: 'remote', name: cleanName(msg.name), conn: id, token: newToken() }) < 0) return;
      }
      const seat = seatOf(id), c = conns.get(id);
      if (c) timers.clear(c.helloTimer);
      reply(id, { t: 'welcome', seat, token: room.seats[seat].token });
      changed();
    }

    // ---------- game ----------
    room.act = (seat, a) => {
      const s = room.seats[seat];
      if (!room.state || !s || s.kind !== 'local') return { ok: false, error: 'Not your seat' };
      const clean = cleanAction(seat, a);
      if (!clean) return { ok: false, error: 'Unknown action' };
      const r = LC.act(room.state, clean);
      if (r.ok) changed();
      return r;
    };
    room.nextRound = () => {
      if (!room.state || room.state.phase !== 'roundOver') return false;
      LC.nextRound(room.state);
      changed();
      return true;
    };
    room.view = (seat) => (room.state ? LC.view(room.state, seat) : null);
    room.lobby = (seat) => ({
      settings: Object.assign({}, room.settings), you: seat, started: !!room.state,
      seats: room.seats.map((s) => ({ kind: s.kind, name: s.name, away: s.away })),
    });
    room.setPaused = (on) => {
      room.paused = !!on;
      schedule();
    };
    room.close = (msg) => {
      if (room.closed) return;
      stopTimers();
      for (const c of conns.values()) timers.clear(c.helloTimer);
      for (const s of room.seats) if (s.kind === 'remote' && s.conn) reply(s.conn, { t: 'closed', msg: msg || 'The host ended the game' });
      room.closed = true;
    };

    function changed() {
      if (room.closed) return;
      const info = { seats: room.seats.map((s) => ({ kind: s.kind, away: s.away })) };
      room.seats.forEach((s, i) => {
        if (s.kind !== 'remote' || !s.conn) return;
        reply(s.conn, room.state ? { t: 'view', view: LC.view(room.state, i), room: info } : { t: 'lobby', lobby: room.lobby(i) });
      });
      onUpdate();
      schedule();
    }
    function stopTimers() {
      timers.clear(botTimer);
      botTimer = null;
      reactTimers.forEach((t) => timers.clear(t));
      reactTimers = [];
      reactKey = '';
    }
    // One timer drives whichever bot (or away player) must act; bots also react out of turn, once per episode.
    function schedule() {
      timers.clear(botTimer);
      botTimer = null;
      const S = room.state;
      if (!S || S.phase !== 'play' || room.paused || room.closed) return stopTimers();
      const a = LC.actor(S);
      if (isBot(a)) {
        botTimer = timers.set(() => {
          botTimer = null;
          if (room.state !== S || room.paused || room.closed) return;
          const act = LC.botAction(S, a);
          if (act && LC.act(S, act).ok) changed();
        }, rnd(delays.bot));
      }
      react(S);
    }
    function react(S) {
      const pd = S.pending, doubt = pd && pd.type === 'doubt' ? pd : null, vul = S.vulnerable;
      const key = `${vul}|${doubt ? `${doubt.from}:${doubt.id}` : ''}`;
      if (key === reactKey) return;
      reactTimers.forEach((t) => timers.clear(t));
      reactTimers = [];
      reactKey = key;
      const later = (fn) => reactTimers.push(timers.set(() => {
        if (room.state === S && !room.paused && !room.closed && fn()) changed();
      }, rnd(delays.react)));
      room.seats.forEach((s, b) => {
        if (!isBot(b) || S.players[b].out) return;
        if (vul !== null && vul !== b) later(() => S.vulnerable === vul && LC.botCatch(S, b) && LC.act(S, { p: b, type: 'catch', target: vul }).ok);
        if (doubt && b !== doubt.from && b !== doubt.p) later(() => S.pending === doubt && LC.botDoubt(S, b) && LC.act(S, { p: b, type: 'challenge' }).ok);
      });
    }
    return room;
  }

  const api = { create, cleanName, cleanAction, parseHost, MAX_TEXT, MAX_SEATS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LastCardRoom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
