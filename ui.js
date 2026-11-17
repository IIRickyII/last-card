/*
 * Last Card — browser UI. Renders only from view objects (room.view(seat) locally, host messages online).
 * Screens: home, local setup, host setup, join, connecting, host lobby, player waiting room, game.
 * All text goes in through textContent; dynamic styling goes through CSS custom properties.
 */
(function () {
'use strict';
const LC = window.LastCard, LR = window.LastCardRoom, LN = window.LastCardNet;
const $ = (s) => document.querySelector(s);

// ---------- static data ----------
const MODES = [
  ['classic', 'Classic', '108 cards. Match color or symbol. Wild Draw 4 can be challenged.'],
  ['flip', 'Flip', '112 double-sided cards. Flip cards switch everything between the Light and Dark side.'],
  ['nomercy', 'No Mercy', "168 cards. Stack draw cards, 0 rotates hands, 7 swaps, 25 cards and you're out."],
  ['liar', 'Liar', 'Bluff cards go down face down with any believable claim. Let it stand, or call the bluff.'],
];
const MNAME = { classic: 'Classic', flip: 'Flip', nomercy: 'No Mercy', liar: 'Liar' };
const SEAT_NAMES = ['Player 1', 'Ava', 'Ben', 'Cleo', 'Dax', 'Eli', 'Fay', 'Gus'];
const TARGETS = { classic: [0, 200, 500, 1000], flip: [0, 200, 500, 1000], liar: [0, 200, 500, 1000], nomercy: [0, 1000, 3000, 5000] };
const DEF_TARGET = { classic: 500, flip: 500, liar: 500, nomercy: 3000 };
const GL = {
  skip: ['⊘', 'SKIP'], rev: ['⇄', 'REVERSE'], d1: ['+1', 'DRAW 1'], d2: ['+2', 'DRAW 2'], d4: ['+4', 'DRAW 4'], d5: ['+5', 'DRAW 5'],
  flip: ['⇅', 'FLIP'], skipall: ['⊘', 'SKIP ALL'], discall: ['≡', 'DISCARD ALL'], wild: ['✦', 'WILD'], wd2: ['+2', 'WILD DRAW'],
  wd4: ['+4', 'WILD DRAW'], wd6: ['+6', 'WILD DRAW'], wd10: ['+10', 'WILD DRAW'], wdc: ['+?', 'DRAW COLOR'], wrd4: ['⇄+4', 'WILD REVERSE'],
  roul: ['?', 'ROULETTE'], wlc: ['!?', 'CALL-OUT'],
};
const VORD = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'd1', 'd2', 'd4', 'd5', 'skip', 'rev', 'skipall', 'flip', 'discall', 'wild', 'wd2', 'wd4', 'wdc', 'wrd4', 'wd6', 'wd10', 'roul', 'wlc'];
const BIG = new Set(['flip', 'challenge', 'catch', 'swap', 'rotate', 'out', 'round', 'game', 'callout', 'stack']);
const AV = ['blue', 'green', 'orange', 'purple', 'red', 'teal', 'pink', 'yellow'];
const HOW = {
  common: ['Everyone gets 7 cards. Match the top card by color or symbol/number, or play a Wild. Can\'t or won\'t play? Draw.',
    'Press LAST CARD! when you are down to one or two cards. If someone catches you with one card before the next player acts, you draw 2.',
    'Empty your hand to win the round and score the points left in everyone else\'s hands. First to the target score wins.'],
  classic: ['Skip, Reverse, Draw 2 (next player draws 2 and is skipped), Wild, Wild Draw 4 (next player draws 4 and is skipped; they may challenge. If you held a card of the previous color you draw 4 instead, otherwise they draw 6).',
    'Draw 1 when you can\'t play; you may play it at once.',
    'Scoring: numbers face value, Skip/Reverse/Draw 2 = 20, Wilds = 50.'],
  flip: ['Light side has Draw 1, Reverse, Skip, Flip, Wild, Wild Draw 2 (challengeable). Dark side has Draw 5, Reverse, Skip Everyone (you go again), Flip, Wild, Wild Draw Color (next player draws until they get the chosen color; challengeable).',
    'A Flip card turns everything over: discard, draw pile, every hand. You can see the other side of opponents\' cards and of the top draw card.',
    'Scoring: Draw 1 = 10; Draw 5, Reverse, Skip, Flip = 20; Skip Everyone = 30; Wild = 40; Wild Draw 2 = 50; Wild Draw Color = 60.'],
  nomercy: ['Draw cards stack: answer with an equal or bigger one (+2, +4, Wild Reverse +4, +6, +10) or take the whole stack and lose your turn.',
    'Skip Everyone, Discard All (dump every card of that color), Wild Color Roulette (next player names a color and flips cards until it appears, keeping them all), 0 = everyone passes their hand along the direction of play, 7 = swap hands with a player you pick.',
    'Can\'t play? Keep drawing until you can. 25 cards = knocked out; the last player standing also wins.',
    'Scoring: Skip/Reverse/Draw 2/Discard All = 20; Skip Everyone/Draw 4 = 30; Wilds = 50.'],
  liar: ['Cards marked with a ? are bluff cards. Play one face down and claim any card that fits the pile: the same color, the same number or action, or a Wild Draw 4.',
    'The next player may let it stand or call the bluff, and any other player may call it too. If the card is not what was claimed, it goes back to its owner, who draws 1 more. If the claim was true, the caller draws 1 and the card works as claimed.',
    '0 passes every hand to the next player, 7 swaps hands with a player you choose.',
    'Wild Call-Out: every other player puts one card face down, and the caller flips them one at a time. A card that is not of the current color was a bluff, and its owner draws 1. Anyone left without cards wins.',
    'Scoring: Skip/Reverse/Draw 2 = 20; Wild Draw 4 and Call-Out = 50.'],
};

// ---------- icons ----------
const ICON = {
  back: 'M15 5l-7 7 7 7', chev: 'M9 5l7 7-7 7', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18', cw: 'M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5',
  device: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  host: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
  join: 'M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5',
  scores: 'M6 20V11M12 20V4M18 20v-6',
  rules: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM9.6 9.3a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8M12 17h.01',
  leave: 'M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9',
  copy: 'M9 9h10v11H9zM15 5H5v11', share: 'M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
  q: 'M9.6 9.3a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8M12 17h.01',
};
function icon(name, cls) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICON[name]);
  s.append(p);
  return s;
}

// ---------- state ----------
let screen = 'home';          // home | setup | hostsetup | join | connecting | lobby | wait | game
let role = null;              // null | 'local' | 'host' | 'player'
let room = null, net = null, gen = 0;
let viewer = 0, cv = null;    // seat shown on this device, the view being rendered
let pview = null, pinfo = null, lobbyData = null; // player: last view, room info, lobby
let hostCode = '', joinCode = '', joinName = '', connectMsg = '';
let infoSheet = null, claimUI = null, alertUI = null, alertN = 0;
let lastN = null, lastTopKey = '', targetTouched = false;
let sheetKey = '', prevFocus = null, coverKey = '';
const cfg = { mode: 'classic', n: 4, target: 500, seats: SEAT_NAMES.map((n, i) => ({ name: n, bot: i > 0 })) };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
};
const sess = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
};

