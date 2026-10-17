// app.js — UI of Claquette Atelier: slate fields, running timecode, CLAP (flash + beep + log),
// take log (CSV/JSON), countdown leader (canvas preview + WebM export), slate PNG, wake lock, PWA.
import { FPS, getFps, framesToTC, tcToFrames, clockToFrames, partsToFrames, runningFrames, framesToMs,
  nextTake, takesToCSV, takesToJSON, leaderSchedule, slug } from './slate.js';
import { STR } from './i18n.js';
import { drawLeaderFrame, drawSlate } from './draw.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const KEY = 'claquette-atelier:v1';
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// ---------- persistent state (localStorage) ----------
const DEFAULT = {
  lang: 'fr', view: 'slate',
  slate: { production: '', director: '', camera: '', roll: 'A001', scene: '1', shot: '1', take: '1', date: today(), fps: '25', intExt: 'INT', dayNight: 'DAY', sound: 'SYNC', notes: '' },
  opts: { countdown: false, autoinc: true, flashFrames: 3, wake: false, tcMode: 'tod', tcStart: '01:00:00:00', jamFrames: 0, jamEpoch: 0, leaderText: '' },
  takes: [],
};
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULT, ...s, slate: { ...DEFAULT.slate, ...s.slate }, opts: { ...DEFAULT.opts, ...s.opts }, takes: Array.isArray(s.takes) ? s.takes : [] };
  } catch { return structuredClone(DEFAULT); }
}
const state = loadState();
if (!STR[state.lang]) state.lang = 'fr';
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or disabled */ } };
const T = (k, n) => String(STR[state.lang][k] ?? STR.fr[k] ?? k).replace('{n}', n ?? '');
const fps = () => getFps(state.slate.fps);
const say = msg => { $('#live').textContent = ''; requestAnimationFrame(() => { $('#live').textContent = msg; }); };
window.__claquette = { state, currentFrames: () => currentFrames() }; // exposed for the end-to-end test

