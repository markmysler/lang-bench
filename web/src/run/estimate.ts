import type { Plan, RunConfig } from '../api/types';

/** Seconds a run takes: every batch runs every workload, plus start-up and pauses. */
export function estimateSeconds(cfg: RunConfig, plan: Plan | null): number {
  const batches = plan?.batches.length ?? cfg.servers.length;
  const perWorkload = cfg.warmupSlices + cfg.measureSlices + 2;
  return batches * (10 + cfg.workloads.length * perWorkload);
}