// ---------- helpers ----------
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
function btn(text, fn, cls, extra) {
  return h('button', Object.assign({ type: 'button', class: 'btn ' + (cls || 'gray'), onclick: fn }, extra), text);
}
function ibtn(name, label, fn, extra) {
  return h('button', Object.assign({ type: 'button', class: 'ibtn', 'aria-label': label, title: label, onclick: fn }, extra), icon(name));
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const ini = (n) => (Array.from(String(n).trim())[0] || '?').toUpperCase();
const plural = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
const avatar = (name, i, cls) => {
  const a = h('span', { class: 'av' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', text: ini(name) });
  a.style.setProperty('--av', `var(--${AV[i % AV.length]})`);
  return a;
};
// A 300 ms lock swallows the second click of a double-click, which would otherwise hit whatever replaced the first target.
let lockUntil = 0;
function settled() {
  const t = performance.now();
  if (t < lockUntil) return false;
  lockUntil = t + 300;
  return true;
}
function keepFocus(fn) {
  const a = document.activeElement, fk = a && a.dataset ? a.dataset.fk : null;
  fn();
  if (fk) {
    const el = document.querySelector('[data-fk="' + fk + '"]');
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }
}
function fallbackFocus() {
  const root = $('#table').hidden ? $('#app') : $('#table');
  const el = document.querySelector('#actions button:not([disabled])') || document.querySelector('#hand button') || root;
  if (el === root && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}
function toast(t, cls) {
  const box = $('#toasts');
  const e = h('div', { class: 'toast' + (cls ? ' ' + cls : ''), text: String(t).slice(0, 200) });
  box.append(e);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => e.remove(), 2800);
}
function validHostView(m) {
  const v = m && m.view, r = m && m.room;
  return !!v && typeof v === 'object' && Array.isArray(v.players) && Array.isArray(v.hand) && Array.isArray(v.events) &&
    !!v.top && typeof v.top === 'object' && !!v.top.face && Number.isInteger(v.seat) && v.seat >= 0 && v.seat < v.players.length &&
    v.players.every((p) => !!p && typeof p === 'object') &&
    !!r && Array.isArray(r.seats);
}

// ---------- cards ----------
function cardEl(f, o) {
  o = o || {};
  const g = GL[f.v] || [String(f.v), ''];
  const lbl = LC.label(f) + (o.liar ? ' (bluff card)' : '');
  const attrs = Object.assign({ class: `card c-${f.c}${o.dark ? ' dk' : ''}${o.cls ? ' ' + o.cls : ''}`, 'aria-label': lbl, title: lbl }, o.attrs);
  if (o.tag === 'button') attrs.type = 'button';
  return h(o.tag || 'div', attrs,
    f.c === 'wild' && h('span', { class: 'ring' }),
    h('i', { class: 'cn tl', text: g[0], 'aria-hidden': 'true' }),
    h('div', { class: 'mid', 'aria-hidden': 'true' },
      h('b', { class: 'g' + (g[0].length > 2 ? ' long' : '') + (f.v === '6' || f.v === '9' ? ' u' : ''), text: g[0] }),
      g[1] && h('small', { text: g[1] })),
    h('i', { class: 'cn br', text: g[0], 'aria-hidden': 'true' }),
    o.liar && h('span', { class: 'bluff', 'aria-hidden': 'true' }, icon('q')));
}
const backEl = (cls) => h('div', { class: 'card back' + (cls ? ' ' + cls : ''), role: 'img', 'aria-label': 'Card back' });
function sortedHand(hand, side) {
  const order = LC.COLORS[side].concat('wild');
  return hand.slice().sort((a, b) => order.indexOf(a.face.c) - order.indexOf(b.face.c) || VORD.indexOf(a.face.v) - VORD.indexOf(b.face.v));
}

// ---------- role helpers ----------
const human = () => role === 'player' || (!!room && !!room.seats[viewer] && room.seats[viewer].kind === 'local');
const mine = () => !!cv && human() && cv.phase === 'play' && cv.actor === cv.seat && !cv.players[cv.seat].out;
const awayOf = (i) => {
  const s = role === 'player' ? (pinfo && pinfo.seats[i]) : (room && room.seats[i]);
  return !!(s && s.away);
};
const localHumans = () => (room ? room.seats.map((s, i) => (s.kind === 'local' ? i : -1)).filter((i) => i >= 0) : []);

// ---------- actions ----------
function act(a) {
  if (!settled()) return false;
  if (role === 'player') {
    if (net) net.send(JSON.stringify({ t: 'act', a }));
    return true;
  }
  if (!room) return false;
  const r = room.act(viewer, a);
  if (!r.ok) toast(r.error, 'err');
  return r.ok;
}
function playCard(c) {
  if (c.liar && cv.claims) { claimUI = { id: c.id }; render(); return; }
  act({ type: 'play', id: c.id });
}
function onCard(c) {
  const pd = cv.pending;
  if (!mine()) return;
  if (pd && pd.type === 'place' && pd.p === cv.seat) { act({ type: 'place', id: c.id }); return; }
  if (c.playable) playCard(c);
}

// ---------- navigation / lifecycle ----------
function go(s) {
  screen = s;
  render();
  window.scrollTo(0, 0);
}
function refresh() { if (screen === 'game' || screen === 'lobby') render(); }
function cleanup() {
  gen++;
  const r = room, n = net, rl = role;
  // close the room while `net` is still set: its send hook needs it to tell players the game ended
  if (r) { try { r.setPaused(false); r.close(); } catch (e) { console.error(e); } }
  room = null; net = null; role = null;
  if (n) {
    if (rl === 'host') setTimeout(() => { try { n.destroy(); } catch (e) { /* already closed */ } }, 500); // let the queued 'closed' messages out first
    else { try { n.leave(); } catch (e) { /* already closed */ } }
  }
  cv = null; pview = null; pinfo = null; lobbyData = null; infoSheet = null; claimUI = null; lastN = null; lastTopKey = '';
  $('#toasts').replaceChildren();
}
function toHome() { cleanup(); alertUI = null; go('home'); }
function showAlert(title, msg, btns) {
  alertUI = { n: ++alertN, title, msg, btns };
  render();
}
function onlineDown() {
  toast('Online play could not load. Check your connection and reload the page.', 'err');
}
window.addEventListener('beforeunload', (e) => {
  if (role === 'host' && room && room.state && room.state.phase !== 'gameOver') { e.preventDefault(); e.returnValue = ''; }
});

// ---------- info sheets ----------
function openInfo(k) {
  infoSheet = k;
  if (role === 'local' && room) room.setPaused(true);
  render();
}
function closeInfo() {
  infoSheet = null;
  if (role === 'local' && room) room.setPaused(false);
  render();
}

// ---------- local game ----------
function startLocal() {
  cleanup();
  role = 'local';
  const r = (room = LR.create({ onUpdate: refresh }));
  r.configure({ mode: cfg.mode, target: cfg.target, count: cfg.n });
  cfg.seats.slice(0, cfg.n).forEach((s, i) => {
    if (s.bot) r.addBot(); else r.addLocal(s.name.trim() || 'Player ' + (i + 1));
  });
  const hs = localHumans();
  viewer = hs.length ? hs[0] : 0;
  lastN = null;
  screen = 'game';
  r.start();
  render();
}

// ---------- online: host ----------
function startHost(name) {
  if (!LN || !LN.available()) { onlineDown(); return; }
  name = (name || '').trim();
  store.set('lastcard:name', name);
  cleanup();
  alertUI = null;
  role = 'host';
  const g = gen, r = (room = LR.create({
    onUpdate: refresh,
    send: (id, t) => { if (net) net.send(id, t); },
    drop: (id) => { if (net) net.drop(id); },
  }));
  r.addLocal(name || 'Host');
  viewer = 0; lastN = null; targetTouched = false;
  connectMsg = 'Opening your room…';
  screen = 'connecting';
  render();
  net = LN.host({
    onReady: (code) => { if (g !== gen) return; hostCode = code; go('lobby'); },
    onOpen: (id) => { if (g === gen) r.connect(id); },
    onMessage: (id, t) => { if (g === gen) r.receive(id, t); },
    onClose: (id) => { if (g === gen) r.disconnect(id); },
    onError: (e) => {
      if (g !== gen) return;
      const msg = (e && e.message) || 'Connection problem';
      if (screen === 'connecting') { cleanup(); go('hostsetup'); showAlert('Couldn’t open a room', msg, [{ label: 'OK', cls: 'filled', fn: () => { alertUI = null; render(); } }]); }
      else toast(msg, 'err');
    },
  });
}
function lobbyConfigure(o) { if (room) room.configure(o); }
function setMode(m) {
  const t = TARGETS[m];
  const st = room ? room.settings.target : cfg.target;
  const target = !targetTouched || !t.includes(st) ? DEF_TARGET[m] : st;
  return { mode: m, target };
}
function startHosted() {
  if (!room) return;
  screen = 'game';
  lastN = null;
  if (!room.start()) { screen = 'lobby'; return; }
  render();
}

// ---------- online: player ----------
function joinGame(code, name) {
  if (!LN || !LN.available()) { onlineDown(); return; }
  code = String(code || '').toUpperCase();
  if (!LN.validCode(code)) { toast('Room codes are 6 letters and numbers.', 'err'); return; }
  name = (name || '').trim();
  store.set('lastcard:name', name);
  cleanup();
  alertUI = null;
  role = 'player';
  joinCode = code; joinName = name; lastN = null;
  const g = gen;
  let welcomed = false;
  connectMsg = 'Connecting to the host…';
  screen = 'connecting';
  render();
  const fail = (title, msg) => {
    cleanup();
    go('join');
    showAlert(title, msg, [{ label: 'OK', cls: 'filled', fn: () => { alertUI = null; render(); } }]);
  };
  net = LN.join(code, {
    onOpen: () => {
      if (g !== gen || !net) return;
      const token = sess.get('lastcard:' + code);
      const hello = { t: 'hello', name };
      if (token) hello.token = token;
      net.send(JSON.stringify(hello));
    },
    onMessage: (text) => {
      if (g !== gen) return;
      try { onHostMsg(text); } catch (e) {
        console.error(e);
        if (g !== gen) return;
        lost(true, true);
      }
    },
    onClose: () => { if (g === gen) lost(welcomed); },
    onError: (e) => {
      if (g !== gen) return;
      const msg = (e && e.message) || 'Connection problem';
      if (!welcomed) fail('Couldn’t join', msg); else lost(true);
    },
  });
  function onHostMsg(text) {
      const m = LR.parseHost(text);
      if (!m) return;
      if (m.t === 'welcome') {
        welcomed = true;
        if (typeof m.token === 'string') sess.set('lastcard:' + code, m.token);
      } else if (m.t === 'lobby') {
        const l = m.lobby;
        if (!l || typeof l !== 'object' || !Array.isArray(l.seats) || !l.settings || typeof l.settings !== 'object') return;
        lobbyData = l; pview = null;
        if (screen !== 'wait') go('wait'); else render();
      } else if (m.t === 'view') {
        if (!validHostView(m)) return;
        pview = m.view; pinfo = m.room;
        if (screen !== 'game') { screen = 'game'; }
        render();
      } else if (m.t === 'error') {
        const msg = String(m.msg == null ? 'Something went wrong' : m.msg).slice(0, 200);
        if (!welcomed) fail('Couldn’t join', msg); else toast(msg, 'err');
      } else if (m.t === 'closed') {
        const msg = String(m.msg == null ? 'The game has ended' : m.msg).slice(0, 200);
        sess.del('lastcard:' + code);
        cleanup();
        go('home');
        showAlert('Game ended', msg, [{ label: 'Home', cls: 'filled', fn: toHome }]);
      }
  }
}
function lost(welcomed, broken) {
  if (!welcomed) { cleanup(); go('join'); showAlert('Couldn’t join', 'The connection to the host was closed.', [{ label: 'OK', cls: 'filled', fn: () => { alertUI = null; render(); } }]); return; }
  const code = joinCode, name = joinName;
  gen++;
  if (broken) {
    const n = net;
    if (n) { try { n.leave(); } catch (e) { /* already closed */ } }
    pview = null; pinfo = null; lobbyData = null; cv = null; claimUI = null; infoSheet = null;
  }
  net = null;
  showAlert(broken ? 'Something went wrong' : 'Lost connection to the host', broken ? 'The host sent something this page couldn’t show.' : 'You can try to reconnect. Your seat is kept for you while the host keeps the game open.', [
    { label: 'Reconnect', cls: 'filled', fn: () => { alertUI = null; joinGame(code, name); } },
    { label: 'Home', cls: 'gray', fn: toHome },
  ]);
}

// ---------- non-game screens ----------
function bigOpt(ic, title, desc, fn) {
  return h('button', { type: 'button', class: 'bigopt', onclick: fn },
    h('span', { class: 'bubble' }, icon(ic)),
    h('span', { class: 'bo-text' }, h('b', { text: title }), h('span', { text: desc })),
    icon('chev', 'chev'));
}
function seg(opts, cur, fn, label) {
  return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, opts.map(([v, t]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(v === cur), 'data-fk': 'seg-' + label + v, onclick: () => fn(v),
  }, t)));
}
function stepper(val, min, max, onDec, onInc, label) {
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Fewer ' + label, disabled: val <= min, 'data-fk': 'dec-' + label, onclick: onDec }, icon('minus')),
    h('output', { text: String(val), 'aria-label': `${val} ${label}` }),
    h('button', { type: 'button', class: 'ibtn', 'aria-label': 'More ' + label, disabled: val >= max, 'data-fk': 'inc-' + label, onclick: onInc }, icon('plus')));
}
const group = (title, rows, note) => h('section', { class: 'sect' },
  title && h('h2', { class: 'sect-title', text: title }),
  h('div', { class: 'group' }, rows),
  note && h('p', { class: 'sect-note', text: note }));
