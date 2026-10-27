# Restructuring month-end PDF report generation

**Short answer:** this is an architecture problem, not a language problem. Take report rendering out of the API and into a background worker that uses the Redis queue you already have. Better still, generate the reports ahead of time at month close, so a customer's download is just a file fetch. Keep it in TypeScript.

## The numbers

3,000 reports × 400 ms is about **20 CPU-minutes per month**. One core could render the whole month in a coffee break, so you don't lack compute.

The real problem is that Node runs your JavaScript on a single event loop. While a 400 ms render runs on it, every other request on that instance waits. At about 2.5 report requests per second, one API process spends all its time rendering. Month-end traffic is bursty, so you probably hit that level often. Adding more API instances helps a little, but any request that lands behind a render still stalls.

A faster language would shrink 20 CPU-minutes to maybe 5–10. That saves cents a month and doesn't fix the blocking, which goes away once rendering runs in a separate process.

## What I'd build

1. **A report worker as its own process.** Use the same repo, the same Docker image and the same Prisma client, with a different entrypoint. Run it as a separate Fly process group or app, so its CPU and memory can't starve the API. BullMQ on your existing Redis is the obvious queue.
2. **Pre-generate at month close.** When the month's data is final, enqueue one job per customer. Workers render overnight and upload each PDF to object storage (Tigris on Fly, or S3 or R2). On the 1st, "download report" returns a short-lived signed URL. The API does almost no work and the burst disappears.
3. **On-demand fallback through the same queue.** If a report isn't ready yet, or a customer asks for a regeneration, the API enqueues a job and returns "preparing your report". The front end polls or gets notified, and you can optionally email a link. The API never renders inline.
4. **Small but important details:**
   - Use customer + month as the job ID, so double-clicks and retries don't render twice.
   - Run one render per CPU in each worker process.
   - Set timeouts and retries, and keep a failed-job list someone actually looks at.
   - Dashboards for queue depth, job duration and failure rate.
5. **Scale workers for the window.** Run one small worker all month and add a few for the month-close run (scripted, or just changing the machine count by hand). At this volume it costs very little.

This keeps everything in your current skills and hiring profile. You add one new process type and a storage bucket, not a new service or language.

## Month end is this Friday (Oct 31)

If the queue won't be ready by then, here's a stop-gap you can ship in a day. Deploy the same API image as a second Fly app, for example `api-reports`, and point the front end's download links at it. Report rendering then competes only with itself. Put a concurrency limit on it, and temporarily give it more or bigger machines. It's crude, but it protects the main API this month while you build the proper version.

## Alternatives I considered

- **Rewrite in Go, Rust or a JVM language.** No. The compute saving is trivial, as shown above, and you'd split the codebase and your hiring. Go's PDF and charting libraries are weaker than Node's. Nobody on the team has run a JVM in production, and the strongest JVM PDF library, iText, is AGPL or commercially licensed. Also, if your prototype uses headless Chromium (Puppeteer or Playwright), most of the 400 ms is spent inside Chromium. A rewrite wouldn't touch that.
- **Worker threads inside the API process (e.g. Piscina).** This frees the event loop and is a reasonable quick fix. But renders still share the API machine's CPU and memory, and Fly's shared-CPU machines have little headroom. A Chromium crash or memory leak would also hit the API. I'd use threads inside the worker, not inside the API.
- **Just scale the API horizontally.** Costs more and doesn't remove the stalls behind renders. It's fine as a one-off for this Friday only.
- **Serverless rendering (AWS Lambda or Vercel Functions).** Viable and good at bursts, but it adds a platform, cold starts and Chromium size limits on Lambda. Since you already have Redis and Fly, a worker is simpler.
- **A third-party PDF API (DocRaptor, Browserless, etc.).** Reasonable at 3,000 documents a month, but you pay per document, depend on a vendor, and customer data leaves your systems. Worth a look if your templates get complicated, not needed now.
- **Generating PDFs in the customer's browser.** Moves the compute to the customer, but you lose consistent output and an archived copy. It also bloats the front-end bundle and breaks emailed reports. Not worth it.

## Risks

- **The cause may not be only CPU.** Building 3,000 reports also means 3,000 sets of report queries. If the queries are heavy, Postgres may be part of the slowdown, and moving rendering won't fully fix it. Pre-generating overnight spreads that load out. A read replica for the worker is the next step if needed.
- **Data must be final before you pre-generate.** Late-arriving data or corrections after month close mean a stored PDF can be wrong. Define a cut-off, and add a "regenerate for customer X" action.
- **Redis has to be set up for queues.** BullMQ needs persistence and must not evict keys (the `noeviction` policy). If you use a per-command-priced Redis like Upstash, BullMQ's polling can be surprisingly expensive.
- **Database connections.** Every worker process opens its own Prisma connection pool. Check your managed Postgres connection limit before adding workers at month end.
- **Chromium memory**, if that's how you render: budget roughly 100–300 MB per concurrent page, and restart the browser now and then.
- **A product change.** Downloads become "ready" rather than "built on click". Confirm that's acceptable, which it usually is for monthly reports.

## What I'd check before committing

1. **Profile one render.** Split the 400 ms into data queries, chart rendering, PDF layout and any browser start-up. There are common cheap wins: reuse one browser instead of launching one per request, load fonts once, and render charts as SVG on the server (for example ECharts' server-side SVG) instead of through a canvas or browser.
2. **Confirm the slowdown is event-loop blocking.** Measure event-loop delay on the API during a load test or at the next month end, alongside Fly's CPU throttling metrics and Postgres load. If shared-CPU throttling or the database is a big factor, the plan changes a bit, mainly machine type and a read replica.
3. **Peak concurrency and memory per render**, to size the workers.
4. **Your Redis provider and configuration**, as above.
5. **Business rules:** when month data is final, whether reports are immutable once issued, and whether they must reflect live data. These decide whether pre-generation works or whether you lean more on on-demand jobs.
6. **Data sensitivity:** storage encryption, how long signed URLs stay valid, and retention for stored PDFs.

If the profiling shows something unexpected, like 400 ms of real wall time that's mostly database work, I'm happy to revisit. But I'd be surprised if the answer were anything other than "a TypeScript worker, a queue, and pre-generated files".
