// Physics-based AI drivers.
//
// Each AI sits in the SAME seat as a human: a real ammo.js btRaycastVehicle
// driven through the exact same control path (throttle/brake keyState +
// analog steerAxis into updateSteering/updatePhysics). No kinematic
// cheating - AI cars have suspension, grip, collisions, flips and resets,
// exactly like the player.
//
// The "brain" is a pure-pursuit steering controller plus corner-speed
// planning (v = sqrt(a_lat * d / theta)), wrapped in human-like flaws:
// steering noise, occasional mistakes, stuck-recovery reversing, and gentle
// rubber-banding so races against them feel like a live lobby.

import * as THREE from 'three';
import { createVehicle, updateSteering, updateCarPosition, resetCarPosition } from './car.js';
import { updatePhysics } from './physics.js';
import { sweptGateHit } from './gates.js';

const LAT_ACCEL = 13;            // lateral m/s^2 the driver is willing to pull
const SNAP_MS = 50;              // 20 Hz snapshots into the interpolation buffer

const _gatePos = new THREE.Vector3();
const _nextPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class AIDriver {
  constructor(cfg) {
    this.name = cfg.name;
    this.gates = cfg.gates;
    this.raceState = cfg.raceState;
    this.trackId = cfg.trackId || 'map1';
    this.onReady = cfg.onReady;
    this.onFinish = cfg.onFinish;

    // personality
    this.skill = 0.86 + Math.random() * 0.14;          // top-speed factor
    this.aggression = 0.9 + Math.random() * 0.2;       // corner speed factor
    this.noisePhase = Math.random() * 100;
    this.mistakeAt = 15000 + Math.random() * 25000;    // ms until next mistake
    this.mistakeLeft = 0;

    // driving state
    this.keyState = { w: false, s: false, a: false, d: false };
    this.steerAxis = 0;
    this.currentSteeringAngle = 0;
    this.gateIndex = 0;
    this.finished = false;
    this.finishMs = null;
    this.lastSpeedKph = 0;
    this.stuckTime = 0;
    this.reverseLeft = 0;
    this.flippedTime = 0;
    this.lastSnap = 0;
    this.lastUpdate = Date.now();
    this.raceProgress = { currentGateIndex: 0, distanceToNextGate: 1e6 };

    this.prevPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();

    const components = createVehicle(
      cfg.ammo, cfg.scene, cfg.physicsWorld, cfg.debugObjects || [],
      (loaded) => {
        this.carModel = loaded.carModel;
        this.wheelMeshes = loaded.wheelMeshes;
        this.ready = true;
        if (this.carModel) {
          this.prevPos.copy(this.carModel.position);
          this.prevQuat.copy(this.carModel.quaternion);
        }
        if (this.onReady) this.onReady(this);
      },
      { color: cfg.color }
    );
    this.carBody = components.carBody;
    this.vehicle = components.vehicle;
    this.wheelMeshes = components.wheelMeshes;
    // AI cars collide with the track, but are ghosts vs players and each other.
    // AI lives in group 4: solid vs the track, ghost vs every car, so bot
    // physics can never launch the player. Some Ammo.js glues omit the
    // setCollisionFilter* methods - write the broadphase proxy directly then.
    if (typeof this.carBody.setCollisionFilterGroup === 'function') {
      this.carBody.setCollisionFilterGroup(4);
      this.carBody.setCollisionFilterMask(1);
    } else {
      const proxy = typeof this.carBody.getBroadphaseProxy === 'function' ? this.carBody.getBroadphaseProxy() : null;
      if (proxy) {
        proxy.m_collisionFilterGroup = 4;
        proxy.m_collisionFilterMask = 1;
      }
    }

    // Grid slot behind/beside the player start (start faces +Z).
    const i = cfg.spawnIndex || 0;
    const gx = (i % 2 === 0 ? -2.6 : 2.6);
    const gz = -6 - Math.floor(i / 2) * 5;
    const tr = new cfg.ammo.btTransform();
    tr.setIdentity();
    tr.setOrigin(new cfg.ammo.btVector3(gx, 5.2, gz));
    this.carBody.setWorldTransform(tr);
    this.carBody.getMotionState().setWorldTransform(tr);
  }

  // Decide throttle/brake/steer like a human would: look at the gate,
  // judge the next corner, add a little noise and the occasional mistake.
  think(now) {
    const model = this.carModel;
    if (!model || this.finished) {
      this.keyState.w = false;
      this.keyState.s = false;
      this.steerAxis = 0;
      return;
    }

    const gate = this.gates[Math.min(this.gateIndex, this.gates.length - 1)];
    if (!gate) return;
    gate.getWorldPosition(_gatePos);

    const dx = _gatePos.x - model.position.x;
    const dz = _gatePos.z - model.position.z;
    const dist = Math.hypot(dx, dz);
    this.raceProgress.distanceToNextGate = dist;

    model.getWorldDirection(_fwd);
    const heading = Math.atan2(_fwd.x, _fwd.z);
    const target = Math.atan2(dx, dz);
    const err = wrapAngle(target - heading);

    // Curvature lookahead: how sharp is the bend at the gate?
    const next = this.gates[this.gateIndex + 1];
    let turn = 0.3;
    if (next) {
      next.getWorldPosition(_nextPos);
      const a1 = Math.atan2(_gatePos.x - model.position.x, _gatePos.z - model.position.z);
      const a2 = Math.atan2(_nextPos.x - _gatePos.x, _nextPos.z - _gatePos.z);
      turn = Math.abs(wrapAngle(a2 - a1));
    }

    // human steering noise + scheduled mistake
    const t = now * 0.001;
    let noise = Math.sin(t * 1.9 + this.noisePhase) * 0.05 + Math.sin(t * 0.7 + this.noisePhase * 2) * 0.05;
    if (now > this.mistakeAt) {
      this.mistakeLeft = 450;
      this.mistakeAt = now + 18000 + Math.random() * 30000;
    }
    if (this.mistakeLeft > 0) noise += 0.35;

    this.steerAxis = THREE.MathUtils.clamp(err * 2.6 + noise, -1, 1);

    // corner speed from real grip physics: estimate the bend radius from the
    // gate spacing (R ~ segment length / turn angle) and carry the speed a
    // competent driver could hold through it: v = sqrt(mu*g*R).
    const top = (30 + 8 * this.skill) * this.rubber;   // 108-137 kph, human pace
    let cornerV = top;
    if (next) {
      const segLen = Math.hypot(_nextPos.x - _gatePos.x, _nextPos.z - _gatePos.z);
      const radius = Math.max(6, segLen / Math.max(turn, 0.25));
      // grip-limited arc speed ...
      const gripV = Math.sqrt(8.5 * radius) * this.aggression;
      // ... capped by severity: a hairpin at the gate can only be turned
      // inside the road width, no matter how wide the next segment is.
      const turnCap = turn > 2.2 ? 7.5 : turn > 1.6 ? 9 : turn > 1.0 ? 11 : 14;
      cornerV = Math.min(gripV, turnCap) / (1 + 0.35 * Math.abs(err));
    }
    let vTarget = Math.max(6, Math.min(top, cornerV));
    // distance-aware braking (~5 m/s^2, margin for weaker real brakes):
    // arrive at the bend at cornerV, not above it.
    if (turn > 0.45 && dist > 8) {
      const vAllow = Math.sqrt(cornerV * cornerV + 10 * (dist - 8));
      vTarget = Math.max(6, Math.min(vTarget, vAllow));
    }
    this.lastVTarget = vTarget;
    this.lastErr = err;
    this.lastTurn = turn;

    const speed = this.lastSpeedKph / 3.6;
    if (this.reverseLeft > 0) {
      this.keyState.w = false;
      this.keyState.s = true;
    } else if (speed > vTarget + 0.5) {
      this.keyState.w = false;
      this.keyState.s = true;
    } else {
      this.keyState.w = true;
      this.keyState.s = false;
    }
  }

  // Compact state dump for tests/diagnostics.
  debug() {
    const p = this.carModel ? this.carModel.position : { x: 0, y: 0, z: 0 };
    return {
      gate: this.gateIndex, fin: this.finished, kph: Math.round(this.lastSpeedKph),
      vT: Math.round(this.lastVTarget * 10) / 10, err: Math.round((this.lastErr || 0) * 100) / 100,
      turn: Math.round((this.lastTurn || 0) * 100) / 100,
      w: this.keyState.w, s: this.keyState.s, steer: Math.round(this.steerAxis * 100) / 100,
      rev: Math.round(this.reverseLeft), stuckT: Math.round(this.stuckTime * 10) / 10,
      stuckC: this.stuckCount || 0, flipT: Math.round(this.flippedTime * 10) / 10,
      rub: Math.round((this.rubber || 1) * 100) / 100, fell: this.fellCount || 0,
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10,
    };
  }

  step(dt, now, env) {
    if (!this.ready || !this.carModel) return;
    this.rubber = env.rubberFor ? env.rubberFor(this) : 1;

    if (this.mistakeLeft > 0) this.mistakeLeft -= dt * 1000;
    if (this.reverseLeft > 0) this.reverseLeft -= dt * 1000;

    this.think(now);

    const carState = {
      carBody: this.carBody,
      vehicle: this.vehicle,
      carModel: this.carModel,
      wheelMeshes: this.wheelMeshes,
      keyState: this.keyState,
      currentSteeringAngle: this.currentSteeringAngle,
      updateSteering,
      steerAxis: this.steerAxis,
      settings: { assists: true, sensitivity: 1 },
      trackId: this.trackId,
    };

    this.prevPos.copy(this.carModel.position);
    this.prevQuat.copy(this.carModel.quaternion);

    const res = updatePhysics(dt, env.ammo, { physicsWorld: env.physicsWorld, tmpTrans: env.tmpTrans }, carState, [], this.raceState);

    // explosion clamp for the AI too
    const lv = this.carBody.getLinearVelocity();
    const sp = Math.hypot(lv.x(), lv.y(), lv.z());
    if (!isFinite(sp) || sp > 50) {
      const z = new env.ammo.btVector3(0, 0, 0);
      this.carBody.setLinearVelocity(z);
      this.carBody.setAngularVelocity(z);
      env.ammo.destroy(z);
    }
    env.ammo.destroy(lv);
    this.lastSpeedKph = res.currentSpeed;
    this.currentSteeringAngle = res.currentSteeringAngle;
    updateCarPosition(env.ammo, this.vehicle, this.carModel, this.wheelMeshes);

    // drove off the course - respawn at the last checkpoint right away,
    // like a player tapping R. Without this a bot falls forever (the wheel
    // speed HUD keeps ticking in mid-air, so stuck/flip checks never fire).
    const cy = this.carModel.position.y;
    if (!isFinite(cy) || cy < -2) {
      const back = this.gates[Math.max(0, this.gateIndex - 1)] || this.gates[0];
      if (back) {
        back.getWorldPosition(_gatePos);
        this.currentSteeringAngle = resetCarPosition(
          env.ammo, this.carBody, this.vehicle, this.currentSteeringAngle,
          _gatePos, back.quaternion);
        this.stuckTime = 0;
        this.flippedTime = 0;
        this.lastSpeedKph = 0;
        this.fellCount = (this.fellCount || 0) + 1;
      }
    }

    // own gate progress (swept test, no shared gateData mutation)
    if (!this.finished && this.gateIndex < this.gates.length) {
      if (sweptGateHit(this.prevPos, this.carModel.position, this.gates[this.gateIndex], 400)) {
        this.gateIndex++;
        this.stuckCount = 0;
        this.raceProgress.currentGateIndex = this.gateIndex;
        if (this.gateIndex >= this.gates.length) {
          this.finished = true;
          this.finishMs = Math.max(1000, Date.now() - (window.raceStartTimeMs || Date.now()));
          if (this.onFinish) this.onFinish(this);
        }
      }
    }

    // flipped recovery, same rule as the player auto-reset
    const upDot = this.carModel.quaternion.y * this.carModel.quaternion.y + this.carModel.quaternion.w * this.carModel.quaternion.w
      - this.carModel.quaternion.x * this.carModel.quaternion.x - this.carModel.quaternion.z * this.carModel.quaternion.z;
    if (upDot < 0.5 && this.lastSpeedKph < 20) {
      this.flippedTime += dt;
      if (this.flippedTime > 1) {
        this.flippedTime = 0;
        const gate = this.gates[Math.max(0, this.gateIndex - 1)] || this.gates[0];
        if (gate) {
          gate.getWorldPosition(_gatePos);
          this.currentSteeringAngle = resetCarPosition(
            env.ammo, this.carBody, this.vehicle, this.currentSteeringAngle,
            _gatePos, gate.quaternion
          );
        }
      }
    } else {
      this.flippedTime = 0;
    }

    // stuck detection -> reverse like a human would; if that fails twice,
    // do what a frustrated player does: reset to the last checkpoint (R).
    if (this.raceState.raceStarted && !this.finished && this.reverseLeft <= 0) {
      if (this.lastSpeedKph < 4) {
        this.stuckTime += dt;
        if (this.stuckTime > 1.2) {
          this.stuckTime = 0;
          this.stuckCount = (this.stuckCount || 0) + 1;
          if (this.stuckCount >= 2) {
            this.stuckCount = 0;
            const back = this.gates[Math.max(0, this.gateIndex - 1)] || this.gates[0];
            if (back) {
              back.getWorldPosition(_gatePos);
              this.currentSteeringAngle = resetCarPosition(
                env.ammo, this.carBody, this.vehicle, this.currentSteeringAngle,
                _gatePos, back.quaternion);
            }
          } else {
            this.reverseLeft = 1300;
          }
        }
      } else {
        this.stuckTime = 0;
      }
    }

    // 20 Hz snapshots into the interpolation buffer -> renders exactly like
    // a networked opponent.
    if (now - this.lastSnap >= SNAP_MS) {
      this.lastSnap = now;
      if (this.onSnapshot) {
        this.onSnapshot(now,
          { x: this.carModel.position.x, y: this.carModel.position.y, z: this.carModel.position.z },
          { x: this.carModel.quaternion.x, y: this.carModel.quaternion.y, z: this.carModel.quaternion.z, w: this.carModel.quaternion.w });
      }
    }
    this.lastUpdate = Date.now();
  }
}
