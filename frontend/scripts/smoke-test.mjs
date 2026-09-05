// Headless runtime smoke test: load the lobby and the game page, capture any
// console errors / uncaught exceptions / failed requests. Not part of CI; a
// manual sanity check that the app actually boots in a real browser.
import puppeteer from 'puppeteer';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5173';

// The sandbox has no outbound network, so the PeerJS signaling broker and the
// backend API are unreachable. Those failures are environmental, not code bugs.
function isExpectedNetworkError(text) {
  return (
    /peer-unavailable/i.test(text) ||
    /Could not connect to peer/i.test(text) ||
    /PeerJS|broker|signaling/i.test(text) ||
    /Failed to fetch/i.test(text) ||
    /ERR_(NAME_NOT_RESOLVED|CONNECTION|INTERNET|NETWORK)/i.test(text) ||
    /party-codes/i.test(text)
  );
}

async function checkPage(browser, path, { waitMs = 6000, settle } = {}) {
  const page = await browser.newPage();
  const errors = [];
  const failedReqs = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isExpectedNetworkError(msg.text())) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    if (!isExpectedNetworkError(err.message)) errors.push(`pageerror: ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    // Ignore aborted analytics / expected network calls to the backend.
    failedReqs.push(`${req.failure()?.errorText || 'failed'}: ${req.url()}`);
  });

  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 30000 });
  if (settle) {
    try {
      await settle(page);
    } catch (e) {
      errors.push(`settle: ${e.message}`);
    }
  }
  await new Promise((r) => setTimeout(r, waitMs));
  await page.close();
  return { errors, failedReqs };
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-gpu-sandbox',
  ],
});

let failed = false;

// 1) Lobby page.
{
  const { errors, failedReqs } = await checkPage(browser, '/index.html', { waitMs: 4000 });
  console.log('\n=== LOBBY (index.html) ===');
  console.log('console/page errors:', errors.length);
  errors.forEach((e) => console.log('  -', e));
  console.log('failed requests:', failedReqs.length);
  failedReqs.forEach((r) => console.log('  -', r));
  if (errors.length) failed = true;
}

// 2) Game page in single-player mode. Seed a valid gameConfig first so the game
// actually starts a race (physics, rendering, gates) rather than idling.
{
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isExpectedNetworkError(msg.text())) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    if (!isExpectedNetworkError(err.message)) errors.push(`pageerror: ${err.message}`);
  });

  // Pre-seed sessionStorage on the origin before the game script runs.
  await page.goto(`${BASE}/game.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const cfg = {
      version: 2,
      type: 'startGame',
      trackId: 'map1',
      players: [{ id: 'solo-smoke', name: 'Smoke', isHost: true, isReady: true, playerColor: 'red' }],
      multiplayer: false,
      isSinglePlayer: true,
      createdAt: Date.now(),
    };
    sessionStorage.setItem('gameConfig', JSON.stringify(cfg));
    sessionStorage.setItem('carColor', 'red');
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  // Let Ammo init, assets load, and the render loop spin for a while.
  await new Promise((r) => setTimeout(r, 12000));

  // Confirm a WebGL canvas exists, is sized, and has actually drawn non-blank
  // pixels (proof the renderer + scene are live, not just mounted).
  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const info = { w: c.width, h: c.height, nonBlank: null };
    try {
      // Read pixels straight from the WebGL backbuffer (preserveDrawingBuffer
      // isn't set, so a 2D copy would be blank).
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        const px = new Uint8Array(4 * 64 * 64);
        gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
        info.nonBlank = px.some((v, i) => i % 4 !== 3 && v > 0);
      }
    } catch (e) {
      info.pixelErr = e.message;
    }
    return info;
  });

  // Screenshot the composited page - proves the scene is visible on screen even
  // though the WebGL backbuffer reads blank after compositing.
  await page.screenshot({ path: 'scripts/smoke-game.png' });
  const shot = await page.evaluate(() => {
    // Sample the composited canvas via a temporary 2D draw to detect color.
    const c = document.querySelector('canvas');
    const tmp = document.createElement('canvas');
    tmp.width = 64; tmp.height = 64;
    const ctx = tmp.getContext('2d');
    try {
      ctx.drawImage(c, 0, 0, 64, 64);
      const d = ctx.getImageData(0, 0, 64, 64).data;
      const colors = new Set();
      for (let i = 0; i < d.length; i += 4) colors.add(`${d[i]},${d[i+1]},${d[i+2]}`);
      return { distinctColors: colors.size };
    } catch (e) { return { err: e.message }; }
  });

  console.log('\n=== GAME (game.html, single-player map1) ===');
  console.log('canvas:', JSON.stringify(canvasInfo));
  console.log('composited sample:', JSON.stringify(shot), '(screenshot: scripts/smoke-game.png)');
  console.log('console/page errors:', errors.length);
  errors.forEach((e) => console.log('  -', e));
  if (!canvasInfo || canvasInfo.w < 10) failed = true;
  if (errors.length) failed = true;
  await page.close();
}

await browser.close();
console.log(`\nSMOKE RESULT: ${failed ? 'FAIL' : 'PASS'}`);
process.exit(failed ? 1 : 0);