const row = (...kids) => h('div', { class: 'row' }, kids.flat(3));
function topNav(title, back, right) {
  return h('div', { class: 'topnav' },
    back ? h('button', { type: 'button', class: 'btn plain back', onclick: back, 'data-fk': 'back' }, icon('back'), 'Back') : h('span'),
    right || null);
}
const targetLabel = (v) => (v ? String(v) : 'One round');
const modeDesc = (m) => MODES.find((x) => x[0] === m)[2];

function homeScreen() {
  return h('div', { class: 'page' },
    h('div', { class: 'hero' },
      h('h1', { class: 'large', text: 'LAST CARD' }),
      h('p', { class: 'lead', text: 'The shedding card game for 4 to 8 players. Play bots, pass the device, or go online.' })),
    h('div', { class: 'bigopts' },
      bigOpt('device', 'Play on this device', 'Bots and pass-and-play', () => go('setup')),
      bigOpt('host', 'Host an online game', 'Invite friends with a link', () => { if (!LN || !LN.available()) return onlineDown(); go('hostsetup'); }),
      bigOpt('join', 'Join a game', 'Enter a 6-character code', () => { if (!LN || !LN.available()) return onlineDown(); go('join'); })),
    h('div', { class: 'center-row' }, btn('How to play', () => openInfo('rules'), 'plain')));
}
function setupScreen() {
  const seatRows = cfg.seats.slice(0, cfg.n).map((s, i) => row(
    h('span', { class: 'num', text: String(i + 1), 'aria-hidden': 'true' }),
    h('input', {
      type: 'text', class: 'field', value: s.name, maxlength: '16', autocomplete: 'off', 'aria-label': `Seat ${i + 1} name`,
      oninput: (e) => { s.name = e.target.value; },
    }),
    seg([['h', 'Human'], ['b', 'Bot']], s.bot ? 'b' : 'h', (v) => { s.bot = v === 'b'; render(); }, `Seat ${i + 1}`)));
  const tg = TARGETS[cfg.mode];
  return h('div', { class: 'page' },
    topNav('', toHome),
    h('h1', { class: 'large', text: 'New game' }),
    h('section', { class: 'sect' },
      h('h2', { class: 'sect-title', text: 'Mode' }),
      h('div', { class: 'group pad' },
        seg(MODES.map((m) => [m[0], m[1]]), cfg.mode, (m) => {
          cfg.mode = m;
          if (!targetTouched || !TARGETS[m].includes(cfg.target)) cfg.target = DEF_TARGET[m];
          render();
        }, 'Mode'),
        h('p', { class: 'desc', text: modeDesc(cfg.mode) }))),
    group('Players', [row(h('span', { class: 'grow', text: 'Number of players' }),
      stepper(cfg.n, 4, 8, () => { cfg.n--; render(); }, () => { cfg.n++; render(); }, 'players'))]),
    group('Seats', seatRows, 'Several humans share this device: it asks you to pass it on at each turn.'),
    h('section', { class: 'sect' },
      h('h2', { class: 'sect-title', text: 'Play to' }),
      h('div', { class: 'group pad' }, seg(tg.map((v) => [v, targetLabel(v)]), cfg.target, (v) => { cfg.target = v; targetTouched = true; render(); }, 'Target score'))),
    h('div', { class: 'footbar' }, btn('Start game', startLocal, 'filled wide')));
}
function hostSetupScreen() {
  const inp = h('input', {
    type: 'text', class: 'field', maxlength: '16', autocomplete: 'off', value: store.get('lastcard:name') || '', placeholder: 'Your name', 'aria-label': 'Your name',
    onkeydown: (e) => { if (e.key === 'Enter') startHost(inp.value); },
  });
  return h('div', { class: 'page' },
    topNav('', toHome),
    h('h1', { class: 'large', text: 'Host a game' }),
    h('p', { class: 'lead', text: 'You get a room code and an invite link. Friends join from their own devices.' }),
    group('Your name', [row(inp)], 'Keep this page open while you play: the game runs on your device. Empty seats are filled with bots.'),
    h('div', { class: 'footbar' }, btn('Create room', () => startHost(inp.value), 'filled wide')));
}
function joinScreen() {
  const nameInp = h('input', {
    type: 'text', class: 'field', maxlength: '16', autocomplete: 'off', value: joinName || store.get('lastcard:name') || '', placeholder: 'Your name', 'aria-label': 'Your name',
    oninput: (e) => { joinName = e.target.value; },
  });
  const codeInp = h('input', {
    type: 'text', class: 'field code-field', maxlength: '6', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', value: joinCode, placeholder: 'ABC234', 'aria-label': 'Room code',
    oninput: (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); joinCode = e.target.value; },
    onkeydown: (e) => { if (e.key === 'Enter') go2(); },
  });
  const go2 = () => {
    joinCode = codeInp.value.toUpperCase();
    joinGame(joinCode, nameInp.value);
  };
  return h('div', { class: 'page' },
    topNav('', toHome),
    h('h1', { class: 'large', text: 'Join a game' }),
    h('p', { class: 'lead', text: 'Ask the host for the 6-character room code, or open their invite link.' }),
    group(null, [row(h('span', { class: 'lbl', text: 'Name' }), nameInp), row(h('span', { class: 'lbl', text: 'Code' }), codeInp)]),
    h('div', { class: 'footbar' }, btn('Join', go2, 'filled wide')));
}
function connectingScreen() {
  return h('div', { class: 'page center-page' },
    h('div', { class: 'spinner', 'aria-hidden': 'true' }),
    h('p', { class: 'title', text: connectMsg, role: 'status' }),
    btn('Cancel', toHome, 'plain'));
}
function seatTag(kind, away, isYou) {
  if (away) return 'away';
  if (isYou) return 'You';
  return { local: 'Host', remote: 'Friend', bot: 'BOT' }[kind] || '';
}
function lobbySeatRows(seats, count, you, removable) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const s = seats[i];
    if (!s) { rows.push(row(avatar('?', i, 'ghost'), h('span', { class: 'grow dim', text: 'Bot' }), h('span', { class: 'tag dim', text: 'fills in at start' }))); continue; }
    rows.push(row(avatar(s.name, i),
      h('span', { class: 'grow ell', text: s.name }),
      h('span', { class: 'tag' + (s.away ? ' warn' : ''), text: seatTag(s.kind, s.away, i === you) }),
      removable && s.kind !== 'local' ? btn('Remove', () => room.removeSeat(i), 'plain danger', { 'aria-label': `Remove ${s.name}` }) : null));
  }
  return rows;
}
function lobbyScreen() {
  const st = room.settings, link = location.origin + location.pathname + '#join=' + hostCode;
  const tg = TARGETS[st.mode];
  const minCount = Math.max(4, room.seats.length);
  const linkEls = [h('span', { class: 'link', text: link })];
  const acts = h('div', { class: 'linkacts' },
    btn('Copy', () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(() => toast('Invite link copied'), () => toast('Couldn’t copy. Select the link instead.', 'err'));
      } else toast('Couldn’t copy. Select the link instead.', 'err');
    }, 'tinted', { 'data-fk': 'copy' }),
    typeof navigator.share === 'function' ? btn('Share', () => {
      navigator.share({ title: 'LAST CARD', text: 'Join my game of Last Card', url: link }).catch(() => {});
    }, 'tinted', { 'data-fk': 'share' }) : null);
  return h('div', { class: 'page' },
    topNav('', () => openInfo('leave')),
    h('h1', { class: 'large', text: 'Your room' }),
    h('div', { class: 'codecard' },
      h('span', { class: 'foot', text: 'ROOM CODE' }),
      h('b', { class: 'bigcode', text: hostCode, 'aria-label': 'Room code ' + hostCode.split('').join(' ') })),
    group('Invite link', [row(linkEls), row(acts)]),
    h('section', { class: 'sect' },
      h('h2', { class: 'sect-title', text: 'Mode' }),
      h('div', { class: 'group pad' },
        seg(MODES.map((m) => [m[0], m[1]]), st.mode, (m) => lobbyConfigure(setMode(m)), 'Mode'),
        h('p', { class: 'desc', text: modeDesc(st.mode) }))),
    h('section', { class: 'sect' },
      h('h2', { class: 'sect-title', text: 'Play to' }),
      h('div', { class: 'group pad' }, seg(tg.map((v) => [v, targetLabel(v)]), st.target, (v) => { targetTouched = true; lobbyConfigure({ target: v }); }, 'Target score'))),
    group('Players', [row(h('span', { class: 'grow', text: 'Number of players' }),
      stepper(st.count, minCount, 8, () => lobbyConfigure({ count: st.count - 1 }), () => lobbyConfigure({ count: st.count + 1 }), 'players'))]),
    group('Seats', lobbySeatRows(room.seats, st.count, 0, true).concat([row(btn('Add bot', () => room.addBot(), 'tinted', { disabled: room.seats.length >= 8, 'data-fk': 'addbot' }))]),
      'Empty seats are filled with bots.'),
    h('div', { class: 'footbar' }, btn('Start game', startHosted, 'filled wide')));
}
function waitScreen() {
  const l = lobbyData, st = l.settings;
  return h('div', { class: 'page' },
    topNav('', () => openInfo('leave')),
    h('h1', { class: 'large', text: 'Waiting room' }),
    h('div', { class: 'codecard' },
      h('span', { class: 'foot', text: 'ROOM CODE' }),
      h('b', { class: 'bigcode', text: joinCode, 'aria-label': 'Room code ' + joinCode.split('').join(' ') })),
    group('Game', [
      row(h('span', { class: 'grow', text: 'Mode' }), h('span', { class: 'val', text: MNAME[st.mode] || cap(String(st.mode)) })),
      row(h('span', { class: 'grow', text: 'Play to' }), h('span', { class: 'val', text: targetLabel(st.target) })),
      row(h('span', { class: 'grow', text: 'Players' }), h('span', { class: 'val', text: String(st.count) }))]),
    group('Seats', lobbySeatRows(l.seats, Math.max(st.count, l.seats.length), l.you, false), 'Waiting for the host to start. Empty seats are filled with bots.'));
}
function renderApp() {
  const app = $('#app');
  const y = window.scrollY;
  keepFocus(() => {
    let node;
    if (screen === 'setup') node = setupScreen();
    else if (screen === 'hostsetup') node = hostSetupScreen();
    else if (screen === 'join') node = joinScreen();
    else if (screen === 'connecting') node = connectingScreen();
    else if (screen === 'lobby' && room) node = lobbyScreen();
    else if (screen === 'wait' && lobbyData) node = waitScreen();
    else node = homeScreen();
    app.replaceChildren(node);
  });
  window.scrollTo(0, y);
}

