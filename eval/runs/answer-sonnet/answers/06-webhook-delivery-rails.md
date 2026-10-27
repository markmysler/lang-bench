# Recommendation: fix it in Ruby first, and don't rewrite yet

I haven't seen your metrics, so this is a hypothesis. A few cheap checks below should confirm or kill it within a day or two.

## Why I think this is a concurrency and isolation problem, not a language problem

2M a day is about 23 per second on average. Even if the peak is 10x that, it's around 230 per second, which is small. Sending a webhook costs a few milliseconds of CPU, so the whole day is well under one core of real work.

What costs you is waiting. By Little's law, in-flight requests equal rate times latency. At 250 per second with a 1 s average, that's about 250 requests in flight. If slow customers push the average toward the 5 s timeout, it's about 1,250. Sidekiq threads are fine for this, because Ruby releases the GVL during network I/O. It still means you need hundreds of threads available to webhooks at peak, and slow customers can quietly use them all up.

The usual causes of an hours-long backup look like this:

- **Head-of-line blocking.** A few slow or dead endpoints occupy threads for the full 5 s, and healthy customers queue behind them.
- **Shared capacity.** Webhooks share queues and processes with other jobs, or run at the default concurrency of 5–10 threads.
- **Retries in the same queue.** Sidekiq's default retry schedule is 25 attempts over about 3 weeks. Dead endpoints keep generating load, and retries compete with fresh events.
- **DB connections held during the HTTP call.** The AR pool then caps your real concurrency.

A Go rewrite wouldn't fix any of these. A Go service that sends in FIFO order with no per-customer isolation backs up the same way, only at a higher ceiling.

## What I'd do

1. **Give webhooks their own queue(s) and their own ECS service.** Scale it on queue latency rather than CPU. That stops webhooks and the rest of your jobs from starving each other.
2. **Raise concurrency on that service.** Run 50–100 threads per task, and size the Redis and DB pools to match. Fargate tasks are cheap, so a few dozen at peak is affordable.
3. **Isolate slow customers.** This is the biggest lever.
   - Cap in-flight requests per endpoint.
   - Add a circuit breaker per endpoint. After repeated timeouts, stop sending immediately and reschedule.
   - Route endpoints with recent timeouts to a separate "slow lane" queue with its own capacity.
4. **Enforce a hard total deadline of 5 s.** Per-read timeouts reset on every byte, so a slow-drip server can hold a thread much longer. Set a short connect timeout (1–2 s), cap the response body size, and don't follow redirects.
5. **Keep HTTP connections alive per host.** This avoids a TLS handshake on every call, and it's probably most of your CPU cost today.
6. **Fix retries.** Use bounded exponential backoff with jitter on a separate queue. Auto-disable endpoints that fail for days, and notify the customer.
7. **Don't hold a DB connection across the HTTP call.** Load what you need, release the connection, then send.
8. **Use `push_bulk` when enqueuing bursts.** It cuts Redis round trips.

If you still run out of room after that, there are two escalation steps.

- **Fiber-based sender.** This is still Ruby (Async/Falcon-style), run as a small dedicated worker. It handles thousands of concurrent sockets cheaply.
- **Go sender.** Build this only if the Ruby version is measurably too expensive or too fragile at your projected volume.

Either way, put the sender behind a narrow interface (delivery request in, result out). That makes swapping it later a contained change rather than a migration.

## Alternatives considered

| Option | Why not (now) |
|---|---|
| **Go rewrite** | It adds a second runtime, deploy pipeline, and on-call surface, owned by three people. The hard parts (retries, isolation, signing, delivery logs, backpressure) are the same work in any language. It also has to share secrets, subscription data, and delivery state with the monolith. It works against velocity and quiet on-call. |
| **Buy (Svix, Hookdeck, etc.)** | Reasonable, and I wouldn't dismiss it. It adds a vendor, cost at 2M a day, and customer payloads leaving your infrastructure. It's worth pricing, especially if customers want delivery logs and replay. |
| **Just add more Sidekiq workers** | This works until slow customers eat the new capacity too. It costs more without fixing the cause. |
| **SQS plus Lambda or a custom consumer** | It moves the problem and adds infrastructure, and you still need per-endpoint isolation. |

## Risks

- **Ruby path:** You may only buy 5–10x headroom, so check that against your growth. Memory per thread-heavy task needs tuning. Millions of entries in Sidekiq's retry set can strain Redis. Per-endpoint limits add Redis state to maintain.
- **Go path:** The risks are duplicate or lost events during the migration, signing-compatibility bugs, and bus factor. Your platform team's on-call load would go up.
- **Either path:** Customer-supplied URLs need SSRF protection (block private ranges and the metadata endpoint). Make sure it survives whatever you build.

## Check before committing

1. **Where the time goes.** Look at queue latency per queue, job duration histogram, and the share of jobs that time out.
2. **Concentration by endpoint.** What share of total in-flight time do the top 20 endpoints take? If it's large, isolation fixes most of this.
3. **Retry share.** What fraction of executions are retries? Count how many dead endpoints you're still hammering.
4. **Saturation signal during a backup.** If threads are busy and CPU is low, you're concurrency-bound and tuning will work. If CPU is high, something else is wrong, such as serialization, AR loading, or TLS.
5. **Sidekiq setup.** What is the current concurrency, and do webhooks share processes with other jobs? Is the DB pool the cap?
6. **Peak shape.** Is the burst spread across many customers, or caused by a few bulk operations?
7. **Delivery semantics.** Do you need ordering? Is at-least-once with idempotency keys acceptable?
8. **Growth.** Will volume be 3x or 30x in a year? Only the second case makes Go look attractive.

If checks 2–4 show slow endpoints and shared capacity, as I expect, the Ruby changes are probably a few weeks of work with no new runtime. Revisit Go only if you've done that and the numbers still don't work.
