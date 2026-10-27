import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from './static-data.mjs';

const run = (id, startedAt) => ({
  id,
  startedAt,
  finishedAt: startedAt,
  host: { cpus: 22, cpuModel: 'CPU' },
  config: { preset: '1cpu-512mb', workloads: [{ name: 'json' }] },
  plan: { mode: 'sequential' },
  servers: [{ server: { id: 'go-gin' } }],
});

test('copies runs and indexes them newest first', async () => {
  const from = await mkdtemp(join(tmpdir(), 'pub-'));
  const to = await mkdtemp(join(tmpdir(), 'out-'));
  await writeFile(join(from, 'a.json'), JSON.stringify(run('old', '2026-01-01T00:00:00Z')));
  await writeFile(join(from, 'b.json'), JSON.stringify(run('new', '2026-02-01T00:00:00Z')));
  await writeFile(join(from, 'README.md'), 'not a run');
  await build(from, to);
  const index = JSON.parse(await readFile(join(to, 'index.json'), 'utf8'));
  expect(index.map((r) => r.id)).toEqual(['new', 'old']);
  expect(index[0]).toMatchObject({ servers: ['go-gin'], workloads: ['json'], mode: 'sequential' });
  expect(JSON.parse(await readFile(join(to, 'old.json'), 'utf8')).id).toBe('old');
});

test('refuses ids that could escape the folder', async () => {
  const from = await mkdtemp(join(tmpdir(), 'pub-'));
  await writeFile(join(from, 'x.json'), JSON.stringify(run('../x', '2026-01-01T00:00:00Z')));
  await expect(build(from, await mkdtemp(join(tmpdir(), 'out-')))).rejects.toThrow('invalid');
});
