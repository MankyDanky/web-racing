// Ghost replay + genuinely human-like AI opponents for solo play (#42, #2).
//
// The previous bots were fake: first "rail followers" glued to a spline, then a
// separate kinematic point-mass. NEITHER used the real physics the player uses,
// so they ignored the rules and could float above the track.
//
// This version drives a REAL Ammo `btRaycastVehicle` — the SAME vehicle type,
// SAME force model, SAME wheel raycasts against the SAME track collider as the
// human's car. Each bot is created via createAIVehicle() and lives in the shared
// physicsWorld. The AIBot here is purely a "brain": every tick it looks at the
// track and the other cars and decides which of W / A / S / D (and space) to
// "press", exactly like a human on a keyboard. It writes those booleans into a
// keyState object; main.js then feeds that keyState through the identical
// applyVehicleControls()/updateSteering() path the player uses, and Ammo does
// all the real physics (engine force to rear wheels, braking, steering, grip,
// suspension, gravity). The car therefore obeys the real rules and rides the
// real surface — nothing here moves the car directly.
//
// The racing line is only a *reference* the brain aims at with pure-pursuit;
// where the car actually ends up is emergent Ammo physics.

import * as THREE from 'three';
import { createGLTFLoader } from './loaders.js';
import { createAIVehicle } from './car.js';
import { createNameSprite } from './nametag.js';
import { log } from './debug.js';

const GHOST_KEY_PREFIX = 'racezGhost:';

// ---- Ghost recording ------------------------------------------------------

export class GhostRecorder {
  constructor() {
    this.frames = [];
    this.startTime = 0;
    this.recording = false;
  }

  start() {
    this.frames = [];
    this.startTime = Date.now();
    this.recording = true;
  }

  record(carModel) {
    if (!this.recording || !carModel) return;
    const t = Date.now() - this.startTime;
    const last = this.frames[this.frames.length - 1];
    if (last && t - last.t < 33) return;
    this.frames.push({
      t,
      p: [carModel.position.x, carModel.position.y, carModel.position.z],
      q: [carModel.quaternion.x, carModel.quaternion.y, carModel.quaternion.z, carModel.quaternion.w],
    });
  }

  finish(trackId, finishMs) {
    this.recording = false;
    if (this.frames.length === 0) return false;
    const key = GHOST_KEY_PREFIX + trackId;
    let best = null;
    try { best = JSON.parse(localStorage.getItem(key)); } catch (e) {}
    if (!best || finishMs < best.time) {
      try {
        localStorage.setItem(key, JSON.stringify({ time: finishMs, frames: this.frames }));
        log('New best ghost saved for', trackId, finishMs);
        return true;
      } catch (e) { /* quota */ }
    }
    return false;
  }
}

