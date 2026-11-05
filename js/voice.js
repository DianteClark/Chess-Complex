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
import { buses, settings, getCtx, setVoiceMode, onCtxSwap, holdContext } from './audio.js';
import { PEER_OPTS } from './net.js';
import { endpoint as cloudEndpoint } from './cloud.js';
// 17.0 (S2): ICE servers from the cloud (GET /turn: Cloudflare TURN when the server has keys, else the same public
// list); no cloud, an error or a 2 s timeout keeps PEER_OPTS. Good answers are reused for 30 min.
let iceCache = null;
function peerOpts() {
  const now = Date.now();
  if (iceCache && now < iceCache.until) return iceCache.p;
  const p = (async () => {
    const base = await Promise.resolve(cloudEndpoint && cloudEndpoint());
    if (!base) return { o: PEER_OPTS, ok: false };
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 2000);
    try {
      const j = await (await fetch(base + '/turn', { signal: ac.signal })).json();
      if (!j || !Array.isArray(j.iceServers) || !j.iceServers.length) return { o: PEER_OPTS, ok: false };
      return { o: { ...PEER_OPTS, config: { ...PEER_OPTS.config, iceServers: j.iceServers } }, ok: true };
    } finally { clearTimeout(to); }
  })().catch(() => ({ o: PEER_OPTS, ok: false })).then((r) => { iceCache.until = Date.now() + (r.ok ? 1800000 : 60000); return r.o; });
  iceCache = { p, until: Infinity };
  return p;
}

const VID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_MEMBERS = 8;
const useLocal = () => new URLSearchParams(location.search).get('net') === 'local';
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0h-2a4 4 0 0 1-8 0zM11 18h2v3h-2z"/></svg>';

