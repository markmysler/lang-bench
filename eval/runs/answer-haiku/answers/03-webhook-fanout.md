## Recommendation: build it in TypeScript on Node, as its own worker service

Put the delivery worker in its own Fly.io app, in the same monorepo, and have it consume jobs from your existing Redis queue. The API only enqueues. It never calls customer URLs. Your team can ship and hire for this, and it reuses your Prisma types and deploy pipeline. Go would also work, but the gain doesn't justify a second language in production at your size.

## Why the language matters less than the design

Deliveries are almost entirely waiting on the network. The load is modest by server standards:

- Average: about 40 events/s × 1–5 URLs ≈ 40–200 deliveries/s.
- Peak: about 500 events/s × up to 5 URLs ≈ 2,500 deliveries/s.
- In-flight requests (Little's law): at peak, 2,500/s × 1–2 s ≈ 2,500–5,000 open requests. If timeouts are long, that count grows, since a timed-out request still holds its socket until the timeout fires.

Node handles thousands of concurrent sockets on one process without trouble. The real risks are unbounded concurrency, slow customers blocking others, and lost events. Those come from the design, not the language. The worker is also a queue consumer that makes outbound HTTP calls, so if it ever needs rewriting, the boundary is clean and the rewrite is contained.

## Alternatives considered

- **Go:** Excellent fit for this workload. Goroutines, a strong standard HTTP client, and low memory per in-flight request. Against it: your team has one developer with some Go, and a second language means a second set of libraries, deploy conventions, and on-call knowledge. The Prisma schema and types would also need duplicating or replacing with raw SQL. Revisit only if measurements show Node can't meet the target at a reasonable machine size.
- **Elixir/BEAM:** Built for this kind of concurrency, but it's a whole new stack for a team of four.
- **Java/Kotlin:** Ruled out by your team's lack of JVM production experience.
- **Rust:** Would work, but it's overkill and slows delivery.
- **Buying it:** A hosted webhook-sending service (Svix is one example) or a delivery-queue product would remove most of this work. Worth pricing against your own build, especially given the per-volume cost. Customer-facing webhook sending is a product in its own right, so the build-versus-buy question is real.

## Design points that matter more than the language

- **Transactional outbox:** Write the event row in the same Postgres transaction as the business change, then relay it to Redis. Enqueuing directly after commit can lose events or deliver ones that rolled back.
- **Bounded concurrency:** Cap in-flight deliveries per worker, and cap per customer endpoint, so one slow URL can't use up the pool. Let the queue absorb peaks instead of opening more sockets.
- **Timeouts and body limits:** Use a short hard timeout (roughly 5–10 s) and read only a capped amount of each response body.
- **Keep-alive pools:** Set explicit socket limits on the HTTP client. Some Node defaults are unlimited.
- **Retries:** Exponential backoff with jitter, a dead-letter state after a fixed window, and a circuit breaker for endpoints that keep failing.
- **At-least-once delivery:** Give each delivery a stable event ID and idempotency key, and sign payloads with HMAC plus a timestamp so receivers can reject replays.
- **SSRF protection:** Customer URLs are user-supplied. Validate the resolved IP at connection time, not only at registration, to block private and link-local addresses and DNS rebinding.
- **Ordering:** Decide whether ordering is needed per customer or per endpoint. If it is, the partitioning scheme changes.

## Risks

- **Storage growth:** Roughly 3.5M events/day at average load, and about 10M deliveries/day at 3 URLs per event before retries. Logging every attempt in Postgres will get expensive. Plan retention, partitioning, or moving attempt logs to cheaper storage.
- **Redis:** A customer endpoint that's down for hours builds a backlog. Size Redis for it, and make sure the eviction policy is `noeviction` so queued jobs are never silently dropped.
- **Queue library limits:** Check that your queue library supports per-endpoint concurrency and delayed retries. If it doesn't, you'll write that logic yourself.
- **Node-specific failure modes:** Event-loop blocking from large JSON payloads, memory growth from many open sockets, and file descriptor limits on the Fly machine.
- **Cost:** The worker is I/O-bound, so compute should stay small. The bill will mostly come from Postgres and Redis storage, so design retention before launch.

## What I'd check before committing

1. **Spike a load test this week.** Run a fake customer endpoint with realistic latency (300 ms–2 s) and 5–10% timeouts. Drive the worker at 2,500 deliveries/s and measure memory, CPU, queue lag at p99, and socket counts. This answers the Go-versus-Node question with data.
2. **Estimate workers from real latency.** At 500 in-flight deliveries and 1 s average latency, one process handles about 500 deliveries/s. Your numbers may differ, and customer latency dominates.
3. **Confirm ordering and retry requirements.** Ask customers whether they need ordering, and how long retries must last. Both change the design and the storage cost.
4. **Decide build versus buy** with a rough cost comparison against a hosted webhook service at your projected volume.
5. **Check the queue library** for per-endpoint limits, delayed retries, and failure visibility.

If the spike meets the targets at a reasonable machine size, stay on Node. If it doesn't, the delivery worker is the one piece worth rewriting in Go, and the queue boundary keeps that change contained.