export function loadGhost(trackId) {
  try {
    const raw = localStorage.getItem(GHOST_KEY_PREFIX + trackId);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

// ---- Ghost playback -------------------------------------------------------

export class GhostPlayer {
  constructor(scene, ghostData) {
    this.scene = scene;
    this.data = ghostData;
    this.model = null;
    this.startTime = 0;
    this.active = false;
    this._loadModel();
  }

  _loadModel() {
    const loader = createGLTFLoader(window.loadingManager);
    loader.load('/models/car_blue.glb', (gltf) => {
      const m = gltf.scene;
      m.scale.set(4, 4, 4);
      m.traverse((n) => {
        if (n.isMesh) {
          n.material = n.material.clone();
          n.material.transparent = true;
          n.material.opacity = 0.28;
          n.material.depthWrite = false;
          n.castShadow = false;
        }
      });
      m.visible = false;
      this.scene.add(m);
      this.model = m;
    });
  }

  start() {
    this.startTime = Date.now();
    this.active = true;
    if (this.model) this.model.visible = true;
  }

  update() {
    if (!this.active || !this.model || !this.data || !this.data.frames.length) return;
    const t = Date.now() - this.startTime;
    const frames = this.data.frames;
    let i = 0;
    while (i < frames.length - 1 && frames[i + 1].t < t) i++;
    const a = frames[i];
    const b = frames[Math.min(i + 1, frames.length - 1)];
    const span = (b.t - a.t) || 1;
    const alpha = Math.max(0, Math.min(1, (t - a.t) / span));
    this.model.position.set(
      a.p[0] + (b.p[0] - a.p[0]) * alpha,
      a.p[1] + (b.p[1] - a.p[1]) * alpha,
      a.p[2] + (b.p[2] - a.p[2]) * alpha
    );
    const qa = new THREE.Quaternion(a.q[0], a.q[1], a.q[2], a.q[3]);
    const qb = new THREE.Quaternion(b.q[0], b.q[1], b.q[2], b.q[3]);
    this.model.quaternion.copy(qa).slerp(qb, alpha);
  }
}

// ---- Racing line (reference only) ----------------------------------------

export class RacingLine {
  constructor(waypoints) {
    const pts = waypoints.map((w) => w.clone());
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    this.length = this.curve.getLength() || 1;

    this.N = Math.max(64, Math.min(2000, Math.round(this.length / 1.5)));
    this.seg = this.length / this.N;

    this.points = [];
    this.tangents = [];
    for (let i = 0; i < this.N; i++) {
      const u = i / this.N;
      this.points.push(this.curve.getPointAt(u));
      const t = this.curve.getTangentAt(u);
      t.y = 0;
      t.normalize();
      this.tangents.push(t);
    }

    // Curvature (rad of heading change per unit length) at each sample.
    this.curvature = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      const t0 = this.tangents[(i - 1 + this.N) % this.N];
      const t1 = this.tangents[(i + 1) % this.N];
      const dot = THREE.MathUtils.clamp(t0.dot(t1), -1, 1);
      this.curvature[i] = Math.acos(dot) / (2 * this.seg);
    }
  }

  wrap(dist) {
    let d = dist % this.length;
    if (d < 0) d += this.length;
    return d;
  }

  indexAt(dist) {
    return Math.floor(this.wrap(dist) / this.seg) % this.N;
  }

  pointAt(dist, out) {
    const d = this.wrap(dist);
    const f = d / this.seg;
    const i = Math.floor(f) % this.N;
    const j = (i + 1) % this.N;
    const a = f - Math.floor(f);
    out.copy(this.points[i]).lerp(this.points[j], a);
    return out;
  }

  tangentAt(dist, out) {
    out.copy(this.tangents[this.indexAt(dist)]);
    return out;
  }

  curvatureAt(dist) {
    return this.curvature[this.indexAt(dist)];
  }

  // Full nearest-arc-length search (used once for the human player per tick).
  project(point) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.N; i++) {
      const p = this.points[i];
      const dx = point.x - p.x;
      const dz = point.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best * this.seg;
  }

  // Cheap local search around a known index (used every tick per bot).
  projectNear(point, aroundArc, window = 40) {
    const aroundIdx = this.indexAt(aroundArc);
    let best = aroundIdx;
    let bestD = Infinity;
    for (let o = -window; o <= window; o++) {
      const i = ((aroundIdx + o) % this.N + this.N) % this.N;
      const p = this.points[i];
      const dx = point.x - p.x;
      const dz = point.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best * this.seg;
  }
}

// ---- Racing line from the real track centerline (the big AI upgrade) -------
//
// The track ships `track-outline.glb`: a dense Bezier ribbon tracing the ACTUAL
// centerline of the track (thousands of ordered points). Previously the AI's
// racing line was interpolated from only the ~8 gate positions, which cut every
// corner in a straight line — into the walls. Driving the real centerline is
// what makes the bots genuinely quick and clean.

const OUTLINE_WORLD_SCALE = 8; // track.glb / gates load at scale 8; outline is raw

// Pull the ordered centerline vertices out of the loaded outline scene, scaled
// into world space, with consecutive duplicates (the ribbon doubles vertices)
// collapsed.
function extractOutlinePoints(scene) {
  const raw = [];
  const v = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (node.isMesh && node.geometry) {
      const pos = node.geometry.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld);
        raw.push([v.x * OUTLINE_WORLD_SCALE, v.y * OUTLINE_WORLD_SCALE, v.z * OUTLINE_WORLD_SCALE]);
      }
    }
  });
  // Collapse consecutive duplicate XZ points (world threshold).
  const line = [];
  let last = null;
  for (const p of raw) {
    if (last && Math.hypot(p[0] - last[0], p[2] - last[2]) < 0.3) continue;
    line.push(p);
    last = p;
  }
  return line;
}

// Resample an ordered loop to roughly-uniform spacing, then Laplacian-smooth it
// a touch so the curvature estimate (and thus steering) is stable.
function resampleLoop(points, step) {
  if (points.length < 3) return points.map((p) => new THREE.Vector3(p[0], p[1] || 0, p[2]));
  // Cumulative arc length.
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]));
  }
  const total = cum[cum.length - 1];
  const n = Math.max(32, Math.round(total / step));
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (j < cum.length - 1 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const a = (target - cum[j]) / seg;
    const p0 = points[j], p1 = points[Math.min(j + 1, points.length - 1)];
    out.push(new THREE.Vector3(
      p0[0] + (p1[0] - p0[0]) * a,
      (p0[1] || 0) + ((p1[1] || 0) - (p0[1] || 0)) * a,
      p0[2] + (p1[2] - p0[2]) * a
    ));
  }
  // Laplacian smoothing (closed loop), a few gentle passes.
  for (let pass = 0; pass < 3; pass++) {
    const src = out.map((p) => p.clone());
    for (let i = 0; i < out.length; i++) {
      const prev = src[(i - 1 + out.length) % out.length];
      const next = src[(i + 1) % out.length];
      out[i].x = src[i].x * 0.5 + (prev.x + next.x) * 0.25;
      out[i].z = src[i].z * 0.5 + (prev.z + next.z) * 0.25;
    }
  }
  return out;
}

