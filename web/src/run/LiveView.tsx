import { useState } from 'react';
import type { ServerDef, WorkloadName } from '../api/types';
import { href } from '../app/routes';
import { bytes, modeLabel, ms, percent, rate, WORKLOAD_NAMES } from '../ui/format';
import { badge, seriesColors } from '../ui/series';
import type { LiveState } from './liveState';
import { MultiLine } from './MultiLine';
import css from './Run.module.css';

interface Props {
  live: LiveState;
  servers: ServerDef[];
}

export function LiveView({ live, servers }: Props) {
  const [picked, setPicked] = useState<WorkloadName | null>(null);
  const [metric, setMetric] = useState('Throughput');
  const workload = picked ?? live.workload;
  const colors = seriesColors(live.order);
  const def = (id: string) => servers.find((s) => s.id === id);
  const label = (id: string) => ({ label: id, badge: badge(def(id)?.language ?? id) });

  if (!live.plan) {
    return (
      <div className={`panel ${css.empty}`}>
        <h2>Live run</h2>
        <p style={{ margin: 0 }}>
          Choose servers and workloads, then start a run. Throughput, latency, CPU and memory appear
          here as they are measured, one point per second.
        </p>
        {live.error && <p className="error">{live.error}</p>}
      </div>
    );
  }

  const slices = (id: string) =>
    workload ? (live.servers[id]?.workloads[workload]?.slices ?? []) : [];
  const series = (pick: (id: string) => { x: number; y: number }[]) =>
    live.order.map((id) => ({ id, ...label(id), color: '', points: pick(id) }));
  const warmup = live.config?.warmupSlices ?? 0;
  const band = warmup > 0 ? { from: 0, to: warmup - 0.5, label: 'warm-up' } : undefined;
  const charts = [
    {
      title: 'Throughput',
      hint: 'requests per second',
      series: series((id) => slices(id).map((p) => ({ x: p.i, y: p.rps }))),
      yFormat: rate,
      xLabel: 'Second of load',
      band,
    },
    {
      title: 'p99 latency',
      hint: '99% of requests were faster',
      series: series((id) => slices(id).map((p) => ({ x: p.i, y: p.p99 }))),
      yFormat: ms,
      xLabel: 'Second of load',
      band,
    },
    {
      title: 'CPU',
      hint: '% of one core, whole run',
      series: series((id) => live.servers[id]!.stats.map((p) => ({ x: p.t, y: p.cpu }))),
      yFormat: percent,
      xLabel: 'Second of the run',
    },
    {
      title: 'Memory',
      hint: 'resident, whole run',
      series: series((id) => live.servers[id]!.stats.map((p) => ({ x: p.t, y: p.mem }))),
      yFormat: bytes,
      xLabel: 'Second of the run',
    },
  ];
  const elapsed = Math.max(
    0,
    ...live.order.flatMap((id) => live.servers[id]!.stats.map((s) => s.t)),
  );

  return (
    <section className={css.live} aria-label="Live run">
      <div className={css.liveHead}>
        <h2>{live.done ? 'Run finished' : 'Running'}</h2>
        <span className="tag">{modeLabel(live.plan.mode, live.plan.parallel)}</span>
        {live.plan.batches.length > 1 && live.batch >= 0 && (
          <span className="tag">
            Batch {live.batch + 1} of {live.plan.batches.length}
          </span>
        )}
        <span className="muted" aria-live="polite">
          {live.status} · {Math.round(elapsed)} s
        </span>
        {live.resultId && (
          <a
            className="button button-primary"
            style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
            href={href({ page: 'results', id: live.resultId })}
          >
            Compare results
          </a>
        )}
      </div>
      {live.error && <p className="error">{live.error}</p>}

      <div className={css.cards}>
        {live.order.map((id) => {
          const s = live.servers[id]!;
          return (
            <div
              key={id}
              className={css.card}
              style={{ borderLeftColor: colors.get(id) ?? 'var(--border)' }}
            >
              <div className={css.cardName}>
                <span className="tag mono">{badge(def(id)?.language ?? id)}</span>
                <span>{id}</span>
              </div>
              {s.status === 'failed' ? (
                <span className={css.stateFailed}>Failed: {s.error}</span>
              ) : (
                <span className={css.state}>
                  {s.status === 'ready'
                    ? `Ready in ${ms(s.startupMs ?? 0)}`
                    : s.status === 'starting'
                      ? 'Starting…'
                      : 'Waiting for its batch'}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {live.workloadsSeen.length > 0 && (
        <div className={css.tabs} role="group" aria-label="Workload">
          {live.workloadsSeen.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={w === workload}
              onClick={() => setPicked(w === live.workload ? null : w)}
            >
              {WORKLOAD_NAMES[w]}
              {w === live.workload && !live.done ? ' (now)' : ''}
            </button>
          ))}
        </div>
      )}

      {colors.size === 0 && (
        <div className={css.tabs} role="group" aria-label="Metric">
          {charts.map((c) => (
            <button
              key={c.title}
              type="button"
              aria-pressed={c.title === metric}
              onClick={() => setMetric(c.title)}
            >
              {c.title}
            </button>
          ))}
        </div>
      )}
      <div className={css.charts}>
        {charts
          // Past eight servers each chart is a grid of small ones, so show one metric at a time.
          .filter((c) => colors.size > 0 || c.title === metric)
          .map((c) => (
            <MultiLine key={c.title} colors={colors} {...c} />
          ))}
      </div>

      {workload && (
        <div className="panel table-scroll" role="region" aria-label="Latest figures" tabIndex={0}>
          <h3 style={{ marginBottom: 8 }}>{WORKLOAD_NAMES[workload]}: latest</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Server</th>
                <th>Requests/s</th>
                <th>p50</th>
                <th>p99</th>
                <th>CPU</th>
                <th>Memory</th>
                <th>Failed</th>
              </tr>
            </thead>
            <tbody>
              {live.order.map((id) => {
                const w = live.servers[id]!.workloads[workload];
                const r = w?.result;
                const last = w?.slices.at(-1);
                return (
                  <tr key={id}>
                    <td>{id}</td>
                    <td>{r ? rate(r.summary.rps) : last ? rate(last.rps) : '–'}</td>
                    <td>{r ? ms(r.summary.latency.p50) : last ? ms(last.p50) : '–'}</td>
                    <td>{r ? ms(r.summary.latency.p99) : last ? ms(last.p99) : '–'}</td>
                    <td>{r ? percent(r.cpu.mean) : last ? percent(last.cpu) : '–'}</td>
                    <td>{r ? bytes(r.memory.peak) : last ? bytes(last.mem) : '–'}</td>
                    <td>{r ? r.summary.errors + r.summary.non2xx : last ? last.failed : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            While a workload runs, figures are for the last second. Once it ends they cover the
            whole measured period (warm-up excluded).
          </p>
        </div>
      )}
    </section>
  );
}
