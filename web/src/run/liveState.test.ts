import type { Plan, RunConfig, RunEvent, SlicePoint, WorkloadResult } from '../api/types';
import { initialLive, liveReducer, type LiveState } from './liveState';

const T0 = Date.parse('2026-10-27T10:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

const plan: Plan = {
  mode: 'batched',
  parallel: 2,
  budgetCpus: 16,
  budgetMemoryMB: 8000,
  dbCpus: null,
  batches: [
    {
      slots: [
        { server: 'go-gin', serverCpus: [1], loadgenCpus: [2, 3] },
        { server: 'rust-axum', serverCpus: [4], loadgenCpus: [5, 6] },
      ],
    },
    { slots: [{ server: 'python-fastapi', serverCpus: [1], loadgenCpus: [2, 3] }] },
  ],
};

const slice = (i: number, rps: number, warmup = false): SlicePoint => ({
  i,
  warmup,
  rps,
  p50: 1,
  p99: 3,
  max: 5,
  failed: 0,
  cpu: 90,
  mem: 8 << 20,
});

function play(...events: RunEvent[]): LiveState {
  return events.reduce(liveReducer, initialLive);
}

const config = { warmupSlices: 2 } as RunConfig;
const host = {
  cpus: 22,
  memoryMB: 11958,
  dockerVersion: '29.8.0',
  os: 'Docker Desktop',
  kernel: '',
};

test('the plan lists servers in run order, waiting', () => {
  const s = play({ type: 'plan', t: at(0), plan, host, config });
  expect(s.order).toEqual(['go-gin', 'rust-axum', 'python-fastapi']);
  expect(s.servers['python-fastapi']?.status).toBe('waiting');
  expect(s.plan?.mode).toBe('batched');
});

test('a batch starting marks its servers as starting', () => {
  const s = play(
    { type: 'plan', t: at(0), plan, host, config },
    { type: 'status', t: at(1), message: 'Batch 2 of 2' },
  );
  expect(s.batch).toBe(1);
  expect(s.servers['python-fastapi']?.status).toBe('starting');
  expect(s.servers['go-gin']?.status).toBe('waiting');
});

test('ready, stats and slices accumulate per server and workload', () => {
  const s = play(
    { type: 'plan', t: at(0), plan, host, config },
    { type: 'status', t: at(1), message: 'Batch 1 of 2' },
    { type: 'ready', t: at(2), server: 'go-gin', startupMs: 342 },
    { type: 'stats', t: at(3), server: 'go-gin', stats: { t: at(3), cpu: 50, mem: 7 << 20 } },
    { type: 'status', t: at(4), message: 'Load: cpu' },
    { type: 'slice', t: at(5), server: 'go-gin', workload: 'cpu', slice: slice(0, 100, true) },
    { type: 'slice', t: at(6), server: 'go-gin', workload: 'cpu', slice: slice(1, 200) },
  );
  const g = s.servers['go-gin']!;
  expect(g.status).toBe('ready');
  expect(g.startupMs).toBe(342);
  expect(g.stats).toEqual([{ t: 3, cpu: 50, mem: 7 << 20 }]);
  expect(g.workloads.cpu?.slices.map((p) => p.rps)).toEqual([100, 200]);
  expect(s.workload).toBe('cpu');
  expect(s.workloadsSeen).toEqual(['cpu']);
});

test('workload results, errors and the end of the run', () => {
  const wr = { summary: { rps: 199 } } as WorkloadResult;
  const s = play(
    { type: 'plan', t: at(0), plan, host, config },
    { type: 'workload', t: at(9), server: 'go-gin', workload: 'cpu', workloadResult: wr },
    { type: 'error', t: at(9), server: 'rust-axum', message: 'killed: out of memory' },
    { type: 'done', t: at(10), result: { id: 'r1' } as never },
  );
  expect(s.servers['go-gin']?.workloads.cpu?.result?.summary.rps).toBe(199);
  expect(s.servers['rust-axum']?.status).toBe('failed');
  expect(s.servers['rust-axum']?.error).toBe('killed: out of memory');
  expect(s.done).toBe(true);
  expect(s.resultId).toBe('r1');
});

test('a run-level error ends the run with a message', () => {
  const s = play({ type: 'error', t: at(1), message: 'run cancelled' });
  expect(s.done).toBe(true);
  expect(s.error).toBe('run cancelled');
});

test('stats keep a bounded history', () => {
  let s = play({ type: 'plan', t: at(0), plan, host, config });
  for (let i = 0; i < 1000; i++) {
    s = liveReducer(s, {
      type: 'stats',
      t: at(i),
      server: 'go-gin',
      stats: { t: at(i), cpu: 1, mem: 1 },
    });
  }
  expect(s.servers['go-gin']!.stats.length).toBeLessThanOrEqual(600);
});
