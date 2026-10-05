const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/workspace.json'), 'utf8'));
assert.equal(data.economics.menu.length, 5, 'start menu must contain 5 drinks');
for (const key of ['suppliers','equipment','launch']) assert.ok(Array.isArray(data[key]) && data[key].length, `${key} must not be empty`);
const ids = new Set();
for (const group of [data.suppliers, data.equipment, data.launch]) for (const item of group) { assert.ok(item.id); assert.ok(!ids.has(item.id), `duplicate id: ${item.id}`); ids.add(item.id); }
for (const supplier of data.suppliers) assert.match(supplier.url, /^https:\/\//, `supplier URL must be https: ${supplier.name}`);
console.log(`workspace ok: ${data.suppliers.length} suppliers, ${data.equipment.length} equipment items, ${data.launch.length} launch tasks, ${data.economics.menu.length} drinks`);