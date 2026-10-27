## Recommendation

Build it as a **Spring Boot service in Java** (current LTS JDK), talking to **PostgreSQL** through plain JDBC (Spring's `JdbcClient` or `JdbcTemplate`), not JPA. The team knows Java, can maintain it, and the agent can produce and test it. The design should be deliberately small: one service, one database, no message broker.

The real problem is not the write rate. Postgres can absorb 200 small inserts a second on modest hardware. The hard constraint is **512 MB of RAM with one vCPU**, because the JVM, the app, and the database all compete for it. That needs to be settled before anything else.

## Why this stack

- **Java is the only back-end language the team has.** Even if the agent writes the code, three Java developers will get the 2 a.m. call. A Go or Rust binary would use less memory, but it would add a language nobody in the company can debug.
- **Spring Boot is familiar and well-documented,** so the agent is less likely to produce unusual code, and the team can read the logs and the Actuator health endpoints.
- **JDBC instead of JPA on the hot path.** JPA adds memory, CPU, and hidden query behavior. Ingest is a simple insert, and status is a simple lookup, so plain SQL is easier to reason about and cheaper to run.
- **Batch writes.** Scanners should send several scans per request where possible, and the server should insert them in one transaction. That cuts per-request overhead far more than any framework choice.

## Alternatives considered

- **Quarkus or Micronaut (Java):** lower memory and faster startup than Spring Boot. This is the strongest alternative if the memory measurements below come out tight. It stays in Java, but it is less familiar to the team, so I'd only switch if Spring Boot doesn't fit.
- **Go or Rust:** best resource use, but a new language for the company. Rejected on maintainability.
- **Node or Python:** similar memory issues to Java for less benefit, and the same language-mismatch problem.
- **Kafka or RabbitMQ between scanners and the database:** far too much to run on a 512 MB machine, and unnecessary at this volume. Use a synchronous batch endpoint, or at most a Postgres table as a queue.
- **Cloud functions or managed services:** excluded by the hosting policy.

## Risks

1. **Memory.** A Spring Boot JVM realistically takes 200–300 MB resident, and with the OS that leaves little room. If Postgres runs on the same 512 MB machine, it will not fit well. Either the database lives on another machine, or the VM gets more memory. A 1 GB VM is probably cheaper than the engineering time spent squeezing a JVM into 512 MB, so this may need a policy exception.
2. **Scanner connectivity.** Handhelds in warehouses and trucks lose signal. Scanners need local buffering and retries, and each scan needs an idempotency key (device ID plus scan sequence number) with a unique constraint, so a retry never creates a duplicate.
3. **Clock skew.** Handheld clocks drift. Store both the device timestamp and the server receipt time, and decide which one drives "latest status."
4. **Status queries.** Customer lookups must not scan the event history. Keep a small "current status" table updated on write, indexed by parcel ID.
5. **Growth.** Scan history grows fast. Plan retention and partitioning by month from day one, or the disk will fill quietly.
6. **Agent-built code.** An agent can add dependencies and layers you did not ask for. Constrain it: pinned dependency versions, a written spec, a small allowed-dependency list, required tests, and schema changes only through a migration tool (Flyway or Liquibase).
7. **"Nobody reads the code."** That works for IT operations, but someone on the three-person dev team should review the ingest path, the schema, and the migrations. These are the parts that cause data loss.

## What I'd check before committing

- **Prototype on the real target:** a 1 vCPU / 512 MB VM with Postgres in its real location. Load test at 200 scans/s sustained and at roughly 3× for bursts, for at least an hour. Record resident memory, GC behavior, p99 latency, and database disk growth.
- **JVM settings:** a fixed heap cap (around 200–256 MB), a small GC like SerialGC, and a small connection pool (about 5–10). Measure before accepting them.
- **Where Postgres runs,** its memory settings, and whether the hosting policy allows a bigger VM or a separate database host.
- **Real numbers from the business:** peak scans per second (not average), number of status checks per second, retention period, and expected row counts per year.
- **Scanner behavior:** does the handheld app support batching, retries, offline storage, and idempotency keys? If not, that is a separate piece of work and may be the larger one.
- **Operations:** a runbook, backup and restore test (restoring a backup is what matters, not just taking one), disk-space alerts, a health endpoint, and a restart policy (systemd).
- **Agent guardrails:** the spec, the test suite, the dependency list, and the migration approach agreed in writing before the agent starts.

If the prototype shows the JVM comfortably inside 512 MB with the database elsewhere, go with Spring Boot. If it doesn't, the first thing to change is the VM size, not the language.
