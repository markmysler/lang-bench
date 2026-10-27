**Short answer:** Don't rewrite the whole realtime layer in Go before the customer arrives. Spend the next few weeks measuring and fixing Reverb, then decide. If Reverb can't hold 60,000 connections at acceptable cost, put a small Go gateway in front of the connections and keep business logic in Laravel. Don't move the Laravel side to Go.

I'm working from your description, not your systems, so the numbers below are estimates to verify.

## What I'd do

**1. Find out what's actually using the memory (1 to 2 weeks).** "Most of their memory at peak" has several possible causes, and each needs a different fix:
- **Per-connection cost:** each open socket holds state. Go usually needs a few KB to tens of KB per idle connection, so 60k connections is often a few GB. Reverb's per-connection cost could be much higher, so measure it.
- **A leak or slow growth:** if memory doesn't come back down after peak, a long-running PHP process is accumulating state. That's a bug to fix, not an architecture problem.
- **Fan-out cost:** a single message to a busy channel is copied to every subscriber. Typing indicators, presence updates, and read receipts often produce more traffic than the chat messages themselves.
- **Co-location:** if Reverb shares VMs with web or queue workers, they compete for RAM and CPU.

**2. Cheap fixes first.**
- Make sure Reverb is horizontally scaled through Redis and that the instances are sized and spread across VMs, rather than one large process per box.
- Move broadcast dispatch onto queues so web requests don't wait on fan-out.
- Throttle or coalesce typing and presence events.
- Check file-descriptor limits, kernel socket settings, and load balancer WebSocket timeouts and idle settings.
- Check Redis CPU and pub/sub throughput; it can become the bottleneck before Reverb does.

**3. Run a load test that matches real traffic.** This is the decisive step. Simulate 60,000 connections with your real message rate, fan-out per channel, typing and presence volume, and reconnect behavior. Set targets before you run it, for example p99 delivery under a set number of milliseconds and memory or cost per 10,000 connections. Include a reconnect storm, since that's what often kills the busiest minute.

**4. Decide based on the result.**
- If tuned Reverb meets the targets with headroom, stay with it. Your cost and team risk stay low.
- If it doesn't, build a narrow Go connection gateway. It handles WebSocket connections, auth (by asking Laravel), and fan-out from Redis or NATS. Laravel keeps publishing events and owning authorization and business rules. This is maybe a few thousand lines and matches what the two Go engineers do well.
- Evaluate an off-the-shelf option before writing your own. Centrifugo is a mature Go server with a similar job, and Laravel can publish to it over its HTTP API. Soketi is a Pusher-compatible Node option. Either could replace Reverb in weeks instead of months. Hosted services like Pusher or Ably are worth pricing too, since they remove the operations work, though the cost at 60k concurrent connections needs checking.

## Alternatives I'd reject

- **Full Go rewrite of the realtime layer now.** The realtime code is probably more than sockets: channel authorization, message persistence, ordering, read state, and integration with the rest of the 300,000-line app. Reproducing that behavior in three months, while a major customer ramps, is the most likely way to ship bugs in the worst week.
- **Rewriting the app in Go.** Not justified by the problem. Your team is strong in PHP and Laravel, and the bottleneck is connection handling, which is a narrow part of the system.
- **Just buy bigger VMs.** Might buy a few weeks, but the memory and fan-out profile won't scale linearly, and it raises hosting cost, which you also care about.
- **Node or Elixir.** Both are good at connection-heavy work, but adding a third language to a 12-person team is a cost with little benefit over Go, which your team already has some of.

## Risks to weigh

- **Two stacks to run:** deploys, on-call, logging, metrics, and tests all double. Small teams often underestimate this.
- **Auth duplication:** if the gateway re-implements channel authorization, it becomes a security surface. Keep the decision in Laravel and have the gateway call it or verify signed tokens.
- **Bus factor:** two Go engineers is a thin base. Make sure at least one more person can operate it.
- **Semantic drift:** delivery guarantees, ordering, and reconnect replay can change subtly. Write them down first.
- **Timing:** any migration that lands during the customer ramp competes with the customer's own onboarding.

## What I'd check before committing

1. Current memory per connection in Reverb, and whether memory recovers after peak.
2. Whether Reverb is running in scaled mode, and how many processes per VM.
3. Message rate and fan-out per channel, broken down by type (chat, typing, presence).
4. Redis CPU, memory, and pub/sub throughput at current peak.
5. Load balancer and kernel limits for WebSockets.
6. Result of the 60k load test against the targets you set.
7. Whether an off-the-shelf server like Centrifugo meets the requirements.
8. Cost per 10,000 concurrent connections for each option, including ops time.
9. Who would own the Go service after launch, and whether a second person can support it.

If you can share the Reverb config, the rough message rate and fan-out numbers, and what the peak memory graph looks like, I can help you turn steps 1 to 3 into a concrete test plan.
