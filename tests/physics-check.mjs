// Automatic physics check for Pew Pew.
// Runs on GitHub's computers (see .github/workflows/physics-check.yml):
// opens the game in a real browser, then for every level checks that
//   1. the stacks stand still on their own (nothing wobbles, falls or breaks), and
// for a sample of levels checks that
//   2. aimed shots smash things and the level can be cleared.
// Writes a summary to test-output/report.md and screenshots to test-output/.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = 8123;
const OUT = 'test-output';
mkdirSync(OUT, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'public'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const lines = [];
const log = s => { console.log(s); lines.push(s); };
let failed = false;
const fail = s => { failed = true; log('❌ ' + s); };

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__tt && window.__tt.ready(), null, { timeout: 90000 });
  await page.evaluate(() => window.__tt.freeze(true));
  log('Game and Rapier physics loaded.');
  await page.screenshot({ path: `${OUT}/00-title.png` });

  const levelCount = await page.evaluate(() => window.__tt.levels);

  // 1. Every level, two tests:
  //    a) after loading, every object is still where the level design put it
  //    b) wake every object and leave it alone for 4 seconds (this is what happens
  //       when the first ball touches a wall): nothing may slide, topple or break
  log('\n## Stacks standing still\n');
  log('| Level | Targets | Off-layout after load (m) | Broke while awake | Drift while awake (m) | Widest table edge (1 = screen edge) | Result |');
  log('|---|---|---|---|---|---|---|');
  for (let i = 0; i < levelCount; i++) {
    const r = await page.evaluate(i => {
      window.__tt.play(i, false);
      const fr = window.__tt.frame();
      const a = window.__tt.info();
      window.__tt.wakeAll();
      window.__tt.step(480);
      const b = window.__tt.info();
      return { n: a.remaining, load: a.layoutDrift, broke: a.remaining - b.remaining, drift: b.layoutDrift, worst: window.__tt.worst(), lost: window.__tt.lost(), fr };
    }, i);
    const ok = r.load < 0.04 && r.broke === 0 && r.drift < 0.10 && r.fr.edge <= 0.97;
    if (!ok) failed = true;
    log(`| ${i + 1} | ${r.n} | ${r.load.toFixed(3)} | ${r.broke} | ${r.drift.toFixed(3)} | ${r.fr.edge} (zoom ${r.fr.fov}°) | ${ok ? '✅' : '❌'} |`);
    if (!ok) console.log('   worst object: ' + JSON.stringify(r.worst));
    if (!ok && r.lost.length) console.log('   broke: ' + JSON.stringify(r.lost));
    if (i === 0 || i === 9 || i === 29) {
      await page.evaluate(() => window.__tt.render());
      await page.screenshot({ path: `${OUT}/level-${String(i + 1).padStart(2, '0')}-standing.png` });
    }
  }

  // 2. Sample levels: can aimed shots clear them, and how many balls does it take?
  //    "Top shooter" aims at the highest target (simple, wasteful).
  //    "Low shooter" aims at the lowest target on the fullest table, like a person knocking walls over.
  log('\n## Clearing levels with aimed shots (infinite balls)\n');
  log('| Level | Targets | Ball allowance | Top shooter needed | Low shooter needed | Cleared? |');
  log('|---|---|---|---|---|---|');
  for (let i = 0; i < levelCount; i++) {
    const res = {};
    for (const mode of (process.env.ALL_SHOOTERS || [0, 9, 29].includes(i)) ? ['top', 'low'] : ['low']) {
      res[mode] = await page.evaluate(([i, mode]) => {
        window.__tt.play(i, true);
        const start = window.__tt.info().remaining;
        let shots = 0;
        while (shots < 150) {
          const info = window.__tt.info();
          if (info.remaining <= 0) break;
          let t;
          if (mode === 'top') t = info.targets.slice().sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0];
          else {
            // group by table (x position bands), pick the fullest, aim at its lowest target nearest the middle
            const groups = {};
            info.targets.forEach(p => { const k = Math.round(p[0] / 1.5); (groups[k] = groups[k] || []).push(p); });
            const g = Object.values(groups).sort((a, b) => b.length - a.length)[0];
            const cx = g.reduce((s, p) => s + p[0], 0) / g.length;
            t = g.slice().sort((a, b) => a[1] - b[1] || Math.abs(a[0] - cx) - Math.abs(b[0] - cx))[0];
          }
          if (!t) break;
          window.__tt.fireAt(t[0], t[1], t[2]);
          shots++;
          window.__tt.step(90);
        }
        window.__tt.step(240);
        const end = window.__tt.info();
        return { start, shots, allow: end.balls, remaining: end.remaining };
      }, [i, mode]);
    }
    const ok = (!res.top || res.top.remaining === 0) && res.low.remaining === 0;
    if (!ok) failed = true;
    const cell = r => r.remaining === 0 ? String(r.shots) : `${r.shots} (${r.remaining} left)`;
    log(`| ${i + 1} | ${res.low.start} | ${res.low.allow} | ${res.top ? cell(res.top) : '–'} | ${cell(res.low)} | ${ok ? '✅' : '❌'}${res.low.remaining === 0 && res.low.shots > res.low.allow ? ' (needs more balls)' : ''} |`);
    if (i === 0) {
      await page.evaluate(() => window.__tt.render());
      await page.screenshot({ path: `${OUT}/level-01-after-shots.png` });
    }
  }

  // 3. Graphics: draw calls on the biggest levels, and taps aim at what was tapped
  log('\n## Graphics\n');
  for (const i of [9, 26, 29]) {
    const calls = await page.evaluate(i => { window.__tt.play(i, false); return window.__tt.drawCalls(); }, i);
    const ok = calls <= 110;
    if (!ok) failed = true;
    log(`- Level ${i + 1}: ${calls} draw calls per frame ${ok ? '✅' : '❌ (want 110 or fewer)'}`);
  }
  const di = await page.evaluate(() => { window.__tt.play(29, false); return window.__tt.drawInfo(); });
  console.log('   draw breakdown (level 30): ' + JSON.stringify(di));
  const taps = await page.evaluate(() => {
    window.__tt.play(9, false);
    const out = [];
    for (let k = 0; k < 12; k++) {
      const r = window.__tt.tapTest(k * 7);
      out.push(Math.hypot(r.target[0] - r.aim[0], r.target[1] - r.aim[1], r.target[2] - r.aim[2]));
    }
    return out;
  });
  const worstTap = Math.max(...taps);
  if (worstTap > 0.45) failed = true;
  log(`- Tapping a jar aims at it: worst miss ${worstTap.toFixed(2)} m over 12 taps ${worstTap <= 0.45 ? '✅' : '❌'}`);
  log(`- Screen sharpness (pixel ratio) settled at ${await page.evaluate(() => window.__tt.pixelRatio())} in the test browser`);

  // 4. A mid-flight screenshot so a person can see a real hit
  await page.evaluate(() => { window.__tt.play(9, true); window.__tt.fireAt(-1.9, 2.5, -8); window.__tt.step(40); window.__tt.render(); });
  await page.screenshot({ path: `${OUT}/level-10-impact.png` });
} catch (e) {
  fail('Check crashed: ' + e.message);
}

