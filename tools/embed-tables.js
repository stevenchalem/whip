// Embed the two-joint aim tables from results/two-joint into sim.js so the page
// can use them without loading files.  Usage: node tools/embed-tables.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'results', 'two-joint');
const tables = {
  elbow: JSON.parse(fs.readFileSync(path.join(dir, 'elbow-locked-table.json'), 'utf8')),
  wrist: JSON.parse(fs.readFileSync(path.join(dir, 'wrist-locked-table.json'), 'utf8')),
};
const file = path.join(__dirname, '..', 'sim.js');
const src = fs.readFileSync(file, 'utf8');
const out = src.replace(
  /(\/\/ >>> TWO_JOINT_TABLES[^\n]*\n)[\s\S]*?(\n\s*\/\/ <<< TWO_JOINT_TABLES)/,
  (_, a, b) => `${a}  const TWO_JOINT_TABLES = ${JSON.stringify(tables)};${b}`);
if (out === src) throw new Error('TWO_JOINT_TABLES block not found');
fs.writeFileSync(file, out);
console.log('embedded two-joint tables into sim.js');
