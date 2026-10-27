import { href, parseRoute } from './routes';

test('routes round-trip through the hash', () => {
  for (const r of [
    { page: 'run' },
    { page: 'results' },
    { page: 'results', id: '20261027-125811-c6adbb' },
    { page: 'learn' },
    { page: 'learn', slug: 'metrics' },
  ] as const) {
    expect(parseRoute(href(r))).toEqual({ ...r });
  }
});

test('anything unknown is the run page', () => {
  expect(parseRoute('')).toEqual({ page: 'run' });
  expect(parseRoute('#/nope')).toEqual({ page: 'run' });
});
