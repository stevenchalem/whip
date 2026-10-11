// Combine optimiser sweeps into the AIM_TABLE block in sim.js.
//   node tools/merge-aim.js [--split H] [--out table.json] sweepA.json sweepB.json ...
// --out writes the table to a JSON file instead of sim.js (and ignores the
// rows already in sim.js).
// Without --split, keeps the better-scoring row at each height. With --split,
// uses 'overhead' rows below H and 'flat' rows from H up: one clean switch
// between strike styles, so the heights in between still interpolate.
// Each file is the --out output of tools/aim.js. Rows already in sim.js take
// part too (re-scored if they carry no score).
const fs = require('fs');
const path = require('path');
const { CARD_X, SEEDS, score, evaluate } = require('./strike.js');
const { AIM_TABLE } = require('../sim.js');

const scoreRow = (row) => SEEDS.reduce((a, seed) => a + score(evaluate(row, row.h, seed == null ? {} : { seed })), 0) / SEEDS.length;

const args = process.argv.slice(2);
const si = args.indexOf('--split');
const split = si >= 0 ? parseFloat(args.splice(si, 2)[1]) : null;
const oi = args.indexOf('--out');
const out = oi >= 0 ? args.splice(oi, 2)[1] : null;
const candidates = new Map();
const offer = (row) => {
  if (split != null && row.family !== (row.h < split ? 'overhead' : 'flat')) return;
  const cur = candidates.get(row.h);
  if (!cur || row.cost < cur.cost) candidates.set(row.h, row);
};
const existing = out ? null : AIM_TABLE();
if (existing) {
  for (const row of existing.rows) offer({ family: 'overhead', ...row, cost: row.cost != null ? row.cost : scoreRow(row) });
}
for (const f of args) for (const row of JSON.parse(fs.readFileSync(f, 'utf8'))) offer(row);

const rows = [...candidates.values()].sort((a, b) => a.h - b.h);
for (const r of rows) console.log(`h=${r.h}: ${r.family}, score ${r.cost.toFixed(3)}`);

const round = (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
if (out) {
  fs.writeFileSync(out, JSON.stringify({ x: CARD_X, rows }, round));
  console.log(`wrote table to ${out}`);
  process.exit(0);
}
const file = path.join(__dirname, '..', 'sim.js');
const src = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, src.replace(
  /(\/\/ >>> AIM_TABLE[^\n]*\n)[\s\S]*?(\n\s*\/\/ <<< AIM_TABLE)/,
  (_, a, b) => `${a}  const AIM_TABLE = ${JSON.stringify({ x: CARD_X, rows }, round)};${b}`));
console.log('wrote AIM_TABLE to sim.js');
