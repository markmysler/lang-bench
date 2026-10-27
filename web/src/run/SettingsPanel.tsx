import { useState } from 'react';
import { buildImage } from '../api/client';
import type { AppConfig, ImageStatus, Plan, RunConfig, Workload, WorkloadName } from '../api/types';
import { bytes, modeLabel, WORKLOAD_NAMES } from '../ui/format';
import { badge } from '../ui/series';
import { estimateSeconds } from './estimate';
import css from './Run.module.css';

interface Props {
  app: AppConfig;
  images: ImageStatus[];
  onImagesChanged: () => void;
  config: RunConfig;
  onChange: (c: RunConfig) => void;
  plan: Plan | null;
  planError: string | null;
  running: boolean;
  onStart: () => void;
  onCancel: () => void;
}

const PARAM: Partial<Record<WorkloadName, { label: string; min: number; max: number }>> = {
  cpu: { label: 'n', min: 0, max: 32 },
  io: { label: 'ms', min: 0, max: 1000 },
  queries: { label: 'n', min: 1, max: 500 },
};

export function SettingsPanel(p: Props) {
  const { app, config: cfg, onChange } = p;
  const [building, setBuilding] = useState<string | null>(null);
  const [buildLine, setBuildLine] = useState('');
  const [buildError, setBuildError] = useState<string | null>(null);

  const image = (target: string) => p.images.find((i) => i.target === target);
  const set = (patch: Partial<RunConfig>) => onChange({ ...cfg, ...patch });

  const build = async (targets: string[]) => {
    setBuildError(null);
    try {
      for (const t of targets) {
        setBuilding(t);
        await buildImage(t, setBuildLine);
      }
    } catch (e) {
      setBuildError(`${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBuilding(null);
      setBuildLine('');
      p.onImagesChanged();
    }
  };

  const toggleServer = (id: string) =>
    set({
      servers: cfg.servers.includes(id)
        ? cfg.servers.filter((s) => s !== id)
        : app.servers.map((s) => s.id).filter((s) => s === id || cfg.servers.includes(s)),
    });

  const defaults = new Map(app.workloads.map((w) => [w.name, w]));
  const chosen = new Map(cfg.workloads.map((w) => [w.name, w]));
  const order = app.workloads.map((w) => w.name);
  const setWorkload = (name: WorkloadName, w: Workload | null) => {
    const next = new Map(chosen);
    if (w) next.set(name, w);
    else next.delete(name);
    set({ workloads: order.filter((n) => next.has(n)).map((n) => next.get(n)!) });
  };

  const languages = [...new Set(app.servers.map((s) => s.language))];
  const missing = [
    ...['loadgen', 'postgres'].filter((t) => image(t) && !image(t)!.built),
    ...cfg.servers.filter((id) => !image(id)?.built),
  ];
  const budgetCpus = Math.floor((app.host.cpus * cfg.budgetPercent) / 100);
  const minutes = Math.ceil(estimateSeconds(cfg, p.plan) / 60);

  return (
    <form
      className={`panel ${css.settings}`}
      onSubmit={(e) => {
        e.preventDefault();
        p.onStart();
      }}
    >
      <fieldset disabled={p.running}>
        <legend>Servers</legend>
        {languages.map((lang) => (
          <div key={lang}>
            <div className={css.group}>{lang}</div>
            {app.servers
              .filter((s) => s.language === lang)
              .map((s) => {
                const img = image(s.id);
                return (
                  <label key={s.id} className={css.check}>
                    <input
                      type="checkbox"
                      checked={cfg.servers.includes(s.id)}
                      onChange={() => toggleServer(s.id)}
                    />
                    <span className="tag mono">{badge(s.language)}</span>
                    <span className={css.grow}>
                      {s.framework}{' '}
                      <span className="muted" style={{ fontSize: 12 }}>
                        {s.frameworkVersion}
                      </span>
                      <span className={css.serverId}>{s.id}</span>
                    </span>
                    {img?.built ? (
                      <span className={css.image}>{bytes(img.sizeBytes ?? 0)}</span>
                    ) : (
                      <button
                        type="button"
                        className="button button-small"
                        disabled={building !== null}
                        onClick={() => build([s.id])}
                      >
                        {building === s.id ? 'Building…' : 'Build'}
                      </button>
                    )}
                  </label>
                );
              })}
          </div>
        ))}
      </fieldset>

      <fieldset disabled={p.running}>
        <legend>Workloads</legend>
        <div className={`${css.workload} ${css.workloadHead}`}>
          <span />
          <span />
          <span>Parameter</span>
          <span>Connections</span>
        </div>
        {order.map((name) => {
          const w = chosen.get(name);
          const def = defaults.get(name)!;
          const param = PARAM[name];
          return (
            <div key={name} className={css.workload}>
              <input
                type="checkbox"
                id={`w-${name}`}
                checked={!!w}
                onChange={(e) => setWorkload(name, e.target.checked ? def : null)}
              />
              <label htmlFor={`w-${name}`}>{WORKLOAD_NAMES[name]}</label>
              {param ? (
                <input
                  type="number"
                  aria-label={`${WORKLOAD_NAMES[name]}: ${param.label}`}
                  min={param.min}
                  max={param.max}
                  value={(w ?? def).param}
                  disabled={!w}
                  onChange={(e) =>
                    setWorkload(name, { ...(w ?? def), param: Number(e.target.value) })
                  }
                />
              ) : (
                <span />
              )}
              <input
                type="number"
                aria-label={`${WORKLOAD_NAMES[name]}: connections`}
                min={1}
                max={10000}
                value={(w ?? def).connections}
                disabled={!w}
                onChange={(e) =>
                  setWorkload(name, { ...(w ?? def), connections: Number(e.target.value) })
                }
              />
            </div>
          );
        })}
      </fieldset>

      <fieldset disabled={p.running}>
        <legend>Resources</legend>
        <label className={css.field}>
          Each server gets
          <select value={cfg.preset} onChange={(e) => set({ preset: e.target.value })}>
            {app.presets.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.cpus} CPU{pr.cpus > 1 ? 's' : ''},{' '}
                {pr.memoryMB >= 1024 ? `${pr.memoryMB / 1024} GB` : `${pr.memoryMB} MB`}
              </option>
            ))}
          </select>
        </label>
        <label className={css.field}>
          Use up to {cfg.budgetPercent}% of this machine: {budgetCpus} of {app.host.cpus} CPUs,{' '}
          {((app.host.memoryMB * cfg.budgetPercent) / 100 / 1024).toFixed(1)} GB
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={cfg.budgetPercent}
            onChange={(e) => set({ budgetPercent: Number(e.target.value) })}
          />
        </label>
        <div className={css.fields}>
          <label className={css.field}>
            At most at once (0 = as many as fit)
            <input
              type="number"
              min={0}
              max={64}
              value={cfg.maxParallel}
              onChange={(e) => set({ maxParallel: Number(e.target.value) })}
            />
          </label>
          <label className={css.field}>
            Load generator CPUs
            <input
              type="number"
              min={1}
              max={16}
              value={cfg.loadgenCpus}
              onChange={(e) => set({ loadgenCpus: Number(e.target.value) })}
            />
          </label>
          <label className={css.field}>
            Warm-up (s)
            <input
              type="number"
              min={0}
              max={300}
              value={cfg.warmupSlices}
              onChange={(e) => set({ warmupSlices: Number(e.target.value) })}
            />
          </label>
          <label className={css.field}>
            Measure (s)
            <input
              type="number"
              min={1}
              max={600}
              value={cfg.measureSlices}
              onChange={(e) => set({ measureSlices: Number(e.target.value) })}
            />
          </label>
        </div>
      </fieldset>

      <div className={css.plan} aria-live="polite">
        {p.planError ? (
          <span className="error">{p.planError}</span>
        ) : p.plan ? (
          <>
            <span>
              <span className="tag">{modeLabel(p.plan.mode, p.plan.parallel)}</span>
            </span>
            <span className="muted">
              {p.plan.batches.length} batch{p.plan.batches.length > 1 ? 'es' : ''}, about {minutes}{' '}
              min. Each server and its load generator get their own cores.
            </span>
          </>
        ) : null}
      </div>

      {missing.length > 0 && (
        <div className={css.plan}>
          <span className={css.missing}>Not built yet: {missing.join(', ')}</span>
          <div className={css.actions}>
            <button
              type="button"
              className="button"
              disabled={building !== null || p.running}
              onClick={() => build(missing)}
            >
              {building ? `Building ${building}…` : 'Build missing images'}
            </button>
          </div>
        </div>
      )}
      {building && <div className={css.buildLog}>{buildLine}</div>}
      {buildError && <div className="error">{buildError}</div>}

      <div className={css.actions}>
        {p.running ? (
          <button type="button" className="button" onClick={p.onCancel}>
            Stop run
          </button>
        ) : (
          <button
            type="submit"
            className="button button-primary"
            disabled={!!p.planError || !p.plan || missing.length > 0 || building !== null}
          >
            Start run
          </button>
        )}
      </div>
    </form>
  );
}