// Orient the centerline so its index order matches the gates' racing order.
// Returns the (possibly reversed) waypoint array.
function orientToGates(waypoints, gates) {
  if (!gates || gates.length < 2) return waypoints;
  const N = waypoints.length;
  const nearest = (gx, gz) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const d = (waypoints[i].x - gx) ** 2 + (waypoints[i].z - gz) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  const gv = new THREE.Vector3();
  const idx = gates.map((g) => { g.getWorldPosition(gv); return nearest(gv.x, gv.z); });
  let inc = 0, dec = 0;
  for (let i = 1; i < idx.length; i++) {
    let d = idx[i] - idx[i - 1];
    if (d > N / 2) d -= N;
    if (d < -N / 2) d += N;
    if (d >= 0) inc++; else dec++;
  }
  return dec > inc ? waypoints.slice().reverse() : waypoints;
}

// Async: build the best available RacingLine for a track. Loads the dense
// centerline; on any failure falls back to the coarse gate-based line so the
// game still works.
export function loadRacingLine(trackId, assetMap, gates, onReady) {
  const path = `/models/maps/${assetMap}/track-outline.glb`;
  const fallback = () => {
    log('AI racing line: falling back to gate-based line');
    onReady(new RacingLine(waypointsFromGates(gates)));
  };
  try {
    const loader = createGLTFLoader(window.loadingManager);
    loader.load(
      path,
      (gltf) => {
        try {
          const pts = extractOutlinePoints(gltf.scene);
          if (pts.length < 8) return fallback();
          let waypoints = resampleLoop(pts, 4.0);
          waypoints = orientToGates(waypoints, gates);
          log(`AI racing line: centerline with ${waypoints.length} waypoints for ${trackId}`);
          onReady(new RacingLine(waypoints));
        } catch (e) {
          fallback();
        }
      },
      undefined,
      fallback
    );
  } catch (e) {
    fallback();
  }
}

// ---- Names / colors -------------------------------------------------------

const NAME_POOL = [
  'Rylan', 'Mira', 'Kaz', 'Nova', 'Diesel', 'Suki', 'Vex', 'Ollie',
  'Zara', 'Milo', 'Rhea', 'Tanner', 'Iris', 'Cole', 'Juno', 'Ash',
  'Remy', 'Bex', 'Kai', 'Luna', 'Drift_King', 'apex_92', 'turbo_lily',
  'm4verick', 'ghost.rider', 'PixelPete', 'nitro_sam', 'v8_vera',
];

const BOT_COLORS = ['orange', 'green', 'yellow', 'violet', 'indigo', 'red'];

// ---- AI driver: a real Ammo vehicle driven by a W/A/S/D brain --------------

const CAR_RADIUS = 3.2;   // for proximity / rival awareness against other cars

// Small smoothed-noise generator (random walk + low-pass) => organic, NON
// periodic wander, unlike a sine wave.
class Wander {
  constructor(rate) { this.v = 0; this.target = 0; this.rate = rate; }
  step(dt, amp) {
    // Occasionally choose a new target; ease toward it.
    if (Math.random() < dt * this.rate) this.target = (Math.random() * 2 - 1) * amp;
    this.v += (this.target - this.v) * Math.min(1, dt * 2.2);
    return this.v;
  }
}

