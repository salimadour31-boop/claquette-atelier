// End-to-end test in a real browser (Playwright/Chromium): serves the site locally, then checks languages,
// running timecode, CLAP (flash duration, take logged, take incremented), spacebar, drop-frame display,
// take rating, CSV/JSON export, jam sync, persistence, WebM leader export, slate PNG, clearing the log,
// and the mobile layout (390×844, no horizontal overflow). Fails on any console error.
// Writes screenshot.png (desktop) and screenshot-mobile.png. Run: node tests/e2e.mjs  (CHROME=/path optional)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const errors = [];
const watch = page => {
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
};
async function dl(page, sel, timeout = 30000) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout }), page.click(sel)]);
  return { name: d.suggestedFilename(), buf: fs.readFileSync(await d.path()) };
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });

// ---------------- desktop ----------------
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage(); watch(page);
await page.goto(url);
await page.waitForFunction(() => /^\d\d:\d\d:\d\d[:;]\d\d$/.test(document.querySelector('#tc').textContent));
check(await page.getAttribute('html', 'lang') === 'fr', 'French by default');
check((await page.textContent('#tab-slate')) === 'Claquette', 'FR tab label');

// languages
await page.click('[data-lang=en]');
check((await page.textContent('#tab-log')).includes('Take log'), 'English labels');
check((await page.textContent('label:has(#f-scene) span')) === 'Scene', 'EN field label');
await page.click('[data-lang=kab]');
check(await page.getAttribute('html', 'lang') === 'kab', 'html lang=kab');
check((await page.textContent('#tab-log')).includes('Aɣmis n tuṭṭfiwin'), 'Taqbaylit labels');
check((await page.textContent('label[for=f-take]')) === 'Tuṭṭfa', 'KAB take label');
await page.click('[data-lang=fr]');
check((await page.textContent('#fs')) === 'Plein écran', 'back to French');

// running timecode (25 fps by default)
const tc1 = await page.textContent('#tc'); await page.waitForTimeout(300); const tc2 = await page.textContent('#tc');
check(tc1 !== tc2, `timecode runs (${tc1} → ${tc2})`);

// edit the slate
await page.fill('#f-production', 'Tamurt');
await page.fill('#f-director', 'A. Amwanes');
await page.fill('#f-camera', 'Cam A · 35 mm');
await page.fill('#f-scene', '12B');
await page.fill('#f-shot', '3');
await page.fill('#f-take', '7');
await page.fill('#f-notes', 'avion, bruit "fort"');

// CLAP: measure the flash with a MutationObserver
await page.evaluate(() => {
  window.__flash = [];
  new MutationObserver(() => window.__flash.push([document.querySelector('#flash').hidden, performance.now()]))
    .observe(document.querySelector('#flash'), { attributes: true, attributeFilter: ['hidden'] });
});
await page.click('#clap');
await page.waitForFunction(() => window.__claquette.state.takes.length === 1);
const t1 = await page.evaluate(() => window.__claquette.state.takes[0]);
check(t1.scene === '12B' && t1.shot === '3' && t1.take === '7', `take logged with scene/shot/take (${t1.scene}/${t1.shot}/${t1.take})`);
check(/^\d\d:\d\d:\d\d:\d\d$/.test(t1.timecode), `clap timecode ${t1.timecode}`);
check(await page.inputValue('#f-take') === '8', 'take auto-incremented to 8');
check((await page.textContent('#tc')) === t1.timecode && await page.$eval('#tc', e => e.classList.contains('frozen')), 'clap timecode frozen on screen');
await page.waitForFunction(() => window.__flash.length >= 2);
const fl = await page.evaluate(() => window.__flash);
const flashMs = fl[1][1] - fl[0][1];
check(fl[0][0] === false && fl[1][0] === true && flashMs > 90 && flashMs < 190, `white flash ≈ 3 frames at 25 fps = 120 ms (${flashMs.toFixed(0)} ms)`);
check((await page.textContent('#logBadge')) === '1', 'log badge = 1');

// spacebar clap (focus outside fields)
await page.waitForTimeout(500);
await page.evaluate(() => document.activeElement.blur());
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__claquette.state.takes.length === 2);
check(await page.inputValue('#f-take') === '9', 'spacebar clap logs take 8, next is 9');
// tap on the timecode
await page.waitForTimeout(500);
await page.click('#tc');
await page.waitForFunction(() => window.__claquette.state.takes.length === 3);
check(true, 'tap on the timecode claps');

// drop-frame display
await page.selectOption('#f-fps', '29.97df');
await page.waitForTimeout(2100);
check((await page.textContent('#tc')).includes(';'), `29.97 DF shows ";" (${await page.textContent('#tc')})`);
await page.selectOption('#f-fps', '25');

// jam sync to 01:00:00:00
await page.check('[name=tcMode][value=jam]');
await page.fill('#tcStart', '01:00:00:00');
await page.click('#jam');
await page.waitForTimeout(200);
check((await page.textContent('#tc')).startsWith('01:00:00:'), `jam sync to 01:00:00:00 (${await page.textContent('#tc')})`);
await page.fill('#tcStart', '01:00:00:30');
await page.click('#jam');
check(await page.getAttribute('#tcStart', 'aria-invalid') === 'true', 'invalid start timecode rejected (frame 30 at 25 fps)');

