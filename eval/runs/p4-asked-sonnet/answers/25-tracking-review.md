# Recommendation: Spring Boot on Java 21 or later, built lean, with a load test before you commit

## What I'd use

- **Language and framework:** Java with Spring Boot, using plain Spring MVC (not WebFlux). Run it on the current LTS JDK.
- **Database access:** Spring's `JdbcClient` or `JdbcTemplate` with hand-written SQL, rather than JPA/Hibernate. This saves memory and startup time. The SQL is also easy for your team to review, and for this workload a reviewer should see exactly what hits the database.
- **Schema:** Use an append-only `scan_events` table plus a small `parcel_status` table holding the latest state per parcel. Update both in the same transaction, so customer status lookups are single-row primary-key reads. They never aggregate over scan history.
- **Idempotency:** Every scan carries a device-generated ID, and inserts use `ON CONFLICT DO NOTHING`. Handhelds in vans lose signal and retry, so duplicates are certain unless you design them out.
- **Runtime tuning:** The JVM has to share 512 MB with the OS, so cap the heap at roughly 256–300 MB. Also cap metaspace and thread stacks, use a small Tomcat thread pool, and use a small Hikari pool (about 5–10 connections). Use a single-CPU-friendly GC (Serial, or G1 with a small heap).
- **Dependencies:** Keep the dependency list short. Use no message broker, no Redis, and no extra starters unless a measurement justifies them. Every dependency costs memory and review effort.
- **Postgres:** Don't run it on the same 512 MB VM as the API. It needs its own memory budget, and it is your real single point of failure.

## Why

- **Volume:** 200 small writes a second is modest for Postgres and for Spring MVC. The constraint is the single vCPU, which has to handle TLS, JSON parsing and JDBC round trips. I expect this to fit, but that is an estimate and I haven't measured it.
- **Review and maintenance:** You said IT reviews every change and has to keep it running. A coding agent writes code quickly, but a human gate only works if the humans can read what comes out. That points to Java more strongly than any performance argument does.
- **Operations:** Your team already knows how Spring services behave when they fail: logs, heap dumps, Actuator, connection pool metrics.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| **Go or Rust** | They have the best footprint, but no one on your team can properly review or maintain them. That undermines the review gate, and you'd be on call for code you can't debug. The savings aren't needed for 200 writes a second. |
| **Node.js or Python** | Same skills problem, with less performance headroom on one vCPU. |
| **Quarkus or Micronaut** | They are lighter than Spring, but the gain is small next to the cost of retraining the team. They're a fallback if Spring doesn't fit. |
| **Spring Boot native image (GraalVM)** | It cuts memory and startup time, but builds are heavy, reflection config is fiddly and debugging is harder. I'd keep it as plan B if measurements show the JVM doesn't fit. |
| **WebFlux or reactive** | It adds complexity the load doesn't need, and the code is harder to review. |
| **Kafka or another queue in front** | It's overkill, and it costs memory and operational burden you don't have people for. |
| **JPA/Hibernate** | It works, but costs more memory and startup, and hides the SQL. I'd choose it only if the team strongly prefers it. |

## Risks

1. **Memory is the tightest limit.** A mis-sized heap gets the process OOM-killed by the OS. The cause is usually native memory (threads, metaspace, buffers), not heap.
2. **Bursts may matter more than the average.** If 200/s is a sustained peak, that is fine. If scanners reconnect at depots and flush their queues together, spikes could be several times higher. You need backpressure, bounded queues and sensible timeouts, so that it degrades gracefully instead of falling over.
3. **A single VM is a single point of failure.** One instance means every deploy or crash is an outage for the drivers. Running two instances behind the hosting company's load balancer is cheap insurance, but it needs agreeing with them.
4. **Postgres is the bigger reliability risk.** Backups, restore tests and failover matter more than the API language.
5. **Data growth.** At sustained peak that is up to about 17 million rows a day. Decide on retention and on partitioning by date early, because retrofitting it is painful.
6. **The public status endpoint is exposed to customers.** It needs rate limiting, and it must not be able to starve the scanner writes on a single CPU.
7. **Agent-generated code volume.** The agent can produce changes faster than three people can review them well. Keep PRs small, and keep the conventions in a written file the agent follows. Review migrations and SQL with extra care.

## What I'd check before committing

1. **Load test on the real VM spec:** 1 vCPU and 512 MB, with TLS on, realistic payloads, a real Postgres, and reads mixed with writes. Test at 2–3× expected peak, and note where it breaks. This is the decision gate. If it fails, try tuning, then Quarkus or native, before considering another language.
2. **CPU steal and memory policy at the hosting company.** Check whether the VMs are oversubscribed and whether they allow swap or ballooning.
3. **Scanner behavior.** Find out which protocol and authentication the handhelds support, whether they can batch scans, how they retry, and whether they can generate unique scan IDs.
4. **Real traffic numbers.** Get actual figures for the average and peak scan rate, burst shape, and customer status-check volume.
5. **Where TLS terminates.** A shared reverse proxy or load balancer costs less than running nginx on the same small VM.
6. **Postgres hosting.** Where it runs, how big it is, how backups work, and who restores it.
7. **Availability target.** Settle how much downtime is acceptable, because that decides whether you need a second instance.
8. **Agent guardrails.** Agree on conventions, a banned-dependency list, and required tests before the first line is written. Run integration tests in CI, not on the VM.

I'd start with a thin vertical slice (one scan endpoint, one status endpoint, the schema) and load-test it within the first week. That tests the one assumption everything else rests on.
