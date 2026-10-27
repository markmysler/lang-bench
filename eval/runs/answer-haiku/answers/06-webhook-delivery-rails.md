## Short answer

Don't decide Go vs. Ruby yet. The description points at the architecture more than the language. Spend about two weeks isolating and measuring webhook delivery in Ruby first. If the sender still can't hold enough slow connections after that, build a small Go executor. I haven't seen your code, so this rests on your description.

## Why I think the problem isn't Ruby

Rough math with assumed numbers: 2M/day averages about 23 sends/s. A busy day at 5x peak is about 115/s. If 30% of endpoints are slow and hit the 5 s timeout, average time per send is about 1.7 s. That needs roughly 200 requests in flight at once.

Ruby threads release the GVL during network I/O, so a Sidekiq thread blocked on a slow customer isn't burning CPU. The limits are more likely:

- **Shared queues and pools.** Webhooks compete with other Sidekiq work for the same threads and Redis.
- **Too little concurrency for the slow tail.** Each slow endpoint occupies a thread for up to 5 s. Without per-endpoint caps, a few slow customers can hog the pool (head-of-line blocking).
- **Database connections.** Each Sidekiq thread needs an Active Record connection. Raising concurrency can exhaust Postgres connections.
- **Retries and per-attempt writes.** Retry storms and a delivery-log write on every attempt can load Postgres.

Go's real advantage is cheap concurrency: thousands of in-flight connections in one small process, with no per-thread memory cost. That's a legitimate advantage for this workload. It's an advantage you may not need until the Ruby changes are measured.

## Recommendation

**Phase 1, Ruby (about 2 weeks):**
- Move webhook sends to a dedicated queue and worker process, separate from other jobs.
- Set aggressive connect and read timeouts, and use one HTTP connection pool per host.
- Add per-customer or per-endpoint concurrency limits and fairness, so one slow customer can't block others.
- Add a circuit breaker: when an endpoint keeps failing, back off instead of retrying at full rate.
- Measure before and after: queue latency, send latency percentiles, timeout rate, thread utilization, DB connections, and Postgres write load.
- If the sender is latency-bound, consider an async HTTP approach in Ruby (for example, the `async` / `async-http` gems on a fiber scheduler). Check the current gem and Ruby versions before committing to it.

**Phase 2, Go (only if Phase 1 measurements justify it):**
Keep the business logic in Rails: payload building, signing, event subscriptions, retry policy, and the delivery history that customers see. Build Go as a narrow executor: it takes a send job, performs the HTTP POST with a 5 s timeout, and reports the result back. That keeps the monolith healthy and limits the surface your platform team owns.

**Option I'd keep open:** buying a webhook delivery service (for example, Svix or Hookdeck). If delivery is not your differentiator, this may be the cheapest path. Weigh it against cost and data handling.

## Alternatives considered

- **Full Go rewrite of webhooks including state and retries.** This moves the hardest part, delivery state and history, out of the monolith and splits ownership. Rejected for now.
- **Just add more Sidekiq workers.** Cheap, and it may be the right first step, but it doesn't fix head-of-line blocking or database pressure. Not sufficient alone.
- **Queue-as-a-service (SQS plus a consumer, or EventBridge API destinations).** Viable, but it adds infrastructure and still needs a consumer that performs the HTTP calls.

## Risks

- **Semantics drift.** Delivery must stay at-least-once, with stable idempotency keys, identical signatures, the same retry schedule, and the same ordering guarantees if you promise any. A rewrite can silently change these.
- **Two stacks on call.** A Go service adds a second runtime to on-call and debugging. Keep the Go surface small.
- **Customer overload.** Faster sending can hammer slow customer servers. Per-endpoint caps are a product decision, not just an engineering one.
- **Migration.** Run both paths in shadow, then cut over per customer, with a rollback plan.
- **Opportunity cost.** A three-person platform team rewriting a subsystem is three people not doing other platform work.

## What to check before committing

1. **Traffic shape:** hourly enqueue rates, peak-to-average ratio, and how many sends are retries.
2. **Where the time goes:** for a typical job, the split between waiting on the customer, Ruby CPU (payload building, serialization), and database time. If most of it is waiting on the customer, an async or Go executor helps. If it's CPU or database time, neither helps and you should fix queries and serialization first.
3. **Endpoint latency distribution:** p50, p95, and p99 for customer responses, and the share of timeouts. A few very slow customers may explain most of the backlog.
4. **Pool and connection budget:** Sidekiq concurrency, Active Record pool size, and Postgres connection limits.
5. **Queue topology:** whether webhooks share queues or processes with other work.
6. **Requirements:** ordering guarantees, latency SLO, retry policy, and how long delivery history must be kept.

If the Phase 1 numbers show the webhook queue draining at peak with headroom, you're done and the rewrite is off the table. If they don't, you'll have the evidence to justify the Go executor and a clear scope for it.
