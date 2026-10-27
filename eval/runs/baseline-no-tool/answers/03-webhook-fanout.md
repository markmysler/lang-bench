# Webhook delivery service: Node, Go, or something else?

**Short answer: write it in Node/TypeScript as a separate service.** This workload doesn't need Go. The hard parts of webhook delivery don't depend on the language. Before you write it yourselves, spend a day pricing a bought or self-hosted option.

## What the load actually is

| | Average | Peak |
|---|---|---|
| Events/s | 40 | 500 |
| Deliveries/s (1–5 URLs each) | 40–200 | up to 2,500 |
| Requests waiting at once (rate × 0.3–2 s) | ~50–400 | ~1,000–5,000 |

So the service spends nearly all its time waiting on customer servers. It is not doing heavy computation. Each delivery needs only a JSON body, an HMAC signature and an HTTPS call. Node handles many thousands of open sockets per process without trouble, and Go does too. At this scale either language runs on a few small machines, so the cloud bill difference is maybe tens of dollars a month. That is far less than the cost of a second language for a four-person team.

## Why Node

- **Speed and shared code.** The whole team can work on it from day one. It can reuse your event types, Prisma schema, validation and monitoring setup from the same monorepo.
- **Hiring.** It keeps you a TypeScript-only company, which is what you want to hire for.
- **It's easy to replace later.** The service sits behind a queue, so its contract is just "message in, delivery log out." If it ever needs rewriting, that's a contained job, not a migration.

**Keep it separate from the API:** its own Fly app, its own scaling, its own failures. A flood of retries should never slow the main API.

## Alternatives I considered

- **Go.** It suits the job well, with cheap concurrency, low memory and a single binary. But only one of you has written some, and that developer becomes the bottleneck and the person who gets paged. You lose shared types, and you have two of everything (toolchain, CI, libraries). Go makes sense when a platform team owns the service, or when measurements show Node is the limit. Neither is true now.
- **JVM (Kotlin/Java), Rust, Elixir.** Elixir in particular fits this kind of work very well. But none of you has run any of them in production, and learning a new runtime while running a reliability-critical service is the worst combination.
- **Serverless (Vercel Functions, Lambda).** Avoid it for this. Those platforms bill for elapsed time, and this service spends 300 ms to 2 s per call just waiting. You would pay for exactly the part that costs nothing on a long-running process.
- **Buy or self-host: Svix, Hookdeck Outpost, Convoy.** This is the real alternative to building. Doing webhooks properly means retries, signing, replay, endpoint auto-disable, a customer-facing delivery log and SSRF protection. That's weeks of work plus ongoing maintenance, and these products already do it. The catch is volume: about 3.5M events a day, or about 100M a month, before fan-out and retries. Hosted pricing at that volume may be significant, so get real quotes. Self-hosting an open-source one (Svix's server is Rust, Convoy is Go) means running a black box you can't easily debug, which is a weaker version of the "new language" problem.

## The risks that matter (mostly not about language)

1. **One bad customer slowing everyone down.** Suppose a customer with 30% of your traffic has a dead endpoint and you use a 10 s timeout. At peak that ties up about 7,500 concurrent slots, so everyone else's webhooks queue behind theirs. To prevent this:
   - use short timeouts (connect and total);
   - cap concurrent requests per endpoint;
   - add a circuit breaker and auto-disable endpoints that keep failing;
   - keep retries in a separate queue from first attempts.
2. **SSRF (server-side request forgery).** Customers choose the URLs your servers call. Block private, loopback and link-local addresses, cloud metadata endpoints and Fly's private network. Resolve DNS once, check the IP, then connect to that exact IP so a DNS change can't redirect you. Re-check on every redirect, or don't follow redirects at all. This is the most important part to get right.
3. **Retry backlog filling Redis.** A big customer down for a day can leave millions of pending retries. If Redis holds full payloads, that's gigabytes. Keep the payload in Postgres (or object storage) and put only an ID on the queue. Set Redis to `noeviction` with persistence turned on: losing Redis means losing webhooks silently.
4. **Postgres volume.** 200 deliveries/s works out to about 17M delivery-log rows a day. Partition the table by day, set a retention policy and batch the writes. Also cap Prisma connections per worker so a scaled-up worker fleet can't use up your managed Postgres's connection limit.
5. **Events lost between the API and the queue.** If the API writes to the database and then to Redis as two separate steps, a crash between them loses the event or duplicates it. Use an outbox table: write the event in the same transaction as the business change, and have a separate process push it to the queue.
6. **Node-specific issues** (all solvable, but plan for them):
   - Use undici with explicit timeouts and a cap on how much of the response body you read.
   - DNS lookups go through libuv's thread pool, which has only 4 threads by default. With thousands of different customer hosts, that quietly becomes a bottleneck. Cache DNS results or use a different resolver.
   - Monitor event-loop lag.
7. **Promises to customers.** Promise at-least-once delivery with an idempotency ID, not exactly-once, and not ordering. Consider the Standard Webhooks spec for signatures so you don't invent your own scheme.

## What I'd check before committing

1. **A two-day load test.** Build a rough Node worker and point it at a fake receiver that waits a random 300 ms–2 s, times out 5% of the time, and answers on many distinct hostnames (so connections and TLS sessions can't simply be reused). Push it to about 3,750 deliveries/s (1.5× peak). Measure CPU, memory, event-loop lag, DNS time and requests in flight. If one or two small machines keep up, the language question is settled with data.
2. **Your Redis provider and pricing.** If it charges per command (as Upstash does), check that before anything else. BullMQ sends several commands per job, which at thousands of jobs a second could become your biggest bill. Also confirm persistence and the eviction setting.
3. **Build vs buy quotes** from Svix and Hookdeck at your real volume, including retries. Compare them against roughly 4–6 developer-weeks of building plus ongoing maintenance.
4. **Stable outgoing IPs.** Customers will ask for IPs to allowlist. Confirm Fly can give you stable egress IPs from the worker machines.
5. **Product decisions:** how long to keep retrying (for example, up to 3 days), when to auto-disable an endpoint and how to notify the customer, how long to keep delivery logs, and whether customers get a replay button.

If the load test looks healthy and buying doesn't win on price, build it in Node with confidence. The time you would have spent learning Go is better spent on per-endpoint isolation and SSRF protection, because those are what decide whether this service is reliable.
