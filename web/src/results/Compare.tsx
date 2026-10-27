import { useState } from 'react';
import type { Result, ServerResult, WorkloadName, WorkloadResult } from '../api/types';
import { BarChart, type Bar } from '../charts/BarChart';
import { MultiLine } from '../run/MultiLine';
import { bytes, count, ms, percent, rate, workloadLabel, WORKLOAD_NAMES } from '../ui/format';
import { badge, NEUTRAL, seriesColors } from '../ui/series';
import css from './Results.module.css';
import runCss from '../run/Run.module.css';

const find = (s: ServerResult, w: WorkloadName) => s.workloads?.find((x) => x.workload.name === w);

/** Everything one run measured, workload by workload. */
export function Compare({ result }: { result: Result }) {
  const workloads = result.config.workloads;
  const [picked, setPicked] = useState<WorkloadName>(workloads[0]!.name);
  const ids = result.servers.map((s) => s.server.id);
  const colors = seriesColors(ids);
  const color = (id: string) => colors.get(id) ?? 'var(--series-1)';

  const bars = (value: (w: WorkloadResult) => number): Bar[] =>
    result.servers.map((s) => {
      const w = find(s, picked);
      const failed = w?.error ?? s.error;
      return {
        id: s.server.id,
        label: s.server.id,
        badge: badge(s.server.language),
        color: color(s.server.id),
        value: w ? value(w) : 0,
        note: !w || w.error ? `not measured${failed ? `: ${failed}` : ''}` : undefined,
      };
    });

  const serverBars = (value: (s: ServerResult) => number): Bar[] =>
    result.servers.map((s) => ({
      id: s.server.id,
      label: s.server.id,
      badge: badge(s.server.language),
      color: color(s.server.id),
      value: value(s),
      note: s.error && !s.startupMs ? s.error : undefined,
    }));

  const failures = result.servers.some((s) => {
    const w = find(s, picked);
    return w && w.summary.errors + w.summary.non2xx > 0;
  });
  const wl = workloads.find((w) => w.name === picked)!;
  const series = (y: (p: NonNullable<WorkloadResult['slices']>[number]) => number) =>
    result.servers.map((s) => ({
      id: s.server.id,
      label: s.server.id,
      badge: badge(s.server.language),
      color: NEUTRAL,
      points: (find(s, picked)?.slices ?? []).map((p) => ({ x: p.i, y: y(p) })),
    }));
  const warmup = result.config.warmupSlices;
  const band = warmup > 0 ? { from: 0, to: warmup - 0.5, label: 'warm-up' } : undefined;

  return (
    <>
      <div className={runCss.tabs} role="group" aria-label="Workload">
        {workloads.map((w) => (
          <button
            key={w.name}
            type="button"
            aria-pressed={w.name === picked}
            onClick={() => setPicked(w.name)}
          >
            {WORKLOAD_NAMES[w.name]}
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {workloadLabel(wl)}, {wl.connections} connections. Figures cover the{' '}
        {result.config.measureSlices} measured seconds; the warm-up is left out.
      </p>
      {result.plan.mode !== 'sequential' && (
        <p className={css.warning} style={{ margin: 0 }}>
          Servers in the same batch ran at the same time on separate cores. They still shared{' '}
          {picked === 'db' || picked === 'queries'
            ? 'memory bandwidth, caches and Postgres'
            : 'memory bandwidth and caches'}
          . For the strictest comparison, run with “At most at once” set to 1.
        </p>
      )}
      <div className={css.grid}>
        <div className="panel">
          <BarChart
            title="Throughput"
            better="higher"
            format={(v) => `${rate(v)} req/s`}
            bars={bars((w) => w.summary.rps)}
          />
        </div>
        <div className="panel">
          <BarChart
            title="p99 latency"
            better="lower"
            format={ms}
            bars={bars((w) => w.summary.latency.p99)}
          />
        </div>
        <div className="panel">
          <BarChart
            title="Median latency (p50)"
            better="lower"
            format={ms}
            bars={bars((w) => w.summary.latency.p50)}
          />
        </div>
        <div className="panel">
          <BarChart
            title="CPU efficiency"
            better="higher"
            format={(v) => `${rate(v)} req/s per core`}
            bars={bars((w) => w.rpsPerCore)}
          />
        </div>
        <div className="panel">
          <BarChart
            title="Peak memory under load"
            better="lower"
            format={bytes}
            bars={bars((w) => w.memory.peak)}
          />
        </div>
        {failures && (
          <div className="panel">
            <BarChart
              title="Failed requests"
              better="lower"
              format={count}
              bars={bars((w) => w.summary.errors + w.summary.non2xx)}
            />
          </div>
        )}
      </div>

      <div className={css.grid}>
        <div className="panel">
          <MultiLine
            title="Throughput, second by second"
            colors={colors}
            series={series((p) => p.rps)}
            yFormat={rate}
            xLabel="Second of load"
            band={band}
          />
        </div>
        <div className="panel">
          <MultiLine
            title="p99 latency, second by second"
            colors={colors}
            series={series((p) => p.p99)}
            yFormat={ms}
            xLabel="Second of load"
            band={band}
          />
        </div>
      </div>

      <div className="panel table-scroll" role="region" aria-label="All figures" tabIndex={0}>
        <h2 style={{ marginBottom: 8 }}>{WORKLOAD_NAMES[picked]}: all figures</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Server</th>
              <th>Requests/s</th>
              <th>p50</th>
              <th>p90</th>
              <th>p99</th>
              <th>p99.9</th>
              <th>Max</th>
              <th>CPU mean</th>
              <th>Req/s per core</th>
              <th>Memory peak</th>
              <th>OK</th>
              <th>Failed</th>
              <th>Batch</th>
            </tr>
          </thead>
          <tbody>
            {result.servers.map((s) => {
              const w = find(s, picked);
              if (!w || w.error) {
                return (
                  <tr key={s.server.id}>
                    <td>{s.server.id}</td>
                    <td colSpan={12} style={{ textAlign: 'left' }}>
                      not measured{(w?.error ?? s.error) ? `: ${w?.error ?? s.error}` : ''}
                    </td>
                  </tr>
                );
              }
              const l = w.summary.latency;
              return (
                <tr key={s.server.id}>
                  <td>{s.server.id}</td>
                  <td>{rate(w.summary.rps)}</td>
                  <td>{ms(l.p50)}</td>
                  <td>{ms(l.p90)}</td>
                  <td>{ms(l.p99)}</td>
                  <td>{ms(l.p999)}</td>
                  <td>{ms(l.max)}</td>
                  <td>{percent(w.cpu.mean)}</td>
                  <td>{rate(w.rpsPerCore)}</td>
                  <td>{bytes(w.memory.peak)}</td>
                  <td>{count(w.summary.ok)}</td>
                  <td>{count(w.summary.errors + w.summary.non2xx)}</td>
                  <td>
                    {s.batch + 1} ({s.batchSize} at once)
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>The servers</h2>
      <div className={css.grid}>
        <div className="panel">
          <BarChart
            title="Start-up time"
            better="lower"
            format={ms}
            bars={serverBars((s) => s.startupMs)}
          />
        </div>
        <div className="panel">
          <BarChart
            title="Memory at idle"
            better="lower"
            format={bytes}
            bars={serverBars((s) => s.idleMemoryBytes)}
          />
        </div>
        <div className="panel">
          <BarChart
            title="Image size"
            better="lower"
            format={bytes}
            bars={serverBars((s) => s.image.sizeBytes)}
          />
        </div>
      </div>
      <div className="panel table-scroll" role="region" aria-label="Server details" tabIndex={0}>
        <table className="data">
          <thead>
            <tr>
              <th>Server</th>
              <th style={{ textAlign: 'left' }}>Versions</th>
              <th style={{ textAlign: 'left' }}>Runtime</th>
              <th style={{ textAlign: 'left' }}>Concurrency</th>
              <th style={{ textAlign: 'left' }}>Tuning</th>
              <th>Cores</th>
              <th style={{ textAlign: 'left' }}>Image</th>
            </tr>
          </thead>
          <tbody>
            {result.servers.map((s) => (
              <tr key={s.server.id}>
                <td>{s.server.id}</td>
                <td style={{ textAlign: 'left' }}>
                  {s.server.language} {s.server.languageVersion}, {s.server.framework}{' '}
                  {s.server.frameworkVersion}
                </td>
                <td style={{ textAlign: 'left' }}>{s.server.runtime}</td>
                <td style={{ textAlign: 'left', whiteSpace: 'normal', minWidth: 200 }}>
                  {s.server.concurrency}
                </td>
                <td style={{ textAlign: 'left', whiteSpace: 'normal', minWidth: 200 }}>
                  {s.server.tuning}
                </td>
                <td>{s.cpuset}</td>
                <td style={{ textAlign: 'left' }} title={s.image.id}>
                  {s.image.id.replace('sha256:', '').slice(0, 12)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
