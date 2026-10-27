## Short answer

Don't rewrite the API. The problem is how many requests reach PHP and MySQL, not which language runs them. Put caching in front of the read endpoints so most of the 3,000 requests/second never reach the 2 vCPU server. Then load-test the result on a copy of the production server before the advert date.

## Why the rewrite is the wrong fix

- **The uncached numbers don't fit on this box either way.** Two vCPUs serving 3,000 requests/second means each core handles about 1,500 requests/second. A Laravel endpoint that queries MySQL usually manages a few hundred per core, and a rewrite in Go or Node would still be bound by database round trips. A different language doesn't close that gap.
- **Most of the traffic is cacheable.** Product lists change a few times a day and are the same for every user. Caching them removes most of the load, which makes the language irrelevant for that traffic.
- **It doesn't fit the agency.** Two senior Laravel developers and six juniors would be taking on a second back-end language, a rewrite of business logic (basket, pricing, auth), and a deadline that a rewrite of that size is likely to miss. It would also break your goal of code any developer can maintain.

## What I would do

1. **Cache the product list at the edge.** Serve it with `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` through a CDN (Cloudflare, CloudFront, or similar). Purge it when products change. CDNs often don't cache JSON API responses by default, so this needs an explicit cache rule. Most of the advert traffic should stop at the CDN.
2. **Cache on the server too.** Add an Nginx FastCGI cache or Redis cache for the product list, with a short TTL, so a CDN miss or purge doesn't hit PHP.
3. **Keep profile and basket on Laravel, but make them lean.** Per-user data can't go on a public CDN. Use Redis for cache and sessions (not database sessions), cache the profile per user for a short time, remove unneeded middleware on those routes, and fix any N+1 queries.
4. **Add capacity for the window.** Either a second VPS behind a load balancer, or temporarily scaling up the current server. Move MySQL to its own server if it shares the box. Size PHP-FPM against the 4 GB RAM. Each child can use tens of megabytes, so `pm.max_children` is a hard ceiling on concurrency.
5. **Protect the system.** Rate-limit per IP and per token. Serve stale cached data rather than fail if the database is slow. Use cache locking so a cache expiry doesn't send thousands of requests to the database at once.
6. **Consider Octane or FrankenPHP later, not for this advert.** These keep PHP workers alive and can multiply throughput, but they require stateless code and careful memory handling. That's a real project, not a last-week change.

## Risks

- **Stale or wrong data.** Prices and stock can be out of date for up to the TTL. Agree the acceptable staleness with the client.
- **Private data cached publicly.** This is the most serious risk. A profile or basket response cached at the CDN can show one user's data to another. Only mark responses public when they are identical for every user, and check that authenticated requests bypass the shared cache.
- **Cache stampede.** Many requests arriving as a cache entry expires can overload the database. Stale-while-revalidate and cache locks prevent this.
- **Spiky traffic.** A TV advert produces a surge in seconds. Autoscaling is too slow to rely on, so capacity must be in place before the advert airs.
- **Basket writes.** These can't be cached and will still hit MySQL. Keep them simple, index the queries, and load-test them specifically.
- **Cost.** At 3,000 requests/second for 10 minutes, that's about 1.8 million requests. Multiply by the average response size to estimate CDN bandwidth, and check the CDN plan's terms.

## What I would check before committing

- **Get the real numbers from the client.** Ask how the 3,000 requests/second was estimated, which endpoints it covers, whether the basket is used anonymously, and how long the peak is expected to last. TV peaks are usually short and sharp.
- **Measure the current baseline.** Load-test the existing API on a copy of the production server with a realistic mix of endpoints (k6, Locust, or oha). Record where latency degrades and which resource runs out first.
- **Check the easy wins.** OPcache enabled, `php artisan config:cache`, `route:cache`, `view:cache`, PHP-FPM settings, Nginx worker settings, and query counts per request.
- **Test the cache.** Confirm hit rates, purging on product changes, and that a logged-in response never leaks through the shared cache.
- **Test the failure modes.** Kill the database connection mid-test and check the API degrades gracefully.
- **Plan the rollback and the deploy freeze.** No deploys in the advert window except emergency fixes, and a tested way back to the current version.
- **Set up monitoring and alerts** for request rate, error rate, PHP-FPM queue length, and database connections, and assign someone to watch during the advert.

## Bottom line

Cache the product list at the edge and on the server, make the per-user endpoints lean, add capacity on a load-tested plan, and keep the rewrite off the table. Once the load test runs, you'll know how much headroom you have and can decide whether anything more is needed.
