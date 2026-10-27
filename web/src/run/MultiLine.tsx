import { LineChart, type Series } from '../charts/LineChart';
import chartCss from '../charts/Charts.module.css';
import { NEUTRAL } from '../ui/series';

interface Props {
  title: string;
  hint?: string;
  series: Series[];
  colors: Map<string, string>;
  yFormat: (v: number) => string;
  xFormat?: (v: number) => string;
  xLabel: string;
  band?: { from: number; to: number; label: string };
}

/**
 * One chart for up to eight servers. Past eight there are no more colours to tell lines apart,
 * so each server gets its own small chart in one neutral colour. The small charts share one y
 * scale, so heights compare across them, and one table covers them all.
 */
export function MultiLine({ series, colors, title, hint, ...rest }: Props) {
  if (colors.size > 0) {
    return (
      <LineChart
        title={title}
        hint={hint}
        series={series.map((s) => ({ ...s, color: colors.get(s.id) ?? NEUTRAL }))}
        {...rest}
      />
    );
  }
  const yMax = Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.y)));
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const xFormat = rest.xFormat ?? ((v: number) => `${Math.round(v)}s`);
  return (
    <section aria-label={title}>
      <div className={chartCss.head}>
        <h3 className={chartCss.title}>{title}</h3>
        {hint && <span className={chartCss.hint}>{hint}, one scale for all</span>}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
          gap: 12,
        }}
      >
        {series.map((s) => (
          <LineChart
            key={s.id}
            title={s.label}
            series={[{ ...s, color: NEUTRAL }]}
            height={110}
            yMax={yMax}
            table={false}
            {...rest}
          />
        ))}
      </div>
      <details className={chartCss.tableToggle}>
        <summary>Show as table</summary>
        <div className="table-scroll" role="region" aria-label={`${title} as a table`} tabIndex={0}>
          <table className="data">
            <thead>
              <tr>
                <th>{rest.xLabel}</th>
                {series.map((s) => (
                  <th key={s.id}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {xs.map((x) => (
                <tr key={x}>
                  <td>{xFormat(x)}</td>
                  {series.map((s) => {
                    const p = s.points.find((q) => q.x === x);
                    return <td key={s.id}>{p ? rest.yFormat(p.y) : '–'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
