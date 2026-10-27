## Short answer

Don't move the storefront API to Go yet. The evidence points to a concurrency and scaling problem, not a language-speed problem. Go would fix the same symptom, but more slowly and at much higher cost. Fix the concurrency model, the fan-out, and the scaling signal first, then measure again.

## What's going on

- **Sync workers block on I/O.** Each gunicorn sync worker handles one request at a time. While it waits on Postgres, recommendations (80 ms), or pricing (40 ms), it does nothing. At peak, requests queue behind busy workers, and that queueing is most of the p99.
- **CPU is the wrong scaling signal.** Waiting workers use almost no CPU, so the HPA doesn't add pods when the queue grows. You're paying for 40 pods that are mostly idle, and they still don't absorb peak.
- **The calls are sequential.** If recommendations and pricing are called one after the other, they add 120 ms to the critical path before any database time. That is a large share of a 300 ms budget.

Go would give each pod far more concurrent requests, which addresses the queueing. But the 80 ms, 40 ms, and Postgres latencies stay the same in any language. A Go service would still spend that time waiting.

## What I'd do, in order

1. **Measure first (about 1–2 weeks).** Break down p99 into ingress/queue wait, gunicorn wait, DB time, external call time, and serialization. Confirm that queueing is the 900 ms. Check Postgres connection counts, slow queries, and N+1 patterns. Get a cost breakdown by line item (pods, Postgres, Celery, egress, logging, idle staging). The 3× cost growth may not come from the storefront at all.

2. **Fix the fan-out and timeouts.** Call recommendations and pricing concurrently. This should bring the critical path from about 120 ms down to about 80 ms. Set explicit timeouts and a fallback: if recommendations are slow, return the page without them. Unbounded timeouts are often what turns a slow dependency into a 900 ms p99.

3. **Change the worker model.** Options:
   - **gthread workers** (lowest risk): more concurrent requests per pod, no monkey-patching. Size the DB connection pool to match.
   - **gevent** (more concurrency): works well for I/O-bound sync Django, but needs careful monkey-patching and testing of every library.
   - **ASGI/async views** (largest change): only worth it for the fan-out endpoints. Django's ORM is still synchronous, so this is partial at best.

   I'd start with gthread, then load-test gevent if you need more.

4. **Scale on the right signal.** Use in-flight requests, worker utilization, or ingress queue depth through KEDA or a custom metric, not CPU. Then lower the minimum replicas off-peak and right-size the pod requests. This is likely the largest direct cost saving.

5. **Add PgBouncer** in front of Postgres. With 40 pods times several workers each, direct connections are probably a problem. Note that transaction pooling needs prepared statements and server-side cursors disabled in Django.

6. **Cache where staleness is acceptable.** Recommendations and listing-page prices can use short-TTL caches in Redis or local memory. Don't cache prices used at checkout without a clear freshness rule.

7. **Re-evaluate Go only for a specific hot path.** If profiling shows a CPU-bound service after steps 1–6, extract that one service. Don't rewrite the whole storefront.

## Why not Go now

- **Cost and time.** Rewriting a storefront API with the logic, auth, sessions, and pricing rules that Django already handles is a multi-month project for a team whose strength is Python and Django. You'd also run two stacks during migration.
- **Doesn't remove the bottleneck.** The external calls and Postgres still set the floor on latency.
- **Hiring and skills.** Go is a new skill for the team, and it changes what you can hire for.
- **Risk of divergence.** Pricing and business rules would have to be reproduced exactly, and that is where storefront bugs cost money.

If leadership still wants evidence, a time-boxed spike is a fair test: take one hot endpoint, implement it in Go with the same real dependencies, and load-test it against the Django version at peak traffic. I expect the difference to be smaller than the proposal assumes, because the dependencies dominate. That result would answer the question with data.

## Risks in this plan

- The measurements may show something different, such as slow queries or lock contention. The plan changes depending on the breakdown, so step 1 comes first.
- gevent and gthread change concurrency behaviour. Load-test them, including timeouts and pool exhaustion.
- Caching pricing or recommendations can show stale data. Agree the freshness rules with the business before shipping.
- Reducing pods too aggressively can hurt p99 during sudden spikes. Keep a sensible minimum and test scale-up speed.

## Before committing to anything

- The p99 breakdown from step 1.
- The cost breakdown by service, and whether the storefront is most of the growth.
- The current gunicorn config (workers, timeouts, max_requests) and whether workers are restarting or timing out.
- Pod resource requests against real usage, and the HPA's actual behaviour through a day.
- Postgres connection count at peak.
- A load test of the proposed configuration against the current one.
