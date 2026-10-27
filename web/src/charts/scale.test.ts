import { linear, niceTicks, spread } from './scale';

test('nice ticks cover the maximum with round steps', () => {
  expect(niceTicks(19245)).toEqual([0, 5000, 10000, 15000, 20000]);
  expect(niceTicks(3.08)).toEqual([0, 1, 2, 3, 4]);
  expect(niceTicks(97)).toEqual([0, 25, 50, 75, 100]);
  expect(niceTicks(0)).toEqual([0, 1]);
});

test('linear maps a domain onto a range', () => {
  const y = linear(0, 100, 200, 0);
  expect(y(0)).toBe(200);
  expect(y(50)).toBe(100);
  expect(linear(5, 5, 0, 10)(5)).toBe(5);
});

test('spread keeps labels apart and in order', () => {
  expect(spread([10, 12, 50], 10, 0, 100)).toEqual([10, 20, 50]);
  // pushed past the bottom, they shift back up
  expect(spread([95, 96], 10, 0, 100)).toEqual([90, 100]);
});
