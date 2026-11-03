// 15.2: keep the phone screen awake during lobbies and matches (owner report: "the screen times out").
// Uses the Screen Wake Lock API where available, plus the classic silent looping video fallback for iPhones where
// the API is missing or does not work in Home Screen apps. Both start only after a tap, as browsers require.
let want = false, lock = null, video = null, pending = false;
// iPhone Home Screen apps can report a wake lock that does not actually hold, so iOS always runs the video too
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function startVideo() {
  if (!video) {
    video = document.createElement('video');
    video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.muted = true; video.loop = true;
    video.src = 'media/keepawake.mp4';
    video.setAttribute('aria-hidden', 'true');
    Object.assign(video.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0.01', pointerEvents: 'none', left: '0', top: '0' });
    document.body.appendChild(video);
  }
  if (video.paused) video.play().catch(() => {});
}
function stopVideo() { if (video && !video.paused) video.pause(); }

async function acquire() {
  if (!want || document.hidden || pending) return;
  if (IOS) startVideo();
  if ('wakeLock' in navigator) {
    if (lock && !lock.released) return;
    pending = true;
    try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
    catch { lock = null; startVideo(); } // denied or unsupported here (e.g. some Home Screen apps): use the video
    finally { pending = false; }
    if (!want) release();
  } else startVideo();
}
function release() { try { lock && lock.release(); } catch {} lock = null; stopVideo(); }

export function keepAwake(on) {
  on = !!on; if (on === want) { if (on) acquire(); return; }
  want = on; if (on) acquire(); else release();
}
// browsers drop the lock when the page is hidden; take it back when we return, and retry from any tap
document.addEventListener('visibilitychange', () => { if (!document.hidden && want) acquire(); });
document.addEventListener('pointerdown', () => { if (want) { if ((!lock || lock.released) && !('wakeLock' in navigator)) startVideo(); acquire(); } }, true);