// ---------- language ----------
function applyLang() {
  document.documentElement.lang = state.lang;
  $$('[data-i18n]').forEach(el => { el.textContent = T(el.dataset.i18n); });
  $$('[data-i18n-ph]').forEach(el => { el.placeholder = T(el.dataset.i18nPh); });
  $$('[data-i18n-label]').forEach(el => { el.setAttribute('aria-label', T(el.dataset.i18nLabel)); el.title = T(el.dataset.i18nLabel); });
  $$('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
  updateFsButton(); renderInfo(); renderLog();
}
$$('.lang button').forEach(b => b.addEventListener('click', () => { state.lang = b.dataset.lang; save(); applyLang(); }));

// ---------- tabs ----------
function showView(v) {
  state.view = v; save();
  $$('.tabs [role=tab]').forEach(t => { const on = t.dataset.view === v; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
  $$('.view').forEach(s => { s.hidden = s.id !== 'view-' + v; });
  if (v === 'leader') drawLeaderStill();
}
$$('.tabs [role=tab]').forEach((t, i, all) => {
  t.addEventListener('click', () => showView(t.dataset.view));
  t.addEventListener('keydown', e => {   // arrow keys move between tabs (WAI-ARIA tabs pattern)
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length]; n.focus(); showView(n.dataset.view);
  });
});

// ---------- slate fields ----------
const fpsOptions = FPS.map(f => `<option value="${f.id}">${f.label}</option>`).join('');
$('#f-fps').innerHTML = fpsOptions; $('#leaderFps').innerHTML = fpsOptions;
$$('[data-field]').forEach(el => {
  el.value = state.slate[el.dataset.field] ?? '';
  el.addEventListener('input', () => {
    const k = el.dataset.field, before = fps();
    state.slate[k] = el.value; save();
    if (k === 'fps') { refps(before); $('#leaderFps').value = el.value; drawLeaderStill(); }
  });
});
$('#leaderFps').value = state.slate.fps;
const setTake = v => { state.slate.take = v; $('#f-take').value = v; save(); };
$('#takePlus').addEventListener('click', () => setTake(nextTake(state.slate.take)));
$('#takeMinus').addEventListener('click', () => {
  const m = String(state.slate.take).match(/^(.*?)(\d+)$/);
  if (m && Number(m[2]) > 1) setTake(m[1] + String(Number(m[2]) - 1).padStart(m[2].length, '0'));
});

// ---------- timecode engine ----------
// The timecode is "jammed" to a frame count at an instant, then runs at the real frame rate
// (23.976 and 29.97 NDF therefore drift 3.6 s/hour against the wall clock, like real gear).
const tc = { jamFrames: 0, jamAt: 0, frozenUntil: 0, shown: '' };
function jamTo(frames, epoch = Date.now()) {
  tc.jamFrames = frames; tc.jamAt = performance.now() - (Date.now() - epoch);
  state.opts.jamFrames = frames; state.opts.jamEpoch = epoch; save();
}
function jamToClock() { const d = new Date(); jamTo(clockToFrames(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds(), fps()), d.getTime()); }
const currentFrames = () => runningFrames(tc.jamFrames, performance.now() - tc.jamAt, fps());
function refps(before) {   // frame rate changed: keep the same label (clamping the frames field)
  if (state.opts.tcMode === 'tod') jamToClock();
  else {
    const [h, m, s, f] = framesToTC(runningFrames(tc.jamFrames, performance.now() - tc.jamAt, before), before).split(/[:;]/).map(Number);
    jamTo(partsToFrames(h, m, s, Math.min(f, fps().nominal - 1), fps()));
  }
  renderInfo();
}
function startTimecode() {
  $$('[name=tcMode]').forEach(r => { r.checked = r.value === state.opts.tcMode; });
  $('#tcStart').value = state.opts.tcStart;
  if (state.opts.tcMode === 'jam' && state.opts.jamEpoch) jamTo(state.opts.jamFrames, state.opts.jamEpoch);
  else if (state.opts.tcMode === 'jam') doJam(); else jamToClock();
}
function doJam() {
  if (state.opts.tcMode === 'tod') { jamToClock(); say(T('jammed', framesToTC(currentFrames(), fps()))); return; }
  const n = tcToFrames($('#tcStart').value, fps());
  $('#tcStart').setAttribute('aria-invalid', String(n == null));
  if (n == null) { say(T('tcInvalid')); return; }
  state.opts.tcStart = $('#tcStart').value.trim(); jamTo(n); say(T('jammed', framesToTC(n, fps())));
}
$$('[name=tcMode]').forEach(r => r.addEventListener('change', () => { state.opts.tcMode = r.value; save(); doJam(); renderInfo(); }));
$('#jam').addEventListener('click', doJam);
$('#tcStart').addEventListener('keydown', e => { if (e.key === 'Enter') doJam(); });
function renderInfo() {
  const f = fps();
  $('#tcInfo').textContent = `${f.label} fps · ${state.opts.tcMode === 'tod' ? T('tcTod') : T('tcJam')}`;
  const last = state.takes[state.takes.length - 1];
  $('#lastClap').textContent = last ? `${T('lastClap')} ${last.timecode} (${last.scene}/${last.shot}/${last.take})` : '';
  $('#logBadge').textContent = state.takes.length;
}
function tick() {   // display loop: update the label only when it changes
  if (performance.now() >= tc.frozenUntil) {
    const s = framesToTC(currentFrames(), fps());
    if (s !== tc.shown) { $('#tc').textContent = s; tc.shown = s; $('#tc').classList.remove('frozen'); }
  }
  requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.opts.tcMode === 'tod') jamToClock(); });

// ---------- audio (Web Audio, no files) ----------
let actx = null;
function audio() {
  if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
/** Sine tone with a 1 ms attack/release (sharp but click-free), starting at `when`. */
function tone(ctx, dest, freq, when, dur, gain = 0.6) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(gain, when + 0.001);
  g.gain.setValueAtTime(gain, Math.max(when + 0.001, when + dur - 0.001)); g.gain.linearRampToValueAtTime(0, when + dur);
  o.connect(g).connect(dest); o.start(when); o.stop(when + dur + 0.01);
}
/** Clap sound: a short white-noise "click" transient plus a 2 kHz beep lasting the flash duration. */
function clapSound(durMs) {
  const ctx = audio(); if (!ctx) return 0;
  const t = ctx.currentTime + 0.005, len = Math.floor(ctx.sampleRate * 0.012);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = ctx.createBufferSource(), g = ctx.createGain(); g.gain.value = 0.9;
  src.buffer = buf; src.connect(g).connect(ctx.destination); src.start(t);
  tone(ctx, ctx.destination, 2000, t, durMs / 1000, 0.55);
  return ((ctx.outputLatency || ctx.baseLatency || 0) + 0.005) * 1000;   // ms until the sound is heard
}

