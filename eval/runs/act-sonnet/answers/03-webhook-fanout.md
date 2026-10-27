## Its final message

I've written the delivery pipeline under `apps/api/src/webhooks/`. Nothing has been installed, compiled or run, so none of it is type-checked yet.

**How it works**
- **Enqueue:** `emitEvent` in `apps/api/src/events.ts` now calls `enqueueEvent`. That is a single BullMQ add to Redis with the event id as the job id, so re-emitting is idempotent. It never throws and the call isn't awaited, so Redis problems can't slow or break the API.
- **Worker process:** `worker.ts` runs as its own process (`npm run worker -w @acme/api`), so slow customer endpoints can't take CPU or event-loop time from the API. It should get its own Fly process group.
- **Fan-out:** a worker loads the account's enabled endpoints (1–5) and queues one delivery job per endpoint. The job id is `eventId__endpointId`, so a retried fan-out doesn't create duplicates.
- **Delivery:**
  - Each job reloads the endpoint, so a deleted or disabled endpoint is skipped.
  - It POSTs the JSON event with a 10 s timeout and no redirect following, and any non-2xx response or timeout counts as a failure.
  - Retries use exponential backoff from 10 s up to 1 h, with jitter.
  - Retries stop and the job fails once the event is more than 24 h old.
- **Signing:** the `x-acme-signature` header is `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">` using the per-endpoint secret. The timestamp is included so receivers can reject replays. `x-acme-event-id` and `x-acme-event-type` headers are sent too.

**Things to know**
- **Capacity:** peak is about 2,500 deliveries per second at 300 ms to 2 s each, so thousands are in flight at once. Each worker runs 200 concurrently (`WEBHOOK_DELIVERY_CONCURRENCY`). You'll need several worker instances for peaks.
- **Upstash cost:** BullMQ makes several Redis commands per job. At this volume that is a real cost on Upstash's per-command pricing, so check it.
- **Prisma model:** the repo has no Prisma schema, so the `WebhookEndpoint` model is in a comment at the top of `store.ts`. Add it to your schema and run a migration.
- **Not built yet:**
  - Endpoint registration routes and secret generation.
  - URL validation on registration, which should require https and block private or internal addresses to prevent SSRF.
  - Auto-disabling endpoints that keep failing.
  - Delivery-attempt history for customers.
  - Tests.
- **Build config:** there's no `tsconfig.json`, and `apps/api/src/index.ts` imports routes that don't exist. `npm run build` and `npm run worker` expect a `dist/` build that can't be produced yet.

I also added `worker` and `worker:dev` scripts to `apps/api/package.json`.

## Files it changed

M  apps/api/package.json
M  apps/api/src/events.ts
A  apps/api/src/webhooks/config.ts
A  apps/api/src/webhooks/deliver.ts
A  apps/api/src/webhooks/enqueue.ts
A  apps/api/src/webhooks/queues.ts
A  apps/api/src/webhooks/signing.ts
A  apps/api/src/webhooks/store.ts
A  apps/api/src/webhooks/worker.ts

### apps/api/package.json
```
{
  "name": "@acme/api",
  "private": true,
  "scripts": { "dev": "tsx watch src/index.ts", "build": "tsc", "start": "node dist/index.js", "worker": "node dist/webhooks/worker.js", "worker:dev": "tsx watch src/webhooks/worker.ts" },
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "bullmq": "^5.25.0",
    "express": "^4.21.1",
    "ioredis": "^5.4.1",
    "zod": "^3.23.8"
  },
  "devDependencies": { "prisma": "^5.22.0", "tsx": "^4.19.2", "@types/express": "^5.0.0" }
}

```

### apps/api/src/events.ts
```
import type { DomainEvent } from '@acme/shared';
import { enqueueEvent } from './webhooks/enqueue';

/**
 * Called whenever something happens in the product (task created, comment added, ...).
 * Queues the event for webhook delivery; the actual HTTP calls run in the worker process.
 */
export async function emitEvent(event: DomainEvent): Promise<void> {
  enqueueEvent(event);
}

```

