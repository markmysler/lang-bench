# Should you rewrite your realtime layer in Go before the big customer arrives?

## Short answer

Don't rewrite it now. Scale and fix Reverb, prove it holds at about twice your target load within the next six weeks, and set up a managed service that speaks the same protocol as a fallback. Look at Go again after the customer is live, when you have measurements. If you do move to Go later, adopt an existing Go server (Centrifugo) rather than writing your own.

## Why a rewrite now is the wrong bet

1. **The language is probably not your bottleneck.** Reverb runs on an event loop, as a Go server would. Both hold a connection as a small amount of memory, not a thread. Go does use less memory per connection, but a simple Go server with read and write buffers per connection often uses tens of KB per connection, which may be in the same range as what Reverb uses today. The large savings come from careful tuning, which you can't rush.
2. **The hosting cost difference is small.** Suppose you reach 150,000–200,000 connections and Reverb uses even 50 KB each. That is about 10 GB of RAM, or one or two VMs. Two engineers spending three months on a rewrite cost far more than that.
3. **The timing is the worst possible.** You would be replacing the most latency-sensitive part of the product, written by two people (a bus factor of two), and putting it into production weeks before your largest customer arrives. You would also have to rebuild everything Reverb gives you for free: channel authorisation, presence channels, client events, the HTTP API Laravel uses to send broadcasts, scaling across servers, and compatibility with the Echo client.
4. **The slowdown may not be in Reverb at all.** You need to find out where the time goes before choosing a fix (see the checks below).

## What I would do

**Weeks 1–2: measure.**
- Record memory per connection and whether memory grows with the number of connections or with time since restart (the second points to a leak).
- Check CPU per Reverb process, messages per second (including typing indicators), and Redis CPU.
- Break the delivery delay into its stages: request → queue wait → broadcast call → Reverb → client.
- Build a load generator that behaves like real visitor and agent clients. This is a good job for the Go engineers. Go suits load generators well, and their work then directly produces the data any future Go decision needs.

**Weeks 2–5: fix and scale Reverb.** Usually the cheap wins come first:
- **Event loop:** confirm Reverb uses `ext-uv` rather than the default `stream_select` loop, which cannot go past about 1,024 connections per process.
- **One process per core:** each Reverb process uses a single core. Run one per core behind the load balancer. A VM with one process pegging one core while its other cores sit idle would explain both the high memory and the slow delivery.
- **Dedicated machines:** give Reverb its own VMs, and give its Redis pub/sub its own Redis instance, separate from cache, queues and sessions. Redis does its work on a single thread.
- **Operating system and proxy limits:** check the open-file limit (`ulimit -n`), proxy connection limits, `somaxconn`, and ephemeral ports. If nginx proxies to Reverb on localhost, each connection uses one local port, which caps you at roughly 28,000 connections per upstream address by default.
- **Leftover tooling:** make sure Telescope, debug logging, or Pulse are not recording every message in production.
- **Less traffic from clients:**
  - Throttle typing indicators.
  - Have the widget connect only when a chat is opened, not on every page view.
  - Don't make agent dashboards subscribe to hundreds of per-chat channels. Use one channel per agent or team.
  - Keep presence channels small.
- **Broadcast path:** if broadcasts go through queues, give them a dedicated, well-provisioned queue so a backlog of ordinary jobs can't delay chat messages.

**Weeks 5–7: load test at about twice the target**, roughly 120,000 chats, counted in real connections. Then test failures under that load:
- kill a Reverb node
- fail over Redis
- deploy while everyone is connected

The deploy is the one that usually hurts. Every client reconnects at once, and each private channel needs a fresh authorisation request to Laravel. Add random delay to client reconnects and keep the authorisation endpoint cheap.

**Week 8: decide go or no-go.** If Reverb fails the test, switch the launch to a managed service that speaks the same protocol (next section). That is a configuration change, not a rewrite.

**Weeks 9–12: buffer time and a staged onboarding.** Ask the customer whether their teams can come on in waves rather than all on day one.

**Structural option: separate clusters per customer.** Consider giving the big customer its own Reverb cluster. It's a configuration-level change: Reverb supports multiple apps, and their widget and dashboard simply point to a different host. It limits how much one failure can break. It also avoids a known limit of Reverb's scaling across servers: every message goes through Redis to every server, whether or not that server has anyone subscribed.

## Alternatives I considered

| Option | Verdict |
|---|---|
| **Custom Go server** (the proposal) | Not now. Highest risk and longest timeline, and the gain is uncertain until you measure. |
| **Pusher Channels or Ably** (managed) | **This is the fallback.** Reverb implements Pusher's protocol, so Laravel and Echo barely change. It is expensive at 150,000+ connections, so get a quote now, test it with a slice of traffic, and keep it ready. |
| **Centrifugo** (an existing open-source Go server) | **This is the right form of Go if you go there later.** It is mature, built to handle very large numbers of connections, and has Laravel broadcaster packages. It uses its own protocol, so the widget and dashboard clients have to change. That is too big a change for this quarter, but a good project for next year. |
| **Soketi** (Node.js, speaks Pusher's protocol) | Fast and light on memory, but development has slowed a lot. I wouldn't bet a launch on it. |
| **Just add VMs** | Part of the answer, but on its own it hides the problems above rather than fixing them. |

## Risks of my plan

- Reverb is fairly new, and there are few public reports of it running above 100,000 connections. The load test exists to find that out early. The managed fallback covers you if it fails.
- Redis pub/sub may hit its ceiling as you add servers. Separate clusters per customer, or splitting traffic across several Redis instances, mitigate this.
- If the load test slips past week 7, you lose your safety margin. Treat it as the top priority, not a side task.
- The two Go engineers may feel overruled. Give them real ownership of the load testing and of the later Centrifugo evaluation.

## What to check before you commit

1. **How many connections a "chat" really means:** visitors, agents, multiple tabs, and idle widgets. 60,000 chats could mean 80,000 connections or 300,000.
2. **The new customer's traffic pattern:** morning login rushes, the size of their agent teams, and peak messages per second.
3. **Where today's delivery delay actually comes from:** queue, PHP-FPM, Reverb CPU, or Redis.
4. **Your current Reverb setup:** event loop, processes per VM, how many of the 10 VMs run Reverb, and Redis topology.
5. **The rest of the system at 7.5 times today's load.** MySQL write volume, queue workers and the authorisation endpoint may break before Reverb does. Load test the whole path, not just the WebSocket layer.
6. **A quote from Pusher or Ably** for your expected peak, so the fallback is a known cost and not a surprise.

## When Go would make sense

Revisit it if, after tuning, the measurements show per-connection memory is a meaningful share of hosting cost, or that Reverb's design limits you as you head toward several hundred thousand connections. At that point, adopt Centrifugo with data in hand. Doing it after the launch also means a rewrite never sits on the critical path for your biggest contract.
