// 17.0 (A0): ellipse() throws IndexSizeError on a negative radius, and an effect easing past its end (or a radius
// computed from a shrinking size) can produce one for a single frame, killing the whole frame. Clamp instead.
// Imported first by main.js so every canvas in the app is covered. Cost: one Math.max pair per call.
for (const P of [typeof CanvasRenderingContext2D !== 'undefined' && CanvasRenderingContext2D.prototype, typeof OffscreenCanvasRenderingContext2D !== 'undefined' && OffscreenCanvasRenderingContext2D.prototype, typeof Path2D !== 'undefined' && Path2D.prototype]) {
  if (!P || !P.ellipse || P.ellipse.__cc) continue;
  const raw = P.ellipse;
  const safe = function (x, y, rx, ry, rot, a0, a1, ccw) { return raw.call(this, x, y, rx > 0 ? rx : 0, ry > 0 ? ry : 0, rot, a0, a1, ccw); };
  safe.__cc = 1; P.ellipse = safe;
  if (P.arc && !P.arc.__cc) { const rawA = P.arc; const sa = function (x, y, r, a0, a1, ccw) { return rawA.call(this, x, y, r > 0 ? r : 0, a0, a1, ccw); }; sa.__cc = 1; P.arc = sa; }
}
