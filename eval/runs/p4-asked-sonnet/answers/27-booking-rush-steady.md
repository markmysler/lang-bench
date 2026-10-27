# Online cancellations: plan and what to check first

I haven't looked at your code or metrics yet. Everything below comes from your description, and the checks at the end would confirm or change it.

## Short answer

I'd build cancellations on the existing Flask, sync-worker and Postgres stack, and keep last spring's decision. Cancellation is mostly a database state change, so it doesn't add the long waits that made gevent and async attractive.

Your numbers are tighter than "coped" suggests, though. At 40 requests/s and a mean insurer call of about 400 ms, bookings alone keep roughly 16 of 17 workers busy at peak. That is only true if every request waits on the insurer, and many probably don't. But it's the first thing I'd measure. A small increase in load or a slow insurer would push you into queueing, and the morning rush is when you can't afford that.

## What I'd use

- **Cancellation as a status transition, not a delete.** Add a `cancelled` state with timestamp, actor and reason. Healthcare data needs an audit trail, and a delete also breaks reporting and disputes.
- **Concurrency handled in Postgres.** Use a conditional update or `SELECT ... FOR UPDATE` on the booking row, so double-clicks, a cancel racing a reschedule, and a cancel racing the clinic's own change all resolve safely. Make the endpoint idempotent, so cancelling twice returns the same result.
- **Slot release in the same transaction as the status change.** The freed slot goes back to availability atomically.
- **Anything slow or external done outside the request.** That covers notifications, waitlist offers and any insurer notification. I'd use a transactional outbox table in Postgres plus a small separate worker process, or your existing queue if you have one. The request commits and returns fast, and a slow insurer can't hold a gunicorn worker.
- **Authorization checks.** The patient or an authorized delegate can cancel only their own booking. Log every cancellation for audit.
- **Business rules agreed up front.** These are cancellation windows, late-cancel fees or flags, and what happens to an insurer authorization tied to the booking.

## Alternatives considered

- **gevent workers.** This is the lightest way to get concurrency, and it stays in Python. The costs are monkey-patching and making sure the Postgres driver is cooperative (psycogreen or similar), plus subtle failures when a library blocks the event loop. It's a reasonable fallback, but it doesn't help cancellations much, so I wouldn't tie it to this feature.
- **Async/ASGI rewrite.** This is a large change for six developers, and it spreads across the codebase through the ORM and drivers. It's not justified by this feature or by 40 requests/s.
- **Just add workers or containers.** This is the cheapest option if memory allows, and it's what I'd try first if headroom is thin. It costs more per request than gevent but carries no new failure modes.
- **Calling the insurer inline during cancel.** I'd avoid this. It puts the slow dependency on a path that should be fast. The only exception is if the insurer requires synchronous confirmation, which is something to check.

## Risks

1. **Insurer slowdown.** This matters more than the new feature. If the insurer goes from 400 ms to 2 s during the rush, capacity drops about 5x and every endpoint stalls, cancellations included. Tight timeouts, a circuit breaker and a defined degraded behavior matter more than the worker model.
2. **Cancellations clustering with the rush.** Patients may cancel right when others are booking, so they compete for the same workers and rows.
3. **Hot rows and lock contention** on popular slots, if cancel and book both lock the same availability row.
4. **Postgres connections.** Adding workers or containers multiplies connections, so check `max_connections` or the pooler.
5. **Race and policy edge cases.** These include cancelling after the appointment time, partial cancellations, and a slot released while a booking is mid-flight.
6. **Stale decision record.** The written decision assumed 40 requests/s and a fixed set of endpoints, so it needs updating.

## What I'd check before committing

1. **Does cancellation need to talk to the insurer** (release a hold, void an authorization)? This is the biggest question. If not, the sync decision is untouched. If yes, it goes through the outbox.
2. **Real worker utilization at peak.** I'd want busy workers over time, request queue or backlog, and p95/p99 latency, not just the average. Also check whether 17 workers is the total across containers.
3. **Share of requests that actually hit the insurer.** This tells us the true load against the 17 workers.
4. **Current insurer timeout and failure handling.** Is there a timeout on the call, and what happens to the request when it fires?
5. **Expected cancellation volume and timing.** Ask product or support for the rate, and whether it's concentrated in the morning.
6. **Load test with a stubbed insurer at degraded latency** (for example 1 s and 2 s) plus the cancellation mix, to see where it breaks.
7. **Database limits.** Check connection headroom and whether the locking plan creates contention on availability rows.
8. **Policy owners.** Get clear answers on fees, windows and notification rules from the business side before building them.

I'd also add revisit triggers to the decision doc, such as peak utilization above about 70%, insurer p95 above 1 s, or sustained load above about 80 requests/s. That way gevent comes back up because of a measurement, not a review.

If you can share the repo and the peak-hour metrics, I'll start with checks 1 to 4, since they decide the rest.
