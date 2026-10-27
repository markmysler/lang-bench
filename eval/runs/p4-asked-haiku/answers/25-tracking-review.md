## Recommendation

Build it in **Java with Spring Boot** (current LTS Java, Spring Boot 3.x), with Postgres as the only data store. Keep the footprint deliberately small. The main risk is memory on a 512 MB VM, not language choice, so the first step is a measured prototype.

**Why Spring Boot:**
- Your three developers already know it, so IT can review every agent-written change without learning a new language or framework.
- It is the most reviewable option for your team. Other choices would add reviewer burden that matters more than raw efficiency here.
- 200 small writes per second is a modest workload for Postgres. Most of the work is HTTP handling and JDBC, which Java does well.

**How to keep it inside 512 MB:**
- Set the heap explicitly (roughly 200–256 MB) and use a small GC (Serial or a small-heap G1 setup). Measure the result rather than trusting a rule of thumb.
- Keep the web layer lean: a small Tomcat thread pool, and no unused starters.
- Use plain JDBC or JdbcTemplate with batched inserts instead of heavy JPA for the scan path.
- Use a small connection pool (about 5–10 connections).
- Accept scans with a client-generated ID and an idempotent insert (`ON CONFLICT DO NOTHING`). Handhelds on flaky networks will retry, and duplicates must not be counted twice.
- Return `429` or `503` with `Retry-After` when overloaded, so scanners back off and buffer locally.
- Don't add Kafka, RabbitMQ, or Redis. Each one costs memory and operational effort you don't have. Postgres can absorb this write rate.
- Keep customer status reads on a small current-status table, updated with the scan writes, rather than aggregating the raw scan history on each request.
- Plan partitioning and retention for the scan table from the start. At peak, 200/s is up to about 17M rows per day. Realistic daily volume is probably much lower, but it needs a retention policy either way.

## Alternatives considered

- **Quarkus or Micronaut (still Java):** This is the strongest alternative and the fallback. Both typically use noticeably less memory than Spring Boot on the JVM, and both can produce native images. Your team's Java skills transfer, but they'd need to learn a new framework. I'd switch to this if the spike shows Spring Boot can't stay under budget with real headroom.
- **Go, Rust, or Node:** Lighter at runtime, but they go against your skills and your review model. Only worth it if the Java options both fail the measurements.
- **Message broker or separate ingestion service:** Adds components, memory, and failure modes for no clear gain at 200/s.
- **Bigger VM:** Possibly the cheapest answer overall. A 1 vCPU / 2 GB VM may cost little more than the engineering time spent squeezing a 512 MB one. Check whether policy allows an exception before building around the constraint.

## Risks

- **OOM kills:** On a 512 MB VM the kernel can kill the JVM under load without a clean Java error. Watch resident memory, not just heap.
- **Postgres placement:** If Postgres runs on the same 512 MB VM, the design fails outright. Confirm where the database lives and how much memory it gets.
- **Burst behaviour:** "200/s at peak" needs clarifying. Is that sustained, or a short spike after shift changes? Scanners that reconnect in a wave can produce much higher bursts.
- **Agent-written code review:** Reviewers will see many changes. Keep the codebase small, write an architecture note, require tests, and make IT's review checklist explicit (memory settings, query plans, migration safety, idempotency).
- **Retention and growth:** Without partitioning and a retention rule, the scan table grows without limit and slows the status queries.

## What to check before committing

1. **Where Postgres runs** and what memory it has.
2. **A one-week spike** on the actual VM class: Spring Boot and, if it's cheap to do, Quarkus. Run a load test at 200 writes/s plus status reads, and record resident memory, GC behaviour, p99 latency, and error rate over at least several hours.
3. **Real peak numbers:** sustained rate, burst rate, and expected daily volume. Ask the scanner vendor or the handheld team for their retry and offline-buffering behaviour.
4. **Scanner contract:** client-generated scan IDs, retry rules, and what the device does when the API returns `429` or `503`.
5. **Policy:** whether a 2 GB VM is possible, and what the cost difference is.
6. **Data rules:** retention period, who may read scan history, and whether customers should see only current status.

If the spike passes on a 512 MB VM with headroom, Spring Boot is the right choice. If it doesn't, move to Quarkus before considering anything that breaks your team's skills. The memory figures above are estimates and need confirming by measurement.
