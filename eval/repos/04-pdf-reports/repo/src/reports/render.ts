import PDFDocument from 'pdfkit';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { prisma } from '../db';

const charts = new ChartJSNodeCanvas({ width: 800, height: 400 });

/** Builds the PDF in memory: about 400 ms of CPU per report, most of it drawing the charts. */
export async function renderMonthlyReport(accountId: string, month: string): Promise<Buffer> {
  const usage = await prisma.usage.findMany({ where: { accountId, month } });
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  for (const section of groupBySection(usage)) {
    const image = await charts.renderToBuffer(chartFor(section));
    doc.addPage().image(image, { fit: [500, 250] });
  }
  doc.end();
  return new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

declare function groupBySection(rows: unknown[]): unknown[];
declare function chartFor(section: unknown): never;