// ---------------------------------------------------------------- transports
// 15.0 (N, mic crackle): pin the Opus parameters on every offer and answer. Mono voice (stereo=0), in-band FEC on
// (lost packets are rebuilt instead of clicking), DTX off (DTX gates the stream on and off, which sounds like crackle
// and pumping on phones), 48 kHz capture/playback (no resampling between the mic, the Opus encoder and the context),
// 20 ms frames, 32 kbps average. Applied as PeerJS sdpTransform and to the local transport's descriptions.
const OPUS_FMTP = { minptime: '10', useinbandfec: '1', usedtx: '0', stereo: '0', 'sprop-stereo': '0', maxplaybackrate: '48000', 'sprop-maxcapturerate': '48000', maxaveragebitrate: '32000', cbr: '0' };
export function opusSdp(sdp) {
  if (typeof sdp !== 'string') return sdp;
  const pts = []; const re = /^a=rtpmap:(\d+) opus\/48000(?:\/2)?\r?$/gim; let m;
  while ((m = re.exec(sdp))) pts.push(m[1]);
  if (!pts.length) return sdp;
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n';
  let lines = sdp.split(/\r?\n/);
  for (const pt of pts) {
    const i = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `));
    const cur = {}; if (i >= 0) for (const kv of lines[i].slice(`a=fmtp:${pt} `.length).split(';')) { const [k, v] = kv.split('='); if (k && k.trim()) cur[k.trim()] = (v || '').trim(); }
    const line = `a=fmtp:${pt} ` + Object.entries({ ...cur, ...OPUS_FMTP }).map(([k, v]) => `${k}=${v}`).join(';');
    if (i >= 0) lines[i] = line; else { const r = lines.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `)); lines.splice(r + 1, 0, line); }
  }
  // 20 ms packets for voice
  lines = lines.filter((l) => l !== '' && !/^a=ptime:/.test(l));
  const ai = lines.findIndex((l) => l.startsWith('m=audio')); if (ai >= 0) { let j = ai + 1; while (j < lines.length && !lines[j].startsWith('m=')) j++; lines.splice(j, 0, 'a=ptime:20'); }
  return lines.join(nl) + nl;
}
const SDP_OPTS = { sdpTransform: opusSdp };
// T = { id, onCall(cb), call(remoteId, stream) -> C, close() }   C = { peer, answer(stream), onStream(cb), onClose(cb), close() }
async function peerTransport() {
  const opts = await peerOpts(); // 17.0 (S2)
  return new Promise((res, rej) => {
    if (!window.Peer) { rej(new Error('no-peer')); return; }
    const peer = new window.Peer(opts); let done = false;
    const to = setTimeout(() => { if (!done) { done = true; try { peer.destroy(); } catch {} rej(new Error('timeout')); } }, 12000);
    const wrap = (c) => {
      const C = { peer: c.peer, _s: [], _c: [], answer: (s) => c.answer(s, SDP_OPTS), onStream(f) { this._s.push(f); }, onClose(f) { this._c.push(f); }, close() { try { c.close(); } catch {} } };
      let closed = false; const fin = () => { if (closed) return; closed = true; C._c.forEach((f) => f()); };
      c.on('stream', (s) => C._s.forEach((f) => f(s))); c.on('close', fin); c.on('error', fin);
      const watch = () => { const pc = c.peerConnection; if (!pc) return setTimeout(watch, 300); pc.addEventListener('iceconnectionstatechange', () => { if (['failed', 'closed'].includes(pc.iceConnectionState)) fin(); }); };
      watch();
      return C;
    };
    const T = { id: null, _on: null, onCall(f) { this._on = f; }, call: (id, s) => wrap(peer.call(id, s, SDP_OPTS)), close: () => { try { peer.destroy(); } catch {} } };
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
      (async () => { try { const o = await ent.pc.createOffer(); const sdp = opusSdp(o.sdp); await ent.pc.setLocalDescription({ type: o.type, sdp }); post(remote, 'offer', { type: o.type, sdp }); } catch { ent.C._fin(); } })();
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
            const a = await e2.pc.createAnswer(); const sdp = opusSdp(a.sdp); await e2.pc.setLocalDescription({ type: a.type, sdp }); post(m.from, 'answer', { type: a.type, sdp });
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
    this.speaking = new Set(); this.open = false; this.muted = false; this.ptt = false; this.listenOnly = false; this.sess = null; this.T = null; this.mic = null; this.ac = null; this.ducked = false; this.err = '';
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
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.watchPerm(); }); // back from the system Settings app
    // iPhone may refuse to start a voice that arrived without a recent tap: any tap restarts stalled voices
    document.addEventListener('pointerdown', () => { for (const e of this.calls.values()) if (e.el && e.el.paused && e.stream) e.el.play().catch(() => {}); }, true);
    this.loop = setInterval(() => this.tick(), 100);
    this.buildCard(); this.bindMicRow(); this.watchPerm();
    this.renderLobby();
  }
  bindHold(b) {
    // 17.1 (V2): in Open Mic a tap mutes / unmutes (it never changes the mode; that is the voice panel's Push to Talk /
    // Open Mic switch, in the lobby and in the match's quick chat > Players); in Push to Talk: hold to talk, as before.
    const down = (e) => { e.preventDefault(); if (this.state !== 'on' || this.listenOnly) return; if (this.open) { this.setMuted(!this.muted); return; } try { b.setPointerCapture(e.pointerId); } catch {} this.setPtt(true); };
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
      const rl = (sess.vcRL ||= {}); const now = Date.now(), st = rl[pid] || (rl[pid] = { n: 6, at: now, on: 0 });
      // 17.1 (V2): only talk-on is rate limited; a talk-off after a relayed talk-on always goes through (a dropped
      // off left the speaker lit for up to 30 s), and repeated offs are dropped, so offs never outnumber ons
      const on = m.on ? 1 : 0;
      if (on) { st.n = Math.min(6, st.n + (now - st.at) / 250); st.at = now; if (st.n < 1) return; st.n -= 1; }
      else if (!st.on) return;
      st.on = on;
      hostSend(sess, { t: 'vc', a: 'talk', pid, on }, this);
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
      // 10.3: joins and leaves go to the chat history as system lines (only shown during a match)
      if (this.d && this.d.sys) {
        const N = this.names(), me = (this.d.session() || {}).myPid, nm = (p) => (p === me ? 'You' : N[p] || 'A player');
        for (const p of r.keys()) if (!this.roster.has(p)) this.d.sys(`${nm(p)} joined voice`);
        for (const p of this.roster.keys()) if (!r.has(p)) this.d.sys(`${nm(p)} left voice`);
      }
      this.roster = r; this.rosterSess = this.d && this.d.session();
      for (const pid of [...this.flag.keys()]) if (!r.has(pid)) this.flag.delete(pid);
      // 17.1 (V2): the host / Room drops a member's voice when its link drops (a phone screen off between matches); a
      // device still in voice that finds itself gone from the roster joins again (a few times, spaced out)
      if (this.state === 'on' && this.myVid) {
        if ([...r.values()].includes(this.myVid)) this.rejoins = 0;
        else if (this.wasIn && (this.rejoins || 0) < 5 && Date.now() - (this.rejoinAt || 0) > 2000) { this.rejoins = (this.rejoins || 0) + 1; this.rejoinAt = Date.now(); setTimeout(() => { if (this.state === 'on' && !this.inRoster()) this.send({ a: 'join', vid: this.myVid }); }, 300); }
        if ([...r.values()].includes(this.myVid)) this.wasIn = true;
      }
      this.reconcile(); this.changed();
    } else if (m.a === 'talk' && typeof m.pid === 'string') {
      if (!this.roster.has(m.pid)) return;
      if (m.on) this.flag.set(m.pid, Date.now()); else this.flag.delete(m.pid);
    }
  }

  // ---- opting in
  // o.micP: a getMic() promise already started inside the tap (pre-permission card); o.listen: join without a mic
  async start(o = {}) {
    if (this.state !== 'off' || !this.online()) { if (o.micP) o.micP.then((m) => m.getTracks().forEach((t) => t.stop()), () => {}); return; }
    // the permission prompt needs the user gesture: getUserMedia is the very first thing that runs in the tap
    const micP = o.listen ? null : (o.micP || getMic());
    const sess = this.d.session(); this.sess = sess; this.state = 'starting'; this.err = ''; this.errName = ''; this.listenOnly = false; this.changed();
    // AU 15.0: no second AudioContext (two contexts on iOS in play-and-record crackle): meters and remote voices use
    // the game's context. getCtx() here runs inside the tap, so it may resume.
    try { this.ac = getCtx(); } catch { this.ac = null; }
    holdContext(true); this.held = true;
    let mic = null;
    if (!micP) { this.listenOnly = true; this.errName = 'Listen'; }
    else try { mic = await micP; }
    catch (e) {
      this.listenOnly = true; this.errName = (e && e.name) || 'Error';
      this.err = micHelp(e);
      this.d.toast(micShort(e));
    }
    this.watchPerm();
    if (this.d.session() !== sess || this.state !== 'starting') { if (mic) mic.getTracks().forEach((t) => t.stop()); return; }
    if (mic) { this.mic = mic; for (const t of mic.getAudioTracks()) { t.enabled = false; t.onended = () => { if (this.state === 'on') { this.listenOnly = true; this.err = 'Microphone disconnected. You can still listen.'; this.d.toast(this.err); this.changed(); } }; } }
    this.syncMode(); // AU: mic live -> audio.js rebuilds the game context for play-and-record (rate, latency, light DSP)
    this.out = this.mic || this.silent();
    this.meterMine();
    try { this.T = await (useLocal() ? localTransport(sess.code) : peerTransport()); }
    catch { this.d.toast('Voice could not connect. The match is not affected.'); this.stop(true); return; }
    if (this.d.session() !== sess || this.state !== 'starting') { try { this.T.close(); } catch {} return; }
    this.T.onCall((C) => this.incoming(C));
    this.myVid = this.T.id; this.state = 'on'; this.open = false; this.muted = false; this.ptt = false;
    this.send({ a: 'join', vid: this.myVid });
    this.changed(); this.d.sfx && this.d.sfx.select && this.d.sfx.select();
  }
  // Ask again from a tap (the browser shows its permission prompt only in response to a user gesture), then swap the
  // live mic into every open call without reconnecting.
  async retryMic() {
    if (this.state !== 'on' || !this.listenOnly) return;
    let mic;
    try { mic = await getMic(); }
    catch (e) { this.errName = (e && e.name) || 'Error'; this.err = micHelp(e); this.d.toast(micShort(e)); this.watchPerm(); return; }
    if (this.state !== 'on') { mic.getTracks().forEach((t) => t.stop()); return; }
    this.mic = mic; this.listenOnly = false; this.err = ''; this.errName = '';
    const track = mic.getAudioTracks()[0];
    for (const t of mic.getAudioTracks()) { t.enabled = false; t.onended = () => { if (this.state === 'on') { this.listenOnly = true; this.err = 'Microphone disconnected. You can still listen.'; this.d.toast(this.err); this.changed(); } }; }
    this.syncMode(); this.meterMine();
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
  // ---- AU 15.0 audio path: one shared AudioContext (audio.js), voice mode while a mic is live, re-wire on swaps
  syncMode() { setVoiceMode(!!((this.mic && this.state !== 'off') || (this.test && this.test.stream))); }
  meterMine() {
    try { this.mySrc && this.mySrc.disconnect(); } catch {} this.mySrc = null; this.myAn = null;
    if (!this.ac || !this.mic) return;
    try { this.mySrc = this.ac.createMediaStreamSource(this.mic); this.myAn = this.ac.createAnalyser(); this.myAn.fftSize = 512; this.mySrc.connect(this.myAn); } catch {}
  }
  // 15.2: remote voices always play through their own <audio> element. Routing remote WebRTC audio through Web Audio
  // (with the element muted) is silent on iPhone Safari and broke whenever the game rebuilt its AudioContext for the mic.
  // Web Audio is only used for the speaking meter here (analyser, not connected to the speakers).
  remoteNodes(ent) {
    try { ent.src && ent.src.disconnect(); } catch {}
    ent.src = ent.gain = ent.an = null;
    if (ent.el) ent.el.muted = this.mutedV.has(ent.pid);
    if (!this.ac || !ent.stream) return;
    try { ent.src = this.ac.createMediaStreamSource(ent.stream); ent.an = this.ac.createAnalyser(); ent.an.fftSize = 512; ent.src.connect(ent.an); }
    catch { ent.src = ent.an = null; }
  }
  rewire(ac) { // audio.js rebuilt the context: move meters and remote voices onto the new one
    if (this.state === 'off') return;
    this.ac = ac; this.meterMine();
    for (const ent of this.calls.values()) if (ent.stream) { this.remoteNodes(ent); this.applyVol(ent.pid); }
    if (this.test && this.test.stream) this.meterTest(this.test);
  }
  meterTest(T) {
    try { T.src && T.src.disconnect(); } catch {} T.src = null; T.an = null;
    const ac = getCtx(true); if (!ac || !T.stream) return;
    try { T.src = ac.createMediaStreamSource(T.stream); T.an = ac.createAnalyser(); T.an.fftSize = 512; T.src.connect(T.an); } catch {}
  }
  stop(quiet) {
    if (this.state === 'off') return;
    if (!quiet) this.send({ a: 'leave' });
    this.state = 'off'; this.ptt = false; this.open = false; this.muted = false;
    for (const vid of [...this.calls.keys()]) this.drop(vid, true);
    try { this.T && this.T.close(); } catch {} this.T = null;
    if (this.mic) { this.mic.getTracks().forEach((t) => t.stop()); if (!this.test) setSession('playback'); resumeAudio(); } this.mic = null; this.out = null; this.myAn = null;
    try { this.mySrc && this.mySrc.disconnect(); } catch {} this.mySrc = null;
    this.ac = null; this.syncMode(); // the shared context stays (it is the game's); voice mode ends once the mic is gone
    if (this.held) { this.held = false; holdContext(false); }
    this.myVid = null; this.flag.clear(); this.unduck(); this.sess = null; this.tries = {}; this.myOn = false;
    this.speaking.clear(); this.wasIn = false; this.rejoins = 0; this.changed();
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
    this.remoteNodes(ent);
    this.applyVol(ent.pid);
    a.play().catch(() => {});
    this.changed();
  }
  drop(vid, quiet) {
    const ent = this.calls.get(vid); if (!ent) return;
    this.calls.delete(vid);
    if (!quiet) try { ent.C.close(); } catch {}
    try { ent.gain && ent.gain.disconnect(); ent.src && ent.src.disconnect(); } catch {}
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
  // the mode: Open Mic (on) or Push to Talk (off). A mute only lives inside Open Mic; switching modes clears it.
  setOpen(on) {
    if (this.state !== 'on' || this.listenOnly) return;
    on = !!on; if (on === this.open && !this.muted) { this.changed(); return; }
    this.open = on; this.muted = false; this.ptt = false; this.applyMic();
    if (!this.open) { this.myOn = false; this.send({ a: 'talk', on: 0 }); }
    this.d.toast(this.open ? 'Open Mic: everyone in voice hears you. Tap the mic to mute.' : 'Push to Talk: hold the mic button to talk');
    this.changed();
  }
  setMuted(on) {
    if (this.state !== 'on' || this.listenOnly || !this.open) return;
    this.muted = !!on; this.applyMic();
    if (this.muted && this.myOn) { this.myOn = false; this.send({ a: 'talk', on: 0 }); }
    if (this.d.sfx && this.d.sfx.tap) this.d.sfx.tap();
    this.d.toast(this.muted ? 'Mic muted. Tap the mic to unmute.' : 'Mic on: everyone in voice hears you');
    this.changed();
  }
  applyMic() { if (this.mic) for (const t of this.mic.getAudioTracks()) t.enabled = (this.open && !this.muted) || this.ptt; }
  level(an) { if (!an) return 0; const b = this._buf || (this._buf = new Float32Array(512)); an.getFloatTimeDomainData(b); let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); }
  setVolume(pid, v) { this.vol[pid] = Math.max(0, Math.min(1, +v || 0)); this.applyVol(pid); }
  applyVol(pid) {
    const v = this.mutedV.has(pid) ? 0 : (this.vol[pid] ?? 1);
    for (const e of this.calls.values()) if (e.pid === pid && e.el) { e.el.muted = v === 0; try { e.el.volume = v; } catch {} if (e.el.paused) e.el.play().catch(() => {}); }
  }
  toggleMute(pid) { if (this.mutedV.has(pid)) this.mutedV.delete(pid); else this.mutedV.add(pid); this.applyVol(pid); this.changed(); }

  tick() {
    if (this.sess && this.d.session() !== this.sess) this.stop(true);
    if (this.rosterSess && this.d.session() !== this.rosterSess) { this.rosterSess = null; this.roster = new Map(); this.mutedV.clear(); this.vol = {}; this.flag.clear(); this.changed(); }
    const now = Date.now(), sp = new Set();
    // 17.1 (V2): meters must sit on the game's live context; if a rebuild slipped past onCtxSwap (or ours was closed), re-wire
    if (this.state === 'on') { try { const B = buses(); if (B.ac && (this.ac !== B.ac || (this.ac && this.ac.state === 'closed'))) this.rewire(B.ac); } catch {} }
    if (this.state === 'on') {
      for (const e of this.calls.values()) {
        if (this.mutedV.has(e.pid)) continue;
        const lv = this.level(e.an); if (lv > 0.01) e.hot = now;
        if (now - (e.hot || 0) < 350 || this.flag.has(e.pid)) sp.add(e.pid);
      }
      for (const [pid, t] of this.flag) if (now - t > 30000) this.flag.delete(pid); // a lost talk-off never sticks
      const me = this.sess && this.sess.myPid;
      if (this.open && !this.muted && this.myAn) { const lv = this.level(this.myAn); if (lv > 0.012) this.myHot = now; const on = now - (this.myHot || 0) < 600; if (on !== this.myOn) { this.myOn = on; this.send({ a: 'talk', on: on ? 1 : 0 }); } if (on && me) sp.add(me); }
      else if (this.ptt && me) sp.add(me);
    }
    const others = [...sp].some((p) => !this.sess || p !== this.sess.myPid);
    if (others) this.duck(); else this.unduck();
    const key = [...sp].sort().join(',');
    // 17.1 (V2): lobby cards / player rows are rebuilt by other code (party lobby, Back to Party, chat): re-apply the
    // classes while anyone speaks and now and then while a roster exists, not only when the speaking set changes
    this._tk = ((this._tk || 0) + 1) % 5;
    if (key !== this.spKey) { this.spKey = key; this.speaking = sp; this.indicators(); }
    else if (sp.size || (this.roster.size && !this._tk)) this.indicators();
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
        const live = this.ptt || (this.open && !this.muted);
        this.pttBtn.classList.toggle('hidden', !show); this.pttBtn.classList.toggle('on', live); this.pttBtn.classList.toggle('open', this.open); this.pttBtn.classList.toggle('muted', this.open && this.muted);
        this.pttBtn.setAttribute('aria-label', !this.open ? 'Hold to talk' : this.muted ? 'Open mic muted. Tap to unmute' : 'Open mic on. Tap to mute');
        this.pttBtn.setAttribute('aria-pressed', live ? 'true' : 'false');
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
      st.textContent = this.listenOnly ? 'Listening only' : this.open ? (this.muted ? 'Open mic muted: nobody hears you' : 'Open mic: everyone in voice hears you') : lobby ? 'Hold the button below to talk' : 'Hold the mic button to talk';
    }
    head.appendChild(st); w.appendChild(head);
    // 17.1 (V2): the mode switch (both ways) and, in Open Mic, a mute
    if (this.state === 'on' && !this.listenOnly) {
      const row = el('div', 'vc-mode'); const seg = el('div', 'vc-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Voice mode');
      for (const [k, t, on] of [['mode-ptt', 'Push to Talk', !this.open], ['mode-open', 'Open Mic', this.open]]) { const x = el('button', on ? 'on' : '', t); x.type = 'button'; x.dataset.vc = k; x.setAttribute('aria-pressed', on ? 'true' : 'false'); seg.appendChild(x); }
      row.appendChild(seg);
      if (this.open) { const mu = el('button', 'btn small vc-mute-me' + (this.muted ? ' on' : ''), this.muted ? 'Unmute Mic' : 'Mute Mic'); mu.type = 'button'; mu.dataset.vc = 'mute-me'; mu.setAttribute('aria-pressed', this.muted ? 'true' : 'false'); row.appendChild(mu); }
      w.appendChild(row);
    }
    const ms = this.micStatus(); const pl = el('p', 'vc-perm ' + ms.key); pl.dataset.mic = ms.key;
    pl.append(el('span', '', 'Microphone: '), el('b', '', ms.label)); if (ms.hint) pl.append(document.createTextNode(' ' + ms.hint)); w.appendChild(pl);
    if (this.err && this.state === 'on') {
      const e = el('div', 'vc-err'); e.appendChild(el('p', '', this.err));
      if (this.errName === 'NotAllowedError' || this.errName === 'SecurityError') e.appendChild(stepsList());
      w.appendChild(e);
    }
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
    const r = el('input', 'vc-vol'); r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.05; r.value = this.vol[pid] ?? 1; r.dataset.vol = pid; r.setAttribute('aria-label', 'Voice volume'); r.style.setProperty('--p', Math.round((this.vol[pid] ?? 1) * 100) + '%');
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
    if (act === 'join') { s && s.tap && s.tap(); this.join(); }
    else if (act === 'leave') { s && s.tap && s.tap(); this.stop(); }
    else if (act === 'open') this.setOpen(!this.open);
    else if (act === 'mode-open' || act === 'mode-ptt') { s && s.tap && s.tap(); this.setOpen(act === 'mode-open'); }
    else if (act === 'mute-me') this.setMuted(!this.muted);
    else if (act === 'mic') { s && s.tap && s.tap(); this.retryMic(); }
    else if (act === 'mute' && pid) { this.toggleMute(pid); s && s.tap && s.tap(); }
  }

  // ---- 10.3: explicit microphone permission flow
  // Join Voice: permission already granted (or granted before on this device, e.g. an iPhone Home Screen app that asks
  // again every launch) -> straight to the system prompt; otherwise the pre-permission card first.
  join() {
    if (this.state !== 'off' || !this.online()) return;
    const p = this.perm, m = micMemo();
    if (p === 'granted' || (p !== 'denied' && m && m.state === 'granted')) {
      if (p !== 'granted' && micCtx() === 'ios-app') this.d.toast('iPhone asks for the microphone each time the Home Screen app opens. Tap Allow.');
      this.start(); return;
    }
    this.openCard(p === 'denied' || !!(m && m.state === 'denied'));
  }
  async watchPerm() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) throw 0;
      const st = await navigator.permissions.query({ name: 'microphone' });
      this.perm = st.state;
      if (this.permObj !== st) { this.permObj = st; st.onchange = () => { this.perm = st.state; this.micChanged(); }; }
    } catch { this.perm = 'unsupported'; }
    this.micChanged();
  }
  micChanged() { this.renderMicRow(); this.renderCard(); this.changed(); }
  // { key: granted | denied | prompt | na, label, hint }
  micStatus() {
    const md = navigator.mediaDevices;
    if (!window.isSecureContext || !md || !md.getUserMedia) return { key: 'na', label: 'Not available in this browser' };
    const p = this.perm, m = micMemo(), app = micCtx() === 'ios-app';
    if (p === 'granted') return { key: 'granted', label: 'Allowed' };
    if (p === 'denied') return { key: 'denied', label: 'Blocked' };
    if (p === 'prompt') return { key: 'prompt', label: 'Will ask', hint: m && m.state === 'denied' ? 'Blocked last time.' : app && m && m.state === 'granted' ? 'iPhone asks again each time the Home Screen app opens.' : '' };
    if (m && m.state === 'granted') return { key: 'granted', label: 'Allowed before', hint: app ? 'iPhone may ask again when the app opens.' : '' };
    if (m && m.state === 'denied') return { key: 'denied', label: 'Blocked before' };
    return { key: 'prompt', label: 'Will ask' };
  }
  // the pre-permission card
  buildCard() {
    if ($('#m-mic')) return;
    const m = el('div', 'modal hidden global mic-modal'); m.id = 'm-mic'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'mic-h');
    m.innerHTML = `<div class="modal-box mic-box"><div class="mic-ic" aria-hidden="true">${MIC_SVG}</div><h3 id="mic-h"></h3>
      <p class="mic-lead"></p><p class="mic-sub"></p><div class="mic-deny"></div><p class="vc-perm"></p>
      <button class="btn wide gold" data-mc="allow" id="mic-allow"></button><button class="btn wide" data-mc="listen" id="mic-listen">Listen Only</button>
      <button class="mic-later" data-mc="cancel">Not Now</button></div>`;
    document.body.appendChild(m); this.card = m;
    // Allow: getUserMedia runs synchronously inside this click (no awaits before it), so iOS shows its system prompt
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mc]'); if (!b) { if (e.target === m) this.closeCard(); return; }
      const a = b.dataset.mc, sfx = this.d.sfx;
      if (a === 'allow') { const micP = getMic(); this.closeCard(); this.start({ micP }); }
      else if (a === 'listen') { this.closeCard(); this.start({ listen: true }); }
      else this.closeCard();
      sfx && sfx.tap && sfx.tap();
    });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.classList.contains('hidden')) this.closeCard(); });
  }
  openCard(denied) { if (!this.card) return; this.cardDenied = !!denied; this.renderCard(); this.card.classList.remove('hidden'); setTimeout(() => { try { $('#mic-allow').focus({ preventScroll: true }); } catch {} }, 30); }
  closeCard() { if (this.card) this.card.classList.add('hidden'); }
  renderCard() {
    const m = this.card; if (!m) return;
    const ms = this.micStatus(), denied = this.cardDenied || ms.key === 'denied', ctx = micCtx();
    $('#mic-h', m).textContent = denied ? 'Microphone is blocked' : 'Join Voice Chat';
    $('.mic-lead', m).textContent = 'Voice chat needs your microphone. Your mic is only live while you hold Talk.';
    $('.mic-sub', m).textContent = denied ? 'You can still join and listen.'
      : ctx === 'ios-app' ? 'Your iPhone asks next: tap Allow. Home Screen apps can ask again each time you open them, which is normal.'
      : ctx.startsWith('ios') ? 'Your iPhone asks next: tap Allow.' : 'Your browser asks next: choose Allow.';
    const d = $('.mic-deny', m); d.textContent = ''; d.hidden = !denied;
    if (denied) { d.appendChild(el('p', '', 'To turn it on:')); d.appendChild(stepsList()); }
    const pl = $('.vc-perm', m); pl.textContent = ''; pl.className = 'vc-perm ' + ms.key; pl.append(el('span', '', 'Microphone: '), el('b', '', ms.label));
    $('#mic-allow', m).textContent = denied ? 'Try Again' : 'Allow Microphone';
    $('#mic-allow', m).hidden = ms.key === 'na';
  }
  // Settings > Chat and Voice > Microphone: state, Allow Microphone, Test Microphone with a live level meter
  bindMicRow() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-mic-act]'); if (!b) return;
      const sfx = this.d && this.d.sfx; sfx && sfx.tap && sfx.tap();
      if (b.dataset.micAct === 'allow') this.allowMic(); else if (b.dataset.micAct === 'test') this.testMic();
    });
    this.renderMicRow();
    // re-read the permission each time Settings opens (Safari does not always fire permission change events)
    const set = document.getElementById('m-settings');
    if (set) new MutationObserver(() => { const open = !set.classList.contains('hidden'); if (open && !this.settingsShown) this.watchPerm(); this.settingsShown = open; }).observe(set, { attributes: true, attributeFilter: ['class'] });
  }
  renderMicRow() {
    const row = document.getElementById('mic-row'); if (!row) return;
    const ms = this.micStatus(); row.dataset.mic = ms.key;
    const st = $('#mic-state', row); if (st) st.textContent = ms.label + (ms.hint ? '. ' + ms.hint : '');
    const a = $('[data-mic-act="allow"]', row); if (a) { a.hidden = ms.key === 'granted' && ms.label === 'Allowed' || ms.key === 'na'; a.textContent = ms.key === 'denied' ? 'Try Again' : 'Allow Microphone'; }
    const t = $('[data-mic-act="test"]', row); if (t) { t.textContent = this.test ? 'Stop Test' : 'Test Microphone'; t.hidden = ms.key === 'na'; t.classList.toggle('on', !!this.test); }
    const h = document.getElementById('mic-help');
    if (h) { h.textContent = ''; const show = ms.key === 'denied'; h.hidden = !show; if (show) { h.appendChild(el('p', '', 'The microphone is blocked for this game. To turn it on:')); h.appendChild(stepsList()); } }
    const mt = document.getElementById('mic-meter'); if (mt) mt.hidden = !this.test;
  }
  releaseTest(stream) { try { stream.getTracks().forEach((t) => t.stop()); } catch {} if (!(this.mic && this.state === 'on')) { setSession('playback'); resumeAudio(); } }
  allowMic() {
    const p = getMic(); // straight from the tap
    p.then((s) => { this.releaseTest(s); this.d.toast('Microphone allowed. Hold Talk in voice chat to speak.'); },
      (e) => { this.d.toast(micShort(e)); })
      .finally(() => this.watchPerm());
  }
  testMic() {
    if (this.test) { this.endTest(); return; }
    // in voice already: measure a clone of the live track, so nothing is sent to the room
    const live = this.mic && this.state === 'on' && this.mic.getAudioTracks()[0];
    const micP = live ? Promise.resolve(new MediaStream([live.clone()])) : getMic();
    try { getCtx(); } catch {} // AU 15.0: the meter uses the game's context (resumed here, inside the tap)
    const T = (this.test = { ac: null, peak: 0, at: Date.now() }); this.renderMicRow(); this.meterNote('Starting...');
    micP.then((stream) => {
      if (this.test !== T) { this.releaseTest(stream); return; }
      T.stream = stream; this.syncMode(); this.meterTest(T);
      this.meterNote('Say something: the bar should move.');
      T.iv = setInterval(() => {
        const lv = this.level(T.an); T.peak = Math.max(T.peak, lv);
        const pct = Math.min(100, Math.round(Math.sqrt(lv) * 260)); const bar = document.querySelector('#mic-meter i'); if (bar) { bar.style.width = pct + '%'; bar.parentElement.setAttribute('aria-valuenow', pct); }
        const set = document.getElementById('m-settings');
        if (Date.now() - T.at > 12000 || (set && set.classList.contains('hidden'))) this.endTest();
      }, 60);
      this.watchPerm();
    }, (e) => { if (this.test === T) this.test = null; this.d.toast(micShort(e)); this.meterNote(micShort(e)); this.watchPerm(); });
  }
  endTest() {
    const T = this.test; if (!T) return; this.test = null;
    clearInterval(T.iv); try { T.src && T.src.disconnect(); } catch {} if (T.stream) this.releaseTest(T.stream); this.syncMode();
    this.meterNote(!T.stream ? '' : T.peak > 0.015 ? 'Your microphone works.' : 'No sound reached the game. Check the mic is not muted or covered.');
    const bar = document.querySelector('#mic-meter i'); if (bar) bar.style.width = '0%';
    this.renderMicRow();
  }
  meterNote(t) { const n = document.getElementById('mic-note'); if (n) { n.textContent = t; n.hidden = !t; } }
}

