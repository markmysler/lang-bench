**Recommendation: build it in the monolith.** Keep it isolated, and point its heavy reads at a replica.

**Why the monolith**

- The data is already in the Rails Postgres database. A separate service would need either direct access to the monolith's schema (coupling you'd still have) or a sync pipeline (more moving parts).
- Forty internal users is a small, low-traffic audience. Rails admin-style pages with server-rendered tables and a CSV endpoint are the cheapest correct solution.
- Auth, the account model, scopes, and existing Pundit/CanCan or equivalent policies are already there. A new service would rebuild them or call back into the monolith.
- It adds no new deploy target, Terraform stack, ECS service, or on-call surface, which matches your goal of quiet on-call.
- Your team's strongest skill is Rails, so this is the fastest path to a working feature.

**Alternatives and why not (yet)**

- **Separate Go service on ECS.** Good for independence, but it duplicates auth and models, adds infrastructure, and makes the platform team the owner of a CS feature. Reconsider only if reporting load or ownership becomes a real problem.
- **Off-the-shelf BI or admin tool (Metabase, Retool, or similar) pointed at a read replica.** This is worth a serious look because it may be fastest for 40 users. It is weaker for account search with a good UX, and CS may want a guided flow rather than ad hoc queries. It is also a second system to secure and maintain. I'd run a quick prototype with it before deciding if CS's needs are mostly "find an account and export a table."
- **Admin gem (ActiveAdmin, Administrate).** Fine if you already use one. If not, a few plain controllers and views are usually less baggage than adopting a framework for one section.

**Risks**

- **Load on the primary.** Usage-over-time aggregations and wide exports can slow checkout or customer-facing paths. Run these queries against a read replica, set `statement_timeout` for the admin connection, and make sure the reporting path can't saturate the connection pool.
- **Slow queries.** Account search with `LIKE '%term%'` will scan. Use `pg_trgm` GIN indexes or full-text search. Usage over time needs an index on (account, timestamp) and probably a daily rollup table, populated by a Sidekiq job, rather than summing raw events on every page load.
- **Large exports.** Loading everything into memory will blow up a web dyno. Stream the CSV with `find_each` or a cursor, or move exports above a size threshold into a Sidekiq job on a dedicated queue, then deliver a time-limited S3 link. Keep exports off the default queue so they don't starve customer jobs.
- **Permissions and PII.** Internal users will see customer data. Check the role model, log who exported what, and decide whether CS needs field-level restrictions. Be careful about PII in logs and in CSVs left on disk or in S3.
- **Coupling.** Admin code tends to reach into internal models and drift. Keep it in its own namespace with its own query objects, so it doesn't block refactors of the core models.
- **Deploy coupling.** A reporting bug ships with the monolith. For a 40-user feature this is usually acceptable, but a feature flag helps.

**What I'd check before committing**

1. **Data volume and shape.** Row counts for the usage/event tables, growth per month, and whether usage is already stored as events or needs to be derived. This decides whether you need rollups from day one.
2. **Replica availability.** Whether you have an RDS/Aurora read replica, and whether its lag is acceptable for CS (usually minutes is fine).
3. **Export sizes.** The largest export CS will realistically request. This decides sync versus background.
4. **Access model.** Who the 40 users are, what roles they need, and whether any data must be hidden from some of them.
5. **Compliance.** Whether audit logging of PII access is required (SOC 2, GDPR, or contract terms).
6. **Network exposure.** Whether the admin area sits behind the VPN, an ALB rule, or an SSO gate, rather than on the public app domain.
7. **Existing admin tooling.** Whether there's already an admin framework to extend, which changes the effort considerably.
8. **A quick prototype of the reporting query** against production-sized data, with `EXPLAIN ANALYZE`. Most of the risk here is in that query, and it's an hour of work that settles a lot.

I haven't looked at your codebase, so these are general answers. If you point me at the repo, I can check the actual table sizes, the existing admin setup, and the query shapes.
