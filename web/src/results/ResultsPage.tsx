import { useEffect, useState } from 'react';
import { getRun, listRuns } from '../api/client';
import type { Result, RunSummary } from '../api/types';
import { href } from '../app/routes';
import { dateTime, modeLabel } from '../ui/format';
import { Compare } from './Compare';
import css from './Results.module.css';

export function ResultsPage({ id }: { id?: string }) {
  return id ? <RunResult key={id} id={id} /> : <RunList />;
}

function RunList() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listRuns().then(setRuns, (e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!runs) return <p className="muted">Loading…</p>;
  return (
    <div className={css.page}>
      <h1>Results</h1>
      {runs.length === 0 ? (
        <p className="muted">
          No runs yet. <a href={href({ page: 'run' })}>Start one</a>.
        </p>
      ) : (
        <div className={`panel table-scroll ${css.list}`}>
          <table className="data">
            <thead>
              <tr>
                <th>Run</th>
                <th>Servers</th>
                <th>Workloads</th>
                <th>Size</th>
                <th>Mode</th>
                <th>Host</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={href({ page: 'results', id: r.id })}>{dateTime(r.startedAt)}</a>
                  </td>
                  <td>{r.servers.length}</td>
                  <td>{r.workloads.length}</td>
                  <td>{r.preset}</td>
                  <td>{r.mode}</td>
                  <td>{r.hostCpus} CPUs</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Saves a result as a JSON file, the same format the orchestrator writes. */
function download(result: Result) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `lang-bench-${result.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function RunResult({ id }: { id: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getRun(id).then(setResult, (e: Error) => setError(e.message));
  }, [id]);
  if (error) return <p className="error">{error}</p>;
  if (!result) return <p className="muted">Loading…</p>;

  const preset = result.config.preset;
  return (
    <div className={css.page}>
      <div className={css.head}>
        <h1>{dateTime(result.startedAt)}</h1>
        <span className="tag">{modeLabel(result.plan.mode, result.plan.parallel)}</span>
        <span className="tag">{preset}</span>
        <button type="button" className="button button-small" onClick={() => download(result)}>
          Download JSON
        </button>
        <a href={href({ page: 'results' })}>All runs</a>
      </div>
      <dl className={`panel ${css.meta}`}>
        <div>
          <dt>Host</dt>
          <dd>
            {result.host.cpuModel ?? 'Unknown CPU'}, {result.host.cpus} CPUs,{' '}
            {(result.host.memoryMB / 1024).toFixed(1)} GB for Docker
          </dd>
        </div>
        <div>
          <dt>Docker</dt>
          <dd>
            {result.host.dockerVersion}, {result.host.os}
          </dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>
            {result.config.budgetPercent}% of the host, {result.plan.parallel} at once,{' '}
            {result.plan.batches.length} batch{result.plan.batches.length > 1 ? 'es' : ''}
          </dd>
        </div>
        <div>
          <dt>Load</dt>
          <dd>
            {result.config.warmupSlices} s warm-up, {result.config.measureSlices} s measured per
            workload; {result.config.loadgenCpus} CPUs per load generator
          </dd>
        </div>
        <div>
          <dt>Commit</dt>
          <dd className="mono">{result.commit?.slice(0, 12) ?? 'unknown'}</dd>
        </div>
        <div>
          <dt>Run id</dt>
          <dd className="mono">{result.id}</dd>
        </div>
      </dl>
      <Compare result={result} />
    </div>
  );
}
