# Admin reporting area: build it in the monolith

**Short answer: yes, build it in the monolith.** The data, the domain logic, the auth, the deploy pipeline and the Rails skills are all already there. A separate service would cost more than it saves. The real risks don't come from where the code lives. They are about keeping reporting workloads away from customer traffic, and those are cheap to handle inside the monolith.

## What I'd build

- **A namespaced admin area in the monolith.** Give it its own `Admin::` controllers, base controller, layout and route scope. Put the reporting queries in their own query or report objects so they don't pile up in your core models. Use plain Rails with Hotwire; it's enough for 40 users. A namespace is enough of a boundary. Only reach for an engine or Packwerk if you already use them.
- **Staff authentication separate from customer authentication.** Use SSO (Okta or Google) for staff. Don't add an `admin` flag to the customer users table. A cheap extra layer on AWS is ALB OIDC authentication on an admin hostname, so requests are authenticated before they reach Rails. Add roles from day one, even if there are only two ("viewer" and "can export").
- **Reporting reads go to a read replica.** Use Rails' multi-database support (`connects_to` with a reading role) for admin queries. Set a `statement_timeout` on that connection so a bad query gets killed instead of dragging on.
- **Usage over time from rollups, not raw events.** If usage is stored as raw events, add a daily per-account rollup table, kept up to date by a scheduled Sidekiq job. Charts then read a few hundred rows instead of scanning millions. The `groupdate` and `chartkick` gems fit this well.
- **Account search in Postgres.** Use `pg_trgm` trigram indexes on name, domain and email. You don't need Elasticsearch or OpenSearch for this.
- **CSV exports run in Sidekiq, not in the web request.**
  - Run them on a dedicated low-priority queue, ideally in a separate worker ECS service so a big export can't hold up customer-facing jobs.
  - Stream rows to S3 in batches with `find_each` rather than building the file in memory.
  - Notify the user when the file is ready and give them a presigned URL.
  - Set an S3 lifecycle rule so export files expire after a few days.
- **An audit log** recording who searched for, viewed and exported which account. CS exports are customer data leaving your system, and someone will eventually ask.

## Alternatives I considered

| Option | Why not (or when it would win) |
|---|---|
| **Separate service (Go, or a new Rails app)** | It would still read the monolith's database, so you get schema coupling without any real independence. You'd duplicate the models and the "what counts as usage" logic, build a second auth setup and add a second deploy pipeline. The three-person platform team would end up owning a CS tool. No upside at this scale. |
| **BI tool (Metabase, Redash, QuickSight) on the replica** | **The strongest alternative.** It gives you charts and CSV export almost for free. It's weaker at the "search for an account, then see its page" workflow, at per-role permissions and at PII governance. If self-hosted, it's another service to run. It wins if CS mostly wants ad-hoc questions that change every week. |
| **Retool or similar internal-tool builders** | Fast to build, but it means per-seat pricing for 40 users, production database credentials held by a SaaS, and logic living outside your repo and tests. |
| **Admin gems (ActiveAdmin, Administrate, Avo)** | Fine for search and CRUD, but awkward for custom reports and charts. Reasonable if you already have one installed. Don't add one just for this. |
| **Data warehouse** | Overkill for one admin section. Revisit if analytics needs grow beyond CS. |

One question decides between the monolith and Metabase: **will CS want to act on accounts later** (change plans, extend trials, impersonate)? If yes, it belongs in the monolith. If it will only ever be reporting, Metabase deserves a serious look. A hybrid is also fine: account search and detail pages in the monolith, Metabase for ad-hoc analysis.

## Risks

1. **Heavy queries hitting the primary database.** This is the main risk to customer traffic. The replica, statement timeouts and rollups cover it.
2. **Large exports tying up web workers or exhausting worker memory.** Async exports, streaming and a separate queue cover it.
3. **Data exposure.** Admin tools are often the weakest point for PII. SSO, roles, the audit log and expiring export files cover it.
4. **Noisy on-call.** Route admin errors and export-queue failures to a non-paging channel. Internal-tool failures shouldn't wake anyone at 3am.
5. **Scope creep.** "Admin reporting" tends to grow into "the CS app." Keeping it inside the namespace makes that growth manageable rather than a problem.
6. **Replica lag.** Usually fine for reporting. Confirm CS is OK with data that's seconds or minutes old.

## Things to check before committing

- **Usage data volume:** the row count for your largest account and the growth rate. Run `EXPLAIN ANALYZE` on a realistic "12 months of usage" query for that account. This tells you whether you need rollups now or later.
- **Read replica:** do you already have one? If not, find out what adding one costs in RDS or Aurora, and whether your Rails version handles multi-database setups cleanly.
- **Largest export:** worst-case row count and file size. This tells you whether you need async exports at all and how much memory the worker needs.
- **Existing admin code:** is there already an `/admin` or an ActiveAdmin install somewhere? Extend it rather than creating a second admin area.
- **Staff identity:** do you have SSO? Is there any existing "staff" concept in the app?
- **Compliance:** do SOC 2 or customer contracts limit who can view or export customer data, or require audit trails?
- **What CS actually asks:** get their top five to ten questions in writing. If most turn out to be ad-hoc, a one-week Metabase trial on the replica is a cheap way to test the decision before building.

If those checks come back unremarkable, which I'd expect, build it in the monolith. Put most of the effort into the replica, rollups and async exports, not into where the code lives.
