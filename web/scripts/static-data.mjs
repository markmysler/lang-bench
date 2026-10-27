// Copies published runs into the static build, with an index of them, for the read-only viewer.
// Usage: node scripts/static-data.mjs <published dir> <output dir>
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The same summary the orchestrator's /api/runs lists (orchestrator/internal/store). */
export function summarise(r) {
  return {
    id: r.id,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    servers: r.servers.map((s) => s.server.id),
    workloads: r.config.workloads.map((w) => w.name),
    preset: r.config.preset,
    mode: r.plan.mode,
    cpuModel: r.host.cpuModel,
    hostCpus: r.host.cpus,
  };
}

export async function build(from, to) {
  await mkdir(to, { recursive: true });
  const index = [];
  for (const name of (await readdir(from)).filter((n) => n.endsWith('.json')).sort()) {
    const result = JSON.parse(await readFile(join(from, name), 'utf8'));
    if (!/^[A-Za-z0-9._-]+$/.test(result.id ?? '')) throw new Error(`${name}: invalid run id`);
    await writeFile(join(to, `${result.id}.json`), JSON.stringify(result));
    index.push(summarise(result));
  }
  index.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  await writeFile(join(to, 'index.json'), JSON.stringify(index));
  return index;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [from = '../published', to = 'dist/data'] = process.argv.slice(2);
  const index = await build(from, to);
  console.log(`static data: ${index.length} published run(s) in ${to}`);
}