// An AI opponent. It OWNS a real Ammo raycast vehicle (built via createAIVehicle)
// and, each tick, decides which keys a human would press. It never moves the car
// itself — main.js runs the bot's keyState through the same physics as the
// player, so the bot is bound by identical rules and rides the real track.
export class AIBot {
  constructor(scene, options) {
    const {
      ammo, physicsWorld, racingLine, color = 'orange', name = 'CPU',
      skill = 0.7, totalGates = 1, laneBias = 0, trackId = 'map1', spawn = null,
      startArc = 0,
    } = options;

    this.scene = scene;
    this.line = racingLine;
    this.name = name;
    this.color = color;
    this.totalGates = Math.max(1, totalGates);
    this.trackId = trackId;
    // Arc length of the START line on the racing line. Progress is measured
    // RELATIVE to this so bots spawned behind the line start at ~0 progress
    // (not ~1) and grow to 1 as they complete the lap back to the finish.
    this.startArc = startArc;

    // ---- Personality ----
    this.skill = THREE.MathUtils.clamp(skill, 0, 1);
    this.bravery = THREE.MathUtils.clamp(0.35 + this.skill * 0.4 + (Math.random() - 0.5) * 0.3, 0.15, 1);
    this.aggression = THREE.MathUtils.clamp(0.3 + Math.random() * 0.6, 0.2, 1);
    this.consistency = THREE.MathUtils.clamp(0.45 + this.skill * 0.5 + (Math.random() - 0.5) * 0.15, 0.2, 1);

    // ---- Driver characteristics (how the brain presses the keys) ----
    // Target cornering speed the driver is willing to carry (km/h). Ammo decides
    // whether the car can actually hold it; overcook it and the car runs wide,
    // just like a person. Faster drivers brake later and carry more.
    this.topSpeedKPH = 150 + this.skill * 50;          // 150..200 km/h ambition
    this.reactionTime = 0.20 - this.skill * 0.13;      // 0.20..0.07 s
    this.lookaheadK = 0.65 + this.skill * 0.35;        // s of look-ahead

    // ---- Race state ----
    this.laneBias = laneBias;
    this.arc = 0;               // projected arc position along the racing line
    this.traveled = 0;          // arc length incl. laps (for progress ranking)
    this.progress = 0;
    this.gateIndex = 0;
    this.finished = false;
    this.finishMs = null;
    this.speed = 0;             // world speed (units/sec), for rival awareness

    // Mistakes.
    this.mistakeT = 0;
    this.mistakeKind = null;
    this.brakeBias = 1;         // <1 => brakes late (runs wide)
    this.throttleHold = 1;

    // Stuck-recovery (like a human who's nosed into a wall): if we barely move
    // for a while, reverse briefly while steering back toward the line.
    this.stuckT = 0;            // time spent nearly stationary while racing
    this.recoverT = 0;          // remaining time in a reversing recovery
    this.recoverDir = 1;        // which way to steer while reversing

    // Wander sources (line choice + throttle imperfection + reaction buffer).
    this.wLine = new Wander(0.5);
    this.wThrottle = new Wander(0.8);
    this.latTarget = laneBias;
    this.throttleCmdQ = [];
    this.steerCmdQ = [];

    // ---- The REAL Ammo vehicle this brain drives ----
    // keyState mirrors the player's: the brain sets these booleans and main.js
    // feeds them through applyVehicleControls()/updateSteering().
    this.keyState = { w: false, a: false, s: false, d: false, space: false, sensitivity: 1.0 };
    this.currentSteeringAngle = 0;
    this.carBody = null;
    this.vehicle = null;
    this.wheelMeshes = [];
    this.carModel = null;       // named `model`/`carModel`; expose both below
    this.renderState = null;
    this.ready = false;
    this.active = false;
    this._pendingVisible = false;
    this._lastPos = new THREE.Vector3();

    // Scratch vectors.
    this._pos = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._tan = new THREE.Vector3();
    this._perp = new THREE.Vector3();
    this._tgt = new THREE.Vector3();

    const comps = createAIVehicle(ammo, scene, physicsWorld, color, spawn, (c) => {
      this.carModel = c.carModel;
      this.wheelMeshes = c.wheelMeshes;
      this.renderState = c.renderState;
      if (this.carModel) {
        // Floating name label so bots are identifiable on track, just like
        // remote human players in multiplayer (#1).
        // The model is scaled 4x, so child transforms are multiplied by 4: use
        // fractional local values for a sensible world-space label size (#1).
        const nameSprite = createNameSprite(this.name, color);
        nameSprite.position.y = 0.55;
        nameSprite.scale.set(1.6, 0.4, 1);
        this.carModel.add(nameSprite);
        this.nameLabel = nameSprite;
        this.carModel.visible = this._pendingVisible;
        this._pos.copy(this.carModel.position);
        this._lastPos.copy(this.carModel.position);
        // Seed arc from spawn so ranking/progress start sane. `traveled` is
        // measured relative to the start line, so a car sitting just behind the
        // line begins slightly negative and climbs through 0 as it crosses it.
        this.arc = this.line.projectNear(this.carModel.position, this.startArc);
        let rel = this.arc - this.startArc;
        if (rel < -this.line.length / 2) rel += this.line.length;
        if (rel > this.line.length / 2) rel -= this.line.length;
        this.traveled = rel;
        this.progress = this.traveled / this.line.length;
      }
      this.ready = true;
    }, trackId);

    this.carBody = comps.carBody;
    this.vehicle = comps.vehicle;
    this.renderState = comps.renderState;
    this.wheelMeshes = comps.wheelMeshes;
  }

  // main.js reads `.model` for the minimap; keep it aliased to the car model.
  get model() { return this.carModel; }

  // Live world position of the car (from the model, synced from physics).
  get pos() { return this.carModel ? this.carModel.position : this._pos; }

  start() {
    this.active = true;
    this._pendingVisible = true;
    if (this.carModel) this.carModel.visible = true;
  }

