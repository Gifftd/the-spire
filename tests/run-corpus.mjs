// Node corpus harness — runs crucible-parser.js over the full local
// bestiary.json (gitignored, third-party) and reports parse coverage
// per bucket, plus a categorized dump of what fails.
//
//   node tests/run-corpus.mjs            → summary + failure categories
//   node tests/run-corpus.mjs --dump     → also list every unparsed action body
//   node tests/run-corpus.mjs --multi    → only multiattack diagnostics
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const parserSrc = fs.readFileSync(path.join(root, 'crucible-parser.js'), 'utf8');
const bestiary = JSON.parse(fs.readFileSync(path.join(root, 'bestiary.json'), 'utf8'));
const monsters = Array.isArray(bestiary) ? bestiary : bestiary.monsters;

const sandbox = { console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(parserSrc, sandbox, { filename: 'crucible-parser.js' });
const Parser = sandbox.CrucibleParser;
if (!Parser) { console.error('CrucibleParser did not load'); process.exit(1); }

const args = process.argv.slice(2);
const DUMP = args.includes('--dump');
const MULTI = args.includes('--multi');

// ── run the real entry point over every monster ──
const perBucket = {};   // bucket -> {total, parsed, byKind:{}, failures:[]}
const failures = [];    // {monster, bucket, name, body}
const multiFail = [];   // multiattack-specific: parsed as unparsed OR degraded

for (const m of monsters) {
  const clone = JSON.parse(JSON.stringify(m));
  try { Parser.parseAllMonsterActions(clone); }
  catch (e) {
    console.error(`THROW on ${m.name} (${m.source}): ${e.message}`);
    continue;
  }
  for (const pa of clone.parsedActions || []) {
    const b = pa.sourceBucket || 'action';
    perBucket[b] = perBucket[b] || { total: 0, parsed: 0, byKind: {} };
    perBucket[b].total++;
    perBucket[b].byKind[pa.kind] = (perBucket[b].byKind[pa.kind] || 0) + 1;
    if (pa.kind !== 'unparsed') perBucket[b].parsed++;
    else {
      failures.push({ monster: m.name, source: m.source, bucket: b, name: pa.name, body: pa.sourceText || pa.text || '' });
    }
    if (/multiattack/i.test(pa.name || '') && pa.kind !== 'multiattack') {
      multiFail.push({ monster: m.name, source: m.source, kind: pa.kind, name: pa.name, body: pa.sourceText || pa.text || '' });
    }
  }
}

let total = 0, parsed = 0;
console.log('── coverage by bucket ──');
for (const [b, s] of Object.entries(perBucket)) {
  total += s.total; parsed += s.parsed;
  console.log(`${b.padEnd(10)} ${s.parsed}/${s.total} (${(100 * s.parsed / s.total).toFixed(1)}%)  kinds: ${JSON.stringify(s.byKind)}`);
}
console.log(`${'TOTAL'.padEnd(10)} ${parsed}/${total} (${(100 * parsed / total).toFixed(1)}%)`);

// ── categorize failures by first-token signature so patterns pop out ──
function signature(body) {
  const t = String(body || '').replace(/\s+/g, ' ').trim();
  if (!t) return '(empty body)';
  if (/^melee or ranged/i.test(t)) return 'melee-or-ranged header';
  if (/saving throw/i.test(t)) return 'contains saving throw (missed)';
  if (/^the \w+ (makes|attacks|uses)/i.test(t)) return 'narrative "the X makes/uses..."';
  if (/\bregains?\b.*hit points/i.test(t)) return 'healing/regain';
  if (/recharge/i.test(t)) return 'recharge text';
  if (/teleports?|flies|moves/i.test(t)) return 'movement/teleport utility';
  return 'other';
}
const cats = {};
for (const f of failures) {
  const s = signature(f.body);
  (cats[s] = cats[s] || []).push(f);
}
console.log('\n── unparsed failure categories ──');
for (const [sig, list] of Object.entries(cats).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(list.length).padStart(4)}  ${sig}`);
  for (const ex of list.slice(0, DUMP ? list.length : 3)) {
    console.log(`      · [${ex.monster}] ${ex.name}: ${String(ex.body).replace(/\s+/g, ' ').slice(0, 220)}`);
  }
}

if (MULTI || multiFail.length) {
  console.log(`\n── multiattack-named actions NOT parsed as multiattack: ${multiFail.length} ──`);
  for (const f of multiFail.slice(0, MULTI ? multiFail.length : 15)) {
    console.log(`  [${f.monster}] kind=${f.kind}: ${String(f.body).replace(/\s+/g, ' ').slice(0, 240)}`);
  }
}