### apps/api/src/webhooks/config.ts
```
export const FANOUT_QUEUE = 'webhook-fanout';
export const DELIVERY_QUEUE = 'webhook-delivery';

/** Deliveries are abandoned this long after the event was emitted. */
export const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

/** A customer endpoint that hasn't answered by then counts as a failed attempt. */
export const REQUEST_TIMEOUT_MS = 10_000;

const BACKOFF_BASE_MS = 10_000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;

/** Exponential backoff with jitter: ~10s, 20s, 40s, ... capped at 1h. */
export function backoffDelay(attemptsMade: number): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attemptsMade - 1));
  return Math.round(exp * (0.75 + Math.random() * 0.5));
}

// Deliveries are I/O bound (300ms-2s each, up to 5 per event). At the 500 events/s peak that is
// ~2500 deliveries/s, i.e. thousands in flight; scale by running more worker processes.
export const DELIVERY_CONCURRENCY = Number(process.env.WEBHOOK_DELIVERY_CONCURRENCY ?? 200);
export const FANOUT_CONCURRENCY = Number(process.env.WEBHOOK_FANOUT_CONCURRENCY ?? 20);

```

### apps/api/src/webhooks/deliver.ts
```
import { UnrecoverableError, type Job } from 'bullmq';
import type { DomainEvent } from '@acme/shared';
import { GIVE_UP_AFTER_MS, REQUEST_TIMEOUT_MS } from './config';
import { signPayload } from './signing';
import { getEndpoint, listEndpoints } from './store';
import { getDeliveryQueue, type DeliveryJob } from './queues';

/** Fan-out job: one delivery job per enabled endpoint of the event's account. */
export async function fanOut(job: Job<DomainEvent>): Promise<void> {
  const event = job.data;
  const endpoints = await listEndpoints(event.accountId);
  if (endpoints.length === 0) return;
  await getDeliveryQueue().addBulk(
    endpoints.map((endpoint) => ({
      name: event.type,
      data: { endpointId: endpoint.id, event } satisfies DeliveryJob,
      // Dedupes if the fan-out job itself is retried. (BullMQ ids can't contain ':'.)
      opts: { jobId: `${event.id}__${endpoint.id}` },
    })),
  );
}

/** Delivery job: POST the signed event. Throwing triggers a retry with backoff. */
export async function deliver(job: Job<DeliveryJob>): Promise<void> {
  const { endpointId, event } = job.data;

  const endpoint = await getEndpoint(endpointId);
  if (!endpoint || !endpoint.enabled) return; // deleted or disabled since fan-out

  if (Date.now() - Date.parse(event.occurredAt) > GIVE_UP_AFTER_MS) {
    throw new UnrecoverableError('older than 24h');
  }

  const body = JSON.stringify(event);
  const res = await fetch(endpoint.url, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'content-type': 'application/json',
      'user-agent': 'AcmeCollab-Webhooks/1',
      'x-acme-event-id': event.id,
      'x-acme-event-type': event.type,
      'x-acme-signature': signPayload(endpoint.secret, body, Math.floor(Date.now() / 1000)),
    },
    body,
  });
  // Drain so the connection can be reused.
  await res.body?.cancel().catch(() => {});

  if (!res.ok) throw new Error(`endpoint ${endpoint.id} responded ${res.status}`);
}

```

### apps/api/src/webhooks/enqueue.ts
```
import type { DomainEvent } from '@acme/shared';
import { getFanoutQueue } from './queues';

/**
 * Hands an event to the webhook pipeline. This is a single Redis write; endpoint lookup and
 * HTTP calls happen in the worker process. Never throws, so callers in the API are unaffected
 * by Redis problems.
 */
export function enqueueEvent(event: DomainEvent): void {
  // jobId makes re-emitting the same event idempotent.
  getFanoutQueue()
    .add(event.type, event, { jobId: event.id })
    .catch((err) => console.error('webhooks: failed to enqueue event', event.id, err));
}

```

