# Online cancellations: what to know first

**The April decision no longer holds, and I'd reopen it before building anything.** The decision was right for its premise (40 rps, 17 workers), but the premise has changed.

## Why the old decision breaks

By Little's law, concurrent in-flight requests ≈ arrival rate × time per request.

- **Last spring:** 40 rps × ~0.4 s ≈ 16, which matches the 17 workers.
- **Next month:** 600 rps × 0.2–0.6 s ≈ 120–360 requests waiting on the insurer at once. Allowing for your own processing time, that's roughly 250–400 sync workers at peak.

Raw worker count isn't the only problem:

- **Memory:** 300 worker processes at 60–100 MB each is 18–30 GB of containers, mostly idle and waiting on the network.
- **Postgres connections:** one connection per worker means ~300 connections. That likely exceeds `max_connections` or forces you onto a pooler.
- **Insurer slowdowns:** if their latency goes from 400 ms to 2 s, you need five times the workers. The pool saturates, health checks fail, and containers restart under load. That is the failure you least want at 8 am.
- **Insurer limits:** I don't know whether the insurer will accept 15× your current traffic. Their rate or concurrency limits may be the real ceiling.

## Options for the capacity problem

| Option | Verdict |
|---|---|
| **gunicorn `gthread` workers** (e.g. 8 processes × 32 threads) | **My first choice.** It's a config change plus an audit, it stays in Flask, and threads release the GIL during network waits. I'd check thread-safety (globals, per-request state), the DB session and pool setup, and per-thread memory. |
| **Scale out sync workers** (more containers, no code change) | **The safe fallback.** It works but is expensive and still fragile when the insurer slows down. It also needs a pooler like PgBouncer. |
| **gevent workers** | Viable and efficient, but the riskiest for a six-person team. Monkey-patching affects every library, and `psycopg2` needs `psycogreen` or a move to `psycopg3`. Bugs tend to be subtle and show up only under load. |
| **Async rewrite** (Quart, FastAPI) | No. It rewrites the whole API and its ORM and DB layers, and the work wouldn't land before next month. |
| **Cache eligibility results, or make the check asynchronous** | **Worth discussing, but it's a product question.** If eligibility is stable for a patient and plan over some window, a short cache could cut insurer calls a lot. Confirming a booking as "pending eligibility" changes behaviour, so it needs a business decision. |

Whichever you pick, add a hard timeout on the insurer call, a circuit breaker, and a defined behaviour when the insurer is down. Today a slow insurer just consumes workers.

## Cancellation design

I'd treat this as a state transition on the booking, not just a delete.

- **State machine:** `confirmed → cancelled`, with timestamp, actor and reason, and no hard delete. Healthcare needs the audit trail.
- **Concurrency and idempotency:** use a conditional update, or `SELECT … FOR UPDATE`, so double clicks, retries, and a cancel racing a reschedule can't corrupt state. A repeated cancel returns success, not an error.
- **Authorization:** the caller must own the booking, or be staff or the clinic. This is the highest-risk bug class for patient data.
- **Slot release:** cancelling frees a slot while other people are trying to book. Make sure release and rebooking can't double-book, and that your existing booking path handles the freed slot correctly.
- **Side effects off the request path:** confirmation emails or SMS, waitlist notifications and insurer notification should go through a queue or an outbox row, not run inside the request. Never hold a DB transaction open across an external call.
- **Isolation from the booking rush:** if cancellation is fast and local, put it on a separate gunicorn deployment, or at least a separate route group with its own capacity. Otherwise a slow insurer can block people from cancelling.
- **PHI hygiene:** keep patient details out of logs and error messages.

## Questions to answer before we commit

1. **Is 600 rps the total or booking calls only?** What share of requests hits the insurer?
2. **What is the real latency distribution?** I'd want p50, p95 and p99 from production, plus how it behaves when the insurer is slow.
3. **What are the insurer's limits?** Check the contract for rate and concurrency caps at 600 rps, and ask whether they know the volume is coming.
4. **What are your Postgres limits?** I'd check `max_connections`, the current pool settings, and whether a pooler exists.
5. **Does cancellation involve the insurer?** Does it release a reservation, void an eligibility check, or trigger a notification? That decides whether it's a cheap local write or another slow external call.
6. **What are the business rules?** I'd want the cancellation window, any fees or late-cancel policy, who may cancel (patient, clinic, staff), whether it's partial or whole, and whether a reason is mandatory.
7. **What can the cloud platform do?** Check container limits, autoscaling speed (rush hour can arrive faster than scale-up), and load balancer timeouts versus gunicorn's `timeout`.

## Suggested order

1. **This week:** run a load test at 600+ rps against a stub insurer with realistic 200–600 ms latency, plus a degraded case at 2 s. Run it against the current config to prove the problem, then against `gthread`. That gives you evidence for the decision, and the written record should say what changed.
2. **In parallel:** build cancellations. The design above doesn't depend on the concurrency model, apart from the isolation point.
3. **Before go-live:** the capacity change, load test results, and insurer limits confirmed.

I haven't looked at your code. This is based on what you've described. Once I can read the repo, I'd check the specific concerns first: thread-safety of shared state, DB session handling, and how the booking flow handles slot contention.