// ---------- CLAP ----------
let busy = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function clap() {
  if (busy) return; busy = true; $('#clap').disabled = true;
  const ctx = audio();
  if (state.opts.countdown) {
    const c = $('#count'); c.hidden = false;
    for (const n of [3, 2, 1]) { c.textContent = n; if (ctx) tone(ctx, ctx.destination, 1000, ctx.currentTime + 0.005, 0.1, 0.4); await sleep(1000); }
    c.hidden = true;
  }
  const f = fps(), n = Number(state.opts.flashFrames) || 3, dur = framesToMs(n, f);
  const delay = clapSound(dur);
  await sleep(Math.max(0, delay - 8));          // align the flash with the moment the beep is heard
  const frames = currentFrames(), label = framesToTC(frames, f);
  flash(dur);
  tc.frozenUntil = performance.now() + 2000; tc.shown = ''; $('#tc').textContent = label; $('#tc').classList.add('frozen');
  const board = $('#board'); board.classList.add('clapped'); setTimeout(() => board.classList.remove('clapped'), 700);
  logTake(label);
  if (state.opts.autoinc) setTake(nextTake(state.slate.take));
  setTimeout(() => { busy = false; $('#clap').disabled = false; }, 400);
}
/** Full-screen white flash for `ms` milliseconds (= the chosen number of frames), timed on display frames. */
function flash(ms) {
  const el = $('#flash'), t0 = performance.now(); el.hidden = false;
  const step = () => { if (performance.now() - t0 >= ms - 4) el.hidden = true; else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
$('#clap').addEventListener('click', clap);
$('#board').addEventListener('click', e => { if (!e.target.closest('input, select, button, label, textarea, .f')) clap(); });
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' && e.key !== ' ') return;
  if (e.target.closest && e.target.closest('input, select, textarea, button, [contenteditable]')) return;
  if ($('#view-slate').hidden) return;
  e.preventDefault(); clap();
});

