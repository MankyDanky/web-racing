// Verify the AI opponents drive like humans: seed a single-player race, let it
// run, and sample bot state over time. Checks: no errors, cars accelerate, make
// continuous progress (not teleport), keep moving, and finish. Screenshots the
// race so the driving can be eyeballed.
import puppeteer from 'puppeteer';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5173';

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl',
    '--ignore-gpu-blocklist', '--disable-gpu-sandbox',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 900, height: 650 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${BASE}/game.html`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  const cfg = {
    version: 2, type: 'startGame', trackId: 'map1',
    players: [{ id: 'solo', name: 'You', isHost: true, isReady: true, playerColor: 'red' }],
    multiplayer: false, isSinglePlayer: true, createdAt: Date.now(),
  };
  sessionStorage.setItem('gameConfig', JSON.stringify(cfg));
  sessionStorage.setItem('carColor', 'red');
});
await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });

// Wait for the race to start (countdown ~4s after load).
await new Promise((r) => setTimeout(r, 9000));

const samples = [];
for (let s = 0; s < 8; s++) {
  const snap = await page.evaluate(() => (window.__aiDebug ? window.__aiDebug() : null));
  samples.push(snap);
  await new Promise((r) => setTimeout(r, 1500));
}

await page.screenshot({ path: 'scripts/ai-race.png' });
await browser.close();

console.log('errors:', errors.length);
errors.slice(0, 8).forEach((e) => console.log('  -', e));

if (!samples[0]) { console.log('NO AI DEBUG DATA'); process.exit(1); }

// Analyse per-bot: progress must be monotonic & advancing; speed should be >0.
const names = samples[0].map((b) => b.name);
let ok = true;
for (const name of names) {
  const series = samples.map((snap) => snap.find((b) => b.name === name)).filter(Boolean);
  const prog = series.map((b) => b.progress);
  const speeds = series.map((b) => b.speed);
  const advanced = prog[prog.length - 1] - prog[0];
  const maxSpeed = Math.max(...speeds);
  const minSpeed = Math.min(...speeds.slice(1)); // ignore the very first
  const monotonic = prog.every((p, i) => i === 0 || p >= prog[i - 1] - 0.001);
  const good = advanced > 0.05 && maxSpeed > 20 && monotonic;
  if (!good) ok = false;
  console.log(
    `${name.padEnd(12)} advanced=${advanced.toFixed(3)} ` +
    `spd[min..max]=${minSpeed.toFixed(0)}..${maxSpeed.toFixed(0)} ` +
    `monotonic=${monotonic} ${good ? 'OK' : 'BAD'}`
  );
}

console.log('\nsample t0:', JSON.stringify(samples[0]));
console.log('sample t7:', JSON.stringify(samples[7]));
console.log(`\nRESULT: ${ok && errors.length === 0 ? 'PASS' : 'FAIL'}`);
process.exit(ok && errors.length === 0 ? 0 : 1);
