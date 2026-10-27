import { bytes, count, ms, percent, rate, workloadLabel, modeLabel } from './format';

test('rates switch to thousands', () => {
  expect(rate(0)).toBe('0');
  expect(rate(950.4)).toBe('950');
  expect(rate(19245)).toBe('19.2k');
  expect(rate(149_900)).toBe('150k');
  expect(rate(2_400_000)).toBe('2.4M');
});

test('milliseconds keep useful precision', () => {
  expect(ms(0.1239)).toBe('0.124 ms');
  expect(ms(3.33)).toBe('3.33 ms');
  expect(ms(12.84)).toBe('12.8 ms');
  expect(ms(1532)).toBe('1.53 s');
});

test('bytes in binary units', () => {
  expect(bytes(7 * 1024 * 1024)).toBe('7.0 MB');
  expect(bytes(512 * 1024)).toBe('512 KB');
  expect(bytes(1.5 * 1024 ** 3)).toBe('1.50 GB');
});

test('percent and count', () => {
  expect(percent(97.4)).toBe('97%');
  expect(count(28628)).toBe('28,628');
});

test('workload labels include their parameter', () => {
  expect(workloadLabel({ name: 'cpu', param: 25, connections: 64 })).toBe('CPU: fib(25)');
  expect(workloadLabel({ name: 'io', param: 10, connections: 256 })).toBe('I/O wait: 10 ms');
  expect(workloadLabel({ name: 'queries', param: 20, connections: 64 })).toBe(
    'Queries: 20 per request',
  );
  expect(workloadLabel({ name: 'plaintext', param: 0, connections: 64 })).toBe('Plaintext');
});

test('mode labels', () => {
  expect(modeLabel('batched', 4)).toBe('Batched: 4 at once, then the rest');
  expect(modeLabel('simultaneous', 3)).toBe('Simultaneous: all 3 at once');
  expect(modeLabel('sequential', 1)).toBe('Sequential: one at a time');
});
