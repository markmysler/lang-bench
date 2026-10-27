# TV advert load plan for the client's Laravel API

## Short answer

Don't rewrite it. The language isn't what will stop this API coping. Running every request through the framework and the database is. Most of the traffic reads data that changes a few times a day, so it shouldn't reach PHP at all. Put a CDN cache in front of the read-only endpoints, slim down the per-user endpoints, and hire a bigger server for the day. Then load-test the whole setup before the advert airs. This is a few days of work your seniors can do, and the juniors can maintain the result afterwards.

## Why a rewrite is the wrong fix

Rough numbers (they vary a lot with the code, which is why you need a load test):

- A typical Laravel endpoint that runs a few Eloquent queries handles roughly **100–200 requests a second** on 2 vCPUs. Tuning might double that. You need 3,000, so you're 15–30 times short.
- A Go or Node rewrite might be 5–10 times faster per request. That still isn't enough on this server, and the database would still be a bottleneck.
- You'd have a brand-new, untested codebase in a language nobody at the agency knows well, built against a fixed deadline on a fixed price. That's the opposite of "any developer can maintain it" and "not waking up at night".
- A response served from a CDN cache costs your server nothing, whatever language produced it. That's the win to go after.

## What I'd do, in order of impact

### 1. Put a CDN cache in front of the public read endpoints

This is where most of the gain is.

- Use Cloudflare, Bunny, or CloudFront in front of the API hostname.
- Have the product list, and anything else that's the same for everyone, send cache headers. A shared-cache lifetime of 1–5 minutes works, plus "serve stale while you refresh" and "serve stale if the origin errors".
- Optionally, clear the CDN cache when products change, through the client's admin. With a few changes a day, a short lifetime alone is probably fine.
- With the product list served from the edge, your server sees about one request per cache lifetime per CDN location instead of thousands a second.
- The same layer should serve **product images**. If images currently come from this server, they'll do more damage than the API calls. They also cause a bandwidth problem: 3,000 requests a second at 50 KB each is over 1 Gbps, which is more than a typical VPS link.

### 2. Make the per-user endpoints (profile, basket) cheap

These can't safely go through a shared cache, so they must reach PHP. Make each request as light as possible:

- **Laravel production basics:**
  - Run the config, route and event caches.
  - Use OPcache, with timestamp checks turned off.
  - Use an optimised Composer autoloader.
  - Set `APP_DEBUG=false`.
  - Make sure Telescope and Debugbar are off in production.
- **Redis for cache, sessions and rate limiting.** Don't use the file or database drivers.
- **Cache per-user reads in Redis.** The profile in particular changes rarely.
- **Auth overhead.** If you use Sanctum, it updates `last_used_at` on every request. That's a database write per call, which adds up to thousands of writes a second during the advert. Turn it off or cache the token lookup. Check Passport for similar per-request database work.
- **Queries.** Look for N+1 queries and missing indexes on the profile and basket endpoints.
- **Move slow work out of the request.** Emails, analytics and calls to CRMs or other third parties should go onto the queue.
- **PHP-FPM settings.** Size `pm.max_children` to the memory you actually have, and check that MySQL's `max_connections` is above it.

### 3. Add capacity for the day

- Resize the server through your VPS provider for the event: 8 or more vCPUs and 16 GB is cheap for a day or two at hourly billing. Resize back afterwards.
- If MySQL is on the same machine, it competes with PHP for CPU. For the event, consider moving it to its own server or a managed database. If it stays, give it real memory (`innodb_buffer_pool_size`).
- If the load test shows one server isn't enough, Forge can set up a load balancer with two or three app servers. That's a bit more work, but it's still the same codebase.

### 4. Plan for things going wrong

