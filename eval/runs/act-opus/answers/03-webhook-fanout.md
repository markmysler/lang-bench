## Its final message

I've built the webhook service as a new worker, `apps/webhooks`, and wired the API's `emitEvent` to it. As you asked, nothing was installed or run, so none of it has been type-checked or tested yet.

**How it works.** It uses your existing BullMQ, Redis and Prisma setup:
1. **API** (`apps/api/src/events.ts`): `emitEvent` puts one job per event on a queue and returns without waiting for Redis. If Redis is unreachable it fails fast and logs, rather than piling requests up in memory. All HTTP calls to customers happen in the worker, a separate process, so slow customer endpoints can't slow down the API.
2. **Fan-out step** (`src/fanout.ts`): looks up the account's enabled endpoints and creates one delivery job per endpoint.
3. **Delivery step** (`src/deliver.ts`, `src/http.ts`): signs the payload and POSTs it.
   - **Failures:** any non-2xx response, network error or 10 s timeout counts as a failed attempt.
   - **Retries:** 12 attempts spread over about 22 hours, with some randomness so retries don't all hit at once (`src/retry.ts`). Deliveries older than 24 hours are dropped.
4. **Signing** (`src/signing.ts`): the header is `X-Acme-Signature: t=<ts>,v1=<HMAC-SHA256 of "<ts>.<body>">`. Including the timestamp lets receivers reject replayed requests. There's also a `verifySignature` example showing receivers how to check it.

**Things I added that the spec doesn't mention:**
- **Blocking internal targets.** Customers supply the URLs, so without this anyone could point a webhook at your internal network. The worker accepts only https, refuses hosts that resolve to private, loopback, link-local or Fly internal addresses, and doesn't follow redirects. `WEBHOOK_ALLOW_UNSAFE_TARGETS=1` turns this off for local development.
- **A 15 s cache of endpoint lookups.** At peak that's about 3,000 database reads per second otherwise. The catch is that adding, changing or disabling an endpoint takes up to 15 s to apply.

**You'll need to do:**
- **Database model:** your Prisma schema isn't in the repo, so I couldn't add the `WebhookEndpoint` model. It's in `apps/webhooks/README.md`, ready to add to the API's schema.
- **Deployment:** there's no Fly config in the repo either. The worker needs its own process or container with `REDIS_URL` and `DATABASE_URL`.
- **Queue name:** it's written out in both the API and the worker, because I couldn't see how `@acme/shared` is exported. If you rename it, change both places.