  // Trigger and time-out human mistakes (rare, skill-scaled). A mistake changes
  // HOW the brain presses keys (brakes later, lifts, etc.) — the consequence is
  // then produced by the real physics, not faked.
  _updateMistakes(dt) {
    if (this.mistakeT > 0) {
      this.mistakeT -= dt;
      if (this.mistakeT <= 0) {
        this.mistakeKind = null; this.brakeBias = 1; this.throttleHold = 1;
      }
      return;
    }
    const rate = (1 - this.consistency) * 0.10; // mistakes/sec
    if (Math.random() < rate * dt) {
      const r = Math.random();
      if (r < 0.4) {            // brake too late -> runs wide
        this.mistakeKind = 'lateBrake'; this.brakeBias = 0.45; this.mistakeT = 0.5 + Math.random();
      } else if (r < 0.7) {     // brief lift / distraction
        this.mistakeKind = 'lift'; this.throttleHold = 0.35; this.mistakeT = 0.3 + Math.random() * 0.6;
      } else {                  // twitchy hands for a moment
        this.mistakeKind = 'wobble'; this.mistakeT = 0.4 + Math.random() * 0.6;
      }
    }
  }

  // Signed lateral distance from the reference line at our current arc
  // (+ = to the line's right). Used to decide which way to reverse when stuck.
  _signedLineOffset(pos) {
    this.line.pointAt(this.arc, this._tgt);
    this.line.tangentAt(this.arc, this._tan);
    const px = this._tan.z, pz = -this._tan.x; // perpendicular (right)
    return (pos.x - this._tgt.x) * px + (pos.z - this._tgt.z) * pz;
  }

