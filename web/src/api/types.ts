// Mirrors the orchestrator's JSON (orchestrator/internal/runner/result.go and friends).

export type WorkloadName = 'plaintext' | 'json' | 'cpu' | 'io' | 'db' | 'queries';
export type Mode = 'simultaneous' | 'batched' | 'sequential';

export interface ServerDef {
  id: string;
  language: string;
  languageVersion: string;
  framework: string;
  frameworkVersion: string;
  runtime: string;
  concurrency: string;
  tuning: string;
}

export interface Preset {
  id: string;
  cpus: number;
  memoryMB: number;
}

export interface Workload {
  name: WorkloadName;
  param: number;
  connections: number;
}

export interface RunConfig {
  servers: string[];
  workloads: Workload[];
  preset: string;
  budgetPercent: number;
  maxParallel: number;
  warmupSlices: number;
  measureSlices: number;
  loadgenCpus: number;
  dbPool: number;
}

export interface HostInfo {
  cpus: number;
  memoryMB: number;
  cpuModel?: string;
  dockerVersion: string;
  os: string;
  kernel: string;
  arch?: string;
}

export interface Slot {
  server: string;
  serverCpus: number[];
  loadgenCpus: number[];
}

export interface Plan {
  mode: Mode;
  parallel: number;
  budgetCpus: number;
  budgetMemoryMB: number;
  dbCpus: number[] | null;
  batches: { slots: Slot[] }[];
}

export interface Latency {
  min: number;
  mean: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
  p9999: number;
  max: number;
}

export interface Summary {
  ok: number;
  non2xx: number;
  errors: number;
  seconds: number;
  rps: number;
  latency: Latency;
}

export interface SlicePoint {
  i: number;
  warmup: boolean;
  rps: number;
  p50: number;
  p99: number;
  max: number;
  failed: number;
  cpu: number;
  mem: number;
}

export interface WorkloadResult {
  workload: Workload;
  summary: Summary;
  cpu: { mean: number; max: number };
  memory: { mean: number; peak: number };
  rpsPerCore: number;
  slices: SlicePoint[] | null;
  error?: string;
}

export interface ServerResult {
  server: ServerDef;
  image: { id: string; digest?: string; sizeBytes: number };
  mode: Mode;
  batch: number;
  batchSize: number;
  cpuset: string;
  loadgenCpuset: string;
  startupMs: number;
  idleMemoryBytes: number;
  peakMemoryBytes: number;
  workloads: WorkloadResult[] | null;
  error?: string;
}

export interface Result {
  schema: number;
  id: string;
  startedAt: string;
  finishedAt: string;
  commit?: string;
  host: HostInfo;
  config: RunConfig;
  plan: Plan;
  servers: ServerResult[];
}

export interface RunSummary {
  id: string;
  startedAt: string;
  finishedAt: string;
  servers: string[];
  workloads: string[];
  preset: string;
  mode: Mode;
  cpuModel?: string;
  hostCpus: number;
}

export interface Sample {
  t: string;
  cpu: number;
  mem: number;
}

export type RunEvent =
  | { type: 'plan'; t: string; plan: Plan; host: HostInfo; config: RunConfig }
  | { type: 'status'; t: string; message: string }
  | { type: 'ready'; t: string; server: string; startupMs: number }
  | { type: 'stats'; t: string; server: string; stats: Sample }
  | { type: 'slice'; t: string; server: string; workload: WorkloadName; slice: SlicePoint }
  | {
      type: 'workload';
      t: string;
      server: string;
      workload: WorkloadName;
      workloadResult: WorkloadResult;
    }
  | { type: 'log'; t: string; server?: string; message: string }
  | { type: 'error'; t: string; server?: string; message: string }
  | { type: 'done'; t: string; result: Result };

export interface AppConfig {
  servers: ServerDef[];
  presets: Preset[];
  defaults: RunConfig;
  workloads: Workload[];
  host: HostInfo;
}

export interface ImageStatus {
  target: string;
  image: string;
  built: boolean;
  sizeBytes?: number;
  created?: string;
}
