// Unit tests for js/slate.js (node:test, no dependency): run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getFps, framesToTC, tcToFrames, clockToFrames, runningFrames, framesPerDay, framesToMs, nextTake, csvField, takesToCSV, takesToJSON, leaderSchedule, slug } from '../js/slate.js';

const f24 = getFps('24'), f25 = getFps('25'), f30 = getFps('30'), df = getFps('29.97df'), ndf = getFps('29.97'), f2398 = getFps('23.976'), f60 = getFps('60');

test('24 fps timecode', () => {
  assert.equal(framesToTC(0, f24), '00:00:00:00');
  assert.equal(framesToTC(23, f24), '00:00:00:23');
  assert.equal(framesToTC(24, f24), '00:00:01:00');
  assert.equal(framesToTC(86399, f24), '00:59:59:23');
  assert.equal(framesToTC(86400, f24), '01:00:00:00');
  assert.equal(tcToFrames('01:00:00:00', f24), 86400);
  assert.equal(tcToFrames('00:00:00:24', f24), null, 'frame 24 does not exist at 24 fps');
});

test('25 fps timecode and round trip', () => {
  assert.equal(framesToTC(25 * 3600 + 25 * 61 + 7, f25), '01:01:01:07');
  for (const n of [0, 1, 24, 25, 1499, 1500, 90000, 2159999]) assert.equal(tcToFrames(framesToTC(n, f25), f25), n);
  assert.equal(tcToFrames('10203040', f25), null, '40 frames > 24');
  assert.equal(tcToFrames('10203020', f25), tcToFrames('10:20:30:20', f25), '8-digit input');
});

test('30 fps timecode', () => {
  assert.equal(framesToTC(30 * 60, f30), '00:01:00:00');
  assert.equal(framesToTC(107999, f30), '00:59:59:29');
  assert.equal(tcToFrames('23:59:59:29', f30), 30 * 86400 - 1);
});

test('29.97 drop-frame: skipped labels, tenth minute, one hour', () => {
  assert.equal(framesToTC(1799, df), '00:00:59;29');
  assert.equal(framesToTC(1800, df), '00:01:00;02', ';00 and ;01 are dropped');
  assert.equal(framesToTC(3597, df), '00:01:59;29');
  assert.equal(framesToTC(3598, df), '00:02:00;02');
  assert.equal(framesToTC(17981, df), '00:09:59;29');
  assert.equal(framesToTC(17982, df), '00:10:00;00', 'no drop on the tenth minute');
  assert.equal(framesToTC(17983, df), '00:10:00;01');
  assert.equal(framesToTC(107892, df), '01:00:00;00', '107 892 frames per DF hour');
  assert.equal(tcToFrames('01:00:00;00', df), 107892);
  assert.equal(tcToFrames('00:01:00;00', df), 1800, 'invalid DF label moves to the next valid one');
  for (let n = 0; n < 40000; n += 7) assert.equal(tcToFrames(framesToTC(n, df), df), n);
  // DF timecode tracks the clock: one real hour ≈ 01:00:00;00 (within a frame)
  assert.equal(framesToTC(runningFrames(0, 3600e3, df), df), '01:00:00;00');
  assert.equal(framesToTC(1800, ndf), '00:01:00:00', 'NDF 29.97 keeps every label');
});

test('rollover at 24 h', () => {
  assert.equal(framesPerDay(f24), 2073600);
  assert.equal(framesPerDay(df), 2589408);
  assert.equal(framesToTC(2073600, f24), '00:00:00:00');
  assert.equal(framesToTC(2073599, f24), '23:59:59:23');
  assert.equal(framesToTC(-1, f25), '23:59:59:24');
  assert.equal(framesToTC(2589408 - 1, df), '23:59:59;29');
  assert.equal(framesToTC(2589408, df), '00:00:00;00');
  const jam = tcToFrames('23:59:59:00', f25);
  assert.equal(framesToTC(runningFrames(jam, 2000, f25), f25), '00:00:01:00', 'running TC wraps past midnight');
});

