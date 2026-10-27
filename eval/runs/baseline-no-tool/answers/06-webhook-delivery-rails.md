# Webhook delivery: fix it in Ruby, not with a Go rewrite

**Short answer:** Keep it in Ruby. Rebuild webhook delivery as its own subsystem: a separate queue, a separate worker service, and protection against slow endpoints. Your problem is too few concurrent senders, and slow customers blocking everyone else. Ruby isn't what's slowing you down, and a Go rewrite wouldn't fix those two things on its own. Run the checks at the end first; they should take a few days and will tell you whether I'm right.

## Why it's not a language problem

Some rough numbers:

- **Rate:** 2M a day is about 23 per second on average. With uneven traffic, assume peaks of 5–10×, so 100–250 per second.
- **Concurrency:** the number of requests you need in flight is roughly rate × time per request.
  - If requests average about 1 s (most fast, a share hitting the 5 s timeout), you need about 100–250 in flight at peak.
  - If a large group of endpoints goes slow at once, you need up to about 1,250.
- **What you probably have:** I'd guess a few Sidekiq processes with 5–25 threads each, and webhooks may share them with other jobs. That's roughly 20–100 slots. If those slots spend 5 s waiting on slow servers, you top out at 4–20 webhooks per second. That would produce exactly the hours-long backlog you're seeing.

Sending a webhook is almost all waiting on the network. Ruby releases its global interpreter lock (the GVL) while it waits, so threads handle this kind of work well. A Sidekiq service with a few hundred threads spread over several Fargate tasks can handle your peak. Go would do it with fewer tasks, but at this volume the cost difference is small.

The real issue is head-of-line blocking. With one shared queue, a few slow or dead customer endpoints take up most of the slots. Sidekiq's default retries (25 attempts with backoff) then keep sending more requests to those same endpoints. A Go service with one shared queue would have the same problem, just with more goroutines stuck waiting.

## What I'd build, in order

**Stage 1 (about a week; probably clears the backlog):**
1. **Separate queue and ECS service for webhooks.** Webhooks stop competing with other jobs, and you can size and scale them on their own. Use much higher thread concurrency, e.g. 25–50 threads per process. Autoscale on queue latency (how long the oldest job has waited), not CPU. CPU will stay low while the backlog grows.
2. **Real timeouts.** Ruby's `Net::HTTP` defaults to 60 s for opening a connection and 60 s per read. Its read timeout applies to each read, not the whole request, so a server that sends bytes slowly can hold a thread much longer than 5 s. Set a short connect timeout and enforce one overall 5 s deadline. Limit or disable redirects.
3. **Keep the job lean.** Build the payload when the event happens, not when it's sent. Don't hold a Postgres connection during the HTTP call. If you skip this, raising the thread count will run out your database connections before it fixes throughput.

**Stage 2 (2–4 weeks; the lasting fix):**
4. **A deliveries table that owns the state:** status, attempt count, next attempt time, last error. Webhook retries then follow your own schedule instead of Sidekiq's retry set, and you get an audit trail for support.
5. **Isolate slow endpoints:**
   - Cap how many requests can be in flight to any one endpoint. Sidekiq Enterprise has a concurrent limiter for this; without it, a small Redis-based limit works.
   - Add a circuit breaker: if an endpoint keeps failing, pause it and back off.
   - Send retries to a separate "slow lane" queue so they never delay first attempts.
   - After that, one bad customer can only hurt their own deliveries.
6. **Alerts and dashboards for on-call:**
   - Alert on queue latency for first attempts, not queue size.
   - Track per-endpoint failure rates.
   - Show a list of endpoints with open circuit breakers, for support rather than for paging.

## Alternatives I considered

- **A Go delivery service.** It's efficient, and your platform team can build it. But the hard parts are the same in any language: fairness between endpoints, retries, circuit breaking, request signing, protecting against requests to internal addresses, avoiding duplicate effects, and observability. The costs are:
  - a second deployment pipeline;
  - a data contract with the monolith, since payloads and subscriptions live in Rails;
  - on-call ownership resting on three people;
  - a part of the product the other 27 engineers can't easily change.

  I'd reconsider at 10–50× today's volume, or if you want a general-purpose service for all outbound traffic. If you design the deliveries table and queue as a clean boundary, a thin Go sender can replace the Ruby workers later without touching the monolith.
- **Buying it (Svix, Hookdeck) or self-hosting Convoy.** These are worth a day of evaluation, especially if customers want replay, a delivery log, or a self-service portal. At about 60M messages a month, get real pricing before deciding. Self-hosted Convoy means running a Go system you didn't write.
- **Just adding more Sidekiq processes.** It helps temporarily. Without isolating slow endpoints, the next time a big customer's endpoint goes slow, the backlog comes back.
- **SQS + Lambda, or EventBridge API Destinations.** You'd adopt a new runtime model for a problem that doesn't need one. API Destinations also means managing one AWS resource per customer endpoint. Lambda makes static egress IPs harder.

## Risks

- **Postgres connections** run out when you raise the thread count. Check pool sizes and whether you use PgBouncer.
- **Redis memory during a backlog.** Millions of queued jobs live in Redis. Confirm you have memory headroom and that the eviction policy is `noeviction`. Sidekiq loses jobs under any other policy.
- **Duplicate deliveries.** Sidekiq can run a job more than once. Timeouts and deploys (in-flight jobs get re-run after ECS stops a task) will cause duplicates. Send a stable webhook ID header so customers can ignore repeats.
- **Ordering.** More concurrency means events can arrive out of order. Check whether any customer relies on ordering, even if you never promised it.
- **Customer-visible changes.** Retry schedules, timeouts and paused endpoints affect customers. Communicate before changing them.
- **SSRF (customers pointing webhooks at internal addresses).** While you're in this code, block private and link-local addresses, including the ECS metadata endpoints `169.254.169.254` and `169.254.170.2`. Check the address after DNS resolution.
- **Static egress IPs.** If customers allowlist your IPs, any new service must send from the same NAT addresses.

## What to check before committing

1. **Job duration distribution** (p50/p95/p99), the share of jobs that hit the timeout, and a per-endpoint breakdown. I expect a small number of endpoints account for most of the slow time.
2. **CPU of the Sidekiq tasks during a backlog.** Low CPU with a growing queue means you're short on concurrency, which settles the Ruby-vs-Go question. High CPU means payload building or serialization is the cost. A Go sender wouldn't fix that unless that work moved too.
3. **Retry share:** what fraction of executions are retries, and how many endpoints never succeed.
4. **Current setup:** concurrency (processes × threads), whether webhooks share a queue with other jobs, the timeout values actually in effect, and how long DB connections are held.
5. **Peak traffic:** the highest per-minute rate on your worst day, for sizing.
6. **Redis:** memory headroom and eviction policy.
7. **Sidekiq version and license.** Pro has reliable job fetching; Enterprise has the concurrent limiter.
8. **Customer expectations** around ordering, retry duration and IP allowlisting.
9. **A load test.** Run the dedicated high-concurrency Sidekiq service in staging against a fake customer server. Make it respond in 0–5 s with a configurable failure rate, and measure throughput per task. This is a good small Go job for the platform team. One or two days of this will answer the question better than more debate.

If checks 1–2 show what I expect, Stage 1 should clear the backlog within a week or two. Stage 2 is what keeps on-call quiet afterwards.