**Limitations and risks:**
- **Lost events:** events created while Redis is down are lost (they're logged). If that matters, the fix is to save events to Postgres in the same transaction and enqueue them from there.
- **Dead endpoints:** a permanently dead endpoint keeps a day's worth of pending retries in Redis. Automatically disabling endpoints after repeated failures would be a good next step.
- **Upstash limits and cost:** peak is about 2,500 deliveries per second, and BullMQ uses several Redis commands per job. Check that against Upstash's throughput limits and per-command pricing.
- **Scaling:** at the default of 200 deliveries in flight per process, peak load needs roughly 13 worker processes. I'd scale on queue length and let short spikes drain, rather than sizing for the peak.
- **Not built:** the API routes for customers to register endpoints, and tests.

## Files it changed

M  README.md
M  apps/api/src/events.ts
A  apps/webhooks/README.md
A  apps/webhooks/package.json
A  apps/webhooks/src/config.ts
A  apps/webhooks/src/deliver.ts
A  apps/webhooks/src/endpoints.ts
A  apps/webhooks/src/fanout.ts
A  apps/webhooks/src/http.ts
A  apps/webhooks/src/index.ts
A  apps/webhooks/src/queues.ts
A  apps/webhooks/src/retry.ts
A  apps/webhooks/src/signing.ts
A  apps/webhooks/tsconfig.json

### README.md
```
# Acme Collab

Monorepo for Acme Collab, a project tool for small agencies.

- `apps/web`: Next.js front end, deployed on Vercel.
- `apps/api`: the API, Express + Prisma on Postgres (managed), deployed on Fly.io in containers.
- `apps/webhooks`: worker that sends product events to customers' webhook URLs (BullMQ), deployed
  as its own process next to the API.
- `packages/shared`: types shared by both.

Four developers, all TypeScript. Redis (Upstash) is used for queues with BullMQ.

```

### apps/api/src/events.ts
```
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { DomainEvent } from '@acme/shared';

// Must match WEBHOOK_EVENTS_QUEUE in apps/webhooks/src/queues.ts. Delivery happens in that worker,
// never in the API process.
const WEBHOOK_EVENTS_QUEUE = 'webhook-events';

// enableOfflineQueue: false makes enqueueing fail fast while Redis is unreachable, instead of
// piling up commands in memory.
const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});
connection.on('error', (err) => console.error('[webhooks] redis error', err.message));

const webhookEvents = new Queue<DomainEvent>(WEBHOOK_EVENTS_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 10_000 },
    removeOnFail: { age: 3 * 24 * 3600 },
  },
});

/**
 * Called whenever something happens in the product (task created, comment added, ...).
 * Hands the event to the webhook worker without making the caller wait on Redis: a slow or
 * unavailable Redis must never slow down an API request. Trade-off: events emitted while Redis is
 * down are lost (logged).
 */
export async function emitEvent(event: DomainEvent): Promise<void> {
  // "evt_" prefix: BullMQ rejects custom job IDs that look like integers.
  webhookEvents.add(event.type, event, { jobId: `evt_${event.id}` }).catch((err: Error) => {
    console.error('[webhooks] failed to enqueue event', { eventId: event.id, error: err.message });
  });
}

```

### apps/webhooks/README.md
```
# @acme/webhooks

Worker that sends product events to customers' webhook URLs. Requirements are in
[`docs/webhooks.md`](../../docs/webhooks.md).

## How it works

```
API emitEvent() ──► [webhook-events] ──► fan-out worker ──► [webhook-deliveries] ──► delivery worker ──► customer URL
   (no await)        1 job per event     reads endpoints      1 job per endpoint     signs, POSTs, retries
```

- **The API is never blocked.** `emitEvent` adds one job to Redis without waiting for it. All HTTP
  calls happen here, in a separate process.
- **Retries:** 12 attempts, waiting 10 s, 30 s, 2 m, 5 m, 15 m, 30 m, 1 h, 2 h, 4 h, 6 h, 8 h between
  them, each shortened by up to 20 % at random (`src/retry.ts`). Any non-2xx response, timeout
  (10 s), or network error counts as a failure. Deliveries older than 24 h are abandoned.
- **Signature:** `X-Acme-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.
  Also sent: `X-Acme-Event-Id` (use it to ignore duplicates), `X-Acme-Event-Type`, and
  `X-Acme-Delivery-Attempt`. `verifySignature` in `src/signing.ts` shows how receivers should check it.
- **SSRF protection:** https only. Hosts that resolve to private, loopback, link-local, or Fly 6PN
  addresses are refused; the check runs at connect time. Redirects are not followed.
  `WEBHOOK_ALLOW_UNSAFE_TARGETS=1` turns this off for local development.
- **Delivery guarantee:** at least once. Receivers may get the same event more than once.

## Prisma model to add

The Prisma schema isn't in this repo, so add this model to the API's schema (plus a relation to
`Account` if you have one):

```prisma
model WebhookEndpoint {
  id        String   @id @default(cuid())
  accountId String
  url       String
  secret    String
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())

  @@index([accountId])
}
```

The worker uses the same generated `@prisma/client`, so run `prisma generate` against the API's
schema before building it.

## Configuration

| Variable                         | Default | Meaning                                           |
| -------------------------------- | ------- | ------------------------------------------------- |
| `REDIS_URL`                      | –       | Same Redis as the API                             |
| `DATABASE_URL`                   | –       | Same Postgres as the API (read by Prisma)         |
| `WEBHOOK_DELIVERY_CONCURRENCY`   | 200     | Deliveries in flight per process                  |
| `WEBHOOK_FANOUT_CONCURRENCY`     | 20      | Events fanned out in parallel per process         |
| `WEBHOOK_REQUEST_TIMEOUT_MS`     | 10000   | Max time per attempt                              |
| `WEBHOOK_ENDPOINT_CACHE_TTL_MS`  | 15000   | How long endpoint changes take to apply           |
| `WEBHOOK_ALLOW_UNSAFE_TARGETS`   | unset   | `1` = allow http/private targets (dev only)       |

## Capacity

Peak: 500 events/s × up to 5 endpoints = up to **2,500 deliveries/s**. At about 1 s per response,
that's ~2,500 requests open at once, or ~13 processes at the default concurrency of 200. Average
load (40 events/s) needs one or two. Scale on queue depth instead of sizing for the peak: short
spikes just queue up and drain afterwards.

```

### apps/webhooks/package.json
```
{
  "name": "@acme/webhooks",
  "private": true,
  "scripts": { "dev": "tsx watch src/index.ts", "build": "tsc", "start": "node dist/index.js" },
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "bullmq": "^5.25.0",
    "ioredis": "^5.4.1"
  },
  "devDependencies": { "tsx": "^4.19.2", "@types/node": "^22.9.0" }
}

