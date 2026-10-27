## Its final message

The webhook delivery service is written, but nothing has been compiled or run, as you asked. The tests exist but have not been executed.

**Design**

- **Enqueue on the request path, deliver elsewhere.** `emitEvent` now only enqueues a BullMQ job. Fan-out to endpoints and the HTTP calls happen in a separate worker process (`apps/api/src/webhook-worker.ts`), so customer latency cannot touch the API. A failed enqueue is logged and does not fail the caller.
- **Two job types on one `webhooks` queue.** A `fanout` job loads the account's enabled endpoints and adds one `deliver` job per endpoint. Job IDs are derived from event and endpoint IDs, so re-emitting an event does not double-deliver.
- **Secrets stay out of Redis.** Delivery jobs carry only the event and endpoint ID. The worker reads the signing secret at delivery time.
- **Signing.** `X-Acme-Signature: t=<unix>,v1=<HMAC-SHA256 of "t.body">`. The timestamp is signed, so captured requests cannot be replayed. The `verifySignature` function is the reference for customers and is covered by the tests.
- **Attempts.** Only a 2xx counts as delivered. Redirects are not followed, so a signed body never goes to an unregistered host. Each attempt has a 5 s timeout (configurable).
- **Retries.** Exponential backoff from 10 s, capped at 1 h, with ±20% jitter. Delivery is abandoned 24 h after the job was enqueued.

**Files**

- New: `apps/api/src/webhooks/` (config, sign, retry, deliver, queue, processor, worker, store, redis, and a test file), `apps/api/src/webhook-worker.ts`, `apps/api/tsconfig.json`, `packages/shared/{package.json,tsconfig.json,src/index.ts}`.
- Modified: `apps/api/src/events.ts`, `apps/api/package.json` (scripts `start:worker`, `dev:worker`, `test`; `@acme/shared` and `@types/node` added).

**Choices you may want to change**

- Concurrency defaults to 200 per worker process (`WEBHOOK_CONCURRENCY`). At about 1 s per delivery, one process does roughly 200 deliveries/s. Peak is about 500 events/s times 1 to 5 endpoints, so you will likely scale worker processes horizontally.
- Any non-2xx response is retried, including 4xx. I did not special-case 410 or 401.
- Per-endpoint rate limiting and ordering guarantees are not implemented.

**Gaps you should know about**

- **The endpoint store is a stub.** `createEndpointStore()` throws because the repo has no Prisma schema or `WebhookEndpoint` model. The worker will not start until that is implemented.
- **Existing issues I did not touch.** `apps/api/src/index.ts` imports `./routes/projects` and `./routes/tasks`, which are not in the repo, so `tsc` will fail on it. `packages/shared/src/events.ts` was not exported before, and I added an index to make `@acme/shared` resolvable. Nothing in the repo runs `packages/shared`'s build yet, so the API's `tsc` also needs that build to run first.
- **No deployment config.** Fly.io process groups for the worker still need to be set up.

Nothing is committed. Verification once dependencies are installed: `npm run build` in `packages/shared` and `apps/api`, then `npm test` in `apps/api`. The `build` step is expected to fail until the missing route files exist.

## Files it changed

M  apps/api/package.json
M  apps/api/src/events.ts
A  apps/api/src/webhook-worker.ts
A  apps/api/src/webhooks/config.ts
A  apps/api/src/webhooks/deliver.ts
A  apps/api/src/webhooks/processor.ts
A  apps/api/src/webhooks/queue.ts
A  apps/api/src/webhooks/redis.ts
A  apps/api/src/webhooks/retry.ts
A  apps/api/src/webhooks/sign.ts
A  apps/api/src/webhooks/store.ts
A  apps/api/src/webhooks/webhooks.test.ts
A  apps/api/src/webhooks/worker.ts
A  apps/api/tsconfig.json
A  packages/shared/package.json
A  packages/shared/src/index.ts
A  packages/shared/tsconfig.json

### apps/api/package.json
```
{
  "name": "@acme/api",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "dev:worker": "tsx watch src/webhook-worker.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "start:worker": "node dist/webhook-worker.js",
    "test": "node --import tsx --test src/webhooks/*.test.ts"
  },
  "dependencies": {
    "@acme/shared": "*",
    "@prisma/client": "^5.22.0",
    "bullmq": "^5.25.0",
    "express": "^4.21.1",
    "ioredis": "^5.4.1",
    "zod": "^3.23.8"
  },
  "devDependencies": { "prisma": "^5.22.0", "tsx": "^4.19.2", "@types/express": "^5.0.0", "@types/node": "^22.0.0" }
}

```