### apps/api/src/webhooks/queues.ts
```
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { DomainEvent } from '@acme/shared';
import { DELIVERY_QUEUE, FANOUT_QUEUE } from './config';

export interface DeliveryJob {
  endpointId: string;
  event: DomainEvent;
}

// BullMQ workers require maxRetriesPerRequest: null.
export function createRedis(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
}

let connection: IORedis | undefined;
let fanoutQueue: Queue<DomainEvent> | undefined;
let deliveryQueue: Queue<DeliveryJob> | undefined;

function redis(): IORedis {
  return (connection ??= createRedis());
}

export function getFanoutQueue(): Queue<DomainEvent> {
  return (fanoutQueue ??= new Queue<DomainEvent>(FANOUT_QUEUE, {
    connection: redis(),
    defaultJobOptions: { removeOnComplete: true, removeOnFail: 1000, attempts: 5, backoff: { type: 'exponential', delay: 1000 } },
  }));
}

export function getDeliveryQueue(): Queue<DeliveryJob> {
  return (deliveryQueue ??= new Queue<DeliveryJob>(DELIVERY_QUEUE, {
    connection: redis(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 5000,
      // Effectively unbounded: the 24h age limit in the backoff strategy is what ends retries.
      attempts: 1000,
      backoff: { type: 'custom' },
    },
  }));
}

```

### apps/api/src/webhooks/signing.ts
```
import { createHmac } from 'node:crypto';

/**
 * Signature header value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 * Including the timestamp lets receivers reject replays.
 */
export function signPayload(secret: string, body: string, timestampSec: number): string {
  const mac = createHmac('sha256', secret).update(`${timestampSec}.${body}`).digest('hex');
  return `t=${timestampSec},v1=${mac}`;
}

```

### apps/api/src/webhooks/store.ts
```
import { PrismaClient } from '@prisma/client';

export interface WebhookEndpoint {
  id: string;
  accountId: string;
  url: string;
  secret: string;
  enabled: boolean;
}

/*
 * Requires this model in the Prisma schema (1-5 rows per account):
 *
 * model WebhookEndpoint {
 *   id        String   @id @default(cuid())
 *   accountId String
 *   url       String
 *   secret    String
 *   enabled   Boolean  @default(true)
 *   createdAt DateTime @default(now())
 *   @@index([accountId])
 * }
 */
const prisma = new PrismaClient();

export function listEndpoints(accountId: string): Promise<WebhookEndpoint[]> {
  return prisma.webhookEndpoint.findMany({ where: { accountId, enabled: true } });
}

export function getEndpoint(id: string): Promise<WebhookEndpoint | null> {
  return prisma.webhookEndpoint.findUnique({ where: { id } });
}

```

### apps/api/src/webhooks/worker.ts
```
/**
 * Separate process (own Fly.io process group) so slow customer endpoints can never
 * take CPU, memory or event-loop time from the API. Run: `npm run worker -w @acme/api`.
 */
import { Worker } from 'bullmq';
import {
  DELIVERY_CONCURRENCY,
  DELIVERY_QUEUE,
  FANOUT_CONCURRENCY,
  FANOUT_QUEUE,
  GIVE_UP_AFTER_MS,
  backoffDelay,
} from './config';
import { deliver, fanOut } from './deliver';
import { createRedis } from './queues';

const connection = createRedis();

const fanout = new Worker(FANOUT_QUEUE, fanOut, { connection, concurrency: FANOUT_CONCURRENCY });

const delivery = new Worker(DELIVERY_QUEUE, deliver, {
  connection,
  concurrency: DELIVERY_CONCURRENCY,
  settings: {
    // Returning -1 moves the job to failed with no further retries.
    backoffStrategy: (attemptsMade, _type, _err, job) =>
      job && Date.now() - job.timestamp > GIVE_UP_AFTER_MS ? -1 : backoffDelay(attemptsMade),
  },
});

for (const w of [fanout, delivery]) {
  w.on('failed', (job, err) => {
    console.warn(`webhooks: ${w.name} job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`);
  });
  w.on('error', (err) => console.error(`webhooks: ${w.name} worker error`, err));
}

async function shutdown(): Promise<void> {
  await Promise.all([fanout.close(), delivery.close()]);
  connection.disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

```
