/*
 * Last Card — online transport over WebRTC using PeerJS (loaded from jsDelivr with Subresource Integrity).
 * The host's browser registers the room id `lastcard-v1-<CODE>` with the free public PeerJS signalling server;
 * players connect straight to the host's browser over a data channel (PeerJS's TURN relay steps in when a direct
 * route is impossible). Only JSON text moves through here; room.js decides what it means and checks all of it.
 *
 *   const h = LastCardNet.host({ onReady(code), onOpen(id), onMessage(id, text), onClose(id), onError(err) })
 *     h.code, h.send(id, text), h.drop(id), h.destroy()
 *   const j = LastCardNet.join(code, { onOpen(), onMessage(text), onClose(), onError(err) })
 *     j.send(text), j.leave()
 *   LastCardNet.validCode(code), LastCardNet.available()
 */
(function (root) {
  'use strict';
  const PREFIX = 'lastcard-v1-', ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
  const MAX_IN_HOST = 4096, MAX_IN_PLAYER = 256 * 1024, MAX_CONNS = 24, JOIN_TIMEOUT = 20000;
  // Public STUN servers let players find a direct route to each other through home routers. There is no free public
  // TURN relay any more, so a few very strict networks (some mobile carriers, offices) cannot connect; to cover them,
  // add your own TURN server here: { urls: 'turn:host:3478', username: '…', credential: '…' }.
  const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }] };
  const PeerCtor = () => root.Peer || (root.peerjs && root.peerjs.Peer) || null;

  function newCode() {
    let out = '';
    while (out.length < 6) {
      const b = new Uint8Array(12);
      root.crypto.getRandomValues(b);
      for (const x of b) if (x < 248 && out.length < 6) out += ALPHABET[x % 31]; // 248 = 8 * 31: no modulo bias
    }
    return out;
  }
  const validCode = (c) => typeof c === 'string' && /^[A-HJKMNP-Z2-9]{6}$/.test(c);
  const friendly = (e) => {
    const t = e && e.type;
    if (t === 'peer-unavailable') return 'No game with that code is open. Check the code, and keep the host\'s page open.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Can\'t reach the online service. Check your internet connection.';
    if (t === 'browser-incompatible') return 'This browser can\'t play online. Try a recent Safari, Chrome, Edge or Firefox.';
    return (e && e.message) || 'Connection problem';
  };

  function host(h) {
    const P = PeerCtor();
    if (!P) { h.onError(new Error('Online play could not load. Check your connection and reload.')); return null; }
    const conns = new Map(), pending = new Set(); // open data channels; ones still negotiating
    let peer = null, code = null, dead = false, tries = 0;
    function open() {
      code = newCode();
      const p = (peer = new P(PREFIX + code, { debug: 0, config: ICE }));
      p.on('open', () => { if (!dead && p === peer) h.onReady(code); });
      p.on('connection', (c) => {
        // half-open connections count too, so a stream of offers cannot pile up peer connections
        if (dead || conns.size + pending.size >= MAX_CONNS || c.serialization !== 'raw') { c.close(); return; }
        const id = c.connectionId;
        pending.add(c);
        const t = setTimeout(() => { if (pending.delete(c)) c.close(); }, JOIN_TIMEOUT);
        c.on('open', () => {
          clearTimeout(t);
          pending.delete(c);
          if (dead) { c.close(); return; }
          conns.set(id, c);
          h.onOpen(id);
        });
        c.on('data', (d) => { if (typeof d === 'string' && d.length <= MAX_IN_HOST) h.onMessage(id, d); });
        const gone = () => { clearTimeout(t); pending.delete(c); if (conns.delete(id)) h.onClose(id); };
        c.on('close', gone);
        c.on('error', gone);
      });
      // Losing the signalling server does not drop players already connected; re-register so new ones can join.
      p.on('disconnected', () => { if (!dead && p === peer && !p.destroyed) p.reconnect(); });
      p.on('error', (e) => {
        if (p !== peer) return; // a peer we already replaced
        if (e.type === 'unavailable-id' && ++tries < 5) { p.destroy(); return open(); } // code taken: pick another
        if (e.type !== 'peer-unavailable') h.onError(new Error(friendly(e)));
      });
    }
    open();
    return {
      get code() { return code; },
      send(id, text) { const c = conns.get(id); if (c && c.open) c.send(text); },
      drop(id) { const c = conns.get(id); if (c) { conns.delete(id); c.close(); } },
      destroy() { dead = true; conns.forEach((c) => c.close()); conns.clear(); if (peer) peer.destroy(); },
    };
  }

  function join(code, h) {
    const P = PeerCtor();
    if (!P) { h.onError(new Error('Online play could not load. Check your connection and reload.')); return null; }
    if (!validCode(code)) { h.onError(new Error('Room codes are 6 letters and numbers.')); return null; }
    const peer = new P({ debug: 0, config: ICE });
    let conn = null, left = false, opened = false;
    const timer = setTimeout(() => { if (!opened && !left) { h.onError(new Error('Couldn\'t reach the host. Check the code and try again.')); stop(); } }, JOIN_TIMEOUT);
    function stop() { left = true; clearTimeout(timer); peer.destroy(); }
    peer.on('open', () => {
      conn = peer.connect(PREFIX + code, { serialization: 'raw', reliable: true });
      conn.on('open', () => { opened = true; clearTimeout(timer); h.onOpen(); });
      conn.on('data', (d) => { if (typeof d === 'string' && d.length <= MAX_IN_PLAYER) h.onMessage(d); });
      conn.on('close', () => { if (!left) { stop(); h.onClose(); } });
      conn.on('error', () => { if (!left) { stop(); h.onClose(); } });
    });
    peer.on('disconnected', () => { if (!left && !peer.destroyed && !opened) peer.reconnect(); });
    peer.on('error', (e) => { if (!left) { stop(); h.onError(new Error(friendly(e))); } });
    return {
      send(text) { if (conn && conn.open) conn.send(text); },
      leave() { if (!left) stop(); },
    };
  }

  root.LastCardNet = { host, join, validCode, available: () => !!PeerCtor() };
})(typeof globalThis !== 'undefined' ? globalThis : this);