### apps/api/src/events.ts
```
import type { DomainEvent } from '@acme/shared';
import { enqueueEvent } from './webhooks/queue';

/**
 * Called whenever something happens in the product (task created, comment added, ...).
 * Only enqueues: fan-out and delivery happen in the webhook worker. A failed enqueue is logged
 * and never fails the caller's request.
 */
export async function emitEvent(event: DomainEvent): Promise<void> {
  try {
    await enqueueEvent(event);
  } catch (err) {
    console.error(`failed to enqueue webhook event ${event.id}`, err);
  }
}

```

### apps/api/src/webhook-worker.ts
```
// Separate process from the API, so deliveries cannot take CPU or event-loop time from requests.
import { createEndpointStore } from './webhooks/store';
import { createWebhookWorker } from './webhooks/worker';

const worker = createWebhookWorker(createEndpointStore());

async function shutdown(): Promise<void> {
  await worker.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

```

### apps/api/src/webhooks/config.ts
```
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export const webhookConfig = {
  queueName: 'webhooks',
  /** Deliveries in flight per worker process. */
  concurrency: intEnv('WEBHOOK_CONCURRENCY', 200),
  /** Per-attempt HTTP timeout. Customer endpoints answer in 300 ms to 2 s, and some never do. */
  requestTimeoutMs: intEnv('WEBHOOK_REQUEST_TIMEOUT_MS', 5_000),
  /** A delivery is abandoned this long after it was first enqueued. */
  giveUpAfterMs: 24 * 60 * 60 * 1000,
  retryBaseMs: 10_000,
  retryMaxMs: 60 * 60 * 1000,
  /** Safety net only; the time limit above is what actually ends retries. */
  maxAttempts: 100,
};

```

### apps/api/src/webhooks/deliver.ts
```
export type AttemptResult =
  | { ok: true; status: number }
  | { ok: false; status?: number; reason: string };

/**
 * One HTTP attempt. Only a 2xx response counts as delivered. Redirects are not followed, so a
 * signed body is never sent to a host the customer did not register.
 */
export async function postOnce(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<AttemptResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel().catch(() => {});
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

```

### apps/api/src/webhooks/processor.ts
```
import { UnrecoverableError, type Job } from 'bullmq';
import { webhookConfig } from './config';
import { postOnce } from './deliver';
import { DELIVER, FANOUT, getWebhookQueue, type DeliverJob, type FanOutJob } from './queue';
import { isExpired } from './retry';
import { SIGNATURE_HEADER, signPayload } from './sign';
import type { EndpointStore } from './store';

export async function processWebhookJob(job: Job, store: EndpointStore): Promise<void> {
  switch (job.name) {
    case FANOUT:
      return fanOut(job as Job<FanOutJob>, store);
    case DELIVER:
      return deliver(job as Job<DeliverJob>, store);
    default:
      throw new UnrecoverableError(`unknown webhook job "${job.name}"`);
  }
}

async function fanOut(job: Job<FanOutJob>, store: EndpointStore): Promise<void> {
  const { event } = job.data;
  const endpoints = await store.listEnabledEndpoints(event.accountId);
  await getWebhookQueue().addBulk(
    endpoints.map((endpoint) => ({
      name: DELIVER,
      data: { event, endpointId: endpoint.id } satisfies DeliverJob,
      opts: { jobId: `deliver-${event.id}-${endpoint.id}` },
    })),
  );
}

async function deliver(job: Job<DeliverJob>, store: EndpointStore): Promise<void> {
  const { event, endpointId } = job.data;
  if (isExpired(job.timestamp)) {
    console.warn(`webhook ${event.id} to ${endpointId}: gave up after 24h, not attempted`);
    return;
  }

  const endpoint = await store.findEnabledEndpoint(event.accountId, endpointId);
  if (!endpoint) return;

  // Serialized once, so the signed bytes are exactly the bytes sent.
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const result = await postOnce(
    endpoint.url,
    body,
    {
      'content-type': 'application/json',
      'x-acme-event-id': event.id,
      'x-acme-event-type': event.type,
      [SIGNATURE_HEADER]: signPayload(endpoint.secret, body, timestamp),
    },
    webhookConfig.requestTimeoutMs,
  );
  if (result.ok) return;

  if (isExpired(job.timestamp)) {
    console.warn(`webhook ${event.id} to ${endpointId}: gave up after 24h (${result.reason})`);
    return;
  }
  // Throwing lets BullMQ schedule the next attempt using the backoff strategy.
  throw new Error(`webhook ${event.id} to ${endpointId} failed: ${result.reason}`);
}

```

