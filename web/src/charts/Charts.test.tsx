import { fireEvent, render, screen, within } from '@testing-library/react';
import { BarChart } from './BarChart';
import { LineChart } from './LineChart';

const series = [
  {
    id: 'a',
    label: 'go-gin',
    badge: 'GO',
    color: 'red',
    points: [
      { x: 0, y: 10 },
      { x: 1, y: 20 },
    ],
  },
  {
    id: 'b',
    label: 'rust-axum',
    badge: 'RS',
    color: 'blue',
    points: [
      { x: 0, y: 30 },
      { x: 1, y: 40 },
    ],
  },
];

test('a line chart has a legend and a table view of every point', () => {
  render(<LineChart title="Throughput" series={series} yFormat={String} xLabel="Second" />);
  expect(screen.getByRole('figure', { name: 'Throughput' })).toBeInTheDocument();
  const legend = screen.getAllByRole('list')[0]!;
  expect(within(legend).getByText('go-gin')).toBeInTheDocument();
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(within(table).getByText('40')).toBeInTheDocument();
});

test('hovering shows every series at that moment, highest first', () => {
  render(<LineChart title="Throughput" series={series} yFormat={String} xLabel="Second" />);
  const svg = screen.getByRole('img');
  fireEvent.pointerMove(svg, { clientX: 1000, clientY: 50 });
  const tip = screen.getByRole('status');
  expect(tip.textContent).toMatch(/rust-axum40.*go-gin20/);
  fireEvent.pointerLeave(svg);
  expect(screen.queryByRole('status')).toBeNull();
});

test('an empty chart says it is waiting', () => {
  render(<LineChart title="p99" series={[]} yFormat={String} xLabel="Second" />);
  expect(screen.getByText('Waiting for data')).toBeInTheDocument();
});

test('bars rank best first and put failures last', () => {
  render(
    <BarChart
      title="p99 latency"
      better="lower"
      format={(v) => `${v} ms`}
      bars={[
        { id: 'a', label: 'slow', value: 9, color: 'red' },
        { id: 'b', label: 'broken', value: 0, color: 'red', note: 'failed' },
        { id: 'c', label: 'fast', value: 2, color: 'red' },
      ]}
    />,
  );
  const items = screen.getAllByRole('listitem').map((li) => li.textContent);
  expect(items).toEqual(['fast2 ms', 'slow9 ms', 'brokenfailed']);
  expect(screen.getByText('Lower is better')).toBeInTheDocument();
});
