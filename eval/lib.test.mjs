import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractJSON, fill, parseScenario, parseTeams, replyText, summarise } from './lib.mjs';

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