```

### apps/webhooks/src/config.ts
```
function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const config = {
  redisUrl: required('REDIS_URL'),
  /** Deliveries in flight per process. Work is I/O-bound (waiting on customer endpoints), so this can be high. */
  deliveryConcurrency: int('WEBHOOK_DELIVERY_CONCURRENCY', 200),
  fanoutConcurrency: int('WEBHOOK_FANOUT_CONCURRENCY', 20),
  /** Customer endpoints usually answer in 0.3–2 s; anything slower than this counts as a failed attempt. */
  requestTimeoutMs: int('WEBHOOK_REQUEST_TIMEOUT_MS', 10_000),
  endpointCacheTtlMs: int('WEBHOOK_ENDPOINT_CACHE_TTL_MS', 15_000),
  /** Dev only: allow http:// and private/loopback targets (e.g. a local test receiver). */
  allowUnsafeTargets: process.env.WEBHOOK_ALLOW_UNSAFE_TARGETS === '1',
};

export type Config = typeof config;

```

### apps/webhooks/src/deliver.ts
```
import { UnrecoverableError, type Job } from 'bullmq';
import type { Config } from './config';
import type { EndpointStore } from './endpoints';
import { BlockedDestinationError, postWebhook } from './http';
import type { DeliveryJob } from './queues';
import { MAX_DELIVERY_AGE_MS } from './retry';
import { SIGNATURE_HEADER, signPayload } from './signing';

export class DeliveryFailedError extends Error {
  constructor(public status: number) {
    super(`Endpoint responded with HTTP ${status}`);
    this.name = 'DeliveryFailedError';
  }
}

/**
 * Makes one delivery attempt. Throwing tells BullMQ the attempt failed: a plain Error gets retried
 * on the backoff schedule, an UnrecoverableError fails the job right away.
 */
