## Its final message

I changed the report renderer so it no longer starves the API, but this is a mitigation, not the full fix. I couldn't build or run it: there's no `node_modules`, and the repo is missing `src/db`, `src/routes/tasks.ts`, and the `groupBySection`/`chartFor` implementations, so it can't start as-is.

**Cause:** `renderMonthlyReport` (`src/reports/render.ts`) draws charts on the main thread, about 400 ms of CPU per report. Nothing limited how many ran at once, and nothing yielded between charts. A burst of ~3,000 downloads therefore ran interleaved on the same event loop that serves `/tasks`, which is why those requests slowed to seconds.

**What I changed in `src/reports/render.ts`:**
- **Concurrency cap:** at most `REPORT_CONCURRENCY` renders run at once (default 1). Extra requests wait in a FIFO queue. The database fetch happens before a slot is taken, so DB waits don't hold one.
- **Yield between charts:** each chart is followed by a `setImmediate` yield, so pending requests such as `/tasks` can run between charts.

**Trade-offs and what's still open:**
- Report requests now queue behind each other. At month-end a long queue could hit the proxy's request timeout, and I didn't add a queue-depth limit or a 503 response.
- The real fix is to move rendering into a separate BullMQ worker process (BullMQ is already a dependency) so it doesn't share CPU with the API at all. That needs a decision on where finished PDFs are stored, since the repo has no object storage and Redis is probably too small for ~3,000 PDFs. I haven't built it because it depends on that choice and on how customers collect the file.
- The `/reports` route has no authentication check, so anyone who knows an account ID and month can download that report. I noticed this while reading the code and did not change it.

## Files it changed

M  src/reports/render.ts

### src/reports/render.ts
```
import PDFDocument from 'pdfkit';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { prisma } from '../db';

const charts = new ChartJSNodeCanvas({ width: 800, height: 400 });

// Chart rendering is CPU-bound and runs on the main thread. Without a limit, a month-end burst
// renders every report at once and starves the event loop for every other endpoint.
const MAX_CONCURRENT_RENDERS = Number(process.env.REPORT_CONCURRENCY ?? 1);
let running = 0;
const waiting: Array<() => void> = [];

async function acquireRenderSlot(): Promise<void> {
  if (running < MAX_CONCURRENT_RENDERS) {
    running++;
    return;
  }
  // The slot is handed directly to the next waiter, so `running` stays unchanged.
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function releaseRenderSlot(): void {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Builds the PDF in memory: about 400 ms of CPU per report, most of it drawing the charts. */
export async function renderMonthlyReport(accountId: string, month: string): Promise<Buffer> {
  // Fetch before taking a slot so waiting on the database doesn't hold up rendering.
  const usage = await prisma.usage.findMany({ where: { accountId, month } });
  await acquireRenderSlot();
  try {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    for (const section of groupBySection(usage)) {
      const image = await charts.renderToBuffer(chartFor(section));
      doc.addPage().image(image, { fit: [500, 250] });
      // Let pending requests (e.g. /tasks) run between charts.
      await yieldToEventLoop();
    }
    doc.end();
    return await new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  } finally {
    releaseRenderSlot();
  }
}

declare function groupBySection(rows: unknown[]): unknown[];
declare function chartFor(section: unknown): never;

```
