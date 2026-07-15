// Node harness for pc-features.test.html — loads pc-features.js into a sandbox,
// concatenates the inline <script> blocks (which populate the `tests` array),
// then runs each test fn and reports pass/fail. Mirrors run-engine.mjs.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const lib  = fs.readFileSync(path.join(root, 'pc-features.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'tests/pc-features.test.html'), 'utf8');

const blocks = [];
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html)) !== null) blocks.push(m[1]);

const sandbox = {
  console, setTimeout, clearTimeout, JSON, Math, Array, Object, Number, String, Map, Set,
  document: {
    getElementById() { return { innerHTML: '', appendChild() {} }; },
    createElement() { return { className: '', innerHTML: '', textContent: '', style: {}, classList: { add() {} }, appendChild() {} }; },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// pc-features.js: no `module` defined → assigns global.PCFeatures on `window`.
vm.runInContext(lib, sandbox, { filename: 'pc-features.js' });

const combined = blocks.join('\n;\n') + '\n;\nglobalThis.__TESTS = tests;';
vm.runInContext(combined, sandbox, { filename: 'pc-features.test.combined.js' });

const tests = sandbox.__TESTS || [];
let pass = 0, fail = 0, curGroup = '';
const failures = [];
for (const t of tests) {
  if (t.group) { curGroup = t.group; continue; }
  try {
    t.fn();
    pass++;
  } catch (e) {
    fail++;
    failures.push({ group: curGroup, name: t.name, msg: (e.message || String(e)).split('\n').slice(0, 2).join(' | ') });
  }
}
const total = tests.filter(t => !t.group).length;
console.log(`${pass} passed, ${fail} failed, ${total} total.`);
if (failures.length) {
  console.log('\nFailing tests:');
  for (const f of failures) console.log(`  ✗ [${f.group}] ${f.name} — ${f.msg}`);
}
