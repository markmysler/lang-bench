# Payment-status service: what to build it with

**Recommendation:** build it in Java 21 and Spring Boot, using your standard platform setup. Turn on virtual threads, use plain blocking JDBC, and keep the dependency list short. Don't use Go for this service.

The "lighter" argument is true in a narrow sense. It just doesn't matter for this workload, and adopting Go would cost you a lot more than it saves.

## Why Java and Spring Boot

- **The load is modest.** 800 requests a second of simple indexed reads is well within what a few Spring Boot pods can handle. Your p99 will depend on Postgres, the network and connection pool waits, not on the language. A rough check: if a query takes about 5–10 ms, 800 req/s needs only about 4–8 database connections busy on average. Go wouldn't make the database any faster.
- **It's approved and supported.** No security review, no new item for the architecture board, and the long-term support story is one you already manage.
- **Your existing tooling works on day one.** That includes shared libraries (authentication, audit logging, tracing, error handling), CI pipelines, SAST and dependency scanning, base images, dashboards and runbooks. In Go, each of these would have to be rebuilt or approved again before this service could go live.
- **Operations and staffing.** 600 engineers can read, review, support and take over a Java service. A Go service would rely on whichever few people know Go, and that is a real risk for something that sits on the mobile banking path.
- **The design can stay simple.** With virtual threads you get high concurrency from straightforward blocking code, so you don't need reactive programming.

## What "lighter" actually means here

| | Go | Spring Boot (tuned) | Does it matter here? |
|---|---|---|---|
| Memory per pod | ~50–150 MB | ~300–700 MB | Across 3–4 pods per data centre, the difference is a few GB of RAM. That's small next to the cost of adding a language. |
| Startup time | <1 s | ~3–10 s | Only matters for scale-to-zero or very bursty autoscaling. Neither applies to a steady internal API. If needed, Spring AOT or class data sharing (CDS) cut it down. |
| Container image size | Small | Larger | Has no effect on behaviour at runtime. |
| Raw request speed | Similar | Similar | The database is the bottleneck either way. |

Ask the team what they mean by "lighter" in concrete terms. Often the real complaint is your internal Spring "chassis": too many starters, slow builds, lots of boilerplate. That's worth fixing, but you fix it by trimming the template, not by switching language.

## Alternatives I considered

- **Go.** Covered above. The case for Go would be an organisation-wide decision to adopt it, made by the architecture board with a plan for skills and tooling. It shouldn't come in through one service. If a team wants to make that case, that's a separate conversation.
- **Spring WebFlux (reactive).** It adds complexity for debugging, tracing and hiring, and virtual threads give you the same benefit at this load. Not needed.
- **Quarkus or Micronaut.** They use less memory and start faster, but only make sense if they're already on your approved list. Even then, using something different from your Spring standard for small gains isn't worth it.
- **GraalVM native image.** It narrows the memory and startup gap with Go. But builds get slower, reflection has quirks, and it's another thing to support. Keep it in reserve in case startup or memory ever becomes a measured problem.

## Risks: none of them are about the language

1. **Replica lag.** A payment can complete while the app still shows "pending". Agree with the product owner how stale the status is allowed to be. Monitor lag and decide what the service does when lag goes over that limit.
2. **Unauthorised access (IDOR).** This is the biggest real risk. Every request must check that the payment belongs to the logged-in customer. Enforce it in the query itself, not just with a check afterwards, and test it explicitly.
3. **Connection limits on the replica.** Pods × pool size × both data centres can exceed the replica's `max_connections`, or compete with whatever else reads from it. Size the pools deliberately.
4. **Timeouts and slow failures.** Set the database query timeout and connect timeout well inside the 150 ms budget. Add a circuit breaker so a slow replica produces fast errors instead of piling up requests.
5. **Two data centres.** Where is the replica? If pods in data centre B read from a replica in data centre A, every call pays the round trip between sites, and you need a failover plan.
6. **Load driven by polling.** If the 800 req/s comes from the app repeatedly polling, load will grow with the user base. A short cache or a push model based on Kafka events could help later. Design for it, but don't build it yet.
7. **Audit and compliance.** Decide whether reads of payment status need audit logging. Use the standard library for it rather than writing your own.
8. **Support versions.** Make sure the service starts on the Spring Boot and JDK versions your platform team currently supports. Java 25 LTS is out, so check what the board's plan for moving off 21 is, and avoid starting on a line that's close to its support end.

## What I'd check before you commit

- **A small prototype and load test.** Build a thin Spring Boot version and test it on OpenShift against a replica with production-sized data, at 2× peak (1,600 req/s). Measure p99 at the edge of the cluster, not inside the app. If it meets the target with headroom, the "lighter" question is answered with data.
- **The query plan.** Run `EXPLAIN ANALYZE` on the real lookup and confirm the right index is used on the replica.
- **Replica capacity.** Find out the connection headroom, current load, typical and worst-case lag, and who owns it.
- **Freshness and authorisation.** Get the freshness requirement and the authorisation model written down and signed off by the product owner and security.
- **Go's status on the approved list.** If Go is already approved, the argument is weaker, but standardisation and existing tooling still favour Java for this service.
- **The "lighter" conversation.** Hear out the team's specific complaints and turn them into improvements to the Spring template that every team benefits from.

**In short:** this is a small, database-bound read service. Java and Spring Boot will meet the target easily, and they keep you inside your compliance, audit and support standards. The real work is in replica freshness, authorisation, pool sizing and timeouts, and those are the same whatever language you pick.