export function createDeliveryProcessor(endpoints: EndpointStore, config: Config) {
  return async (job: Job<DeliveryJob>): Promise<void> => {
    const { eventId, eventType, endpointId, body } = job.data;

    if (Date.now() - job.timestamp > MAX_DELIVERY_AGE_MS) {
      throw new UnrecoverableError('Gave up: delivery is older than 24 h');
    }

    const endpoint = await endpoints.get(endpointId);
    if (!endpoint || !endpoint.enabled) return; // Removed or disabled since the event: nothing to deliver.

    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const { status } = await postWebhook(endpoint.url, body, {
        timeoutMs: config.requestTimeoutMs,
        allowUnsafeTargets: config.allowUnsafeTargets,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Acme-Webhooks/1.0',
          'X-Acme-Event-Id': eventId,
          'X-Acme-Event-Type': eventType,
          'X-Acme-Delivery-Attempt': String(job.attemptsMade + 1),
          [SIGNATURE_HEADER]: signPayload(endpoint.secret, body, timestamp),
        },
      });
      if (status < 200 || status >= 300) throw new DeliveryFailedError(status);
    } catch (err) {
      if (err instanceof BlockedDestinationError) throw new UnrecoverableError(err.message);
      throw err;
    }
  };
}

```

### apps/webhooks/src/endpoints.ts
```
import type { PrismaClient } from '@prisma/client';

export interface WebhookEndpoint {
  id: string;
  accountId: string;
  url: string;
  secret: string;
  enabled: boolean;
}

const select = { id: true, accountId: true, url: true, secret: true, enabled: true } as const;

class TtlCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(private ttlMs: number) {}

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await load();
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }
}

/**
 * Reads endpoints from Postgres with a short in-process cache. At peak the workers would otherwise
 * run ~500 account lookups/s (fan-out) plus ~2,500 endpoint lookups/s (one per delivery attempt).
 * Trade-off: an endpoint that was just added, changed, or disabled takes up to the TTL to take effect.
 */
export class EndpointStore {
  private byAccount: TtlCache<WebhookEndpoint[]>;
  private byId: TtlCache<WebhookEndpoint | null>;

  constructor(
    private prisma: PrismaClient,
    ttlMs: number,
  ) {
    this.byAccount = new TtlCache(ttlMs);
    this.byId = new TtlCache(ttlMs);
  }

  listEnabled(accountId: string): Promise<WebhookEndpoint[]> {
    return this.byAccount.get(accountId, () =>
      this.prisma.webhookEndpoint.findMany({ where: { accountId, enabled: true }, select }),
    );
  }

  /** Looked up on every attempt so deleted/disabled endpoints stop receiving retries and secret rotation applies. */
  get(id: string): Promise<WebhookEndpoint | null> {
    return this.byId.get(id, () => this.prisma.webhookEndpoint.findUnique({ where: { id }, select }));
  }
}

```

### apps/webhooks/src/fanout.ts
```
import type { Job, Queue } from 'bullmq';
import type { DomainEvent } from '@acme/shared';
import type { EndpointStore } from './endpoints';
import type { DeliveryJob } from './queues';

/** Turns one product event into one delivery job per enabled endpoint of the account. */
export function createFanoutProcessor(deliveries: Queue<DeliveryJob>, endpoints: EndpointStore) {
  return async (job: Job<DomainEvent>): Promise<void> => {
    const event = job.data;
    const targets = await endpoints.listEnabled(event.accountId);
    if (targets.length === 0) return;

    const body = JSON.stringify(event);
    // Deterministic job IDs: if this fan-out job is retried after a partial failure, BullMQ skips
    // deliveries that are still queued. Ones that already completed were removed and may be sent
    // again; that's acceptable because delivery is at-least-once anyway.
    await deliveries.addBulk(
      targets.map((endpoint) => ({
        name: event.type,
        data: { eventId: event.id, eventType: event.type, endpointId: endpoint.id, body },
        opts: { jobId: `${event.id}_${endpoint.id}` },
      })),
    );
  };
}

```

### apps/webhooks/src/http.ts
```
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Customer-supplied URLs must not be able to reach our own infrastructure (Fly 6PN private network,
 * loopback, cloud metadata, ...). The check happens inside the socket's DNS lookup, so the address we
 * validate is the address we connect to (no DNS-rebinding window).
 */
