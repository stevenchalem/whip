// Shared helper for evaluating aimed strikes headlessly.
const { WhipSim, makeStrikeProfile, strikeTrial } = require('../sim.js');

const CARD_X = 2.6;
const settled = new Map(); // one settled sim per arm

// WHIP_LOCK=elbow|wrist runs everything with that joint held rigid (a two-joint arm).
const LOCKS = { elbow: 1, wrist: 2 };
const SIM_OPTS = process.env.WHIP_LOCK ? { locked: LOCKS[process.env.WHIP_LOCK], lockedAngle: 0 } : {};
if (process.env.WHIP_LOCK && SIM_OPTS.locked == null) throw new Error(`WHIP_LOCK must be one of ${Object.keys(LOCKS)}`);

// Run one strike at a card centred at `height`. `trial` = { seed, trigger, locked }:
// a seed applies random disturbances (no seed is the nominal case); `locked`
// ('elbow' or 'wrist') overrides WHIP_LOCK for this call.
function evaluate(aim, height, trial = {}) {
  const opts = trial.locked ? { locked: LOCKS[trial.locked], lockedAngle: 0 } : SIM_OPTS;
  const key = String(opts.locked);
  if (!settled.has(key)) {
    settled.set(key, new WhipSim({
      profile: makeStrikeProfile({ windup: [115, 20, 35], end: [10, -15, -45], strikeTime: 0.2, hold: 0.45 }),
      target: { x: CARD_X, y: height },
      ...opts,
    }));
  }
  const gen = strikeTrial(settled.get(key), aim, height, trial, Infinity);
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

// Seeds used while optimising; tools/trials.js uses different ones.
const SEEDS = [null, 1, 2, 3, 4];

// Any hit beats any miss; hits near the card centre and faster hits are better.
const score = (r) => (r.hit ? -0.1 + 0.1 * Math.min(1, Math.abs(r.dy) / 0.048) - r.speed / 2000 : r.miss);

// x = [windup shoulder, end shoulder, end elbow, end wrist, strike time, (windup elbow, windup wrist)]
const toAim = (x) => ({
  windup: [x[0], x.length > 5 ? x[5] : 20, x.length > 6 ? x[6] : 35],
  end: [x[1], x[2], x[3]],
  strikeTime: x[4],
  hold: 0,
});

module.exports = { evaluate, CARD_X, SEEDS, score, toAim, SIM_OPTS };
