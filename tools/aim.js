// Optimise aimed-strike parameters for card heights from 0.5 to 2 m.
//   node tools/aim.js [--descending] --out rows.json
// Set WHIP_LOCK=elbow|wrist to optimise a two-joint arm, WHIP_WORKERS=n to limit threads.
// writes the solved rows (with their scores) to a JSON file; tools/merge-aim.js
// then combines sweeps into the AIM_TABLE block in sim.js.
//
// The default sweep runs upward from 0.5 m and varies only the wind-up shoulder
// angle. --descending runs downward from 2 m, also varies the wind-up elbow and
// wrist, and starts from lower, flatter wind-ups.
//
// Heights are solved in order, each starting from the previous solution, so
// neighbouring rows describe similar motions and can be interpolated. Each
// candidate is scored on a nominal strike plus disturbed ones; evaluations run
// in parallel worker threads. Expect 10-15 minutes on 4 cores.
const { Worker, isMainThread, parentPort } = require('worker_threads');

const DESC = process.argv.includes('--descending');
const OUT = process.argv[process.argv.indexOf('--out') + 1];
const HEIGHTS = [];
for (let h = 0.5; h <= 2.0001; h += 0.125) HEIGHTS.push(Math.round(h * 1000) / 1000);
if (DESC) HEIGHTS.reverse();
const { SEEDS, score, toAim } = require('./strike.js');
// x = [windup shoulder, end shoulder, end elbow, end wrist, strike time, (windup elbow, windup wrist)]
const LO = [60, -40, -60, -100, 0.12, -30, -30], HI = [150, 60, 30, 10, 0.4, 60, 80];
const NP = DESC ? 7 : 5;

if (!isMainThread) {
  const { toAim } = require('./strike.js');
  const { evaluate } = require('./strike.js');
  parentPort.on('message', ({ id, x, h, seed }) => {
    const r = evaluate(toAim(x), h, seed == null ? {} : { seed });
    parentPort.postMessage({ id, r: { hit: r.hit, miss: r.miss, dy: r.dy, speed: r.speed, hold: r.hold } });
  });
  return;
}

const fs = require('fs');
const os = require('os');
const { rng } = require('../sim.js');

// --- worker pool
const workers = Array.from({ length: parseInt(process.env.WHIP_WORKERS || os.cpus().length, 10) }, () => new Worker(__filename));
const idle = workers.slice();
const pending = new Map();
const queue = [];
let nextId = 0;
workers.forEach((w) => w.on('message', ({ id, r }) => {
  pending.get(id)(r);
  pending.delete(id);
  idle.push(w);
  pump();
}));
function pump() {
  while (idle.length && queue.length) {
    const job = queue.shift();
    pending.set(job.id, job.resolve);
    idle.pop().postMessage(job.msg);
  }
}
const run = (x, h, seed) => new Promise((resolve) => {
  const id = nextId++;
  queue.push({ id, msg: { id, x, h, seed }, resolve });
  pump();
});

const cost = async (x, h) => {
  const rs = await Promise.all(SEEDS.map((s) => run(x, h, s)));
  return rs.reduce((a, r) => a + score(r), 0) / rs.length;
};
const clamp = (x) => x.map((v, i) => Math.min(HI[i], Math.max(LO[i], v)));
const lo = LO.slice(0, NP), hi = HI.slice(0, NP);

async function solve(h, starts, seed) {
  let best = null, bestC = Infinity;
  const cs = await Promise.all(starts.map((x) => cost(x, h)));
  cs.forEach((c, i) => { if (c < bestC) { bestC = c; best = starts[i]; } });
  const rand = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const span = hi.map((v, i) => v - lo[i]);
  let sigma = 0.06;
  for (let gen = 0; gen < 18; gen++) {
    const ys = Array.from({ length: 4 }, () => clamp(best.map((v, i) => v + sigma * span[i] * gauss())));
    const yc = await Promise.all(ys.map((y) => cost(y, h)));
    let improved = false;
    yc.forEach((c, i) => { if (c < bestC) { bestC = c; best = ys[i]; improved = true; } });
    sigma = Math.max(0.01, Math.min(0.2, sigma * (improved ? 1.3 : 0.8)));
  }
  return { best, bestC };
}

(async () => {
  // starting points for the first height: a coarse grid
  const grid = [];
  if (DESC) {
    for (const w of [70, 100, 130]) for (const we of [0, 40]) for (const e1 of [40, 10, -20]) for (const e3 of [-60, -20]) grid.push([w, e1, -25, e3, 0.2, we, 30]);
  } else {
    for (const w of [115, 135]) for (const e1 of [40, 10, -20]) for (const e3 of [-80, -45, -15]) grid.push([w, e1, -25, e3, 0.2]);
  }
  const rows = [];
  let prev = null;
  for (const h of HEIGHTS) {
    const starts = prev ? [prev, ...grid.filter((_, i) => i % 3 === 0)] : grid;
    const { best, bestC } = await solve(h, starts, 7 + h * 1000);
    prev = best;
    const nominal = await run(best, h, null);
    rows.push({ h, cost: bestC, family: DESC ? 'flat' : 'overhead', ...toAim(best) });
    console.log(`h=${h}: cost ${bestC.toFixed(3)}, nominal ${nominal.hit ? `hit at ${nominal.speed.toFixed(0)} m/s` : `miss ${(nominal.miss * 100).toFixed(0)} cm`}`);
  }
  workers.forEach((w) => w.terminate());

  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
  console.log(`wrote ${rows.length} rows to ${OUT}`);
})();
