# People you may know: keep it in Postgres

**My recommendation:** keep the relationship data in Postgres. Precompute each user's recommendations in the background and serve them from a single lookup. Don't add a graph database for this feature. Language barely matters; stay in TypeScript.

## The core issue isn't the database

A three-hop query is expensive in any engine because the number of people reached grows with every hop. Two numbers drive it:

- **Average connections.** If the 40M relationships are user-to-user, the average user has about 40 connections. That's roughly 1,600 people at two hops and around 64,000 paths at three, before removing duplicates.
- **Large groups.** Your edges come from shared teams and projects, so the data is really "users belong to groups". One 2,000-person team gives every member 2,000 first-hop connections. A third hop from there reaches a large share of the whole user base.

A graph database follows each link faster than Postgres joins. But it does the same amount of work, so a live three-hop query for a user in a big team will still miss 300 ms at the slow end. In practice Neo4j teams also precompute recommendations like these. If you'd precompute either way, the graph database adds cost and gives you little.

## What I'd build

1. **Postgres stays the source of truth.** You need a membership table indexed both ways (user → group and group → user). You probably have it already.
2. **Compute recommendations in a background worker,** using the Redis queue setup you already run. For each user: their groups → other members → count shared connections → rank. Do this two-hop pass in SQL against a read replica. Most of a "ranked by shared connections" score comes from two hops anyway.
3. **Use the third hop only to fill gaps.** Run it when a user has too few two-hop candidates, such as new or isolated users. Cap how far it spreads.
4. **Limit or down-weight large groups.** A shared 5-person project should count for far more than a shared 3,000-person "All staff" team. This improves ranking quality and also removes the worst performance cases. A common approach is to weight each shared group by about 1 / log(group size).
5. **Store the results as one row per user** holding the top ~50 candidate IDs and scores. At 2 million users that's roughly 1 GB or less. Optionally cache it in Redis.
6. **Serving is a key lookup plus cheap filters** at read time: already connected, blocked, dismissed, deactivated. That's single-digit milliseconds, so the 300 ms budget goes almost entirely to network and rendering.
7. **Keep it fresh with events plus a nightly sweep.** When someone joins or leaves a group, queue a recompute for them. A nightly or weekly job catches everything else. Hours of staleness is normal for this kind of feature.

**If the SQL batch job gets too slow,** load the graph into memory in a worker before considering a new database. Stored as compact ID arrays, 40M memberships take roughly 300–400 MB. That fits on one Fly machine, and a two-hop pass over every user should take minutes. TypeScript handles this well if you use typed arrays rather than objects.

## Does the language matter?

Mostly no. The amount of fan-out and the precompute design decide performance; TypeScript versus anything else doesn't.

- **API and serving:** TypeScript. It's a key lookup.
- **Batch computation:** TypeScript is fine at this scale. Node runs one thread per process, so you'd parallelise with worker threads or several worker processes. If the in-memory job ever becomes a real bottleneck, a small Go batch job is a sensible fallback, since one of you knows Go. I wouldn't start there: it's a second language to hire for and maintain.
- **JVM:** avoid it. Self-hosting Neo4j means running and tuning a JVM in production, which nobody on the team has done.

## Alternatives I considered

| Option | Why not (for now) |
|---|---|
| **Neo4j (self-hosted)** | JVM operations with no in-house experience. A second datastore to keep in sync with Postgres. You'd still precompute. |
| **Neo4j Aura (managed)** | Removes the JVM work, but you pay for memory sized to the graph, likely hundreds to low thousands of dollars a month. You still need a pipeline syncing data from Postgres and need to learn Cypher. Same fan-out problem. |
| **Memgraph / FalkorDB** | Fast in-memory graph engines, but the same second-datastore and sync costs, smaller vendors, and fewer people to hire who know them. |
| **Apache AGE (graph queries inside Postgres)** | Attractive in principle, but most managed Postgres providers don't offer it. Check yours. It wouldn't fix fan-out either. |
| **Live recursive SQL queries on each request** | Works for the typical user at two hops. Fails your 300 ms target at the slow end for big-team users and at three hops. |
| **Graph embeddings / ML ranking** | Overkill at seed stage. Revisit once you have click and accept data to train on. |

**When a graph database would be the right call:** when you have several features that need live traversals of variable depth that you can't precompute. Examples are "show me how I'm connected to X", org-chart navigation, or access control based on graph paths. Reassess when the second or third such feature is on the roadmap, not for this one.

## Risks

- **Privacy and visibility (the biggest risk).** If you're B2B, recommendations must not cross organisation boundaries unless that's intended. Private projects must not create edges. "You may know X" can leak that X is on a confidential project with you or a colleague. Decide these rules before computing anything.
- **Large groups distorting rankings.** Without the cap or weighting in step 4, everyone in the "All staff" team gets recommended to everyone else.
- **Load on the primary database.** Run batch jobs against a replica, or in an in-memory worker, never against the primary.
- **Staleness complaints.** Someone joins a team and sees no updates. The event-driven recompute covers this; make sure it gets built.
- **Cost of storing results for inactive users.** Consider computing only for users active in the last 30 days and computing the rest on demand.

## What I'd check before committing (about a week of work)

1. **What the 40M rows actually are.** Are they user–user edges or user–group memberships? Get the size distribution of groups and of memberships per user: median, p99, max. This one query tells you most of what you need.
2. **Prototype the two-hop query on a replica.** Run it for 1,000 random users and the 100 users with the most connections. Measure p50/p99 with EXPLAIN ANALYZE, then multiply by your active user count to estimate the batch window.
3. **Whether three hops adds value.** Compare three-hop suggestions with two-hop ones for a sample of users. If the third hop mostly adds noise, keep it as gap-filler only. This is a product decision.
4. **Freshness requirement.** Find out whether product needs updates within minutes or whether a daily refresh is enough. The answer changes how much event-driven work you need.
5. **Your managed Postgres provider.** Check read replica availability and cost, whether AGE is offered, and the instance's memory headroom.
6. **Baseline network latency.** Measure Vercel → Fly → Postgres round-trip time and make sure they're in the same region. At this design, network latency will be most of your 300 ms.

**Bottom line:** this is a precomputation problem, not a storage-engine problem. Postgres, Redis queues and TypeScript workers handle it at 2 million users and well beyond. You stay on one datastore, keep hiring TypeScript developers, and the cloud bill grows with active users rather than with a new database.
