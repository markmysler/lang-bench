## Recommendation: build it in Java 21 and Spring Boot

Use the standard stack. The Go suggestion doesn't survive the numbers, and the cost of adding a language is large.

**Why Java/Spring Boot**

- **The load is modest.** 800 req/s at peak is a small load for a service doing one indexed lookup. A few Spring Boot pods per data centre should handle it with headroom. Verify with a load test, but I'd expect this to be well within one pod's capacity.
- **The latency budget isn't set by the language.** Under 150 ms p99 is mostly consumed by the gateway, auth, network hops, and the DB round trip. A lookup on a replica is typically a few milliseconds if the index is right. The real risks are connection-pool queueing and slow queries, and those are the same in any language.
- **"Lighter" is true but doesn't matter here.** Go will use less memory and start faster. Spring Boot pods typically need a few hundred MB, so the difference is maybe a gigabyte across the fleet. That's a small cost next to months of security review and a second runtime to operate.
- **Java 21 gives you concurrency cheaply.** Virtual threads let blocking JDBC calls scale without a reactive rewrite.
- **Compliance and support.** Java is already approved, and your teams already have the tooling for logging, tracing, patching, SBOMs, and audit. Go would need its own review, its own base images, its own vulnerability scanning, and its own on-call knowledge.
- **Your people.** Your strength is very strong Java. A Go service would be owned by a small group and become a bus-factor risk.

**Alternatives considered**

- **Go:** technically fine, but it needs a security review that takes months, adds a runtime, and buys little. Only worth it if the review is already done or you are standardising on it.
- **Quarkus or Micronaut (Java):** faster startup and lower memory than Spring Boot, still Java. Worth a look only if they're on the approved list and you have a concrete problem to solve. Spring Boot is the default.
- **Kotlin on the JVM:** possible, but it adds a language and tooling choice without a clear benefit for this service.
- **Node, Python, Rust:** no advantage here, and each would need approval.

**Risks**

1. **Replica lag and stale status.** A customer pays, then the app shows "pending" because the replica is behind. Define the acceptable lag, measure it under peak write load, and decide how the app handles a status that hasn't caught up yet.
2. **Shared database coupling.** Reading straight from a replica of the payments database ties the new service to that schema. Schema changes, heavy reporting queries, and maintenance can affect it. Consider whether a read model fed by Kafka events, in its own Postgres, is better long-term. For a first version, the replica may be acceptable if the owning team agrees and the coupling is documented.
3. **Connection exhaustion.** Pods × pool size can exceed the replica's connection limit, especially during scale-out. Size the Hikari pool against the replica's `max_connections` across all pods and data centres.
4. **Authorisation.** A mobile API that returns payment status must ensure a customer sees only their own payments. This is a higher risk than performance. Define how the token maps to account ownership and test it explicitly.
5. **Data exposure.** Payment data is sensitive. Use a read-only DB role with the minimum columns needed, mask or omit PII in logs, and make sure audit trails capture who queried what.
6. **Replica capacity.** If other consumers already use the replica, the new 800 req/s may degrade them. Check current load first.
7. **Slow queries under load.** A query that is fast on a quiet replica can slow down under concurrency. Check the plan with `EXPLAIN (ANALYZE, BUFFERS)` against production-sized data.

**What to check before committing**

1. **Load test on the real replica** at 800 req/s with realistic payment IDs and a realistic cache-miss rate. Measure p99 at the service boundary, not just the DB.
2. **Query plan and indexes** on the status lookup, using production-sized tables.
3. **Replica lag** at peak write volume, its historical p99, and the owner's SLA for it.
4. **Pool sizing** against the replica's connection limit, including the DR data centre.
5. **Whether the replica is shared**, and what else runs on it.
6. **The authorisation model** for the mobile API, reviewed by security before build, not after.
7. **Approved-list status** of every dependency: Spring Boot version, Hikari, the Postgres driver, and any Kafka client.
8. **Resource limits on OpenShift:** heap settings (`MaxRAMPercentage`), startup time for scale-out, and the HPA target. Measure actual RSS under load.
9. **Ownership** of the replica, the schema, and the on-call rota for both.

If the load test passes comfortably and the replica owner agrees to the coupling, build it in Spring Boot. If the team still wants Go, ask them to show the measured memory and latency gap at this load and to name the security review timeline. In my view, neither would change the decision.