const blockedRanges = new net.BlockList();
for (const [prefix, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedRanges.addSubnet(prefix, bits, 'ipv4');
}
for (const [prefix, bits] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64
  ['fc00::', 7], // unique local, includes Fly's fdaa::/16
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedRanges.addSubnet(prefix, bits, 'ipv6');
}

export class BlockedDestinationError extends Error {
  constructor(reason: string) {
    super(`Blocked webhook destination: ${reason}`);
    this.name = 'BlockedDestinationError';
  }
}

export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`No response within ${timeoutMs} ms`);
    this.name = 'RequestTimeoutError';
  }
}

export function isBlockedAddress(address: string, family: number | string): boolean {
  return blockedRanges.check(address, family === 6 || family === 'IPv6' ? 'ipv6' : 'ipv4');
}

const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const allowed = addresses.filter((a) => !isBlockedAddress(a.address, a.family));
    if (allowed.length === 0) return callback(new BlockedDestinationError(`${hostname} resolves to a private address`), '');
    if (options.all) return callback(null, allowed);
    callback(null, allowed[0].address, allowed[0].family);
  });
};

const agents = {
  'http:': new http.Agent({ keepAlive: true }),
  'https:': new https.Agent({ keepAlive: true }),
};

export interface PostOptions {
  headers: Record<string, string>;
  timeoutMs: number;
  allowUnsafeTargets: boolean;
}

/**
 * POSTs `body` and resolves with the status code as soon as response headers arrive; the response
 * body is discarded. Redirects are not followed (a 3xx counts as a failed attempt). The timeout
 * covers the whole exchange, including DNS, connect, and TLS.
 */
export async function postWebhook(rawUrl: string, body: string, options: PostOptions): Promise<{ status: number }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedDestinationError('invalid URL');
  }

  if (!options.allowUnsafeTargets) {
    if (url.protocol !== 'https:') throw new BlockedDestinationError('only https:// URLs are allowed');
    // IP literals skip DNS lookup entirely, so check them here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const family = net.isIP(host);
    if (family !== 0 && isBlockedAddress(host, family)) throw new BlockedDestinationError(`${host} is a private address`);
  } else if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BlockedDestinationError(`unsupported protocol ${url.protocol}`);
  }

  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'POST',
        agent: agents[url.protocol as 'http:' | 'https:'],
        lookup: options.allowUnsafeTargets ? undefined : safeLookup,
        headers: { ...options.headers, 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0 });
      },
    );
    const timer = setTimeout(() => req.destroy(new RequestTimeoutError(options.timeoutMs)), options.timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(body);
  });
}

```

### apps/webhooks/src/index.ts
```
import { PrismaClient } from '@prisma/client';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { DomainEvent } from '@acme/shared';
import { config } from './config';
import { createDeliveryProcessor } from './deliver';
import { EndpointStore } from './endpoints';
import { createFanoutProcessor } from './fanout';
import { WEBHOOK_DELIVERIES_QUEUE, WEBHOOK_EVENTS_QUEUE, type DeliveryJob } from './queues';
import { BACKOFF_TYPE, MAX_ATTEMPTS, webhookBackoff } from './retry';

// Runs as its own process (separate from the API) so slow customer endpoints can never use up
// the API's event loop, sockets, or memory.

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
const prisma = new PrismaClient();
const endpoints = new EndpointStore(prisma, config.endpointCacheTtlMs);

const deliveryQueue = new Queue<DeliveryJob>(WEBHOOK_DELIVERIES_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: MAX_ATTEMPTS,
    backoff: { type: BACKOFF_TYPE },
    // Peak is ~2,500 deliveries/s, so completed jobs are dropped right away to keep Redis small.
    removeOnComplete: true,
    // Keep failures around for a few days so support can look into them.
    removeOnFail: { age: 3 * 24 * 3600, count: 50_000 },
  },
});

