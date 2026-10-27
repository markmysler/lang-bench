## Short answer

Move report generation out of the API process and into a separate worker, using the Redis queue you already run. Pre-render reports at month close where you can. Keep it in TypeScript. A second language would solve a problem you don't have yet.

## What's actually wrong

The API isn't slow because 400 ms is expensive. It's slow because that work runs in the same Node process that serves every other request. Node has one event loop per process, so while a chart is being laid out or rasterized, nothing else gets served.

The total load is small. 3,000 reports × 0.4 s is about 20 CPU-minutes for the whole month end. Spread over a few hours, that's roughly one core. The problem is where the work runs and when, not how much of it there is.

Before you commit to anything, check two things that could be the real culprit:

- **Database connection pool.** If each render holds a Prisma connection, or queries heavily, the pool drains and other endpoints wait for connections. This produces the same symptom as CPU starvation.
- **Renderer type.** If the charts come from headless Chromium (Puppeteer or Playwright), each render is expensive in memory as well as CPU, and that changes the sizing and the crash risk.

## What I'd do

1. **Move rendering to a worker.** Put the same TypeScript code in a separate Fly.io process group, consuming a BullMQ-style queue on Redis. The download endpoint enqueues a job and returns a job ID. The client polls or gets an email when the file is ready. Cap worker concurrency to the cores on each machine, so 3,000 jobs can't all run at once.
2. **Store the output.** Write finished PDFs to object storage (S3, R2, or GCS) and serve them through short-lived signed URLs. Downloads become file fetches with no rendering.
3. **Pre-render at month close.** Once a month's data is final, generate all reports as a batch job. The month-end spike disappears, and the load lands in a quiet period on a predictable schedule.
4. **Cache by customer, month, and data version.** Re-downloads and regenerations then cost nothing. Invalidate only when the underlying data changes.
5. **Make rendering cheaper if it's still needed.** Common options are SVG charts (ECharts or Vega-Lite) and a PDF library (pdf-lib or PDFKit) in place of a full browser. Only do this after measuring the worker.

## Should the report service be in a different language?

**Not now.**

- **Go wouldn't fix the main problem.** A Go rewrite might cut 400 ms to 100 ms, but the architecture change above is what stops the API from slowing down. Those gains are much bigger.
- **Cost of a split stack.** You're four people with strong TypeScript and one Go developer. A second language means a second toolchain, a second deploy path, and a smaller hiring pool, all of which slow the feature work you care about.
- **If rendering is headless Chromium, the language barely matters.** The cost is the browser.
- **The JVM is the wrong choice.** Nobody on the team has run one in production.
- **Revisit later if measurements justify it.** If the worker is clearly CPU-bound in pure JS, and volume grows enough that per-core cost dominates the bill, a small Go service with a JSON-in, PDF-out contract behind the same queue is a reasonable move. Go is the natural candidate because you already have someone who knows it.

## Alternatives I considered

- **Scale up the API machines.** Works, but you pay for the whole API to absorb a batch job, and the event loop still blocks per request. It's the most expensive option.
- **`worker_threads` inside the API process.** Keeps the event loop free, but shares memory and the DB pool with the API. A separate process is simpler to reason about.
- **Serverless functions per PDF.** Handles bursts well, but Chromium cold starts and per-invocation pricing make it awkward at this scale.
- **Third-party PDF rendering API.** Removes the ops work, but charges per document and sends customer financial data to a vendor. Check whether your contracts allow that.
- **Rewrite in Go or Rust now.** Discussed above. Too much cost for the gain.

## Risks

- **UX change.** Downloads become asynchronous. Pre-rendering at month close makes this mostly invisible, but on-demand requests need a clear "ready in about a minute" state.
- **Stale reports.** Pre-rendered files must be versioned against the data they used. Otherwise corrections won't reach customers.
- **Queue failure modes.** Retries, duplicate jobs, and poison messages need idempotent job keys. Redis must not evict queue keys (`noeviction`), and it needs persistence.
- **Worker memory.** Long-lived Chromium processes leak. Recycle them after N renders, and size Fly machines for peak memory, not average.
- **Storage and access control.** PDFs contain customer data. Signed URLs need short expiry and an ownership check on each request.
- **Operational overhead.** A second process group means another thing to monitor, deploy, and alert on.

## What I'd check before committing

1. **Event-loop lag and DB pool stats** during last month end. Confirm the API is actually blocked, and by what.
2. **A profile of one render**: time in data queries, chart layout, rasterization, and PDF writing. The answer determines whether step 5 matters.
3. **Peak memory per render**, especially if Chromium is involved.
4. **Whether reports are immutable after month close.** If yes, pre-rendering and caching are straightforward. If no, you need the versioning described above.
5. **A load test** that reproduces 3,000 downloads in a few hours, including a burst at the start. Run it against the worker on a Fly machine size you'd actually pay for.
6. **Product sign-off** on asynchronous download and on whether pre-rendering at close is acceptable to customers.

If the profile shows the time is mostly in the database, the fix is partly in the queries, and the worker split still helps but matters less.