  // Teleport the real Ammo chassis back onto the racing line, upright and
  // pointing along the tangent, with zero velocity. Used as a last-resort
  // un-stick so one bad corner never parks a bot for the whole race.
  _respawnOnLine(ahead = 4) {
    const ammo = (typeof window !== 'undefined') ? window.Ammo : null;
    if (!ammo || !this.carBody || !this.vehicle) return;
    // Re-project from our ACTUAL position over a wide window: when badly beached
    // off-track, this.arc can be stale, so trust the real nearest point instead.
    if (this.carModel) {
      const trueArc = this.line.projectNear(this.carModel.position, this.arc, 200);
      this.arc = trueArc;
    }
    // Aim a little way ahead of where we're wedged so we don't re-hit the wall.
    this.line.pointAt(this.arc + ahead, this._tgt);
    this.line.tangentAt(this.arc + ahead, this._tan);
    const yaw = Math.atan2(this._tan.x, this._tan.z);
    const zero = new ammo.btVector3(0, 0, 0);
    this.carBody.setLinearVelocity(zero);
    this.carBody.setAngularVelocity(zero);
    const t = new ammo.btTransform();
    t.setIdentity();
    t.setOrigin(new ammo.btVector3(this._tgt.x, this._tgt.y + 3, this._tgt.z));
    const q = new ammo.btQuaternion(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    t.setRotation(q);
    this.carBody.setWorldTransform(t);
    if (this.carBody.getMotionState()) this.carBody.getMotionState().setWorldTransform(t);
    for (let i = 0; i < this.vehicle.getNumWheels(); i++) {
      if (i < 2) this.vehicle.setSteeringValue(0, i);
      this.vehicle.updateWheelTransform(i, true);
    }
    this.currentSteeringAngle = 0;
    ammo.destroy(zero);
    ammo.destroy(q);
    ammo.destroy(t);
  }

  // How fast (km/h) can we be here and still make the corners ahead? Scan a
  // braking horizon on the reference line and take the most restrictive corner.
  _cornerSpeedKPH() {
    const line = this.line;
    const speedU = this.speed; // units/sec
    // Available lateral grip & braking decel in world units/s^2, calibrated
    // against the REAL Ammo car (which takes these corners flat at 80-100 km/h),
    // so the AI only lifts/brakes for genuinely tight bends instead of scrubbing
    // speed everywhere. Higher grip => carries much more corner speed.
    const gripFactor = 0.9 + this.bravery * 0.25;
    const gripLat = (11 + this.skill * 6) * gripFactor; // max lateral accel
    const brake = (55 + this.skill * 30) * this.brakeBias; // braking decel
    const topU = this.topSpeedKPH / 3.6;

    // Look ahead generously - at least the full braking distance from top speed
    // PLUS a couple of seconds of travel - so a sharp corner is spotted early
    // enough to brake for it, not discovered when we're already on top of it.
    const brakeDist = (speedU * speedU) / (2 * brake);
    const horizon = THREE.MathUtils.clamp(brakeDist + speedU * 1.2 + line.seg * 6, line.seg * 8, line.length * 0.6);
    const steps = Math.max(1, Math.round(horizon / line.seg));
    const startIdx = line.indexAt(this.arc);

    let targetU = topU;
    for (let s = 1; s <= steps; s++) {
      // Window-max of curvature over a few samples: rejects single-sample noise
      // while still catching the true peak of a genuine bend early.
      let k = 0;
      for (let w = -3; w <= 3; w++) {
        k = Math.max(k, line.curvature[(startIdx + s + w + line.N) % line.N]);
      }
      if (k < 1e-4) continue;
      const vCorner = Math.sqrt(gripLat / k); // max speed through the bend
      if (vCorner >= topU) continue;
      const dAhead = s * line.seg;
      // Max speed now from which we can still brake down to vCorner in time.
      const vAllowed = Math.sqrt(vCorner * vCorner + 2 * brake * dAhead);
      if (vAllowed < targetU) targetU = vAllowed;
    }
    return targetU * 3.6; // back to km/h
  }

  // Awareness of every other car: returns a target-speed scale and a lateral
  // lane nudge to pull out / defend / avoid.
  _planWithRivals(racers) {
    let speedScale = 1;
    let latNudge = 0;
    if (!this.carModel) return { speedScale, latNudge };

    this.carModel.getWorldDirection(this._fwd);
    this._fwd.y = 0; this._fwd.normalize();
    const rgt = this._perp.set(this._fwd.z, 0, -this._fwd.x);
    const me = this.carModel.position;

    for (let i = 0; i < racers.length; i++) {
      const r = racers[i];
      if (r.bot === this || !r.position) continue;
      const dx = r.position.x - me.x;
      const dz = r.position.z - me.z;
      const ahead = dx * this._fwd.x + dz * this._fwd.z;   // + = in front
      const side = dx * rgt.x + dz * rgt.z;                // + = to our right
      const dist2 = dx * dx + dz * dz;

      // Too close AND directly ahead: ease slightly and steer to the open side
      // (real cars collide in Ammo, so this is avoidance, not a fake impulse).
      // Only a car genuinely in front should make us lift — otherwise the whole
      // grid brakes itself to a crawl at the start.
      if (dist2 < (CAR_RADIUS * 2.0) * (CAR_RADIUS * 2.0) && ahead > 1) {
        speedScale = Math.min(speedScale, 0.9);
        latNudge += -Math.sign(side || 1) * 2.4;
        continue;
      }

      // Car just ahead in our lane => plan a pass or tuck in.
      if (ahead > 2 && ahead < 26 && Math.abs(side) < 4.5) {
        const closing = this.speed > (r.speed || 0) + 1;
        if (ahead < 10) {
          const overtakeUrge = this.aggression * (closing ? 1 : 0.3);
          if (overtakeUrge > 0.4) {
            const dir = side >= 0 ? -1 : 1;
            latNudge += dir * (2 + 1.5 * overtakeUrge);
          } else {
            speedScale *= 0.85;
          }
        } else if (closing) {
          speedScale *= 1 + 0.05 * this.aggression; // slipstream tow
          const dir = side >= 0 ? -1 : 1;
          latNudge += dir * 1.6 * this.aggression;
        }
      }

      // Faster car looming right behind => defend the inside.
      if (ahead < -1 && ahead > -14 && Math.abs(side) < 4 && (r.speed || 0) > this.speed + 1) {
        latNudge += (this.laneBias >= 0 ? -1 : 1) * 1.2 * this.aggression;
      }
    }

    speedScale = THREE.MathUtils.clamp(speedScale, 0.6, 1.08);
    return { speedScale, latNudge };
  }

  // Decide which keys to "press" this tick. Called BEFORE the shared physics
  // step. Sets this.keyState.{w,a,s,d,space}. Does NOT move the car.
  think(dt, ctx = {}) {
    if (!this.ready || !this.carModel) return;

    const ks = this.keyState;
    ks.w = ks.a = ks.s = ks.d = ks.space = false;

    // Current world speed (units/sec). Read the TRUE velocity from the Ammo
    // chassis body - position-differencing spikes wildly on any single-tick
    // jump (physics substeps, collisions), producing phantom 200+ km/h readings
    // that used to trigger spurious brake stabs and cap the AI's pace.
    const cur = this.carModel.position;
    let measured = null;
    if (this.carBody && typeof this.carBody.getLinearVelocity === 'function') {
      const lv = this.carBody.getLinearVelocity();
      measured = Math.hypot(lv.x(), lv.y(), lv.z());
    }
    if (measured == null || !isFinite(measured)) {
      // Fallback: position delta, clamped to a sane range to reject spikes.
      const raw = cur.distanceTo(this._lastPos) / Math.max(1e-3, dt);
      measured = Math.min(raw, (this.speed || 0) + 40);
    }
    this.speed = measured;
    this._lastPos.copy(cur);
    const speedKPH = this.speed * 3.6;

    // Before the race starts, or when finished, hold still (no throttle).
    if (this.finished) return;
    if (!ctx.started) return;

    this._updateMistakes(dt);

    // ---- Stuck recovery: if we're nosed into something, reverse out ----
    // A real driver who beaches the car backs up and re-aims. We detect "barely
    // moving while trying to race" and trigger a short reversing maneuver.
    if (this.recoverT > 0) {
      this.recoverT -= dt;
      // Reverse (S) while steering toward the racing line, then let normal
      // driving resume. Steer opposite to where we're wedged.
      ks.s = true;
      if (this.recoverDir >= 0) ks.d = true; else ks.a = true;
      this._lastPos.copy(cur);
      return;
    }
    if (this.speed < 1.5) {
      this.stuckT += dt;
      if (this.stuckT > 1.0) {
        this.recoverT = 1.1 + Math.random() * 0.7;
        // Aim the reverse-steer back toward the reference line; if we're right
        // on the line, pick a random side so two wedged cars don't mirror.
        const off = this._signedLineOffset(cur);
        this.recoverDir = Math.abs(off) < 0.5
          ? (Math.random() < 0.5 ? 1 : -1)
          : (off >= 0 ? 1 : -1);
        this.stuckT = 0;
      }
    } else {
      this.stuckT = 0;
    }

    // No-progress watchdog: track how long since we last meaningfully advanced
    // along the line. Reverse-recovery can flail (briefly moving, even going
    // backwards) without ever getting the car around the corner, so we key the
    // last-resort teleport off genuine forward progress, not instantaneous
    // speed. If we haven't gained ground in several seconds, respawn on-line.
    if (this._bestTraveled == null || this.traveled > this._bestTraveled + 3) {
      this._bestTraveled = this.traveled;
      this._noProgressT = 0;
      // Making real progress again: forget the escalation history.
      if (this.traveled > (this._lastRespawnTraveled || -1e9) + 30) this._respawnTries = 0;
    } else {
      this._noProgressT = (this._noProgressT || 0) + dt;
    }
    if (this._noProgressT > 3.0) {
      // Escalate: each consecutive failed respawn jumps a little further along
      // the line so a persistently bad spot (a wall pocket, or two bots wedged
      // together) eventually gets skipped rather than looping forever.
      this._respawnTries = (this._respawnTries || 0) + 1;
      this._respawnOnLine(4 + this._respawnTries * 4);
      this._lastRespawnTraveled = this.traveled;
      this._noProgressT = 0;
      this._bestTraveled = this.traveled;
      this.recoverT = 0;
      this.stuckT = 0;
      this._lastPos.copy(cur);
      return;
    }

    // ---- Perceive: project our real (physics) position onto the racing line ----
    const newArc = this.line.projectNear(cur, this.arc);
    let dArc = newArc - this.arc;
    if (dArc < -this.line.length / 2) dArc += this.line.length;
    if (dArc > this.line.length / 2) dArc -= this.line.length;
    if (dArc > -3 && dArc < this.speed * dt + 4) this.traveled += dArc;
    this.arc = newArc;
    this.progress = this.traveled / this.line.length;
    this.gateIndex = Math.max(0, Math.min(this.totalGates, Math.floor(this.progress * this.totalGates)));

    if (this.progress >= 1 && !this.finished) {
      this.finished = true;
      this.gateIndex = this.totalGates;
      if (typeof ctx.raceStartTime === 'number') this.finishMs = Date.now() - ctx.raceStartTime;
      return;
    }

    // ---- Decide target speed (corners + rivals + mistakes) ----
    const plan = ctx.racers ? this._planWithRivals(ctx.racers) : { speedScale: 1, latNudge: 0 };
    let desiredKPH = this._cornerSpeedKPH() * plan.speedScale * this.throttleHold;
    desiredKPH *= 0.97 + this.wThrottle.step(dt, 0.03 * (1 - this.consistency)) + 0.03;

    // ---- Choose the aimed lateral offset from the centerline ----
    // Small and SLOW-moving: a fast-changing lateral target makes the aim point
    // jump side to side, which makes the car saw at the wheel and scrub speed.
    // Only rival nudges (overtaking) plus a gentle skill-scaled drift.
    const wanderAmp = 0.4 + (1 - this.skill) * 0.8;
    const wanderedLane = this.wLine.step(dt, wanderAmp) + plan.latNudge;
    this.latTarget += (wanderedLane - this.latTarget) * Math.min(1, dt * 0.8);
    this.latTarget = THREE.MathUtils.clamp(this.latTarget, -5, 5);

    // ---- Pure-pursuit: aim at a point ahead on the centerline ----
    const Ld = THREE.MathUtils.clamp(12 + this.speed * 0.5, 12, 45);
    this.line.pointAt(this.arc + Ld, this._tgt);
    this.line.tangentAt(this.arc + Ld, this._tan);
    this._perp.set(this._tan.z, 0, -this._tan.x).normalize();
    this._tgt.addScaledVector(this._perp, this.latTarget);

    // Heading error between where the car points and where we want to go.
    this.carModel.getWorldDirection(this._fwd);
    this._fwd.y = 0; this._fwd.normalize();
    const toX = this._tgt.x - cur.x;
    const toZ = this._tgt.z - cur.z;
    const desiredHeading = Math.atan2(toX, toZ);
    const carHeading = Math.atan2(this._fwd.x, this._fwd.z);
    let headErr = desiredHeading - carHeading;
    while (headErr > Math.PI) headErr -= Math.PI * 2;
    while (headErr < -Math.PI) headErr += Math.PI * 2;
    const commandedErr = headErr;

    // ---- Map decisions to KEY PRESSES (steering) ----
    // Press A (left) / D (right) whenever we're off the desired heading by more
    // than a small deadzone, holding it through the corner so updateSteering
    // ramps the wheel to the lock the bend needs. A little hysteresis (release
    // < engage) stops fast A/D chatter on near-straight sections. Small steering
    // corrections while gently off-line get a proportional DUTY CYCLE so we
    // don't over-correct and weave on the straights.
    const engage = 0.03;
    const release = 0.012;
    let steerDir = this._steerDir || 0;
    if (steerDir === 0) {
      if (commandedErr > engage) steerDir = 1;
      else if (commandedErr < -engage) steerDir = -1;
    } else if (steerDir > 0) {
      if (commandedErr < release) steerDir = (commandedErr < -engage) ? -1 : 0;
    } else {
      if (commandedErr > -release) steerDir = (commandedErr > engage) ? 1 : 0;
    }
    this._steerDir = steerDir;

    // Hold the key continuously while a turn is engaged so updateSteering can
    // ramp to the lock a real corner (especially a slow hairpin) needs. Only
    // when we're going fast AND the correction is tiny do we pulse the key with
    // a duty cycle, to avoid nervous weaving on high-speed straights.
    let pressSteer = true;
    if (speedKPH > 60 && Math.abs(commandedErr) < 0.08) {
      const strength = THREE.MathUtils.clamp(Math.abs(commandedErr) / 0.08, 0.25, 1);
      this._steerDuty = (this._steerDuty || 0) + strength;
      pressSteer = false;
      if (this._steerDuty >= 1) { this._steerDuty -= 1; pressSteer = true; }
    }

    if (steerDir > 0 && pressSteer) ks.a = true;
    else if (steerDir < 0 && pressSteer) ks.d = true;

    const speedErr = desiredKPH - speedKPH;
    const absErr = Math.abs(commandedErr);
    // Throttle / brake. The corner-speed planner reads the car's TRUE velocity
    // from Ammo (position-differencing spikes wildly and used to trigger phantom
    // brakes), and returns a safe target speed for the upcoming curvature; we
    // simply chase it:
    //   - big heading error => fighting a tight corner; lift so we don't power
    //     into the outside wall until the nose comes back around
    //   - below target      => full throttle
    //   - slightly over     => coast (no throttle, no brake) to bleed off speed
    //   - clearly over      => brake, stabbing the handbrake into a fast hairpin
    if (absErr > 0.9 && speedKPH > 30) {
      ks.w = false;
    } else if (speedErr > -2) {
      ks.w = true;
    } else if (speedErr > -10) {
      ks.w = false;
    } else {
      ks.s = true;
      if (speedKPH > 90 && absErr > 0.6 && this.aggression > 0.7) {
        ks.space = Math.random() < 0.35;
      }
    }

    // Don't sit still on the grid once running: always drive if barely moving.
    if (speedKPH < 4) { ks.w = true; ks.s = false; ks.space = false; }
  }

  // Sync the render model + wheels from the real physics transform, using the
  // shared render-interpolation helper. Called once per rendered frame.
  render(recordFn, renderFn, alpha) {
    if (!this.ready || !this.vehicle || !this.carModel) return;
    renderFn(this.carModel, this.wheelMeshes, this.renderState, alpha);
  }

  // Record the latest physics transform for interpolation (once per tick).
  recordPhysics(recordFn) {
    if (!this.ready || !this.vehicle) return;
    recordFn(this.vehicle, this.renderState);
  }
}

// ---- Exports used by main.js ---------------------------------------------

export function waypointsFromGates(gates) {
  const pts = [];
  const v = new THREE.Vector3();
  gates.forEach((g) => {
    g.getWorldPosition(v);
    pts.push(v.clone());
  });
  return pts;
}

export function pickBotNames(n) {
  const pool = [...NAME_POOL];
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

export function botColor(i) {
  return BOT_COLORS[i % BOT_COLORS.length];
}
