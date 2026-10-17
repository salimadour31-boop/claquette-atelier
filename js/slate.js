// slate.js — pure logic for Claquette Atelier (no DOM): frame rates, timecode math (incl. drop-frame),
// take numbering, take-log CSV/JSON export and the countdown-leader frame schedule.
// Imported by the browser app and by the Node unit tests (tests/slate.test.js).

// ---------- frame rates ----------
// rate = real frames per second; nominal = frames per timecode "second" (labels); df = drop-frame.
export const FPS = [
  { id: '23.976', rate: 24000 / 1001, nominal: 24, df: false, label: '23.976' },
  { id: '24', rate: 24, nominal: 24, df: false, label: '24' },
  { id: '25', rate: 25, nominal: 25, df: false, label: '25' },
  { id: '29.97df', rate: 30000 / 1001, nominal: 30, df: true, label: '29.97 DF' },
  { id: '29.97', rate: 30000 / 1001, nominal: 30, df: false, label: '29.97 NDF' },
  { id: '30', rate: 30, nominal: 30, df: false, label: '30' },
  { id: '50', rate: 50, nominal: 50, df: false, label: '50' },
  { id: '60', rate: 60, nominal: 60, df: false, label: '60' },
];
export const getFps = id => FPS.find(f => f.id === String(id)) || FPS[2];

// Drop-frame: 2 labels (4 at 60 nominal) are skipped every minute except every tenth minute.
const dropCount = fps => (fps.df ? Math.round(fps.nominal / 15) : 0);

/** Number of distinct timecode labels (frames) in 24 hours of timecode. */
export function framesPerDay(fps) {
  const d = dropCount(fps);
  if (!d) return fps.nominal * 86400;
  return 24 * 6 * (fps.nominal * 600 - 9 * d); // 24 h × 6 ten-minute blocks
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const mod = (a, b) => ((a % b) + b) % b;

/** Frame count → "HH:MM:SS:FF" (";" before frames for drop-frame). Wraps around at 24 h. */
export function framesToTC(frames, fps) {
  let n = mod(Math.floor(frames), framesPerDay(fps));
  const d = dropCount(fps), N = fps.nominal;
  if (d) {
    const per10 = N * 600 - 9 * d, perMin = N * 60 - d;
    const blocks = Math.floor(n / per10), rem = n % per10;
    n += 9 * d * blocks + (rem > d ? d * Math.floor((rem - d) / perMin) : 0);
  }
  const ff = n % N, s = Math.floor(n / N);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}${d ? ';' : ':'}${pad(ff)}`;
}

/** Timecode label parts → frame count. Labels that do not exist in drop-frame are moved to the next valid one. */
export function partsToFrames(h, m, s, f, fps) {
  const d = dropCount(fps), N = fps.nominal;
  if (d && s === 0 && m % 10 !== 0 && f < d) f = d;
  const totalMin = 60 * h + m;
  return (totalMin * 60 + s) * N + f - d * (totalMin - Math.floor(totalMin / 10));
}

/** Parse "HH:MM:SS:FF" (":" ";" "." separators, or 8 digits). Returns a frame count, or null if invalid. */
export function tcToFrames(str, fps) {
  const t = String(str ?? '').trim();
  let p = t.split(/[:;.,]/);
  if (p.length === 1 && /^\d{1,8}$/.test(t)) p = t.padStart(8, '0').match(/\d\d/g);
  if (p.length !== 4 || p.some(x => !/^\d{1,2}$/.test(x))) return null;
  const [h, m, s, f] = p.map(Number);
  if (h > 23 || m > 59 || s > 59 || f >= fps.nominal) return null;
  return partsToFrames(h, m, s, f, fps);
}

/** Time of day (hours, minutes, seconds, milliseconds) → frame count of the matching timecode label. */
export function clockToFrames(h, m, s, ms, fps) {
  return partsToFrames(h, m, s, Math.min(fps.nominal - 1, Math.floor((ms / 1000) * fps.nominal)), fps);
}

/** Running timecode: frames reached `elapsedMs` after being jammed at `jamFrames`, at the real frame rate. */
export function runningFrames(jamFrames, elapsedMs, fps) {
  return mod(jamFrames + Math.floor((Math.max(0, elapsedMs) / 1000) * fps.rate + 1e-9), framesPerDay(fps));
}

/** Duration in milliseconds of `n` frames (used for the clap flash and the 2-pop). */
export const framesToMs = (n, fps) => (n * 1000) / fps.rate;

// ---------- takes ----------
/** Next take: trailing number +1 keeping zero-padding ("07"→"08", "T9"→"T10"), single trailing letter +1 ("A"→"B"), empty → "1". */
export function nextTake(take) {
  const t = String(take ?? '').trim();
  if (!t) return '1';
  const m = t.match(/^(.*?)(\d+)$/);
  if (m) return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0');
  const l = t.match(/^(.*?)([A-Ya-y])$/);
  if (l) return l[1] + String.fromCharCode(l[2].charCodeAt(0) + 1);
  return t + '2';
}

// ---------- export ----------
export const CSV_COLUMNS = ['n', 'production', 'roll', 'scene', 'shot', 'take', 'timecode', 'fps', 'time', 'intExt', 'dayNight', 'sound', 'rating', 'circled', 'note'];

/** One CSV field (RFC 4180): quoted when it contains a quote, separator or line break; quotes doubled.
 *  Text starting with = + - @ (spreadsheet formulas) is prefixed with ' so it is not executed. */
export function csvField(v, sep = ',') {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s.includes('"') || s.includes(sep) || /[\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Take list → CSV text (header + one line per take, CRLF line endings). */
export function takesToCSV(takes, sep = ',') {
  const lines = [CSV_COLUMNS.join(sep)];
  takes.forEach((t, i) => lines.push(CSV_COLUMNS.map(c => csvField(c === 'n' ? i + 1 : c === 'circled' ? (t.circled ? 'yes' : '') : t[c], sep)).join(sep)));
  return lines.join('\r\n') + '\r\n';
}

/** Take list → pretty JSON document (with app name and export date). */
export function takesToJSON(takes, slate = {}, now = new Date()) {
  return JSON.stringify({ app: 'claquette-atelier', version: 1, exported: now.toISOString(), slate, takes }, null, 2);
}

// ---------- countdown leader ----------
/**
 * Frame-by-frame schedule of a countdown leader: numbers 8 → 3 one second each (one "second" =
 * nominal frames), then the "2" shown for exactly ONE frame with the 2-pop beep, then black until
 * the first frame of action, 2 seconds after the pop. Returns { frames, popFrame, total, popTime, popMs }.
 */
export function leaderSchedule(fps, { from = 8 } = {}) {
  const N = fps.nominal, frames = [];
  const popFrame = (from - 2) * N, total = from * N;
  for (let i = 0; i < total; i++) {
    if (i < popFrame) {
      const k = Math.floor(i / N);
      frames.push({ frame: i, number: from - k, progress: (i % N) / N, pop: false });
    } else frames.push({ frame: i, number: i === popFrame ? 2 : null, progress: 0, pop: i === popFrame });
  }
  return { frames, popFrame, total, popTime: popFrame / fps.rate, popMs: framesToMs(1, fps) };
}

// ---------- misc ----------
/** Safe file name for exports: "claquette-sc12-pl3-pr4". */
export function slug(...parts) {
  return parts.filter(p => p !== '' && p != null).join('-').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 80) || 'claquette';
}
