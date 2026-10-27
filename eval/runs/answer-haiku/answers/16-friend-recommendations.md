**Recommendation: keep the relationship data in Postgres, and don't make the 300 ms target a live graph traversal.** Precompute the "people you may know" lists in a background job, store the top N per user, and serve each request as one indexed lookup. Add Redis caching on top if needed. Revisit a graph database only if the Postgres approach fails the checks below.

**Why this works**

- The scale is modest. 40M edges across 2M users averages about 20 connections per user. Two hops from one user is roughly 400 paths, and three hops is roughly 8,000 before deduplication. Postgres handles that fine with proper indexes.
- The real risk is skew, not the average. A few users (large team members, admins, people in huge shared projects) will have enormous fan-out. Any design needs caps on hops and candidates, and you need to measure the p99 and max degree, not the mean.
- Recommendations don't need to be live. "People you may know" can be a few minutes or hours stale without anyone noticing. That makes precomputation the cheapest way to hit 300 ms with headroom. Serving a precomputed top-50 list is a single-digit-millisecond read.
- Keeping one database avoids a sync pipeline, a second consistency model, and a second backup and failure domain. That fits a four-person team and a cloud bill that should grow slower than revenue.

**Alternatives considered**

- **Neo4j, Neptune, Memgraph, or similar graph databases.** They are good at deep, arbitrary traversals, which you don't need here. The costs are real: a second system to operate, an ETL or CDC pipeline to keep it in sync, a new query language, and licensing or managed-service costs that grow with the data. Neo4j runs on the JVM, which nobody on the team has run in production. Neptune avoids the operations work but adds AWS and a cost model you'd have to learn.
- **Live recursive CTEs in Postgres per request.** They work for a bounded 2-hop query, but a 3-hop query over skewed data at 2M users is hard to keep under 300 ms at p95 under load. Use them for the offline job, not the request path.
- **Apache AGE (Cypher on Postgres).** It keeps you in Postgres with a graph query language, but it's young, and availability on your managed Postgres provider is uncertain. Worth a look later, not a foundation today.
- **Redis sets for adjacency.** Mutual-connection counts via set intersection are fast, but holding 40M edges in memory is expensive. Use Redis for caching results and queues, not as the source of the graph.

**Does the language matter?**

Not for this decision. The 300 ms budget depends on query shape, precomputation, and caching, not on the language. A Node service reading a precomputed table is far inside the budget. Stay with TypeScript: it's your strength and your hiring pool. Two practical notes: Prisma is fine for CRUD, but the graph and ranking queries will need raw SQL (`$queryRaw` or a query builder like Kysely). Go is a reasonable carve-out later if a ranking service becomes CPU-bound, and your Go developer could own that. Don't introduce the JVM for this.

**Risks**

- Hub users with huge fan-out, so the 3-hop expansion explodes. Mitigate with per-hop caps and sampling.
- Batch recompute cost and load on the primary database. Run it on a replica or with a separate job pool.
- Stale suggestions after relationship changes. Acceptable for PYMK, but decide the refresh policy: nightly batch plus event-driven updates for users with recent changes.
- Ranking quality. "Ranked by shared connections" is easy to build and may not be the best ranking. Measure accept and click rates.
- Privacy and blocking: hidden profiles, blocked users, and people in private projects must be filtered out in the job, not at display time.
- Cold start for new users with no teams.

**What I'd check before committing**

1. **Confirm the data model.** Are the 40M relationships user-to-user, or user-to-team/project memberships? "Shared teams" suggests a bipartite graph, which changes the query shape and may make a precomputed candidate table much smaller.
2. **Measure degree distribution.** Get p50, p99, and max degree per user, and the number of distinct 2-hop and 3-hop candidates per user. Decide the caps from this data.
3. **Benchmark on a production-sized copy.** Run `EXPLAIN ANALYZE` on the 2-hop and 3-hop queries with indexes in both directions. Test p95 at realistic concurrency.
4. **Prototype the precomputed table.** Measure full batch runtime, compute cost, load on the database, and how fast a single relationship change shows up.
5. **Check Postgres headroom.** CPU, connections, and whether a read replica is needed for the batch job.
6. **Define the ranking and evaluate it offline** on past data before you ship it.
7. **Get the privacy and blocking rules written down** and applied in the job.

**When to reconsider a graph database:** if you need arbitrary path queries or traversals beyond three hops, if many features (not just this one) become graph-heavy, or if you've tuned Postgres and precomputation and still can't meet the latency or freshness targets. Even then, measure the specific bottleneck before switching.