test('running timecode, clock jam, frame durations', () => {
  assert.equal(runningFrames(0, 1000, f2398), 23, '23.976 fps: 23 whole frames after one second');
  assert.equal(runningFrames(0, 1001, f2398), 24);
  assert.equal(runningFrames(100, 1000, f25), 125);
  assert.equal(framesToTC(clockToFrames(14, 30, 5, 520, f25), f25), '14:30:05:13');
  assert.equal(framesToTC(clockToFrames(10, 1, 0, 0, df), df), '10:01:00;02');
  assert.equal(framesToTC(clockToFrames(0, 0, 0, 999, f60), f60), '00:00:00:59');
  assert.ok(Math.abs(framesToMs(3, f25) - 120) < 1e-9);
  assert.ok(Math.abs(framesToMs(1, f2398) - 41.708333) < 1e-5);
});

test('take auto-increment', () => {
  assert.equal(nextTake('1'), '2');
  assert.equal(nextTake('9'), '10');
  assert.equal(nextTake('07'), '08');
  assert.equal(nextTake('T9'), 'T10');
  assert.equal(nextTake('A'), 'B');
  assert.equal(nextTake(''), '1');
  assert.equal(nextTake('Z'), 'Z2');
});

test('CSV escaping', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('il a dit "coupez"'), '"il a dit ""coupez"""');
  assert.equal(csvField('ligne 1\nligne 2'), '"ligne 1\nligne 2"');
  assert.equal(csvField('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"', 'formula neutralised');
  assert.equal(csvField(null), '');
  assert.equal(csvField(12), '12');
  assert.equal(csvField('a;b', ';'), '"a;b"');
  const csv = takesToCSV([
    { scene: '12', shot: '3A', take: '1', timecode: '01:00:00:00', fps: '25', rating: 'ng', note: 'avion, bruit' },
    { scene: '12', shot: '3A', take: '2', timecode: '01:02:00:10', fps: '25', rating: 'good', circled: true, note: 'la "bonne"' },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'n,production,roll,scene,shot,take,timecode,fps,time,intExt,dayNight,sound,rating,circled,note');
  assert.equal(lines[1], '1,,,12,3A,1,01:00:00:00,25,,,,,ng,,"avion, bruit"');
  assert.equal(lines[2], '2,,,12,3A,2,01:02:00:10,25,,,,,good,yes,"la ""bonne"""');
  assert.equal(lines.length, 4, 'trailing CRLF');
  const j = JSON.parse(takesToJSON([{ take: '1' }], { scene: '1' }, new Date('2026-10-17T12:00:00Z')));
  assert.equal(j.app, 'claquette-atelier'); assert.equal(j.takes.length, 1); assert.equal(j.exported, '2026-10-17T12:00:00.000Z');
});

test('countdown leader: 2-pop on exactly one frame, 2 s before action', () => {
  for (const id of ['23.976', '24', '25', '29.97df', '30', '50', '60']) {
    const fps = getFps(id), N = fps.nominal, s = leaderSchedule(fps);
    assert.equal(s.total, 8 * N, `${id}: 8 seconds`);
    assert.equal(s.popFrame, 6 * N, `${id}: pop at the start of "2"`);
    assert.equal(s.total - s.popFrame, 2 * N, `${id}: pop is 2 s before the first frame of action`);
    assert.deepEqual(s.frames.filter(f => f.pop).map(f => f.frame), [s.popFrame], `${id}: exactly one pop frame`);
    assert.equal(s.frames[s.popFrame].number, 2);
    assert.equal(s.frames[s.popFrame - 1].number, 3);
    assert.equal(s.frames[s.popFrame + 1].number, null, 'black after the 2');
    assert.equal(s.frames[0].number, 8);
    assert.equal(s.frames[N].number, 7);
    assert.ok(Math.abs(s.popMs - 1000 / fps.rate) < 1e-9, 'pop lasts one frame');
  }
  const s24 = leaderSchedule(getFps('24'));
  assert.equal(s24.popFrame, 144); assert.equal(s24.popTime, 6); assert.equal(s24.frames[12].progress, 0.5);
});

test('file name slug', () => {
  assert.equal(slug('claquette', 'Scène 12', '3A', '4'), 'claquette-Scene_12-3A-4');
  assert.equal(slug(), 'claquette');
});
