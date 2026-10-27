import { useId } from 'react';
import css from './Charts.module.css';

export interface Bar {
  id: string;
  label: string;
  badge?: string;
  value: number;
  color: string;
  /** Shown instead of a bar, for servers with no value (failed, not run). */
  note?: string;
}

interface Props {
  title: string;
  /** Which way is better, for sorting and for the hint. */
  better: 'higher' | 'lower';
  bars: Bar[];
  format: (v: number) => string;
}

/** A ranking: horizontal bars, best first, with the value at the end of each. */
export function BarChart({ title, better, bars, format }: Props) {
  const titleId = useId();
  const valued = bars.filter((b) => b.note === undefined);
  const max = Math.max(0, ...valued.map((b) => b.value)) || 1;
  const sorted = [
    ...valued.sort((a, b) => (better === 'higher' ? b.value - a.value : a.value - b.value)),
    ...bars.filter((b) => b.note !== undefined),
  ];
  return (
    <figure className={css.chart} aria-labelledby={titleId} style={{ margin: 0 }}>
      <div className={css.head}>
        <figcaption id={titleId} className={css.title}>
          {title}
        </figcaption>
        <span className={css.hint}>
          {better === 'higher' ? 'Higher is better' : 'Lower is better'}
        </span>
      </div>
      <ol className={css.bars}>
        {sorted.map((b) => (
          <li key={b.id} style={{ display: 'contents' }}>
            <span className={css.barLabel}>
              {b.badge && <span className={css.badge}>{b.badge}</span>}
              {b.label}
            </span>
            <span className={css.barTrack}>
              {b.note === undefined ? (
                <>
                  <span
                    className={css.bar}
                    style={{ width: `${(b.value / max) * 85}%`, background: b.color }}
                  />
                  <span className={css.barValue}>{format(b.value)}</span>
                </>
              ) : (
                <span className={css.barNote}>{b.note}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
