# Recommendation for the parcel tracking API

## What I'd use

Build it with **Spring Boot and Postgres, the same stack you already run**, set up to fit in 512 MB:

- **Java 25 (LTS) and the current Spring Boot release.** If your other services are on an older baseline, match them unless there's a reason not to.
- **Spring MVC with ordinary blocking code.** Turn on virtual threads, or cap Tomcat's thread count. Don't use reactive (WebFlux).
- **Plain SQL through Spring's `JdbcClient`**, or Spring Data JDBC, instead of JPA/Hibernate. **Flyway** for schema changes.
- **A small connection pool** (HikariCP, about 5–10 connections).
- **Explicit JVM memory limits:** heap around 200–250 MB, plus caps on metaspace and code cache. The JVM already chooses the Serial garbage collector on a 1-vCPU machine, which is the right one here.
- **Spring's class-data-sharing / AOT cache** to speed up startup, which matters on 1 vCPU.
- Deploy it as a jar or container, **whichever way your other services already run**.

### Why

**Your team has to be able to review it.** The agent writes the code, but your three developers approve every change and fix it at 2 a.m. That only works in a language and framework they know well. Choosing conventional, well-documented Spring also gets you better code from the agent and makes its mistakes easier to spot.

**The load fits on one core.** 200 requests a second leaves 5 ms of CPU per request. A warmed-up Spring MVC endpoint that parses a small JSON body and does one insert uses roughly 0.5–1 ms. That's about 20–30% CPU at peak, with room left for customer lookups. The real limits are memory and the database, not Java's speed.

**512 MB is tight but workable.** A lean Spring Boot app (web, JDBC, actuator, nothing else) typically uses about 200–300 MB of memory. It stops fitting when you add JPA, many starters, or caches. Keeping it lean is the main design rule.

## Design points that matter more than the framework

1. **Scans must never be lost or counted twice.** Each scanner should give every scan a unique ID on the device. The API inserts with "ignore if already present", so retries are safe. The API only confirms a scan after Postgres has committed it. Avoid in-memory buffering, which loses confirmed scans if the process crashes.
2. **Expect bursts above 200/s.** When a depot's network comes back, every scanner sends its backlog at once. Offer a batch endpoint, and return "slow down" responses with a retry time (HTTP 429/503 with Retry-After). Scanners need to back off with some randomness.
3. **Keep customers from slowing down scanners.** Rate-limit the public status endpoint and give it its own small connection pool, or run it as a separate deployment of the same code. Look parcels up by tracking number plus something else (postcode, say) so people can't guess numbers and browse other customers' parcels.
4. **Plan for data growth from day one.** As an estimate, around 50 scans a second averaged over a working day is 1–2 million rows a day, several hundred million a year. Split the scans table by month (Postgres partitioning) and agree a retention period. Keep a small "current status per parcel" table, or limit lookups to recent dates, so status checks don't search every month's data.
5. **No message broker.** Kafka or RabbitMQ would mean another system to run in 512 MB and keep alive. At this volume, Postgres can take the writes directly.

## Alternatives I considered

| Option | Why not (or not yet) |
|---|---|
| **Go** | Technically the easiest fit for 512 MB (about 30 MB of memory, quick startup). But nobody on the team can review it properly, and that breaks your rule that IT reviews every change. Having the agent write it doesn't solve that. |
| **Node.js / Python** | Same review problem. Python is also slow on 1 vCPU. |
| **Quarkus or Micronaut (Java)** | A real contender: lower memory and built for small machines. It's my **Plan B** if Spring won't fit. I don't start with it because it would be a second framework for three people to know. |
| **GraalVM native image** | Cuts memory to about 100 MB and starts instantly. The costs are slow builds, reflection-configuration problems and harder debugging. Keep it in reserve as a memory fallback. |
| **Reactive (WebFlux)** | Unnecessary at this load. Code is harder to read and review. Virtual threads give the same benefit with ordinary code. |
| **JPA/Hibernate** | More memory and more hidden behaviour for a simple, write-heavy schema. Plain SQL is easier to review. |
| **Kafka/RabbitMQ in front** | More infrastructure than the problem needs. |

## Risks

- **Memory headroom.** If the app creeps past the limit, Linux kills it. Mitigations: explicit memory limits, a strict policy on new dependencies (the agent must justify each one), and memory checks in load tests.
- **The database VM is the real bottleneck.** If Postgres also has to run on 1 vCPU / 512 MB, the risk is its disk: 200 commits a second needs fast disk syncs, and shared hosting storage can be slow. Its CPU and memory are less of a worry.
- **One VM means one point of failure.** For reliability you want at least two app VMs behind a load balancer, plus Postgres backups with point-in-time recovery, ideally with a standby copy.
- **Slow startup on 1 vCPU** (roughly 10–20 seconds plus JIT warm-up). Rolling deploys across two VMs hide this; a single VM means an outage on every deploy.
- **Agent maintenance drift.** The riskiest changes are database migrations: locking a huge table at peak time can stop all scan writes. Give migrations extra review, write down the conventions for the agent, and don't give it production access.

## Check before you commit

1. **Run a spike on a real standard VM.** Build a minimal version, point it at the real Postgres setup, and load test at 2–3× peak (400–600/s) with a realistic mix of scans and lookups, including a reconnect burst. Measure memory, p99 latency, CPU and GC pauses. Gatling has a Java DSL, so the team can maintain the tests. This is the deciding test: if memory doesn't fit with margin, move to Quarkus or native image.
2. **Postgres placement and disk speed.** Where will it run, at what size? Run `pg_test_fsync` on the hosting company's storage.
3. **What the hosting company provides.** Load balancer, multiple VMs, backups and point-in-time recovery, TLS termination (doing TLS on the load balancer saves CPU on the app VMs).
4. **Scanner behaviour.** Who controls the scanner software? Can it create unique scan IDs, buffer offline, and back off on retries? If you can't change it, the design has to change.
5. **Retention and privacy.** How long to keep scans, and which personal data (addresses, signatures) is involved.
6. **Customer traffic estimate.** Will lookups be public? Linked from notification emails, which can cause spikes?
7. **Test and CI setup.** Can CI run Docker, for integration tests against a real Postgres (Testcontainers)? What monitoring do you already have?

**In short:** use the stack your team can review, keep it lean, design for retries and bursts, and let a one-week load test on the real VM confirm the choice before you commit.