// ---------- take log ----------
function logTake(label) {
  const d = new Date(), s = state.slate;
  state.takes.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    production: s.production, roll: s.roll, scene: s.scene, shot: s.shot, take: s.take, timecode: label, fps: fps().label,
    time: `${s.date || today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    intExt: s.intExt, dayNight: s.dayNight, sound: s.sound, rating: '', circled: false, note: s.notes,
  });
  save(); renderLog(); renderInfo(); say(T('logged', s.take));
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function renderLog() {
  const list = $('#takes'); if (!list) return;
  $('#takesCount').textContent = T('takesCount', state.takes.length);
  $('#emptyLog').hidden = state.takes.length > 0;
  list.innerHTML = state.takes.slice().reverse().map(t => `
    <li class="tk ${t.rating} ${t.circled ? 'circled' : ''}" data-id="${esc(t.id)}">
      <div><div class="id">${esc(T('scene'))} ${esc(t.scene)} · ${esc(T('shot'))} ${esc(t.shot)} · ${esc(T('take'))} <span class="circ">${esc(t.take)}</span></div>
      <div class="meta"><b>${esc(t.timecode)}</b> · ${esc(t.fps)} fps · ${esc(t.time)} · ${esc(t.roll)} · ${esc(t.intExt)} ${esc(t.dayNight)} · ${esc(t.sound)}</div></div>
      <div class="btns">
        <button type="button" class="g" data-act="good" aria-pressed="${t.rating === 'good'}">✓ ${esc(T('good'))}</button>
        <button type="button" class="n" data-act="ng" aria-pressed="${t.rating === 'ng'}">✕ ${esc(T('ng'))}</button>
        <button type="button" class="c" data-act="circle" aria-pressed="${!!t.circled}" aria-label="${esc(T('circle'))}" title="${esc(T('circle'))}">◯</button>
        <button type="button" data-act="del" aria-label="${esc(T('del'))}" title="${esc(T('del'))}">🗑</button>
      </div>
      <input type="text" data-act="note" value="${esc(t.note)}" placeholder="${esc(T('note'))}" aria-label="${esc(T('notes'))}">
    </li>`).join('');
}
$('#takes').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('li').dataset.id, i = state.takes.findIndex(t => t.id === id); if (i < 0) return;
  const t = state.takes[i], a = b.dataset.act;
  if (a === 'good' || a === 'ng') t.rating = t.rating === a ? '' : a;
  if (a === 'circle') { t.circled = !t.circled; if (t.circled && !t.rating) t.rating = 'good'; }
  if (a === 'del') state.takes.splice(i, 1);
  save(); renderLog(); renderInfo();
});
$('#takes').addEventListener('change', e => {
  if (e.target.dataset.act !== 'note') return;
  const t = state.takes.find(x => x.id === e.target.closest('li').dataset.id); if (t) { t.note = e.target.value; save(); }
});
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const baseName = () => slug('prises', state.slate.production, state.slate.date || today());
$('#expCsv').addEventListener('click', () => download(new Blob(['\uFEFF' + takesToCSV(state.takes)], { type: 'text/csv;charset=utf-8' }), baseName() + '.csv'));
$('#expJson').addEventListener('click', () => download(new Blob([takesToJSON(state.takes, state.slate)], { type: 'application/json' }), baseName() + '.json'));
$('#clearLog').addEventListener('click', () => { if (state.takes.length && confirm(T('confirmClear'))) { state.takes = []; save(); renderLog(); renderInfo(); } });

// ---------- options ----------
const bindChk = (id, key) => { const el = $(id); el.checked = !!state.opts[key]; el.addEventListener('change', () => { state.opts[key] = el.checked; save(); }); };
bindChk('#countdown', 'countdown'); bindChk('#autoinc', 'autoinc');
$('#flashFrames').value = String(state.opts.flashFrames);
$('#flashFrames').addEventListener('change', e => { state.opts.flashFrames = Number(e.target.value); save(); });

// ---------- wake lock ----------
let lock = null;
async function setWake(on) {
  state.opts.wake = on; save();
  if (!('wakeLock' in navigator)) return;
  try {
    if (on && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
    if (!on && lock) { await lock.release(); lock = null; }
  } catch { lock = null; }   // refused (battery saver, no user gesture…): stays unchecked next time
}
if (!('wakeLock' in navigator)) { $('#wake').disabled = true; $('#wake').closest('label').title = T('wakeNA'); }
$('#wake').checked = !!state.opts.wake && 'wakeLock' in navigator;
$('#wake').addEventListener('change', e => setWake(e.target.checked));
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.opts.wake) setWake(true); });
if (state.opts.wake) document.addEventListener('pointerdown', () => setWake(true), { once: true });

// ---------- fullscreen ----------
// The whole page goes fullscreen (so the white flash and the countdown overlay stay visible) and the
// board is stretched over it with CSS; where the Fullscreen API is missing (iPhone) only the CSS part applies.
const isFs = () => $('#board').classList.contains('pseudo-fs');
let realFs = false;
function toggleFs() {
  const b = $('#board'), de = document.documentElement;
  if (isFs()) {
    b.classList.remove('pseudo-fs');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
    realFs = false;
  } else {
    b.classList.add('pseudo-fs');
    const req = de.requestFullscreen ? de.requestFullscreen() : de.webkitRequestFullscreen ? de.webkitRequestFullscreen() : null;
    if (req && req.then) req.then(() => { realFs = true; }).catch(() => {}); else if (req !== null) realFs = true;
    if ('wakeLock' in navigator && !state.opts.wake) { $('#wake').checked = true; setWake(true); }
  }
  updateFsButton();
}
function updateFsButton() { $('#fs').textContent = isFs() ? T('exitFullscreen') : T('fullscreen'); }
$('#fs').addEventListener('click', toggleFs);
$('#fsClose').addEventListener('click', toggleFs);
const onFsChange = () => { if (realFs && !document.fullscreenElement && !document.webkitFullscreenElement) { realFs = false; $('#board').classList.remove('pseudo-fs'); updateFsButton(); } };
document.addEventListener('fullscreenchange', onFsChange); document.addEventListener('webkitfullscreenchange', onFsChange);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && isFs()) toggleFs(); });

// ---------- countdown leader ----------
const cv = $('#leader'), cctx = cv.getContext('2d');
const lfps = () => getFps($('#leaderFps').value);
const linfo = s => ({ text: $('#leaderText').value || state.slate.production, fpsLabel: lfps().label, total: s.total });
function sizeLeader() { const [w, h] = $('#leaderRes').value.split('x').map(Number); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } }
function drawLeaderStill() { sizeLeader(); const s = leaderSchedule(lfps()); drawLeaderFrame(cctx, cv.width, cv.height, s.frames[Math.floor(lfps().nominal * 0.35)], linfo(s)); }
$('#leaderText').value = state.opts.leaderText;
$('#leaderText').addEventListener('input', e => { state.opts.leaderText = e.target.value; save(); drawLeaderStill(); });
['#leaderFps', '#leaderRes'].forEach(id => $(id).addEventListener('change', drawLeaderStill));
let playing = null;
/** Play the leader in real time on the canvas; the 2-pop goes to `dest` (speakers or the recorder). */
function runLeader(dest, onEnd) {
  sizeLeader();
  const f = lfps(), s = leaderSchedule(f), ctx = audio(), info = linfo(s);
  const start = performance.now() + 60;
  if (ctx) tone(ctx, dest || ctx.destination, 1000, ctx.currentTime + 0.06 + s.popTime, s.popMs / 1000, 0.7);
  let last = -1;
  const step = () => {
    if (!playing) return;
    const i = Math.floor(((performance.now() - start) / 1000) * f.rate);
    if (i >= s.total) { drawLeaderFrame(cctx, cv.width, cv.height, { frame: s.total, number: null }, info); playing = null; onEnd && onEnd(); return; }
    if (i >= 0 && i !== last) { drawLeaderFrame(cctx, cv.width, cv.height, s.frames[i], info); last = i; if (playing.track && playing.track.requestFrame) playing.track.requestFrame(); }
    playing.raf = requestAnimationFrame(step);
  };
  playing = playing || {}; playing.raf = requestAnimationFrame(step);
  return s;
}
function stopLeader() { if (playing) { cancelAnimationFrame(playing.raf); if (playing.rec && playing.rec.state !== 'inactive') { playing.rec.cancelled = true; playing.rec.stop(); } playing = null; } setLeaderButtons(false); }
function setLeaderButtons(on) { $('#leaderPlay').textContent = on ? T('stop') : T('preview'); $('#leaderWebm').disabled = on; $('#slatePng').disabled = on; }
$('#leaderPlay').addEventListener('click', () => {
  if (playing) { stopLeader(); drawLeaderStill(); return; }
  playing = {}; setLeaderButtons(true); runLeader(null, () => setLeaderButtons(false));
});
const pickMime = () => (window.MediaRecorder && MediaRecorder.isTypeSupported
  ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) : null);
$('#leaderWebm').addEventListener('click', () => {
  const mime = pickMime(), ctx = audio();
  if (!mime || !cv.captureStream || !ctx || !ctx.createMediaStreamDestination) { $('#leaderStatus').textContent = T('noRecorder'); return; }
  const f = lfps(), video = cv.captureStream(0), track = video.getVideoTracks()[0];
  const useReq = !!(track && track.requestFrame);
  const vstream = useReq ? video : cv.captureStream(Math.round(f.rate));
  const dest = ctx.createMediaStreamDestination();
  const stream = new MediaStream([...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 }), chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(chunks, { type: 'video/webm' });
    if (blob.size && !rec.cancelled) { download(blob, `amorce-${f.id.replace('.', '_')}fps-${cv.width}x${cv.height}.webm`); $('#leaderStatus').textContent = T('webmDone', Math.round(blob.size / 1024) + ' Ko'); }
    setLeaderButtons(false); drawLeaderStill();
  };
  rec.start(250);
  playing = { rec, track: useReq ? track : null }; setLeaderButtons(true);
  const sched = runLeader(dest, () => setTimeout(() => rec.state !== 'inactive' && rec.stop(), 300));
  const t0 = performance.now(), total = sched.total / f.rate;
  const prog = setInterval(() => { if (rec.state === 'inactive') return clearInterval(prog); $('#leaderStatus').textContent = T('recording', `${Math.min(total, (performance.now() - t0) / 1000).toFixed(1)} / ${total.toFixed(1)} s`); }, 250);
});

// ---------- slate PNG ----------
$('#slatePng').addEventListener('click', () => {
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
  const s = state.slate, last = state.takes[state.takes.length - 1];
  const tcLabel = last ? last.timecode : framesToTC(currentFrames(), fps());
  const take = last && last.scene === s.scene && last.shot === s.shot ? last.take : s.take;   // the take that was just slated
  drawSlate(c.getContext('2d'), c.width, c.height, {
    tc: tcLabel, info: `${fps().label} FPS · ${s.intExt} · ${s.dayNight} · ${s.sound}`,
    big: [[T('scene'), s.scene], [T('shot'), s.shot], [T('take'), take]],
    rows: [[T('production'), s.production], [T('director'), s.director], [T('camera'), s.camera], [T('roll'), s.roll], [T('date'), s.date], [T('notes'), s.notes]],
  });
  c.toBlob(b => download(b, slug('claquette', s.production, 'sc' + s.scene, 'pl' + s.shot, 'pr' + take) + '.png'), 'image/png');
});

// ---------- PWA: offline cache ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').then(() => { $('#offline').hidden = false; }).catch(() => {});
}

// ---------- start ----------
startTimecode();
applyLang();
showView(['slate', 'log', 'leader'].includes(state.view) ? state.view : 'slate');
requestAnimationFrame(tick);
