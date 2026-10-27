import type {
  HostInfo,
  Plan,
  RunConfig,
  RunEvent,
  SlicePoint,
  WorkloadName,
  WorkloadResult,
} from '../api/types';

export type ServerStatus = 'waiting' | 'starting' | 'ready' | 'failed';

export interface StatPoint {
  /** Seconds since the run started. */
  t: number;
  cpu: number;
  mem: number;
}

export interface LiveServer {
  status: ServerStatus;
  startupMs?: number;
  error?: string;
  stats: StatPoint[];
  workloads: Partial<Record<WorkloadName, { slices: SlicePoint[]; result?: WorkloadResult }>>;
}

/** What the dashboard knows about the run in progress, built from its events. */
export interface LiveState {
  startedAt?: number;
  plan?: Plan;
  host?: HostInfo;
  config?: RunConfig;
  order: string[];
  servers: Record<string, LiveServer>;
  /** Index of the batch in progress. */
  batch: number;
  status: string;
  workload?: WorkloadName;
  workloadsSeen: WorkloadName[];
  log: string[];
  done: boolean;
  error?: string;
  resultId?: string;
}

export const initialLive: LiveState = {
  order: [],
  servers: {},
  batch: -1,
  status: '',
  workloadsSeen: [],
  log: [],
  done: false,
};

const MAX_STATS = 600;
const MAX_LOG = 200;

function update(s: LiveState, id: string, f: (srv: LiveServer) => LiveServer): LiveState {
  const srv = s.servers[id];
  if (!srv) return s;
  return { ...s, servers: { ...s.servers, [id]: f(srv) } };
}

export function liveReducer(s: LiveState, e: RunEvent): LiveState {
  const t = Date.parse(e.t);
  switch (e.type) {
    case 'plan': {
      const order = e.plan.batches.flatMap((b) => b.slots.map((slot) => slot.server));
      const servers: Record<string, LiveServer> = {};
      for (const id of order) servers[id] = { status: 'waiting', stats: [], workloads: {} };
      return {
        ...initialLive,
        startedAt: t,
        plan: e.plan,
        host: e.host,
        config: e.config,
        order,
        servers,
      };
    }
    case 'status': {
      const next = { ...s, status: e.message };
      const batch = /^Batch (\d+) of/.exec(e.message);
      if (batch && s.plan) {
        const b = Number(batch[1]) - 1;
        let out: LiveState = { ...next, batch: b };
        for (const slot of s.plan.batches[b]?.slots ?? []) {
          out = update(out, slot.server, (srv) => ({ ...srv, status: 'starting' }));
        }
        return out;
      }
      const load = /^Load: (\w+)/.exec(e.message);
      if (load) {
        const w = load[1] as WorkloadName;
        const seen = s.workloadsSeen.includes(w) ? s.workloadsSeen : [...s.workloadsSeen, w];
        return { ...next, workload: w, workloadsSeen: seen };
      }
      return next;
    }
    case 'ready':
      return update(s, e.server, (srv) => ({ ...srv, status: 'ready', startupMs: e.startupMs }));
    case 'stats': {
      const point = { t: (t - (s.startedAt ?? t)) / 1000, cpu: e.stats.cpu, mem: e.stats.mem };
      return update(s, e.server, (srv) => ({
        ...srv,
        stats: [...srv.stats.slice(-(MAX_STATS - 1)), point],
      }));
    }
    case 'slice':
      return update(s, e.server, (srv) => {
        const w = srv.workloads[e.workload] ?? { slices: [] };
        return {
          ...srv,
          workloads: { ...srv.workloads, [e.workload]: { ...w, slices: [...w.slices, e.slice] } },
        };
      });
    case 'workload':
      return update(s, e.server, (srv) => {
        const w = srv.workloads[e.workload] ?? { slices: [] };
        return {
          ...srv,
          workloads: { ...srv.workloads, [e.workload]: { ...w, result: e.workloadResult } },
        };
      });
    case 'log':
      return { ...s, log: [...s.log.slice(-(MAX_LOG - 1)), `${e.server ?? ''} ${e.message}`] };
    case 'error':
      if (e.server) {
        return update(s, e.server, (srv) => ({ ...srv, status: 'failed', error: e.message }));
      }
      return { ...s, done: true, error: e.message };
    case 'done':
      return { ...s, done: true, resultId: e.result.id, status: 'Finished' };
  }
}