// take log: rating, circle, note
await page.click('#tab-log');
check(await page.$$eval('.tk', e => e.length) === 3, '3 takes listed');
await page.click('.tk:nth-child(3) [data-act=ng]');       // oldest take (7) is last in the list
await page.click('.tk:nth-child(2) [data-act=circle]');
await page.fill('.tk:nth-child(1) input', 'bonne, =SUM(A1)');
await page.press('.tk:nth-child(1) input', 'Tab');
const takes = await page.evaluate(() => window.__claquette.state.takes);
check(takes[0].rating === 'ng' && takes[1].circled && takes[1].rating === 'good' && takes[2].note === 'bonne, =SUM(A1)', 'rating / circle / note saved');

const csv = await dl(page, '#expCsv');
const lines = csv.buf.toString('utf8').replace(/^\uFEFF/, '').split('\r\n');
check(csv.name.endsWith('.csv') && lines[0].startsWith('n,production,roll,scene,shot,take,timecode'), `CSV header (${csv.name})`);
check(lines[1].startsWith(`1,Tamurt,A001,12B,3,7,${t1.timecode},25,`) && lines[1].endsWith(',ng,,"avion, bruit ""fort"""'), 'CSV row 1 (escaped note)');
check(lines[2].includes(',good,yes,'), 'CSV row 2 circled');
check(lines[3].endsWith(`"bonne, =SUM(A1)"`), 'CSV row 3 note quoted');
const json = JSON.parse((await dl(page, '#expJson')).buf.toString());
check(json.takes.length === 3 && json.slate.scene === '12B', 'JSON export');

// persistence after reload
await page.click('[data-lang=en]');
await page.reload();
await page.waitForFunction(() => window.__claquette);
check(await page.evaluate(() => window.__claquette.state.takes.length) === 3 && await page.inputValue('#f-scene') === '12B', 'takes and slate kept after reload');
check((await page.textContent('#tab-leader')) === 'Leader', 'language kept after reload');
check((await page.textContent('#tc')).startsWith('01:00:'), 'jam kept after reload');
await page.click('[data-lang=fr]');

// screenshot (desktop, slate)
await page.click('#tab-slate');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(root, 'screenshot.png') });

// leader: preview frame + WebM export with audio
await page.click('#tab-leader');
const lit = await page.evaluate(() => { const c = document.querySelector('#leader'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); });
check(lit > 20, `leader preview drawn (mean red ${lit.toFixed(0)})`);
const hasRec = await page.evaluate(() => !!window.MediaRecorder);
if (hasRec) {
  const webm = await dl(page, '#leaderWebm', 40000);
  check(webm.buf.slice(0, 4).toString('hex') === '1a45dfa3' && webm.buf.length > 20000, `WebM leader exported (${webm.name}, ${webm.buf.length} bytes)`);
  check(/A_OPUS|OpusHead/.test(webm.buf.toString('latin1')), 'WebM contains an Opus audio track');
} else check(true, 'MediaRecorder absent: skipped');
await page.screenshot({ path: path.join(root, 'screenshot-leader.png') });
const png = await dl(page, '#slatePng');
fs.writeFileSync('/tmp/claquette-slate.png', png.buf);
check(png.buf.slice(1, 4).toString() === 'PNG' && png.buf.length > 30000, `slate PNG (${png.name}, ${png.buf.length} bytes)`);

// clear log with confirmation
await page.click('#tab-log');
page.once('dialog', d => d.accept());
await page.click('#clearLog');
check(await page.$$eval('.tk', e => e.length) === 0 && !(await page.isHidden('#emptyLog')) === true, 'log cleared after confirm');
await ctx.close();

// ---------------- mobile ----------------
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const m = await mctx.newPage(); watch(m);
await m.goto(url);
await m.waitForFunction(() => window.__claquette);
await m.fill('#f-production', 'Tamurt'); await m.fill('#f-scene', '4'); await m.fill('#f-shot', '2A'); await m.fill('#f-take', '3');
for (const v of ['slate', 'log', 'leader', 'slate']) {
  await m.click(`#tab-${v}`); await m.waitForTimeout(150);
  const ov = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  check(ov.sw <= ov.w, `mobile ${v}: no horizontal overflow (${ov.sw} ≤ ${ov.w})`);
}
for (const l of ['en', 'kab', 'fr']) {
  await m.click(`[data-lang=${l}]`);
  const ov = await m.evaluate(() => document.documentElement.scrollWidth);
  check(ov <= 390, `mobile ${l}: no horizontal overflow (${ov})`);
}
await m.setViewportSize({ width: 844, height: 390 });
const land = await m.evaluate(() => document.documentElement.scrollWidth);
check(land <= 844, `mobile landscape 844×390: no horizontal overflow (${land})`);
await m.setViewportSize({ width: 390, height: 844 });
await m.tap('#tc');
await m.waitForFunction(() => window.__claquette.state.takes.length === 1);
check(await m.inputValue('#f-take') === '4', 'mobile tap claps and increments the take');
await m.waitForTimeout(2200);
await m.screenshot({ path: path.join(root, 'screenshot-mobile.png') });
await m.click('#fs');
check(await m.$eval('#board', b => b.classList.contains('pseudo-fs')), 'fullscreen mode');
await m.click('#fsClose');
check(!(await m.$eval('#board', b => b.classList.contains('pseudo-fs'))), 'exit fullscreen');
await mctx.close();

check(errors.length === 0, `no console errors ${errors.join(' | ')}`);
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