// Jam effects with the game running in real time, plus screenshots printed into the log (base64 JPEG)
const shots = [];
async function grab(name) {
  const buf = await page.screenshot({ type: 'jpeg', quality: 60, scale: 'css' });
  shots.push([name, buf.toString('base64')]);
}
try {
  log('\n## Jam effects\n');
  // driven frame by frame (the test machine has no graphics card, so real time is too slow)
  const mid = await page.evaluate(() => {
    const t = window.__tt; t.freeze(true); t.play(0, true);
    t.fireAt(-0.3, 1.66, -8);
    let n = 0; while (t.info().remaining >= 8 && n < 240) { t.advance(1 / 60); n++; }
    t.advance(0.12);
    return { fx: t.fx(), calls: t.drawCalls(), frames: n };
  });
  await grab('jam-splash');
  const after = await page.evaluate(() => { window.__tt.advance(2.6); window.__tt.render(); return window.__tt.fx(); });
  await grab('jam-after');
  log(`- Mid-splash: ${mid.fx.drops} droplets, ${mid.fx.glass} glass shards, ${mid.calls} draw calls`);
  log(`- After 2.6 s: ${after.splats} splats, ${after.spots} spots, ${after.drips} drips still running, ${after.drops} droplets in the air`);
  const ok = mid.fx.drops >= 20 && after.splats >= 1 && after.spots >= 5 && mid.calls <= 95;
  if (!ok) failed = true;
  log(`- ${ok ? '✅' : '❌'} splash, splat and spots appear; draw calls stay low`);

  // a combo on a big wall
  const combo = await page.evaluate(() => {
    const t = window.__tt; t.play(3, true);
    for (const x of [-2.1, -1.5, 1.5, 2.1, -1.8]) { t.fireAt(x, 1.66, -8); t.advance(0.35); }
    t.advance(1.5);
    return { fx: t.fx(), calls: t.drawCalls() };
  });
  log(`- Big combo (level 4, 5 shots): ${combo.fx.splats} splats, ${combo.fx.spots} spots, ${combo.calls} draw calls ${combo.calls <= 125 ? '✅' : '❌'}`);
  if (combo.calls > 125) failed = true;
  await grab('jam-combo');
} catch (e) { fail('Jam effects check crashed: ' + e.message); }

try {
  for (const [i, name] of [[28, 'level29-standing'], [25, 'level26-standing'], [9, 'level10-standing']]) {
    await page.evaluate(i => { window.__tt.play(i, false); window.__tt.advance(0.1); window.__tt.render(); }, i);
    await grab(name);
  }
} catch (e) { fail('Level screenshots crashed: ' + e.message); }

for (const [name, b64] of shots) {
  console.log(`SHOT-BEGIN ${name}`);
  for (let k = 0; k < b64.length; k += 4000) console.log('SHOT ' + b64.slice(k, k + 4000));
  console.log(`SHOT-END ${name}`);
}

if (errors.length) { log('\n## Browser errors\n'); errors.slice(0, 20).forEach(e => log('- ' + e)); }
log(`\n**Overall: ${failed ? '❌ problems found' : '✅ all checks passed'}**`);
writeFileSync(`${OUT}/report.md`, lines.join('\n') + '\n');

await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
