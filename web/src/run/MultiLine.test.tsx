import { render, screen, within } from '@testing-library/react';
import { seriesColors } from '../ui/series';
import { MultiLine } from './MultiLine';

const series = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    label: `server-${i}`,
    color: '',
    points: [
      { x: 0, y: 10 * (i + 1) },
      { x: 1, y: 20 * (i + 1) },
    ],
  }));

test('up to eight servers share one chart', () => {
  const s = series(3);
  render(
    <MultiLine
      title="Throughput"
      series={s}
      colors={seriesColors(s.map((x) => x.id))}
      yFormat={String}
      xLabel="Second"
    />,
  );
  expect(screen.getAllByRole('figure')).toHaveLength(1);
});

test('past eight, small multiples share one scale and one table', () => {
  const s = series(10);
  render(
    <MultiLine
      title="Throughput"
      series={s}
      colors={seriesColors(s.map((x) => x.id))}
      yFormat={String}
      xLabel="Second"
    />,
  );
  const figures = screen.getAllByRole('figure');
  expect(figures).toHaveLength(10);
  // The smallest and the largest server are drawn against the same axis, topping out at 200.
  for (const f of [figures[0]!, figures[9]!]) {
    expect(within(f).getByText('200')).toBeInTheDocument();
    expect(within(f).queryByText('Show as table')).toBeNull();
  }
  const tables = screen.getAllByRole('table');
  expect(tables).toHaveLength(1);
  expect(within(tables[0]!).getAllByRole('columnheader')).toHaveLength(11);
});
