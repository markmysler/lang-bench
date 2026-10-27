import { LineChart, type Series } from '../charts/LineChart';
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
 * so each server gets its own small chart in one neutral colour.
 */
export function MultiLine({ series, colors, title, ...rest }: Props) {
  if (colors.size > 0) {
    return (
      <LineChart
        title={title}
        series={series.map((s) => ({ ...s, color: colors.get(s.id) ?? NEUTRAL }))}
        {...rest}
      />
    );
  }
  return (
    <section aria-label={title}>
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>{title}</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        {series.map((s) => (
          <LineChart
            key={s.id}
            title={s.label}
            series={[{ ...s, color: NEUTRAL }]}
            height={120}
            {...rest}
          />
        ))}
      </div>
    </section>
  );
}
