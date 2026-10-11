// Headless smoke test: runs one cycle of every profile plus a few parameter
// variations and checks the physics stays sane.  Usage: node test/run.js
const assert = require('assert');
const { WhipSim, PROFILES, SPEED_OF_SOUND } = require('../sim.js');

function run(opts) {
  const sim = new WhipSim(opts);
  const dur = sim.profile.keys[sim.profile.keys.length - 1].t / sim.params.speed;
  let maxTau = [0, 0, 0], maxTension = 0, maxHandle = 0;
  const steps = Math.round(dur / sim.params.dt);
  for (let s = 0; s < steps; s++) {
    sim.step();
    for (let j = 0; j < 3; j++) maxTau[j] = Math.max(maxTau[j], Math.abs(sim.tau[j]));
    maxTension = Math.max(maxTension, sim.tension);
    maxHandle = Math.max(maxHandle, sim.handleSpeed());
    assert(Number.isFinite(sim.tipSpeed), `non-finite state at t=${sim.t}`);
  }
  let len = 0;
  for (let i = 1; i < sim.N - 1; i++) {
    len += Math.hypot(sim.x[2 * i + 2] - sim.x[2 * i], sim.x[2 * i + 3] - sim.x[2 * i + 1]);
  }
  return { sim, maxTau, maxTension, maxHandle, len };
}

const cases = [
  ...Object.keys(PROFILES).map((profile) => ({ profile })),
  { segments: 32 },
  { segments: 80 },
  { speed: 1.3 },
  { whipLength: 3.2 },
  { dragScale: 0 },
];

const results = {};
for (const opts of cases) {
  const label = JSON.stringify(opts);
  const { sim, maxTau, maxTension, maxHandle, len } = run(opts);
  results[label] = sim;
  console.log(
    `${label.padEnd(24)} peak tip ${sim.peakTipSpeed.toFixed(0).padStart(4)} m/s ` +
    `(Mach ${(sim.peakTipSpeed / SPEED_OF_SOUND).toFixed(2)}), cracks ${sim.cracks.length}, ` +
    `handle ${maxHandle.toFixed(1)} m/s, tension ${maxTension.toFixed(0)} N, ` +
    `|tau| ${maxTau.map((t) => t.toFixed(0)).join('/')} N m, mass ${(sim.totalMass * 1000).toFixed(0)} g`
  );
  // inextensible whip stays inextensible
  assert(Math.abs(len - sim.params.whipLength) < 0.01 * sim.params.whipLength, `${label}: whip stretched to ${len}`);
  // nothing in this setup should get anywhere near Mach 3
  assert(sim.peakTipSpeed < 3 * SPEED_OF_SOUND, `${label}: implausible tip speed ${sim.peakTipSpeed}`);
}

assert(results['{"profile":"overhead"}'].cracks.length >= 1, 'overhead profile should crack');
assert(results['{"profile":"flick"}'].cracks.length >= 1, 'flick profile should crack');
assert.strictEqual(results['{"profile":"gentle"}'].cracks.length, 0, 'slow swing should not crack');
console.log('ok');