// ---------- game rendering ----------
function renderBar(v) {
  const meta = `${MNAME[v.mode] || v.mode} · Round ${v.round}`;
  $('#bar').replaceChildren(h('div', { class: 'bar-in' },
    h('div', { class: 'bar-title' }, h('b', { text: meta }), h('span', { text: v.target ? `First to ${v.target}` : 'Single round' })),
    ibtn('scores', 'Scores', () => openInfo('scores')),
    ibtn('rules', 'Rules', () => openInfo('rules')),
    ibtn('leave', 'Leave', () => openInfo('leave'))));
}
function oppEl(i, v) {
  const pl = v.players[i], pd = v.pending, flip = v.mode === 'flip';
  const my = mine();
  const swapPick = my && pd && pd.type === 'swap' && !pl.out;
  const revealPick = my && pd && pd.type === 'callout' && pd.p === v.seat && pd.placed[i] && !pd.shown[i];
  const pick = !!(swapPick || revealPick);
  const n = pl.count, tag = pl.out ? 'OUT' : pl.bot ? 'BOT' : awayOf(i) ? 'away' : '';
  const fan = h('div', { class: 'fan', 'aria-hidden': 'true' }, pl.out ? null : Array.from({ length: Math.min(n, 8) }, (_, k) =>
    flip && pl.backs && pl.backs[k] ? cardEl(pl.backs[k], { dark: v.side === 'light', cls: 'mini' }) : backEl('mini')));
  let placed = null;
  if (pd && (pd.type === 'place' || pd.type === 'callout') && (pd.placed[i] || pd.shown[i])) {
    const sh = pd.shown[i];
    placed = h('div', { class: 'placed' + (sh ? (sh.truthful ? ' ok' : ' bad') : '') },
      sh ? cardEl(sh.face, { dark: v.side === 'dark', cls: 'mini2' }) : backEl('mini2'),
      sh ? h('span', { class: 'res', 'aria-label': sh.truthful ? 'told the truth' : 'was bluffing' }, icon(sh.truthful ? 'check' : 'x')) : h('span', { class: 'res dim', text: 'face down' }));
  }
  const badges = h('div', { class: 'badges' },
    tag && h('em', { class: 'tag' + (tag === 'OUT' ? ' red' : tag === 'away' ? ' warn' : ''), text: tag }),
    !pl.out && n === 1 && v.phase === 'play' && h('em', { class: 'tag hot', text: 'LAST CARD' }));
  const el = h(pick ? 'button' : 'div', {
    type: pick ? 'button' : null,
    class: 'opp' + (pl.out ? ' out' : '') + (v.phase === 'play' && v.actor === i ? ' act' : '') + (pick ? ' pick' : ''),
    'aria-label': pick ? (swapPick ? `Swap hands with ${pl.name}` : `Flip ${pl.name}'s card`) : null,
    'data-fk': 'opp' + i,
    onclick: pick ? () => act(swapPick ? { type: 'swap', target: i } : { type: 'reveal', target: i }) : null,
  },
  h('div', { class: 'opp-head' }, avatar(pl.name, i, v.phase === 'play' && v.actor === i ? 'act' : ''),
    h('div', { class: 'opp-id' }, h('b', { class: 'ell', text: pl.name }), badges)),
  h('div', { class: 'opp-stat', text: `${plural(n, 'card')} · ${pl.score} pts` }),
  fan, placed);
  return el;
}
function renderOpps(v) {
  const n = v.players.length;
  $('#opps').replaceChildren(...Array.from({ length: n - 1 }, (_, k) => oppEl((v.seat + k + 1) % n, v)));
}
function renderCenter(v) {
  const dark = v.side === 'dark', flip = v.mode === 'flip', pd = v.pending;
  const can = mine() && !pd;
  const dfront = flip && v.drawBack ? cardEl(v.drawBack, { dark: !dark, cls: 'lg' }) : backEl('lg');
  const dp = h('button', {
    type: 'button', class: 'pile draw' + (can ? ' can' : ''), 'data-fk': 'pile',
    'aria-label': v.stack ? `Take ${plural(v.stack, 'card')}` : `Draw pile, ${plural(v.drawCount, 'card')}`,
    'aria-disabled': String(!can), onclick: () => { if (can) act({ type: 'draw' }); },
  }, dfront, h('span', { class: 'cnt', text: String(v.drawCount) }));
  const t = v.top, last = v.events.length ? v.events[v.events.length - 1].n : 0;
  const key = `${v.round}|${t.down}|${t.face.c}|${t.face.v}|${last}`;
  const pop = key !== lastTopKey;
  lastTopKey = key;
  const disc = h('div', { class: 'pile disc' },
    t.down ? backEl('lg' + (pop ? ' pop' : '')) : cardEl(t.face, { dark, cls: 'lg' + (pop ? ' pop' : '') }),
    t.down && h('span', { class: 'claim', text: `claims ${LC.label(t.face)}` }));
  const choosing = v.color === null;
  const ind = h('div', { class: 'ind' },
    h('div', { class: 'ind-row' },
      h('span', { class: 'dot ' + (choosing ? 'choosing' : 'c-' + v.color), role: 'img', 'aria-label': choosing ? 'Choosing a color' : 'Current color ' + v.color }),
      h('span', { class: 'colname', text: choosing ? 'choosing…' : cap(v.color) })),
    h('div', { class: 'ind-row' },
      h('span', { class: 'dir' + (v.dir === 1 ? '' : ' ccw'), role: 'img', 'aria-label': v.dir === 1 ? 'Clockwise' : 'Counterclockwise' }, icon('cw')),
      flip && h('span', { class: 'chip side', text: dark ? 'DARK' : 'LIGHT' }),
      v.stack > 0 && h('span', { class: 'chip stk', text: '+' + v.stack, title: 'Draw stack' })));
  $('#center').replaceChildren(dp, disc, ind);
}
function renderFeed(v) {
  $('#feed').replaceChildren(...v.events.slice(-6).map((e) => h('div', { class: 'ev', text: String(e.text) })));
}
function bannerInfo(v) {
  const pd = v.pending, who = v.players[v.actor] ? v.players[v.actor].name : '';
  if (v.phase !== 'play') return ['Round over', false];
  if (!human()) return [`Spectating — ${who} to act`, false];
  const my = v.actor === v.seat;
  if (pd && pd.type === 'doubt' && !my && pd.from !== v.seat) {
    return [`${v.players[pd.from].name} played face down, claiming ${LC.label(pd.claim)}. Think it’s a bluff?`, true];
  }
  if (my) {
    if (!pd) return [v.stack ? `Stack a draw card or take +${v.stack}` : 'Your turn', true];
    if (pd.type === 'drawn') return ['You drew a playable card: play it or keep it', true];
    if (pd.type === 'swap') return ['Pick a player to swap hands with', true];
    if (pd.type === 'place') return [`Call-Out: put a ${pd.color} card face down — any card if you have none (that’s a bluff)`, true];
    if (pd.type === 'callout') return [pd.shown.some(Boolean) ? 'Flip another card, or stop' : 'Tap a face-down card to flip it', true];
    return ['Make your choice', true];
  }
  if (pd && pd.type === 'place') return [pd.mine != null ? 'Your card is face down. Waiting for the others…' : `${who} is putting a card face down…`, false];
  if (pd && pd.type === 'callout') return [`${who} is flipping cards…`, false];
  return [`${who} is ${v.players[v.actor].bot ? 'thinking…' : 'playing'}`, false];
}
function renderDock(v) {
  const me = v.players[v.seat], pd = v.pending, my = mine(), hum = human();
  const drawn = my && pd && pd.type === 'drawn' && pd.p === v.seat;
  const [bt, hot] = bannerInfo(v);
  const banner = $('#banner');
  if (banner.textContent !== bt) banner.textContent = bt;
  banner.className = 'banner' + (hot ? ' hot' : '');

  const acts = [];
  if (drawn) {
    const dc = v.hand.find((c) => c.id === pd.id);
    acts.push(btn('Play it', () => { if (dc) playCard(dc); }, 'filled', { 'data-fk': 'a-play' }), btn('Keep', () => act({ type: 'keep' }), 'gray', { 'data-fk': 'a-keep' }));
  } else {
    acts.push(btn(v.stack > 0 ? `Take +${v.stack}` : 'Draw', () => act({ type: 'draw' }), 'filled', { disabled: !(my && !pd), 'data-fk': 'a-draw' }));
  }
  const canCall = v.phase === 'play' && hum && !me.out && me.count > 0 && me.count <= 2 && !me.called;
  acts.push(btn('LAST CARD!', () => act({ type: 'call' }), 'lc' + (my && me.count === 2 && canCall ? ' pulse' : ''), { disabled: !canCall, 'data-fk': 'a-call' }));
  const vul = v.vulnerable;
  if (v.phase === 'play' && hum && !me.out && vul !== null && vul !== v.seat) {
    acts.push(btn(`Catch ${v.players[vul].name}!`, () => act({ type: 'catch', target: vul }), 'danger-fill', { 'data-fk': 'a-catch' }));
  }
  if (v.phase === 'play' && hum && !me.out && pd && pd.type === 'doubt' && pd.from !== v.seat && pd.p !== v.seat) {
    acts.push(btn('Call the bluff!', () => act({ type: 'challenge' }), 'danger-fill', { 'data-fk': 'a-bluff' }));
  }
  if (my && pd && pd.type === 'callout' && pd.shown.some(Boolean)) acts.push(btn('Stop', () => act({ type: 'stop' }), 'tinted', { 'data-fk': 'a-stop' }));
  $('#actions').replaceChildren(...acts);

  // hand
  const wrap = $('#handwrap'), keep = wrap.scrollLeft;
  const placing = my && pd && pd.type === 'place' && pd.p === v.seat;
  const cards = sortedHand(v.hand, v.side).map((c) => {
    const can = my && (c.playable || placing);
    const placedDown = pd && pd.type === 'place' || pd && pd.type === 'callout' ? pd.mine === c.id : false;
    return cardEl(c.face, {
      tag: 'button', dark: v.side === 'dark', liar: c.liar,
      cls: (can ? 'play' : my ? 'dim' : '') + (drawn && pd.id === c.id ? ' hl' : '') + (c.liar ? ' liar' : '') + (placedDown ? ' placed' : ''),
      attrs: { 'aria-disabled': String(!can), 'data-fk': 'c' + c.id, onclick: () => onCard(c) },
    });
  });
  $('#hand').replaceChildren(...cards);
  wrap.scrollLeft = keep;
}
function renderGame() {
  const v = cv;
  document.body.classList.toggle('neon', v.side === 'dark');
  keepFocus(() => { renderBar(v); renderOpps(v); renderCenter(v); renderFeed(v); renderDock(v); });
  notify(v);
}
function notify(v) {
  const ev = v.events, maxN = ev.length ? ev[ev.length - 1].n : 0;
  if (lastN === null) { lastN = maxN; return; }
  if (maxN < lastN) lastN = 0;
  const fresh = ev.filter((e) => e.n > lastN);
  lastN = Math.max(lastN, maxN);
  fresh.filter((e) => BIG.has(e.type)).slice(-3).forEach((e) => toast(e.text));
}

