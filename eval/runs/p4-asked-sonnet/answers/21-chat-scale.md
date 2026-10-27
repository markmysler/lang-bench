# Should you rewrite realtime in Go?

**My recommendation is not to rewrite yet.** Spend the next 2–3 weeks measuring and load-testing. Decide on a rewrite only if the results force it, and even then I'd avoid a from-scratch rewrite. I haven't seen your metrics, so this rests on the usual way these systems behave.

## Why not rewrite now

- **You don't yet know why memory is high.** "Reverb uses most of its memory at peak" could mean several things:
  - Connections are expensive.
  - A few slow clients are causing buffer build-up.
  - Presence channels or large payloads are inflating memory.
  - Long-running PHP processes are leaking or fragmenting memory.
  - Servers are simply undersized or unevenly balanced.

  A rewrite fixes only some of these. Go would give you far lower memory per connection, but that is a reason to measure, not proof you need it.
- **The target is about 7.5x, not 100x.** Reverb scales horizontally through Redis pub/sub, so 60,000 chats is mostly an engineering and capacity problem. Many teams run well past that on PHP-based WebSocket servers once configured properly.
- **Three months is tight for a rewrite.** The hidden work is bigger than the WebSocket server itself:
  - Pusher-protocol compatibility with your existing Echo/pusher-js clients.
  - Private and presence channel auth.
  - Reconnect and missed-message behaviour.
  - Rate limiting, graceful deploys and connection draining.
  - Monitoring, and parity with your Laravel event and broadcasting flow.

  You would be doing this under deadline pressure, for the customer you can least afford to disappoint.
- **People risk.** Two Go engineers would own a critical, on-call system that the other ten can't maintain. That is a bus-factor problem for a reliability-sensitive product.

## What I'd do first (weeks 1–3)

1. **Instrument.** For each Reverb node, track:
   - connections
   - memory per connection
   - event-loop lag
   - outbound buffer sizes
   - message latency, from broadcast to client receipt
   - Redis pub/sub throughput and CPU
2. **Check the basics.**
   - Is the event-loop extension (ext-uv or ext-ev) installed? Without one, PHP falls back to `stream_select`, which has a hard ~1,024 file-descriptor limit and is slower.
   - Are file-descriptor limits (`ulimit -n`) raised?
   - Is Reverb's scaling mode on, with Redis configured correctly?
   - Are the Reverb processes supervised, with periodic graceful restarts if memory creeps?
3. **Look at traffic shape.**
   - How many connections per chat (customer, agent, supervisors, widget visitors who are connected but idle)?
   - How big are the payloads?
   - Are typing indicators or presence updates generating most of the traffic? These are often the largest and most cuttable load.
   - Are you broadcasting synchronously from request handlers, so that app latency looks like "delivery slowness"?
4. **Load-test to 100k+ chats**, which gives you about 1.6x headroom over the new customer. Use realistic clients and message patterns, and test node loss and reconnect storms. A reconnect storm is the failure most likely to hurt you in practice. When one node dies, thousands of clients reconnect at once.
5. **Separate the tiers.** Move Reverb onto dedicated VMs, not shared with the web app, and size them from the measured per-connection cost. Also check whether Redis pub/sub is becoming the bottleneck. Every node receives every message, so fan-out cost grows with node count.

## Alternatives I considered

| Option | Verdict |
|---|---|
| **Tune and scale Reverb horizontally** | Default path. Cheapest, no new skills needed. Probably sufficient, but the load test must confirm it. |
| **Full custom Go rewrite** | Highest risk and cost, and uses your two Go engineers as a single point of failure. Only justified if measurement shows Reverb can't meet the target at acceptable cost. |
| **Off-the-shelf Go server (e.g. Centrifugo) behind Laravel** | The best fallback if Reverb fails the test. It's mature and built for very high connection counts, and your Go engineers can operate it. But it uses its own protocol, not Pusher's, so you'd change the client library and auth flow. Still much less work than writing your own. |
| **Pusher-compatible alternative (e.g. Soketi)** | Keeps client compatibility, but check its maintenance status carefully before depending on it. |
| **Managed service (Pusher, Ably)** | Lowest operational risk and fastest to ship. Pricing at 60k concurrent connections may be high, so get a quote and compare it against 10+ VMs. A reasonable bridge option for the first months. |
| **Thin Go edge gateway with Laravel keeping all business logic** | The right shape if you do build in Go: Go only holds sockets and fans out, and Laravel stays the source of truth. Don't move chat logic into Go. |

## Risks to weigh

- **Under-measuring.** If you pick an approach on instinct, you may spend three months fixing the wrong thing.
- **Rewrite scope creep.** Protocol, auth and reconnect semantics are where bugs hide, and they show up as lost or duplicated messages in production.
- **Redis as a shared ceiling.** Any approach built on pub/sub fan-out can hit Redis limits before the WebSocket tier. You can shard channels across Redis instances if so.
- **Cutover risk.** Whatever you choose, plan to migrate gradually (a percentage of traffic, or per customer) with a fast rollback. Don't switch everything the week before the big customer arrives.
- **Cost.** Compare total cost, not just memory per connection. Include engineering time, on-call burden and VM count.

## Decision gate

Set it for about week 3, using your own numbers:

- **Reverb passes at 100k+ chats with acceptable VM cost and clean failure recovery.** Ship the tuned, scaled Reverb setup.
- **It fails or is too expensive.** Move to Centrifugo or a managed service as the fastest safe path, and keep a thin custom Go gateway as a longer-term option.
- **Only then consider a custom Go rewrite**, and only if it fits the schedule with a staged rollout and a rollback plan.

The Go engineers' idea isn't wrong. It is just premature without data. A good use of their time now is building the load-test harness and prototyping a Go gateway or Centrifugo integration as the fallback. That way a failed test costs you days, not months.

If you can share your current per-node connection counts, memory figures and message rates, I can help turn them into a sizing estimate for 60,000 chats.
