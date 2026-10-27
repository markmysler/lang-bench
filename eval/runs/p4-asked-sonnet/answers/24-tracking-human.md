# Recommendation: Spring Boot on a plain JVM, with Postgres

**Build it with what IT already knows.** Use Spring Boot on the current LTS JDK, with Postgres as the only data store. Keep it small and deliberately boring.

## Why this fits

- **The load is modest.** 200 small writes a second is easy for Postgres and for a lean Spring Boot service, even on one vCPU. Each request gets a CPU budget of a few milliseconds, and parsing a small JSON payload and doing one insert fits well inside that.
- **The real constraint is memory, not throughput.** A 512 MB VM has to hold the OS (~100 MB), the JVM heap, metaspace, thread stacks and code cache. That leaves a heap of roughly 200–250 MB. This is workable for a service that does little else, but only if we stay disciplined (see below).
- **Your team's skills decide the maintenance cost.** The system will run for years, and three Java developers have to keep it alive at 3 a.m. Using a language nobody else knows would cost far more than the few euros a month saved on hardware.

## How to keep it lean

- **Database on its own VM.** Don't put Postgres on the same 512 MB machine as the API. They'd compete for memory, and a problem in one would take down the other.
- **Light data access.** Use plain JDBC (`JdbcClient`/`JdbcTemplate`) rather than JPA/Hibernate. The API has few tables and simple queries, so Hibernate's memory and startup overhead buys little.
- **Few dependencies and a small connection pool.** Include only the Spring starters you need, and keep the pool to about 5–10 connections.
- **Platform threads, bounded pool.** Virtual threads wouldn't help on one vCPU at this scale.
- **Idempotent writes.** Each scan carries a unique ID, and a database unique constraint makes retries harmless. Handhelds on mobile networks will retry, so this matters more than any performance tuning.
- **Simple status reads.** Keep a "current status" row per parcel, updated on each scan, or use an index on the latest scan. Customer lookups then stay cheap. If needed, add a small in-process cache before considering Redis.
- **Backpressure.** When overloaded, return `503` with a retry hint rather than queuing without limit and running out of memory.
- **TLS at a proxy or load balancer.** Handshakes are costly on one vCPU, and scanners should reuse connections.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| **GraalVM native image** | It uses far less memory (~100 MB) and starts fast. But builds are slower, reflection and library issues are common, and debugging is harder. **This is the first fallback** if the JVM doesn't fit, not the starting point. |
| **Quarkus / Micronaut** | Somewhat leaner, but they mean a new framework for the team. The gain is marginal compared with a well-tuned Spring Boot. |
| **Go, Rust, Node** | Very light and fast, but nobody on the team can maintain them. This is the biggest long-term risk to reliability. |
| **Kafka / RabbitMQ in front of the database** | Too heavy for 512 MB, and it adds a second system to run. Postgres handles 200 inserts a second directly. |
| **Redis for status caching** | Another component to operate. Try indexes and a small in-process cache first. |
| **Serverless / managed cloud** | Ruled out by your hosting policy, and the cost is less predictable. |

## Risks

1. **Single VM means a single point of failure.** Plan at least two API instances behind a load balancer, and a Postgres backup with a restore we have actually tested. Ideally add a replica.
2. **Memory creep.** The JVM can be killed by the OS if native memory (threads, buffers, metaspace) isn't accounted for. Set explicit limits and measure the real resident size, not just the heap.
3. **Noisy neighbours.** "1 vCPU" on shared hosting may not be a dedicated core. CPU steal can cause latency spikes during peaks.
4. **Customer traffic competing with scans.** A burst of status checks must not delay scan ingestion. Use separate connection pools, or separate instances, for ingest and for customer reads.
5. **Data growth.** At sustained peak, scans could reach hundreds of millions of rows a year. Partitioning by date and a retention policy should be designed in from the start, not added later.
6. **Offline scanners.** Handhelds in vans lose coverage and may upload bursts of old scans afterward. The API must tolerate that, including out-of-order timestamps.
7. **My numbers are estimates.** I haven't measured anything on your hardware. The sizing above should be treated as a hypothesis to test.

## What to check before committing

1. **Build a two-week prototype and load-test it** on the actual VM type, with a realistic mix of scan writes and customer reads. Measure resident memory, CPU, p99 latency and GC behaviour, with a peak test and a long soak test.
2. **Get real volumes:** average and peak scans per day, number of customers and their lookup rate, and how long scans must be kept.
3. **Confirm the database setup.** Does the policy allow a larger VM for Postgres, or at least a separate 512 MB one? Ask the hosting company whether CPU is dedicated or shared.
4. **Clarify scanner behaviour:** does the app batch uploads, how does it retry, and how are devices authenticated?
5. **Agree recovery targets:** how much data loss and downtime is acceptable (RPO/RTO), and who restores from backup.
6. **Plan operations:** monitoring and alerting (Spring Actuator metrics are enough to start), log retention, and who patches the JDK and Spring Boot and how often.
7. **Decide the escape hatch in advance.** If the prototype is tight on memory, try these in order: trim dependencies and tune the JVM, then class-data sharing, then native image. The last option is to ask for a policy exception for a 1 GB VM. That costs only a few euros a month, which is almost certainly less than the developer time spent squeezing into 512 MB.

**Bottom line:** the Java team, Spring Boot and Postgres are the right choice. Prove it on real hardware with a short prototype before committing, and put reliability (two instances, tested backups, idempotent writes) ahead of squeezing out more efficiency.
