## Recommendation

Build it as a **Spring Boot service on a current Java LTS, backed by PostgreSQL**. The team already knows this stack, it is boring and well understood, and it can handle 200 small writes a second without exotic parts. The one thing I would not do is run the app and the database together on a single 512 MB VM. That is the decision that most needs to change.

**Design shape:**

- **Scanner writes:** each scan carries a device-generated unique ID. The API accepts scans in batches where possible, writes them in one transaction, and returns success only after the commit. The unique ID makes retries safe.
- **Scan history:** an append-only table partitioned by day, so old data can be dropped cheaply and autovacuum stays manageable.
- **Customer status checks:** a small "current status" table with one row per parcel, updated alongside each scan and indexed on the tracking number. Status reads then never touch the large history table. Add a cache only if measurements show it's needed.
- **Code choices:** plain JDBC, `JdbcTemplate`, or jOOQ on the hot write path rather than heavy JPA/Hibernate, which uses more memory and CPU. Keep the connection pool small (about 5–10). Use Flyway for schema migrations.
- **JVM settings for small VMs:** a capped heap (roughly 256 MB), the serial garbage collector, and a limited thread pool.

## The memory problem

Rough numbers, to be confirmed by measurement:

- A Spring Boot app with a 256 MB heap typically uses 300–400 MB resident once metaspace, threads, and code cache are counted. That fits alone on a 512 MB VM, with little room to spare.
- PostgreSQL with `shared_buffers` around 128 MB, a handful of connections, and the OS needs most of the rest. It can run on its own 512 MB VM if tuned.
- Both together on one 512 MB VM will swap or get OOM-killed under load. Don't do it.

So the realistic options are:

1. **Ask for a policy exception for the database VM** (or use the hosting company's managed PostgreSQL if they offer it). A modestly larger VM, such as 2 vCPU and 2–4 GB, costs little next to a tracking outage. This is my recommendation.
2. **App and database on separate standard 512 MB VMs**, with the database tuned small. This technically complies with policy but leaves almost no headroom, and the database is a single point of failure.

## Alternatives considered

| Option | Why not (or when to revisit) |
|---|---|
| **Go, Node, or Python** | Smaller memory footprint, which is a real advantage here. Rejected because the team only knows Java and would own the support burden. Revisit only if the memory test fails badly. |
| **Quarkus or Spring Boot native images (GraalVM)** | Much lower memory and faster startup. Worth it if memory stays binding, but adds build complexity and a learning curve for a three-person team. A good second step, not a first. |
| **Kafka or RabbitMQ in front of the API** | Adds durable buffering, but it's another stateful service to run and patch. Scanner-side buffering plus idempotent writes covers most of the need at this volume. |
| **Cassandra, MongoDB, or other NoSQL** | Typically need several GB of RAM, and the queries here are simple relational lookups. Overkill. |
| **Cloud IoT or streaming services (AWS IoT, Kinesis, managed DynamoDB)** | Scales easily, but conflicts with the local-hosting policy and raises data location and running-cost questions. Needs a separate policy decision. |
| **TimescaleDB** | Useful if scan volume grows a lot. Native PostgreSQL partitioning is enough for now. |
| **Redis for status caching** | Adds an operational component for a read load PostgreSQL can serve. Skip unless measurements require it. |

## Risks

1. **Memory fit (high).** Covered above. A sustained JVM memory leak or GC pressure would show up only after days, so a long soak test is needed.
2. **Disk performance (high, unknown).** Each committed batch needs an fsync. Many small VM disks have high fsync latency or limited IOPS. The data is only as fast as the disk.
3. **CPU credits and contention (medium).** If the hosting company's VMs are burstable, sustained load can be throttled. On one vCPU, GC, autovacuum, and request handling all compete.
4. **Duplicate or out-of-order scans (medium).** Scanners that retry after timeouts or flush offline buffers can send the same scan twice, and a depot outage can cause a large burst when connectivity returns. Without idempotent IDs, status history gets corrupted.
5. **Single database, untested recovery (high).** One VM is a single point of failure. Backups mean nothing until a restore has been timed on a fresh machine.
6. **Clock skew (medium).** Device clocks drift. Store both device time and server receive time, and define which one orders events.
7. **Data growth (medium).** Rough estimate: if peak is sustained at 200 scans/s for two hours a day, that's about 1.4 million rows a day, roughly 400 MB a day with indexes, or around 150 GB a year. Retention rules need to be decided up front.
8. **Public status endpoint (medium).** Needs rate limiting and authentication rules to prevent scraping and abuse.
9. **Team capacity (medium).** Three people own build, deployment, database operations, and on-call. Keep the stack boring and write a short runbook.

## What to check before committing

1. **Real peak profile.** Pull current scanner or gateway logs to get the actual peak rate, how long peaks last, and how large bursts get after outages. Don't design from the 200/s figure alone.
2. **Load test on the exact target VMs.** Run 200 writes/s with a realistic read mix. Record p95 and p99 latency, resident memory over a 24-hour soak, and CPU use. Test the single-VM and split-VM layouts separately.
3. **Disk measurements.** Measure fsync latency and sustained IOPS on the hosting company's disks. Confirm whether the VM is burstable.
4. **Policy route.** Ask whether the database can have a larger VM, or whether managed PostgreSQL is available and what it costs. Get the answer before the design is final.
5. **Backup and restore drill.** Set up WAL archiving or point-in-time recovery, restore to a new VM, and time it. Agree on recovery point and recovery time targets.
6. **Scanner behaviour.** Confirm that the scanner generates unique scan IDs, retries with backoff, buffers offline, and can send batches. If it can't, that's a firmware or app change to schedule now.
7. **Service levels and retention.** Agree on targets, such as scan acceptance p99 under 500 ms and status availability of 99.5%. Confirm how long scan history must be kept and any legal requirements.
8. **Security.** Decide how scanners authenticate (per-device credentials or mutual TLS), how customers authenticate, where TLS terminates, and confirm the database is not reachable from outside.

If the load test and disk measurements come back clean, this design is sound. If memory fails on a single VM, the next step is to split the app and database, not to change languages.
