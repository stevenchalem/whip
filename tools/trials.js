// Robustness check for the aim table: for several card heights (table rows and
// heights in between), run disturbed strikes with each trigger and report hit
// rates.  Usage: node tools/trials.js [trialsPerCase=20]
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const HEIGHTS = [0.5, 0.6, 0.75, 0.9, 1.0, 1.2, 1.25, 1.4, 1.5, 1.6, 1.75, 1.9, 2.0];
const N = parseInt(process.argv[2] || '20', 10);

if (isMainThread) {
  const os = require('os');
  const queue = HEIGHTS.slice();
  const rows = [];
  let running = 0;
  const next = () => {
    const h = queue.shift();
    running++;
    const w = new Worker(__filename, { workerData: { h, n: N } });
    w.on('message', (r) => rows.push(r));
    w.on('error', (e) => { console.error(e); process.exitCode = 1; });
    w.on('exit', () => { running--; if (queue.length) next(); else if (!running) report(); });
  };
  for (let i = 0; i < Math.min(os.cpus().length, queue.length); i++) next();

  function report() {
    rows.sort((a, b) => a.h - b.h);
    const pct = (x) => `${String(Math.round(x * 100)).padStart(3)}%`;
    console.log('height  nominal       unrolled-trigger            fixed-clock');
    let tot = { e: 0, t: 0 };
    for (const r of rows) {
      tot.e += r.extended.rate; tot.t += r.timed.rate;
      const f = (m) => `${pct(m.rate)} hit, miss ${m.miss == null ? '  -' : String(Math.round(m.miss * 100)).padStart(3)} cm, ${m.speed == null ? '  -' : String(Math.round(m.speed)).padStart(3)} m/s`;
      console.log(`${r.h.toFixed(2)} m  ${r.nominal.padEnd(12)}  ${f(r.extended)}   ${f(r.timed)}`);
    }
    console.log(`mean hit rate: unrolled-trigger ${pct(tot.e / rows.length)}, fixed-clock ${pct(tot.t / rows.length)}`);
  }
} else {
  const { evaluate } = require('./strike.js');
  const { aimFor } = require('../sim.js');
  const { h, n } = workerData;
  const aim = aimFor(h);
  const med = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  const summary = (trigger) => {
    const rs = [];
    for (let i = 0; i < n; i++) rs.push(evaluate(aim, h, { seed: 101 + i, trigger }));
    const hits = rs.filter((r) => r.hit);
    return { rate: hits.length / n, miss: med(rs.filter((r) => !r.hit).map((r) => r.miss)), speed: med(hits.map((r) => r.speed)) };
  };
  const nom = evaluate(aim, h);
  parentPort.postMessage({
    h,
    nominal: nom.hit ? `hit ${Math.round(nom.speed)} m/s` : `miss ${Math.round(nom.miss * 100)} cm`,
    extended: summary('extended'),
    timed: summary('timed'),
  });
}
