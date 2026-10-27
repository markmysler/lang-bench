import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  cancelRun,
  currentRun,
  followRun,
  getConfig,
  listImages,
  previewPlan,
  startRun,
} from '../api/client';
import type { AppConfig, ImageStatus, Plan, RunConfig } from '../api/types';
import { initialLive, liveReducer } from './liveState';
import { LiveView } from './LiveView';
import { SettingsPanel } from './SettingsPanel';
import css from './Run.module.css';

type Action = Parameters<typeof liveReducer>[1] | { type: 'reset' };

const reducer = (s: typeof initialLive, a: Action) =>
  a.type === 'reset' ? initialLive : liveReducer(s, a);

export function RunPage() {
  const [app, setApp] = useState<AppConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [images, setImages] = useState<ImageStatus[]>([]);
  const [config, setConfig] = useState<RunConfig | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [live, dispatch] = useReducer(reducer, initialLive);
  const stop = useRef<(() => void) | null>(null);

  const refreshImages = useCallback(() => {
    listImages().then(setImages, () => {});
  }, []);

  const follow = useCallback(() => {
    stop.current?.();
    dispatch({ type: 'reset' });
    setRunning(true);
    stop.current = followRun(dispatch, () => {
      setRunning(false);
      currentRun().then(
        (c) => setRunning(c.running),
        () => {},
      );
    });
  }, []);

  useEffect(() => {
    getConfig().then(
      (a) => {
        setApp(a);
        setConfig({ ...a.defaults, servers: a.servers.map((s) => s.id) });
      },
      (e: Error) => setLoadError(e.message),
    );
    refreshImages();
    currentRun().then(
      (c) => {
        if (c.running) follow();
      },
      () => {},
    );
    return () => stop.current?.();
  }, [follow, refreshImages]);

  useEffect(() => {
    if (!config) return;
    const t = setTimeout(() => {
      previewPlan(config).then(
        (p) => {
          setPlan(p);
          setPlanError(null);
        },
        (e: Error) => {
          setPlan(null);
          setPlanError(e.message);
        },
      );
    }, 200);
    return () => clearTimeout(t);
  }, [config]);

  if (loadError) {
    return (
      <div className="panel">
        <h1>Can’t reach the orchestrator</h1>
        <p>{loadError}</p>
        <p className="muted">
          Start it with <code>docker compose up --build</code> in the repository, then reload.
        </p>
      </div>
    );
  }
  if (!app || !config) return <p className="muted">Loading…</p>;

  const start = async () => {
    try {
      await startRun(config);
      follow();
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={css.layout}>
      <SettingsPanel
        app={app}
        images={images}
        onImagesChanged={refreshImages}
        config={config}
        onChange={setConfig}
        plan={plan}
        planError={planError}
        running={running}
        onStart={start}
        onCancel={() => cancelRun()}
      />
      <LiveView live={live} servers={app.servers} />
    </div>
  );
}
