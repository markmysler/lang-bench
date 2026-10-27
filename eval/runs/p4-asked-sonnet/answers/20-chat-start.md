# Is Laravel a good choice for a live chat product?

**Yes, start in Laravel. But don't put the live connections inside ordinary Laravel/PHP request handling.** Run them in a separate realtime service, and keep Laravel as the product around it. I haven't run any benchmarks for this answer. The capacity figures below come from general knowledge, so the load test in the last section is what should settle them.

## What I'd use

**Laravel for everything except holding connections open.** That covers accounts, teams, billing, the agent inbox, conversation history, widget settings, the API and the admin. This is where the Laravel founder's speed matters most, and it's most of the product.

**A separate WebSocket server for the live part**, with two candidates:
- **Laravel Reverb** (first-party, written in PHP). It's the default choice. It fits the Laravel events and channel-authorization model, so the founder stays in familiar territory. It scales across several servers using Redis.
- **Centrifugo** (self-hosted, written in Go). This is the fallback if Reverb struggles in your tests. Laravel publishes messages to it over a simple HTTP call. It's built for large connection counts and works fine alongside Laravel.

**Design it so the realtime server can be swapped.** Laravel should only say "publish this message to this conversation" and "is this visitor allowed on this channel". If the rest of the app depends on that narrow interface, moving from Reverb to Centrifugo later is a few days of work, not a rewrite.

**Run the realtime servers on their own VMs**, separate from the web/API machines. They have different bottlenecks (open connections versus request throughput) and need to scale independently.

## Why this works at your numbers

- **2,000 simultaneous widgets** is small. One modest VM handles it, so the year-one plan needs no special architecture.
- **50,000 in three years** is moderate. Idle connections are cheap and mostly cost memory, but a single server needs tuning (file-descriptor limits, load balancer timeouts). Plan on a small pool of realtime VMs behind a load balancer rather than one big one.
- **Fan-out is small.** A chat message goes to one customer and a few agents, not thousands of listeners, so message volume is modest. The steady background cost is keep-alive pings across all connections, plus typing indicators.

## Alternatives I considered

| Option | Why not (for now) |
|---|---|
| **Node/TypeScript for everything** | It's very good at sockets. But it means rebuilding auth, billing and admin outside the founder's strongest skills, and you gain nothing at 2,000–50,000 connections that the split design doesn't give you. |
| **Elixir/Phoenix or Go end to end** | Best raw concurrency, but a big learning curve for two people who need to ship. The concurrency headroom isn't needed at your scale. |
| **Hosted service (Pusher, Ably, etc.)** | The fastest way to ship, and a legitimate way to launch. But hosted pricing scales with concurrent connections, which cuts against your cost priority at 50,000. It's also a dependency in the middle of your core feature. Compare current pricing before ruling it out. |
| **PHP-FPM with polling or long-polling** | It fails your "instant delivery" requirement. Each waiting request ties up a worker, so this is the one design to avoid. |
| **Laravel Octane alone** | It speeds up request handling but doesn't make PHP a good home for thousands of open sockets. |

## Risks

1. **Reverb is young.** It's less proven at scale than Centrifugo or Node socket servers. That's why the swap-friendly design and an early load test matter.
2. **Reconnect storms.** If you restart or deploy the realtime servers, every widget reconnects at once. You need client-side backoff with jitter and a deploy approach that drains connections gradually.
3. **"Instant" isn't "guaranteed".** Networks drop. Messages must be saved in the database first, and the widget must fetch anything it missed when it reconnects. Plan for ordering and duplicate protection from day one. Don't treat the socket as the source of truth.
4. **Widget security on other people's websites.** Anonymous visitors need signed, short-lived tokens. Channel authorization must be strict per customer account, so one customer's visitors can never see another's conversations. This is the highest-stakes part, and a mistake here is a data breach.
5. **Redis as a shared dependency.** Once the realtime servers use Redis to coordinate, it becomes a single point of failure unless you plan for it.
6. **Widget weight.** The widget loads on your customers' pages, so keep the script small. A small hand-written client is preferable to pulling in a large library.
7. **Mixed-language operations.** If you adopt Centrifugo, you run a non-PHP service. It's small, but someone has to own it.

## Cost levers

The biggest saving is not technical. **Don't open the socket until the visitor opens the widget or starts a chat.** Most visitors never do, so this could cut your real connection count several-fold. Also disconnect when the tab has been hidden for a while. Define "2,000 simultaneous widgets" precisely: loaded on a page, or actively chatting? The answer changes your sizing and your bill a lot.

## What I'd check before committing (about 2–3 days)

1. **Load-test Reverb on one small VM.** Simulate 5,000–10,000 connections with a tool like k6 or Artillery, mixing idle connections, active chats and typing indicators. Record memory per connection, CPU, and message latency at the 95th and 99th percentiles. Extrapolate to 50,000.
2. **Run a restart test.** Kill the server with 5,000 connected and watch how long recovery takes and whether anything is lost.
3. **Prototype the reconnect-and-catch-up flow.** A widget that goes offline for 30 seconds should come back with no missing or duplicate messages.
4. **Check Reverb's current state.** Look at its latest scaling docs, known issues and release activity. Things move fast and my information may be dated.
5. **Get hosted pricing for 2,000 and 50,000 concurrent connections.** That gives you a real comparison number.
6. **Settle the latency goal.** "Instant" should be a number, such as under 300 ms for 95% of messages. Without one you can't tell whether a result is good.

If Reverb passes those tests, build on it. If it clearly struggles at 5–10k, switch to Centrifugo before you've built anything on top. Either way, Laravel is the right base for the product.
