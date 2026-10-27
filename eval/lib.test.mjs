import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkTotals,
  describeAct,
  extractJSON,
  fill,
  measurementsTable,
  parseScenario,
  parseTeams,
  replyText,
  summarise,
  toWsl,
} from './lib.mjs';

const TEAMS = `# Teams

Intro text.

## alpha

**Who:** one person.
**Stack:** none.

## beta

**Who:** two people.
`;

test('teams are split by their second-level headings', () => {
  const teams = parseTeams(TEAMS);
  assert.deepEqual([...teams.keys()], ['alpha', 'beta']);
  assert.equal(teams.get('alpha'), '**Who:** one person.\n**Stack:** none.');
});

test('a scenario gives its team, situation and request', () => {
  const s = parseScenario(
    '01-x',
    `# 01-x\n\n**Team:** alpha\n\n## Situation\n\nIt is busy.\nVery busy.\n\n## The request\n\n> Help us?\n`,
  );
  assert.deepEqual(s, { id: '01-x', team: 'alpha', situation: 'It is busy.\nVery busy.', request: 'Help us?' });
});

test('placeholders are filled, and an unknown one is an error', () => {
  assert.equal(fill('A {{x}} B {{y}}', { x: '1', y: '2' }), 'A 1 B 2');
  assert.throws(() => fill('A {{z}}', { x: '1' }), /z/);
});

test('JSON is pulled out of a reply with prose or a code fence around it', () => {
  assert.deepEqual(extractJSON('Here you go:\n```json\n{"a": {"b": 1}}\n```\nDone.'), { a: { b: 1 } });
  assert.deepEqual(extractJSON('{"a": "has } brace"}'), { a: 'has } brace' });
  assert.throws(() => extractJSON('no json here'));
});

test('the reply text comes from the CLI JSON, or is the raw output', () => {
  assert.equal(replyText('{"type":"result","result":"hello"}'), 'hello');
  assert.equal(replyText('plain text'), 'plain text');
});

test('a Windows path becomes its WSL path', () => {
  assert.equal(toWsl('C:\\code\\lang-bench\\eval\\agent.sh'), '/mnt/c/code/lang-bench/eval/agent.sh');
  assert.equal(toWsl('/home/x/eval'), '/home/x/eval');
});

const result = {
  host: { cpuModel: 'CPU X', cpus: 22 },
  config: { preset: '1cpu-512mb', warmupSlices: 5, measureSlices: 15 },
  servers: [
    {
      server: { id: 'go-gin', language: 'Go', framework: 'Gin' },
      startupMs: 550,
      idleMemoryBytes: 5 << 20,
      image: { sizeBytes: 90 << 20 },
      workloads: [
        { workload: { name: 'json', param: 0, connections: 64 }, summary: { rps: 33000, latency: { p50: 1.5, p99: 4.25 } }, cpu: { mean: 98 }, memory: { peak: 9 << 20 } },
        { workload: { name: 'io', param: 10, connections: 256 }, summary: { rps: 1 }, error: 'no results', cpu: { mean: 0 }, memory: { peak: 0 } },
      ],
    },
    { server: { id: 'dead', language: 'X', framework: 'Y' }, error: 'killed: out of memory', workloads: null },
  ],
};

test('measurements become one table per workload, skipping failures', () => {
  const md = measurementsTable(result);
  assert.match(md, /CPU X/);
  assert.match(md, /1 CPU, 512 MB/);
  assert.match(md, /\| go-gin \| Go \| Gin \| 33,000 \| 1.50 \| 4.25 \| 98% \| 9 MB \|/);
  assert.doesNotMatch(md, /\| go-gin[^\n]*\| 1 \|/); // the failed io workload
  assert.match(md, /\| go-gin \| 550 ms \| 5 MB \| 90 MB \|/);
  assert.match(md, /dead: killed: out of memory/);
});

test('an act bundle is described with its message and the files it changed', () => {
  const text = describeAct({
    claude: { result: 'I built it in Rust.' },
    changed: ['A  Cargo.toml', 'A  src/main.rs'],
    files: { 'Cargo.toml': '[package]\nname = "api"', 'src/main.rs': 'fn main() {}' },
  });
  assert.match(text, /I built it in Rust\./);
  assert.match(text, /A {2}Cargo\.toml/);
  assert.match(text, /### Cargo\.toml\n```\n\[package\]/);
});

test('claim checks are totalled', () => {
  const totals = checkTotals([
    { claims: [{ verdict: 'consistent' }, { verdict: 'off' }] },
    { claims: [{ verdict: 'not_covered' }, { verdict: 'consistent' }] },
  ]);
  assert.deepEqual(totals, { claims: 4, consistent: 2, off: 1, not_covered: 1 });
});

test('summary counts choices, rewrites and averages scores', () => {
  const s = summarise([
    { id: 'a', grade: { choice: 'acceptable', needless_rewrite: false, constraints_cited: 2, team_fit: 2, unknowns_stated: 1, overall: 4, ruled_out_recommended: [] } },
    { id: 'b', grade: { choice: 'ruled_out', needless_rewrite: true, constraints_cited: 0, team_fit: 1, unknowns_stated: 0, overall: 2, ruled_out_recommended: ['x'] } },
  ]);
  assert.equal(s.scenarios, 2);
  assert.deepEqual(s.choice, { acceptable: 1, ruled_out: 1, unclear: 0 });
  assert.equal(s.needlessRewrites, 1);
  assert.equal(s.ruledOutRecommended, 1);
  assert.equal(s.mean.overall, 3);
  assert.equal(s.mean.constraints_cited, 1);
});
