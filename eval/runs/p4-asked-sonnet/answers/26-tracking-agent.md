# Recommendation: Spring Boot on Java, kept lean and proven by a measurement first

## What I'd build with

- **Language and framework:** Java 21 (or the current LTS) with Spring Boot. Use plain JDBC (`JdbcClient`) with a small connection pool and Flyway for schema migrations. Skip JPA/Hibernate and WebFlux.
- **Scan writes:** Batch inserts, and make each scan idempotent. Scanners will retry, so every scan carries a device ID and sequence number or UUID, and duplicates are ignored.
- **Customer status checks:** Keep a "current status" row per parcel, updated on each scan, next to the append-only scan history. A status check is then one indexed lookup, not a history query. Add a short in-memory cache if reads spike.
- **Memory settings:** Heap capped around 200–256 MB, small thread pool, no unused starters, and class-data sharing to cut startup and footprint.
- **Postgres:** Not on the same 512 MB machine.

## Why

The load is not the hard part. 200 small inserts a second is modest for Postgres, and a trimmed Spring Boot app handles it. The real constraints are the 1 vCPU, the 512 MB, and who can keep this running in three years.

Even if the agent writes and maintains everything, your three Java developers are the human fallback. Something will break at 2 a.m., the agent will be unavailable or wrong, or someone will need to audit what it did. Java is the one language they can read in that moment. "IT isn't expected to read the code" is a good default, but I wouldn't build something nobody can read if it can be avoided. Agents are also very strong in Java and Spring, so that choice costs little in quality.

## Alternatives considered

- **Go:** It would win on footprint, with about 30–50 MB for this workload and instant startup. I'd reject it because nobody on the team can read it, and that matters more than the memory saved. It's the right answer only if the spike below fails and the 1 GB exception is refused.
- **Spring Boot native image (GraalVM):** This is my first fallback if memory is too tight. It is still Java and Spring, with far lower memory and fast startup. The costs are slower builds, occasional reflection and library problems, and more build tooling. Builds would have to run off the VM, because they need several GB.
- **Quarkus, Micronaut, Javalin:** These are lighter, but they're a new framework for your team. A trimmed Spring Boot or a native image gets most of the gain without that.
- **Node or Python:** They are slower per core, use more memory, and share the skills problem with Go.
- **Kafka or RabbitMQ in front of the database:** There's no memory budget for them. Postgres is durable and fast enough at this rate.
- **Postgres-as-API (PostgREST):** It's small, but it puts business logic in SQL and adds a tool the team doesn't know.

## Risks

1. **Memory is tight.** Spring Boot's total memory (heap, metaspace, threads, JIT) often lands at 300–400 MB, and the OS needs about 100 MB. Running out means the OS kills the process, and scanners fail until it restarts.
2. **CPU may bind before memory does.** With one core, JIT warmup, garbage collection, TLS handshakes, and request handling all compete. Startup can take 20–40 seconds, so every deploy is a short outage.
3. **Single VM, single point of failure.** A parcel-tracking outage stops drivers scanning.
4. **Retry storms.** After an outage, every handheld flushes its backlog at once, which can far exceed 200 per second.
5. **Agent-maintained drift.** Dependency security patches, Java and Spring support lifecycles, and silent behavior changes need an owner. Without one, the service decays.
6. **Data growth.** The history table will reach hundreds of millions of rows without a retention or partitioning plan.

## What to check before committing

1. **Where Postgres runs.** Can it be a separate VM, or a managed instance at the hosting company? Postgres and the JVM together on 512 MB is a no-go. Also confirm who handles backups, and test a restore.
2. **A one-day spike on the real VM size.** Build a trivial endpoint that inserts a scan and reads a status. Load-test at 200 writes per second plus realistic reads, then measure resident memory, CPU, p99 latency, and startup time. Run it a second time as a native image. This decides between plain JVM, native image, or asking for more resources.
3. **Whether 1 GB is negotiable.** Ask what a policy exception costs. It may be cheaper than engineering around 512 MB.
4. **The real traffic shape.** How many scanners are there, and what are the average and peak rates? Does a handheld buffer scans offline and retry safely? What authentication does it support? Where does TLS terminate, and can the hosting company's load balancer do it?
5. **Redundancy.** Can you afford two small app VMs behind a load balancer? Since the service is stateless, that gives you zero-downtime deploys and a spare.
6. **Operational guardrails for an agent-run codebase.** These are:
   - a load test and migration check in CI;
   - health and metrics endpoints, with structured logs and alerts;
   - a plain-language runbook for IT (restart, rollback, where the logs are, who to call);
   - pinned dependencies with a scheduled upgrade routine;
   - a named human who approves changes.
7. **Retention.** Decide how long scan history is kept, and what disk size and archive plan follow from that.

If the spike shows the plain JVM sits comfortably under about 350 MB at peak load with headroom on CPU, commit to Spring Boot as described. If not, try the native image. If that also fails, ask for more memory before switching languages.
