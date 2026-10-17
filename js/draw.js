// draw.js — canvas drawing (browser only): one frame of the countdown leader, and a still image of the slate.

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace';

/**
 * Draw one leader frame. `f` comes from leaderSchedule(): { frame, number, progress, pop }.
 * Look: charcoal field, thin reticle, two rings, an amber sweep that fills clockwise during each
 * second, and the digit in the centre. Frames after the 2-pop are pure black (as on a real leader).
 */
export function drawLeaderFrame(ctx, w, h, f, info) {
  ctx.save();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  if (f.number == null) { ctx.restore(); return; }
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.36, u = Math.min(w, h) / 720;
  // field: subtle vertical gradient
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a2c31'); g.addColorStop(1, '#16171a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // sweep (amber wedge growing clockwise from 12 o'clock)
  if (!f.pop) {
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r * 1.02, -Math.PI / 2, -Math.PI / 2 + f.progress * Math.PI * 2); ctx.closePath();
    ctx.fillStyle = 'rgba(255, 190, 70, 0.32)'; ctx.fill();
  }
  // reticle and rings
  ctx.strokeStyle = f.pop ? '#fff' : 'rgba(240,240,235,.75)'; ctx.lineWidth = 3 * u;
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
  ctx.lineWidth = 6 * u; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2); ctx.stroke();
  // tick marks every 30°
  for (let a = 0; a < 12; a++) {
    const t = (a / 12) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    ctx.beginPath(); ctx.moveTo(cx + c * r * 1.06, cy + s * r * 1.06); ctx.lineTo(cx + c * r * 1.14, cy + s * r * 1.14); ctx.stroke();
  }
  // digit on a dark disc
  ctx.fillStyle = f.pop ? '#fff' : '#0d0e10';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = f.pop ? '#000' : '#f4f1e8';
  ctx.font = `800 ${Math.round(r * 0.95)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(f.number), cx, cy + r * 0.04);
  // corner captions
  ctx.font = `600 ${Math.round(22 * u)}px ${MONO}`; ctx.fillStyle = 'rgba(244,241,232,.85)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText((info.text || '').slice(0, 40), 28 * u, 24 * u);
  ctx.textAlign = 'right'; ctx.fillText(`${info.fpsLabel} FPS`, w - 28 * u, 24 * u);
  ctx.textBaseline = 'bottom'; ctx.fillText(`${String(f.frame).padStart(3, '0')} / ${info.total}`, w - 28 * u, h - 22 * u);
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,190,70,.9)'; ctx.fillText('CLAQUETTE ATELIER', 28 * u, h - 22 * u);
  ctx.restore();
}

/** Draw a still image of the slate (for the PNG export). `rows` = [[label, value], …]. */
export function drawSlate(ctx, w, h, { tc, info, rows, big }) {
  ctx.save();
  ctx.fillStyle = '#050506'; ctx.fillRect(0, 0, w, h);
  const u = w / 1920, stickH = 90 * u;
  // clapper sticks: diagonal stripes
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, stickH); ctx.clip();
  for (let x = -stickH * 2, i = 0; x < w + stickH; x += 70 * u, i++) {
    ctx.fillStyle = i % 2 ? '#0a0a0a' : '#fdfdf8';
    ctx.beginPath(); ctx.moveTo(x, stickH); ctx.lineTo(x + 70 * u, stickH); ctx.lineTo(x + 70 * u + stickH * 0.7, 0); ctx.lineTo(x + stickH * 0.7, 0); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = '#fdfdf8'; ctx.lineWidth = 4 * u; ctx.strokeRect(2 * u, 2 * u, w - 4 * u, h - 4 * u);
  ctx.beginPath(); ctx.moveTo(0, stickH); ctx.lineTo(w, stickH); ctx.stroke();
  // timecode
  ctx.fillStyle = '#ff4b3e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(210 * u)}px ${MONO}`; ctx.fillText(tc, w / 2, stickH + 150 * u);
  ctx.fillStyle = '#c9ced8'; ctx.font = `500 ${Math.round(30 * u)}px ${MONO}`; ctx.fillText(info, w / 2, stickH + 275 * u);
  let y = stickH + 310 * u;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  // big boxes: scene / shot / take
  const bw = w / big.length;
  big.forEach(([label, value], i) => {
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = '#b8bdc7'; ctx.font = `600 ${Math.round(28 * u)}px ${FONT}`;
    ctx.fillText(label.toUpperCase(), i * bw + 24 * u, y + 16 * u);
    ctx.fillStyle = '#fdfdf8'; ctx.font = `800 ${Math.round(150 * u)}px ${MONO}`; ctx.fillText(fit(ctx, value, bw - 48 * u), i * bw + 24 * u, y + 56 * u);
    if (i) { ctx.beginPath(); ctx.moveTo(i * bw, y); ctx.lineTo(i * bw, y + 230 * u); ctx.stroke(); }
  });
  y += 230 * u; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  // other fields, 3 per row
  const cols = 3, cw = w / cols, rh = (h - y) / Math.ceil(rows.length / cols);
  rows.forEach(([label, value], i) => {
    const cxp = (i % cols) * cw, cyp = y + Math.floor(i / cols) * rh;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#b8bdc7'; ctx.font = `600 ${Math.round(24 * u)}px ${FONT}`; ctx.fillText(label.toUpperCase(), cxp + 24 * u, cyp + 14 * u);
    ctx.fillStyle = '#fdfdf8'; ctx.font = `600 ${Math.round(46 * u)}px ${FONT}`; ctx.fillText(fit(ctx, value || '—', cw - 48 * u), cxp + 24 * u, cyp + 48 * u);
    ctx.lineWidth = 1.5 * u; ctx.strokeStyle = '#3a3d44'; ctx.strokeRect(cxp, cyp, cw, rh);
  });
  ctx.restore();
}

// shorten a string with "…" until it fits in maxW pixels
function fit(ctx, s, maxW) {
  s = String(s ?? '');
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
