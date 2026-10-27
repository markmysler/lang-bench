**Recommendation:** Build it in the monolith. I don't see a good reason to build it anywhere else. This is a small internal tool, and it's the kind of work a Rails monolith handles best.

## What I'd use

- **A namespaced admin area in the monolith.** Use `/admin` controllers and views, server-rendered, with Hotwire/Turbo only where it helps. Skip a separate SPA.
- **Existing auth, plus an explicit authorization layer.** Use your current login and add a role or permission for CS (Pundit or similar), with SSO/MFA enforced if you have it. Don't rely on the route being hidden.
- **Search:** Postgres. Start with indexed `ILIKE` or prefix search. Add `pg_trgm` if fuzzy matching matters. At this scale you don't need Elasticsearch.
- **Usage over time:** Start with queries against the existing tables. If those get slow, add a small rollup table (daily usage per account) populated by a scheduled Sidekiq job. Keep the first version simple, and add the rollup only if you measure a need.
- **CSV export:** For small exports, stream the response. For large ones, use a Sidekiq job that writes to S3 and sends a short-lived signed link by email or in-app. Choose based on how big the biggest account's export is (see the checks below).
- **Reads from a replica if you have one.** If not, use statement timeouts and the safeguards below.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| **Separate service (Go or Rails)** | You would take on a new deployment, new Terraform, new auth, a new on-call surface, and duplicated schema knowledge. All of that is for 40 users. It works against "quiet on-call" and velocity. |
| **BI tool (Metabase, Retool, Superset)** | This is the real competitor. It's faster for ad hoc exploration, but account search and export inside your product's own auth and permission model is awkward. You'd also need to give it DB credentials, and you'd have a second place to enforce access rules. It's worth considering if CS's needs turn out to be mostly ad hoc queries. |
| **Admin gems (ActiveAdmin, Administrate, Avo)** | A reasonable accelerator for search and CSV. The cost is customization pain, especially for the usage-over-time views, and another dependency to maintain. Look at one if you want speed over control. |
| **Warehouse / analytics pipeline** | Overkill when the data is already in Postgres and the user count is 40. Revisit it if usage analytics grows beyond CS. |

## Risks

1. **Heavy queries hurting production.** This is the main one. A CS user running a wide-range usage query or a giant export on the primary can slow the product for customers. Mitigate with a replica, `statement_timeout` for admin queries, pagination, date-range caps, and moving exports to a background job on a separate Sidekiq queue.
2. **Sidekiq contention.** A big export job shouldn't starve customer-facing jobs. Give it its own queue and concurrency limit.
3. **Data exposure.** CSV exports of customer data leave your system. Check what fields are in them (PII, secrets, tokens), who can export, and whether exports are audit-logged.
4. **Authorization drift.** Admin sections tend to bypass the scopes and policies the main app enforces. Make sure the admin code doesn't accidentally show cross-tenant data to the wrong role, or reveal more than CS needs.
5. **Monolith health.** Keep it from becoming a dumping ground. Put it in its own namespace, keep query logic in query objects or services, and avoid adding callbacks or columns to core models just for reporting.
6. **Scope creep.** "Admin reporting" tends to grow into "analytics." Agree on what the first version includes.

## What I'd check before committing

- **Data size and shape:** the biggest account's row count for the usage data, how fast it grows, and whether the existing indexes support "by account, by date."
- **Replica availability:** whether you have a read replica, and if not, whether adding one is cheap.
- **Real query cost:** run the draft usage query with `EXPLAIN ANALYZE` against production-sized data, not just dev.
- **Largest plausible export:** that decides streaming vs. background job.
- **Who the 40 users are and what they need:** talk to two or three CS people. If they mostly want to answer ad hoc questions, a BI tool may serve them better than a custom UI.
- **Existing admin patterns:** whether the monolith already has admin auth, audit logging, or an admin gem you should extend rather than duplicate.
- **Compliance and audit needs:** whether customer contracts or your security posture require access logging or restrict who can see usage data.
- **Freshness:** whether "usage over time" needs to be real-time or whether daily rollups are fine. The answer simplifies the design.

The monolith is the right default. The one thing I'd treat as a gate is protecting production from admin queries and exports. Settle the replica and background-job approach before you start building the UI.
