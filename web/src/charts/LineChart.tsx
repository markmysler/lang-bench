import { useId, useMemo, useState, type PointerEvent } from 'react';
import { linear, niceTicks, spread } from './scale';
import { useWidth } from './useWidth';
import css from './Charts.module.css';

export interface Point {
  x: number;
  y: number;
}

export interface Series {
  id: string;
  label: string;
  badge?: string;
  color: string;
  points: Point[];
}

interface Props {
  title: string;
  hint?: string;
  series: Series[];
  yFormat: (v: number) => string;
  xFormat?: (v: number) => string;
  xLabel: string;
  /** A shaded stretch of x, such as the warm-up. */
  band?: { from: number; to: number; label: string };
  height?: number;
}

const M = { top: 8, right: 12, bottom: 24, left: 52 };

/** A time series chart: one y axis, 2 px lines, a crosshair tooltip and a table view. */
export function LineChart({
  title,
  hint,
  series,
  yFormat,
  xFormat = (v) => `${Math.round(v)}s`,
  xLabel,
  band,
  height = 200,
}: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const titleId = useId();
  const direct = series.length <= 4;
  const right = M.right + (direct ? 88 : 0);

  const { xs, x0, x1, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const xs = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);
    const yMax = Math.max(0, ...all.map((p) => p.y));
    return { xs, x0: xs[0] ?? 0, x1: xs.at(-1) ?? 1, ticks: niceTicks(yMax) };
  }, [series]);

  const plotW = Math.max(40, width - M.left - right);
  const plotH = height - M.top - M.bottom;
  const x = linear(x0, x1, M.left, M.left + plotW);
  const y = linear(0, ticks.at(-1) ?? 1, M.top + plotH, M.top);
  const xTicks = niceTicks(x1 - x0, Math.max(2, Math.floor(plotW / 80))).map((t) => t + x0);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (xs.length === 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = xs[0]!;
    for (const v of xs) if (Math.abs(x(v) - px) < Math.abs(x(best) - px)) best = v;
    setHoverX(best);
  };

  const at = (s: Series, v: number) => s.points.find((p) => p.x === v);
  const hovered =
    hoverX === null
      ? []
      : series
          .map((s) => ({ s, p: at(s, hoverX) }))
          .filter((h): h is { s: Series; p: Point } => !!h.p)
          .sort((a, b) => b.p.y - a.p.y);

  const ends = series.map((s) => s.points.at(-1));
  const endYs = direct
    ? spread(
        ends.map((p) => (p ? y(p.y) : M.top)),
        13,
        M.top + 4,
        M.top + plotH,
      )
    : [];

  const empty = series.every((s) => s.points.length === 0);

  return (
    <figure className={css.chart} ref={ref} aria-labelledby={titleId} style={{ margin: 0 }}>
      <div className={css.head}>
        <figcaption id={titleId} className={css.title}>
          {title}
        </figcaption>
        {hint && <span className={css.hint}>{hint}</span>}
      </div>
      {series.length > 1 && (
        <ul className={css.legend}>
          {series.map((s) => (
            <li key={s.id}>
              <span className={css.swatch} style={{ background: s.color }} />
              {s.badge && <span className={css.badge}>{s.badge}</span>}
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <svg
        className={css.plot}
        // A percentage width never pushes the layout wider; the viewBox keeps one unit per pixel.
        style={{ width: '100%', height }}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title}, ${xLabel} on the horizontal axis`}
        onPointerMove={onMove}
        onPointerLeave={() => setHoverX(null)}
      >
        {band && band.to > x0 && (
          <g>
            <rect
              x={x(Math.max(band.from, x0))}
              y={M.top}
              width={Math.max(0, x(Math.min(band.to, x1)) - x(Math.max(band.from, x0)))}
              height={plotH}
              fill="var(--band)"
            />
            <text className={css.bandLabel} x={x(Math.max(band.from, x0)) + 4} y={M.top + 12}>
              {band.label}
            </text>
          </g>
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line
              className={t === 0 ? css.baseline : css.grid}
              x1={M.left}
              x2={M.left + plotW}
              y1={y(t)}
              y2={y(t)}
            />
            <text className={css.axis} x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {!empty &&
          xTicks.map((t) => (
            <text key={t} className={css.axis} x={x(t)} y={height - 6} textAnchor="middle">
              {xFormat(t)}
            </text>
          ))}
        {series.map((s) => (
          <polyline
            key={s.id}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={s.points.map((p) => `${x(p.x)},${y(p.y)}`).join(' ')}
          />
        ))}
        {direct &&
          series.map((s, i) =>
            ends[i] ? (
              <text
                key={s.id}
                className={css.endLabel}
                x={x(ends[i].x) + 8}
                y={endYs[i]}
                dy="0.32em"
              >
                {s.label}
              </text>
            ) : null,
          )}
        {hoverX !== null && (
          <g>
            <line
              className={css.crosshair}
              x1={x(hoverX)}
              x2={x(hoverX)}
              y1={M.top}
              y2={M.top + plotH}
            />
            {hovered.map(({ s, p }) => (
              <circle
                key={s.id}
                cx={x(p.x)}
                cy={y(p.y)}
                r={4}
                fill={s.color}
                stroke="var(--panel)"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
        {empty && (
          <text
            className={css.axis}
            x={M.left + plotW / 2}
            y={M.top + plotH / 2}
            textAnchor="middle"
          >
            Waiting for data
          </text>
        )}
      </svg>
      {hoverX !== null && hovered.length > 0 && (
        <div
          className={css.tooltip}
          role="status"
          style={
            x(hoverX) > width / 2 ? { right: width - x(hoverX) + 12 } : { left: x(hoverX) + 12 }
          }
        >
          <strong>{xFormat(hoverX)}</strong>
          <dl>
            {hovered.map(({ s, p }) => (
              <div key={s.id} className={css.tooltipRow}>
                <dt>
                  <span className={css.swatch} style={{ background: s.color }} />
                  <span className={css.tooltipName}>{s.label}</span>
                </dt>
                <dd>{yFormat(p.y)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <details className={css.tableToggle}>
        <summary>Show as table</summary>
        <div className="table-scroll" role="region" aria-label={`${title} as a table`} tabIndex={0}>
          <table className="data">
            <thead>
              <tr>
                <th>{xLabel}</th>
                {series.map((s) => (
                  <th key={s.id}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {xs.map((v) => (
                <tr key={v}>
                  <td>{xFormat(v)}</td>
                  {series.map((s) => {
                    const p = at(s, v);
                    return <td key={s.id}>{p ? yFormat(p.y) : '–'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