### apps/api/src/webhooks/queue.ts
```
import { Queue } from 'bullmq';
import type { DomainEvent } from '@acme/shared';
import { webhookConfig } from './config';
import { createRedisConnection } from './redis';

export const FANOUT = 'fanout';
export const DELIVER = 'deliver';

/** Fan-out: expand one event into one delivery job per enabled endpoint of its account. */
export interface FanOutJob {
  event: DomainEvent;
}

/** Delivery: send one event to one endpoint. The secret is looked up by the worker, not stored here. */
export interface DeliverJob {
  event: DomainEvent;
  endpointId: string;
}

let queue: Queue | undefined;

export function getWebhookQueue(): Queue {
  queue ??= new Queue(webhookConfig.queueName, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: webhookConfig.maxAttempts,
      backoff: { type: 'webhook' },
      removeOnComplete: { age: 60 * 60 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    },
  });
  return queue;
}

/** Enqueue only. The API never waits on customer endpoints or on the endpoint lookup. */
export async function enqueueEvent(event: DomainEvent): Promise<void> {
  // Deduplicated on event id, so re-emitting the same event does not fan out twice.
  await getWebhookQueue().add(FANOUT, { event } satisfies FanOutJob, { jobId: `fanout-${event.id}` });
}

```

### apps/api/src/webhooks/redis.ts
```
import IORedis from 'ioredis';

/** BullMQ workers need maxRetriesPerRequest: null, because their blocking commands must not time out. */
export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  return new IORedis(url, { maxRetriesPerRequest: null });
}

```

### apps/api/src/webhooks/retry.ts
```
import { webhookConfig } from './config';

/**
 * Delay before retry number `attemptsMade` (1 = first retry). Exponential, capped at
 * retryMaxMs, with ±20% jitter so that a customer outage does not produce synchronized retries.
 */
export function retryDelayMs(attemptsMade: number, random: () => number = Math.random): number {
  const capped = Math.min(webhookConfig.retryMaxMs, webhookConfig.retryBaseMs * 2 ** (attemptsMade - 1));
  return Math.round(capped * (0.8 + random() * 0.4));
}

/** True once a job has been pending for the full give-up window. */
export function isExpired(enqueuedAtMs: number, nowMs: number = Date.now()): boolean {
  return nowMs - enqueuedAtMs >= webhookConfig.giveUpAfterMs;
}

```

### apps/api/src/webhooks/sign.ts
```
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'X-Acme-Signature';

function digest(secret: string, timestampSeconds: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
}

/**
 * Header value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 * The timestamp is inside the signed material, so a captured request cannot be replayed later.
 */
export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  return `t=${timestampSeconds},v1=${digest(secret, timestampSeconds, body)}`;
}

/** Receiver-side check, kept here as the reference implementation for customers and for tests. */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  const fields = new Map(header.split(',').map((part) => part.split('=') as [string, string]));
  const timestamp = Number(fields.get('t'));
  const received = fields.get('v1');
  if (!Number.isFinite(timestamp) || !received) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = Buffer.from(digest(secret, timestamp, body), 'hex');
  const actual = Buffer.from(received, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

```

### apps/api/src/webhooks/store.ts
```
export interface WebhookEndpoint {
  id: string;
  url: string;
  /** Per-endpoint signing secret. Read at delivery time; never placed in a queued job. */
  secret: string;
}

export interface EndpointStore {
  /** Enabled endpoints for the account. Accounts have 1 to 5 of them. */
  listEnabledEndpoints(accountId: string): Promise<WebhookEndpoint[]>;
  /** Returns null if the endpoint was deleted or disabled after the event was fanned out. */
  findEnabledEndpoint(accountId: string, endpointId: string): Promise<WebhookEndpoint | null>;
}

export function createEndpointStore(): EndpointStore {
  // TODO: implement with Prisma once a WebhookEndpoint model exists in the schema.
  throw new Error('WebhookEndpoint storage is not implemented yet');
}

```

