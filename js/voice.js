// Chess Complex 10.2 - opt-in voice chat between the human players in a room.
// Push to talk by default (optional open mic), never on until the player taps Join Voice.
// Topology: a small full mesh. Each device that opts in opens its own media peer (separate from the
// game data connection, so voice can fail without touching the match), tells the host its voice id,
// and the host shares the roster of human voice ids. The device with the larger id dials; calls from
// ids that are not on the host's roster are refused.
// Transports: PeerJS media calls online; with ?net=local a raw RTCPeerConnection signalled over a
// BroadcastChannel, so two tabs on one machine exercise the real media path offline.
//
// Wire (client <-> host, over the existing data connection):
//   { t: 'vc', a: 'join', vid }  { t: 'vc', a: 'leave' }  { t: 'vc', a: 'talk', on: 0|1 }
//   host -> all: { t: 'vc', a: 'roster', list: [{ pid, vid }] }  { t: 'vc', a: 'talk', pid, on }
import { music } from './music.js';
import { buses, settings } from './audio.js';
import { PEER_OPTS } from './net.js';

const VID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_MEMBERS = 8;
const useLocal = () => new URLSearchParams(location.search).get('net') === 'local';
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0h-2a4 4 0 0 1-8 0zM11 18h2v3h-2z"/></svg>';

// ---------------------------------------------------------------- transports
// T = { id, onCall(cb), call(remoteId, stream) -> C, close() }   C = { peer, answer(stream), onStream(cb), onClose(cb), close() }
function peerTransport() {
  return new Promise((res, rej) => {
    if (!window.Peer) { rej(new Error('no-peer')); return; }
    const peer = new window.Peer(PEER_OPTS); let done = false;
    const to = setTimeout(() => { if (!done) { done = true; try { peer.destroy(); } catch {} rej(new Error('timeout')); } }, 12000);
    const wrap = (c) => {
      const C = { peer: c.peer, _s: [], _c: [], answer: (s) => c.answer(s), onStream(f) { this._s.push(f); }, onClose(f) { this._c.push(f); }, close() { try { c.close(); } catch {} } };
      let closed = false; const fin = () => { if (closed) return; closed = true; C._c.forEach((f) => f()); };
      c.on('stream', (s) => C._s.forEach((f) => f(s))); c.on('close', fin); c.on('error', fin);
      const watch = () => { const pc = c.peerConnection; if (!pc) return setTimeout(watch, 300); pc.addEventListener('iceconnectionstatechange', () => { if (['failed', 'closed'].includes(pc.iceConnectionState)) fin(); }); };
      watch();
      return C;
    };
    const T = { id: null, _on: null, onCall(f) { this._on = f; }, call: (id, s) => wrap(peer.call(id, s)), close: () => { try { peer.destroy(); } catch {} } };
    peer.on('open', (id) => { if (done) return; done = true; clearTimeout(to); T.id = id; res(T); });
    peer.on('call', (c) => { if (T._on) T._on(wrap(c)); else c.close(); });
    peer.on('error', (e) => { if (!done) { done = true; clearTimeout(to); rej(e); } });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
  });
}
function localTransport(code) {
  const bc = new BroadcastChannel('ccv-' + code); const id = 'lv' + Math.random().toString(36).slice(2, 12);
  const pcs = new Map(); // remote id -> { pc, C, q }
  const post = (to, kind, data) => { try { bc.postMessage({ to, from: id, kind, data }); } catch {} };
  const make = (remote) => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const C = { peer: remote, _s: [], _c: [], onStream(f) { this._s.push(f); }, onClose(f) { this._c.push(f); }, close() { post(remote, 'hang'); fin(); }, answer: null };
    let closed = false; const fin = () => { if (closed) return; closed = true; try { pc.close(); } catch {} pcs.delete(remote); C._c.forEach((f) => f()); };
    C._fin = fin;
    pc.onicecandidate = (e) => { if (e.candidate) post(remote, 'ice', e.candidate.toJSON()); };
    pc.ontrack = (e) => { const s = e.streams[0] || new MediaStream([e.track]); C._s.forEach((f) => f(s)); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) fin(); };
    const ent = { pc, C, q: [], ready: false }; pcs.set(remote, ent);
    return ent;
  };
  const flush = async (ent) => { ent.ready = true; for (const c of ent.q.splice(0)) try { await ent.pc.addIceCandidate(c); } catch {} };
  const T = { id, _on: null, onCall(f) { this._on = f; },
    call(remote, stream) {
      const ent = make(remote);
      for (const t of stream.getTracks()) ent.pc.addTrack(t, stream);
      (async () => { try { const o = await ent.pc.createOffer(); await ent.pc.setLocalDescription(o); post(remote, 'offer', { type: o.type, sdp: o.sdp }); } catch { ent.C._fin(); } })();
      return ent.C;
    },
    close() { for (const [r, e] of pcs) { post(r, 'hang'); e.C._fin(); } try { bc.close(); } catch {} } };
  bc.onmessage = async ({ data: m }) => {
    if (!m || m.to !== id || typeof m.from !== 'string') return;
    const ent = pcs.get(m.from);
    try {
      if (m.kind === 'offer') {
        if (ent) ent.C._fin();
        const e2 = make(m.from);
        e2.C.answer = async (stream) => {
          try {
            await e2.pc.setRemoteDescription(m.data); await flush(e2); // remote first, so our track reuses the offered transceiver
            if (stream) for (const t of stream.getTracks()) e2.pc.addTrack(t, stream);
            const a = await e2.pc.createAnswer(); await e2.pc.setLocalDescription(a); post(m.from, 'answer', { type: a.type, sdp: a.sdp });
          } catch { e2.C._fin(); }
        };
        if (T._on) T._on(e2.C); else e2.C.close();
      } else if (m.kind === 'answer' && ent) { await ent.pc.setRemoteDescription(m.data); await flush(ent); }
      else if (m.kind === 'ice' && ent) { if (ent.ready) await ent.pc.addIceCandidate(m.data); else ent.q.push(m.data); }
      else if (m.kind === 'hang' && ent) ent.C._fin();
    } catch {}
  };
  return Promise.resolve(T);
}

