import { badge, seriesColors, MAX_SERIES } from './series';

test('colours follow the run order and never cycle', () => {
  const ids = ['go-gin', 'rust-axum', 'python-fastapi'];
  const c = seriesColors(ids);
  expect(c.get('go-gin')).toBe('var(--series-1)');
  expect(c.get('python-fastapi')).toBe('var(--series-3)');
});

test('past eight servers nobody gets a generated colour', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
  const c = seriesColors(ids);
  expect(c.size).toBe(0);
  expect(MAX_SERIES).toBe(8);
});

test('badges name the language', () => {
  expect(badge('Go')).toBe('GO');
  expect(badge('Rust')).toBe('RS');
  expect(badge('JavaScript')).toBe('JS');
  expect(badge('Python')).toBe('PY');
  expect(badge('Java')).toBe('JV');
  expect(badge('Brainfuck')).toBe('BR');
});
