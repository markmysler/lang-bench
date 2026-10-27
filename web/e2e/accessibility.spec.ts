import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { DASHBOARD, VIEWER, mockApi, run } from './api';

const pages = [
  { name: 'dashboard', url: DASHBOARD, ready: 'Start run' },
  { name: 'results list', url: `${VIEWER}#/results`, ready: 'Results' },
  { name: 'comparison', url: `${VIEWER}#/results/${run.id}`, ready: 'The servers' },
  { name: 'learn', url: `${VIEWER}#/learn/workloads`, ready: 'The workloads' },
];

for (const theme of ['dark', 'light'] as const) {
  for (const p of pages) {
    test(`${p.name} has no accessibility violations (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await mockApi(page);
      await page.goto(p.url);
      await expect(page.getByText(p.ready, { exact: true }).first()).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    });
  }
}
