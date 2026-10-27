# Recommendation for the parcel tracking API

**Build it in Java with Spring Boot on Postgres, the same stack your other services use.** Have the agent keep it plain and configure it for a small memory footprint. Run at least two small machines for the API, not one.

Other languages would fit a 512 MB machine more comfortably. I'd still stay with Java, because the workload doesn't need anything else and it keeps your team able to take the system over.

## Why Java and Spring Boot

**Your team can take over if needed.** You've said the agent will build and maintain this on its own and IT won't read the code. That holds until something goes wrong: a bad change at peak, a security patch the agent gets wrong, or the company deciding to stop using an agent. Then the only people who can step in are three Java developers. With Java, taking over is uncomfortable but possible. With Go or Rust, they'd be on call for code nobody in the building can read. For a system drivers depend on all day, I'd treat that as the main factor.

**The load is modest.** 200 small writes a second is well within what Spring Boot and Postgres can handle, even on one vCPU. The thing to watch is memory, not speed.

**It fits in 512 MB if set up for it.** These are the settings I'd ask the agent to use:
- A recent Java LTS (Java 25, or 21 if that's what your other services run), with lightweight threads turned on (Java's "virtual threads").
- Plain database access for the scan writes, without the heavier JPA/Hibernate layer.
- Java's simplest garbage collector, with the Java memory area (heap) capped at about half the machine's RAM. This leaves room for the rest of the Java process and the operating system.
- A small database connection pool and few dependencies.

Your existing Spring Boot services on these machines are the best evidence of whether this works (see the checks below).

**Running it stays the same.** Deploys, logs, monitoring and restarts work like your other services, so IT has nothing new to learn.

## Design points I'd ask the agent to follow

- **No lost scans and no duplicates.** Each scan should carry an ID generated on the scanner, and the database should ignore a scan it has already stored. Then a scanner can safely resend after a timeout.
- **Two API machines behind a load balancer.** This covers machine failure and lets you update one machine at a time without downtime. With one vCPU, Java starts and warms up slowly, so updating a single machine means a noticeable gap.
- **Keep customer lookups from slowing down scanners.** Rate-limit the public status endpoint and cache answers for a few seconds. If customer traffic is large, give it its own machine.
- **Split the scans table by month and set a retention rule.** As a rough estimate, 200 a second at peak could mean a few million rows a day. On a small database machine, the table and its indexes will soon be far bigger than memory. Monthly tables keep recent lookups fast and make archiving old data cheap.
- **Nothing extra.** No Kafka, Redis or message queue. On these machines, each would add memory pressure and another thing for IT to keep running, for a load Postgres handles fine.
- **Deliverables IT can use without reading code:** a health check endpoint, basic metrics and alerts, a short runbook ("if X, restart Y"), and an automated load test the agent reruns before each release.

## Alternatives I considered

| Option | Why not (for now) |
|---|---|
| **Go** | Best fit for the machine: small memory use, fast startup. It's my runner-up, but nobody on your team can maintain it, so I rejected it. |
| **Rust** | Same issue as Go, and even harder for a Java team to pick up. |
| **Node.js / Python** | No team skills. Python is also tight on throughput with one vCPU. |
| **Quarkus or Micronaut** | Still Java, with lower memory use and faster startup. A reasonable fallback if Spring Boot doesn't fit, but it's a framework your team doesn't use. |
| **GraalVM native image** (Java compiled ahead of time) | Cuts memory to roughly 100–150 MB and starts in under a second. Builds are slower and some libraries need extra setup. Keep it as a fallback if the load test shows memory is too tight. |
| **Reactive Spring (WebFlux)** | Virtual threads give the same benefit with ordinary, readable code. |
| **A message queue in front of the database** | More parts, more memory and more to operate, with no real gain at this volume. |
| **Bigger machines or managed cloud** | Ruled out by your policy, and not needed. |

## Risks

1. **Out-of-memory kills.** Java uses memory beyond the heap limit, so tuning only the heap can still let the operating system kill the process at peak. This is caught by measuring total memory use under load, not by reading the settings.
2. **Database machine size and disk.** If Postgres also has to run on 1 vCPU / 512 MB, it's the tighter constraint. Disk speed (how fast each write is committed) and disk space growth will matter more than the API.
3. **Bursts after dead zones.** Scanners that buffer while offline may send their whole backlog at once when they reconnect, well above 200 a second.
4. **No human reviewing the code.** Without review, problems build up quietly: outdated dependencies, missed security patches, and code that slowly drifts. Using Java reduces this risk but doesn't remove it.
5. **Slow startup on one vCPU.** Updates and crash recovery take tens of seconds per machine. Two machines covers this.

## What I'd check before you commit

1. **How your current Spring Boot services behave on these machines.** Look at their actual memory use and how often they restart. This is your cheapest, most reliable data.
2. **A one-day load test on a real 1 vCPU / 512 MB machine.** Send 2–3× peak (about 600 scans a second) plus customer lookups for an hour. Watch total memory use, garbage collection pauses and worst-case response times. If it fails, try GraalVM native or Quarkus before considering another language.
3. **Where Postgres runs,** and on what: its size, disk speed, backups, and whether a standby copy is possible.
4. **How the scanners behave.** Ask the vendor: do they generate a unique ID per scan, retry, buffer when offline, and can they send scans in batches?
5. **How long scan history must be kept,** for legal and customer reasons.
6. **How much customer lookup traffic to expect,** and whether the endpoint is public. For example, do notification emails link to it?
7. **Whether the hosting company offers** a load balancer, TLS certificates and backups.
8. **A fallback plan if the agent isn't available.** Agree that at least one developer can read the code if needed, even if they don't review it day to day.