// ---------- sheets ----------
function sheetNode(title, body, btns, wide) {
  return h('div', { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    h('div', { class: 'grabber', 'aria-hidden': 'true' }),
    h('h2', { id: 'sheet-title', class: 'sheet-title', text: title }),
    h('div', { class: 'sheet-body' }, body),
    btns && btns.length ? h('div', { class: 'sheet-btns' }, btns) : null);
}
function scoreList(v, withRound) {
  const lr = v.lastRound;
  const rows = v.players.map((pl, i) => {
    const d = lr && lr.detail.find((x) => x.p === i);
    const won = !!(lr && lr.winners.includes(i));
    return { i, pl, d, won };
  }).sort((a, b) => b.pl.score - a.pl.score);
  return h('div', { class: 'group scores' }, rows.map((r) => row(
    avatar(r.pl.name, r.i),
    h('span', { class: 'grow ell' }, r.pl.name + (r.pl.out ? ' (out)' : '') + (r.i === v.seat ? ' (you)' : '')),
    withRound && r.d ? h('span', { class: 'tag' + (r.won ? ' good' : ''), text: r.won ? `+${lr.points}` : `${r.d.pts} left` }) : null,
    h('b', { class: 'val', text: String(r.pl.score) }))));
}
function rulesBody() {
  const mode = cv ? cv.mode : (screen === 'setup' ? cfg.mode : 'classic');
  const order = [mode, 'common', ...MODES.map((m) => m[0]).filter((m) => m !== mode)];
  return order.map((k, i) => h('details', { class: 'det', open: i < 2 },
    h('summary', { text: k === 'common' ? 'The basics' : MNAME[k] }),
    HOW[k].map((t) => h('p', { text: t }))));
}
function infoSheetNode() {
  const close = btn('Close', closeInfo, 'filled', { 'data-first': '1' });
  if (infoSheet === 'rules') return sheetNode('How to play', rulesBody(), [close], true);
  if (infoSheet === 'scores' && cv) {
    return sheetNode('Scores', [h('p', { class: 'note', text: cv.target ? `First to ${cv.target} points wins.` : 'Single round.' }), scoreList(cv, false)], [close]);
  }
  if (infoSheet === 'leave') {
    const msg = role === 'host'
      ? (room && room.state ? 'This ends the game for everyone, including friends who joined.' : 'This closes the room and removes everyone who joined.')
      : role === 'player' ? 'You leave the room. Your seat will be played by a bot.' : 'Your progress in this game will be lost.';
    return sheetNode(role === 'host' ? 'Close the room?' : 'Leave this game?', h('p', { text: msg }), [
      btn(role === 'host' ? 'End game' : 'Leave', toHome, 'danger-fill', { 'data-first': '1' }),
      btn('Keep playing', closeInfo, 'gray')]);
  }
  return null;
}
function alertNode() {
  const a = alertUI;
  return sheetNode(a.title, h('p', { text: a.msg }), a.btns.map((b, i) => btn(b.label, b.fn, b.cls || 'gray', i === 0 ? { 'data-first': '1' } : null)));
}
function colorSheet(title, note) {
  return sheetNode(title, [note && h('p', { text: note }), h('div', { class: 'picks' }, LC.COLORS[cv.side].map((c) =>
    h('button', { type: 'button', class: 'cbtn c-' + c, 'aria-label': 'Choose ' + c, onclick: () => act({ type: 'color', color: c }) },
      h('span', { class: 'sw', 'aria-hidden': 'true' }), h('span', { text: cap(c) }))))], outOfTurnBtns());
}
function claimSheet(card) {
  const order = LC.COLORS.light.concat('wild');
  const claims = cv.claims, dark = cv.side === 'dark';
  let sel = claims.find((x) => x.c === card.face.c && x.v === card.face.v) || null;
  const items = [];
  const confirm = btn('Play face down', () => {
    if (!sel) return;
    const c = { c: sel.c, v: sel.v };
    if (act({ type: 'play', id: card.id, claim: c })) { claimUI = null; render(); }
  }, 'filled', { disabled: !sel });
  const sync = () => {
    items.forEach(([b, c]) => { const on = !!sel && sel.c === c.c && sel.v === c.v; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', String(on)); });
    confirm.disabled = !sel;
  };
  const groups = order.map((col) => {
    const list = claims.filter((x) => x.c === col);
    if (!list.length) return null;
    return h('div', { class: 'claimgrp' },
      h('span', { class: 'foot', text: col === 'wild' ? 'WILD' : col.toUpperCase() }),
      h('div', { class: 'claimrow' }, list.map((c) => {
        const b = cardEl(c, { tag: 'button', dark, cls: 'mini3', attrs: { 'aria-pressed': 'false', onclick: () => { sel = c; sync(); } } });
        items.push([b, c]);
        return b;
      })));
  });
  sync();
  return sheetNode('Play face down', [
    h('p', { text: `Your card: ${LC.label(card.face)}. Claim any card that fits the pile.` }),
    h('p', { class: 'note', text: 'If someone calls a wrong claim, they draw 1. If they catch your bluff, the card goes back to you plus 1 more card.' }),
    h('div', { class: 'claims' }, groups)],
  [confirm, btn('Cancel', () => { claimUI = null; render(); }, 'gray')], true);
}
function endSheet() {
  const v = cv, lr = v.lastRound;
  if (!lr) return null;
  const over = v.phase === 'gameOver';
  const names = lr.winners.map((i) => v.players[i].name).join(' & ');
  const multi = lr.winners.length > 1;
  const title = over ? `${names} ${multi ? 'win' : 'wins'} the game!` : `Round ${v.round} over`;
  const msg = over
    ? `${v.players[v.winner].name} reaches ${v.players[v.winner].score} points.`
    : `${names} ${multi ? 'win' : 'wins'} the round and ${multi ? 'each score' : 'scores'} ${lr.points} points.`;
  const btns = [];
  if (role === 'player') {
    btns.push(h('p', { class: 'waiting', role: 'status', text: 'Waiting for the host…' }), btn('Leave', () => openInfo('leave'), 'gray', { 'data-first': '1' }));
  } else if (over) {
    btns.push(btn('Play again', () => { if (settled()) { claimUI = null; room.restart(); } }, 'filled', { 'data-first': '1' }), btn('Home', toHome, 'gray'));
  } else {
    btns.push(btn('Next round', () => { if (settled()) room.nextRound(); }, 'filled', { 'data-first': '1' }));
  }
  return sheetNode(title, [h('p', { text: msg }), scoreList(v, true)], btns);
}
function outOfTurnBtns() {
  const v = cv, me = v.players[v.seat], out = [], vul = v.vulnerable;
  if (v.phase !== 'play' || !human() || me.out) return out;
  // the open sheet is not rebuilt for these, so a used button disables itself
  const once = (a) => (e) => { const b = e.currentTarget; if (act(a)) b.disabled = true; };
  if (me.count > 0 && me.count <= 2 && !me.called) out.push(btn('LAST CARD!', once({ type: 'call' }), 'lc'));
  if (vul !== null && vul !== undefined && vul !== v.seat) out.push(btn(`Catch ${v.players[vul].name}!`, once({ type: 'catch', target: vul }), 'danger-fill'));
  return out;
}
function decisionSheet() {
  const v = cv, pd = v.pending;
  if (!pd || !mine()) return null;
  if (pd.type === 'color') {
    return { key: `color|${pd.reveal ? 1 : 0}`, node: () => colorSheet(pd.reveal ? 'The flip revealed a Wild: choose a color' : 'Choose a color') };
  }
  if (pd.type === 'roulette') {
    return { key: 'roulette|' + pd.from, node: () => colorSheet('Color Roulette', 'Pick a color. You flip cards until it shows up, and keep them all.') };
  }
  if (pd.type === 'challenge') {
    return {
      key: `challenge|${pd.from}|${pd.v}`,
      node: () => {
        const pen = pd.v === 'wdc' ? `draw until you find ${v.color}` : `draw ${{ wd4: 4, wd2: 2 }[pd.v] || 0}`;
        return sheetNode(`${v.players[pd.from].name} played ${LC.NAMES[pd.v] || 'a Wild'}`, [
          h('p', { text: `Accept: you ${pen} and lose your turn.` }),
          h('p', { text: 'Challenge: you win if they held a card of the previous color, and they draw instead. If the challenge fails, you draw 2 extra.' })],
        [btn('Challenge', () => act({ type: 'challenge' }), 'filled', { 'data-first': '1' }), btn('Accept', () => act({ type: 'accept' }), 'gray')].concat(outOfTurnBtns()));
      },
    };
  }
  if (pd.type === 'doubt') {
    return {
      key: `doubt|${pd.from}|${pd.id}`,
      node: () => sheetNode(`${v.players[pd.from].name} played a card face down claiming ${LC.label(pd.claim)}`, [
        h('p', { text: 'Call the bluff: if the card is not what they claim, it goes back to them and they draw 1 more. If you are wrong, you draw 1.' }),
        pd.final ? h('p', { class: 'note', text: 'This was their last card. If it stands, they go out.' }) : null],
      [btn('Let it stand', () => act({ type: 'accept' }), 'gray', { 'data-first': '1' }), btn('Call the bluff', () => act({ type: 'challenge' }), 'danger-fill')].concat(outOfTurnBtns())),
    };
  }
  return null;
}
// What sheet (if any) should be showing, by identity, so an open sheet is never rebuilt by a plain re-render.
function wantSheet() {
  if (alertUI) return { key: 'alert' + alertUI.n, node: alertNode };
  if (infoSheet) {
    const k = 'info:' + infoSheet;
    if (infoSheet !== 'rules' && infoSheet !== 'leave' && !cv) { infoSheet = null; } else return { key: k, node: infoSheetNode, esc: closeInfo };
  }
  if (screen !== 'game' || !cv) return null;
  if (claimUI && !(mine() && cv.claims && cv.hand.some((c) => c.id === claimUI.id))) claimUI = null;
  if (claimUI) {
    const card = cv.hand.find((c) => c.id === claimUI.id);
    return { key: 'claim:' + card.id, node: () => claimSheet(card), esc: () => { claimUI = null; render(); } };
  }
  if (cv.phase !== 'play') return { key: `end:${cv.round}:${cv.phase}`, node: endSheet };
  const d = decisionSheet();
  return d ? { key: 'dec:' + d.key, node: d.node } : null;
}
function renderSheets() {
  const w = wantSheet(), root = $('#sheets');
  const key = w ? w.key : '';
  if (key === sheetKey) return;
  const had = sheetKey !== '';
  sheetKey = key;
  if (!w) {
    root.replaceChildren();
    root.hidden = true;
    syncInert();
    if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') prevFocus.focus({ preventScroll: true });
    else if (!$('#cover').hidden) { const b = $('#cover').querySelector('[data-first]'); if (b) b.focus({ preventScroll: true }); }
    else fallbackFocus();
    prevFocus = null;
    return;
  }
  const node = w.node();
  if (!node) { sheetKey = ''; root.replaceChildren(); root.hidden = true; return; }
  if (!had) prevFocus = document.activeElement;
  const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim && w.esc) w.esc(); } }, node);
  root.replaceChildren(scrim);
  root.hidden = false;
  const first = node.querySelector('[data-first]') || node.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const w = wantSheet();
  if (w && w.esc) w.esc();
});