// ---------------------------------------------------------------- host side (authoritative roster)
function hostSend(sess, m, self) { for (const c of sess.conns ? sess.conns.values() : []) c.send(m); if (self) self.onMsg(m); }
function rosterMsg(sess) { return { t: 'vc', a: 'roster', list: [...(sess.vc || new Map())].map(([pid, vid]) => ({ pid, vid })) }; }

class Voice {
  constructor() {
    this.state = 'off'; this.roster = new Map(); this.calls = new Map(); this.mutedV = new Set(); this.vol = {}; this.flag = new Map();
    this.speaking = new Set(); this.open = false; this.ptt = false; this.listenOnly = false; this.sess = null; this.T = null; this.mic = null; this.ac = null; this.ducked = false; this.err = '';
    this.stats = { calls: 0, streams: 0, refused: 0, drops: 0 }; this.tries = {};
  }
  // deps: { session(), toast(msg), game, sfx, screen(), names() -> {pid: name} }
  mount(deps) {
    this.d = deps;
    const wrap = $('.emote-wrap');
    if (wrap && !$('#vc-ptt')) {
      const b = el('button', 'icon-btn vc-ptt hidden'); b.id = 'vc-ptt'; b.innerHTML = MIC_SVG; b.setAttribute('aria-label', 'Hold to talk');
      const btn = wrap.querySelector('.emote-btn'); btn.after(b); this.pttBtn = b; this.bindHold(b);
    }
    for (const [sel, id] of [['#s-host .scroll', 'vc-host'], ['#join-lobby-panel', 'vc-join']]) {
      const host = $(sel); if (!host || $('#' + id)) continue;
      const p = el('div', 'panel vc-panel'); p.id = id;
      if (id === 'vc-host') { const start = $('#btn-start-host'); host.insertBefore(p, start); } else host.appendChild(p);
      p.addEventListener('click', (e) => { const b = e.target.closest('[data-vc]'); if (b) this.onControl(b.dataset.vc, b.dataset.pid); });
      p.addEventListener('input', (e) => { const r = e.target.closest('[data-vol]'); if (r) this.setVolume(r.dataset.vol, +r.value); });
    }
    addEventListener('keydown', (e) => { if (e.key === 'v' && !e.repeat && !/INPUT|TEXTAREA/.test((e.target && e.target.tagName) || '') && this.state === 'on' && !this.open) this.setPtt(true); });
    addEventListener('keyup', (e) => { if (e.key === 'v') this.setPtt(false); });
    addEventListener('blur', () => this.setPtt(false));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.setPtt(false); });
    this.loop = setInterval(() => this.tick(), 100);
    this.renderLobby();
  }
  bindHold(b) {
    const down = (e) => { e.preventDefault(); if (this.state !== 'on' || this.listenOnly) return; if (this.open) { this.setOpen(false); return; } try { b.setPointerCapture(e.pointerId); } catch {} this.setPtt(true); };
    const up = () => { if (!this.open) this.setPtt(false); };
    b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  online() { const s = this.d && this.d.session(); return !!(s && (s.mode === 'host' || s.mode === 'client')); }
  send(m) {
    const s = this.sess; if (!s || this.d.session() !== s) return;
    if (s.mode === 'host') this.hostMsg(s, 'me', m); else if (s.client) s.client.send({ t: 'vc', ...m });
  }

  // ---- host: validate everything a client sends
  hostMsg(sess, pid, m) {
    if (!m || typeof m !== 'object' || typeof m.a !== 'string') return;
    const human = pid === 'me' || (sess.conns && sess.conns.has(pid) && (sess.players || []).some((p) => p.pid === pid && !p.isBot));
    if (!human) return;
    sess.vc = sess.vc || new Map();
    if (m.a === 'join') {
      if (typeof m.vid !== 'string' || !VID_RE.test(m.vid)) return;
      if ([...sess.vc].some(([p, v]) => v === m.vid && p !== pid)) return;
      if (!sess.vc.has(pid) && sess.vc.size >= MAX_MEMBERS) return;
      sess.vc.set(pid, m.vid); hostSend(sess, rosterMsg(sess), this);
    } else if (m.a === 'leave') { if (sess.vc.delete(pid)) hostSend(sess, rosterMsg(sess), this); }
    else if (m.a === 'talk') {
      if (!sess.vc.has(pid)) return;
      const rl = (sess.vcRL ||= {}); const now = Date.now(), st = rl[pid] || (rl[pid] = { n: 6, at: now });
      st.n = Math.min(6, st.n + (now - st.at) / 250); st.at = now; if (st.n < 1) return; st.n -= 1;
      hostSend(sess, { t: 'vc', a: 'talk', pid, on: m.on ? 1 : 0 }, this);
    }
  }
  hostDrop(sess, pid) { if (sess && sess.vc && sess.vc.delete(pid)) hostSend(sess, rosterMsg(sess), this); }
  hostSync(sess) { if (sess && sess.vc && sess.vc.size) hostSend(sess, rosterMsg(sess), null); }

  // ---- every device: roster and talk flags from the host
  onMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (m.a === 'roster' && Array.isArray(m.list)) {
      const r = new Map();
      for (const e of m.list.slice(0, MAX_MEMBERS)) if (e && typeof e.pid === 'string' && e.pid.length <= 40 && typeof e.vid === 'string' && VID_RE.test(e.vid)) r.set(e.pid, e.vid);
      this.roster = r; this.rosterSess = this.d && this.d.session();
      for (const pid of [...this.flag.keys()]) if (!r.has(pid)) this.flag.delete(pid);
      this.reconcile(); this.changed();
    } else if (m.a === 'talk' && typeof m.pid === 'string') {
      if (!this.roster.has(m.pid)) return;
      if (m.on) this.flag.set(m.pid, Date.now()); else this.flag.delete(m.pid);
    }
  }

  // ---- opting in
  async start() {
    if (this.state !== 'off' || !this.online()) return;
    const sess = this.d.session(); this.sess = sess; this.state = 'starting'; this.err = ''; this.listenOnly = false; this.changed();
    const AC = window.AudioContext || window.webkitAudioContext;
    try { this.ac = AC ? new AC() : null; if (this.ac && this.ac.state === 'suspended') this.ac.resume().catch(() => {}); } catch { this.ac = null; }
    let mic = null;
    try { mic = await getMic(); }
    catch (e) {
      this.listenOnly = true; this.errName = (e && e.name) || 'Error';
      this.err = micHelp(e);
      this.d.toast(micShort(e));
    }
    if (this.d.session() !== sess || this.state !== 'starting') { if (mic) mic.getTracks().forEach((t) => t.stop()); return; }
    if (mic) { this.mic = mic; for (const t of mic.getAudioTracks()) { t.enabled = false; t.onended = () => { if (this.state === 'on') { this.listenOnly = true; this.err = 'Microphone disconnected. You can still listen.'; this.d.toast(this.err); this.changed(); } }; } }
    this.out = this.mic || this.silent();
    if (this.ac && this.mic) { try { const src = this.ac.createMediaStreamSource(this.mic); this.myAn = this.ac.createAnalyser(); this.myAn.fftSize = 512; src.connect(this.myAn); } catch {} }
    try { this.T = await (useLocal() ? localTransport(sess.code) : peerTransport()); }
    catch { this.d.toast('Voice could not connect. The match is not affected.'); this.stop(true); return; }
    if (this.d.session() !== sess || this.state !== 'starting') { try { this.T.close(); } catch {} return; }
    this.T.onCall((C) => this.incoming(C));
    this.myVid = this.T.id; this.state = 'on'; this.open = false; this.ptt = false;
    this.send({ a: 'join', vid: this.myVid });
    this.changed(); this.d.sfx && this.d.sfx.select && this.d.sfx.select();
  }
  // Ask again from a tap (the browser shows its permission prompt only in response to a user gesture), then swap the
  // live mic into every open call without reconnecting.
  async retryMic() {
    if (this.state !== 'on' || !this.listenOnly) return;
    let mic;
    try { mic = await getMic(); }
    catch (e) { this.errName = (e && e.name) || 'Error'; this.err = micHelp(e); this.d.toast(micShort(e)); this.changed(); return; }
    if (this.state !== 'on') { mic.getTracks().forEach((t) => t.stop()); return; }
    this.mic = mic; this.listenOnly = false; this.err = '';
    const track = mic.getAudioTracks()[0];
    for (const t of mic.getAudioTracks()) { t.enabled = false; t.onended = () => { if (this.state === 'on') { this.listenOnly = true; this.err = 'Microphone disconnected. You can still listen.'; this.d.toast(this.err); this.changed(); } }; }
    if (this.ac) { try { const src = this.ac.createMediaStreamSource(mic); this.myAn = this.ac.createAnalyser(); this.myAn.fftSize = 512; src.connect(this.myAn); } catch {} }
    const old = this.out; this.out = mic;
    for (const ent of this.calls.values()) {
      const pc = ent.C && (ent.C.peerConnection || (ent.C.raw && ent.C.raw.peerConnection));
      let swapped = false;
      if (pc && pc.getSenders) for (const snd of pc.getSenders()) if (!snd.track || snd.track.kind === 'audio') { try { snd.replaceTrack(track); swapped = true; } catch {} }
      if (!swapped) this.drop(ent.vid, true); // no sender to swap: redial with the mic
    }
    if (old && old !== mic) try { old.getTracks().forEach((t) => t.stop()); } catch {}
    this.reconcile(); this.d.toast('Microphone on. Hold Talk to speak.'); this.d.sfx && this.d.sfx.select && this.d.sfx.select(); this.changed();
  }
  silent() {
    try { if (this.ac) { const d = this.ac.createMediaStreamDestination(); return d.stream; } } catch {}
    return new MediaStream();
  }
  stop(quiet) {
    if (this.state === 'off') return;
    if (!quiet) this.send({ a: 'leave' });
    this.state = 'off'; this.ptt = false; this.open = false;
    for (const vid of [...this.calls.keys()]) this.drop(vid, true);
    try { this.T && this.T.close(); } catch {} this.T = null;
    if (this.mic) this.mic.getTracks().forEach((t) => t.stop()); this.mic = null; this.out = null; this.myAn = null;
    try { this.ac && this.ac.close(); } catch {} this.ac = null;
    this.myVid = null; this.flag.clear(); this.unduck(); this.sess = null; this.tries = {}; this.myOn = false;
    this.speaking.clear(); this.changed();
  }

  // ---- mesh
  pidOf(vid) { for (const [p, v] of this.roster) if (v === vid) return p; return null; }
  inRoster() { return this.myVid && [...this.roster.values()].includes(this.myVid); }
  reconcile() {
    if (this.state !== 'on' || !this.T) return;
    const vids = new Set(this.roster.values());
    for (const vid of [...this.calls.keys()]) if (!vids.has(vid)) this.drop(vid);
    if (!this.inRoster()) return;
    for (const [pid, vid] of this.roster) if (vid !== this.myVid && !this.calls.has(vid) && this.myVid > vid) this.dial(pid, vid);
  }
  dial(pid, vid) {
    const C = this.T.call(vid, this.out); this.stats.calls++;
    this.setup(C, pid, vid, true);
  }
  incoming(C) {
    const vid = C.peer, pid = this.pidOf(vid);
    if (this.state !== 'on' || !pid || !this.inRoster() || vid === this.myVid) { this.stats.refused++; try { C.close(); } catch {} return; }
    if (this.calls.has(vid)) this.drop(vid, true);
    this.setup(C, pid, vid, false); C.answer(this.out);
  }
  setup(C, pid, vid, outgoing) {
    const ent = { C, pid, vid, outgoing, at: Date.now() };
    this.calls.set(vid, ent);
    C.onStream((s) => { this.tries[vid] = 0; this.addRemote(ent, s); });
    const lost = () => {
      if (this.calls.get(vid) !== ent) return;
      this.drop(vid, true); this.stats.drops++;
      // the dialling side retries a few times (callee not on the roster yet, a dropped peer that is still listed)
      const n = (this.tries[vid] = (this.tries[vid] || 0) + 1);
      if (outgoing && this.state === 'on' && this.roster.get(pid) === vid && n <= 4) setTimeout(() => { if (!this.calls.has(vid)) this.reconcile(); }, 1200 * n);
      this.changed();
    };
    C.onClose(lost);
    if (outgoing) setTimeout(() => { if (this.calls.get(vid) === ent && !ent.stream) { try { C.close(); } catch {} lost(); } }, 10000);
  }
  addRemote(ent, stream) {
    if (ent.stream === stream) return; ent.stream = stream; this.stats.streams++;
    const a = el('audio'); a.autoplay = true; a.setAttribute('playsinline', ''); a.srcObject = stream; a.className = 'vc-audio';
    (this.box || (this.box = document.body.appendChild(Object.assign(el('div'), { hidden: true, id: 'vc-audio' })))).appendChild(a);
    ent.el = a;
    if (this.ac) {
      try {
        // Chrome only pulls remote WebRTC audio into Web Audio when the stream is also attached to a media element
        a.muted = true;
        const src = this.ac.createMediaStreamSource(stream); ent.gain = this.ac.createGain(); ent.an = this.ac.createAnalyser(); ent.an.fftSize = 512;
        src.connect(ent.an); src.connect(ent.gain); ent.gain.connect(this.ac.destination);
      } catch { a.muted = false; ent.gain = null; }
    }
    this.applyVol(ent.pid);
    a.play().catch(() => {});
    this.changed();
  }
  drop(vid, quiet) {
    const ent = this.calls.get(vid); if (!ent) return;
    this.calls.delete(vid);
    if (!quiet) try { ent.C.close(); } catch {}
    try { ent.gain && ent.gain.disconnect(); } catch {}
    if (ent.el) { ent.el.srcObject = null; ent.el.remove(); }
    this.speaking.delete(ent.pid);
  }

  // ---- talking
  setPtt(on) {
    if (this.open) return;
    on = !!on && this.state === 'on' && !this.listenOnly;
    if (on === this.ptt) return;
    this.ptt = on; this.applyMic();
    this.send({ a: 'talk', on: on ? 1 : 0 });
    if (on && this.d.sfx && this.d.sfx.tap) this.d.sfx.tap();
    this.changed();
  }
  setOpen(on) {
    if (this.state !== 'on' || this.listenOnly) return;
    this.open = !!on; this.ptt = false; this.applyMic();
    if (!this.open) this.send({ a: 'talk', on: 0 });
    this.d.toast(this.open ? 'Open mic on: everyone in voice can hear you' : 'Open mic off: hold the mic button to talk');
    this.changed();
  }
  applyMic() { if (this.mic) for (const t of this.mic.getAudioTracks()) t.enabled = this.open || this.ptt; }
  level(an) { if (!an) return 0; const b = this._buf || (this._buf = new Float32Array(512)); an.getFloatTimeDomainData(b); let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); }
  setVolume(pid, v) { this.vol[pid] = Math.max(0, Math.min(1, +v || 0)); this.applyVol(pid); }
  applyVol(pid) {
    const v = this.mutedV.has(pid) ? 0 : (this.vol[pid] ?? 1);
    for (const e of this.calls.values()) if (e.pid === pid) { if (e.gain) e.gain.gain.value = v * 1.4; else if (e.el) { e.el.muted = v === 0; try { e.el.volume = v; } catch {} } }
  }
  toggleMute(pid) { if (this.mutedV.has(pid)) this.mutedV.delete(pid); else this.mutedV.add(pid); this.applyVol(pid); this.changed(); }

  tick() {
    if (this.sess && this.d.session() !== this.sess) this.stop(true);
    if (this.rosterSess && this.d.session() !== this.rosterSess) { this.rosterSess = null; this.roster = new Map(); this.mutedV.clear(); this.vol = {}; this.flag.clear(); this.changed(); }
    const now = Date.now(), sp = new Set();
    if (this.state === 'on') {
      for (const e of this.calls.values()) {
        if (this.mutedV.has(e.pid)) continue;
        const lv = this.level(e.an); if (lv > 0.01) e.hot = now;
        if (now - (e.hot || 0) < 350 || this.flag.has(e.pid)) sp.add(e.pid);
      }
      for (const [pid, t] of this.flag) if (now - t > 30000) this.flag.delete(pid); // a lost talk-off never sticks
      const me = this.sess && this.sess.myPid;
      if (this.open && this.myAn) { const lv = this.level(this.myAn); if (lv > 0.012) this.myHot = now; const on = now - (this.myHot || 0) < 600; if (on !== this.myOn) { this.myOn = on; this.send({ a: 'talk', on: on ? 1 : 0 }); } if (on && me) sp.add(me); }
      else if (this.ptt && me) sp.add(me);
    }
    const others = [...sp].some((p) => !this.sess || p !== this.sess.myPid);
    if (others) this.duck(); else this.unduck();
    const key = [...sp].sort().join(',');
    if (key !== this.spKey) { this.spKey = key; this.speaking = sp; this.indicators(); }
    if (sp.size) this.rings();
    else if (this.ringBox && this.ringBox.childElementCount) this.ringBox.textContent = '';
  }
  duck() {
    const t = Date.now(); if (t - (this.duckAt || 0) < 250) return; this.duckAt = t; this.ducked = true;
    try { music.duck(600, 0.35); } catch {}
    try { const B = buses(); if (B.ac && B.sfxBus) B.sfxBus.gain.setTargetAtTime(settings.sfx * 0.7 * 0.55, B.ac.currentTime, 0.08); } catch {}
  }
  unduck() { if (!this.ducked) return; this.ducked = false; try { const B = buses(); if (B.ac && B.sfxBus) B.sfxBus.gain.setTargetAtTime(settings.sfx * 0.7, B.ac.currentTime, 0.3); } catch {} }

  // ---- indicators: lobby cards, player rows, HUD button and a ring under each speaking piece
  indicators() {
    for (const c of document.querySelectorAll('[data-pid]')) { if (!c.matches('.pcard, .qc-pl, .vc-li')) continue; c.classList.toggle('speaking', this.speaking.has(c.dataset.pid)); c.classList.toggle('in-voice', this.roster.has(c.dataset.pid)); }
    if (this.pttBtn) this.pttBtn.classList.toggle('speaking', !!(this.sess && this.speaking.has(this.sess.myPid)));
  }
  rings() {
    const g = this.d.game; if (!g || !g.s || !g.r || this.d.screen() !== 'game') return;
    if (!this.ringBox) { this.ringBox = el('div', 'vc-rings'); this.ringBox.setAttribute('aria-hidden', 'true'); $('#s-game').appendChild(this.ringBox); }
    const want = [];
    for (const pid of this.speaking) { const u = g.s.units.find((v) => v.pid === pid && v.kind === 'player' && v.alive); const d = u && g.r.disp && g.r.disp.get(u.id); if (d) want.push([u, d]); }
    while (this.ringBox.childElementCount < want.length) this.ringBox.appendChild(el('i', 'vc-ring'));
    while (this.ringBox.childElementCount > want.length) this.ringBox.lastChild.remove();
    want.forEach(([u, d], i) => {
      const r = this.ringBox.children[i]; const [sx, sy] = g.r.toScreen(d.x + 0.5, d.y + 0.82); const z = Math.max(18, g.r.z * 0.92);
      r.style.cssText = `left:${(sx - z / 2).toFixed(1)}px;top:${(sy - z * 0.22).toFixed(1)}px;width:${z.toFixed(1)}px;height:${(z * 0.44).toFixed(1)}px;--c:${u.color}`;
    });
  }

  // ---- UI
  changed() {
    if (!this.d) return;
    clearTimeout(this._ct); this._ct = setTimeout(() => {
      this.renderLobby(); this.indicators();
      if (this.pttBtn) {
        const show = this.state === 'on' && !this.listenOnly;
        this.pttBtn.classList.toggle('hidden', !show); this.pttBtn.classList.toggle('on', this.ptt || this.open); this.pttBtn.classList.toggle('open', this.open);
        this.pttBtn.setAttribute('aria-label', this.open ? 'Open mic on. Tap to turn off' : 'Hold to talk');
        this.pttBtn.setAttribute('aria-pressed', this.ptt || this.open ? 'true' : 'false');
      }
      if (this.d && this.d.onChange) this.d.onChange();
    }, 0);
  }
  names() { const n = {}; try { Object.assign(n, this.d.names() || {}); } catch {} return n; }
  controls(box, { list = false, lobby = false } = {}) {
    const w = el('div', 'vc-ctl');
    const head = el('div', 'vc-head');
    const st = el('span', 'vc-st');
    if (this.state === 'off') {
      const b = el('button', 'btn small gold', 'Join Voice'); b.dataset.vc = 'join'; head.appendChild(b);
      st.textContent = this.roster.size ? `${this.roster.size} in voice. Push to talk, off until you join.` : 'Push to talk. Off until you join.';
    } else if (this.state === 'starting') { st.textContent = 'Connecting voice...'; }
    else {
      const b = el('button', 'btn small', 'Leave Voice'); b.dataset.vc = 'leave'; head.appendChild(b);
      if (!this.listenOnly) { const o = el('button', 'btn small' + (this.open ? ' on' : ''), this.open ? 'Open Mic: On' : 'Open Mic: Off'); o.dataset.vc = 'open'; o.setAttribute('aria-pressed', this.open ? 'true' : 'false'); head.appendChild(o); }
      st.textContent = this.listenOnly ? 'Listening only' : this.open ? 'Open mic: everyone in voice hears you' : lobby ? 'Hold the button below to talk' : 'Hold the mic button to talk';
    }
    head.appendChild(st); w.appendChild(head);
    if (this.err && this.state === 'on') w.appendChild(el('p', 'vc-err', this.err));
    if (this.state === 'on' && this.listenOnly && this.errName !== 'NotSupportedError') { const m = el('button', 'btn small gold vc-allow', 'Turn On Mic'); m.dataset.vc = 'mic'; w.appendChild(m); }
    if (lobby && this.state === 'on' && !this.listenOnly && !this.open) { const h = el('button', 'btn wide vc-hold', 'Hold to Talk'); this.bindHold(h); w.appendChild(h); }
    if (list && this.roster.size) {
      const ul = el('ul', 'vc-list'); const N = this.names(), me = this.sess ? this.sess.myPid : (this.d.session() || {}).myPid;
      for (const pid of this.roster.keys()) { const li = el('li', 'vc-li'); li.dataset.pid = pid; li.appendChild(el('b', '', pid === me ? 'You' : N[pid] || 'Player')); if (pid !== me) this.playerControls(li, pid); ul.appendChild(li); }
      w.appendChild(ul);
    }
    box.appendChild(w);
  }
  playerControls(row, pid) {
    if (!this.roster.has(pid)) return;
    if (this.state !== 'on') { row.appendChild(el('small', 'vc-tag', 'In voice')); return; }
    const m = el('button', 'vc-mute' + (this.mutedV.has(pid) ? ' on' : ''), this.mutedV.has(pid) ? 'Voice muted' : 'Mute voice'); m.dataset.vc = 'mute'; m.dataset.pid = pid; m.setAttribute('aria-pressed', this.mutedV.has(pid) ? 'true' : 'false');
    const r = el('input', 'vc-vol'); r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.05; r.value = this.vol[pid] ?? 1; r.dataset.vol = pid; r.setAttribute('aria-label', 'Voice volume');
    row.append(m, r);
  }
  renderLobby() {
    for (const id of ['vc-host', 'vc-join']) {
      const p = document.getElementById(id); if (!p) continue;
      if (this.ptt || (document.activeElement && p.contains(document.activeElement) && document.activeElement.type === 'range')) continue; // never rebuild under a held Talk button or a slider mid-drag
      p.textContent = '';
      const lbl = el('div', 'lbl', 'Voice Chat'); p.appendChild(lbl);
      this.controls(p, { list: true, lobby: true });
      p.appendChild(el('p', 'vc-note', 'Voice goes straight to the players in this room and is never recorded. Your mic is only live while you hold Talk or have Open Mic on.'));
    }
  }
  onControl(act, pid) {
    const s = this.d.sfx;
    if (act === 'join') { s && s.tap && s.tap(); this.start(); }
    else if (act === 'leave') { s && s.tap && s.tap(); this.stop(); }
    else if (act === 'open') this.setOpen(!this.open);
    else if (act === 'mic') { s && s.tap && s.tap(); this.retryMic(); }
    else if (act === 'mute' && pid) { this.toggleMute(pid); s && s.tap && s.tap(); }
  }
}