- **Rate limiting.** Laravel's default API limit is 60 requests a minute per user or IP. Mobile carriers put thousands of phones behind shared IPs, so legitimate users would start getting 429 errors. Raise or rethink the limit for the event.
- **The app's retry behaviour.** Find out how it handles timeouts and errors. Aggressive automatic retries can multiply load several times exactly when you're struggling.
- **Kill switches.** Have a way to turn off non-essential features, such as recommendations or "recently viewed", without deploying.
- **Stale on error.** The CDN's "serve stale if error" setting means the product list keeps working even if the server falls over.

### 5. Load-test, then plan the day

- Use k6 or a hosted load-testing tool. Simulate a realistic mix of endpoints through the CDN. Confirm in the CDN's response headers that requests really are cache hits, then test the server alone at your expected per-user load with headroom.
- Tell the CDN provider about the test first, or its DDoS protection may block you.
- On the day:
  - Freeze deploys beforehand.
  - Warm the caches before airtime.
  - Have a senior watching Forge, the CDN dashboard and Laravel Pulse during the slot.
  - Have a written list of steps to roll back.

## Alternatives I considered

| Option | Verdict | Why |
|---|---|---|
| Rewrite in Go or Node | No | Not enough on its own, too risky against the deadline, and nobody can maintain it |
| **Laravel Octane** (Swoole or FrankenPHP) | Not now | Keeps the framework loaded between requests, 2–5 times faster. But it can leak state and memory between requests, and the team hasn't used it. Worth looking at later, not a week before a TV advert |
| Laravel Vapor or serverless | No | It's a platform migration with database connection limits and cold starts, and the team would be learning it under pressure |
| nginx micro-caching on the server (`fastcgi_cache`) | Good fallback | Use it if you can't put a CDN on the hostname. It handles high request rates, but it doesn't solve bandwidth or protect you if the server goes down |
| Just a much bigger server or several | Use alongside the CDN, not alone | Serving 3,000 uncached Laravel requests a second needs a lot of hardware and a database that keeps up. It's expensive and fragile |

## Main risks

1. **Leaking personal data through the cache.** This is the worst one. If a "public" endpoint includes anything per-user (prices, favourites, basket count, language), a shared cache will show one user's data to others. Check each cached endpoint's response carefully, and only cache by explicit opt-in.
2. **Cookies and auth headers stopping caching.** If Laravel's session or cookie middleware runs on API routes, responses carry `Set-Cookie` and CDNs won't cache them. Also, if the app sends an `Authorization` header on product requests, some CDNs bypass the cache.
3. **DNS and hostname lead time.** You can't change the app's hardcoded API URL in time (app store review), so the CDN has to sit on the existing hostname. Cloudflare usually means moving the domain's nameservers. Do this a week or more ahead, not the day before.
4. **Cache stampede.** If a popular cache entry expires at peak, every request hits the database at once. "Serve stale while revalidating" and pre-warming prevent this.
5. **Things outside your control.** Payment providers, stock systems, or push notification services called from the basket may have their own rate limits.

## Questions to answer before you commit

1. **What's the request mix?** Estimate it from logs or by watching what calls the app makes on launch and while browsing. The key number is how much of the 3,000 a second is per-user (profile and basket). If it's 5%, this is easy. If it's 40%, you need several servers.
2. **Where does 3,000 a second come from?** Ask the client for viewer numbers, expected conversion, and requests per session. Plan for double the figure.
3. **Who controls the DNS** for the API hostname, and can it go behind a CDN?
4. **Does any public response differ by user?**
5. **Are images served from this server?**
6. **Where does MySQL run**, and how big is the dataset?
7. **How does the app handle retries and timeouts?** And can anything be changed remotely, such as feature flags or config?
8. **When does the advert air?** If it's prime time or late evening, put someone on call in advance rather than finding out at 11pm.

## Commercial note

Quote this to the client as a fixed-scope "launch readiness" change request: CDN setup, tuning, a load test, a temporary bigger server and support during the advert. That's roughly 3–6 senior days, plus a modest hosting cost for the day. It's far cheaper and safer than a rewrite, and the codebase stays one any of your developers can work on.