// ---------- pass-and-play cover ----------
function renderCover() {
  const c = $('#cover');
  const need = screen === 'game' && role === 'local' && !!cv && cv.phase === 'play' && localHumans().length >= 2 &&
    room.seats[cv.actor] && room.seats[cv.actor].kind === 'local' && cv.actor !== viewer;
  if (!need) {
    if (!c.hidden) {
      const a = document.activeElement;
      c.hidden = true; c.replaceChildren();
      syncInert();
      if (!a || !a.isConnected || a === document.body) fallbackFocus();
    }
    coverKey = '';
    return;
  }
  const a = cv.actor, vul = cv.vulnerable === viewer;
  const key = `${a}|${vul}|${viewer}`;
  if (key === coverKey && !c.hidden) return;
  coverKey = key;
  const nm = room.seats[a].name;
  const kids = [
    h('h2', { class: 'title', text: `Pass the device to ${nm}` }),
    h('p', { text: 'Hand it over without showing your cards.' }),
    btn(`I’m ${nm}`, () => { if (settled()) { viewer = a; render(); } }, 'filled', { 'data-first': '1' })];
  if (vul) kids.push(btn(`${room.seats[viewer].name}: LAST CARD!`, () => act({ type: 'call' }), 'lc'));
  c.replaceChildren(h('div', { class: 'cover-in' }, kids));
  c.hidden = false;
  const b = c.querySelector('[data-first]');
  if (b) b.focus({ preventScroll: true });
}
function syncInert() {
  const blocked = !$('#sheets').hidden || !$('#cover').hidden;
  $('#table').inert = blocked;
  $('#app').inert = blocked;
}

// ---------- main render ----------
function currentView() {
  if (role === 'player') return pview;
  return room && room.state ? room.view(viewer) : null;
}
function render() {
  cv = screen === 'game' ? currentView() : null;
  const g = screen === 'game' && !!cv;
  $('#table').hidden = !g;
  $('#app').hidden = g;
  if (g) renderGame();
  else {
    document.body.classList.remove('neon');
    if (screen === 'game') screen = role === 'player' && lobbyData ? 'wait' : 'home';
    renderApp();
  }
  renderCover();
  renderSheets();
  syncInert();
}

// ---------- boot ----------
function fromHash() {
  const m = /^#join=([A-Za-z0-9]{1,12})$/.exec(location.hash || '');
  if (!m) return false;
  joinCode = m[1].toUpperCase().slice(0, 6);
  return true;
}
window.addEventListener('hashchange', () => { if (fromHash() && (screen === 'home' || screen === 'join')) go('join'); });
if (fromHash()) screen = 'join';
render();
})();
