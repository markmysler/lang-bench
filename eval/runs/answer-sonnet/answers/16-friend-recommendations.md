# Recommendation: stay in Postgres, precompute the results, and keep it in TypeScript

## What I would do

1. **Keep the relationship data in Postgres.** 2M nodes and 40M edges is small for Postgres. The whole graph in compact form is a few hundred MB.
2. **Don't traverse at request time.** A background job computes each user's top-N recommendations. The API then does a single keyed read, which is far below 300 ms whatever the storage engine.
3. **Run the job as a BullMQ worker on your existing Redis queues**, reading from a Postgres read replica. Write the results back to a Postgres table with one row per user holding the top ~50 as a compact array or JSONB. That is about 2M rows, not 100M. Add a short Redis cache in front if you need one.
4. **Recompute incrementally.** Do it on a schedule for recently active users, and enqueue a recompute when a user's connections change meaningfully. Users with no precomputed row (new signups) get a live 2-hop query as a fallback.
5. **Filter at read time.** Remove people the user is already connected to, has blocked, or has dismissed. That way those actions take effect immediately without waiting for a recompute.

## Why precomputing is the real decision

Your 300 ms target is hard to meet live at hop 3 on any engine. With an average of ~40 connections per user, hop 3 touches around 64k candidates for a typical user. Hub users with thousands of connections touch millions.

- **Hop 2** (shared connections) is a self-join on an indexed edge table, touching a few thousand rows. Postgres handles that in milliseconds to tens of milliseconds.
- **Hop 3** is where recursive CTEs get slow and where a graph database also slows down on hubs. A graph database is better at traversal, but it doesn't remove the hub problem.

Precomputing removes the latency problem from the choice of database. It also removes most of the case for a graph database.

## Alternatives I considered

- **Neo4j, Memgraph or Neptune.**
  - Costs:
    - A second datastore and a sync pipeline from Postgres.
    - Consistency bugs between the two.
    - Another thing to operate, monitor and pay for.
    - A query language (Cypher) that your hiring pool mostly doesn't know.
  - It would earn its place if you needed deep or real-time traversals, path finding, or community detection as product features. This feature, as specified, doesn't need any of that.
- **Apache AGE or other graph extensions on Postgres.** Most managed Postgres providers don't allow them, and the ecosystem is less mature. I wouldn't bet on it.
- **Redis as the graph store.** RedisGraph is end-of-life. Plain Redis sets could hold adjacency lists, but you would be hand-building a graph database.
- **Live recursive CTE.** This is fine for a prototype and for the 2-hop fallback, but I wouldn't ship it for hop 3.

## Does the language matter?

Barely. The cost is in data access and the algorithm, not in the language the code runs in.

- **Node/TypeScript** is fine for the serving path and the batch worker. If you want faster computation, load the adjacency list into typed arrays. At 40M edges stored in both directions, that is roughly 300–400 MB, which fits in a worker process.
- **Go** would be faster for in-memory graph work, but it adds a second language, a second build and deploy path, and a smaller hiring pool for you. Only one of you has touched it. I would reach for it only if the TypeScript batch job proves too slow or too expensive.
- **JVM**: no. Nobody has operated it, and nothing here needs it.

## Risks

- **Hubs and big teams.**
  - Deriving connections from shared teams and projects can explode combinatorially. A 5,000-person team implies ~12M pairs.
  - Cap hub contributions, skip or sample very large teams, and weight shared connections by something like 1/log(degree) so hubs don't dominate the ranking.
- **Hop 3 may not be worth it.** Ranking by shared connections is clean at hop 2. At hop 3 it becomes path counting, which is noisy. Evaluate hop 3 against hop 2 alone in an experiment.
- **Staleness.** Users may expect a new connection to show up in their recommendations quickly. Agree on an acceptable delay (minutes or hours) up front.
- **Privacy.** Recommending through private teams or projects can reveal that someone is in them. Decide what shared membership you're allowed to use.
- **Load on the primary.** Run the batch job on a read replica, not the primary.
- **Recompute cost.** Recomputing everyone nightly is wasteful. Restrict it to active users. This is also what keeps your cloud bill growing slower than revenue.

## What I would check before committing

1. **The data shape.** Are the 40M relationships explicit rows or derived from team and project membership? Are they stored once or in both directions? Are they indexed in both directions?
2. **Degree distribution.** Get p50, p99 and max connections per user. Also get the team and project size distribution. This tells you how bad the hubs are.
3. **A real measurement.** On production-sized data, run the 2-hop query for a median user and for a p99 user with `EXPLAIN ANALYZE`. Then try hop 3 with hub caps. Hop 2 should come back in tens of milliseconds. If it doesn't, you likely have an indexing problem.
4. **Batch cost.** Estimate how many users are active per day and how long a full recompute takes on a small Fly machine. That gives you the real cloud cost.
5. **Replica and headroom.** Confirm that your managed Postgres plan has a read replica and enough memory to hold the edge table's indexes.

## When I would revisit a graph database

Revisit it if the product starts to need any of these:

- More than three hops.
- Real-time freshness.
- Several graph-heavy features such as shortest paths, clustering or graph-based search.
- Measured evidence that the precompute approach can't keep up.

At that point, prototype one engine against your measured numbers rather than moving the data on spec.
