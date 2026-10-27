import type { Mode, Workload, WorkloadName } from '../api/types';

const sig = (n: number, digits = 3) => {
  const s = n.toPrecision(digits);
  return s.includes('e') ? String(Math.round(n)) : String(Number(s));
};

/** Requests per second, compact. */
export function rate(n: number): string {
  if (n >= 1e6) return `${sig(n / 1e6, 2)}M`;
  if (n >= 1e3) return `${sig(n / 1e3, 3)}k`;
  return String(Math.round(n));
}

/** A latency given in milliseconds. */
export function ms(n: number): string {
  if (n >= 1000) return `${sig(n / 1000, 3)} s`;
  return `${sig(n, 3)} ms`;
}

export function bytes(n: number): string {
  const mb = n / 1024 ** 2;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export const percent = (n: number) => `${Math.round(n)}%`;

export const count = (n: number) => n.toLocaleString('en-US');

export const WORKLOAD_NAMES: Record<WorkloadName, string> = {
  plaintext: 'Plaintext',
  json: 'JSON',
  cpu: 'CPU',
  io: 'I/O wait',
  db: 'Database: one row',
  queries: 'Queries',
};

export function workloadLabel(w: Workload): string {
  switch (w.name) {
    case 'cpu':
      return `CPU: fib(${w.param})`;
    case 'io':
      return `I/O wait: ${w.param} ms`;
    case 'queries':
      return `Queries: ${w.param} per request`;
    default:
      return WORKLOAD_NAMES[w.name];
  }
}

export function modeLabel(mode: Mode, parallel: number): string {
  switch (mode) {
    case 'simultaneous':
      return `Simultaneous: all ${parallel} at once`;
    case 'batched':
      return `Batched: ${parallel} at once, then the rest`;
    case 'sequential':
      return 'Sequential: one at a time';
  }
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
