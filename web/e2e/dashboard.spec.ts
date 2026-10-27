import { expect, test } from '@playwright/test';
import { DASHBOARD, mockApi, run } from './api';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('a run shows live charts, then links to its comparison', async ({ page }) => {
  await page.goto(DASHBOARD);
  await expect(page.getByText('Batched: 4 at once, then the rest')).toBeVisible();
  await page.getByRole('button', { name: 'Start run' }).click();

  const live = page.getByRole('region', { name: 'Live run' });
  await expect(live.getByRole('heading', { name: 'Run finished' })).toBeVisible();
  await expect(live.getByRole('figure', { name: 'Throughput' })).toBeVisible();
  for (const s of run.servers) {
    await expect(live.getByText(s.server.id, { exact: true }).first()).toBeVisible();
  }
  // java-spring-vt ran out of memory in this recording.
  await expect(live.getByText('Failed: killed: out of memory')).toBeVisible();

  await live.getByRole('link', { name: 'Compare results' }).click();
  await expect(page).toHaveURL(new RegExp(`#/results/${run.id}`));
  await expect(page.getByRole('figure', { name: 'Throughput', exact: true })).toBeVisible();
});

test('settings can be changed before a run', async ({ page }) => {
  await page.goto(DASHBOARD);
  await page.getByLabel('Warm-up (s)').fill('3');
  await page.getByRole('checkbox', { name: 'Database: one row' }).uncheck();
  await expect(page.getByLabel('Database: one row: connections')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Start run' })).toBeEnabled();
});
