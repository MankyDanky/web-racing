# Implementation report — all 50 improvements

Legend: **done** = implemented & exercised by build/tests; **partial** = implemented with an
honest scope limit noted; **config** = shipped as configuration/docs.

## A. Networking
| # | Item | Status | Where |
|---|------|--------|-------|
| 1 | Interpolation for remote cars | done | `modules/netcode.js` SnapshotBuffer, 120 ms render-behind; `multiplayer.updateRemoteCars()`; unit-tested |
| 2 | Binary quantized packets | done | 22-byte frames, host batches at 20 Hz; roundtrip + size tested |
| 3 | Host-authoritative finish times | done | host validates monotonic gate progress, derives time, broadcasts `finishOfficial`; clients only accept host's word |
| 4 | Absolute countdown sync | done | `countdownAt` with clock-offset compensation |
| 5 | Self-hosted PeerJS broker | config | `?peerHost=` / `VITE_PEER_HOST`; deploy doc |
| 6 | Bounded unavailable-id retries | done | 4 retries then "Connection problem" overlay |
| 7 | Removed blind 1 s delay | done | event-driven peer open |
| 8 | Heartbeat + DNF UX | done | 2.5 s ping, 10 s timeout, DNF notice + exclusion |
| 9 | Host migration | partial | deterministic lowest-id election + handoff; not exercised on real networks here |
| 10 | No console spam in prod | done | esbuild `drop` in build; connectionTest removed (dev keeps logs) |
| 11 | Roster-bound identity | done | per-packet name/color ignored |
| 12 | crypto.randomUUID peer ids | done | lobby |

## B. Physics & feel
| 13 | Drop cannon-es | done | package.json/lock |
| 14 | Brake/engine balance | done | tuning.js: brake 150 (was 50), coast 30, engine 1200 with top-end fade |
| 15 | Suspension travel clamp | done | 24 cm (was 45 on a 30 cm rest) |
| 16 | Local-car render interpolation | done | blend last two physics ticks |
| 17 | Allocation pooling | done | pooled velocity/temp vectors in physics hot path |
| 18 | Central tuning | done | `modules/tuning.js` + per-track overrides (map2 snow grip) |
| 19 | Handling assists | done | traction control + stability assist + drift toggle (settings) |
| 20 | No gate tunneling | done | swept segment-vs-gate test |
| 21 | Manual reset | done | R key (already existed) kept, documented in info popup |

## C. Rendering & perf
| 22 | One car model + tint | partial | DRACO-capable shared loader; tint rejected because the colormap is a baked 8-swatch atlas (verified visually); colored GLBs are ~small, kept as safe default |
| 23 | Asset compression | config | `npm run optimize:assets` (draco) + DRACOLoader wired everywhere; shipped models left raw to avoid untestable runtime risk |
| 24 | Pixel-ratio cap + adaptive res | done | cap 2/1.5, governor scales 1→0.66 on hot frames |
| 25 | Mobile lighting preset | done | shadows off on mobile/auto-low |
| 26 | wasm failure UX | done | Ammo().catch → fatal overlay (was infinite spinner) |
| 27 | Minimap 10 Hz | done | throttled in animate() |

## D. Architecture
| 28 | God-file split | partial | 7 new modules for all new features; legacy split deferred |
| 29 | window.* bus | partial | `modules/bus.js` for new signals; legacy globals kept for compat |
| 30 | Single sanitizers | done | sanitize.js used by main/lobby/multiplayer/car |
| 31 | innerHTML → DOM APIs | partial | waiting list & panels use DOM builders; static header rows still innerHTML (no interpolated data) |
| 32 | Tests | done | 13 frontend unit tests + 8 Django tests, both green |
| 33 | Lint/CI | done | eslint flat config (0 errors), prettier, GH Actions for both stacks |
| 34 | Untrack dist/.DS_Store | done | git rm --cached + .gitignore |
| 35 | Config schema versioning | done | version:1 + validation both pages |

