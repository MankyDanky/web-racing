// Lightweight AI opponents for solo play. Bots are kinematic (they follow
// the checkpoint gates) and do not participate in physics collisions, so
// they can never destabilize a race. They exist to make offline practice
// feel like a race.

import * as THREE from 'three';

const BOT_COLORS = [0xff5555, 0x44bb66, 0x4488ee, 0xffcc33];
const BOT_NAMES = ['BLITZ', 'VIPER', 'NOVA', 'KOJI'];

class Bot {
  constructor(index, gates, spawnPos, spawnQuat) {
    this.index = index;
    this.name = BOT_NAMES[index % BOT_NAMES.length];
    this.color = BOT_COLORS[index % BOT_COLORS.length];
    this.gates = gates;
    this.gateIndex = 0;
    this.finished = false;
    this.finishTimeMs = null;
    this.speed = 16 + Math.random() * 7;      // m/s target speed
    this.topSpeed = this.speed;
    this.heading = new THREE.Euler().setFromQuaternion(spawnQuat, 'YXZ').y;
    this.position = spawnPos.clone().add(
      new THREE.Vector3((index - 1) * 3, 0, -(index + 1) * 4).applyEuler(new THREE.Euler(0, this.heading, 0))
    );
    this.model = this.buildModel();
    this.model.position.copy(this.position);
    this.raceProgress = { currentGateIndex: 0, distanceToNextGate: 1e6 };
    this.raceFinished = false;
    this.lastUpdate = Date.now();
    this.tmpDir = new THREE.Vector3();
  }

  buildModel() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.7, 4),
      new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.6 })
    );
    body.position.y = 0.75;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.6, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.4 })
    );
    cabin.position.set(0, 1.35, -0.3);
    group.add(body, cabin);
    for (const [x, z] of [[-0.9, 1.4], [0.9, 1.4], [-0.9, -1.4], [0.9, -1.4]]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.35, 14),
        new THREE.MeshStandardMaterial({ color: 0x111111 })
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.42, z);
      group.add(wheel);
    }
    group.castShadow = false;
    return group;
  }

  start() {
    this.raceStart = Date.now();
  }

  update(dt) {
    if (this.finished) {
      this.model.position.copy(this.position);
      return;
    }
    const gate = this.gates[this.gateIndex];
    if (!gate) { this.finish(); return; }

    gate.getWorldPosition(this.tmpDir);
    const dx = this.tmpDir.x - this.position.x;
    const dz = this.tmpDir.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    this.raceProgress.distanceToNextGate = dist;

    if (dist < 14) {
      this.gateIndex++;
      this.raceProgress.currentGateIndex = this.gateIndex;
      if (this.gateIndex >= this.gates.length) { this.finish(); return; }
    }

    // Proportional heading control toward the gate, with cornering slowdown.
    const targetHeading = Math.atan2(dx, dz);
    let diff = targetHeading - this.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.heading += diff * Math.min(1, dt * 3.2);

    const cornerFactor = Math.max(0.45, 1 - Math.abs(diff) * 0.9);
    const v = this.speed * cornerFactor;
    this.position.x += Math.sin(this.heading) * v * dt;
    this.position.z += Math.cos(this.heading) * v * dt;

    this.model.position.copy(this.position);
    this.model.rotation.y = this.heading;
    this.lastUpdate = Date.now();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.raceFinished = true;
    this.finishTimeMs = Date.now() - this.raceStart;
    this.raceProgress.currentGateIndex = this.gates.length;
  }
}

export function createBots(count, gateData, spawnPos, spawnQuat, scene) {
  const bots = [];
  for (let i = 0; i < Math.min(4, Math.max(0, count)); i++) {
    const bot = new Bot(i, gateData.gates, spawnPos, spawnQuat);
    scene.add(bot.model);
    bots.push(bot);
  }
  return {
    bots,
    update(dt) {
      for (const b of bots) b.update(dt);
    },
    start() {
      for (const b of bots) b.start();
    },
  };
}
