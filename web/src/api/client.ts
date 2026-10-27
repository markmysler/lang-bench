import type {
  AppConfig,
  ImageStatus,
  Plan,
  Result,
  RunConfig,
  RunEvent,
  RunSummary,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getConfig = () => request<AppConfig>('/api/config');
export const previewPlan = (cfg: RunConfig) => request<Plan>('/api/plan', post(cfg));
export const listImages = () => request<ImageStatus[]>('/api/images');
export const startRun = (cfg: RunConfig) => request<void>('/api/runs', post(cfg));
export const cancelRun = () => request<void>('/api/runs/current', { method: 'DELETE' });
export const currentRun = () =>
  request<{ running: boolean; id?: string; error?: string }>('/api/runs/current');
export const listRuns = () => request<RunSummary[]>('/api/runs');
export const getRun = (id: string) => request<Result>(`/api/runs/${encodeURIComponent(id)}`);

/** Follows the current run's events, from its start. Returns a function that stops following. */
export function followRun(onEvent: (e: RunEvent) => void, onEnd: () => void): () => void {
  const es = new EventSource('/api/runs/current/events');
  es.onmessage = (m) => onEvent(JSON.parse(m.data) as RunEvent);
  // The server closes the stream when the run ends; EventSource would reconnect, so stop here.
  es.onerror = () => {
    es.close();
    onEnd();
  };
  return () => es.close();
}

/** Builds an image, passing each line of build output to onLine. */
export async function buildImage(target: string, onLine: (line: string) => void): Promise<void> {
  const res = await fetch(`/api/images/${encodeURIComponent(target)}/build`, { method: 'POST' });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.replace(/^data: /, '');
      const msg = JSON.parse(data) as { line?: string; done?: boolean; error?: string };
      if (msg.line !== undefined) onLine(msg.line);
      if (msg.error) throw new Error(msg.error);
    }
  }
}
