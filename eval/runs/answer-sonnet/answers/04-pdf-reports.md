# Recommendation

**Keep the report renderer in TypeScript and move it out of the API process.** Run it as a separate worker service that reads jobs from your existing Redis queue, writes PDFs to object storage, and serves them by signed URL. Don't change language.

## Why the language isn't the problem

- 3,000 reports × 400 ms is about 1,200 CPU-seconds, or **20 CPU-minutes of work for the whole month**. Spread over even one hour, that is about a third of one core.
- Rewriting in Go, Rust or Java might make 400 ms into 100 ms. That saves a few CPU-minutes a month, which is worth nothing on your cloud bill.
- The real problem is that the work runs **inside the Express event loop**. A 400 ms synchronous render blocks every other request on that process. That is an isolation problem, and a process boundary fixes it.
- The costs of a new language are real. You would have one Go-capable developer, nobody who has run a JVM, and a harder hiring pool. Types and data models would no longer be shared with the API, and you would add a second build and deploy pipeline, a second set of dependencies, and a second on-call surface.

## What I'd build

1. **Enqueue instead of render.** The API endpoint checks authorization, enqueues a job (BullMQ on your Redis is the natural fit), and returns quickly. The job key is customer + month, so duplicate clicks don't create duplicate work.
2. **A separate worker process group on Fly.** It uses the same repo and image with a different entrypoint, and its own machine size and scaling. At month end you can scale it up, and the rest of the month it can sit small or at zero.
3. **Store the output.** Write the PDF to object storage (Tigris on Fly, S3 or R2). The download is a short-lived signed URL, so the API never streams bytes.
4. **Render once, serve many.** A monthly report is deterministic once the month's data is closed. Cache the PDF and serve repeat downloads from storage.
5. **Pre-render proactively.** When the month closes, enqueue all 3,000 jobs and drain them at a controlled rate. Most customers will then find their report already waiting. This also turns the spike into a queue that drains over about an hour, which is what you want.
6. **Small UX change.** Add a "preparing your report" state, with polling or an email or notification when it's ready, for the customers who beat the pre-render.

At this volume, one or two small worker machines with concurrency of 1–2 should clear the whole batch comfortably. Cost scales with reports rendered, which fits your goal of a bill that grows slower than revenue.

## Alternatives I considered

| Option | Verdict |
|---|---|
| **`worker_threads` / Piscina inside the API** | The cheapest first step, and it would stop the event-loop blocking. But the renders still compete for CPU and memory on the API machine, and a memory blowup can take the API down. It is a reasonable stopgap this week, not the end state. |
| **Rewrite in Go/Rust/JVM** | Rejected for the reasons above. Revisit only if measurements show a real bottleneck (see below). |
| **Serverless functions (Vercel/Lambda) for rendering** | Workable, and it scales to zero. But cold starts, package-size limits (especially if you use headless Chromium), timeouts and per-invocation cost make it fiddlier than a queue worker you already know how to run. |
| **Third-party PDF API** | Fastest to ship, but you pay per document, customer data leaves your boundary, and chart fidelity is out of your hands. Fine as an emergency bridge, not something to build on. |
| **Just scale up the API** | Adds cost for every endpoint to absorb one spiky job, and doesn't fix the blocking. |

## Things to check before committing

1. **Is it really CPU in the event loop?** Measure event-loop lag and per-endpoint latency during a simulated month-end. The slowdown could also come from the report's **Prisma queries** exhausting the connection pool or loading Postgres. If so, the worker needs its own small pool, and the queries may need tuning or a read replica.
2. **How is the PDF rendered?** If it is a library (pdfkit, react-pdf, server-side SVG charts), the plan above holds. If it is **headless Chromium**, the 400 ms figure is probably optimistic. Each instance may need 300–500 MB of RAM, concurrency must be capped, and worker sizing changes a lot. Still no reason to change language, but the cost model differs.
3. **Peak, not average.** "Within a few hours" probably means a sharp peak. Pull the actual downloads-per-minute curve. With pre-rendering and caching it matters much less, but you should know it.
4. **Is the report content final at month close?** If data can change afterward, you need a cache-invalidation rule, such as a version or data-hash in the cache key.
5. **Redis durability.** Check that your managed Redis persists data (and what happens on failover). Losing the queue mid-batch is recoverable if jobs are idempotent and you can re-enqueue from "customers without a PDF for this month".
6. **Security.** Check that signed URLs are short-lived and tied to the authorized customer, and decide on a retention policy for stored PDFs.

## Risks

- **Async UX.** Users who expect an instant download need a clear waiting state. Pre-rendering mostly hides this.
- **Queue backlog or stuck jobs.** You need retries with backoff, a dead-letter path, and an alert on queue age. Deduplicate by customer + month.
- **Worker memory leaks** (especially with Chromium or canvas). Recycle workers after N jobs and set memory limits.
- **One more thing to operate.** It's small, and it's the same language, repo and deploy tooling.

## When I'd revisit the language question

Only if, after this change, profiling shows rendering is the dominant cost at a scale where it matters. For example, if reports grow to seconds of CPU each, or volume grows 50–100x, or you need a heavy native chart or PDF pipeline. Even then, a single isolated Go or Rust render service behind the same queue interface would be a contained swap, because the worker boundary you build now is what makes that possible later.

**Suggested order:** (1) profile and confirm the cause, (2) move to a queue worker with storage, (3) add pre-rendering at month close, (4) load-test with a synthetic 3,000-report batch before the next month end.