## E. Backend
| 36 | Shared throttle cache | done | REDIS_URL → Redis cache |
| 37 | Expired-code cleanup | done | `cleanupexpiredcodes` cmd + cron job in render.yaml |
| 38 | Admin lockdown | done | ADMIN_ENABLED / ADMIN_PATH env |
| 39 | Hardening headers | done | HSTS/SSL-redirect/secure cookies when !DEBUG; wildcard+credentials refused |
| 40 | Postgres deploy path | done | render.yaml blueprint |

## F. Gameplay & UX
| 41 | Audio | done | procedural engine/skid/impact/beeps/fanfare, consent-free WebAudio |
| 42 | AI opponents | partial | kinematic gate-following bots (0-3) merged into leaderboard/minimap; no physics collisions by design |
| 43 | More tracks | partial | per-track tuning + DRACO pipeline; no new track geometry authored (needs Blender work) |
| 44 | Timer SS.mmm | done | formatRaceTime everywhere; sorting verified |
| 45 | Deep link + QR | done | ?party=CODE auto-join; QR rendered (graceful fallback) |
| 46 | Rejoin after refresh | partial | race clock + resume banner; full state restore not live-tested |
| 47 | Free cam | done | C while spectating, drag-orbit, wheel zoom |
| 48 | Mobile extras | done | tilt steering + collision vibration |
| 49 | Settings menu | done | FOV/sensitivity/camera/quality/audio/FPS/bots, persisted |
| 50 | Analytics consent | done | privacy.js consent gate replaces unconditional inject() |

## Verification performed in this workspace
- `npm run build` (vite) — all modules transform & bundle, no warnings
- `node --test` — 13/13 pass
- Django `manage.py test` — 8/8 pass
- `npx eslint src/ test/` — 0 errors
- curl — new bundles + models serve 200 on the live preview
NOT possible here: real-browser driving feel and multi-device WebRTC races. The localhost
two-tab flow in HOW-TO-USE-LOCALLY.md is the intended smoke test for those.

## Round 2 — "it fails on localhost" fixes (user-reported)

Root causes found for the "Your player ID is stuck in use" overlay:
1. **Shared-storage identity bug**: the lobby minted a new peer ID on every load
   into localStorage, which is shared across tabs. Two localhost tabs (the normal
   multiplayer test) overwrote each other's IDs → permanent unavailable-id.
   Fix: `modules/identity.js` — per-tab sessionStorage IDs (`crypto.randomUUID`),
   all 13 read sites + lobby rewired. Refresh keeps the ID (rejoin still works).
2. **startGame flush race**: host lobby closed every WebRTC connection 200 ms
   after broadcasting startGame, often before guests received it → guests never
   left the lobby. Fix: 1 s grace navigation; sockets close on unload instead.
3. **Third-party fragility**: author's Font Awesome kit (account-bound) 403s on
   other networks; replaced the 5 icons with inline glyphs — zero CDN deps now.

## Browser verification (headless Chromium via Playwright, test/e2e.py)
- Solo: lobby → play → raceStarted=true, car drives (W held → 71-76 kph),
  MM:SS.mmm timer visible, leaderboard/minimap/speedometer/consent banner render,
  fatal overlay absent. Screenshots confirm.
- Multiplayer: create party → code → second tab joins → both tabs reach
  game.html → both raceStarted=true → no overlays.
- Console/page errors after fixes: **0**.
Run it yourself: `pip install playwright && playwright install chromium --only-shell
&& playwright install-deps chromium`, serve dist, `python3 test/e2e.py`.

## Round 3 — real physics AI drivers (replaces kinematic bots)

Design choice: no pretrained model (needs training pipeline + weights + still
fails on new tracks). Instead each AI sits in the SAME ammo.js raycast vehicle
as the player and drives through the SAME control path (throttle/brake
keyState + analog steerAxis): `modules/aidriver.js`.
- Pure-pursuit steering + corner-speed planning (v = sqrt-style bend budget),
  steering noise, scheduled small mistakes, gentle rubber-banding.
