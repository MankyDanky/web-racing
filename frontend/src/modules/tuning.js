// Single source of truth for all handling / physics magic numbers (#18).
//
// Previously mass, gravity, friction, steering limits, engine/brake forces and
// suspension parameters were scattered across physics.js and car.js. Collecting
// them here means the car can be retuned (or tuned per-track) in one place.

export const TUNING = {
  // World
  gravity: -20,

  // Chassis
  mass: 200,
  chassisFriction: 0.1,

  // Vehicle dimensions
  vehicleWidth: 2.0,
  vehicleHeight: 0.6,
  vehicleLength: 4.0,
  wheelRadius: 0.4,
  wheelWidth: 0.25,
  wheelXOffset: 0.8,
  wheelZOffset: 1.5,

  // Suspension
  suspensionRestLength: 0.3,
  suspensionStiffness: 50,
  suspensionDamping: 10,
  suspensionCompression: 4.0,
  // Travel clamped to ~= rest length so wheels can't punch into the chassis
  // on hard landings (#15). Previously this was restLength * 150.
  maxSuspensionTravelCm: 0.3 * 100, // = restLength in cm

  // Grip
  frictionSlip: 10,
  rollInfluence: 0.1,

  // Drive forces (#14) - braking used to be 20x weaker than the engine.
  maxEngineForce: 1000,
  reverseEngineForce: 500,
  maxBrakingForce: 240,      // hard brake (was 50)
  coastBrakingForce: 8,      // light brake when coasting (was 20)
  handbrakeForce: 400,       // space bar

  // Engine-force curve vs speed (#14): full force at low speed, tapering off as
  // the car approaches top speed for a more natural acceleration feel.
  engineForceTopSpeedKPH: 190,

  // Steering
  minSteeringAngle: 0.15, // at high speed
  maxSteeringAngle: 0.4,  // at low speed
  steeringSpeed: 1.5,
  steeringReturnSpeed: 2,
  steerSpeedRefKPH: 150,

  // Handling assists (#19)
  assists: {
    tractionControl: true,      // limit engine force when wheels slip at speed
    counterSteer: true,         // small auto counter-steer to tame spins
    counterSteerGain: 0.35,
    driftMode: false,           // reduce rear grip for slides
    driftFrictionSlip: 4.5,
  },
};

// Optional per-track overrides merged over the base tuning.
const TRACK_TUNING = {
  map1: {},
  map2: {
    // Snowy Speedway: a touch more slippery.
    frictionSlip: 8,
  },
};

export function getTuning(trackId = 'map1') {
  const override = TRACK_TUNING[trackId] || {};
  return {
    ...TUNING,
    ...override,
    assists: { ...TUNING.assists, ...(override.assists || {}) },
  };
}
