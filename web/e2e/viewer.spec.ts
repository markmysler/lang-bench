import { expect, test } from '@playwright/test';
import { VIEWER, run } from './api';

test('the viewer opens on published runs and compares one', async ({ page }) => {
  await page.goto(VIEWER);
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();
  await page.getByRole('row').nth(1).getByRole('link').click();

  const throughput = page.getByRole('figure', { name: 'Throughput', exact: true });
  await expect(throughput.getByRole('listitem')).toHaveCount(run.servers.length);
  // Ranked best first.
  await expect(throughput.getByRole('listitem').first()).toContainText('rust-axum');

  await page.getByRole('button', { name: 'CPU', exact: true }).click();
  await expect(page.getByText('CPU: fib(20), 64 connections')).toBeVisible();

  const timeline = page.getByRole('figure', { name: 'Throughput, second by second' });
  await timeline.getByText('Show as table').click();
  await expect(timeline.getByRole('table')).toBeVisible();
});

test('the run tab explains how to run locally', async ({ page }) => {
  await page.goto(`${VIEWER}#/run`);
  await expect(page.getByRole('heading', { name: 'Run it yourself' })).toBeVisible();
  await expect(page.getByText('docker compose up --build')).toBeVisible();
});

test('learn articles open from the index', async ({ page }) => {
  await page.goto(`${VIEWER}#/learn`);
  await page.getByRole('link', { name: 'How runs stay fair' }).click();
  await expect(page.getByRole('heading', { name: 'One-second slices' })).toBeVisible();
});

for (const path of ['#/results', `#/results/${run.id}`, '#/learn/metrics', '#/run']) {
  test(`no sideways scrolling on ${path}`, async ({ page }) => {
    await page.goto(VIEWER + path);
    await page.waitForLoadState('networkidle');
    const [scroll, width] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(scroll).toBeLessThanOrEqual(width);
  });
}