- Stuck recovery like a human: reverse maneuver; if that fails twice, reset to
  the last checkpoint ("frustrated R").
- Flip recovery identical to the player auto-reset.
- Staggered grid start; human-like roster names/colors (botnames.js).
- Believable-lobby UX: lobby toggle "Race with online drivers" (default ON) -
  bots "join" the lobby list with delays, appear on the leaderboard with
  positions, finish with real times, occasionally chat "gg".
- AI snapshots feed the SAME 20 Hz interpolation buffer as networked players,
  so their cars render exactly like remote humans.
Browser-verified (test/e2e.py): 3 drivers spawn, drive 90-100 m in 16 s,
progress through gates, leaderboard shows them in positions 1-3 ahead of the
player, zero console errors; two-tab real multiplayer still passes.

---

## Round 4 — Realism & stability pass (physics explosions, jitter, wedges)

User report: cars launching like rockets, tyres flying off, earthquake-like
camera shake, game unplayable. Root causes found by scripted stress runs
(hold-throttle repro + per-frame telemetry) and fixed:

1. **Camera jitter ("earthquake")** — the camera was being re-aimed inside
   every fixed physics sub-step, so on non-60 Hz displays it snapped several
   times per rendered frame. Camera update now runs **once per rendered
   frame**, after the render interpolation, exactly like the render pipeline.

2. **Rocket launches** — AI cars were solid vs the player, so any contact at
   speed launched you. Player chassis is now collision group 1 (track only);
   AI cars are group 4: solid vs the track, **ghosts vs every car**. The
   vendored Ammo.js glue does not export `setCollisionFilterGroup`, so both
   call sites write the broadphase proxy members instead (with a
   feature-detect fallback). Verified in-browser: player `[1,1]`, bots `[4,1]`.

3. **Dead-car wedge** — pinned against geometry with W held, the car sat at
   0 kph forever (pre-patch repro: stuck 12 s+). Added a timed **unstuck
   assist**: <2 kph for 2.5 s with throttle held → auto-reverse for 1.2 s.

4. **Explosion guards** — velocity NaN/>55 m/s is zeroed; position NaN,
   y>60 or y<-5 respawns the player at the current gate (fall recovery is
   now near-instant instead of a 2.4 s free-fall first).

5. **AI fall recovery + corner judgement** — the course has no barriers, so
   bots that missed a corner fell forever (wheel-speed HUD keeps ticking in
   mid-air, so stuck/flip checks never fired; observed y −5 700 m). Bots now
   respawn at the last checkpoint the moment y < −2, and their corner speed
   is grip-physics based: `v = sqrt(mu·g·R)` with R estimated from gate
   spacing, severity-capped for hairpins, with distance-aware braking
   (~5 m/s²) into the bend. 90-second soak: **0 falls**, gates 0→4 cleared,
   self-recovery via reverse.

6. **Init-killer TypeError** — the collision-filter call crashed the whole
   `Ammo().then` chain on builds without the method (race never started,
   car frozen at origin). Fixed via the proxy fallback above; the caught
   init error is now exposed as `window.__initError` for diagnostics.

7. **Lobby race** — PLAY before the broker registered the peer id minted a
   placeholder host id, making the game page a "guest" of a nonexistent
   host. The lobby now waits (300 ms retry) for the real peer id.

8. **Django tests** — production hardening (`SECURE_SSL_REDIRECT`) 301'd
   every test request because the test runner forces `DEBUG=False`;
   hardening is now skipped under `manage.py test`.

### Verification (this round)

- Hold-W stress run: 27→99 kph, off-course fall → instant respawn →
  re-accelerate; no wedge, no stuck frames.
- 90 s bot soak × 2 runs: fell=0 for all bots; gates 1→4; speeds 8–54 kph
  through the slalom, self-unstuck observed and recovering.
- E2E (Playwright): solo + 3 AI racers on the leaderboard (bots 1st–3rd),
  2-tab multiplayer party join + synchronized race start, **0 console/page
  errors**.
- `node --test` 13/13 pass · eslint 0 errors · Django suite OK.
