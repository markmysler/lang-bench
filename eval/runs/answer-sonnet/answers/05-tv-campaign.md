**Short answer:** don't rewrite it. Make sure most of the 3,000 requests per second never reach PHP, and add a bit of temporary capacity for the ones that do. The language isn't the bottleneck. I haven't seen the code, so the numbers below are rough and need checking.

## Why a rewrite is the wrong fix

- A typical uncached Laravel endpoint with a database query costs roughly 10–30 ms of CPU. Two vCPUs therefore give you about 100–300 requests per second at best.
- A Go or Node rewrite might be several times faster, but 3,000 requests per second still hits MySQL on a 4 GB box. You would also have to build, test and maintain it in a language nobody at the agency knows. That is a poor fit for a fixed price and for not getting paged at night.
- Caching fixes the real problem in either language. Since most of the data changes a few times a day, it is the obvious fix.

## What I'd do, in order

1. **Put a CDN in front of the API and cache the public read endpoints, such as the product list.** Cloudflare or similar will do. Set `Cache-Control` headers with a short TTL (30–60 seconds), plus stale-while-revalidate and stale-if-error. If the CDN absorbs 95–99% of those requests, the origin sees tens or low hundreds per second. This is the main fix. It uses Laravel features your developers already know, with no new language.
2. **Add Nginx micro-caching (`fastcgi_cache`) on the server as a second layer.** It protects you if the CDN is misconfigured or bypassed. Forge can manage this.
3. **Handle the per-user endpoints (profile, basket) separately.** The CDN can't cache these safely. Estimate how many requests per second they will really get, because it is probably much lower than 3,000. For these:
   - Use Redis for cache and rate-limit state.
   - Check that queries are indexed and that there are no N+1 queries.
   - Check what auth does on each request. Sanctum token lookups hit the database every time.
4. **Add temporary capacity for the event.** Put one or two extra Forge servers behind a Forge load balancer, or move MySQL to its own server, for a few days. This costs very little and is easy to explain to the client. Resizing the VPS is the simplest fallback.
5. **Tune PHP-FPM and MySQL.** With about 4 GB, `pm.max_children` is probably 30–40 depending on memory per worker. Check that `max_connections` matches. Too many workers will swap or exhaust the database connections, and that tends to be the failure mode.
6. **Prepare a kill switch.** Keep a static JSON snapshot of the product list on object storage or the CDN. If everything else struggles, switch the app or the CDN rule to it.

## Alternatives I considered

- **Laravel Octane (Swoole or RoadRunner).** It is faster and still PHP, but it brings memory leaks, shared state between requests, and new ops habits. I wouldn't introduce it for a one-off spike with juniors maintaining it. Keep it as a later option.
- **Serverless or autoscaling (Vapor, Kubernetes).** It is powerful, but the learning curve and operational risk are too high for this team and budget.
- **Rewrite in Go, Node and so on.** Covered above: high cost, high risk, and it doesn't remove the need for caching.
- **Just a bigger server.** Cheap and a good safety net, but alone it only buys a small multiple, not the 30x or more you need.

## Risks

- **Leaking personal data through the cache.** If a profile or basket response gets cached publicly, one user could see another's data. Cache only explicitly whitelisted routes, and make sure those responses carry no cookies or `Authorization`-dependent content.
- **Stale data.** Decide how the client's product changes reach users, either through a purge on update or by accepting a 60-second TTL.
- **Login and signup spikes.** Password hashing is deliberately CPU-heavy. A few hundred logins per second will overwhelm 2 vCPUs, and a CDN can't help. Ask whether the ad drives account creation.
- **Cold cache at the start.** Warm it before the ad airs.
- **Neighbours on the same server.** Other client sites on the box will suffer, or cause trouble, so the API should be isolated.
- **Images and other assets.** If product images come from the same server, they could use more bandwidth than the API. Check that they're on the CDN.
- **App behaviour.** If the app makes several calls on launch, or retries aggressively on errors, it multiplies the load. Check how it handles 429 and 503 responses. App changes need store-review lead time.

## What to check before committing

1. **Where the 3,000 requests per second figure comes from.** Is it a guess or an estimate from the ad's reach? What does the app call on open, and how many calls per user?
2. **The endpoint breakdown.** What share is public and cacheable, and what share is per-user or writes?
3. **A baseline load test.** Use k6, or similar, from outside against a staging copy with production-sized data. Measure the origin uncached, then through the CDN. Test a realistic mix of endpoints rather than only the easy one.
4. **How the API domain is set up.** Check the DNS TTL and whether the domain is hardcoded in the app. Moving behind a CDN needs lead time, and it's best done weeks before the ad.
5. **The current server.** Check for other sites on it, and look at memory per PHP-FPM worker and MySQL connection limits.
6. **Operations for the night itself.** The air time is known, so schedule it. Name who watches dashboards and who can scale or flip the kill switch, and write a one-page runbook. That also covers your "not waking up at night" goal.
7. **CDN contract and limits.** Confirm that caching API responses is allowed on the plan you'd use.

If the load test shows the origin handling a few hundred requests per second with the CDN absorbing the rest, you're in good shape without rewriting anything. If the per-user endpoints turn out to be a large share, then horizontal scaling and database work become the priority.
