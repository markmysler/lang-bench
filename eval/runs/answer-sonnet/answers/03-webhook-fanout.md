# Recommendation: Node and TypeScript, as a separate service

Build it in Node, but as its own deployable (a separate Fly app, or at least its own process group). Don't add it to the Express API.

## Why Node is enough

- **The load is I/O-bound.** At peak, 500 events/s × up to 5 URLs is about 2,500 deliveries/s worst case. At 0.3–2 s each, that's roughly 2,500–5,000 requests in flight, plus a tail of hung connections held until the timeout. Almost all of that is waiting on sockets. Node's event loop handles this well, and a few small Fly machines will cover it.
- **The hard parts aren't language problems.** They are fairness between customers, retry scheduling, SSRF protection, durability and observability. A Go version would need the same design.
- **Go's advantages don't pay off at your scale.** It would use less memory per connection and less CPU for TLS, which might save tens of dollars a month. Against that, you'd add a second language, a second toolchain and CI path, and a second on-call story. Only one of you has written any Go, and you can't share types or Prisma models with it. Hiring more TypeScript developers stays easy only if this service is also TypeScript.
- **The rewrite risk is small.** A webhook sender with a clean boundary (a queue in, HTTP out, a table of attempts) is a small service. If Node proves wrong at 10× your current load, rewriting it is weeks of work, not months.

## Alternatives I considered

| Option | Why not (for now) |
|---|---|
| **Go** | Technically a good fit, but the gain is marginal at this scale and the team and hiring cost is real. I'd revisit it if load grows about 10× and the CPU bill is the problem. |
| **JVM (Kotlin/Java)** | Nobody has run one in production. You'd be learning a runtime while operating it. |
| **Elixir/Erlang** | Probably the best technical fit for this kind of problem, but nobody on the team knows it and the hiring pool is small. |
| **Serverless (Lambda or Vercel functions)** | You'd pay for every second spent waiting on slow customer endpoints, so cost scales linearly with volume. That's the opposite of your cloud-bill goal. |
| **Buy (Svix, Hookdeck) or self-host (Convoy)** | This is a serious option, because it gives you retries, signing, a customer portal and a delivery log for free. But 40 events/s is about 100M events a month, or around 300M deliveries. Hosted per-message pricing at that volume could be painful. If those numbers are projections rather than today's traffic, price it before you build. |
| **Run it in the main API** | This is the one outright "no." One slow customer must not be able to affect your API's latency or memory. |

## The design choices that matter more than the language

1. **Persist before you send.** Write the delivery records in the same Postgres transaction as the event (an outbox pattern). Postgres is then the source of truth, and customers will want a delivery log and replay anyway.
2. **Keep payloads out of Redis.** Put only IDs in the queue and load the payload from Postgres at send time. If a customer is down for 3 days, millions of delayed retries would otherwise sit in Redis memory.
3. **Prevent head-of-line blocking.** One customer with a 10 s hang must not starve everyone else. You need a per-endpoint concurrency cap, a circuit breaker, and automatic pausing of endpoints that keep failing. I believe BullMQ's per-key group concurrency is in its paid tier, so check. Otherwise you'll build a small limiter yourself.
4. **Set strict timeouts and limits.** Use a short connect timeout (about 3 s), a total timeout of about 10 s, a cap on response body size (don't read the whole body), and no redirect following.
5. **Retry with exponential backoff and jitter** over a defined window, such as 24–72 h. Then dead-letter the delivery, auto-disable the endpoint and notify the customer, and offer manual replay.
6. **Plan for at-least-once delivery.** Send a stable event ID and a signed payload (HMAC plus a timestamp), and document that ordering isn't guaranteed. Duplicates will happen on deploys and crashes, so say so in the docs.

## Risks

- **SSRF is the biggest risk, and customers supplying URLs makes it real.** Block private ranges, link-local addresses and the cloud metadata endpoint. Resolve DNS yourself and connect to the resolved IP, to stop DNS rebinding. Re-check on every redirect, or disable redirects. Ideally send all traffic through a hardened egress proxy such as Smokescreen. Do this before launch.
- **Node's DNS lookup uses the libuv thread pool, which defaults to 4 threads.** Slow or failing customer DNS can stall every delivery. Raise `UV_THREADPOOL_SIZE` or use a caching resolver.
- **Connection pooling across thousands of distinct hosts needs bounds.** Cap the sockets per host and the total, or memory and file descriptors will climb.
- **Redis durability.** Make sure your managed Redis has persistence on and uses a `noeviction` policy. If it evicts keys under memory pressure, you lose deliveries silently. Also check the pricing model. BullMQ sends a lot of commands, and per-request-priced Redis (Upstash, for example) can get expensive quickly.
- **Deploys.** Fly restarts will interrupt in-flight deliveries. You need graceful shutdown, with stalled-job recovery as the backstop, which is another reason duplicates must be acceptable.
- **Customers will ask for a fixed list of source IPs to allowlist.** Fly can do static egress IPs, but check the cost and constraints.

## What I'd check before committing (about 2–3 days)

1. **Your real numbers.**
   - Is 40/s and 500/s measured or projected?
   - What is the actual fan-out distribution and payload size?
   - What retry window and delivery guarantees will you promise customers?
   - Do you need ordering?
   - Is customer-facing delivery history or replay in scope?
2. **A load test.** Build a fake receiver that answers in 300 ms–2 s, with some endpoints hanging until timeout and some failing TLS, and run 2,500 deliveries/s at it from one Fly machine of the size you'd actually pay for. Measure CPU, memory, event-loop lag and time spent in the queue at p99. If one machine can't hold peak, work out how many machines you need and what that costs. Only if that cost looks bad is there a case for Go.
3. **Buy versus build.** Get a quote from a hosted provider at your volume. If it's a small fraction of an engineer's time, it may win for the first year.
4. **Queue choice.** Decide between BullMQ on Redis and a Postgres-backed queue (pg-boss or graphile-worker). Postgres is simpler and transactionally consistent with the outbox, but check the write load at 2,500 attempts/s peak. BullMQ is more comfortable at that rate, but you take on the Redis durability and cost caveats above.

If the load test is healthy and the buy option is expensive, go ahead in Node. The language is the least risky part of this decision, and the SSRF and fairness work is where I'd spend the effort.
