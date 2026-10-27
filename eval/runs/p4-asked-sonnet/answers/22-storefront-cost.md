**Short answer:** don't rewrite in Go. Your problem is how requests wait, not how fast the language runs. Fix the concurrency model, cut the waiting, and change how you autoscale. I'd expect that to deliver most of the p99 and cost gains in weeks, not quarters. I haven't seen your metrics, so treat the details below as a hypothesis to check.

## Why Go isn't the answer

- CPU is low and requests are mostly waiting. Go would make the CPU part faster, but that part is small.
- The 80 ms and 40 ms calls and the database time take just as long from Go. The saving would come from Go's cheap concurrency, and you can get that in Python without a rewrite.
- A rewrite costs a lot. You have 20 engineers with strong Python and Django skills. You'd lose months of feature work, risk behavior drift in pricing and cart logic, and run two stacks. Celery, admin tooling and shared models would still be Python.
- The saving would be real but smaller than leadership hopes. It would be swamped by the cost of doing it.

## What's probably happening

With sync workers, one worker handles one request at a time. During a ~200 ms request, the worker is idle for most of it. At peak, all workers are busy waiting, so new requests queue, and that queueing is your 900 ms p99. CPU-based autoscaling never reacts because CPU stays low. So you run 40 mostly idle pods and still get queueing.

## What I'd do, in order

1. **Measure first (days).** Break down p99 into queue time, app time, database time and each downstream call. Without that, the rest is guesswork.
2. **Autoscale on the right signal.** Use worker saturation, in-flight requests or queue depth instead of CPU. This is cheap and fixes the "scaling never triggers" part.
3. **Run more concurrent requests per pod.** Move from sync workers to gunicorn `gthread` (or gevent, or ASGI). One pod then handles many waiting requests at once. Pod count can often drop several-fold, and memory per request drops too, because threads share one process. This is the biggest cost lever.
4. **Cut the waiting itself.**
   - Call recommendations and pricing in parallel, not one after the other. That turns 120 ms into about 80 ms.
   - Cache what you can. Recommendations are often fine slightly stale. Pricing may be cacheable for short periods or per product.
   - Set strict timeouts, add a circuit breaker, and degrade gracefully, for example by showing the page without recommendations. This protects p99 when a dependency has a bad moment.
   - Review slow queries, N+1 patterns and indexes, and consider read replicas for read-heavy endpoints.
5. **Re-evaluate after that.** If you still have a real CPU-bound hotspot, rewrite just that piece or service. Don't rewrite the whole API.

## Alternatives I considered

| Option | Verdict |
|---|---|
| Full Go rewrite | High cost and risk, and it doesn't touch the dependency latency. |
| Just add pods | Costs more, which is the opposite of what you want. |
| Async Django (ASGI) | Viable, but the ORM still runs in a thread pool unless you adopt psycopg3 async, and mixed sync/async code is easy to get wrong. A later step, not the first one. |
| gevent | Very efficient, but monkey-patching can interact badly with the DB driver and C extensions. Needs careful testing. |
| `gthread` | Least invasive, and probably enough. My first pick. |

## Risks

- **Database connections.** More concurrency per pod means more connections. Put PgBouncer (transaction pooling) in front of Postgres, or you'll hit connection limits. Watch for transaction-pooling gotchas such as server-side cursors and session state.
- **Thread safety.** Any global mutable state, per-request state stored on module-level objects, or non-thread-safe libraries will bite. Audit for this and load-test.
- **Caching bugs.** Stale prices shown at checkout are a business problem. Cache only where the product owner accepts it, and never at the final price check.
- **Retries and timeouts.** Badly tuned ones can amplify load on the pricing and recommendations services during an incident.
- **Moving the bottleneck.** The database may become the next limit once the worker queueing is gone.

## What to check before committing

- Per-request time breakdown, especially p99 queue time versus app time. If queue time dominates, the diagnosis holds.
- Workers per pod, current peak concurrency (requests per second × latency) and database connection counts and limits.
- Whether pricing and recommendations are called serially, and whether they can be called in parallel or cached.
- Whether p99 outliers come from the database, the downstreams, or something else such as autoscaling lag or GC.
- How much of the hosting bill is storefront pods versus database, cache and egress. If pods are only a third of it, even a perfect pod reduction has a limited effect.
- Whether the downstream services can handle the extra concurrency, because they will see more simultaneous load once you remove the queueing.

**Suggested plan:** a short measurement spike, then a canary of `gthread` with PgBouncer and saturation-based autoscaling on a few pods. Compare p99 and pods-per-RPS against the sync baseline, then roll out. That gives leadership real numbers on cost and latency before anyone considers a rewrite.
