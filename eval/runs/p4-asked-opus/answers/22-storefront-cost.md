# Should the storefront API move to Go?

**Short answer: don't rewrite it in Go.** Your symptoms point to how the service handles concurrency and how it's scaled, not to the language. The service spends most of each request waiting on Postgres and two other services, and Go would mostly make that waiting cheaper. You can get most of that benefit in Python with configuration changes and a few targeted code changes, in weeks rather than a year, and your team keeps working in the language it knows.

## What I think is happening

- **Each sync gunicorn worker handles one request at a time.** A worker waiting 120 ms or more on the two services and Postgres holds its slot for that whole time while using almost no CPU. So a pod runs out of free workers long before it runs out of CPU.
- **CPU-based autoscaling can't see that.** CPU stays low, so the autoscaler never adds pods. Requests queue behind busy workers, and the queue is your 900 ms p99. The time spent doing actual work is probably much smaller.
- **This is probably also why the bill is high.** If CPU-based scaling never triggers, someone has likely set the minimum to about 40 pods to survive peak. That means you pay for peak capacity all day, and each pod reserves CPU it never uses.

Little's law makes this concrete: the number of requests in flight equals arrival rate × time per request. As an illustration (not your numbers), 800 requests/s × 0.2 s = 160 requests in flight. With 40 pods × 4 sync workers you have exactly 160 slots, so any burst queues. With threaded workers, the same CPU gives you several times as many slots.

## What I would do, in order

**1. Measure before changing anything (about 1 week)**
- Split p99 into **time spent queued** and **time spent processing**. Have the ingress or load balancer stamp each request with an arrival time, log the gap when the app picks it up, and add tracing around the Postgres, recommendations and pricing calls.
- Get a **cost breakdown by service**. The bill grew 3× faster than revenue, and the storefront pods may not be the main cause. Postgres size, Celery workers, logging and monitoring, and network egress are common culprits. The Go question assumes API compute is what's expensive; confirm that.
- Check the **autoscaler settings** (min/max pods), gunicorn worker count, memory per pod, and how full your nodes are.

**2. Change the worker model: gunicorn threaded workers (`gthread`)**
- This is a configuration change. For example, 2–4 processes × 8–16 threads per pod. Python releases the GIL while waiting on the network or database, so threads work well for this kind of load.
- I'd expect this to remove most of the queueing and let you run noticeably fewer pods.

**3. Call recommendations and pricing at the same time, and fail gracefully**
- If they don't depend on each other, run both calls in parallel with a small thread pool. Their combined wait drops from 120 ms to about 80 ms.
- **Check first:** if pricing prices the recommended products, the calls have to stay in sequence. In that case, batch the pricing call or cache it instead.
- Give recommendations a strict timeout and a fallback, such as cached or popular items. A slow recommendations service shouldn't push the whole page over budget, and its p99 is probably well above its 80 ms average.

**4. Cache where it's safe**
- Recommendations per user or product can be cached for a short time, or precomputed in Celery.
- Pricing can be cached for a short time only if checkout re-checks the price. Get the business to agree on that rule explicitly.

**5. Fix Postgres connections and slow queries**
- Threads multiply database connections, because Django opens one per thread. Add PgBouncer in transaction mode, or Django 5.1+'s built-in psycopg 3 connection pool, before you add threads.
- Use `pg_stat_statements` to find slow queries and the repeated per-row queries Django can generate in the hot endpoints.

**6. Scale on the right signal and right-size the pods**
- Autoscale on requests in flight or worker utilisation instead of CPU. KEDA or a Prometheus metrics adapter can do this.
- Lower the minimum pod count so the service shrinks off-peak.
- Set CPU and memory requests from what pods actually use. Over-reserved requests are what make you pay for extra nodes.
- Consider spot or preemptible nodes for a share of these stateless pods.

## Alternatives I considered

| Option | Why not, or not first |
|---|---|
| **Rewrite in Go** | It fixes concurrency because concurrency is built in, but `gthread` gets most of that for free. A rewrite costs many months of a 20-person Python team: you'd re-implement business logic, pricing rules and everything the Django ORM and admin give you, maintain two systems during the migration, and risk pricing bugs. Go's CPU efficiency only saves money when CPU is the cost, and here it isn't. |
| **gevent workers** | More concurrency per pod than threads, but it works by patching the standard library at startup, which brings surprises with C extensions and database drivers and makes debugging harder. Worth it only if threads turn out not to be enough. |
| **Async Django (ASGI)** | It helps with the outbound HTTP calls, but much of Django's async ORM still runs sync code in threads underneath. You'd rewrite views for little gain over `gthread`. Revisit later for specific endpoints. |
| **Just add more pods** | It fixes p99 by spending more, which makes the bill worse. |

## Risks

- **Thread safety.** Look for module-level mutable state, caches kept in globals, HTTP clients or SDKs that aren't thread-safe, and any code that relies on thread-locals. This needs a short code audit plus a load test.
- **Database connection growth.** Postgres can run out of connections or memory if you add threads before pooling.
- **GIL contention.** If serialization is CPU-heavy (Django REST Framework serializers often are), threads will compete for the GIL. Profile it. Faster JSON encoding (`orjson`) or leaner serializers on the hot paths fix this more cheaply than a new language.
- **Gunicorn timeouts.** Timeouts behave differently under `gthread`. Set explicit timeouts on every outbound call so a hung dependency can't tie up threads.
- **Load balancing.** Fewer pods that each handle more requests at once are more sensitive to uneven traffic. A least-requests policy at the ingress helps.

## Before you commit

1. Confirm that queue time is most of the p99.
2. Confirm the storefront API's share of the bill, and what drives it: CPU requests, memory, or the minimum pod count.
3. Find out whether pricing depends on recommendations, and get the p99 of both services, not just their averages.
4. Check Postgres `max_connections` headroom and decide on pooling.
5. Run a staging load test at peak traffic with `gthread`, measuring p99, pods needed and database connections. Then canary it on a few production pods.

**When Go would make sense:** if, after all this, profiling shows a specific CPU-heavy hot path that you can't fix in Python. Even then, build a small Go service for that one path rather than rewriting the whole API.

**What success looks like:** p99 under 300 ms at peak, a noticeably smaller pod count off-peak, and a cost breakdown you can show leadership as the answer to the Go question.