// ---- microphone access ----
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ANDROID = /Android/.test(navigator.userAgent);
const standalone = () => { try { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true; } catch { return navigator.standalone === true; } };
const INAPP = /FBAN|FBAV|Instagram|Line\/|Snapchat|Twitter|Discord|GSA\/|; wv\)/.test(navigator.userAgent);
const named = (name, msg = name) => Object.assign(new Error(msg), { name });
// Must be called straight from a tap. Tries the voice-tuned constraints first, then plain audio (some phones reject
// the processing hints or report the mic as unavailable with them).
export async function getMic() {
  const md = navigator.mediaDevices;
  if (!window.isSecureContext) throw named('SecureContextError');
  if (!md || !md.getUserMedia) throw named('NotSupportedError');
  // iOS: the game's sound puts the audio session in 'playback' mode, which refuses microphone capture outright.
  // Switch to 'play-and-record' before asking; restore 'playback' if we end up without a mic.
  setSession('play-and-record');
  try {
    let mic;
    try { mic = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
    catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
      try { mic = await md.getUserMedia({ audio: true }); }
      catch (e2) { throw e2 && e2.name && !['NotSupportedError', 'TypeError', 'OverconstrainedError'].includes(e2.name) ? e2 : e; } // keep the more telling error
    }
    resumeAudio(); setMemo('granted');
    return mic;
  } catch (e) {
    if (!(voice.mic && voice.state === 'on')) setSession('playback');
    resumeAudio();
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) setMemo('denied', e.name);
    throw e;
  }
}
// The answer is remembered per device (iPhone Home Screen apps forget it between launches; Safari and Chrome keep it).
const MKEY = 'cc_mic';
function micMemo() { try { const m = JSON.parse(localStorage.getItem(MKEY) || 'null'); return m && typeof m === 'object' && (m.state === 'granted' || m.state === 'denied') ? m : null; } catch { return null; } }
function setMemo(state, name) { try { localStorage.setItem(MKEY, JSON.stringify({ state, name: name || '', ctx: micCtx(), at: Date.now() })); } catch {} }
// where the game runs, for the help text: ios-app (Home Screen web app), ios-safari, android, android-app, desktop
export function micCtx() { return IOS ? (standalone() ? 'ios-app' : 'ios-safari') : ANDROID ? (standalone() ? 'android-app' : 'android') : 'desktop'; }
const SAFARI_SET = 'Settings > Apps > Safari > Microphone (on iOS 17: Settings > Safari > Microphone)';
export function micSteps(ctx = micCtx()) {
  if (ctx === 'ios-app') return [
    'Close Chess Complex fully: swipe up from the bottom of the screen and pause, then swipe the game away.',
    `Open ${SAFARI_SET} and choose Ask or Allow.`,
    'Open Chess Complex from your Home Screen again, tap Join Voice (or Turn On Mic), then tap Allow.',
  ];
  if (ctx === 'ios-safari') return [
    'In Safari, tap the page menu at the left of the address bar (aA on iOS 17), then Website Settings.',
    'Set Microphone to Ask or Allow.',
    `If it is still blocked, check ${SAFARI_SET} is not set to Deny.`,
    'Reload the page, tap Turn On Mic, then tap Allow.',
  ];
  if (ctx === 'android' || ctx === 'android-app') return [
    ctx === 'android-app' ? 'Long-press the Chess Complex icon > App info > Permissions (or Site settings) > Microphone > Allow.' : 'Tap the icon at the left of the address bar > Permissions > Microphone > Allow.',
    'If it is still blocked, open Android Settings > Apps > Chrome (or your browser) > Permissions > Microphone > Allow.',
    'Come back and tap Turn On Mic.',
  ];
  return [
    'Click the icon at the left of the address bar and set Microphone to Allow for this site.',
    'If that does not help, let the browser use the microphone in your system privacy settings (macOS: System Settings > Privacy & Security > Microphone; Windows: Settings > Privacy & security > Microphone).',
    'Press Turn On Mic (reload the page if no prompt appears).',
  ];
}
function stepsList() { const ol = el('ol', 'mic-steps'); for (const t of micSteps()) ol.appendChild(el('li', '', t)); return ol; }
// navigator.audioSession exists on Safari 16.4+ only; elsewhere these are no-ops.
function setSession(type) { try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch {} }
// switching the session can interrupt running audio on iOS; nudge the game's audio back on
function resumeAudio() { try { const b = buses && buses(); if (b && b.ac && b.ac.state !== 'running') b.ac.resume().catch(() => {}); } catch {} }
function micShort(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Microphone permission is off. See Voice Chat for how to turn it on.';
  if (n === 'NotReadableError' || n === 'AbortError' || n === 'TrackStartError') return 'Your microphone is busy in another app.';
  if (n === 'NotSupportedError' || n === 'SecureContextError') return 'This browser cannot share the microphone.';
  return 'No microphone was found. You can still listen.';
}
function micHelp(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return micCtx() === 'ios-app' ? 'Microphone is off for the Home Screen app. You can still listen. To turn it on:' : 'Microphone is blocked. You can still listen. To turn it on:';
  if (n === 'NotReadableError' || n === 'AbortError' || n === 'TrackStartError') return 'Another app is using the microphone (a call, a voice memo or another browser tab). Close it, then tap Turn On Mic. You can still listen.';
  if (n === 'SecureContextError') return 'Voice needs the secure site. Open https://dianteclark.github.io/Chess-Complex/ and try again.';
  if (n === 'NotSupportedError') return INAPP ? 'This in-app browser cannot use the microphone. Open the game in Safari or Chrome (use the menu > Open in browser), then join voice again. You can still listen.' : 'This browser cannot share the microphone. Try Safari on iPhone or Chrome on Android. You can still listen.';
  return 'No microphone was found on this device. You can still listen to others.';
}

export const voice = new Voice();
onCtxSwap((ac) => voice.rewire(ac)); // AU 15.0
