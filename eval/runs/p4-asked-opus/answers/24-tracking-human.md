# Recommendation: build it on Spring Boot

Use the stack your team already knows: Spring Boot, plain Spring MVC, plain JDBC and Postgres. Set it up for small machines and run at least two instances. The load is real but modest, and the bigger risks are keeping the system running and the memory limit, not the choice of technology.

## What to build

- **Java 25 (the current long-term support version) and current Spring Boot.** Newer Java versions use less memory per object and start faster, and both matter on a 1 vCPU / 512 MB machine.
- **Spring MVC, the ordinary blocking style.** At 200 writes a second with a few milliseconds each in the database, only a handful of requests are in flight at once. You don't need reactive programming. Turning on Java's virtual threads is a single setting if you want it, but it isn't required.
- **Plain JDBC (JdbcTemplate or JdbcClient), or Spring Data JDBC, for the scan path rather than JPA/Hibernate.** It uses less memory and CPU per request, and the SQL is easy to see when something goes wrong. JPA is fine for admin screens if you want it there.
- **A small connection pool** (around 5–10 connections per instance). More connections don't help on one CPU.
- **Set the JVM's memory explicitly.** For example, give the heap about 250–300 MB and leave the rest for the JVM's own overhead and the operating system. The defaults are poor at this size: Java gives itself only a quarter of RAM, about 128 MB. On one CPU, Java automatically uses its simplest garbage collector (Serial), which is the right choice here.
- **Make the scan endpoint safe to retry.** Each scan carries a unique ID from the device (for example device ID plus sequence number). A unique constraint in Postgres with "insert, ignore if it already exists" means a scanner can resend after a dropped connection without creating duplicates. This matters more for reliability than anything else on this list.
- **Run at least two instances** on separate VMs behind a load balancer. One VM with one CPU is a single point of failure, and you need two to deploy without downtime. If the policy is small VMs, grow by adding more of them.
- **Keep customer status checks away from scanner writes.** Either run the read endpoints as a separate deployment of the same codebase, or at least rate-limit and briefly cache them. A spike in customer lookups must not slow down the drivers.
- **Postgres design:**
  - Make the scans table append-only.
  - Index it by parcel and time, so "latest status" is a cheap lookup.
  - Partition it by month from day one, so old data can be dropped or archived without heavy deletes.

**Rough capacity check:** 200 requests a second on one CPU leaves 5 ms of CPU per request. Once Java has warmed up, a simple "parse JSON and insert one row" request should use well under that. One instance might cope, but without much spare room, which is one more reason to run two. A load test has to confirm this; see the checks below.

## Alternatives I considered

| Option | Why not (for now) |
|---|---|
| **Go, Node.js or Rust** | They use less memory, but nobody on the team knows them. Three Java developers maintaining one odd service in another language is a long-term reliability risk, and that outweighs the memory saving. |
| **Quarkus or Micronaut** (lighter Java frameworks) | A fair option: lower memory use and faster startup. But it's a new framework for the team, and Spring Boot fits in 512 MB if configured with care. This is the fallback if the load test shows memory is too tight. |
| **GraalVM native image** (compiling Java ahead of time) | Much less memory and almost instant startup. The costs are slow, more complicated builds, occasional library incompatibilities, and harder debugging. Keep it in reserve; don't start with it. |
| **Spring WebFlux** (reactive programming) | It solves a high-concurrency problem you don't have, and it's harder to write and debug. |
| **A message queue in front of the database** (Kafka, RabbitMQ) | Kafka won't fit in 512 MB. RabbitMQ would, but it's one more system for three people to run. Postgres can take 200 small writes a second directly, and the scanners can act as the buffer by retrying. Reconsider only if the volume grows several times over. |
| **Buffering scans in memory and writing them in batches** | Scans are lost if the process crashes before writing them. If you need batching later, do it so the device only gets its acknowledgement after the batch is committed. |

## Risks

1. **Out-of-memory kills.** Java's real memory use is the heap plus its own overhead. Watch the actual process memory, not just the heap, and keep 100 MB or more spare.
2. **Slow startup and warm-up on one CPU.** Expect startup to take from several seconds to tens of seconds, and the first minutes to be slower while Java optimises the code. Use rolling deploys, don't restart at peak, and consider Spring Boot's startup cache feature (CDS/AOT).
3. **Database disk speed.** Each committed write waits for the disk. 200 commits a second is easy on a good disk and painful on a slow shared one. Postgres can group commits together (the `commit_delay` setting) if needed.
4. **The Postgres server itself.** If Postgres also has to run on 1 vCPU / 512 MB, it is the real bottleneck and single point of failure, not the API. You need a plan for backups and a standby server.
5. **Shared hosting.** Other customers' VMs can take CPU time from yours when you need it, and with one CPU you have no margin to absorb that.
6. **Encryption (TLS) cost.** Setting up secure connections is CPU-heavy. Make sure scanners reuse connections, or let the load balancer handle encryption.
7. **Table growth.** Hundreds of millions of rows a year is plausible, so decide how long to keep data early.

## Check before you commit

1. **Load-test on a real 1 vCPU / 512 MB VM from your hosting company**, against the real Postgres server, at twice the peak (400 scans a second) for 30 minutes or more. Measure the slowest 1% of response times, process memory and CPU.
2. **What the scanners actually do.** Can they store scans while offline and resend them? Do they retry? Can they send a unique scan ID? Can they send several scans per request? Batching on the device could cut the request rate by 10×.
3. **How many customer status checks** to expect, and whether they arrive in bursts (for example after a notification email goes out).
4. **The Postgres server's size and disk speed.** Run the `pg_test_fsync` tool on it, and confirm backups and a standby are in place.
5. **Whether the hosting company offers a load balancer**, or whether you need to run your own (HAProxy or nginx on another small VM).
6. **How long you must keep scan history**, for legal reasons and for customers.
7. **Monitoring.** Spring Boot's built-in health and metrics endpoints (Actuator), fed into whatever you already use, with alerts on memory, response times and database pool waits.

If the load test passes, IT can build and maintain this with their existing skills. If it shows memory or CPU is too tight, try Quarkus or native image next, still in Java, before considering anything else.
