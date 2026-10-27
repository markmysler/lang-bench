import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

interface Recorded {
  id: string;
  startedAt: string;
  host: unknown;
  plan: { batches: unknown[] };
  config: { workloads: { name: string }[] } & Record<string, unknown>;
  servers: {
    server: { id: string };
    batch: number;
    startupMs: number;
    workloads:
      { workload: { name: string }; slices: { cpu: number; mem: number }[] | null }[] | null;
  }[];
}

/** A recorded run: six servers in two batches, every workload. */
export const run: Recorded = JSON.parse(
  readFileSync(new URL('./fixtures/run-batched.json', import.meta.url), 'utf8'),
);

const config = {
  servers: run.servers.map((s) => s.server),
  presets: [
    { id: '1cpu-512mb', cpus: 1, memoryMB: 512 },
    { id: '2cpu-1gb', cpus: 2, memoryMB: 1024 },
    { id: '4cpu-2gb', cpus: 4, memoryMB: 2048 },
  ],
  defaults: { ...run.config, servers: null, warmupSlices: 2, measureSlices: 5 },
  workloads: run.config.workloads,
  host: run.host,
};

/** The events a run sends, rebuilt from the recorded result. */
export function events(): object[] {
  const t = run.startedAt;
  const out: object[] = [{ type: 'plan', t, plan: run.plan, host: run.host, config: run.config }];
  run.plan.batches.forEach((_, i) => {
    out.push({ type: 'status', t, message: `Batch ${i + 1} of ${run.plan.batches.length}` });
    const servers = run.servers.filter((s) => s.batch === i);
    for (const s of servers) {
      out.push({ type: 'ready', t, server: s.server.id, startupMs: s.startupMs });
    }
    for (const w of run.config.workloads) {
      out.push({ type: 'status', t, message: `Load: ${w.name}` });
      for (const s of servers) {
        const wr = s.workloads?.find((x) => x.workload.name === w.name);
        if (!wr) continue;
        for (const slice of wr.slices ?? []) {
          out.push({ type: 'slice', t, server: s.server.id, workload: w.name, slice });
          out.push({
            type: 'stats',
            t,
            server: s.server.id,
            stats: { t, cpu: slice.cpu, mem: slice.mem },
          });
        }
        out.push({
          type: 'workload',
          t,
          server: s.server.id,
          workload: w.name,
          workloadResult: wr,
        });
      }
    }
  });
  const failed = run.servers.find((s) => s.server.id === 'java-spring-vt');
  if (failed) {
    out.push({ type: 'error', t, server: failed.server.id, message: 'killed: out of memory' });
  }
  out.push({ type: 'done', t, result: run });
  return out;
}

/** Answers the dashboard's API calls as the orchestrator would, with one run to start. */
export async function mockApi(page: Page) {
  let started = false;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    switch (`${route.request().method()} ${url.pathname}`) {
      case 'GET /api/config':
        return json(config);
      case 'GET /api/images':
        return json(
          ['postgres', 'loadgen', ...config.servers.map((s) => s.id)].map((target) => ({
            target,
            image: `langbench/${target}:latest`,
            built: true,
            sizeBytes: 100 << 20,
          })),
        );
      case 'POST /api/plan':
        return json(run.plan);
      case 'GET /api/runs/current':
        return json({ running: false, id: started ? run.id : '' });
      case 'POST /api/runs':
        started = true;
        return json({ started: true }, 202);
      case 'GET /api/runs/current/events':
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: events()
            .map((e) => `data: ${JSON.stringify(e)}\n\n`)
            .join(''),
        });
      case `GET /api/runs/${run.id}`:
        return json(run);
      default:
        return json({ error: 'not found' }, 404);
    }
  });
}

export const DASHBOARD = 'http://localhost:4174/';
export const VIEWER = 'http://localhost:4173/';