// ---- microphone access ----
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ANDROID = /Android/.test(navigator.userAgent);
const STANDALONE = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const INAPP = /FBAN|FBAV|Instagram|Line\/|Snapchat|Twitter|Discord|GSA\/|; wv\)/.test(navigator.userAgent);
const named = (name, msg = name) => Object.assign(new Error(msg), { name });
// Must be called straight from a tap. Tries the voice-tuned constraints first, then plain audio (some phones reject
// the processing hints or report the mic as unavailable with them).
export async function getMic() {
  const md = navigator.mediaDevices;
  if (!window.isSecureContext) throw named('SecureContextError');
  if (!md || !md.getUserMedia) throw named('NotSupportedError');
  try { return await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
  catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
    try { return await md.getUserMedia({ audio: true }); }
    catch (e2) { throw e2 && e2.name && !['NotSupportedError', 'TypeError', 'OverconstrainedError'].includes(e2.name) ? e2 : e; } // keep the more telling error
  }
}
function micShort(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Microphone permission is off. See Voice Chat for how to turn it on.';
  if (n === 'NotReadableError' || n === 'AbortError' || n === 'TrackStartError') return 'Your microphone is busy in another app.';
  if (n === 'NotSupportedError' || n === 'SecureContextError') return 'This browser cannot share the microphone.';
  return 'No microphone was found. You can still listen.';
}
function micHelp(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') {
    if (IOS && STANDALONE) return 'Microphone is off for the home-screen app. On iPhone: Settings > Safari > Microphone > Ask or Allow, then reopen the game and tap Turn On Mic. You can still listen.';
    if (IOS) return 'Microphone is blocked. In Safari tap the aA button in the address bar > Website Settings > Microphone > Allow, then tap Turn On Mic (reload the page if no prompt appears). You can still listen.';
    if (ANDROID) return 'Microphone is blocked. Tap the icon left of the address bar > Permissions > Microphone > Allow (and check Android Settings > Apps > your browser > Permissions), then tap Turn On Mic. You can still listen.';
    return 'Microphone is blocked. Click the icon left of the address bar, allow the microphone for this site, then press Turn On Mic. You can still listen.';
  }
  if (n === 'NotReadableError' || n === 'AbortError' || n === 'TrackStartError') return 'Another app is using the microphone (a call, a voice memo or another browser tab). Close it, then tap Turn On Mic. You can still listen.';
  if (n === 'SecureContextError') return 'Voice needs the secure site. Open https://dianteclark.github.io/Chess-Complex/ and try again.';
  if (n === 'NotSupportedError') return INAPP ? 'This in-app browser cannot use the microphone. Open the game in Safari or Chrome (use the menu > Open in browser), then join voice again. You can still listen.' : 'This browser cannot share the microphone. Try Safari on iPhone or Chrome on Android. You can still listen.';
  return 'No microphone was found on this device. You can still listen to others.';
}

export const voice = new Voice();
