**Recommendation: Java 21 and Spring Boot, on the platform you already run. Don't use Go.**

**Why**

- **The load is small.** 800 requests a second at p99 under 150 ms is a modest target for a read-only, indexed lookup on a Postgres replica. A few Spring Boot pods can handle it. The database call, the connection pool and the network will decide your latency, not the language runtime.
- **Go's "lighter" claim barely matters at this scale.** Go does use less memory and starts faster. That saves perhaps a few hundred MB per pod and some seconds at startup. Across a handful of replicas, this is noise next to the cost of a new language.
- **A new language is the real cost.** Go needs a months-long security review and an architecture board exception. After that, someone has to build and maintain the following:
  - an internal supply-chain and dependency-scanning story
  - hardened base images and pipeline templates
  - logging, tracing and audit conventions
  - on-call knowledge
  - a Go bench of engineers
  
  For one small service, that is a poor trade. It would also leave you with a service few people can support.
- **Compliance and audit.** Staying on the standard stack means you reuse the approved libraries, the existing SDLC controls, the audit logging patterns, the vulnerability scanning and the long-term-support commitments. Those are the things your organisation cares about most.
- **Hiring and rotation.** Any of your 600 engineers can pick this service up. A Go service becomes a niche that one team owns.

**Alternatives considered**

| Option | Verdict |
|---|---|
| **Go** | Not on the approved list. The benefits are real but small at this load and don't justify the review and long-term cost. |
| **Spring Boot with GraalVM native image** | Gets you Go-like footprint and startup. It adds build complexity, reflection and library compatibility issues, and a less standard operating model. Only consider it if measurements show a real need. It probably won't. |
| **Quarkus or Micronaut** | Lighter than Spring Boot, but not your standard. You would pay a smaller version of the same new-technology cost. |
| **Spring WebFlux (reactive)** | Not needed at 800 rps. It adds complexity and debugging cost. Use the standard servlet stack. |
| **Extend an existing service** | Worth asking. If a payments service already owns this domain, adding an endpoint may be cheaper than a new service. A separate service can still be justified for isolation, since mobile traffic then can't affect core payments. |

**How I'd build it**

- Use Spring Boot on Java 21 with the standard servlet stack. Virtual threads are an option, because they suit blocking JDBC calls under bursty load. Treat that as a tuning choice and verify it, rather than assuming it.
- Use plain JDBC or JdbcTemplate (or JPA if that is your norm) against the replica. Use a properly sized HikariCP pool. This is a read-only query on a key, so you don't need an ORM's features.
- Run at least 3 replicas, spread across both data centres.
- Use the standard observability, auth and audit libraries your other services already use.

**Risks**

1. **Replica lag.** This is the biggest functional risk. A customer who has just paid may see a stale status ("pending" or "not found") because the replica is behind. That is a product problem the language can't fix. Decide what the API returns when a payment isn't found yet, and what lag you can tolerate.
2. **Connection limits.** Total pool size across pods can overwhelm Postgres, especially during rolling deploys or failover. Size the pools deliberately, and consider PgBouncer if your platform provides it.
3. **Replica failover and cross-DC latency.** Check where the replica sits relative to the pods, and what happens when it is promoted or unavailable. A cross-DC hop can eat a large part of your 150 ms budget.
4. **JVM cold start and warm-up.** Pods that have just started have slow first requests. Use readiness probes, warm-up, and sensible CPU requests and limits. Under-provisioned CPU on OpenShift is a common cause of JVM p99 spikes.
5. **Peak may be higher than 800.** Mobile traffic is bursty, and apps often poll. If the app polls payment status every few seconds, 800 rps can rise sharply after a marketing push or an outage. Ask for the assumptions behind the estimate.
6. **Team disappointment.** The team that suggested Go may feel dismissed. Give them the numbers, and take their concern about footprint seriously.

**What I'd check before committing**

- **Load test early.** Run a quick prototype against a production-like replica at 2–3 times peak. This answers the question with data and settles the Go argument as well. If Spring Boot meets p99 at 800 rps with some headroom, the debate is over.
- **Query and index.** Confirm the lookup is by an indexed key and returns in a few milliseconds. Check which columns you need and avoid joins.
- **Replica behaviour.** Measure typical and worst-case replication lag. Agree on the consistency semantics with the product owner.
- **Authentication and authorisation.** Confirm the caller is authorised to see that payment, so one customer can't read another's status. Check this carefully, because it is the main security risk in a status API.
- **Data exposure.** Return only the fields the mobile app needs. Check what must be masked and what must be logged for audit.
- **Existing ownership.** Check whether an existing service or team already owns this data, and whether the board expects a new service at all.
- **Caching.** Probably unnecessary at first. If you add it, keep TTLs short, since users expect status to be fresh.
- **Resource sizing.** Measure actual memory and CPU, then set requests and limits from the results. If the team still argues about footprint, you'll have real numbers.

**If someone insists on Go anyway**

Ask for a measured case: a benchmark on your own infrastructure showing that Spring Boot misses the target, or a resource cost large enough to justify months of review. At this load, I don't expect they'll find one. If they do, go to the architecture board with that evidence rather than starting Go work informally.
