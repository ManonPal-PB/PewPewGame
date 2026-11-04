// Automatic physics check for Topple Town.
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

  // 1. Every level: stacks must stand still for 4 seconds with nobody touching them.
  log('\n## Stacks standing still (4 seconds, no shots)\n');
  log('| Level | Targets | Broke by themselves | Biggest drift (m) | Result |');
  log('|---|---|---|---|---|');
  for (let i = 0; i < levelCount; i++) {
    const r = await page.evaluate(i => {
      window.__tt.play(i, false);
      const a = window.__tt.info();
      window.__tt.step(480);
      const b = window.__tt.info();
      let drift = 0;
      // targets are listed in the same order; compare the ones still standing
      if (a.targets.length === b.targets.length)
        a.targets.forEach((p, k) => { const q = b.targets[k]; drift = Math.max(drift, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); });
      else drift = -1;
      return { n: a.remaining, broke: a.remaining - b.remaining, drift };
    }, i);
    const ok = r.broke === 0 && r.drift >= 0 && r.drift < 0.08;
    if (!ok) failed = true;
    log(`| ${i + 1} | ${r.n} | ${r.broke} | ${r.drift < 0 ? 'n/a' : r.drift.toFixed(3)} | ${ok ? '✅' : '❌'} |`);
    if (i === 0 || i === 9 || i === 29) {
      await page.evaluate(() => window.__tt.render());
      await page.screenshot({ path: `${OUT}/level-${String(i + 1).padStart(2, '0')}-standing.png` });
    }
  }

  // 2. Sample levels: aim at the highest standing target until the level is cleared.
  log('\n## Clearing levels with aimed shots (infinite balls)\n');
  log('| Level | Targets | Shots to clear | Cleared? |');
  log('|---|---|---|---|');
  for (const i of [0, 1, 3, 5, 9, 17, 29]) {
    const r = await page.evaluate(i => {
      window.__tt.play(i, true);
      const start = window.__tt.info().remaining;
      let shots = 0;
      while (shots < 120) {
        const info = window.__tt.info();
        if (info.remaining <= 0) break;
        // aim at the target that is highest, then nearest the middle
        const t = info.targets.slice().sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0];
        if (!t) break;
        window.__tt.fireAt(t[0], t[1], t[2]);
        shots++;
        window.__tt.step(90);
      }
      window.__tt.step(240);
      const end = window.__tt.info();
      return { start, shots, remaining: end.remaining, state: end.state, ended: end.ended };
    }, i);
    const ok = r.remaining === 0;
    if (!ok) failed = true;
    log(`| ${i + 1} | ${r.start} | ${r.shots} | ${ok ? '✅' : `❌ ${r.remaining} left`} |`);
    if (i === 0) {
      await page.evaluate(() => window.__tt.render());
      await page.screenshot({ path: `${OUT}/level-01-after-shots.png` });
    }
  }

  // 3. A mid-flight screenshot so a person can see a real hit
  await page.evaluate(() => { window.__tt.play(9, true); window.__tt.fireAt(-1.9, 2.5, -8); window.__tt.step(40); window.__tt.render(); });
  await page.screenshot({ path: `${OUT}/level-10-impact.png` });
} catch (e) {
  fail('Check crashed: ' + e.message);
}

if (errors.length) { log('\n## Browser errors\n'); errors.slice(0, 20).forEach(e => log('- ' + e)); }
log(`\n**Overall: ${failed ? '❌ problems found' : '✅ all checks passed'}**`);
writeFileSync(`${OUT}/report.md`, lines.join('\n') + '\n');

await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
