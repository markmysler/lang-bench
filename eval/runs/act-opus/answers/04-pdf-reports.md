## Its final message

I moved report rendering into a separate BullMQ worker process, so it no longer runs on the API's event loop. I couldn't compile or run any of it: the repo has no `node_modules` or tsconfig, and `src/db` and `src/routes/tasks` don't exist in it. Nothing is committed.

**Why `/tasks` got slow:** each report takes about 400 ms of CPU, and it ran inside the same Node process that serves every other request. Node handles one thing at a time per process, so while a report rendered, all other requests waited behind it. With about 3,000 reports in a few hours, `/tasks` p95 went from 120 ms to 4 s. More API machines wouldn't have fixed it, because the reports would still run on them.

**What changed:**
- **`src/worker.ts` (new):** a worker that takes jobs from the `reports` queue, renders the PDF with the unchanged `renderMonthlyReport`, and stores it in Redis for 10 minutes. It renders one report at a time; to go faster, add worker machines.
- **`src/routes/reports.ts`:** the download URL is the same. If the PDF is already in Redis, it's sent straight away. Otherwise the handler queues a job and waits for it, which only waits on I/O, so the API keeps serving `/tasks`. If several people request the same report at once, it's rendered only once.
- **`src/reports/queue.ts` (new):** shared setup for the Redis connection and the queue.
- **`package.json`:** added `ioredis` as a direct dependency (BullMQ already depends on it). **`README.md`:** documents the two processes.

**Behaviour changes you should know about:**
- If a report isn't ready within 60 seconds, the API now returns **503 with `Retry-After: 30`** instead of holding the connection open. The render keeps going, so the retry gets the finished PDF. Browsers won't retry by themselves, so the frontend may need to handle this.
- A report downloaded again within 10 minutes is the copy already made. For a month still in progress, the numbers can be up to 10 minutes old.

**Before deploying:**
1. **The worker must run on its own machines.** Add a Fly process group (e.g. `worker = "node dist/worker.js"`) next to the app; there's no `fly.toml` in the repo, so I couldn't add it. If the worker runs on the API machines, it will compete with the API for the same CPUs, and the shared CPUs on those machines can be throttled under sustained load.
2. Set `REDIS_URL` for both processes, and run `npm install`.
3. Each job's 60-second limit only stops the API from waiting. If the worker is slow at month-end, add worker machines. As a rough sizing, 3,000 reports × 0.4 s is about 20 minutes of rendering on one worker.

**Further option:** have a scheduled BullMQ job render every account's report after month close, so customer downloads come straight from storage. That would need somewhere longer-lived than Redis to keep the PDFs, such as S3 or Tigris.

## Files it changed

M  README.md
M  package.json
A  src/reports/queue.ts
M  src/routes/reports.ts
A  src/worker.ts

### README.md
```
# Acme Collab API

Express + Prisma on Postgres, deployed on Fly.io (2 machines, shared-cpu-2x). Four developers,
all TypeScript. Redis (Upstash) is available; BullMQ is already a dependency.

Two processes, both need `REDIS_URL`:

- `src/index.ts`: the HTTP API.
- `src/worker.ts`: renders monthly report PDFs from the `reports` queue. Run it on its own
  machines (a separate Fly process group), never alongside the API: rendering is ~400 ms of CPU
  per report and would block API requests again (see docs/incidents/2026-09-30-month-end.md).

```

### package.json
```
{
  "name": "@acme/api",
  "private": true,
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "bullmq": "^5.25.0",
    "chartjs-node-canvas": "^4.1.6",
    "express": "^4.21.1",
    "ioredis": "^5.4.1",
    "pdfkit": "^0.15.0"
  }
}

```

### src/reports/queue.ts
```
import IORedis, { type RedisOptions } from 'ioredis';

export const REPORTS_QUEUE = 'reports';

/** How long a rendered PDF stays in Redis, so retries and repeat downloads don't render it again. */
export const PDF_TTL_SECONDS = 10 * 60;

export interface ReportJob {
  accountId: string;
  month: string;
}

export function connectRedis(options: RedisOptions = {}): IORedis {
  return new IORedis(process.env.REDIS_URL!, options);
}

/** Used as the BullMQ job id, so concurrent requests for the same report share one render. */
export function reportId(accountId: string, month: string): string {
  return `${encodeURIComponent(accountId)}/${encodeURIComponent(month)}`;
}

export function pdfKey(id: string): string {
  return `report-pdf/${id}`;
}

```

### src/routes/reports.ts
```
import { Router } from 'express';
import { Queue, QueueEvents } from 'bullmq';
import { REPORTS_QUEUE, connectRedis, pdfKey, reportId, type ReportJob } from '../reports/queue';

export const reports = Router();

const redis = connectRedis();
const queue = new Queue<ReportJob>(REPORTS_QUEUE, { connection: connectRedis() });
const queueEvents = new QueueEvents(REPORTS_QUEUE, { connection: connectRedis({ maxRetriesPerRequest: null }) });

const WAIT_MS = 60_000;

// Customers download their monthly report as a PDF with charts. Rendering happens in the
// report worker (src/worker.ts); this handler only waits on I/O.
reports.get('/:accountId/:month.pdf', async (req, res) => {
  const { accountId, month } = req.params;
  const id = reportId(accountId, month);

  let pdf = await redis.getBuffer(pdfKey(id));
  if (!pdf) {
    const job = await queue.add('monthly', { accountId, month }, {
      jobId: id,
      removeOnComplete: { age: 60 },
      removeOnFail: { age: 60 },
    });
    try {
      await job.waitUntilFinished(queueEvents, WAIT_MS);
    } catch {
      if (await job.isFailed()) return res.sendStatus(500);
      // Still queued or rendering; the job carries on and the retry will find the PDF in Redis.
      return res.status(503).set('Retry-After', '30').send('Your report is being generated. Try again shortly.');
    }
    pdf = await redis.getBuffer(pdfKey(id));
    if (!pdf) return res.sendStatus(500);
  }

  res.type('application/pdf').send(pdf);
});

```

### src/worker.ts
```
import { Worker } from 'bullmq';
import { renderMonthlyReport } from './reports/render';
import { PDF_TTL_SECONDS, REPORTS_QUEUE, connectRedis, pdfKey, type ReportJob } from './reports/queue';

// Runs as its own process (and its own machines) so the ~400 ms of CPU per report never blocks
// the event loop that serves the API. Rendering is synchronous CPU work, so one job at a time per
// process; scale by adding worker machines.
const redis = connectRedis();

new Worker<ReportJob>(
  REPORTS_QUEUE,
  async (job) => {
    const pdf = await renderMonthlyReport(job.data.accountId, job.data.month);
    await redis.set(pdfKey(job.id!), pdf, 'EX', PDF_TTL_SECONDS);
  },
  { connection: connectRedis({ maxRetriesPerRequest: null }), concurrency: 1 },
);

```
