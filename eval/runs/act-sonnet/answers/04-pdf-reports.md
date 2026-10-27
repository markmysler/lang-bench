## Its final message

I moved report rendering off the API process and into a separate worker. I haven't run or compiled any of it. The repo is a partial snapshot: `src/db` and `src/routes/tasks` are missing, and there's no `fly.toml`.

**Cause:** `GET /reports/:accountId/:month.pdf` rendered the PDF inside the API process. Each report takes about 400 ms of CPU, and 3,000 of them in a few hours starved `/tasks` and every other endpoint.

**Changes:**
- **`src/reports/queue.ts` (new):** a BullMQ queue, with the job id set to `accountId_month`. Repeat downloads of the same report share one job, and a finished PDF is cached in Redis for an hour.
- **`src/reports/worker.ts` (new):** a standalone process that renders reports with `concurrency: 1`. Run it with `node dist/reports/worker.js`.
- **`src/routes/reports.ts`:** the route now enqueues the job and waits up to 25 seconds. It returns the PDF if the job finishes in time and a 500 if it fails. If the job is still running, it returns `202` with `Retry-After: 10`.
- **`package.json`:** added `ioredis`, which the queue needs for its Redis connection.

**Before this ships:**
- **Client change:** clients must handle `202` by retrying the same URL. I couldn't see the client code, so check whether it can do that.
- **Worker deployment:** you need to run the worker as its own Fly process group or machine, and set `REDIS_URL` on both the API and the worker. Without a worker running, every report request will return `202` forever.
- **Cache staleness:** a regenerated report can be up to an hour stale. Month-end data should be stable, but say if you want a shorter window.
- **Unfinished reports:** `/tasks` should stay fast during month end because rendering no longer runs there. Reports will still take a while to finish, since one worker renders them one at a time. Add worker machines if that queue is too slow.

## Files it changed

M  package.json
A  src/reports/queue.ts
A  src/reports/worker.ts
M  src/routes/reports.ts

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
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

export const REPORT_QUEUE = 'monthly-reports';

export function redisConnection() {
  return new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
}

export const reportQueue = new Queue(REPORT_QUEUE, {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: { age: 60 * 60 }, // finished PDFs double as a one-hour cache
    removeOnFail: { age: 60 * 60 },
  },
});
export const reportEvents = new QueueEvents(REPORT_QUEUE, { connection: redisConnection() });

// BullMQ rejects ':' in custom job ids. Same account+month shares one job, so repeat downloads
// and retries don't re-render.
export const reportJobId = (accountId: string, month: string) => `${accountId}_${month}`;

```

### src/reports/worker.ts
```
// Run as its own process (`node dist/reports/worker.js`) so rendering never competes with the
// API's event loop. Scale it separately from the API machines.
import { Worker } from 'bullmq';
import { renderMonthlyReport } from './render';
import { REPORT_QUEUE, redisConnection } from './queue';

new Worker(
  REPORT_QUEUE,
  async (job) => {
    const pdf = await renderMonthlyReport(job.data.accountId, job.data.month);
    return pdf.toString('base64');
  },
  { connection: redisConnection(), concurrency: 1 }, // rendering is CPU-bound: one per core
);

```

### src/routes/reports.ts
```
import { Router } from 'express';
import { reportEvents, reportJobId, reportQueue } from '../reports/queue';

export const reports = Router();

const WAIT_MS = 25_000;

// Customers download their monthly report as a PDF with charts. Rendering happens in the worker
// process; if it isn't done within WAIT_MS we answer 202 and the client retries the same URL.
reports.get('/:accountId/:month.pdf', async (req, res) => {
  const { accountId, month } = req.params;
  const job = await reportQueue.add('render', { accountId, month }, { jobId: reportJobId(accountId, month) });
  try {
    const pdf: string = await job.waitUntilFinished(reportEvents, WAIT_MS);
    res.type('application/pdf').send(Buffer.from(pdf, 'base64'));
  } catch {
    if ((await job.getState()) === 'failed') {
      await job.remove();
      res.status(500).json({ error: 'report generation failed' });
      return;
    }
    res.status(202).set('Retry-After', '10').json({ status: 'rendering' });
  }
});

```