const fanoutWorker = new Worker<DomainEvent>(WEBHOOK_EVENTS_QUEUE, createFanoutProcessor(deliveryQueue, endpoints), {
  connection,
  concurrency: config.fanoutConcurrency,
});

const deliveryWorker = new Worker<DeliveryJob>(WEBHOOK_DELIVERIES_QUEUE, createDeliveryProcessor(endpoints, config), {
  connection,
  concurrency: config.deliveryConcurrency,
  settings: { backoffStrategy: webhookBackoff },
});

fanoutWorker.on('failed', (job, err) => {
  console.error('[webhooks] fan-out failed', { eventId: job?.data.id, attempt: job?.attemptsMade, error: err.message });
});

deliveryWorker.on('failed', (job, err) => {
  if (!job) return;
  const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
  if (!final) return;
  console.warn('[webhooks] delivery abandoned', {
    eventId: job.data.eventId,
    endpointId: job.data.endpointId,
    attempts: job.attemptsMade,
    error: err.message,
  });
});

for (const worker of [fanoutWorker, deliveryWorker]) {
  worker.on('error', (err) => console.error('[webhooks] worker error', err));
}

async function shutdown(signal: string) {
  console.log(`[webhooks] ${signal} received, finishing in-flight deliveries`);
  // close() waits for active jobs; anything not picked up yet stays in Redis for the next process.
  await Promise.all([fanoutWorker.close(), deliveryWorker.close()]);
  await deliveryQueue.close();
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

```

### apps/webhooks/src/queues.ts
```
import type { DomainEvent } from '@acme/shared';

/** One job per product event, enqueued by the API (apps/api/src/events.ts). Job data: DomainEvent. */
export const WEBHOOK_EVENTS_QUEUE = 'webhook-events';

/** One job per (event, endpoint) pair, enqueued by the fan-out worker. */
export const WEBHOOK_DELIVERIES_QUEUE = 'webhook-deliveries';

export interface DeliveryJob {
  eventId: string;
  eventType: DomainEvent['type'];
  endpointId: string;
  /** Serialized once at fan-out so every attempt sends (and signs) the exact same bytes. */
  body: string;
}

```

### apps/webhooks/src/retry.ts
```
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Wait before retry N (1-based). Adds up to ~22 h, so the last attempt happens just under a day after the first. */
export const RETRY_DELAYS_MS = [
  10 * SECOND,
  30 * SECOND,
  2 * MINUTE,
  5 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  1 * HOUR,
  2 * HOUR,
  4 * HOUR,
  6 * HOUR,
  8 * HOUR,
];

/** First attempt + one per retry delay. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** Hard cut-off, measured from when the delivery job was created. */
export const MAX_DELIVERY_AGE_MS = 24 * HOUR;

export const BACKOFF_TYPE = 'webhook';

/**
 * BullMQ custom backoff strategy. `attemptsMade` is 1 after the first failure.
 * Jitter only shortens the delay (80–100 %), so the schedule never exceeds its nominal total and
 * retries for many deliveries that failed together (e.g. one endpoint went down) are spread out.
 */
export function webhookBackoff(attemptsMade: number): number {
  const index = Math.min(Math.max(attemptsMade, 1), RETRY_DELAYS_MS.length) - 1;
  return Math.round(RETRY_DELAYS_MS[index] * (0.8 + Math.random() * 0.2));
}

```

### apps/webhooks/src/signing.ts
```
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'X-Acme-Signature';

/**
 * Header value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 * Signing the timestamp along with the body lets receivers reject replayed requests.
 */
export function signPayload(secret: string, body: string, timestamp: number): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

/** Reference implementation of what receivers should do; also handy for tests. */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=', 2) as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return false;
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const expected = Buffer.from(signPayload(secret, body, timestamp).split('v1=')[1], 'hex');
  const actual = Buffer.from(parts.v1, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

```

### apps/webhooks/tsconfig.json
```
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}

```
