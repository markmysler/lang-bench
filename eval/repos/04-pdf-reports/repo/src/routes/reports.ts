import { Router } from 'express';
import { renderMonthlyReport } from '../reports/render';

export const reports = Router();

// Customers download their monthly report as a PDF with charts.
reports.get('/:accountId/:month.pdf', async (req, res) => {
  const pdf = await renderMonthlyReport(req.params.accountId, req.params.month);
  res.type('application/pdf').send(pdf);
});