### apps/api/src/webhooks/webhooks.test.ts
```
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { webhookConfig } from './config';
import { postOnce } from './deliver';
import { isExpired, retryDelayMs } from './retry';
import { signPayload, verifySignature } from './sign';

const SECRET = 'whsec_test';
const BODY = JSON.stringify({ id: 'evt_1', type: 'task.created' });

test('signature verifies with the right secret and body', () => {
  const now = 1_700_000_000;
  const header = signPayload(SECRET, BODY, now);
  assert.equal(verifySignature(SECRET, BODY, header, now), true);
});

test('signature rejects a tampered body, a wrong secret, and a stale timestamp', () => {
  const now = 1_700_000_000;
  const header = signPayload(SECRET, BODY, now);
  assert.equal(verifySignature(SECRET, BODY.replace('evt_1', 'evt_2'), header, now), false);
  assert.equal(verifySignature('whsec_other', BODY, header, now), false);
  assert.equal(verifySignature(SECRET, BODY, header, now + 301), false);
});

test('retry delay grows exponentially, stays capped, and is jittered', () => {
  const low = () => 0;
  const high = () => 0.999999;
  assert.equal(retryDelayMs(1, low), Math.round(webhookConfig.retryBaseMs * 0.8));
  assert.ok(retryDelayMs(2, high) > retryDelayMs(1, high));
  const capped = retryDelayMs(50, high);
  assert.ok(capped <= Math.round(webhookConfig.retryMaxMs * 1.2));
  assert.ok(capped >= Math.round(webhookConfig.retryMaxMs * 0.8));
});

test('a delivery is expired only after the 24 hour window', () => {
  const enqueuedAt = 1_000_000;
  const day = 24 * 60 * 60 * 1000;
  assert.equal(isExpired(enqueuedAt, enqueuedAt + day - 1), false);
  assert.equal(isExpired(enqueuedAt, enqueuedAt + day), true);
});

async function withServer(
  handler: Parameters<typeof createServer>[1],
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}/hook`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('postOnce treats 2xx as delivered and sends the body and headers', async () => {
  let received: { body: string; signature?: string } | undefined;
  await withServer(
    (req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received = { body, signature: req.headers['x-acme-signature'] as string | undefined };
        res.writeHead(204).end();
      });
    },
    async (url) => {
      const result = await postOnce(url, BODY, { 'x-acme-signature': 'sig' }, 1000);
      assert.deepEqual(result, { ok: true, status: 204 });
    },
  );
  assert.deepEqual(received, { body: BODY, signature: 'sig' });
});

test('postOnce treats 5xx as a failed attempt', async () => {
  await withServer(
    (_req, res) => res.writeHead(500).end(),
    async (url) => {
      assert.deepEqual(await postOnce(url, BODY, {}, 1000), { ok: false, status: 500, reason: 'HTTP 500' });
    },
  );
});

test('postOnce does not follow redirects', async () => {
  await withServer(
    (_req, res) => res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' }).end(),
    async (url) => {
      const result = await postOnce(url, BODY, {}, 1000);
      assert.deepEqual(result, { ok: false, status: 302, reason: 'HTTP 302' });
    },
  );
});

test('postOnce reports a slow endpoint as a timeout', async () => {
  await withServer(
    () => {
      // Never answers; the client gives up first.
    },
    async (url) => {
      assert.deepEqual(await postOnce(url, BODY, {}, 50), { ok: false, reason: 'timeout' });
    },
  );
});

```

### apps/api/src/webhooks/worker.ts
```
import { Worker } from 'bullmq';
import { webhookConfig } from './config';
import { processWebhookJob } from './processor';
import { createRedisConnection } from './redis';
import { retryDelayMs } from './retry';
import type { EndpointStore } from './store';

export function createWebhookWorker(store: EndpointStore): Worker {
  const worker = new Worker(webhookConfig.queueName, (job) => processWebhookJob(job, store), {
    connection: createRedisConnection(),
    concurrency: webhookConfig.concurrency,
    settings: {
      backoffStrategy: (attemptsMade: number) => retryDelayMs(attemptsMade),
    },
  });
  worker.on('failed', (job, err) => {
    console.error(`webhook job ${job?.id} (${job?.name}) attempt ${job?.attemptsMade} failed: ${err.message}`);
  });
  return worker;
}

```

### apps/api/tsconfig.json
```
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}

```

### packages/shared/package.json
```
{
  "name": "@acme/shared",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc" }
}

```

### packages/shared/src/index.ts
```
export * from './events';

```

### packages/shared/tsconfig.json
```
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}

```
